#!/usr/bin/env node
/**
 * Command-line interface for the Worklog system
 */

import { Command } from 'commander';
import { WorklogDatabase } from './database.js';
import { importFromJsonl, importFromJsonlContent, exportToJsonl, getDefaultDataPath } from './jsonl.js';
import { WorkItemStatus, WorkItemPriority, UpdateWorkItemInput, WorkItemQuery, UpdateCommentInput, WorkItem, Comment, NextWorkItemResult } from './types.js';
import type {
  InitOptions, StatusOptions, CreateOptions, ListOptions, ShowOptions, UpdateOptions,
  ExportOptions, ImportOptions, NextOptions, InProgressOptions, SyncOptions,
  CommentCreateOptions, CommentListOptions, CommentShowOptions, CommentUpdateOptions, CommentDeleteOptions,
  RecentOptions, CloseOptions, DeleteOptions
} from './cli-types.js';
import { initConfig, loadConfig, getDefaultPrefix, configExists, isInitialized, readInitSemaphore, writeInitSemaphore } from './config.js';
import { getRemoteDataFileContent, gitPushDataFileToBranch, mergeWorkItems, mergeComments, SyncResult, GitTarget } from './sync.js';
import { DEFAULT_GIT_REMOTE, DEFAULT_GIT_BRANCH } from './sync-defaults.js';
import { getRepoFromGitRemote, normalizeGithubLabelPrefix } from './github.js';
import { upsertIssuesFromWorkItems, importIssuesToWorkItems, GithubProgress } from './github-sync.js';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';

// (removed generic CLIOptions escape-hatch to enforce per-command option typing)

const WORKLOG_VERSION = '0.0.1';

const program = new Command();

// Help formatting is configured just before parsing so groups reflect registered commands

// Output formatting helpers
function outputJson(data: any) {
  console.log(JSON.stringify(data, null, 2));
}

function outputSuccess(message: string, jsonData?: any) {
  const isJsonMode = program.opts().json;
  if (isJsonMode) {
    outputJson(jsonData || { success: true, message });
  } else {
    console.log(message);
  }
}

function outputError(message: string, jsonData?: any) {
  const isJsonMode = program.opts().json;
  if (isJsonMode) {
    console.error(JSON.stringify(jsonData || { success: false, error: message }, null, 2));
  } else {
    console.error(message);
  }
}

// Helper to format a value for display
function formatValue(value: any): string {
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

// Priority ordering for sorting work items (higher number = higher priority)
const PRIORITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 } as const;
const DEFAULT_PRIORITY = PRIORITY_ORDER.medium; // Fallback for unknown priorities

// Helper function to sort items by priority and creation date
function sortByPriorityAndDate(a: WorkItem, b: WorkItem): number {
  // Higher priority comes first (descending order)
  const aPriority = PRIORITY_ORDER[a.priority] ?? DEFAULT_PRIORITY;
  const bPriority = PRIORITY_ORDER[b.priority] ?? DEFAULT_PRIORITY;
  const priorityDiff = bPriority - aPriority;
  if (priorityDiff !== 0) return priorityDiff;
  // If priorities are equal, sort by creation time (oldest first, ascending order)
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

// Helper to display work items in a tree structure
function displayItemTree(items: WorkItem[]): void {
  // Create a set of item IDs for O(1) lookup
  const itemIds = new Set(items.map(i => i.id));
  
  // Display root items (those without parents or whose parents are not in the filtered list)
  const rootItems = items.filter(item => {
    if (item.parentId === null) return true;
    // If parent is not in the filtered list, treat as root
    return !itemIds.has(item.parentId);
  });
  
  // Sort by priority and creation date
  rootItems.sort(sortByPriorityAndDate);
  
  rootItems.forEach((item, index) => {
    const isLastItem = index === rootItems.length - 1;
    displayItemNode(item, items, '', isLastItem);
  });
}

function displayItemNode(item: WorkItem, allItems: WorkItem[], indent: string = '', isLast: boolean = true): void {
  // Display the current item
  const prefix = indent + (isLast ? '└── ' : '├── ');
  // Show ID in gray immediately after the title, separated by a hyphen
  console.log(formatTitleAndId(item, prefix));
  
  const detailIndent = indent + (isLast ? '    ' : '│   ');
  console.log(`${detailIndent}Status: ${item.status} | Priority: ${item.priority}`);
  if (item.assignee) console.log(`${detailIndent}Assignee: ${item.assignee}`);
  if (item.tags.length > 0) console.log(`${detailIndent}Tags: ${item.tags.join(', ')}`);
  
  // Find and display children
  const children = allItems.filter(i => i.parentId === item.id);
  if (children.length > 0) {
    // Sort children by priority and creation date
    children.sort(sortByPriorityAndDate);
    
    children.forEach((child, childIndex) => {
      const isLastChild = childIndex === children.length - 1;
      displayItemNode(child, allItems, detailIndent, isLastChild);
    });
  }
}

// Format title and id with consistent coloring used in tree/list outputs
function formatTitleAndId(item: WorkItem, prefix: string = ''): string {
  // Removed hyphen to keep title/id visually clean
  // Include a hyphen between title and id for clearer machine-human readability
  return `${prefix}${chalk.greenBright(item.title)} ${chalk.gray('-')} ${chalk.gray(item.id)}`;
}

// Format only the title (consistent color)
function formatTitleOnly(item: WorkItem): string {
  return chalk.greenBright(item.title);
}

// Standard human formatter: supports 'concise' | 'normal' | 'full' | 'raw'
function humanFormatWorkItem(item: WorkItem, db: WorklogDatabase | null, format: string | undefined): string {
  const fmt = (format || loadConfig()?.humanDisplay || 'concise').toLowerCase();

  // Helper for common fields
  const lines: string[] = [];
  const titleLine = `Title: ${formatTitleOnly(item)}`;
  const idLine = `ID:    ${chalk.gray(item.id)}`;

  if (fmt === 'raw') {
    return JSON.stringify(item, null, 2);
  }

  if (fmt === 'concise') {
    return `${formatTitleOnly(item)} ${chalk.gray(item.id)}`;
  }

  // normal or full
  lines.push(idLine);
  lines.push(titleLine);
  lines.push(`Status: ${item.status} | Priority: ${item.priority}`);
  if (item.assignee) lines.push(`Assignee: ${item.assignee}`);
  if (item.parentId) lines.push(`Parent: ${item.parentId}`);
  if (item.description) lines.push(`Description: ${item.description}`);

  if (fmt === 'full') {
    // include tags, stage, and comments
    if (item.tags && item.tags.length > 0) lines.push(`Tags: ${item.tags.join(', ')}`);
    if (item.stage) lines.push(`Stage: ${item.stage}`);
    // append comments if db is provided
    if (db) {
      const comments = db.getCommentsForWorkItem(item.id);
      if (comments.length > 0) {
        lines.push('Comments:');
        for (const c of comments) {
          lines.push(`  [${c.id}] ${c.author} at ${c.createdAt}`);
          lines.push(`    ${c.comment}`);
        }
      }
    }
    // include any other fields present on the item not covered above
    const extra: any = {};
    for (const k of Object.keys(item) as Array<keyof WorkItem>) {
      if (!['id','title','description','status','priority','parentId','tags','assignee','stage','createdAt','updatedAt','issueType','createdBy','deletedBy','deleteReason'].includes(k as string)) {
        extra[k] = (item as any)[k];
      }
    }
    if (Object.keys(extra).length > 0) lines.push(`Other: ${JSON.stringify(extra)}`);
  }

  return lines.join('\n');
}

// Resolve final format choice: CLI override > provided > config > default
function resolveFormat(provided?: string): string {
  const cliFormat = program.opts().format;
  if (cliFormat && typeof cliFormat === 'string' && cliFormat.trim() !== '') return cliFormat;
  if (provided && provided.trim() !== '') return provided;
  return loadConfig()?.humanDisplay || 'concise';
}

// Human formatter for comments
function humanFormatComment(comment: Comment, format?: string): string {
  const fmt = (format || loadConfig()?.humanDisplay || 'concise').toLowerCase();
  if (fmt === 'raw') return JSON.stringify(comment, null, 2);
  if (fmt === 'concise') {
    const excerpt = comment.comment.split('\n')[0];
    return `${chalk.gray('[' + comment.id + ']')} ${comment.author} - ${excerpt}`;
  }

  // normal or full
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
  // For 'full' we show verbose fields above; reserve raw JSON for the explicit 'raw' format
  return lines.join('\n');
}

// Display detailed conflict information with color coding
function displayConflictDetails(result: SyncResult, mergedItems: WorkItem[]): void {
  if (result.conflictDetails.length === 0) {
    console.log('\n' + chalk.green('✓ No conflicts detected'));
    return;
  }

  console.log('\n' + chalk.bold('Conflict Resolution Details:'));
  console.log(chalk.gray('━'.repeat(80)));
  
  // Create a map for O(1) lookups of work items by ID
  const itemsById = new Map(mergedItems.map(item => [item.id, item]));
  
  result.conflictDetails.forEach((conflict, index) => {
    // Find the work item in the merged items to get the title
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
    
    conflict.fields.forEach(field => {
      console.log(chalk.bold(`   Field: ${field.field}`));
      
      // For merged values (like tags union), both contribute to the result
      if (field.chosenSource === 'merged') {
        console.log(chalk.cyan(`     Local:  ${formatValue(field.localValue)}`));
        console.log(chalk.cyan(`     Remote: ${formatValue(field.remoteValue)}`));
        console.log(chalk.green(`     Merged: ${formatValue(field.chosenValue)}`));
      } else {
        // Show chosen value in green, lost value in red
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

// Get prefix from config or use default
function getPrefix(overridePrefix?: string): string {
  if (overridePrefix) {
    return overridePrefix.toUpperCase();
  }
  return getDefaultPrefix();
}

// Default sync configuration
const WORKLOG_PRE_PUSH_HOOK_MARKER = 'worklog:pre-push-hook:v1';
const WORKLOG_GITIGNORE_MARKER = 'worklog:gitignore:v1';

const WORKLOG_GITIGNORE_ENTRIES: string[] = [
  `# ${WORKLOG_GITIGNORE_MARKER}`,
  '.worklog/config.yaml',
  '.worklog/initialized',
  '.worklog/worklog.db',
  '.worklog/worklog.db-shm',
  '.worklog/worklog.db-wal',
  '.worklog/worklog-data.jsonl',
  '.worklog/tmp-worktree-*',
];

function resolveGithubConfig(options: { repo?: string; labelPrefix?: string }) {
  const config = loadConfig();
  const repo = options.repo || config?.githubRepo || getRepoFromGitRemote();
  if (!repo) {
    throw new Error('GitHub repo not configured. Set githubRepo in config or use --repo.');
  }
  const labelPrefix = normalizeGithubLabelPrefix(options.labelPrefix || config?.githubLabelPrefix);
  return { repo, labelPrefix };
}

function resolveGithubImportCreateNew(options: { createNew?: boolean }): boolean {
  if (typeof options.createNew === 'boolean') {
    return options.createNew;
  }
  const config = loadConfig();
  return config?.githubImportCreateNew !== false;
}

const AUTO_SYNC_DEBOUNCE_MS = 500;
let autoSyncTimer: NodeJS.Timeout | null = null;
let autoSyncInFlight = false;
let autoSyncPending = false;

function fileHasLine(content: string, line: string): boolean {
  const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|\\n)${escaped}(\\n|$)`);
  return re.test(content);
}

function ensureGitignore(options: { silent: boolean }): { updated: boolean; present: boolean; gitignorePath?: string; added?: string[]; reason?: string } {
  let gitignorePath = path.join(process.cwd(), '.gitignore');

  try {
    const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (repoRoot) {
      gitignorePath = path.join(repoRoot, '.gitignore');
    }
  } catch {
    // Not a git repo; still allow writing .gitignore in the current directory.
  }

  let existing = '';
  try {
    if (fs.existsSync(gitignorePath)) {
      existing = fs.readFileSync(gitignorePath, 'utf-8');
    }
  } catch (e) {
    return { updated: false, present: false, gitignorePath, reason: (e as Error).message };
  }

  const missing: string[] = [];
  for (const line of WORKLOG_GITIGNORE_ENTRIES) {
    if (!fileHasLine(existing, line)) {
      missing.push(line);
    }
  }

  if (missing.length === 0) {
    return { updated: false, present: fs.existsSync(gitignorePath), gitignorePath };
  }

  let out = existing;
  if (out.length > 0 && !out.endsWith('\n')) {
    out += '\n';
  }
  if (out.length > 0 && !out.endsWith('\n\n')) {
    out += '\n';
  }
  out += missing.join('\n') + '\n';

  try {
    fs.writeFileSync(gitignorePath, out, { encoding: 'utf-8' });
  } catch (e) {
    return { updated: false, present: fs.existsSync(gitignorePath), gitignorePath, reason: (e as Error).message };
  }

  if (!options.silent) {
    console.log(`✓ Updated .gitignore at ${gitignorePath}`);
  }
  return { updated: true, present: true, gitignorePath, added: missing };
}

function installPrePushHook(options: { silent: boolean }): { installed: boolean; skipped: boolean; present: boolean; hookPath?: string; reason?: string } {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  } catch {
    return { installed: false, skipped: true, present: false, reason: 'not a git repository' };
  }

  let repoRoot = '';
  let hooksPath = '';
  try {
    repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    hooksPath = execSync('git rev-parse --git-path hooks', { encoding: 'utf8' }).trim();
  } catch (e) {
    return { installed: false, skipped: true, present: false, reason: 'unable to locate git hooks directory' };
  }

  const hooksDir = path.isAbsolute(hooksPath) ? hooksPath : path.join(repoRoot, hooksPath);
  const hookFile = path.join(hooksDir, 'pre-push');

  const hookScript =
    `#!/bin/sh\n` +
    `# ${WORKLOG_PRE_PUSH_HOOK_MARKER}\n` +
    `# Auto-sync Worklog data before pushing.\n` +
    `# Set WORKLOG_SKIP_PRE_PUSH=1 to bypass.\n` +
    `\n` +
    `set -e\n` +
    `\n` +
    `if [ \"$WORKLOG_SKIP_PRE_PUSH\" = \"1\" ]; then\n` +
    `  exit 0\n` +
    `fi\n` +
    `\n` +
    `# Avoid recursion when worklog sync pushes refs/worklog/data.\n` +
    `skip=0\n` +
    `while read local_ref local_sha remote_ref remote_sha; do\n` +
    `  if [ \"$remote_ref\" = \"refs/worklog/data\" ]; then\n` +
    `    skip=1\n` +
    `  fi\n` +
    `done\n` +
    `\n` +
    `if [ \"$skip\" = \"1\" ]; then\n` +
    `  exit 0\n` +
    `fi\n` +
    `\n` +
    `if command -v wl >/dev/null 2>&1; then\n` +
    `  WL=wl\n` +
    `elif command -v worklog >/dev/null 2>&1; then\n` +
    `  WL=worklog\n` +
    `else\n` +
    `  echo \"worklog: wl/worklog not found; skipping pre-push sync\" >&2\n` +
    `  exit 0\n` +
    `fi\n` +
    `\n` +
    `\"$WL\" sync\n` +
    `\n` +
    `exit 0\n`;

  try {
    fs.mkdirSync(hooksDir, { recursive: true });

    if (fs.existsSync(hookFile)) {
      const existing = fs.readFileSync(hookFile, 'utf-8');
      if (existing.includes(WORKLOG_PRE_PUSH_HOOK_MARKER)) {
        return { installed: false, skipped: true, present: true, hookPath: hookFile, reason: 'hook already installed' };
      }
      return { installed: false, skipped: true, present: true, hookPath: hookFile, reason: `pre-push hook already exists at ${hookFile} (not overwriting)` };
    }

    fs.writeFileSync(hookFile, hookScript, { encoding: 'utf-8', mode: 0o755 });
    try {
      fs.chmodSync(hookFile, 0o755);
    } catch {
      // ignore
    }

    if (!options.silent) {
      console.log(`✓ Installed git pre-push hook at ${hookFile}`);
    }
    return { installed: true, skipped: false, present: true, hookPath: hookFile };
  } catch (e) {
    return { installed: false, skipped: true, present: false, hookPath: hookFile, reason: (e as Error).message };
  }
}

// Initialize database with default prefix (persistence and refresh handled automatically)
const dataPath = getDefaultDataPath();
let db: WorklogDatabase | null = null;

function getSyncDefaults(config?: ReturnType<typeof loadConfig>) {
  return {
    gitRemote: config?.syncRemote || DEFAULT_GIT_REMOTE,
    gitBranch: config?.syncBranch || DEFAULT_GIT_BRANCH,
  };
}

function scheduleAutoSync(prefix?: string): void {
  if (autoSyncTimer) {
    clearTimeout(autoSyncTimer);
  }
  autoSyncTimer = setTimeout(() => {
    autoSyncTimer = null;
    void runAutoSync(prefix);
  }, AUTO_SYNC_DEBOUNCE_MS);
}

async function runAutoSync(prefix?: string): Promise<void> {
  if (autoSyncInFlight) {
    autoSyncPending = true;
    return;
  }

  autoSyncInFlight = true;
  const config = loadConfig();
  const defaults = getSyncDefaults(config);

  try {
    await performSync({
      file: dataPath,
      prefix,
      gitRemote: defaults.gitRemote,
      gitBranch: defaults.gitBranch,
      push: true,
      dryRun: false,
      silent: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Auto-sync failed: ${message}`);
  } finally {
    autoSyncInFlight = false;
    if (autoSyncPending) {
      autoSyncPending = false;
      scheduleAutoSync(prefix);
    }
  }
}

// Check if system is initialized and exit if not
function requireInitialized(): void {
  if (!isInitialized()) {
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({
        success: false,
        initialized: false,
        error: 'Worklog system is not initialized. Run "worklog init" first.'
      });
    } else {
      console.error('Error: Worklog system is not initialized.');
      console.error('Run "worklog init" to initialize the system.');
    }
    process.exit(1);
  }
}

// Get or initialize database with the specified prefix
function getDatabase(prefix?: string): WorklogDatabase {
  const actualPrefix = getPrefix(prefix);
  
  // If db exists and prefix matches, return it
  if (db && db.getPrefix() === actualPrefix) {
    return db;
  }
  
  // Load config to get autoExport setting
  const config = loadConfig();
  const autoExport = config?.autoExport !== false; // Default to true for backwards compatibility
  const autoSync = config?.autoSync === true;
  
  // Create new database instance with the prefix
  // The database will automatically:
  // 1. Connect to persistent SQLite storage
  // 2. Check if JSONL is newer than DB and refresh if needed
  // 3. Auto-export to JSONL on all write operations (if autoExport is enabled)
  // When in JSON mode or when verbose is not enabled, suppress console output
  const isJsonMode = program.opts().json;
  const isVerbose = program.opts().verbose;
  const silent = isJsonMode || !isVerbose;
  db = new WorklogDatabase(
    actualPrefix,
    undefined,
    undefined,
    autoExport,
    silent,
    autoSync,
    () => {
      scheduleAutoSync(actualPrefix);
      return Promise.resolve();
    }
  );
  return db;
}

// Perform sync operation
async function performSync(options: {
  file: string;
  prefix?: string;
  gitRemote: string;
  gitBranch: string;
  push: boolean;
  dryRun: boolean;
  silent?: boolean;
}): Promise<SyncResult> {
  const isJsonMode = program.opts().json;
  const isSilent = options.silent || false;
  
  // Load current local data
  const db = getDatabase(options.prefix);
  const localItems = db.getAll();
  const localComments = db.getAllComments();
  
  if (!isJsonMode && !isSilent) {
    console.log(`Starting sync for ${options.file}...`);
    console.log(`Local state: ${localItems.length} work items, ${localComments.length} comments`);
    
    if (options.dryRun) {
      console.log('\n[DRY RUN MODE - No changes will be made]');
    }
    
    // Pull latest from git
    console.log('\nPulling latest changes from git...');
  }
  
  const gitTarget: GitTarget = {
    remote: options.gitRemote,
    branch: options.gitBranch,
  };

  // Import remote data
  let remoteItems: WorkItem[] = [];
  let remoteComments: Comment[] = [];

  const remoteContent = await getRemoteDataFileContent(options.file, gitTarget);
  if (remoteContent) {
    const remoteData = importFromJsonlContent(remoteContent);
    remoteItems = remoteData.items;
    remoteComments = remoteData.comments;
  }

  if (!isJsonMode && !isSilent) {
    console.log(`Remote state: ${remoteItems.length} work items, ${remoteComments.length} comments`);
  }
  
  // Merge work items
  if (!isJsonMode && !isSilent) {
    console.log('\nMerging work items...');
  }
  const itemMergeResult = mergeWorkItems(localItems, remoteItems);
  
  // Merge comments
  if (!isJsonMode && !isSilent) {
    console.log('Merging comments...');
  }
  const commentMergeResult = mergeComments(localComments, remoteComments);
  
  // Calculate statistics (best-effort; merge logic is heuristic)
  const itemsAdded = itemMergeResult.merged.length - localItems.length;
  const itemsUpdated = itemMergeResult.conflicts.filter(c => c.includes('Conflicting fields') || c.includes('Same updatedAt')).length;
  const itemsUnchanged = Math.max(0, localItems.length - Math.max(0, itemsUpdated));
  const commentsAdded = commentMergeResult.merged.length - localComments.length;
  const commentsUnchanged = Math.max(0, localComments.length - Math.max(0, commentsAdded));

  const result: SyncResult = {
    itemsAdded,
    itemsUpdated,
    itemsUnchanged,
    commentsAdded,
    commentsUnchanged,
    conflicts: itemMergeResult.conflicts,
    conflictDetails: itemMergeResult.conflictDetails
  };
  
  if (isJsonMode && !isSilent) {
    if (options.dryRun) {
      outputJson({
        success: true,
        dryRun: true,
        sync: {
          file: options.file,
          localState: {
            workItems: localItems.length,
            comments: localComments.length
          },
          remoteState: {
            workItems: remoteItems.length,
            comments: remoteComments.length
          },
          summary: result
        }
      });
      return result;
    }
  } else if (!isSilent) {
    // Display detailed conflict information with colors
    displayConflictDetails(result, itemMergeResult.merged);
    
    // Display summary
    console.log('\nSync summary:');
    console.log(`  Work items added: ${result.itemsAdded}`);
    console.log(`  Work items updated: ${result.itemsUpdated}`);
    console.log(`  Work items unchanged: ${result.itemsUnchanged}`);
    console.log(`  Comments added: ${result.commentsAdded}`);
    console.log(`  Comments unchanged: ${result.commentsUnchanged}`);
    console.log(`  Total work items: ${itemMergeResult.merged.length}`);
    console.log(`  Total comments: ${commentMergeResult.merged.length}`);
    
    if (options.dryRun) {
      console.log('\n[DRY RUN MODE - No changes were made]');
      return result;
    }
  }
  
  if (options.dryRun) {
    return result;
  }
  
  // Update database with merged data
  // Note: import() clears and replaces, which is correct here because
  // itemMergeResult.merged already contains the complete merged dataset
  // (all local items + all remote items, with conflicts resolved)
  const config = loadConfig();
  const autoSyncEnabled = config?.autoSync === true;
  if (autoSyncEnabled) {
    db.setAutoSync(false);
  }
  db.import(itemMergeResult.merged);
  db.importComments(commentMergeResult.merged);
  if (autoSyncEnabled) {
    db.setAutoSync(true, () => {
      scheduleAutoSync(options.prefix);
      return Promise.resolve();
    });
  }
  
  if (!isJsonMode && !isSilent) {
    console.log('\nMerged data saved locally');
  }

  // Ensure the JSONL file on disk reflects the merged state for this repo.
  // This file is what we will commit to the dedicated data branch.
  exportToJsonl(itemMergeResult.merged, commentMergeResult.merged, options.file);
  
  // Push to git if requested
  if (options.push) {
    if (!isJsonMode && !isSilent) {
      console.log('\nPushing changes to git...');
    }
    await gitPushDataFileToBranch(options.file, 'Sync work items and comments', gitTarget);
    if (!isJsonMode && !isSilent) {
      console.log('Changes pushed successfully');
    }
  } else {
    if (!isJsonMode && !isSilent) {
      console.log('\nSkipping git push (--no-push flag)');
    }
  }
  
  if (isJsonMode && !isSilent) {
    outputJson({
      success: true,
      message: 'Sync completed successfully',
      sync: {
        file: options.file,
        summary: result,
        pushed: options.push
      }
    });
  } else if (!isSilent) {
    console.log('\n✓ Sync completed successfully');
  }
  
  return result;
}

program
  .name('worklog')
  .description('CLI for Worklog - an issue tracker for agents')
  .version(WORKLOG_VERSION)
  .option('--json', 'Output in JSON format (machine-readable)')
  .option('--verbose', 'Show verbose output including debug messages')
  .option('-F, --format <format>', 'Human display format (choices: concise|normal|full|raw)');

// Allowed formats for validation
const ALLOWED_FORMATS = new Set(['concise', 'normal', 'full', 'raw']);

function isValidFormat(fmt: any): boolean {
  if (!fmt || typeof fmt !== 'string') return false;
  return ALLOWED_FORMATS.has(fmt.toLowerCase());
}

// Validate CLI-provided format early before any command action runs
program.hook('preAction', () => {
  const cliFormat = program.opts().format;
  if (cliFormat && !isValidFormat(cliFormat)) {
    console.error(`Invalid --format value: ${cliFormat}`);
    console.error(`Valid formats: ${Array.from(ALLOWED_FORMATS).join(', ')}`);
    process.exit(1);
  }
});

// Initialize configuration
program
  .command('init')
  .description('Initialize worklog configuration')
  .action(async (_options: InitOptions) => {
    const isJsonMode = program.opts().json;
    
    if (configExists()) {
      // Config exists, but ensure semaphore is written if not present
      if (!isInitialized()) {
        writeInitSemaphore(WORKLOG_VERSION);
      }
      
      const config = loadConfig();
      const initInfo = readInitSemaphore();
      
      if (isJsonMode) {
        const gitignoreResult = ensureGitignore({ silent: true });
        const hookResult = installPrePushHook({ silent: true });
        // In JSON mode, we can't do interactive prompts, so just report the existing config
        outputJson({
          success: true,
          message: 'Configuration already exists',
          config: {
            projectName: config?.projectName,
            prefix: config?.prefix
          },
          version: initInfo?.version || WORKLOG_VERSION,
          initializedAt: initInfo?.initializedAt,
          gitignore: gitignoreResult,
          gitHook: hookResult
        });
        return;
      } else {
        // In interactive mode, allow user to change settings
        try {
          const updatedConfig = await initConfig(config);
          
          // Update semaphore with current version
          writeInitSemaphore(WORKLOG_VERSION);
          
          // Sync database after any changes
          console.log('\n' + chalk.blue('## Git Sync') + '\n');
          console.log('Syncing database...');
          
          try {
            const updatedDefaults = getSyncDefaults(updatedConfig);
            await performSync({
              file: dataPath,
              prefix: updatedConfig?.prefix,
              gitRemote: updatedDefaults.gitRemote,
              gitBranch: updatedDefaults.gitBranch,
              push: true,
              dryRun: false,
              silent: false
            });
          } catch (syncError) {
            console.log('\nNote: Sync failed (this is OK for new projects without remote data)');
            console.log(`  ${(syncError as Error).message}`);
          }

          console.log('\n' + chalk.blue('## Gitignore') + '\n');
          const gitignoreResult = ensureGitignore({ silent: false });
          if (gitignoreResult.reason) {
            console.log(`Note: .gitignore not updated: ${gitignoreResult.reason}`);
          }

          console.log('\n' + chalk.blue('## Git Hooks') + '\n');
          const hookResult = installPrePushHook({ silent: false });
          if (hookResult.present) {
            if (hookResult.installed) {
              console.log(`Git pre-push hook: present (installed)`);
            } else {
              console.log(`Git pre-push hook: present`);
            }
            if (hookResult.hookPath) {
              console.log(`Hook path: ${hookResult.hookPath}`);
            }
          } else {
            console.log('Git pre-push hook: not present');
          }
          if (!hookResult.installed && hookResult.reason && hookResult.reason !== 'hook already installed') {
            console.log(`\nNote: git pre-push hook not installed: ${hookResult.reason}`);
          }
          return;
        } catch (error) {
          outputError('Error: ' + (error as Error).message, { success: false, error: (error as Error).message });
          process.exit(1);
        }
      }
    }
    
    try {
      await initConfig();
      const config = loadConfig();
      
      // Write initialization semaphore with version
      writeInitSemaphore(WORKLOG_VERSION);
      
      // Read it back to get the exact timestamp
      const initInfo = readInitSemaphore();
      
      if (isJsonMode) {
        const gitignoreResult = ensureGitignore({ silent: true });
        const hookResult = installPrePushHook({ silent: true });
        outputJson({
          success: true,
          message: 'Configuration initialized',
          config: {
            projectName: config?.projectName,
            prefix: config?.prefix
          },
          version: WORKLOG_VERSION,
          initializedAt: initInfo?.initializedAt,
          gitignore: gitignoreResult,
          gitHook: hookResult
        });
      }
      
      // Sync database after initialization
      if (!isJsonMode) {
        console.log('\n' + chalk.blue('## Git Sync') + '\n');
        console.log('Syncing database...');
      }
      
      try {
        const initDefaults = getSyncDefaults(config || undefined);
        await performSync({
          file: dataPath,
          prefix: config?.prefix,
          gitRemote: initDefaults.gitRemote,
          gitBranch: initDefaults.gitBranch,
          push: true,
          dryRun: false,
          silent: isJsonMode  // Silent in JSON mode to maintain clean JSON output
        });
      } catch (syncError) {
        // Sync errors are not fatal for init - just warn the user
        if (isJsonMode) {
          // In JSON mode, include sync error in the output but still report success for init
          const output: any = {
            success: true,
            message: 'Configuration initialized',
            config: {
              projectName: config?.projectName,
              prefix: config?.prefix
            },
            syncWarning: {
              message: 'Sync failed (this is OK for new projects without remote data)',
              error: (syncError as Error).message
            }
          };
          outputJson(output);
        } else {
          console.log('\nNote: Sync failed (this is OK for new projects without remote data)');
          console.log(`  ${(syncError as Error).message}`);
        }
      }

      if (!isJsonMode) {
        console.log('\n' + chalk.blue('## Gitignore') + '\n');
        const gitignoreResult = ensureGitignore({ silent: false });
        if (gitignoreResult.reason) {
          console.log(`Note: .gitignore not updated: ${gitignoreResult.reason}`);
        }

        console.log('\n' + chalk.blue('## Git Hooks') + '\n');
        const hookResult = installPrePushHook({ silent: false });
        if (hookResult.present) {
          if (hookResult.installed) {
            console.log(`Git pre-push hook: present (installed)`);
          } else {
            console.log(`Git pre-push hook: present`);
          }
          if (hookResult.hookPath) {
            console.log(`Hook path: ${hookResult.hookPath}`);
          }
        } else {
          console.log('Git pre-push hook: not present');
        }
        if (!hookResult.installed && hookResult.reason && hookResult.reason !== 'hook already installed') {
          console.log(`\nNote: git pre-push hook not installed: ${hookResult.reason}`);
        }
      }
    } catch (error) {
      outputError('Error: ' + (error as Error).message, { success: false, error: (error as Error).message });
      process.exit(1);
    }
  });

// Status command - check initialization and provide summary
program
  .command('status')
  .description('Show Worklog system status and database summary')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((options: StatusOptions) => {
    const isJsonMode = program.opts().json;
    
    // Check if initialized
    if (!isInitialized()) {
      if (isJsonMode) {
        outputJson({
          success: false,
          initialized: false,
          error: 'Worklog system is not initialized. Run "worklog init" first.'
        });
      } else {
        console.error('Error: Worklog system is not initialized.');
        console.error('Run "worklog init" to initialize the system.');
      }
      process.exit(1);
    }
    
    // Read initialization info
    const initInfo = readInitSemaphore();
    
    // Get database statistics
    const db = getDatabase(options.prefix);
    const workItems = db.getAll();
    const comments = db.getAllComments();
    const config = loadConfig();
    // Compute open vs closed counts
    const closedCount = workItems.filter(i => i.status === 'completed').length;
    const deletedCount = workItems.filter(i => i.status === 'deleted').length;
    const openCount = workItems.length - closedCount - deletedCount;
    
    if (isJsonMode) {
      outputJson({
        success: true,
        initialized: true,
        version: initInfo?.version || 'unknown',
        initializedAt: initInfo?.initializedAt || 'unknown',
        config: {
          projectName: config?.projectName,
          prefix: config?.prefix,
          autoExport: config?.autoExport !== false,
          autoSync: config?.autoSync === true,
          syncRemote: config?.syncRemote,
          syncBranch: config?.syncBranch,
          githubRepo: config?.githubRepo,
          githubLabelPrefix: config?.githubLabelPrefix,
          githubImportCreateNew: config?.githubImportCreateNew !== false
        },
      database: {
          workItems: workItems.length,
          comments: comments.length,
          open: openCount,
          closed: closedCount,
          deleted: deletedCount
        }
    });
    } else {
      console.log('Worklog System Status');
      console.log('=====================\n');
      console.log(`Initialized: Yes`);
      console.log(`Version: ${initInfo?.version || 'unknown'}`);
      console.log(`Initialized at: ${initInfo?.initializedAt || 'unknown'}`);
      console.log();
      console.log('Configuration:');
      console.log(`  Project: ${config?.projectName || 'unknown'}`);
      console.log(`  Prefix: ${config?.prefix || 'unknown'}`);
      console.log(`  Auto-export: ${config?.autoExport !== false ? 'enabled' : 'disabled'}`);
      console.log(`  Auto-sync: ${config?.autoSync ? 'enabled' : 'disabled'}`);
      console.log(`  Sync remote: ${config?.syncRemote || DEFAULT_GIT_REMOTE}`);
      console.log(`  Sync branch: ${config?.syncBranch || DEFAULT_GIT_BRANCH}`);
      if (config?.githubRepo || config?.githubLabelPrefix) {
        console.log(`  GitHub repo: ${config?.githubRepo || '(not set)'}`);
        console.log(`  GitHub label prefix: ${config?.githubLabelPrefix || 'wl:'}`);
        console.log(`  GitHub import create: ${config?.githubImportCreateNew !== false ? 'enabled' : 'disabled'}`);
      }
      console.log();
      console.log('Database Summary:');
      console.log(`  Work Items: ${workItems.length}`);
      console.log(`  Open:       ${openCount}`);
      console.log(`  Closed:     ${closedCount}`);
      if (deletedCount > 0) console.log(`  Deleted:    ${deletedCount}`);
      console.log(`  Comments:   ${comments.length}`);
    }
  });

// Create a new work item
program
  .command('create')
  .description('Create a new work item')
  .requiredOption('-t, --title <title>', 'Title of the work item')
  .option('-d, --description <description>', 'Description of the work item', '')
  .option('-s, --status <status>', 'Status (open, in-progress, completed, blocked, deleted)', 'open')
  .option('-p, --priority <priority>', 'Priority (low, medium, high, critical)', 'medium')
  .option('-P, --parent <parentId>', 'Parent work item ID')
  .option('--tags <tags>', 'Comma-separated list of tags')
  .option('-a, --assignee <assignee>', 'Assignee of the work item')
  .option('--stage <stage>', 'Stage of the work item in the workflow')
  .option('--issue-type <issueType>', 'Issue type (interoperability field)')
  .option('--created-by <createdBy>', 'Created by (interoperability field)')
  .option('--deleted-by <deletedBy>', 'Deleted by (interoperability field)')
  .option('--delete-reason <deleteReason>', 'Delete reason (interoperability field)')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((options: CreateOptions) => {
    requireInitialized();
    const db = getDatabase(options.prefix);
    
    const item = db.create({
      title: options.title,
      description: options.description,
      status: options.status as WorkItemStatus,
      priority: options.priority as WorkItemPriority,
      parentId: options.parent || null,
      tags: options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [],
      assignee: options.assignee || '',
      stage: options.stage || '',
      issueType: options.issueType || '',
      createdBy: options.createdBy || '',
      deletedBy: options.deletedBy || '',
      deleteReason: options.deleteReason || '',
    });
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ success: true, workItem: item });
    } else {
      const format = resolveFormat();
      console.log(humanFormatWorkItem(item, db, format));
    }
  });

// List work items
program
  .command('list')
  .description('List work items')
  .argument('[search]', 'Search term (matches title and description)')
  .option('-s, --status <status>', 'Filter by status')
  .option('-p, --priority <priority>', 'Filter by priority')
  .option('-P, --parent <parentId>', 'Filter by parent ID (use "null" for root items)')
  .option('--tags <tags>', 'Filter by tags (comma-separated)')
  .option('-a, --assignee <assignee>', 'Filter by assignee')
  .option('--stage <stage>', 'Filter by stage')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((search: string | undefined, options: ListOptions) => {
    requireInitialized();
    const db = getDatabase(options?.prefix);
    
    const query: WorkItemQuery = {};
    if (options.status) query.status = options.status as WorkItemStatus;
    if (options.priority) query.priority = options.priority as WorkItemPriority;
    if (options.parent !== undefined) {
      query.parentId = options.parent === 'null' ? null : options.parent;
    }
    if (options.tags) {
      query.tags = options.tags.split(',').map((t: string) => t.trim());
    }
    if (options.assignee) query.assignee = options.assignee;
    if (options.stage) query.stage = options.stage;
    
    let items = db.list(query);

    // If a free-form search term was provided as an argument, filter title and description
    if (search) {
      const lower = String(search).toLowerCase();
      items = items.filter(item => {
        const titleMatch = item.title && item.title.toLowerCase().includes(lower);
        const descMatch = item.description && item.description.toLowerCase().includes(lower);
        return Boolean(titleMatch || descMatch);
      });
    }
    
    const isJsonMode = program.opts().json;
    // If JSON mode, allow db.list to accept a search term via query.search for API parity
    if (isJsonMode) {
      outputJson({ success: true, count: items.length, workItems: items });
    } else {
      if (items.length === 0) {
        console.log('No work items found');
        return;
      }

      // Use the same tree display as `show` and `in-progress`
      console.log(`Found ${items.length} work item(s):\n`);
      console.log(''); // Add blank line before tree
      displayItemTree(items);
      console.log(''); // Add blank line after tree
    }
  });

// Show a specific work item
program
  .command('show <id>')
  .description('Show details of a work item')
  .option('-c, --children', 'Also show children')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((id: string, options: ShowOptions) => {
    requireInitialized();
    const db = getDatabase(options.prefix);
    
    const item = db.get(id);
    if (!item) {
      outputError(`Work item not found: ${id}`, { success: false, error: `Work item not found: ${id}` });
      process.exit(1);
    }
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      const result: any = { success: true, workItem: item };
      // Include comments for this work item in JSON output so close reasons are visible
      result.comments = db.getCommentsForWorkItem(id);
      if (options.children) {
        const children = db.getChildren(id);
        result.children = children;
      }
      outputJson(result);
      return;
    }

    // If user asked for children, keep the tree rendering behavior unchanged
    if (options.children) {
      const itemsToDisplay = [item, ...db.getDescendants(id)];
      console.log(''); // Add blank line before tree
      displayItemTree(itemsToDisplay);
      console.log(''); // Add blank line after tree

      // Show comments for this work item so close reasons stored as comments are visible
      const comments = db.getCommentsForWorkItem(id);
      if (comments.length > 0) {
        console.log('Comments:');
        comments.forEach(c => {
          console.log(humanFormatComment(c, resolveFormat()));
          console.log('');
        });
      }
      return;
    }

    // No children requested — keep a compact tree rendering for consistency with `list`
    const chosenFormat = resolveFormat();
    console.log('');
    displayItemTree([item]);
    // Show comments for non-full formats (full already inlines comments)
    if (chosenFormat !== 'full') {
      const comments = db.getCommentsForWorkItem(id);
      if (comments.length > 0) {
        console.log('\nComments:');
        comments.forEach(c => {
          console.log(humanFormatComment(c, chosenFormat));
          console.log('');
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
  .option('-a, --assignee <assignee>', 'New assignee')
  .option('--stage <stage>', 'New stage')
  .option('--issue-type <issueType>', 'New issue type (interoperability field)')
  .option('--created-by <createdBy>', 'New created by (interoperability field)')
  .option('--deleted-by <deletedBy>', 'New deleted by (interoperability field)')
  .option('--delete-reason <deleteReason>', 'New delete reason (interoperability field)')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((id: string, options: UpdateOptions) => {
    requireInitialized();
    const db = getDatabase(options.prefix);
    
    const updates: UpdateWorkItemInput = {};
    if (options.title) updates.title = options.title;
    if (options.description) updates.description = options.description;
    if (options.status) updates.status = options.status as WorkItemStatus;
    if (options.priority) updates.priority = options.priority as WorkItemPriority;
    if (options.parent !== undefined) updates.parentId = options.parent;
    if (options.tags) updates.tags = options.tags.split(',').map((t: string) => t.trim());
    if (options.assignee !== undefined) updates.assignee = options.assignee;
    if (options.stage !== undefined) updates.stage = options.stage;
    if (options.issueType !== undefined) updates.issueType = options.issueType;
    if (options.createdBy !== undefined) updates.createdBy = options.createdBy;
    if (options.deletedBy !== undefined) updates.deletedBy = options.deletedBy;
    if (options.deleteReason !== undefined) updates.deleteReason = options.deleteReason;
    
    const item = db.update(id, updates);
    if (!item) {
      outputError(`Work item not found: ${id}`, { success: false, error: `Work item not found: ${id}` });
      process.exit(1);
    }
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ success: true, workItem: item });
    } else {
      const format = resolveFormat();
      console.log('Updated work item:');
      console.log(humanFormatWorkItem(item, db, format));
    }
  });

// Delete a work item
program
  .command('delete <id>')
  .description('Delete a work item')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((id: string, options: DeleteOptions) => {
    requireInitialized();
    const db = getDatabase(options.prefix);
    
    const deleted = db.delete(id);
    if (!deleted) {
      outputError(`Work item not found: ${id}`, { success: false, error: `Work item not found: ${id}` });
      process.exit(1);
    }
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ success: true, message: `Deleted work item: ${id}`, deletedId: id });
    } else {
      console.log(`Deleted work item: ${id}`);
    }
  });

// Export data
program
  .command('export')
  .description('Export work items and comments to JSONL file')
  .option('-f, --file <filepath>', 'Output file path', dataPath)
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((options: ExportOptions) => {
    requireInitialized();
    const db = getDatabase(options.prefix);
    const items = db.getAll();
    const comments = db.getAllComments();
    exportToJsonl(items, comments, options.file || dataPath);
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ 
        success: true, 
        message: `Exported ${items.length} work items and ${comments.length} comments`,
        itemsCount: items.length,
        commentsCount: comments.length,
        file: options.file
      });
    } else {
      console.log(`Exported ${items.length} work items and ${comments.length} comments to ${options.file}`);
    }
  });

// Import data
program
  .command('import')
  .description('Import work items and comments from JSONL file')
  .option('-f, --file <filepath>', 'Input file path', dataPath)
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((options: ImportOptions) => {
    requireInitialized();
    const db = getDatabase(options.prefix);
    const { items, comments } = importFromJsonl(options.file || dataPath);
    db.import(items);
    db.importComments(comments);
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ 
        success: true, 
        message: `Imported ${items.length} work items and ${comments.length} comments`,
        itemsCount: items.length,
        commentsCount: comments.length,
        file: options.file
      });
    } else {
      console.log(`Imported ${items.length} work items and ${comments.length} comments from ${options.file}`);
    }
  });

// Find the next work item to work on
program
  .command('next')
  .description('Find the next work item to work on based on priority and status')
  .option('-a, --assignee <assignee>', 'Filter by assignee')
  .option('-s, --search <term>', 'Search term for fuzzy matching against title, description, and comments')
  .option('-n, --number <n>', 'Number of items to return (default: 1)', '1')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action(async (options: NextOptions) => {
    requireInitialized();
    const db = getDatabase(options.prefix);
    const numRequested = parseInt(options.number || '1', 10);
    const count = Number.isNaN(numRequested) || numRequested < 1 ? 1 : numRequested;

    // Attempt to use optimized multi-item selection; fall back to single-item API
    const results = (db as any).findNextWorkItems ? db.findNextWorkItems(count, options.assignee, options.search) : [db.findNextWorkItem(options.assignee, options.search)];

    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      // If only one result was requested/returned, expose a simple top-level shape
      if (results.length === 1) {
        const single = results[0];
        outputJson({ success: true, workItem: single.workItem, reason: single.reason });
        return;
      }

      // Multiple results - return array for consumers
      outputJson({ success: true, count: results.length, results });
      return;
    }

    if (!results || results.length === 0) {
      console.log('No work items found to work on.');
      return;
    }

    const chosenFormat = resolveFormat();
    if (results.length === 1) {
      const result = results[0];
      if (!result.workItem) {
        console.log('No work items found to work on.');
        if (result.reason) console.log(`Reason: ${result.reason}`);
        return;
      }

      console.log('\nNext work item to work on:');
      console.log('==========================\n');
      // Use human formatter for consistent output
      console.log(humanFormatWorkItem(result.workItem, db, chosenFormat));
      console.log(`\nReason:      ${chalk.cyan(result.reason)}`);
      console.log('\n');
      console.log(`Work item ID: ${chalk.green.bold(result.workItem.id)}`);
      console.log(`(Copy the ID above to use it in other commands)`);
      return;
    }

    // Multiple results - display a concise list or expanded based on format
    console.log(`\nNext ${results.length} work item(s) to work on:`);
    console.log('===============================\n');
    results.forEach((res: any, idx: number) => {
      if (!res.workItem) {
        console.log(`${idx + 1}. (no item) - ${res.reason}`);
        return;
      }
      if (chosenFormat === 'concise') {
        console.log(`${idx + 1}. ${formatTitleAndId(res.workItem)}`);
        console.log(`   Status: ${res.workItem.status} | Priority: ${res.workItem.priority}`);
        if (res.workItem.assignee) console.log(`   Assignee: ${res.workItem.assignee}`);
        if (res.workItem.parentId) console.log(`   Parent: ${res.workItem.parentId}`);
        if (res.workItem.description) console.log(`   ${res.workItem.description}`);
        console.log(`   Reason: ${chalk.cyan(res.reason)}`);
        console.log('');
      } else {
        console.log(`${idx + 1}.`);
        console.log(humanFormatWorkItem(res.workItem, db, chosenFormat));
        console.log(`Reason: ${chalk.cyan(res.reason)}`);
        console.log('');
      }
    });
  });

// List in-progress work items
program
  .command('in-progress')
  .description('List all in-progress work items in a tree layout showing dependencies')
  .option('-a, --assignee <assignee>', 'Filter by assignee')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((options: InProgressOptions) => {
    requireInitialized();
    const db = getDatabase(options.prefix);
    
    // Query for all in-progress items
    const query: WorkItemQuery = { status: 'in-progress' as WorkItemStatus };
    if (options.assignee) {
      query.assignee = options.assignee;
    }
    const items = db.list(query);
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ success: true, count: items.length, workItems: items });
    } else {
      if (items.length === 0) {
        console.log('No in-progress work items found');
        return;
      }
      
      console.log(`\nFound ${items.length} in-progress work item(s):\n`);
      displayItemTree(items);
      console.log();
    }
  });

// Sync with git
program
  .command('sync')
  .description('Sync work items with git repository (pull, merge with conflict resolution, and push)')
  .option('-f, --file <filepath>', 'Data file path', dataPath)
  .option('--prefix <prefix>', 'Override the default prefix')
  .option('--git-remote <remote>', 'Git remote to use for syncing data', DEFAULT_GIT_REMOTE)
  .option('--git-branch <ref>', 'Git ref to store worklog data (use refs/worklog/data to avoid GitHub PR banners)', DEFAULT_GIT_BRANCH)
  .option('--no-push', 'Skip pushing changes back to git')
  .option('--dry-run', 'Show what would be synced without making changes')
  .action(async (options: SyncOptions) => {
    requireInitialized();
    const isJsonMode = program.opts().json;

    const config = loadConfig();
    const defaults = getSyncDefaults(config || undefined);
    const gitRemote = options.gitRemote || defaults.gitRemote;
    const gitBranch = options.gitBranch || defaults.gitBranch;
    
    try {
      await performSync({
        file: options.file || dataPath,
        prefix: options.prefix,
        gitRemote,
        gitBranch,
        push: options.push ?? true,  // Default to true if not specified
        dryRun: options.dryRun ?? false,
        silent: false
      });
    } catch (error) {
      if (isJsonMode) {
        outputJson({
          success: false,
          error: (error as Error).message
        });
      } else {
        console.error('\n✗ Sync failed:', (error as Error).message);
      }
      process.exit(1);
    }
  });

// GitHub Issue mirroring
const githubCommand = program
  .command('github')
  .alias('gh')
  .description('GitHub Issue sync commands');

githubCommand
  .command('push')
  .description('Mirror work items to GitHub Issues')
  .option('--repo <owner/name>', 'GitHub repo (owner/name)')
  .option('--label-prefix <prefix>', 'Label prefix for Worklog labels (default: wl:)')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((options) => {
    requireInitialized();
    const db = getDatabase(options.prefix);
    const isJsonMode = program.opts().json;
    const isVerbose = program.opts().verbose;
    let lastProgress = '';
    let lastProgressLength = 0;

    const renderProgress = (progress: GithubProgress) => {
      if (isJsonMode || process.stdout.isTTY !== true) {
        return;
      }
      const label = progress.phase === 'push'
        ? 'Push'
        : progress.phase === 'import'
          ? 'Import'
          : progress.phase === 'hierarchy'
            ? 'Hierarchy'
            : 'Close check';
      const message = `${label}: ${progress.current}/${progress.total}`;
      if (message === lastProgress) {
        return;
      }
      lastProgress = message;
      const padded = `${message} `.padEnd(lastProgressLength, ' ');
      lastProgressLength = padded.length;
      process.stdout.write(`\r${padded}`);
      if (progress.current === progress.total) {
        process.stdout.write('\n');
        lastProgress = '';
        lastProgressLength = 0;
      }
    };

    try {
      const githubConfig = resolveGithubConfig({ repo: options.repo, labelPrefix: options.labelPrefix });
      const items = db.getAll();
      const comments = db.getAllComments();

      const { updatedItems, result, timing } = upsertIssuesFromWorkItems(items, comments, githubConfig, renderProgress);
      if (updatedItems.length > 0) {
        db.import(updatedItems);
      }

      if (isJsonMode) {
        outputJson({ success: true, ...result, repo: githubConfig.repo });
      } else {
        console.log(`GitHub sync complete (${githubConfig.repo})`);
        console.log(`  Created: ${result.created}`);
        console.log(`  Updated: ${result.updated}`);
        console.log(`  Skipped: ${result.skipped}`);
        if (result.errors.length > 0) {
          console.log(`  Errors: ${result.errors.length}`);
          console.log('  Hint: re-run with --json to view error details');
        }
        if (isVerbose) {
          console.log('  Timing breakdown:');
          console.log(`    Total: ${(timing.totalMs / 1000).toFixed(2)}s`);
          console.log(`    Issue upserts: ${(timing.upsertMs / 1000).toFixed(2)}s`);
          console.log(`    Hierarchy check: ${(timing.hierarchyCheckMs / 1000).toFixed(2)}s`);
          console.log(`    Hierarchy link: ${(timing.hierarchyLinkMs / 1000).toFixed(2)}s`);
          console.log(`    Hierarchy verify: ${(timing.hierarchyVerifyMs / 1000).toFixed(2)}s`);
        }
      }
    } catch (error) {
      outputError(`GitHub sync failed: ${(error as Error).message}`, { success: false, error: (error as Error).message });
      process.exit(1);
    }
  });

// GitHub Issue import
githubCommand
  .command('import')
  .description('Import updates from GitHub Issues')
  .option('--repo <owner/name>', 'GitHub repo (owner/name)')
  .option('--label-prefix <prefix>', 'Label prefix for Worklog labels (default: wl:)')
  .option('--since <iso>', 'Only import issues updated since ISO timestamp')
  .option('--create-new', 'Create new work items for issues without markers')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((options) => {
    requireInitialized();
    const db = getDatabase(options.prefix);
    const isJsonMode = program.opts().json;
    let lastProgress = '';
    let lastProgressLength = 0;

    const renderProgress = (progress: GithubProgress) => {
      if (isJsonMode || process.stdout.isTTY !== true) {
        return;
      }
      const label = progress.phase === 'push'
        ? 'Push'
        : progress.phase === 'import'
          ? 'Import'
          : progress.phase === 'hierarchy'
            ? 'Hierarchy'
            : 'Close check';
      const message = `${label}: ${progress.current}/${progress.total}`;
      if (message === lastProgress) {
        return;
      }
      lastProgress = message;
      const padded = `${message} `.padEnd(lastProgressLength, ' ');
      lastProgressLength = padded.length;
      process.stdout.write(`\r${padded}`);
      if (progress.current === progress.total) {
        process.stdout.write('\n');
        lastProgress = '';
        lastProgressLength = 0;
      }
    };

    try {
      const githubConfig = resolveGithubConfig({ repo: options.repo, labelPrefix: options.labelPrefix });
      const items = db.getAll();
      const createNew = resolveGithubImportCreateNew({ createNew: options.createNew });
      const { updatedItems, createdItems, issues, updatedIds, mergedItems, conflictDetails, markersFound } = importIssuesToWorkItems(items, githubConfig, {
        since: options.since,
        createNew,
        generateId: () => db.generateWorkItemId(),
        onProgress: renderProgress,
      });

      if (mergedItems.length > 0) {
        db.import(mergedItems);
      }

      if (createNew && createdItems.length > 0) {
        const { updatedItems: markedItems } = upsertIssuesFromWorkItems(mergedItems, db.getAllComments(), githubConfig, renderProgress);
        if (markedItems.length > 0) {
          db.import(markedItems);
        }
      }

      if (isJsonMode) {
        outputJson({
          success: true,
          repo: githubConfig.repo,
          updated: updatedItems.length,
          created: createdItems.length,
          totalIssues: issues.length,
          createNew,
        });
      } else {
        const unchanged = Math.max(items.length - updatedIds.size, 0);
        const totalItems = unchanged + updatedIds.size + createdItems.length;
        const openIssues = issues.filter(issue => issue.state === 'open').length;
        const closedIssues = issues.length - openIssues;
        console.log(`GitHub import complete (${githubConfig.repo})`);
        console.log(`  Work items added: ${createdItems.length}`);
        console.log(`  Work items updated: ${updatedItems.length}`);
        console.log(`  Work items unchanged: ${unchanged}`);
        console.log(`  Issues scanned: ${issues.length} (open: ${openIssues}, closed: ${closedIssues}, worklog: ${markersFound})`);
        console.log(`  Create new: ${createNew ? 'enabled' : 'disabled'}`);
        console.log(`  Total work items: ${totalItems}`);
        displayConflictDetails(
          {
            itemsAdded: createdItems.length,
            itemsUpdated: updatedItems.length,
            itemsUnchanged: unchanged,
            commentsAdded: 0,
            commentsUnchanged: 0,
            conflicts: conflictDetails.conflicts,
            conflictDetails: conflictDetails.conflictDetails,
          },
          mergedItems
        );
      }
    } catch (error) {
      outputError(`GitHub import failed: ${(error as Error).message}`, { success: false, error: (error as Error).message });
      process.exit(1);
    }
  });


// Comment commands
const commentCommand = program.command('comment').description('Manage comments on work items');

// Create a comment
commentCommand
  .command('create <workItemId>')
  .description('Create a comment on a work item')
  .requiredOption('-a, --author <author>', 'Author of the comment')
  .requiredOption('-c, --comment <comment>', 'Comment text (markdown supported)')
  .option('-r, --references <references>', 'Comma-separated list of references (work item IDs, file paths, or URLs)')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((workItemId: string, options: CommentCreateOptions) => {
    requireInitialized();
    const db = getDatabase(options.prefix);
    
    const comment = db.createComment({
      workItemId,
      author: options.author,
      comment: options.comment,
      references: options.references ? options.references.split(',').map((r: string) => r.trim()) : [],
    });
    
    if (!comment) {
      outputError(`Work item not found: ${workItemId}`, { success: false, error: `Work item not found: ${workItemId}` });
      process.exit(1);
    }
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ success: true, comment });
    } else {
      const format = resolveFormat();
      console.log('Created comment:');
      console.log(humanFormatComment(comment, format));
    }
  });

// Close command - create a comment with the reason and mark item(s) completed
program
  .command('close')
  .description('Close one or more work items and record a close reason as a comment')
  .argument('<ids...>', 'Work item id(s) to close')
  .option('-r, --reason <reason>', 'Reason for closing (stored as a comment)', '')
  .option('-a, --author <author>', 'Author name for the close comment', 'worklog')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((ids: string[], options: CloseOptions) => {
    requireInitialized();
    const db = getDatabase(options.prefix);
    const isJsonMode = program.opts().json;

    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const id of ids) {
      const item = db.get(id);
      if (!item) {
        results.push({ id, success: false, error: 'Work item not found' });
        continue;
      }

      // If a reason was provided, store it as an immutable comment
      if (options.reason && options.reason.trim() !== '') {
        try {
          const comment = db.createComment({
            workItemId: id,
            author: options.author || 'worklog',
            comment: options.reason,
            references: []
          });
          if (!comment) {
            // Shouldn't happen because we checked existence, but handle defensively
            results.push({ id, success: false, error: 'Failed to create comment' });
            continue;
          }
        } catch (err) {
          results.push({ id, success: false, error: `Failed to create comment: ${(err as Error).message}` });
          continue;
        }
      }

      // Mark the item completed
      try {
        const updated = db.update(id, { status: 'completed' });
        if (!updated) {
          results.push({ id, success: false, error: 'Failed to update status' });
          continue;
        }
        results.push({ id, success: true });
      } catch (err) {
        results.push({ id, success: false, error: (err as Error).message });
      }
    }

    // Output results
    if (isJsonMode) {
      outputJson({ success: results.every(r => r.success), results });
    } else {
      for (const r of results) {
        if (r.success) {
          console.log(`Closed ${r.id}`);
        } else {
          console.error(`Failed to close ${r.id}: ${r.error}`);
        }
      }
    }
    // Exit non-zero if any failed
    if (!results.every(r => r.success)) process.exit(1);
  });

// List comments for a work item
commentCommand
  .command('list <workItemId>')
  .description('List all comments for a work item')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((workItemId: string, options: CommentListOptions) => {
    requireInitialized();
    const db = getDatabase(options.prefix);
    
    const workItem = db.get(workItemId);
    if (!workItem) {
      outputError(`Work item not found: ${workItemId}`, { success: false, error: `Work item not found: ${workItemId}` });
      process.exit(1);
    }
    
    const comments = db.getCommentsForWorkItem(workItemId);
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ success: true, count: comments.length, workItemId, comments });
    } else {
      if (comments.length === 0) {
        console.log('No comments found for this work item');
        return;
      }
      
      console.log(`Found ${comments.length} comment(s) for ${workItemId}:\n`);
      comments.forEach(comment => {
        console.log(`[${comment.id}] by ${comment.author} at ${comment.createdAt}`);
        console.log(`  ${comment.comment}`);
        if (comment.references.length > 0) {
          console.log(`  References: ${comment.references.join(', ')}`);
        }
        console.log();
      });
    }
  });

// Show a specific comment
commentCommand
  .command('show <commentId>')
  .description('Show details of a comment')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((commentId: string, options: CommentShowOptions) => {
    requireInitialized();
    const db = getDatabase(options.prefix);
    
    const comment = db.getComment(commentId);
    if (!comment) {
      outputError(`Comment not found: ${commentId}`, { success: false, error: `Comment not found: ${commentId}` });
      process.exit(1);
    }
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ success: true, comment });
    } else {
      const format = resolveFormat();
      console.log(humanFormatComment(comment, format));
    }
  });

// Update a comment
commentCommand
  .command('update <commentId>')
  .description('Update a comment')
  .option('-a, --author <author>', 'New author')
  .option('-c, --comment <comment>', 'New comment text')
  .option('-r, --references <references>', 'New references (comma-separated)')
  .option('--prefix <prefix>', 'Override the default prefix')
  .action((commentId: string, options: CommentUpdateOptions) => {
    requireInitialized();
    const db = getDatabase(options.prefix);
    
    const updates: UpdateCommentInput = {};
    if (options.author) updates.author = options.author;
    if (options.comment) updates.comment = options.comment;
    if (options.references) updates.references = options.references.split(',').map((r: string) => r.trim());
    
    const comment = db.updateComment(commentId, updates);
    if (!comment) {
      outputError(`Comment not found: ${commentId}`, { success: false, error: `Comment not found: ${commentId}` });
      process.exit(1);
    }
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ success: true, comment });
    } else {
      const format = resolveFormat();
      console.log('Updated comment:');
      console.log(humanFormatComment(comment, format));
    }
  });

// Delete a comment
commentCommand
  .command('delete <commentId>')
  .description('Delete a comment')
  .option('--prefix <prefix>', 'Override the default prefix')
   .action((commentId: string, options: CommentDeleteOptions) => {
    requireInitialized();
    const db = getDatabase(options.prefix);
    
    const deleted = db.deleteComment(commentId);
    if (!deleted) {
      outputError(`Comment not found: ${commentId}`, { success: false, error: `Comment not found: ${commentId}` });
      process.exit(1);
    }
    
    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      outputJson({ success: true, message: `Deleted comment: ${commentId}`, deletedId: commentId });
    } else {
      console.log(`Deleted comment: ${commentId}`);
    }
  });

// Recent command - list most recently changed issues
program
  .command('recent')
  .description('List most recently changed work items')
  .option('-n, --number <n>', 'Number of recent items to show', '3')
  .option('-c, --children', 'Also show children')
  .option('--prefix <prefix>', 'Override the default prefix')
   .action((options: RecentOptions) => {
    requireInitialized();
    const db = getDatabase(options.prefix);

    // Parse number
    let count = 3;
    const parsed = parseInt(options.number || '3', 10);
    if (!Number.isNaN(parsed) && parsed > 0) count = parsed;

    // Get all non-deleted items
    const all = db.getAll().filter(i => i.status !== 'deleted');

    // Sort by updatedAt descending (most recent first)
    all.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const selected = all.slice(0, count);

    const isJsonMode = program.opts().json;
    if (isJsonMode) {
      let itemsToOutput: any[] = selected.slice();
      if (options.children) {
        const seen = new Set(itemsToOutput.map(i => i.id));
        for (const item of selected) {
          const desc = db.getDescendants(item.id);
          for (const d of desc) {
            if (!seen.has(d.id)) {
              seen.add(d.id);
              itemsToOutput.push(d);
            }
          }
        }
      }
      outputJson({ success: true, count: selected.length, workItems: itemsToOutput });
      return;
    }

    if (selected.length === 0) {
      console.log('No recent work items found');
      return;
    }

    console.log(`\nFound ${selected.length} recent work item(s):\n`);

    // Prepare items for tree display
    let itemsToDisplay: WorkItem[] = selected.slice();
    if (options.children) {
      const seen = new Set(itemsToDisplay.map(i => i.id));
      for (const item of selected) {
        const desc = db.getDescendants(item.id);
        for (const d of desc) {
          if (!seen.has(d.id)) {
            seen.add(d.id);
            itemsToDisplay.push(d);
          }
        }
      }
    }

    console.log('');
    displayItemTree(itemsToDisplay);
    console.log('');
  });

// Customize help output to group commands for readability
program.configureHelp({
  formatHelp: (cmd: any, helper: any) => {
    const usage = helper.commandUsage(cmd);
    const description = cmd.description() || '';

    // Build groups and mapping of command name -> group
    // Order: Work Items, Comments, Data, Other (per UX request)
    const groupsDef: { name: string; names: string[] }[] = [
      { name: 'Work Items', names: ['create', 'list', 'show', 'update', 'delete', 'recent', 'next', 'in-progress'] },
      { name: 'Comments', names: ['comment'] },
      { name: 'Data', names: ['export', 'import', 'sync'] },
    ];

    const visible = helper.visibleCommands(cmd) as any[];

    const groups: Map<string, any[]> = new Map();
    for (const g of groupsDef) groups.set(g.name, []);
    groups.set('Other', []);

    for (const c of visible) {
      const name = c.name();
      const matched = groupsDef.find(g => g.names.includes(name));
      if (matched) {
        groups.get(matched.name)!.push(c);
      } else {
        groups.get('Other')!.push(c);
      }
    }

    // Compose help text
    let out = '';
    out += `Usage: ${usage}\n\n`;
    if (description) out += `${description}\n\n`;

    for (const [groupName, cmds] of groups) {
      if (!cmds || cmds.length === 0) continue;
      out += `${groupName}:\n`;
      // Determine padding width
      const terms = cmds.map((c: any) => helper.subcommandTerm(c));
      const pad = Math.max(...terms.map((t: string) => t.length)) + 2;
      for (const c of cmds) {
        const term = helper.subcommandTerm(c);
        const desc = c.description();
        out += `  ${term.padEnd(pad)} ${desc}\n`;
      }
      out += '\n';
    }

    // Global options
    const options = helper.visibleOptions ? helper.visibleOptions(cmd) : [];
    if (options && options.length > 0) {
      out += 'Options:\n';
      const terms = options.map((o: any) => (helper.optionTerm ? helper.optionTerm(o) : o.flags));
      const padOptions = Math.max(...terms.map((t: string) => t.length)) + 2;
      for (let i = 0; i < options.length; i++) {
        const o = options[i];
        const term = terms[i];
        const desc = o.description || '';
        out += `  ${term.padEnd(padOptions)} ${desc}\n`;
      }
      out += '\n';
    }

    return out;
  }
});

program.parse();
