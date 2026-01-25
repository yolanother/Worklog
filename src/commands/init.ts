/**
 * Init command - Initialize worklog configuration
 */

import type { PluginContext } from '../plugin-types.js';
import type { InitOptions } from '../cli-types.js';
import { initConfig, loadConfig, configExists, isInitialized, readInitSemaphore, writeInitSemaphore } from '../config.js';
import { exportToJsonl } from '../jsonl.js';
import { getRemoteDataFileContent, gitPushDataFileToBranch, mergeWorkItems, mergeComments } from '../sync.js';
import { DEFAULT_GIT_REMOTE, DEFAULT_GIT_BRANCH } from '../sync-defaults.js';
import { importFromJsonlContent } from '../jsonl.js';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as readline from 'readline';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const WORKLOG_PRE_PUSH_HOOK_MARKER = 'worklog:pre-push-hook:v1';
const WORKLOG_POST_PULL_HOOK_MARKER = 'worklog:post-pull-hook:v1';
const WORKLOG_GITIGNORE_MARKER = 'worklog:gitignore:v1';
const WORKLOG_AGENT_TEMPLATE_RELATIVE_PATH = 'templates/AGENTS.md';
const WORKLOG_AGENT_DESTINATION_FILENAME = 'AGENTS.md';

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
    // Not a git repo
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
    return { updated: false, present: fs.existsSync(gitignorePath), gitignorePath, added: [] };
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

function installPostPullHooks(options: { silent: boolean }): { installed: boolean; skipped: boolean; present: boolean; hookPaths?: string[]; reason?: string } {
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
  const hookNames = ['post-merge', 'post-checkout', 'post-rewrite'];
  const hookFiles = hookNames.map(f => path.join(hooksDir, f));

  // Central script that performs the post-pull sync. Hook wrappers will call this
  // central script so we only manage one implementation location.
  const centralScript = path.join(hooksDir, 'worklog-post-pull');
  const centralScriptContent =
    `#!/bin/sh\n` +
    `# ${WORKLOG_POST_PULL_HOOK_MARKER}\n` +
    `# Central Worklog post-pull sync script.\n` +
    `# Set WORKLOG_SKIP_POST_PULL=1 to bypass.\n` +
    `set -e\n` +
    `if [ \"$WORKLOG_SKIP_POST_PULL\" = \"1\" ]; then\n` +
    `  exit 0\n` +
    `fi\n` +
    `if command -v wl >/dev/null 2>&1; then\n` +
    `  WL=wl\n` +
    `elif command -v worklog >/dev/null 2>&1; then\n` +
    `  WL=worklog\n` +
    `else\n` +
    `  echo \"worklog: wl/worklog not found; skipping post-pull sync\" >&2\n` +
    `  exit 0\n` +
    `fi\n` +
    `# Run sync but do not fail the checkout/merge if sync is not available or fails\n` +
    `if \"$WL\" sync >/dev/null 2>&1; then\n` +
    `  :\n` +
    `else\n` +
    `  echo \"worklog: sync failed or not initialized; continuing\" >&2\n` +
    `fi\n` +
    `exit 0\n`;

  // Small wrapper hooks that call the central script. These are the files Git
  // expects to exist: post-merge, post-checkout, post-rewrite.
  const wrapperContent = (centralPath: string) => (
    `#!/bin/sh\n` +
    `# ${WORKLOG_POST_PULL_HOOK_MARKER}\n` +
    `# Wrapper that delegates to central Worklog post-pull script.\n` +
    `exec \"${centralPath}\" \"$@\"\n`
  );

  try {
    fs.mkdirSync(hooksDir, { recursive: true });

    // Ensure central script is present (but don't overwrite user-provided scripts)
    if (fs.existsSync(centralScript)) {
      const existing = fs.readFileSync(centralScript, 'utf-8');
      if (!existing.includes(WORKLOG_POST_PULL_HOOK_MARKER)) {
        return { installed: false, skipped: true, present: true, hookPaths: [centralScript], reason: `central script exists at ${centralScript} (not overwriting)` };
      }
    } else {
      fs.writeFileSync(centralScript, centralScriptContent, { encoding: 'utf-8', mode: 0o755 });
      try { fs.chmodSync(centralScript, 0o755); } catch {}
    }

    const installedPaths: string[] = [];
    for (const hookFile of hookFiles) {
      if (fs.existsSync(hookFile)) {
        const existing = fs.readFileSync(hookFile, 'utf-8');
        if (existing.includes(WORKLOG_POST_PULL_HOOK_MARKER)) {
          // already installed for this hook, skip
          installedPaths.push(hookFile);
          continue;
        }
        // don't overwrite user hooks
        return { installed: false, skipped: true, present: true, hookPaths: installedPaths, reason: `hook already exists at ${hookFile} (not overwriting)` };
      }

      fs.writeFileSync(hookFile, wrapperContent(centralScript), { encoding: 'utf-8', mode: 0o755 });
      try { fs.chmodSync(hookFile, 0o755); } catch {}
      installedPaths.push(hookFile);
    }

    if (!options.silent) {
      console.log(`✓ Installed git post-pull hooks (wrappers) at ${hooksDir}`);
    }
    return { installed: true, skipped: false, present: true, hookPaths: installedPaths };
  } catch (e) {
    return { installed: false, skipped: true, present: false, hookPaths: hookFiles, reason: (e as Error).message };
  }
}

function getSyncDefaults(config?: ReturnType<typeof loadConfig>) {
  return {
    gitRemote: config?.syncRemote || DEFAULT_GIT_REMOTE,
    gitBranch: config?.syncBranch || DEFAULT_GIT_BRANCH,
  };
}

function resolveRepoRoot(): string | null {
  try {
    const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return repoRoot || null;
  } catch {
    return null;
  }
}

function resolveProjectRoot(): string {
  return resolveRepoRoot() || process.cwd();
}

function locateAgentTemplate(): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(moduleDir, '..', '..');
  const candidate = path.join(packageRoot, WORKLOG_AGENT_TEMPLATE_RELATIVE_PATH);
  return fs.existsSync(candidate) ? candidate : null;
}

function resolveAgentDestination(projectRoot: string): string {
  return path.join(projectRoot, WORKLOG_AGENT_DESTINATION_FILENAME);
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, '\n').trimEnd();
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function ensureAgentTemplateInstalled(options: { silent: boolean }) {
  const templatePath = locateAgentTemplate();
  if (!templatePath) {
    return { installed: false, skipped: true, reason: 'template not found', templatePath: null, destinationPath: null };
  }

  const projectRoot = resolveProjectRoot();
  const destinationPath = resolveAgentDestination(projectRoot);

  try {
    const templateContent = normalizeContent(fs.readFileSync(templatePath, 'utf-8'));
    if (fs.existsSync(destinationPath)) {
      const existingContent = normalizeContent(fs.readFileSync(destinationPath, 'utf-8'));
      if (existingContent.includes(templateContent)) {
        return { installed: false, skipped: true, reason: 'template already present', templatePath, destinationPath };
      }
      if (options.silent) {
        return { installed: false, skipped: true, reason: 'confirmation required', templatePath, destinationPath };
      }

      const shouldAppend = await promptYesNo('AGENTS.md already exists. Append Worklog agent guidance from template? (y/N): ');
      if (!shouldAppend) {
        return { installed: false, skipped: true, reason: 'user declined append', templatePath, destinationPath };
      }

      const separator = existingContent.endsWith('\n') ? '\n' : '\n\n';
      fs.appendFileSync(destinationPath, `${separator}${templateContent}\n`, { encoding: 'utf-8' });
      if (!options.silent) {
        console.log(`✓ Appended AGENTS template to ${destinationPath}`);
      }
      return { installed: true, skipped: false, templatePath, destinationPath, appended: true };
    }

    fs.writeFileSync(destinationPath, `${templateContent}\n`, { encoding: 'utf-8' });
    if (!options.silent) {
      console.log(`✓ Installed AGENTS template at ${destinationPath}`);
    }
    return { installed: true, skipped: false, templatePath, destinationPath };
  } catch (e) {
    return { installed: false, skipped: true, reason: (e as Error).message, templatePath, destinationPath };
  }
}

async function performInitSync(dataPath: string, prefix?: string, isJsonMode: boolean = false): Promise<void> {
  const config = loadConfig();
  const defaults = getSyncDefaults(config || undefined);
  // Create DB with autoExport disabled to avoid intermediate exports while
  // importing items and comments separately. We'll write the merged JSONL
  // once after both imports are applied.
  const db = new (await import('../database.js')).WorklogDatabase(
    prefix || config?.prefix || 'WL',
    undefined,
    dataPath,
    /* autoExport */ false
  );
  
  const localItems = db.getAll();
  const localComments = db.getAllComments();
  
  const gitTarget = { remote: defaults.gitRemote, branch: defaults.gitBranch };
  const remoteContent = await getRemoteDataFileContent(dataPath, gitTarget);
  
  let remoteItems: any[] = [];
  let remoteComments: any[] = [];
  if (remoteContent) {
    const remoteData = importFromJsonlContent(remoteContent);
    remoteItems = remoteData.items;
    remoteComments = remoteData.comments;
  }
  
  const itemMergeResult = mergeWorkItems(localItems, remoteItems);
  const commentMergeResult = mergeComments(localComments, remoteComments);
  
  const autoSyncEnabled = config?.autoSync === true;
  if (autoSyncEnabled) {
    db.setAutoSync(false);
  }
  db.import(itemMergeResult.merged);
  db.importComments(commentMergeResult.merged);
  if (autoSyncEnabled) {
    db.setAutoSync(true, () => Promise.resolve());
  }
  
  exportToJsonl(itemMergeResult.merged, commentMergeResult.merged, dataPath);
  await gitPushDataFileToBranch(dataPath, 'Sync work items and comments', gitTarget);
}

export default function register(ctx: PluginContext): void {
  const { program, version, dataPath, output } = ctx;
  
  program
    .command('init')
    .description('Initialize worklog configuration')
    .action(async (_options: InitOptions) => {
      const isJsonMode = program.opts().json;
      
      if (configExists()) {
        if (!isInitialized()) {
          writeInitSemaphore(version);
        }
        
        const config = loadConfig();
        const initInfo = readInitSemaphore();
        
        if (isJsonMode) {
          const gitignoreResult = ensureGitignore({ silent: true });
          const hookResult = installPrePushHook({ silent: true });
          const agentTemplateResult = await ensureAgentTemplateInstalled({ silent: true });
          output.json({
            success: true,
            message: 'Configuration already exists',
            config: {
              projectName: config?.projectName,
              prefix: config?.prefix
            },
            version: initInfo?.version || version,
            initializedAt: initInfo?.initializedAt,
            gitignore: gitignoreResult,
            gitHook: hookResult,
            agentTemplate: agentTemplateResult
          });
          return;
        } else {
          try {
            const updatedConfig = await initConfig(config);
            writeInitSemaphore(version);
            
            console.log('\n' + chalk.blue('## Git Sync') + '\n');
            console.log('Syncing database...');
            
            try {
              await performInitSync(dataPath, updatedConfig?.prefix, false);
            } catch (syncError) {
              console.log('\nSync failed (this is OK for new projects without remote data)');
              console.log(`  ${(syncError as Error).message}`);
            }

            console.log('\n' + chalk.blue('## Gitignore') + '\n');
            const gitignoreResult = ensureGitignore({ silent: false });
            if (gitignoreResult.updated) {
              console.log(`.gitignore updated at ${gitignoreResult.gitignorePath} (added ${gitignoreResult.added?.length || 0} entries)`);
            } else if (gitignoreResult.present) {
              console.log('.gitignore is already up-to-date');
            } else {
              if (gitignoreResult.reason) {
                console.log(`.gitignore not updated: ${gitignoreResult.reason}`);
              } else {
                console.log('.gitignore: no changes required');
              }
            }

            console.log('\n' + chalk.blue('## Git Hooks') + '\n');
            const hookResult = installPrePushHook({ silent: false });
            // Try to install post-pull hooks too, but don't fail init if they can't be installed
            const postPullResult = installPostPullHooks({ silent: true });
            if (hookResult.present) {
              // Use consistent phrasing with post-pull hooks
              if (hookResult.hookPath) {
                console.log(`Git pre-push hook: installed at ${hookResult.hookPath}`);
              } else {
                console.log('Git pre-push hook: present');
              }
            } else {
              console.log('Git pre-push hook: not present');
            }
            if (!hookResult.installed && hookResult.reason && hookResult.reason !== 'hook already installed') {
              console.log(`\ngit pre-push hook not installed: ${hookResult.reason}`);
            }
            if (postPullResult && postPullResult.installed) {
              console.log(`Git post-pull hooks: installed at ${postPullResult.hookPaths?.join(', ')}`);
            } else if (postPullResult && postPullResult.skipped) {
              // don't spam the user when we silently skipped
            } else if (postPullResult && postPullResult.reason) {
              console.log(`Git post-pull hooks: not installed: ${postPullResult.reason}`);
            }

            console.log('\n' + chalk.blue('## Agent Template') + '\n');
            const agentTemplateResult = await ensureAgentTemplateInstalled({ silent: false });
            if (!agentTemplateResult.installed && agentTemplateResult.reason && agentTemplateResult.reason !== 'template already in place') {
              console.log(`Note: AGENTS template not installed: ${agentTemplateResult.reason}`);
            }
            return;
          } catch (error) {
            output.error('Error: ' + (error as Error).message, { success: false, error: (error as Error).message });
            process.exit(1);
          }
        }
      }
      
      try {
        await initConfig();
        const config = loadConfig();
        writeInitSemaphore(version);
        const initInfo = readInitSemaphore();
        
        if (isJsonMode) {
          const gitignoreResult = ensureGitignore({ silent: true });
          const hookResult = installPrePushHook({ silent: true });
          const agentTemplateResult = await ensureAgentTemplateInstalled({ silent: true });
          output.json({
            success: true,
            message: 'Configuration initialized',
            config: {
              projectName: config?.projectName,
              prefix: config?.prefix
            },
            version: version,
            initializedAt: initInfo?.initializedAt,
            gitignore: gitignoreResult,
            gitHook: hookResult,
            agentTemplate: agentTemplateResult
          });
        }
        
        if (!isJsonMode) {
          console.log('\n' + chalk.blue('## Git Sync') + '\n');
          console.log('Syncing database...');
        }
        
        try {
          await performInitSync(dataPath, config?.prefix, isJsonMode);
        } catch (syncError) {
          if (isJsonMode) {
            const outputData: any = {
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
            output.json(outputData);
          } else {
            console.log('\nSync failed (this is OK for new projects without remote data)');
            console.log(`  ${(syncError as Error).message}`);
          }
        }

          if (!isJsonMode) {
            console.log('\n' + chalk.blue('## Gitignore') + '\n');
            const gitignoreResult = ensureGitignore({ silent: false });
            if (gitignoreResult.updated) {
              console.log(`.gitignore updated at ${gitignoreResult.gitignorePath} (added ${gitignoreResult.added?.length || 0} entries)`);
            } else if (gitignoreResult.present) {
              console.log('.gitignore is already up-to-date');
            } else {
              if (gitignoreResult.reason) {
                console.log(`.gitignore not updated: ${gitignoreResult.reason}`);
              } else {
                console.log('.gitignore: no changes required');
              }
            }

          console.log('\n' + chalk.blue('## Git Hooks') + '\n');
            const hookResult = installPrePushHook({ silent: false });
            const postPullResult = installPostPullHooks({ silent: true });
            if (hookResult.present) {
              if (hookResult.hookPath) {
                console.log(`Git pre-push hook: installed at ${hookResult.hookPath}`);
              } else {
                console.log('Git pre-push hook: present');
              }
            } else {
              console.log('Git pre-push hook: not present');
            }
            if (!hookResult.installed && hookResult.reason && hookResult.reason !== 'hook already installed') {
              console.log(`\ngit pre-push hook not installed: ${hookResult.reason}`);
            }
            if (postPullResult && postPullResult.installed) {
              console.log(`Git post-pull hooks: installed at ${postPullResult.hookPaths?.join(', ')}`);
            } else if (postPullResult && postPullResult.skipped) {
              // ok
            } else if (postPullResult && postPullResult.reason) {
              console.log(`Git post-pull hooks: not installed: ${postPullResult.reason}`);
            }

          console.log('\n' + chalk.blue('## Agent Template') + '\n');
          const agentTemplateResult = await ensureAgentTemplateInstalled({ silent: false });
          if (!agentTemplateResult.installed && agentTemplateResult.reason && agentTemplateResult.reason !== 'template already in place') {
            console.log(`Note: AGENTS template not installed: ${agentTemplateResult.reason}`);
          }
        }
      } catch (error) {
        output.error('Error: ' + (error as Error).message, { success: false, error: (error as Error).message });
        process.exit(1);
      }
    });
}
