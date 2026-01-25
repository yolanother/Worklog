/**
 * JSONL (JSON Lines) import/export functionality
 * This format is Git-friendly as each work item is on a separate line
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorkItem, Comment } from './types.js';
import { stripWorklogMarkers } from './github.js';
import { resolveWorklogDir } from './worklog-paths.js';

function normalizeForStableJson(value: any): any {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(v => normalizeForStableJson(v));
  if (typeof value !== 'object') return value;

  const out: any = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = normalizeForStableJson(value[key]);
  }
  return out;
}

function stableStringify(value: any): string {
  return JSON.stringify(normalizeForStableJson(value));
}

interface JsonlRecord {
  type: 'workitem' | 'comment';
  data: WorkItem | Comment;
}

/**
 * Export work items and comments to a JSONL file
 */
export function exportToJsonl(items: WorkItem[], comments: Comment[], filepath: string): void {
  const lines: string[] = [];

  const sortedItems = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const sortedComments = [...comments].sort((a, b) => {
    const wi = a.workItemId.localeCompare(b.workItemId);
    if (wi !== 0) return wi;
    const ca = a.createdAt.localeCompare(b.createdAt);
    if (ca !== 0) return ca;
    return a.id.localeCompare(b.id);
  });
  
  // Add work items
  sortedItems.forEach(item => {
    lines.push(stableStringify({ type: 'workitem', data: item }));
  });
  
  // Add comments
  sortedComments.forEach(comment => {
    lines.push(stableStringify({ type: 'comment', data: comment }));
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
  return importFromJsonlContent(content);
}

export function importFromJsonlContent(content: string): { items: WorkItem[], comments: Comment[] } {
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
        if ((item as any).issueType === undefined) {
          (item as any).issueType = '';
        }
        if ((item as any).createdBy === undefined) {
          (item as any).createdBy = '';
        }
        if ((item as any).deletedBy === undefined) {
          (item as any).deletedBy = '';
        }
        if ((item as any).deleteReason === undefined) {
          (item as any).deleteReason = '';
        }
        if ((item as any).risk === undefined) {
          (item as any).risk = '';
        }
        if ((item as any).effort === undefined) {
          (item as any).effort = '';
        }
        if ((item as any).githubIssueNumber === undefined) {
          (item as any).githubIssueNumber = undefined;
        }
        if ((item as any).githubIssueId === undefined) {
          (item as any).githubIssueId = undefined;
        }
        if ((item as any).githubIssueUpdatedAt === undefined) {
          (item as any).githubIssueUpdatedAt = undefined;
        }
        if ((item as any).githubIssueNumber !== undefined && (item as any).githubIssueNumber !== null) {
          (item as any).githubIssueNumber = Number((item as any).githubIssueNumber);
        }
        if ((item as any).githubIssueId !== undefined && (item as any).githubIssueId !== null) {
          (item as any).githubIssueId = Number((item as any).githubIssueId);
        }
        if (item.description) {
          item.description = stripWorklogMarkers(item.description);
        }
        items.push(item);
      } else if (parsed.type === 'comment' && parsed.data) {
        const comment = parsed.data as Comment;
        if (comment.comment) {
          comment.comment = stripWorklogMarkers(comment.comment);
        }
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
        if ((item as any).issueType === undefined) {
          (item as any).issueType = '';
        }
        if ((item as any).createdBy === undefined) {
          (item as any).createdBy = '';
        }
        if ((item as any).deletedBy === undefined) {
          (item as any).deletedBy = '';
        }
        if ((item as any).deleteReason === undefined) {
          (item as any).deleteReason = '';
        }
        if ((item as any).risk === undefined) {
          (item as any).risk = '';
        }
        if ((item as any).effort === undefined) {
          (item as any).effort = '';
        }
        if ((item as any).githubIssueNumber === undefined) {
          (item as any).githubIssueNumber = undefined;
        }
        if ((item as any).githubIssueId === undefined) {
          (item as any).githubIssueId = undefined;
        }
        if ((item as any).githubIssueUpdatedAt === undefined) {
          (item as any).githubIssueUpdatedAt = undefined;
        }
        if ((item as any).githubIssueNumber !== undefined && (item as any).githubIssueNumber !== null) {
          (item as any).githubIssueNumber = Number((item as any).githubIssueNumber);
        }
        if ((item as any).githubIssueId !== undefined && (item as any).githubIssueId !== null) {
          (item as any).githubIssueId = Number((item as any).githubIssueId);
        }
        if (item.description) {
          item.description = stripWorklogMarkers(item.description);
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
  return path.join(resolveWorklogDir(), 'worklog-data.jsonl');
}
