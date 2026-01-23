/**
 * JSONL (JSON Lines) import/export functionality
 * This format is Git-friendly as each work item is on a separate line
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorkItem } from './types.js';

/**
 * Export work items to a JSONL file
 */
export function exportToJsonl(items: WorkItem[], filepath: string): void {
  const lines = items.map(item => JSON.stringify(item)).join('\n');
  
  // Ensure directory exists
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(filepath, lines + '\n', 'utf-8');
}

/**
 * Import work items from a JSONL file
 */
export function importFromJsonl(filepath: string): WorkItem[] {
  if (!fs.existsSync(filepath)) {
    throw new Error(`File not found: ${filepath}`);
  }

  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim() !== '');
  
  const items: WorkItem[] = [];
  for (const line of lines) {
    try {
      const item = JSON.parse(line) as WorkItem;
      // Ensure backward compatibility with old data that doesn't have assignee/stage
      if (item.assignee === undefined) {
        item.assignee = '';
      }
      if (item.stage === undefined) {
        item.stage = '';
      }
      items.push(item);
    } catch (error) {
      console.error(`Error parsing line: ${line}`);
      throw error;
    }
  }
  
  return items;
}

/**
 * Get the default data file path
 */
export function getDefaultDataPath(): string {
  return path.join(process.cwd(), 'worklog-data.jsonl');
}
