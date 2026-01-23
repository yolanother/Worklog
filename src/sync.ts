/**
 * Sync functionality for merging local and remote work items with conflict resolution
 */

import { WorkItem, Comment } from './types.js';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
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

function stableValueKey(value: unknown): string {
  if (value === undefined) return 'u';
  if (value === null) return 'n';
  if (Array.isArray(value)) {
    return `a:${JSON.stringify([...value].map(v => String(v)).sort())}`;
  }
  return `v:${JSON.stringify(value)}`;
}

function stableItemKey(item: WorkItem): string {
  // Keep this stable across instances even if property insertion order differs.
  // Tags are compared as a set.
  const normalized: WorkItem = {
    ...item,
    tags: [...(item.tags || [])].slice().sort(),
  };
  const keys = Object.keys(normalized).sort();
  return JSON.stringify(normalized, keys);
}

function mergeTags(a: string[] | undefined, b: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const t of a || []) out.add(t);
  for (const t of b || []) out.add(t);
  return Array.from(out).sort();
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

      if (stableItemKey(localItem) === stableItemKey(remoteItem)) {
        // Items are identical - no action needed
        return;
      }
      
      if (localUpdated === remoteUpdated) {
        // Same timestamp but different content - merge deterministically and bump updatedAt.
        // This avoids "permanent divergence" across instances where the record differs but
        // timestamps prevent a clear winner.
        const merged: WorkItem = { ...localItem };
        const fields: (keyof WorkItem)[] = ['title', 'description', 'status', 'priority', 'parentId', 'tags', 'assignee', 'stage'];
        const mergedFields: string[] = [];

        for (const field of fields) {
          const localValue = localItem[field];
          const remoteValue = remoteItem[field];
          const valuesEqual = stableValueKey(localValue) === stableValueKey(remoteValue);
          if (valuesEqual) continue;

          if (field === 'tags') {
            (merged as any)[field] = mergeTags(localValue as any, remoteValue as any);
            mergedFields.push('tags (union)');
            continue;
          }

          const localIsDefault = isDefaultValue(localValue, field);
          const remoteIsDefault = isDefaultValue(remoteValue, field);

          if (localIsDefault && !remoteIsDefault) {
            (merged as any)[field] = remoteValue;
            mergedFields.push(`${field} (from remote)`);
          } else if (!localIsDefault && remoteIsDefault) {
            mergedFields.push(`${field} (from local)`);
          } else {
            // Deterministic tie-breaker: choose lexicographically by serialized value.
            const localKey = stableValueKey(localValue);
            const remoteKey = stableValueKey(remoteValue);
            if (remoteKey > localKey) {
              (merged as any)[field] = remoteValue;
              mergedFields.push(`${field} (tie-break: remote)`);
            } else {
              mergedFields.push(`${field} (tie-break: local)`);
            }
          }
        }

        // Bump updatedAt so next sync has an unambiguous winner.
        merged.updatedAt = new Date().toISOString();
        merged.createdAt = localItem.createdAt;
        mergedMap.set(remoteItem.id, merged);

        conflicts.push(`${remoteItem.id}: Same updatedAt but different content - merged deterministically and bumped updatedAt`);
        if (mergedFields.length > 0) {
          conflicts.push(`${remoteItem.id}: Merged fields [${mergedFields.join(', ')}]`);
        }
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

            if (field === 'tags' && Array.isArray(localValue) && Array.isArray(remoteValue)) {
              (merged as any)[field] = mergeTags(localValue, remoteValue);
              mergedFields.push('tags (union)');
              continue;
            }
            
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
    
    // Get the repository root directory
    const { stdout: repoRoot } = await execAsync('git rev-parse --show-toplevel');
    const repoRootPath = repoRoot.trim();
    
    // Convert data file path to repository-relative path for git show
    // git show requires a path relative to the repository root, not an absolute path
    // path.resolve ensures we have an absolute path even if dataFilePath is relative
    const absolutePath = path.resolve(dataFilePath);
    const relativePath = path.relative(repoRootPath, absolutePath);
    
    // Get the current branch name
    const { stdout: branchName } = await execAsync('git rev-parse --abbrev-ref HEAD');
    const branch = branchName.trim();
    
    // Fetch latest changes from remote without merging
    await execAsync(`git fetch origin ${escapeShellArg(branch)}`);
    
    // Check if the remote ref exists
    try {
      await execAsync(`git rev-parse --verify origin/${escapeShellArg(branch)}`);
    } catch (verifyError) {
      // Remote branch doesn't exist yet - this is OK for a new repo
      return;
    }
    
    // Get the remote version of the data file using git show
    // This will fail if the file doesn't exist on remote
    try {
      // Note: git show uses the syntax "ref:path" where the path is relative to the repo root
      // We escape the entire "ref:path" as a single unit to protect against special characters
      // in both the branch name and file path. Git correctly parses the ref:path even when quoted.
      const refAndPath = `origin/${branch}:${relativePath}`;
      const { stdout: remoteContent } = await execAsync(
        `git show ${escapeShellArg(refAndPath)}`
      );
      
      // Write the remote content to the local file (using the absolute path)
      // This overwrites any local uncommitted changes, but that's OK because
      // the sync logic will merge local in-memory state with this remote state
      fs.writeFileSync(absolutePath, remoteContent, 'utf8');
    } catch (showError) {
      // File doesn't exist on remote yet - that's OK, treat as empty
      // This is expected for a new file that hasn't been pushed to remote
      return;
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

    // Get repository root and compute repo-relative path (more reliable for pathspec)
    const { stdout: repoRoot } = await execAsync('git rev-parse --show-toplevel');
    const repoRootPath = repoRoot.trim();
    const absolutePath = path.resolve(dataFilePath);
    const relativePath = path.relative(repoRootPath, absolutePath);
    const escapedRelativePath = escapeShellArg(relativePath);
    
    // Determine if file is already tracked. If it's ignored + untracked, git status won't show it,
    // so we still need to force-add it for sync to work across instances.
    let isTracked = true;
    try {
      await execAsync(`git ls-files --error-unmatch -- ${escapedRelativePath}`);
    } catch {
      isTracked = false;
    }

    if (isTracked) {
      const { stdout: statusOutput } = await execAsync(`git status --porcelain -- ${escapedRelativePath}`);
      if (!statusOutput.trim()) {
        return;
      }
      await execAsync(`git add -- ${escapedRelativePath}`);
    } else {
      if (!fs.existsSync(absolutePath)) {
        return;
      }
      await execAsync(`git add -f -- ${escapedRelativePath}`);
      const { stdout: staged } = await execAsync(`git diff --cached --name-only -- ${escapedRelativePath}`);
      if (!staged.trim()) {
        return;
      }
    }
    
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
