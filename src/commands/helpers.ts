/**
 * Shared helper functions for CLI commands
 */

import chalk from 'chalk';
import type { WorkItem, Comment } from '../types.js';
import type { SyncResult } from '../sync.js';
import type { WorklogDatabase } from '../database.js';
import { loadConfig } from '../config.js';
import type { Command } from 'commander';

// Priority ordering for sorting work items (higher number = higher priority)
const PRIORITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 } as const;
const DEFAULT_PRIORITY = PRIORITY_ORDER.medium;

// Helper to format a value for display
export function formatValue(value: any): string {
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

// Helper function to sort items by priority and creation date
export function sortByPriorityAndDate(a: WorkItem, b: WorkItem): number {
  // Higher priority comes first (descending order)
  const aPriority = PRIORITY_ORDER[a.priority] ?? DEFAULT_PRIORITY;
  const bPriority = PRIORITY_ORDER[b.priority] ?? DEFAULT_PRIORITY;
  const priorityDiff = bPriority - aPriority;
  if (priorityDiff !== 0) return priorityDiff;
  // If priorities are equal, sort by creation time (oldest first, ascending order)
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

// Format title and id with consistent coloring used in tree/list outputs
export function formatTitleAndId(item: WorkItem, prefix: string = ''): string {
  return `${prefix}${chalk.greenBright(item.title)} ${chalk.gray('-')} ${chalk.gray(item.id)}`;
}

// Format only the title (consistent color)
export function formatTitleOnly(item: WorkItem): string {
  return chalk.greenBright(item.title);
}

// Helper to display work items in a tree structure
export function displayItemTree(items: WorkItem[]): void {
  const itemIds = new Set(items.map(i => i.id));
  
  const rootItems = items.filter(item => {
    if (item.parentId === null) return true;
    return !itemIds.has(item.parentId);
  });
  
  rootItems.sort(sortByPriorityAndDate);
  
  rootItems.forEach((item, index) => {
    const isLastItem = index === rootItems.length - 1;
    displayItemNode(item, items, '', isLastItem);
  });
}

function displayItemNode(item: WorkItem, allItems: WorkItem[], indent: string = '', isLast: boolean = true): void {
  const prefix = indent + (isLast ? '└── ' : '├── ');
  console.log(formatTitleAndId(item, prefix));
  
  const detailIndent = indent + (isLast ? '    ' : '│   ');
  console.log(`${detailIndent}Status: ${item.status} | Priority: ${item.priority}`);
  if (item.assignee) console.log(`${detailIndent}Assignee: ${item.assignee}`);
  if (item.tags.length > 0) console.log(`${detailIndent}Tags: ${item.tags.join(', ')}`);
  
  const children = allItems.filter(i => i.parentId === item.id);
  if (children.length > 0) {
    children.sort(sortByPriorityAndDate);
    
    children.forEach((child, childIndex) => {
      const isLastChild = childIndex === children.length - 1;
      displayItemNode(child, allItems, detailIndent, isLastChild);
    });
  }
}

// Standard human formatter: supports 'concise' | 'normal' | 'full' | 'raw'
export function humanFormatWorkItem(item: WorkItem, db: WorklogDatabase | null, format: string | undefined): string {
  const fmt = (format || loadConfig()?.humanDisplay || 'concise').toLowerCase();

  const lines: string[] = [];
  const titleLine = `Title: ${formatTitleOnly(item)}`;
  const idLine = `ID:    ${chalk.gray(item.id)}`;

  if (fmt === 'raw') {
    return JSON.stringify(item, null, 2);
  }

  if (fmt === 'concise') {
    return `${formatTitleOnly(item)} ${chalk.gray(item.id)}`;
  }

  // normal output
  if (fmt === 'normal') {
    lines.push(idLine);
    lines.push(titleLine);
    lines.push(`Status: ${item.status} | Priority: ${item.priority}`);
    if (item.assignee) lines.push(`Assignee: ${item.assignee}`);
    if (item.parentId) lines.push(`Parent: ${item.parentId}`);
    if (item.description) lines.push(`Description: ${item.description}`);
    return lines.join('\n');
  }

  // full output
  lines.push(chalk.greenBright(`# ${item.title}`));
  lines.push('');
  const frontmatter: Array<[string, string]> = [
    ['ID', chalk.gray(item.id)],
    ['Status', `${item.status} | Priority: ${item.priority}`]
  ];
  if (item.assignee) frontmatter.push(['Assignee', item.assignee]);
  if (item.parentId) frontmatter.push(['Parent', item.parentId]);
  if (item.tags && item.tags.length > 0) frontmatter.push(['Tags', item.tags.join(', ')]);
  const labelWidth = frontmatter.reduce((max, [label]) => Math.max(max, label.length), 0);
  frontmatter.forEach(([label, value]) => {
    lines.push(`${label.padEnd(labelWidth)}: ${value}`);
  });

  if (item.description) {
    lines.push('');
    lines.push('## Description');
    lines.push('');
    lines.push(item.description);
  }

  if (item.stage) {
    lines.push('');
    lines.push('## Stage');
    lines.push('');
    lines.push(item.stage);
  }

  if (db) {
    const comments = db.getCommentsForWorkItem(item.id);
    if (comments.length > 0) {
      lines.push('');
      lines.push('## Comments');
      lines.push('');
      for (const c of comments) {
        lines.push(`  [${c.id}] ${c.author} at ${c.createdAt}`);
        lines.push(`    ${c.comment}`);
      }
    }
  }

  return lines.join('\n');
}

// Resolve final format choice: CLI override > provided > config > default
export function resolveFormat(program: Command, provided?: string): string {
  const cliFormat = program.opts().format;
  if (cliFormat && typeof cliFormat === 'string' && cliFormat.trim() !== '') return cliFormat;
  if (provided && provided.trim() !== '') return provided;
  return loadConfig()?.humanDisplay || 'concise';
}

// Human formatter for comments
export function humanFormatComment(comment: Comment, format?: string): string {
  const fmt = (format || loadConfig()?.humanDisplay || 'concise').toLowerCase();
  if (fmt === 'raw') return JSON.stringify(comment, null, 2);
  if (fmt === 'concise') {
    const excerpt = comment.comment.split('\n')[0];
    return `${chalk.gray('[' + comment.id + ']')} ${comment.author} - ${excerpt}`;
  }

  const lines: string[] = [];
  lines.push(`ID:      ${chalk.gray(comment.id)}`);
  lines.push(`Author:  ${comment.author}`);
  lines.push(`Created: ${comment.createdAt}`);
  lines.push('');
  lines.push(comment.comment);
  if (comment.references && comment.references.length > 0) {
    lines.push('');
    lines.push(`References: ${comment.references.join(', ')}`);
  }
  return lines.join('\n');
}

// Display detailed conflict information with color coding
export function displayConflictDetails(result: SyncResult, mergedItems: WorkItem[]): void {
  if (result.conflictDetails.length === 0) {
    console.log('\n' + chalk.green('✓ No conflicts detected'));
    return;
  }

  console.log('\n' + chalk.bold('Conflict Resolution Details:'));
  console.log(chalk.gray('━'.repeat(80)));
  
  const itemsById = new Map(mergedItems.map(item => [item.id, item]));
  
  result.conflictDetails.forEach((conflict: any, index: number) => {
    const workItem = itemsById.get(conflict.itemId);
    const displayText = workItem ? `${formatTitleOnly(workItem)} (${conflict.itemId})` : conflict.itemId;
    console.log(chalk.bold(`\n${index + 1}. Work Item: ${displayText}`));
    
    if (conflict.conflictType === 'same-timestamp') {
      console.log(chalk.yellow(`   Same timestamp (${conflict.localUpdatedAt}) - merged deterministically`));
    } else {
      console.log(`   Local updated: ${conflict.localUpdatedAt || 'unknown'}`);
      console.log(`   Remote updated: ${conflict.remoteUpdatedAt || 'unknown'}`);
    }
    
    console.log();
    
    conflict.fields.forEach((field: any) => {
      console.log(chalk.bold(`   Field: ${field.field}`));
      
      if (field.chosenSource === 'merged') {
        console.log(chalk.cyan(`     Local:  ${formatValue(field.localValue)}`));
        console.log(chalk.cyan(`     Remote: ${formatValue(field.remoteValue)}`));
        console.log(chalk.green(`     Merged: ${formatValue(field.chosenValue)}`));
      } else {
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
