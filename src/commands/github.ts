/**
 * GitHub command - GitHub Issue sync commands (push and import)
 */

import type { PluginContext } from '../plugin-types.js';
import { getRepoFromGitRemote, normalizeGithubLabelPrefix } from '../github.js';
import { upsertIssuesFromWorkItems, importIssuesToWorkItems, GithubProgress } from '../github-sync.js';
import { loadConfig } from '../config.js';
import { displayConflictDetails } from './helpers.js';
import { createLogFileWriter, getWorklogLogPath, logConflictDetails } from '../logging.js';

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

export default function register(ctx: PluginContext): void {
  const { program, output, utils } = ctx;
  
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
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);
      const isJsonMode = utils.isJsonMode();
      const isVerbose = program.opts().verbose;
      let lastProgress = '';
      let lastProgressLength = 0;
      const logLine = createLogFileWriter(getWorklogLogPath('github_sync.log'));
      logLine(`--- github push start ${new Date().toISOString()} ---`);
      logLine(`Options json=${isJsonMode} verbose=${isVerbose}`);

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
        const repoUrl = `https://github.com/${githubConfig.repo}/issues`;
        if (!isJsonMode) {
          console.log(`Pushing to ${repoUrl}`);
        }
        const items = db.getAll();
        const comments = db.getAllComments();

        const verboseLog = isVerbose && !isJsonMode
          ? (message: string) => console.log(message)
          : undefined;
        const { updatedItems, result, timing } = upsertIssuesFromWorkItems(
          items,
          comments,
          githubConfig,
          renderProgress,
          verboseLog
        );
        if (updatedItems.length > 0) {
          db.import(updatedItems);
        }

        logLine(`Repo ${githubConfig.repo}`);
        logLine(`Push summary created=${result.created} updated=${result.updated} skipped=${result.skipped}`);
        if ((result.commentsCreated || 0) > 0 || (result.commentsUpdated || 0) > 0) {
          logLine(`Comment summary created=${result.commentsCreated || 0} updated=${result.commentsUpdated || 0}`);
        }
        if (result.errors.length > 0) {
          logLine(`Errors (${result.errors.length}): ${result.errors.join(' | ')}`);
        }
        logLine(`Timing totalMs=${timing.totalMs} upsertMs=${timing.upsertMs} commentListMs=${timing.commentListMs} commentUpsertMs=${timing.commentUpsertMs}`);
        logLine(`Timing hierarchyCheckMs=${timing.hierarchyCheckMs} hierarchyLinkMs=${timing.hierarchyLinkMs} hierarchyVerifyMs=${timing.hierarchyVerifyMs}`);

        if (isJsonMode) {
          output.json({ success: true, ...result, repo: githubConfig.repo });
        } else {
          console.log(`GitHub sync complete (${githubConfig.repo})`);
          console.log(`  Created: ${result.created}`);
          console.log(`  Updated: ${result.updated}`);
          console.log(`  Skipped: ${result.skipped}`);
          if ((result.commentsCreated || 0) > 0 || (result.commentsUpdated || 0) > 0) {
            console.log(`  Comments created: ${result.commentsCreated || 0}`);
            console.log(`  Comments updated: ${result.commentsUpdated || 0}`);
          }
          if (result.errors.length > 0) {
            console.log(`  Errors: ${result.errors.length}`);
            console.log('  Hint: re-run with --json to view error details');
          }
          if (isVerbose) {
            console.log('  Timing breakdown:');
            console.log(`    Total: ${(timing.totalMs / 1000).toFixed(2)}s`);
            console.log(`    Issue upserts: ${(timing.upsertMs / 1000).toFixed(2)}s`);
            console.log(`    Comment list: ${(timing.commentListMs / 1000).toFixed(2)}s`);
            console.log(`    Comment upserts: ${(timing.commentUpsertMs / 1000).toFixed(2)}s`);
            console.log(`    Hierarchy check: ${(timing.hierarchyCheckMs / 1000).toFixed(2)}s`);
            console.log(`    Hierarchy link: ${(timing.hierarchyLinkMs / 1000).toFixed(2)}s`);
            console.log(`    Hierarchy verify: ${(timing.hierarchyVerifyMs / 1000).toFixed(2)}s`);
          }
        }
        logLine(`--- github push end ${new Date().toISOString()} ---`);
      } catch (error) {
        logLine(`GitHub sync failed: ${(error as Error).message}`);
        output.error(`GitHub sync failed: ${(error as Error).message}`, { success: false, error: (error as Error).message });
        process.exit(1);
      }
    });

  githubCommand
    .command('import')
    .description('Import updates from GitHub Issues')
    .option('--repo <owner/name>', 'GitHub repo (owner/name)')
    .option('--label-prefix <prefix>', 'Label prefix for Worklog labels (default: wl:)')
    .option('--since <iso>', 'Only import issues updated since ISO timestamp')
    .option('--create-new', 'Create new work items for issues without markers')
    .option('--prefix <prefix>', 'Override the default prefix')
    .action((options) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);
      const isJsonMode = utils.isJsonMode();
      const isVerbose = program.opts().verbose;
      let lastProgress = '';
      let lastProgressLength = 0;
      const logLine = createLogFileWriter(getWorklogLogPath('github_sync.log'));
      logLine(`--- github import start ${new Date().toISOString()} ---`);
      logLine(`Options json=${isJsonMode} verbose=${isVerbose} createNew=${options.createNew ?? ''} since=${options.since || ''}`);

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
        const repoUrl = `https://github.com/${githubConfig.repo}/issues`;
        if (!isJsonMode) {
          console.log(`Importing from ${repoUrl}`);
        }
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

        logLine(`Repo ${githubConfig.repo}`);
        logLine(`Import summary updated=${updatedItems.length} created=${createdItems.length} totalIssues=${issues.length} markers=${markersFound}`);
        logLine(`Import config createNew=${createNew} since=${options.since || ''}`);
        logConflictDetails(
          {
            itemsAdded: createdItems.length,
            itemsUpdated: updatedItems.length,
            itemsUnchanged: Math.max(items.length - updatedIds.size, 0),
            commentsAdded: 0,
            commentsUnchanged: 0,
            conflicts: conflictDetails.conflicts,
            conflictDetails: conflictDetails.conflictDetails,
          },
          mergedItems,
          logLine,
          { repoUrl: `https://github.com/${githubConfig.repo}` }
        );

        if (isJsonMode) {
          output.json({
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
          if (isVerbose) {
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
              mergedItems,
              { repoUrl: `https://github.com/${githubConfig.repo}` }
            );
          }
        }
        logLine(`--- github import end ${new Date().toISOString()} ---`);
      } catch (error) {
        logLine(`GitHub import failed: ${(error as Error).message}`);
        output.error(`GitHub import failed: ${(error as Error).message}`, { success: false, error: (error as Error).message });
        process.exit(1);
      }
    });
}
