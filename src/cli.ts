#!/usr/bin/env node
/**
 * Command-line interface for the Worklog system
 */

import { Command } from 'commander';
import { WorklogDatabase } from './database.js';
import { importFromJsonl, exportToJsonl, getDefaultDataPath } from './jsonl.js';
import { WorkItemStatus, WorkItemPriority, UpdateWorkItemInput, WorkItemQuery, UpdateCommentInput, WorkItem, Comment } from './types.js';
import { initConfig, loadConfig, getDefaultPrefix, configExists } from './config.js';
import { gitPullDataFile, gitPushDataFile, mergeWorkItems, mergeComments, SyncResult } from './sync.js';
import * as fs from 'fs';
import chalk from 'chalk';

const program = new Command();

// Output formatting helpers
function outputJson(data: any) {
  console.log(JSON.stringify(data, null, 2));
}

function outputSuccess(message: string, jsonData?: any) {
  const isJsonMode = program.opts().json;
  if (isJsonMode) {
    outputJson(jsonData || { success: true, message });
  } else {
    console.log(message);
  }
}

function outputError(message: string, jsonData?: any) {
  const isJsonMode = program.opts().json;
  if (isJsonMode) {
    console.error(JSON.stringify(jsonData || { success: false, error: message }, null, 2));
  } else {
    console.error(message);
  }
}

// Helper to format a value for display
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return '(empty)';
  }
  if (value === '') {
    return '(empty string)';
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    return `[${value.join(', ')}]`;
  }
  return String(value);
}

// Display detailed conflict information with color coding
function displayConflictDetails(result: SyncResult): void {
  if (result.conflictDetails.length === 0) {
    console.log('\n' + chalk.green('✓ No conflicts detected'));
    return;
  }

  console.log('\n' + chalk.bold('Conflict Resolution Details:'));
  console.log(chalk.gray('━'.repeat(80)));
  
  result.conflictDetails.forEach((conflict, index) => {
    console.log(chalk.bold(`\n${index + 1}. Work Item: ${conflict.itemId}`));
    
    if (conflict.conflictType === 'same-timestamp') {
      console.log(chalk.yellow(`   Same timestamp (${conflict.localUpdatedAt}) - merged deterministically`));
    } else {
      console.log(`   Local updated: ${conflict.localUpdatedAt || 'unknown'}`);
      console.log(`   Remote updated: ${conflict.remoteUpdatedAt || 'unknown'}`);
    }
    
    console.log(chalk.gray('   ─'.repeat(40)));
    
    conflict.fields.forEach(field => {
      console.log(chalk.bold(`   Field: ${field.field}`));
      
      // Determine which value was chosen and which was lost
      const localIsChosen = field.chosenSource === 'local' || 
                            (field.chosenSource === 'merged' && 
                             JSON.stringify(field.chosenValue) === JSON.stringify(field.localValue));
      const remoteIsChosen = field.chosenSource === 'remote' || 
                             (field.chosenSource === 'merged' && 
                              JSON.stringify(field.chosenValue) === JSON.stringify(field.remoteValue));
      
      // For merged values (like tags union), both contribute to the result
      if (field.chosenSource === 'merged') {
        console.log(chalk.cyan(`     Local:  ${formatValue(field.localValue)}`));
        console.log(chalk.cyan(`     Remote: ${formatValue(field.remoteValue)}`));
        console.log(chalk.green(`     Merged: ${formatValue(field.chosenValue)}`));
      } else {
        // Show chosen value in green, lost value in red
        if (localIsChosen) {
          console.log(chalk.green(`   ✓ Local:  ${formatValue(field.localValue)}`));
          console.log(chalk.red(`   ✗ Remote: ${formatValue(field.remoteValue)}`));
        } else {
          console.log(chalk.red(`   ✗ Local:  ${formatValue(field.localValue)}`));
          console.log(chalk.green(`   ✓ Remote: ${formatValue(field.remoteValue)}`));
        }
      }
      
      console.log(chalk.gray(`     Reason: ${field.reason}`));
      console.log();
    });
  });
  
  console.log(chalk.gray('━'.repeat(80)));
}

// Get prefix from config or use default
function getPrefix(overridePrefix?: string): string {
  if (overridePrefix) {
    return overridePrefix.toUpperCase();
  }
  return getDefaultPrefix();
}

// Initialize database with default prefix (persistence and refresh handled automatically)
const dataPath = getDefaultDataPath();
let db: WorklogDatabase | null = null;

// Get or initialize database with the specified prefix
function getDatabase(prefix?: string): WorklogDatabase {
  const actualPrefix = getPrefix(prefix);
  
  // If db exists and prefix matches, return it
  if (db && db.getPrefix() === actualPrefix) {
    return db;
  }
  
  // Create new database instance with the prefix
  // The database will automatically:
  // 1. Connect to persistent SQLite storage
  // 2. Check if JSONL is newer than DB and refresh if needed
  // 3. Auto-export to JSONL on all write operations
  db = new WorklogDatabase(actualPrefix);
  return db;
}

program
  .name('worklog')
  .description('CLI for Worklog - a simple issue tracker')
  .version('1.0.0')
  .option('--json', 'Output in JSON format (machine-readable)');

// Initialize configuration
program
  .command('init')
  .description('Initialize worklog configuration')
  .action(async () => {
    const isJsonMode = program.opts().json;
    
    if (configExists()) {
      const config = loadConfig();
      if (isJsonMode) {
        outputJson({
          success: false,
          message: 'Configuration already exists',
          config: {
            projectName: config?.projectName,
            prefix: config?.prefix
          }
        });
      } else {
        console.log('Configuration already exists:');
        console.log(`  Project: ${config?.projectName}`);
        console.log(`  Prefix: ${config?.prefix}`);
        console.log('\nTo reinitialize, delete .worklog/config.yaml first.');
      }
      return;
    }
    
    try {
      await initConfig();
      const config = loadConfig();
      if (isJsonMode) {
        outputJson({
          success: true,
          message: 'Configuration initialized',
          config: {
            projectName: config?.projectName,
            prefix: config?.prefix
          }
        });
      }
    } catch (error) {
      outputError('Error: ' + (error as Error).message, { success: false, error: (error as Error).message });
      process.exit(1);
    }
  });

// Create a new work item
program
  .command('create')
  .description('Create a new work item')
  .requiredOption('-t, --title <title>', 'Title of the work item')
  .option('-d, --description <description>', 'Description of the work item', '')
  .option('-s, --status <status>', 'Status (open, in-progress, completed, blocked)', 'open')
  .option('-p, --priority <priority>', 'Priority (low, medium, high, critical)', 'medium')
  .option('-P, --parent <parentId>', 'Parent work item ID')
  .option('--tags <tags>', 'Comma-separated list of tags')
  .option('-a, --assignee <assignee>', 'Assignee of the work item')
  .option('--stage <stage>', 'Stage of the work item in the workflow')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((options) => {
    const db = getDatabase(options.prefix);
    
    const item = db.create({
      title: options.title,
      description: options.description,
      status: options.status as WorkItemStatus,
      priority: options.priority as WorkItemPriority,
      parentId: options.parent || null,
      tags: options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [],
      assignee: options.assignee || '',
      stage: options.stage || '',
    });
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ success: true, workItem: item });
    } else {
      console.log('Created work item:');
      console.log(JSON.stringify(item, null, 2));
    }
  });

// List work items
program
  .command('list')
  .description('List work items')
  .option('-s, --status <status>', 'Filter by status')
  .option('-p, --priority <priority>', 'Filter by priority')
  .option('-P, --parent <parentId>', 'Filter by parent ID (use "null" for root items)')
  .option('--tags <tags>', 'Filter by tags (comma-separated)')
  .option('-a, --assignee <assignee>', 'Filter by assignee')
  .option('--stage <stage>', 'Filter by stage')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((options) => {
    const db = getDatabase(options.prefix);
    
    const query: WorkItemQuery = {};
    if (options.status) query.status = options.status as WorkItemStatus;
    if (options.priority) query.priority = options.priority as WorkItemPriority;
    if (options.parent !== undefined) {
      query.parentId = options.parent === 'null' ? null : options.parent;
    }
    if (options.tags) {
      query.tags = options.tags.split(',').map((t: string) => t.trim());
    }
    if (options.assignee) query.assignee = options.assignee;
    if (options.stage) query.stage = options.stage;
    
    const items = db.list(query);
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ success: true, count: items.length, workItems: items });
    } else {
      if (items.length === 0) {
        console.log('No work items found');
        return;
      }
      
      console.log(`Found ${items.length} work item(s):\n`);
      items.forEach(item => {
        console.log(`[${item.id}] ${item.title}`);
        console.log(`  Status: ${item.status} | Priority: ${item.priority}`);
        if (item.parentId) console.log(`  Parent: ${item.parentId}`);
        if (item.assignee) console.log(`  Assignee: ${item.assignee}`);
        if (item.stage) console.log(`  Stage: ${item.stage}`);
        if (item.tags.length > 0) console.log(`  Tags: ${item.tags.join(', ')}`);
        if (item.description) console.log(`  ${item.description}`);
        console.log();
      });
    }
  });

// Show a specific work item
program
  .command('show <id>')
  .description('Show details of a work item')
  .option('-c, --children', 'Also show children')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((id, options) => {
    const db = getDatabase(options.prefix);
    
    const item = db.get(id);
    if (!item) {
      outputError(`Work item not found: ${id}`, { success: false, error: `Work item not found: ${id}` });
      process.exit(1);
    }
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      const result: any = { success: true, workItem: item };
      if (options.children) {
        const children = db.getChildren(id);
        result.children = children;
      }
      outputJson(result);
    } else {
      console.log(JSON.stringify(item, null, 2));
      
      if (options.children) {
        const children = db.getChildren(id);
        if (children.length > 0) {
          console.log('\nChildren:');
          children.forEach(child => {
            console.log(`  [${child.id}] ${child.title} (${child.status})`);
          });
        }
      }
    }
  });

// Update a work item
program
  .command('update <id>')
  .description('Update a work item')
  .option('-t, --title <title>', 'New title')
  .option('-d, --description <description>', 'New description')
  .option('-s, --status <status>', 'New status')
  .option('-p, --priority <priority>', 'New priority')
  .option('-P, --parent <parentId>', 'New parent ID')
  .option('--tags <tags>', 'New tags (comma-separated)')
  .option('-a, --assignee <assignee>', 'New assignee')
  .option('--stage <stage>', 'New stage')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((id, options) => {
    const db = getDatabase(options.prefix);
    
    const updates: UpdateWorkItemInput = {};
    if (options.title) updates.title = options.title;
    if (options.description) updates.description = options.description;
    if (options.status) updates.status = options.status as WorkItemStatus;
    if (options.priority) updates.priority = options.priority as WorkItemPriority;
    if (options.parent !== undefined) updates.parentId = options.parent;
    if (options.tags) updates.tags = options.tags.split(',').map((t: string) => t.trim());
    if (options.assignee !== undefined) updates.assignee = options.assignee;
    if (options.stage !== undefined) updates.stage = options.stage;
    
    const item = db.update(id, updates);
    if (!item) {
      outputError(`Work item not found: ${id}`, { success: false, error: `Work item not found: ${id}` });
      process.exit(1);
    }
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ success: true, workItem: item });
    } else {
      console.log('Updated work item:');
      console.log(JSON.stringify(item, null, 2));
    }
  });

// Delete a work item
program
  .command('delete <id>')
  .description('Delete a work item')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((id, options) => {
    const db = getDatabase(options.prefix);
    
    const deleted = db.delete(id);
    if (!deleted) {
      outputError(`Work item not found: ${id}`, { success: false, error: `Work item not found: ${id}` });
      process.exit(1);
    }
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ success: true, message: `Deleted work item: ${id}`, deletedId: id });
    } else {
      console.log(`Deleted work item: ${id}`);
    }
  });

// Export data
program
  .command('export')
  .description('Export work items and comments to JSONL file')
  .option('-f, --file <filepath>', 'Output file path', dataPath)
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((options) => {
    const db = getDatabase(options.prefix);
    const items = db.getAll();
    const comments = db.getAllComments();
    exportToJsonl(items, comments, options.file);
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ 
        success: true, 
        message: `Exported ${items.length} work items and ${comments.length} comments`,
        itemsCount: items.length,
        commentsCount: comments.length,
        file: options.file
      });
    } else {
      console.log(`Exported ${items.length} work items and ${comments.length} comments to ${options.file}`);
    }
  });

// Import data
program
  .command('import')
  .description('Import work items and comments from JSONL file')
  .option('-f, --file <filepath>', 'Input file path', dataPath)
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((options) => {
    const db = getDatabase(options.prefix);
    const { items, comments } = importFromJsonl(options.file);
    db.import(items);
    db.importComments(comments);
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ 
        success: true, 
        message: `Imported ${items.length} work items and ${comments.length} comments`,
        itemsCount: items.length,
        commentsCount: comments.length,
        file: options.file
      });
    } else {
      console.log(`Imported ${items.length} work items and ${comments.length} comments from ${options.file}`);
    }
  });

// Sync with git
program
  .command('sync')
  .description('Sync work items with git repository (pull, merge with conflict resolution, and push)')
  .option('-f, --file <filepath>', 'Data file path', dataPath)
  .option('--prefix <prefix>', 'Override the default prefix')
  .option('--no-push', 'Skip pushing changes back to git')
  .option('--dry-run', 'Show what would be synced without making changes')
  .action(async (options) => {
    const isJsonMode = program.opts().json;
    
    try {
      // Load current local data
      const db = getDatabase(options.prefix);
      const localItems = db.getAll();
      const localComments = db.getAllComments();
      
      if (!isJsonMode) {
        console.log(`Starting sync for ${options.file}...`);
        console.log(`Local state: ${localItems.length} work items, ${localComments.length} comments`);
        
        if (options.dryRun) {
          console.log('\n[DRY RUN MODE - No changes will be made]');
        }
        
        // Pull latest from git
        console.log('\nPulling latest changes from git...');
      }
      
      if (!options.dryRun) {
        await gitPullDataFile(options.file);
      }
      
      // Import remote data
      let remoteItems: WorkItem[] = [];
      let remoteComments: Comment[] = [];
      
      if (fs.existsSync(options.file)) {
        const remoteData = importFromJsonl(options.file);
        remoteItems = remoteData.items;
        remoteComments = remoteData.comments;
        if (!isJsonMode) {
          console.log(`Remote state: ${remoteItems.length} work items, ${remoteComments.length} comments`);
        }
      } else {
        if (!isJsonMode) {
          console.log('No remote data file found - treating as empty');
        }
      }
      
      // Merge work items
      if (!isJsonMode) {
        console.log('\nMerging work items...');
      }
      const itemMergeResult = mergeWorkItems(localItems, remoteItems);
      
      // Merge comments
      if (!isJsonMode) {
        console.log('Merging comments...');
      }
      const commentMergeResult = mergeComments(localComments, remoteComments);
      
      // Calculate statistics (best-effort; merge logic is heuristic)
      const itemsAdded = itemMergeResult.merged.length - localItems.length;
      const itemsUpdated = itemMergeResult.conflicts.filter(c => c.includes('Conflicting fields') || c.includes('Same updatedAt')).length;
      const itemsUnchanged = Math.max(0, localItems.length - Math.max(0, itemsUpdated));
      const commentsAdded = commentMergeResult.merged.length - localComments.length;
      const commentsUnchanged = Math.max(0, localComments.length - Math.max(0, commentsAdded));

      const result: SyncResult = {
        itemsAdded,
        itemsUpdated,
        itemsUnchanged,
        commentsAdded,
        commentsUnchanged,
        conflicts: itemMergeResult.conflicts,
        conflictDetails: itemMergeResult.conflictDetails
      };
      
      if (isJsonMode) {
        if (options.dryRun) {
          outputJson({
            success: true,
            dryRun: true,
            sync: {
              file: options.file,
              localState: {
                workItems: localItems.length,
                comments: localComments.length
              },
              remoteState: {
                workItems: remoteItems.length,
                comments: remoteComments.length
              },
              summary: result
            }
          });
          return;
        }
      } else {
        // Display detailed conflict information with colors
        displayConflictDetails(result);
        
        // Display summary
        console.log('\nSync summary:');
        console.log(`  Work items added: ${result.itemsAdded}`);
        console.log(`  Work items updated: ${result.itemsUpdated}`);
        console.log(`  Work items unchanged: ${result.itemsUnchanged}`);
        console.log(`  Comments added: ${result.commentsAdded}`);
        console.log(`  Comments unchanged: ${result.commentsUnchanged}`);
        console.log(`  Total work items: ${itemMergeResult.merged.length}`);
        console.log(`  Total comments: ${commentMergeResult.merged.length}`);
        
        if (options.dryRun) {
          console.log('\n[DRY RUN MODE - No changes were made]');
          return;
        }
      }
      
      if (options.dryRun) {
        return;
      }
      
      // Update database with merged data
      // Note: import() clears and replaces, which is correct here because
      // itemMergeResult.merged already contains the complete merged dataset
      // (all local items + all remote items, with conflicts resolved)
      db.import(itemMergeResult.merged);
      db.importComments(commentMergeResult.merged);
      
      if (!isJsonMode) {
        console.log('\nMerged data saved locally');
      }
      
      // Push to git if requested
      if (options.push !== false) {
        if (!isJsonMode) {
          console.log('\nPushing changes to git...');
        }
        await gitPushDataFile(options.file, 'Sync work items and comments');
        if (!isJsonMode) {
          console.log('Changes pushed successfully');
        }
      } else {
        if (!isJsonMode) {
          console.log('\nSkipping git push (--no-push flag)');
        }
      }
      
      if (isJsonMode) {
        outputJson({
          success: true,
          message: 'Sync completed successfully',
          sync: {
            file: options.file,
            summary: result,
            pushed: options.push !== false
          }
        });
      } else {
        console.log('\n✓ Sync completed successfully');
      }
    } catch (error) {
      if (isJsonMode) {
        outputJson({
          success: false,
          error: (error as Error).message
        });
      } else {
        console.error('\n✗ Sync failed:', (error as Error).message);
      }
      process.exit(1);
    }
  });

// Comment commands
const commentCommand = program.command('comment').description('Manage comments on work items');

// Create a comment
commentCommand
  .command('create <workItemId>')
  .description('Create a comment on a work item')
  .requiredOption('-a, --author <author>', 'Author of the comment')
  .requiredOption('-c, --comment <comment>', 'Comment text (markdown supported)')
  .option('-r, --references <references>', 'Comma-separated list of references (work item IDs, file paths, or URLs)')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((workItemId, options) => {
    const db = getDatabase(options.prefix);
    
    const comment = db.createComment({
      workItemId,
      author: options.author,
      comment: options.comment,
      references: options.references ? options.references.split(',').map((r: string) => r.trim()) : [],
    });
    
    if (!comment) {
      outputError(`Work item not found: ${workItemId}`, { success: false, error: `Work item not found: ${workItemId}` });
      process.exit(1);
    }
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ success: true, comment });
    } else {
      console.log('Created comment:');
      console.log(JSON.stringify(comment, null, 2));
    }
  });

// List comments for a work item
commentCommand
  .command('list <workItemId>')
  .description('List all comments for a work item')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((workItemId, options) => {
    const db = getDatabase(options.prefix);
    
    const workItem = db.get(workItemId);
    if (!workItem) {
      outputError(`Work item not found: ${workItemId}`, { success: false, error: `Work item not found: ${workItemId}` });
      process.exit(1);
    }
    
    const comments = db.getCommentsForWorkItem(workItemId);
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ success: true, count: comments.length, workItemId, comments });
    } else {
      if (comments.length === 0) {
        console.log('No comments found for this work item');
        return;
      }
      
      console.log(`Found ${comments.length} comment(s) for ${workItemId}:\n`);
      comments.forEach(comment => {
        console.log(`[${comment.id}] by ${comment.author} at ${comment.createdAt}`);
        console.log(`  ${comment.comment}`);
        if (comment.references.length > 0) {
          console.log(`  References: ${comment.references.join(', ')}`);
        }
        console.log();
      });
    }
  });

// Show a specific comment
commentCommand
  .command('show <commentId>')
  .description('Show details of a comment')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((commentId, options) => {
    const db = getDatabase(options.prefix);
    
    const comment = db.getComment(commentId);
    if (!comment) {
      outputError(`Comment not found: ${commentId}`, { success: false, error: `Comment not found: ${commentId}` });
      process.exit(1);
    }
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ success: true, comment });
    } else {
      console.log(JSON.stringify(comment, null, 2));
    }
  });

// Update a comment
commentCommand
  .command('update <commentId>')
  .description('Update a comment')
  .option('-a, --author <author>', 'New author')
  .option('-c, --comment <comment>', 'New comment text')
  .option('-r, --references <references>', 'New references (comma-separated)')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((commentId, options) => {
    const db = getDatabase(options.prefix);
    
    const updates: UpdateCommentInput = {};
    if (options.author) updates.author = options.author;
    if (options.comment) updates.comment = options.comment;
    if (options.references) updates.references = options.references.split(',').map((r: string) => r.trim());
    
    const comment = db.updateComment(commentId, updates);
    if (!comment) {
      outputError(`Comment not found: ${commentId}`, { success: false, error: `Comment not found: ${commentId}` });
      process.exit(1);
    }
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ success: true, comment });
    } else {
      console.log('Updated comment:');
      console.log(JSON.stringify(comment, null, 2));
    }
  });

// Delete a comment
commentCommand
  .command('delete <commentId>')
  .description('Delete a comment')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((commentId, options) => {
    const db = getDatabase(options.prefix);
    
    const deleted = db.deleteComment(commentId);
    if (!deleted) {
      outputError(`Comment not found: ${commentId}`, { success: false, error: `Comment not found: ${commentId}` });
      process.exit(1);
    }
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ success: true, message: `Deleted comment: ${commentId}`, deletedId: commentId });
    } else {
      console.log(`Deleted comment: ${commentId}`);
    }
  });

program.parse();
