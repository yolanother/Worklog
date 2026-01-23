#!/usr/bin/env node
/**
 * Command-line interface for the Worklog system
 */

import { Command } from 'commander';
import { WorklogDatabase } from './database.js';
import { importFromJsonl, importFromJsonlContent, exportToJsonl, getDefaultDataPath } from './jsonl.js';
import { WorkItemStatus, WorkItemPriority, UpdateWorkItemInput, WorkItemQuery, UpdateCommentInput, WorkItem, Comment } from './types.js';
import { initConfig, loadConfig, getDefaultPrefix, configExists, isInitialized, readInitSemaphore, writeInitSemaphore } from './config.js';
import { getRemoteDataFileContent, gitPushDataFileToBranch, mergeWorkItems, mergeComments, SyncResult, GitTarget } from './sync.js';
import * as fs from 'fs';
import chalk from 'chalk';

const WORKLOG_VERSION = '0.0.1';

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
function displayConflictDetails(result: SyncResult, mergedItems: WorkItem[]): void {
  if (result.conflictDetails.length === 0) {
    console.log('\n' + chalk.green('✓ No conflicts detected'));
    return;
  }

  console.log('\n' + chalk.bold('Conflict Resolution Details:'));
  console.log(chalk.gray('━'.repeat(80)));
  
  // Create a map for O(1) lookups of work items by ID
  const itemsById = new Map(mergedItems.map(item => [item.id, item]));
  
  result.conflictDetails.forEach((conflict, index) => {
    // Find the work item in the merged items to get the title
    const workItem = itemsById.get(conflict.itemId);
    const displayText = workItem ? `${workItem.title} (${conflict.itemId})` : conflict.itemId;
    console.log(chalk.bold(`\n${index + 1}. Work Item: ${displayText}`));
    
    if (conflict.conflictType === 'same-timestamp') {
      console.log(chalk.yellow(`   Same timestamp (${conflict.localUpdatedAt}) - merged deterministically`));
    } else {
      console.log(`   Local updated: ${conflict.localUpdatedAt || 'unknown'}`);
      console.log(`   Remote updated: ${conflict.remoteUpdatedAt || 'unknown'}`);
    }
    
    console.log(chalk.gray('   ─'.repeat(40)));
    
    conflict.fields.forEach(field => {
      console.log(chalk.bold(`   Field: ${field.field}`));
      
      // For merged values (like tags union), both contribute to the result
      if (field.chosenSource === 'merged') {
        console.log(chalk.cyan(`     Local:  ${formatValue(field.localValue)}`));
        console.log(chalk.cyan(`     Remote: ${formatValue(field.remoteValue)}`));
        console.log(chalk.green(`     Merged: ${formatValue(field.chosenValue)}`));
      } else {
        // Show chosen value in green, lost value in red
        if (field.chosenSource === 'local') {
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

// Default sync configuration
const DEFAULT_GIT_REMOTE = 'origin';
const DEFAULT_GIT_BRANCH = 'refs/worklog/data';

// Initialize database with default prefix (persistence and refresh handled automatically)
const dataPath = getDefaultDataPath();
let db: WorklogDatabase | null = null;

// Check if system is initialized and exit if not
function requireInitialized(): void {
  if (!isInitialized()) {
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({
        success: false,
        initialized: false,
        error: 'Worklog system is not initialized. Run "worklog init" first.'
      });
    } else {
      console.error('Error: Worklog system is not initialized.');
      console.error('Run "worklog init" to initialize the system.');
    }
    process.exit(1);
  }
}

// Get or initialize database with the specified prefix
function getDatabase(prefix?: string): WorklogDatabase {
  const actualPrefix = getPrefix(prefix);
  
  // If db exists and prefix matches, return it
  if (db && db.getPrefix() === actualPrefix) {
    return db;
  }
  
  // Load config to get autoExport setting
  const config = loadConfig();
  const autoExport = config?.autoExport !== false; // Default to true for backwards compatibility
  
  // Create new database instance with the prefix
  // The database will automatically:
  // 1. Connect to persistent SQLite storage
  // 2. Check if JSONL is newer than DB and refresh if needed
  // 3. Auto-export to JSONL on all write operations (if autoExport is enabled)
  // When in JSON mode, suppress console output to avoid interfering with JSON parsing
  const isJsonMode = program.opts().json;
  db = new WorklogDatabase(actualPrefix, undefined, undefined, autoExport, isJsonMode);
  return db;
}

// Perform sync operation
async function performSync(options: {
  file: string;
  prefix?: string;
  gitRemote: string;
  gitBranch: string;
  push: boolean;
  dryRun: boolean;
  silent?: boolean;
}): Promise<SyncResult> {
  const isJsonMode = program.opts().json;
  const isSilent = options.silent || false;
  
  // Load current local data
  const db = getDatabase(options.prefix);
  const localItems = db.getAll();
  const localComments = db.getAllComments();
  
  if (!isJsonMode && !isSilent) {
    console.log(`Starting sync for ${options.file}...`);
    console.log(`Local state: ${localItems.length} work items, ${localComments.length} comments`);
    
    if (options.dryRun) {
      console.log('\n[DRY RUN MODE - No changes will be made]');
    }
    
    // Pull latest from git
    console.log('\nPulling latest changes from git...');
  }
  
  const gitTarget: GitTarget = {
    remote: options.gitRemote,
    branch: options.gitBranch,
  };

  // Import remote data
  let remoteItems: WorkItem[] = [];
  let remoteComments: Comment[] = [];

  const remoteContent = options.dryRun ? null : await getRemoteDataFileContent(options.file, gitTarget);
  if (remoteContent) {
    const remoteData = importFromJsonlContent(remoteContent);
    remoteItems = remoteData.items;
    remoteComments = remoteData.comments;
  }

  if (!isJsonMode && !isSilent) {
    console.log(`Remote state: ${remoteItems.length} work items, ${remoteComments.length} comments`);
  }
  
  // Merge work items
  if (!isJsonMode && !isSilent) {
    console.log('\nMerging work items...');
  }
  const itemMergeResult = mergeWorkItems(localItems, remoteItems);
  
  // Merge comments
  if (!isJsonMode && !isSilent) {
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
  
  if (isJsonMode && !isSilent) {
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
      return result;
    }
  } else if (!isSilent) {
    // Display detailed conflict information with colors
    displayConflictDetails(result, itemMergeResult.merged);
    
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
      return result;
    }
  }
  
  if (options.dryRun) {
    return result;
  }
  
  // Update database with merged data
  // Note: import() clears and replaces, which is correct here because
  // itemMergeResult.merged already contains the complete merged dataset
  // (all local items + all remote items, with conflicts resolved)
  db.import(itemMergeResult.merged);
  db.importComments(commentMergeResult.merged);
  
  if (!isJsonMode && !isSilent) {
    console.log('\nMerged data saved locally');
  }

  // Ensure the JSONL file on disk reflects the merged state for this repo.
  // This file is what we will commit to the dedicated data branch.
  exportToJsonl(itemMergeResult.merged, commentMergeResult.merged, options.file);
  
  // Push to git if requested
  if (options.push) {
    if (!isJsonMode && !isSilent) {
      console.log('\nPushing changes to git...');
    }
    await gitPushDataFileToBranch(options.file, 'Sync work items and comments', gitTarget);
    if (!isJsonMode && !isSilent) {
      console.log('Changes pushed successfully');
    }
  } else {
    if (!isJsonMode && !isSilent) {
      console.log('\nSkipping git push (--no-push flag)');
    }
  }
  
  if (isJsonMode && !isSilent) {
    outputJson({
      success: true,
      message: 'Sync completed successfully',
      sync: {
        file: options.file,
        summary: result,
        pushed: options.push
      }
    });
  } else if (!isSilent) {
    console.log('\n✓ Sync completed successfully');
  }
  
  return result;
}

program
  .name('worklog')
  .description('CLI for Worklog - a simple issue tracker')
  .version(WORKLOG_VERSION)
  .option('--json', 'Output in JSON format (machine-readable)');

// Initialize configuration
program
  .command('init')
  .description('Initialize worklog configuration')
  .action(async () => {
    const isJsonMode = program.opts().json;
    
    if (configExists()) {
      // Config exists, but ensure semaphore is written if not present
      if (!isInitialized()) {
        writeInitSemaphore(WORKLOG_VERSION);
      }
      
      const config = loadConfig();
      const initInfo = readInitSemaphore();
      
      if (isJsonMode) {
        // In JSON mode, we can't do interactive prompts, so just report the existing config
        outputJson({
          success: true,
          message: 'Configuration already exists',
          config: {
            projectName: config?.projectName,
            prefix: config?.prefix
          },
          version: initInfo?.version || WORKLOG_VERSION,
          initializedAt: initInfo?.initializedAt
        });
        return;
      } else {
        // In interactive mode, allow user to change settings
        try {
          const updatedConfig = await initConfig(config);
          
          // Update semaphore with current version
          writeInitSemaphore(WORKLOG_VERSION);
          
          // Sync database after any changes
          console.log('\nSyncing database...');
          
          try {
            await performSync({
              file: dataPath,
              prefix: updatedConfig?.prefix,
              gitRemote: DEFAULT_GIT_REMOTE,
              gitBranch: DEFAULT_GIT_BRANCH,
              push: true,
              dryRun: false,
              silent: false
            });
          } catch (syncError) {
            console.log('\nNote: Sync failed (this is OK for new projects without remote data)');
            console.log(`  ${(syncError as Error).message}`);
          }
          return;
        } catch (error) {
          outputError('Error: ' + (error as Error).message, { success: false, error: (error as Error).message });
          process.exit(1);
        }
      }
    }
    
    try {
      await initConfig();
      const config = loadConfig();
      
      // Write initialization semaphore with version
      writeInitSemaphore(WORKLOG_VERSION);
      
      // Read it back to get the exact timestamp
      const initInfo = readInitSemaphore();
      
      if (isJsonMode) {
        outputJson({
          success: true,
          message: 'Configuration initialized',
          config: {
            projectName: config?.projectName,
            prefix: config?.prefix
          },
          version: WORKLOG_VERSION,
          initializedAt: initInfo?.initializedAt
        });
      }
      
      // Sync database after initialization
      if (!isJsonMode) {
        console.log('\nSyncing database...');
      }
      
      try {
        await performSync({
          file: dataPath,
          prefix: config?.prefix,
          gitRemote: DEFAULT_GIT_REMOTE,
          gitBranch: DEFAULT_GIT_BRANCH,
          push: true,
          dryRun: false,
          silent: isJsonMode  // Silent in JSON mode to maintain clean JSON output
        });
      } catch (syncError) {
        // Sync errors are not fatal for init - just warn the user
        if (isJsonMode) {
          // In JSON mode, include sync error in the output but still report success for init
          const output: any = {
            success: true,
            message: 'Configuration initialized',
            config: {
              projectName: config?.projectName,
              prefix: config?.prefix
            },
            syncWarning: {
              message: 'Sync failed (this is OK for new projects without remote data)',
              error: (syncError as Error).message
            }
          };
          outputJson(output);
        } else {
          console.log('\nNote: Sync failed (this is OK for new projects without remote data)');
          console.log(`  ${(syncError as Error).message}`);
        }
      }
    } catch (error) {
      outputError('Error: ' + (error as Error).message, { success: false, error: (error as Error).message });
      process.exit(1);
    }
  });

// Status command - check initialization and provide summary
program
  .command('status')
  .description('Show Worklog system status and database summary')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((options) => {
    const isJsonMode = program.opts().json;
    
    // Check if initialized
    if (!isInitialized()) {
      if (isJsonMode) {
        outputJson({
          success: false,
          initialized: false,
          error: 'Worklog system is not initialized. Run "worklog init" first.'
        });
      } else {
        console.error('Error: Worklog system is not initialized.');
        console.error('Run "worklog init" to initialize the system.');
      }
      process.exit(1);
    }
    
    // Read initialization info
    const initInfo = readInitSemaphore();
    
    // Get database statistics
    const db = getDatabase(options.prefix);
    const workItems = db.getAll();
    const comments = db.getAllComments();
    const config = loadConfig();
    
    if (isJsonMode) {
      outputJson({
        success: true,
        initialized: true,
        version: initInfo?.version || 'unknown',
        initializedAt: initInfo?.initializedAt || 'unknown',
        config: {
          projectName: config?.projectName,
          prefix: config?.prefix
        },
        database: {
          workItems: workItems.length,
          comments: comments.length
        }
      });
    } else {
      console.log('Worklog System Status');
      console.log('=====================\n');
      console.log(`Initialized: Yes`);
      console.log(`Version: ${initInfo?.version || 'unknown'}`);
      console.log(`Initialized at: ${initInfo?.initializedAt || 'unknown'}`);
      console.log();
      console.log('Configuration:');
      console.log(`  Project: ${config?.projectName || 'unknown'}`);
      console.log(`  Prefix: ${config?.prefix || 'unknown'}`);
      console.log();
      console.log('Database Summary:');
      console.log(`  Work Items: ${workItems.length}`);
      console.log(`  Comments: ${comments.length}`);
    }
  });

// Create a new work item
program
  .command('create')
  .description('Create a new work item')
  .requiredOption('-t, --title <title>', 'Title of the work item')
  .option('-d, --description <description>', 'Description of the work item', '')
  .option('-s, --status <status>', 'Status (open, in-progress, completed, blocked, deleted)', 'open')
  .option('-p, --priority <priority>', 'Priority (low, medium, high, critical)', 'medium')
  .option('-P, --parent <parentId>', 'Parent work item ID')
  .option('--tags <tags>', 'Comma-separated list of tags')
  .option('-a, --assignee <assignee>', 'Assignee of the work item')
  .option('--stage <stage>', 'Stage of the work item in the workflow')
  .option('--issue-type <issueType>', 'Issue type (interoperability field)')
  .option('--created-by <createdBy>', 'Created by (interoperability field)')
  .option('--deleted-by <deletedBy>', 'Deleted by (interoperability field)')
  .option('--delete-reason <deleteReason>', 'Delete reason (interoperability field)')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((options) => {
    requireInitialized();
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
      issueType: options.issueType || '',
      createdBy: options.createdBy || '',
      deletedBy: options.deletedBy || '',
      deleteReason: options.deleteReason || '',
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
    requireInitialized();
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
    requireInitialized();
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
  .option('--issue-type <issueType>', 'New issue type (interoperability field)')
  .option('--created-by <createdBy>', 'New created by (interoperability field)')
  .option('--deleted-by <deletedBy>', 'New deleted by (interoperability field)')
  .option('--delete-reason <deleteReason>', 'New delete reason (interoperability field)')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((id, options) => {
    requireInitialized();
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
    if (options.issueType !== undefined) updates.issueType = options.issueType;
    if (options.createdBy !== undefined) updates.createdBy = options.createdBy;
    if (options.deletedBy !== undefined) updates.deletedBy = options.deletedBy;
    if (options.deleteReason !== undefined) updates.deleteReason = options.deleteReason;
    
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
    requireInitialized();
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
    requireInitialized();
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
    requireInitialized();
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

// Find the next work item to work on
program
  .command('next')
  .description('Find the next work item to work on based on priority and status')
  .option('-a, --assignee <assignee>', 'Filter by assignee')
  .option('-s, --search <term>', 'Search term for fuzzy matching against title, description, and comments')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action(async (options) => {
    requireInitialized();
    const db = getDatabase(options.prefix);
    
    const result = db.findNextWorkItem(options.assignee, options.search);
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      if (result.workItem) {
        outputJson({ success: true, workItem: result.workItem, reason: result.reason });
      } else {
        outputJson({ success: true, workItem: null, reason: result.reason });
      }
    } else {
      if (!result.workItem) {
        console.log('No work items found to work on.');
        if (result.reason) {
          console.log(`Reason: ${result.reason}`);
        }
        return;
      }
      
      console.log('\nNext work item to work on:');
      console.log('==========================\n');
      console.log(`ID:          ${result.workItem.id}`);
      console.log(`Title:       ${result.workItem.title}`);
      console.log(`Status:      ${result.workItem.status}`);
      console.log(`Priority:    ${result.workItem.priority}`);
      if (result.workItem.assignee) console.log(`Assignee:    ${result.workItem.assignee}`);
      if (result.workItem.parentId) console.log(`Parent:      ${result.workItem.parentId}`);
      if (result.workItem.description) {
        console.log(`Description: ${result.workItem.description}`);
      }
      console.log(`\nReason:      ${chalk.cyan(result.reason)}`);
      
      // Offer to copy ID to clipboard
      console.log('\n');
      
      // Simple clipboard prompt (no actual clipboard functionality yet)
      // Note: For actual clipboard support, we would need a package like 'clipboardy'
      // For now, we just display the ID prominently
      console.log(`Work item ID: ${chalk.green.bold(result.workItem.id)}`);
      console.log(`(Copy the ID above to use it in other commands)`);
    }
  });

// Sync with git
program
  .command('sync')
  .description('Sync work items with git repository (pull, merge with conflict resolution, and push)')
  .option('-f, --file <filepath>', 'Data file path', dataPath)
  .option('--prefix <prefix>', 'Override the default prefix')
  .option('--git-remote <remote>', 'Git remote to use for syncing data', DEFAULT_GIT_REMOTE)
  .option('--git-branch <ref>', 'Git ref to store worklog data (use refs/worklog/data to avoid GitHub PR banners)', DEFAULT_GIT_BRANCH)
  .option('--no-push', 'Skip pushing changes back to git')
  .option('--dry-run', 'Show what would be synced without making changes')
  .action(async (options) => {
    requireInitialized();
    const isJsonMode = program.opts().json;
    
    try {
      await performSync({
        file: options.file,
        prefix: options.prefix,
        gitRemote: options.gitRemote,
        gitBranch: options.gitBranch,
        push: options.push ?? true,  // Default to true if not specified
        dryRun: options.dryRun ?? false,
        silent: false
      });
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
    requireInitialized();
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
    requireInitialized();
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
    requireInitialized();
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
    requireInitialized();
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
    requireInitialized();
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
