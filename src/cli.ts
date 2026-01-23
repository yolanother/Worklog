#!/usr/bin/env node
/**
 * Command-line interface for the Worklog system
 */

import { Command } from 'commander';
import { WorklogDatabase } from './database.js';
import { importFromJsonl, exportToJsonl, getDefaultDataPath } from './jsonl.js';
import { WorkItemStatus, WorkItemPriority, UpdateWorkItemInput, WorkItemQuery } from './types.js';
import * as fs from 'fs';

const program = new Command();
const db = new WorklogDatabase();
const dataPath = getDefaultDataPath();

// Load data if it exists
function loadData() {
  if (fs.existsSync(dataPath)) {
    const items = importFromJsonl(dataPath);
    db.import(items);
  }
}

// Save data
function saveData() {
  const items = db.getAll();
  exportToJsonl(items, dataPath);
}

program
  .name('worklog')
  .description('CLI for Worklog - a simple issue tracker')
  .version('1.0.0');

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
  .action((options) => {
    loadData();
    
    const item = db.create({
      title: options.title,
      description: options.description,
      status: options.status as WorkItemStatus,
      priority: options.priority as WorkItemPriority,
      parentId: options.parent || null,
      tags: options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [],
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
  .action((options) => {
    loadData();
    
    const query: WorkItemQuery = {};
    if (options.status) query.status = options.status as WorkItemStatus;
    if (options.priority) query.priority = options.priority as WorkItemPriority;
    if (options.parent !== undefined) {
      query.parentId = options.parent === 'null' ? null : options.parent;
    }
    if (options.tags) {
      query.tags = options.tags.split(',').map((t: string) => t.trim());
    }
    
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
  .action((id, options) => {
    loadData();
    
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
  .action((id, options) => {
    loadData();
    
    const updates: UpdateWorkItemInput = {};
    if (options.title) updates.title = options.title;
    if (options.description) updates.description = options.description;
    if (options.status) updates.status = options.status as WorkItemStatus;
    if (options.priority) updates.priority = options.priority as WorkItemPriority;
    if (options.parent !== undefined) updates.parentId = options.parent;
    if (options.tags) updates.tags = options.tags.split(',').map((t: string) => t.trim());
    
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
  .action((id) => {
    loadData();
    
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
  .description('Export work items to JSONL file')
  .option('-f, --file <filepath>', 'Output file path', dataPath)
  .action((options) => {
    loadData();
    const items = db.getAll();
    exportToJsonl(items, options.file);
    console.log(`Exported ${items.length} work items to ${options.file}`);
  });

// Import data
program
  .command('import')
  .description('Import work items from JSONL file')
  .option('-f, --file <filepath>', 'Input file path', dataPath)
  .action((options) => {
    const items = importFromJsonl(options.file);
    db.import(items);
    saveData();
    console.log(`Imported ${items.length} work items from ${options.file}`);
  });

program.parse();
