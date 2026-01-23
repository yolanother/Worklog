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
 * Check if a value appears to be a default/empty value
 */
function isDefaultValue(value: any, field: string): boolean {
  if (value === null || value === undefined || value === '') {
    return true;
  }
  if (Array.isArray(value) && value.length === 0) {
    return true;
  }
  // For status and priority, 'open' and 'medium' are defaults
  if (field === 'status' && value === 'open') {
    return true;
  }
  if (field === 'priority' && value === 'medium') {
    return true;
  }
  return false;
}

/**
 * Merge two sets of work items with intelligent field-level conflict resolution
 * Strategy: For each field, prefer non-default values, or use the value from the newer version
 * This heuristic allows merging changes from both versions without needing a common ancestor
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
      // Item exists in both - perform intelligent field-level merge
      const localUpdated = new Date(localItem.updatedAt).getTime();
      const remoteUpdated = new Date(remoteItem.updatedAt).getTime();
      
      if (JSON.stringify(localItem) === JSON.stringify(remoteItem)) {
        // Items are identical - no action needed
        return;
      }
      
      if (localUpdated === remoteUpdated) {
        // Same timestamp but different content - keep local version
        conflicts.push(`${remoteItem.id}: Same updatedAt but different content - using local version`);
      } else {
        // Different timestamps - perform field-by-field intelligent merge
        const isRemoteNewer = remoteUpdated > localUpdated;
        const merged: WorkItem = { ...localItem };  // Start with local
        const fields: (keyof WorkItem)[] = ['title', 'description', 'status', 'priority', 'parentId', 'tags', 'assignee', 'stage'];
        
        const mergedFields: string[] = [];
        const conflictedFields: string[] = [];
        
        for (const field of fields) {
          const localValue = localItem[field];
          const remoteValue = remoteItem[field];
          
          // Compare values
          let valuesEqual = false;
          if (Array.isArray(localValue) && Array.isArray(remoteValue)) {
            valuesEqual = JSON.stringify([...localValue].sort()) === JSON.stringify([...remoteValue].sort());
          } else {
            valuesEqual = localValue === remoteValue;
          }
          
          if (!valuesEqual) {
            // Values differ - decide which to use
            const localIsDefault = isDefaultValue(localValue, field);
            const remoteIsDefault = isDefaultValue(remoteValue, field);
            
            if (localIsDefault && !remoteIsDefault) {
              // Remote has a value, local is default - use remote
              (merged as any)[field] = remoteValue;
              mergedFields.push(`${field} (from remote)`);
            } else if (!localIsDefault && remoteIsDefault) {
              // Local has a value, remote is default - keep local
              mergedFields.push(`${field} (from local)`);
            } else {
              // Both have non-default values - use timestamp to decide
              if (isRemoteNewer) {
                (merged as any)[field] = remoteValue;
                conflictedFields.push(field);
              } else {
                // Keep local value
                conflictedFields.push(field);
              }
            }
          }
        }
        
        // Use the most recent updatedAt
        merged.updatedAt = isRemoteNewer ? remoteItem.updatedAt : localItem.updatedAt;
        merged.createdAt = localItem.createdAt; // Preserve original createdAt
        
        // Update the map
        mergedMap.set(remoteItem.id, merged);
        
        // Report results
        if (conflictedFields.length > 0) {
          conflicts.push(
            `${remoteItem.id}: Conflicting fields [${conflictedFields.join(', ')}] resolved using ${isRemoteNewer ? 'remote' : 'local'} values (${isRemoteNewer ? 'remote' : 'local'}: ${isRemoteNewer ? remoteItem.updatedAt : localItem.updatedAt}, ${isRemoteNewer ? 'local' : 'remote'}: ${isRemoteNewer ? localItem.updatedAt : remoteItem.updatedAt})`
          );
        }
        
        if (mergedFields.length > 0) {
          conflicts.push(
            `${remoteItem.id}: Merged fields [${mergedFields.join(', ')}]`
          );
        }
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
 * Fetch remote changes and update the data file without requiring a clean working tree
 * This allows syncing even when there are local uncommitted changes
 */
export async function gitPullDataFile(dataFilePath: string): Promise<void> {
  try {
    // Check if we're in a git repository
    await execAsync('git rev-parse --git-dir');
    
    // Get the current branch name
    const { stdout: branchName } = await execAsync('git rev-parse --abbrev-ref HEAD');
    const branch = branchName.trim();
    
    // Fetch latest changes from remote without merging
    await execAsync(`git fetch origin ${branch}`);
    
    // Get the remote version of the data file using git show
    // This will fail gracefully if the file doesn't exist on remote
    try {
      const { stdout: remoteContent } = await execAsync(
        `git show origin/${branch}:${escapeShellArg(dataFilePath)}`
      );
      
      // Write the remote content to the local file
      // This overwrites any local uncommitted changes, but that's OK because
      // the sync logic will merge local in-memory state with this remote state
      fs.writeFileSync(dataFilePath, remoteContent, 'utf-8');
    } catch (showError) {
      // File might not exist on remote yet - that's OK, treat as empty
      // Check if this is actually a "path not in commit" error
      const errorMessage = (showError as Error).message;
      if (errorMessage.includes('does not exist') || errorMessage.includes('path') || errorMessage.includes('not in')) {
        // File doesn't exist on remote - this is fine for a new repo
        return;
      }
      // Re-throw other errors
      throw showError;
    }
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
