/**
 * Sync functionality for merging local and remote work items with conflict resolution
 */

import { WorkItem, Comment } from './types.js';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import { promisify } from 'util';

const execAsync = promisify(childProcess.exec);

/**
 * Escape a string for safe use in shell commands
 */
function escapeShellArg(arg: string): string {
  // Use single quotes and escape any single quotes within the string
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  itemsAdded: number;
  itemsUpdated: number;
  itemsUnchanged: number;
  commentsAdded: number;
  commentsUnchanged: number;
  conflicts: string[];
}

/**
 * Merge two sets of work items, resolving conflicts by updatedAt timestamp
 * More recent updates take precedence
 */
export function mergeWorkItems(
  localItems: WorkItem[],
  remoteItems: WorkItem[]
): { merged: WorkItem[], conflicts: string[] } {
  const conflicts: string[] = [];
  const mergedMap = new Map<string, WorkItem>();
  
  // Add all local items to the map
  localItems.forEach(item => {
    mergedMap.set(item.id, item);
  });
  
  // Merge remote items
  remoteItems.forEach(remoteItem => {
    const localItem = mergedMap.get(remoteItem.id);
    
    if (!localItem) {
      // New item from remote - add it
      mergedMap.set(remoteItem.id, remoteItem);
    } else {
      // Item exists in both - check for conflicts
      const localUpdated = new Date(localItem.updatedAt).getTime();
      const remoteUpdated = new Date(remoteItem.updatedAt).getTime();
      
      if (localUpdated === remoteUpdated) {
        // Same timestamp - check if data is actually different
        if (JSON.stringify(localItem) !== JSON.stringify(remoteItem)) {
          conflicts.push(`${remoteItem.id}: Same updatedAt but different content`);
        }
        // Keep local version
      } else if (remoteUpdated > localUpdated) {
        // Remote is newer - use remote version
        mergedMap.set(remoteItem.id, remoteItem);
        conflicts.push(`${remoteItem.id}: Remote version is newer (remote: ${remoteItem.updatedAt}, local: ${localItem.updatedAt})`);
      } else {
        // Local is newer - keep local version
        conflicts.push(`${remoteItem.id}: Local version is newer (local: ${localItem.updatedAt}, remote: ${remoteItem.updatedAt})`);
      }
    }
  });
  
  return {
    merged: Array.from(mergedMap.values()),
    conflicts
  };
}

/**
 * Merge two sets of comments
 * Comments are immutable after creation (except explicit updates), so we use createdAt + id for deduplication
 */
export function mergeComments(
  localComments: Comment[],
  remoteComments: Comment[]
): { merged: Comment[], conflicts: string[] } {
  const mergedMap = new Map<string, Comment>();
  
  // Add all local comments to the map
  localComments.forEach(comment => {
    mergedMap.set(comment.id, comment);
  });
  
  // Add remote comments (deduplicate by id)
  remoteComments.forEach(remoteComment => {
    if (!mergedMap.has(remoteComment.id)) {
      mergedMap.set(remoteComment.id, remoteComment);
    }
  });
  
  return {
    merged: Array.from(mergedMap.values()),
    conflicts: [] // Comments don't have conflicts in this simple model
  };
}

/**
 * Execute git pull to get latest changes to the data file
 */
export async function gitPullDataFile(dataFilePath: string): Promise<void> {
  try {
    // Check if we're in a git repository
    await execAsync('git rev-parse --git-dir');
    
    // Get the current branch name
    const { stdout: branchName } = await execAsync('git rev-parse --abbrev-ref HEAD');
    const branch = branchName.trim();
    
    // Pull only the data file from the current branch
    await execAsync(`git pull origin ${branch}`);
  } catch (error) {
    throw new Error(`Failed to pull from git: ${(error as Error).message}`);
  }
}

/**
 * Execute git add, commit, and push for the data file
 */
export async function gitPushDataFile(dataFilePath: string, commitMessage: string): Promise<void> {
  try {
    // Check if we're in a git repository
    await execAsync('git rev-parse --git-dir');
    
    // Escape the file path for safe shell usage
    const escapedFilePath = escapeShellArg(dataFilePath);
    
    // Check if there are changes to commit
    const { stdout: statusOutput } = await execAsync(`git status --porcelain ${escapedFilePath}`);
    
    if (!statusOutput.trim()) {
      // No changes to commit
      return;
    }
    
    // Add the file
    await execAsync(`git add ${escapedFilePath}`);
    
    // Commit the changes with escaped message
    const escapedMessage = escapeShellArg(commitMessage);
    await execAsync(`git commit -m ${escapedMessage}`);
    
    // Get the current branch name
    const { stdout: branchName } = await execAsync('git rev-parse --abbrev-ref HEAD');
    const branch = branchName.trim();
    
    // Push to remote on the current branch
    await execAsync(`git push origin ${escapeShellArg(branch)}`);
  } catch (error) {
    throw new Error(`Failed to push to git: ${(error as Error).message}`);
  }
}

/**
 * Check if a file exists
 */
export function fileExists(filepath: string): boolean {
  return fs.existsSync(filepath);
}
