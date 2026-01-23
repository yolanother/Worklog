/**
 * JSONL (JSON Lines) import/export functionality
 * This format is Git-friendly as each work item is on a separate line
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorkItem, Comment } from './types.js';

interface JsonlRecord {
  type: 'workitem' | 'comment';
  data: WorkItem | Comment;
}

/**
 * Export work items and comments to a JSONL file
 */
export function exportToJsonl(items: WorkItem[], comments: Comment[], filepath: string): void {
  const lines: string[] = [];
  
  // Add work items
  items.forEach(item => {
    lines.push(JSON.stringify({ type: 'workitem', data: item }));
  });
  
  // Add comments
  comments.forEach(comment => {
    lines.push(JSON.stringify({ type: 'comment', data: comment }));
  });
  
  // Ensure directory exists
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(filepath, lines.join('\n') + '\n', 'utf-8');
}

/**
 * Import work items and comments from a JSONL file
 */
export function importFromJsonl(filepath: string): { items: WorkItem[], comments: Comment[] } {
  if (!fs.existsSync(filepath)) {
    throw new Error(`File not found: ${filepath}`);
  }

  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim() !== '');
  
  const items: WorkItem[] = [];
  const comments: Comment[] = [];
  
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      
      // Handle new format with type field
      if (parsed.type === 'workitem' && parsed.data) {
        const item = parsed.data as WorkItem;
        // Ensure backward compatibility
        if (item.assignee === undefined) {
          item.assignee = '';
        }
        if (item.stage === undefined) {
          item.stage = '';
        }
        items.push(item);
      } else if (parsed.type === 'comment' && parsed.data) {
        const comment = parsed.data as Comment;
        comments.push(comment);
      } else {
        // Handle old format (no type field) - assume it's a work item
        console.warn(`Warning: Found entry without type field, assuming it's a work item. Consider migrating to the new format.`);
        const item = parsed as WorkItem;
        if (item.assignee === undefined) {
          item.assignee = '';
        }
        if (item.stage === undefined) {
          item.stage = '';
        }
        items.push(item);
      }
    } catch (error) {
      console.error(`Error parsing line: ${line}`);
      throw error;
    }
  }
  
  return { items, comments };
}

/**
 * Get the default data file path
 */
export function getDefaultDataPath(): string {
  return path.join(process.cwd(), '.worklog', 'worklog-data.jsonl');
}
