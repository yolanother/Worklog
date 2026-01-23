/**
 * Sync functionality for merging local and remote work items with conflict resolution
 */

import { WorkItem, Comment, ConflictDetail, ConflictFieldDetail } from './types.js';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execAsync = promisify(childProcess.exec);

// git show of large JSONL can exceed Node's exec() maxBuffer.
// Use spawn to stream the output when reading remote content.
async function execGitCaptureStdout(args: string[], options?: { cwd?: string }): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = childProcess.spawn('git', args, {
      cwd: options?.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      err += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(out);
      reject(new Error(err.trim() || `git ${args.join(' ')} failed with code ${code}`));
    });
  });
}

export interface GitTarget {
  remote: string;
  branch: string; // may be a branch name or a full ref (e.g. refs/worklog/data)
}

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
  conflicts: string[]; // Legacy text-based conflicts (for backward compatibility)
  conflictDetails: ConflictDetail[]; // Detailed conflict information
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
  // Treat empty strings as default for these metadata fields
  if ((field === 'issueType' || field === 'createdBy' || field === 'deletedBy' || field === 'deleteReason') && value === '') {
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
): { merged: WorkItem[], conflicts: string[], conflictDetails: ConflictDetail[] } {
  const conflicts: string[] = [];
  const conflictDetails: ConflictDetail[] = [];
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
        const fields: (keyof WorkItem)[] = ['title', 'description', 'status', 'priority', 'parentId', 'tags', 'assignee', 'stage', 'issueType', 'createdBy', 'deletedBy', 'deleteReason'];
        const mergedFields: string[] = [];
        const fieldDetails: ConflictFieldDetail[] = [];

        for (const field of fields) {
          const localValue = localItem[field];
          const remoteValue = remoteItem[field];
          const valuesEqual = stableValueKey(localValue) === stableValueKey(remoteValue);
          if (valuesEqual) continue;

          if (field === 'tags') {
            const mergedTags = mergeTags(localValue as any, remoteValue as any);
            (merged as any)[field] = mergedTags;
            mergedFields.push('tags (union)');
            fieldDetails.push({
              field: 'tags',
              localValue,
              remoteValue,
              chosenValue: mergedTags,
              chosenSource: 'merged',
              reason: 'union of both tag sets'
            });
            continue;
          }

          const localIsDefault = isDefaultValue(localValue, field);
          const remoteIsDefault = isDefaultValue(remoteValue, field);

          if (localIsDefault && !remoteIsDefault) {
            (merged as any)[field] = remoteValue;
            mergedFields.push(`${field} (from remote)`);
            fieldDetails.push({
              field,
              localValue,
              remoteValue,
              chosenValue: remoteValue,
              chosenSource: 'remote',
              reason: 'remote has value, local is default'
            });
          } else if (!localIsDefault && remoteIsDefault) {
            mergedFields.push(`${field} (from local)`);
            fieldDetails.push({
              field,
              localValue,
              remoteValue,
              chosenValue: localValue,
              chosenSource: 'local',
              reason: 'local has value, remote is default'
            });
          } else {
            // Deterministic tie-breaker: choose lexicographically by serialized value.
            const localKey = stableValueKey(localValue);
            const remoteKey = stableValueKey(remoteValue);
            if (remoteKey > localKey) {
              (merged as any)[field] = remoteValue;
              mergedFields.push(`${field} (tie-break: remote)`);
              fieldDetails.push({
                field,
                localValue,
                remoteValue,
                chosenValue: remoteValue,
                chosenSource: 'remote',
                reason: 'deterministic tie-breaker (lexicographic)'
              });
            } else {
              mergedFields.push(`${field} (tie-break: local)`);
              fieldDetails.push({
                field,
                localValue,
                remoteValue,
                chosenValue: localValue,
                chosenSource: 'local',
                reason: 'deterministic tie-breaker (lexicographic)'
              });
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
        
        if (fieldDetails.length > 0) {
          conflictDetails.push({
            itemId: remoteItem.id,
            conflictType: 'same-timestamp',
            fields: fieldDetails,
            localUpdatedAt: localItem.updatedAt,
            remoteUpdatedAt: remoteItem.updatedAt
          });
        }
      } else {
        // Different timestamps - perform field-by-field intelligent merge
        const isRemoteNewer = remoteUpdated > localUpdated;
        const merged: WorkItem = { ...localItem };  // Start with local
        const fields: (keyof WorkItem)[] = ['title', 'description', 'status', 'priority', 'parentId', 'tags', 'assignee', 'stage', 'issueType', 'createdBy', 'deletedBy', 'deleteReason'];
        
        const mergedFields: string[] = [];
        const conflictedFields: string[] = [];
        const fieldDetails: ConflictFieldDetail[] = [];
        
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
              const mergedTags = mergeTags(localValue, remoteValue);
              (merged as any)[field] = mergedTags;
              mergedFields.push('tags (union)');
              fieldDetails.push({
                field: 'tags',
                localValue,
                remoteValue,
                chosenValue: mergedTags,
                chosenSource: 'merged',
                reason: 'union of both tag sets'
              });
              continue;
            }
            
            if (localIsDefault && !remoteIsDefault) {
              // Remote has a value, local is default - use remote
              (merged as any)[field] = remoteValue;
              mergedFields.push(`${field} (from remote)`);
              fieldDetails.push({
                field,
                localValue,
                remoteValue,
                chosenValue: remoteValue,
                chosenSource: 'remote',
                reason: 'remote has value, local is default'
              });
            } else if (!localIsDefault && remoteIsDefault) {
              // Local has a value, remote is default - keep local
              mergedFields.push(`${field} (from local)`);
              fieldDetails.push({
                field,
                localValue,
                remoteValue,
                chosenValue: localValue,
                chosenSource: 'local',
                reason: 'local has value, remote is default'
              });
            } else {
              // Both have non-default values - use timestamp to decide
              if (isRemoteNewer) {
                (merged as any)[field] = remoteValue;
                conflictedFields.push(field);
                fieldDetails.push({
                  field,
                  localValue,
                  remoteValue,
                  chosenValue: remoteValue,
                  chosenSource: 'remote',
                  reason: `remote is newer (${remoteItem.updatedAt})`
                });
              } else {
                // Keep local value
                conflictedFields.push(field);
                fieldDetails.push({
                  field,
                  localValue,
                  remoteValue,
                  chosenValue: localValue,
                  chosenSource: 'local',
                  reason: `local is newer (${localItem.updatedAt})`
                });
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
        
        if (fieldDetails.length > 0) {
          conflictDetails.push({
            itemId: remoteItem.id,
            conflictType: 'different-timestamp',
            fields: fieldDetails,
            localUpdatedAt: localItem.updatedAt,
            remoteUpdatedAt: remoteItem.updatedAt
          });
        }
      }
    }
  });
  
  return {
    merged: Array.from(mergedMap.values()),
    conflicts,
    conflictDetails
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

async function getRepoRoot(): Promise<string> {
  const { stdout } = await execAsync('git rev-parse --show-toplevel');
  return stdout.trim();
}

async function fetchRemote(remote: string): Promise<void> {
  await execAsync(`git fetch ${escapeShellArg(remote)}`);
}

function getRemoteTrackingRef(remote: string, branchOrRef: string): string {
  // For a named branch like "worklog-data", track it as refs/remotes/origin/worklog-data.
  // For an explicit ref like "refs/worklog/data", DO NOT track it under refs/remotes/...
  // because that namespace is reserved for remote-tracking branches and can collide with
  // real branches like "worklog/data" and/or reject non-fast-forward updates.
  //
  // Instead, keep a local-only tracking ref under refs/worklog/remotes/<remote>/...
  if (branchOrRef.startsWith('refs/')) {
    const suffix = branchOrRef.slice('refs/'.length);
    return `refs/worklog/remotes/${remote}/${suffix}`;
  }

  return `refs/remotes/${remote}/${branchOrRef}`;
}

// Exposed for unit tests.
export const _testOnly_getRemoteTrackingRef = getRemoteTrackingRef;

async function refExists(ref: string): Promise<boolean> {
  try {
    await execAsync(`git show-ref --verify --quiet ${escapeShellArg(ref)}`);
    return true;
  } catch {
    return false;
  }
}

async function fetchTargetRef(target: GitTarget): Promise<{ hasRemote: boolean; remoteTrackingRef: string }> {
  const remoteTrackingRef = getRemoteTrackingRef(target.remote, target.branch);

  if (target.branch.startsWith('refs/')) {
    // Default git fetch refspec does not include custom refs/*, so fetch it explicitly.
    // If it doesn't exist yet, treat as "no remote".
    try {
      await execAsync(
        // Force-update the local tracking ref so stale/colliding local refs don't block sync.
        `git fetch ${escapeShellArg(target.remote)} ${escapeShellArg(`+${target.branch}:${remoteTrackingRef}`)}`
      );
    } catch {
      // Avoid silently treating fetch failures as "ref missing"; that can lead to overwriting
      // an existing remote data ref from an orphan branch.
      let remoteExists = false;
      try {
        const { stdout } = await execAsync(
          `git ls-remote --exit-code ${escapeShellArg(target.remote)} ${escapeShellArg(target.branch)}`
        );
        remoteExists = !!stdout.trim();
      } catch {
        remoteExists = false;
      }

      if (remoteExists) {
        throw new Error(`Failed to fetch existing remote ref ${target.branch} from ${target.remote}`);
      }

      return { hasRemote: false, remoteTrackingRef };
    }

    const hasRemote = await refExists(remoteTrackingRef);
    if (!hasRemote) {
      // If the remote ref exists but we can't materialize a local tracking ref,
      // treat it as an error to avoid overwriting the remote from an orphan branch.
      let remoteExists = false;
      try {
        const { stdout } = await execAsync(
          `git ls-remote --exit-code ${escapeShellArg(target.remote)} ${escapeShellArg(target.branch)}`
        );
        remoteExists = !!stdout.trim();
      } catch {
        remoteExists = false;
      }

      if (remoteExists) {
        throw new Error(`Failed to create local tracking ref for ${target.branch} from ${target.remote}`);
      }
    }

    return { hasRemote, remoteTrackingRef };
  }

  // Standard branch fetch. This will populate refs/remotes/<remote>/<branch>.
  await execAsync(`git fetch ${escapeShellArg(target.remote)} ${escapeShellArg(target.branch)}`);
  return { hasRemote: await refExists(remoteTrackingRef), remoteTrackingRef };
}

function getRepoRelativePath(repoRootPath: string, filePath: string): { absolutePath: string; relativePath: string } {
  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(repoRootPath, absolutePath);
  return { absolutePath, relativePath };
}

export async function getRemoteDataFileContent(dataFilePath: string, target: GitTarget): Promise<string | null> {
  // Check if we're in a git repository
  await execAsync('git rev-parse --git-dir');

  const repoRootPath = await getRepoRoot();
  const { relativePath } = getRepoRelativePath(repoRootPath, dataFilePath);

  const { hasRemote, remoteTrackingRef } = await fetchTargetRef(target);
  if (!hasRemote) {
    return null;
  }

  const refAndPath = `${remoteTrackingRef}:${relativePath}`;
  try {
    // Avoid exec() maxBuffer issues for large JSONL.
    return await execGitCaptureStdout(['show', refAndPath]);
  } catch {
    return null;
  }
}

function removeWorktreeFiles(worktreePath: string): void {
  for (const name of fs.readdirSync(worktreePath)) {
    if (name === '.git') continue;
    fs.rmSync(path.join(worktreePath, name), { recursive: true, force: true });
  }
}

async function listTrackedFiles(worktreePath: string): Promise<string[]> {
  const { stdout } = await execAsync(`git -C ${escapeShellArg(worktreePath)} ls-files -z`);
  if (!stdout) return [];
  return stdout.split('\0').map(s => s.trim()).filter(Boolean);
}

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

async function withTempWorktree<T>(
  repoRootPath: string,
  target: GitTarget,
  run: (worktreePath: string) => Promise<T>
): Promise<T> {
  const worklogDir = path.join(repoRootPath, '.worklog');
  ensureDir(worklogDir);

  const tmpRoot = fs.mkdtempSync(path.join(worklogDir, 'tmp-worktree-'));
  const worktreePath = path.join(tmpRoot, 'wt');

  const { hasRemote, remoteTrackingRef } = await fetchTargetRef(target);
  const baseRef = hasRemote ? remoteTrackingRef : 'HEAD';

  try {
    await execAsync(`git worktree add --detach ${escapeShellArg(worktreePath)} ${escapeShellArg(baseRef)}`);

    // If remote branch doesn't exist, create an orphan branch in the temp worktree.
    if (!hasRemote) {
      // Create an orphan local branch name; it doesn't need to include refs/.
      const localBranchName = target.branch.startsWith('refs/') ? target.branch.slice('refs/'.length) : target.branch;
      await execAsync(`git -C ${escapeShellArg(worktreePath)} checkout --orphan ${escapeShellArg(localBranchName)}`);
      // `checkout --orphan` keeps the index populated with the previously checked-out files.
      // Clear the index + working tree so the branch starts empty.
      try {
        await execAsync(`git -C ${escapeShellArg(worktreePath)} rm -rf .`);
      } catch {
        // ignore
      }
      removeWorktreeFiles(worktreePath);
      try {
        await execAsync(`git -C ${escapeShellArg(worktreePath)} clean -fdx`);
      } catch {
        // ignore
      }
    }

    return await run(worktreePath);
  } finally {
    try {
      await execAsync(`git worktree remove --force ${escapeShellArg(worktreePath)}`);
    } catch {
      // ignore
    }
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
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
    const repoRootPath = await getRepoRoot();
    const { absolutePath, relativePath } = getRepoRelativePath(repoRootPath, dataFilePath);
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
    
    // Push to remote on the current branch
    const { stdout: branchName } = await execAsync('git rev-parse --abbrev-ref HEAD');
    const branch = branchName.trim();
    await execAsync(`git push origin ${escapeShellArg(branch)}`);
  } catch (error) {
    throw new Error(`Failed to push to git: ${(error as Error).message}`);
  }
}

export async function gitPushDataFileToBranch(
  repoDataFilePath: string,
  commitMessage: string,
  target: GitTarget
): Promise<void> {
  // This pushes ONLY the data file by committing it on a dedicated branch
  // in a temporary worktree based on the remote branch tip.
  await execAsync('git rev-parse --git-dir');

  const repoRootPath = await getRepoRoot();
  const { relativePath } = getRepoRelativePath(repoRootPath, repoDataFilePath);
  const srcAbsPath = path.resolve(repoDataFilePath);

  if (!fs.existsSync(srcAbsPath)) {
    return;
  }

  await withTempWorktree(repoRootPath, target, async (worktreePath) => {
    // Ensure the dedicated data branch contains ONLY the JSONL file.
    // If it was previously polluted with other repo files, we remove them here.
    try {
      const tracked = await listTrackedFiles(worktreePath);
      const others = tracked.filter(p => p !== relativePath);
      if (others.length > 0) {
        for (const p of others) {
          await execAsync(`git -C ${escapeShellArg(worktreePath)} rm -r -- ${escapeShellArg(p)}`);
        }
        await execAsync(`git -C ${escapeShellArg(worktreePath)} clean -fdx`);
      }
    } catch {
      // ignore; we'll still proceed to commit the JSONL file
    }

    const dstAbsPath = path.join(worktreePath, relativePath);
    ensureDir(path.dirname(dstAbsPath));
    fs.copyFileSync(srcAbsPath, dstAbsPath);

    const escapedMsg = escapeShellArg(commitMessage);
    const escapedRel = escapeShellArg(relativePath);

    // Stage and commit only the JSONL file.
    // The data file typically lives under `.worklog/`, which is commonly gitignored in the main repo.
    // Force-add so this dedicated ref can still track it.
    await execAsync(`git -C ${escapeShellArg(worktreePath)} add -f -- ${escapedRel}`);
    const { stdout: staged } = await execAsync(
      `git -C ${escapeShellArg(worktreePath)} diff --cached --name-only -- ${escapedRel}`
    );
    if (!staged.trim()) {
      return;
    }

    await execAsync(`git -C ${escapeShellArg(worktreePath)} commit -m ${escapedMsg}`);

    // Push only this commit to the dedicated ref.
    const pushTarget = target.branch.startsWith('refs/') ? target.branch : `refs/heads/${target.branch}`;
    await execAsync(
      `git -C ${escapeShellArg(worktreePath)} push ${escapeShellArg(target.remote)} HEAD:${escapeShellArg(pushTarget)}`
    );
  });
}

/**
 * Check if a file exists
 */
export function fileExists(filepath: string): boolean {
  return fs.existsSync(filepath);
}
