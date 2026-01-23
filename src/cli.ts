#!/usr/bin/env node
/**
 * Command-line interface for the Worklog system
 */

import { Command } from 'commander';
import { WorklogDatabase } from './database.js';
import { importFromJsonl, exportToJsonl, getDefaultDataPath } from './jsonl.js';
import { WorkItemStatus, WorkItemPriority, UpdateWorkItemInput, WorkItemQuery, UpdateCommentInput } from './types.js';
import { initConfig, loadConfig, getDefaultPrefix, configExists } from './config.js';
import * as fs from 'fs';

const program = new Command();

// Get prefix from config or use default
function getPrefix(overridePrefix?: string): string {
  if (overridePrefix) {
    return overridePrefix.toUpperCase();
  }
  return getDefaultPrefix();
}

// Initialize database with default prefix
const db = new WorklogDatabase(getDefaultPrefix());
const dataPath = getDefaultDataPath();

// Load data if it exists
function loadData(prefix?: string) {
  const actualPrefix = getPrefix(prefix);
  db.setPrefix(actualPrefix);
  
  if (fs.existsSync(dataPath)) {
    const { items, comments } = importFromJsonl(dataPath);
    db.import(items);
    db.importComments(comments);
  }
}

// Save data
function saveData() {
  const items = db.getAll();
  const comments = db.getAllComments();
  exportToJsonl(items, comments, dataPath);
}

program
  .name('worklog')
  .description('CLI for Worklog - a simple issue tracker')
  .version('1.0.0');

// Initialize configuration
program
  .command('init')
  .description('Initialize worklog configuration')
  .action(async () => {
    if (configExists()) {
      const config = loadConfig();
      console.log('Configuration already exists:');
      console.log(`  Project: ${config?.projectName}`);
      console.log(`  Prefix: ${config?.prefix}`);
      console.log('\nTo reinitialize, delete .worklog/config.yaml first.');
      return;
    }
    
    try {
      await initConfig();
    } catch (error) {
      console.error('Error:', (error as Error).message);
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
    loadData(options.prefix);
    
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
    
    saveData();
    console.log('Created work item:');
    console.log(JSON.stringify(item, null, 2));
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
    loadData(options.prefix);
    
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
  });

// Show a specific work item
program
  .command('show <id>')
  .description('Show details of a work item')
  .option('-c, --children', 'Also show children')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((id, options) => {
    loadData(options.prefix);
    
    const item = db.get(id);
    if (!item) {
      console.error(`Work item not found: ${id}`);
      process.exit(1);
    }
    
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
    loadData(options.prefix);
    
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
      console.error(`Work item not found: ${id}`);
      process.exit(1);
    }
    
    saveData();
    console.log('Updated work item:');
    console.log(JSON.stringify(item, null, 2));
  });

// Delete a work item
program
  .command('delete <id>')
  .description('Delete a work item')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((id, options) => {
    loadData(options.prefix);
    
    const deleted = db.delete(id);
    if (!deleted) {
      console.error(`Work item not found: ${id}`);
      process.exit(1);
    }
    
    saveData();
    console.log(`Deleted work item: ${id}`);
  });

// Export data
program
  .command('export')
  .description('Export work items and comments to JSONL file')
  .option('-f, --file <filepath>', 'Output file path', dataPath)
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((options) => {
    loadData(options.prefix);
    const items = db.getAll();
    const comments = db.getAllComments();
    exportToJsonl(items, comments, options.file);
    console.log(`Exported ${items.length} work items and ${comments.length} comments to ${options.file}`);
  });

// Import data
program
  .command('import')
  .description('Import work items and comments from JSONL file')
  .option('-f, --file <filepath>', 'Input file path', dataPath)
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((options) => {
    loadData(options.prefix);
    const { items, comments } = importFromJsonl(options.file);
    db.import(items);
    db.importComments(comments);
    saveData();
    console.log(`Imported ${items.length} work items and ${comments.length} comments from ${options.file}`);
  });

// Comment commands
// Create a comment
program
  .command('comment-create <workItemId>')
  .description('Create a comment on a work item')
  .requiredOption('-a, --author <author>', 'Author of the comment')
  .requiredOption('-c, --comment <comment>', 'Comment text (markdown supported)')
  .option('-r, --references <references>', 'Comma-separated list of references (work item IDs, file paths, or URLs)')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((workItemId, options) => {
    loadData(options.prefix);
    
    const comment = db.createComment({
      workItemId,
      author: options.author,
      comment: options.comment,
      references: options.references ? options.references.split(',').map((r: string) => r.trim()) : [],
    });
    
    if (!comment) {
      console.error(`Work item not found: ${workItemId}`);
      process.exit(1);
    }
    
    saveData();
    console.log('Created comment:');
    console.log(JSON.stringify(comment, null, 2));
  });

// List comments for a work item
program
  .command('comment-list <workItemId>')
  .description('List all comments for a work item')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((workItemId, options) => {
    loadData(options.prefix);
    
    const workItem = db.get(workItemId);
    if (!workItem) {
      console.error(`Work item not found: ${workItemId}`);
      process.exit(1);
    }
    
    const comments = db.getCommentsForWorkItem(workItemId);
    
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
  });

// Show a specific comment
program
  .command('comment-show <commentId>')
  .description('Show details of a comment')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((commentId, options) => {
    loadData(options.prefix);
    
    const comment = db.getComment(commentId);
    if (!comment) {
      console.error(`Comment not found: ${commentId}`);
      process.exit(1);
    }
    
    console.log(JSON.stringify(comment, null, 2));
  });

// Update a comment
program
  .command('comment-update <commentId>')
  .description('Update a comment')
  .option('-a, --author <author>', 'New author')
  .option('-c, --comment <comment>', 'New comment text')
  .option('-r, --references <references>', 'New references (comma-separated)')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((commentId, options) => {
    loadData(options.prefix);
    
    const updates: UpdateCommentInput = {};
    if (options.author) updates.author = options.author;
    if (options.comment) updates.comment = options.comment;
    if (options.references) updates.references = options.references.split(',').map((r: string) => r.trim());
    
    const comment = db.updateComment(commentId, updates);
    if (!comment) {
      console.error(`Comment not found: ${commentId}`);
      process.exit(1);
    }
    
    saveData();
    console.log('Updated comment:');
    console.log(JSON.stringify(comment, null, 2));
  });

// Delete a comment
program
  .command('comment-delete <commentId>')
  .description('Delete a comment')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((commentId, options) => {
    loadData(options.prefix);
    
    const deleted = db.deleteComment(commentId);
    if (!deleted) {
      console.error(`Comment not found: ${commentId}`);
      process.exit(1);
    }
    
    saveData();
    console.log(`Deleted comment: ${commentId}`);
  });

program.parse();
