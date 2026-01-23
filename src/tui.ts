#!/usr/bin/env node
/**
 * Terminal User Interface for the Worklog system
 */

import blessed from 'blessed';
import { WorklogDatabase } from './database.js';
import { importFromJsonl, exportToJsonl, getDefaultDataPath } from './jsonl.js';
import { loadConfig } from './config.js';
import * as fs from 'fs';
import { WorkItem, WorkItemStatus } from './types.js';

// Load configuration and create database instance with prefix
const config = loadConfig();
const prefix = config?.prefix || 'WI';
const db = new WorklogDatabase(prefix);
const dataPath = getDefaultDataPath();

// Load data if it exists
if (fs.existsSync(dataPath)) {
  const items = importFromJsonl(dataPath);
  db.import(items);
}

// Display project info
const projectInfo = config 
  ? `Project: ${config.projectName} (${config.prefix})`
  : 'No config (using WI prefix)';

// Create screen
const screen = blessed.screen({
  smartCSR: true,
  title: `Worklog TUI - ${projectInfo}`
});

// Create main list box
const list = blessed.list({
  parent: screen,
  top: 0,
  left: 0,
  width: '100%',
  height: '70%',
  label: ' Work Items (↑/↓ to navigate, Enter to view, n=new, d=delete, u=update, q=quit) ',
  border: 'line',
  style: {
    border: {
      fg: 'cyan'
    },
    selected: {
      bg: 'blue',
      fg: 'white'
    }
  },
  keys: true,
  vi: true,
  mouse: true,
  scrollbar: {
    ch: '|',
    style: {
      fg: 'cyan'
    }
  }
});

// Create detail box
const detailBox = blessed.box({
  parent: screen,
  top: '70%',
  left: 0,
  width: '100%',
  height: '30%',
  label: ' Details ',
  border: 'line',
  style: {
    border: {
      fg: 'cyan'
    }
  },
  scrollable: true,
  alwaysScroll: true,
  scrollbar: {
    ch: '|',
    style: {
      fg: 'cyan'
    }
  },
  keys: true,
  vi: true,
  mouse: true
});

let currentItems: WorkItem[] = [];
let selectedIndex = 0;

// Refresh the list
function refreshList() {
  currentItems = db.list({ parentId: null });
  const items = currentItems.map(item => {
    const childCount = db.getChildren(item.id).length;
    const childIndicator = childCount > 0 ? ` [${childCount} children]` : '';
    return `[${item.id}] ${item.title} (${item.status})${childIndicator}`;
  });
  
  list.setItems(items);
  
  if (currentItems.length === 0) {
    detailBox.setContent('No work items. Press "n" to create a new one.');
  }
  
  screen.render();
}

// Show item details
function showDetails(index: number) {
  if (index < 0 || index >= currentItems.length) return;
  
  const item = currentItems[index];
  const children = db.getChildren(item.id);
  
  let content = `ID: ${item.id}\n`;
  content += `Title: ${item.title}\n`;
  content += `Status: ${item.status}\n`;
  content += `Priority: ${item.priority}\n`;
  content += `Created: ${item.createdAt}\n`;
  content += `Updated: ${item.updatedAt}\n`;
  if (item.tags.length > 0) {
    content += `Tags: ${item.tags.join(', ')}\n`;
  }
  if (item.description) {
    content += `\nDescription:\n${item.description}\n`;
  }
  if (children.length > 0) {
    content += `\nChildren (${children.length}):\n`;
    children.forEach(child => {
      content += `  - [${child.id}] ${child.title} (${child.status})\n`;
    });
  }
  
  detailBox.setContent(content);
  screen.render();
}

// Handle list selection
list.on('select', (item, index) => {
  selectedIndex = index;
  showDetails(index);
});

// Create new item dialog
function createItemDialog() {
  const form = blessed.form({
    parent: screen,
    keys: true,
    left: 'center',
    top: 'center',
    width: 60,
    height: 15,
    border: 'line',
    label: ' Create New Work Item ',
    style: {
      border: {
        fg: 'green'
      }
    }
  });

  blessed.text({
    parent: form,
    top: 1,
    left: 2,
    content: 'Title:'
  });

  const titleInput = blessed.textbox({
    parent: form,
    name: 'title',
    top: 2,
    left: 2,
    width: '90%',
    height: 1,
    inputOnFocus: true,
    border: 'line'
  });

  blessed.text({
    parent: form,
    top: 4,
    left: 2,
    content: 'Description:'
  });

  const descInput = blessed.textbox({
    parent: form,
    name: 'description',
    top: 5,
    left: 2,
    width: '90%',
    height: 3,
    inputOnFocus: true,
    border: 'line'
  });

  const submitBtn = blessed.button({
    parent: form,
    name: 'submit',
    content: 'Create',
    top: 9,
    left: 2,
    shrink: true,
    padding: {
      left: 1,
      right: 1
    },
    style: {
      bg: 'green',
      focus: {
        bg: 'red'
      }
    }
  });

  const cancelBtn = blessed.button({
    parent: form,
    name: 'cancel',
    content: 'Cancel',
    top: 9,
    left: 12,
    shrink: true,
    padding: {
      left: 1,
      right: 1
    },
    style: {
      bg: 'red',
      focus: {
        bg: 'green'
      }
    }
  });

  submitBtn.on('press', () => {
    const title = titleInput.getValue();
    if (title) {
      db.create({
        title,
        description: descInput.getValue()
      });
      exportToJsonl(db.getAll(), dataPath);
      refreshList();
    }
    form.destroy();
    screen.render();
  });

  cancelBtn.on('press', () => {
    form.destroy();
    screen.render();
  });

  form.on('keypress', (ch, key) => {
    if (key.name === 'escape') {
      form.destroy();
      screen.render();
    }
  });

  form.focus();
  titleInput.focus();
  screen.render();
}

// Delete item dialog
function deleteItemDialog(index: number) {
  if (index < 0 || index >= currentItems.length) return;
  
  const item = currentItems[index];
  
  const dialog = blessed.question({
    parent: screen,
    border: 'line',
    height: 'shrink',
    width: 'half',
    top: 'center',
    left: 'center',
    label: ' Confirm Delete ',
    tags: true,
    keys: true,
    vi: true
  });

  dialog.ask(`Delete work item "${item.title}"?`, (err, value) => {
    if (value) {
      db.delete(item.id);
      exportToJsonl(db.getAll(), dataPath);
      refreshList();
    }
  });
}

// Update status dialog
function updateStatusDialog(index: number) {
  if (index < 0 || index >= currentItems.length) return;
  
  const item = currentItems[index];
  
  const list = blessed.list({
    parent: screen,
    label: ' Select New Status ',
    tags: true,
    border: 'line',
    width: 'half',
    height: 'half',
    top: 'center',
    left: 'center',
    keys: true,
    vi: true,
    style: {
      selected: {
        bg: 'blue'
      },
      border: {
        fg: 'green'
      }
    },
    items: ['open', 'in-progress', 'completed', 'blocked']
  });

  list.on('select', (element, index) => {
    const statuses: WorkItemStatus[] = ['open', 'in-progress', 'completed', 'blocked'];
    db.update(item.id, { status: statuses[index] });
    exportToJsonl(db.getAll(), dataPath);
    refreshList();
    list.destroy();
    screen.render();
  });

  list.focus();
  screen.render();
}

// Key bindings
list.key(['n'], () => {
  createItemDialog();
});

list.key(['d'], () => {
  deleteItemDialog(selectedIndex);
});

list.key(['u'], () => {
  updateStatusDialog(selectedIndex);
});

screen.key(['q', 'C-c'], () => {
  return process.exit(0);
});

// Initial render
refreshList();
list.focus();
screen.render();
