/**
 * Sync command - Sync work items with git repository
 */

import type { PluginContext } from '../plugin-types.js';
import type { SyncOptions } from '../cli-types.js';
import type { WorkItem, Comment } from '../types.js';
import type { GitTarget, SyncResult } from '../sync.js';
import { getRemoteDataFileContent, gitPushDataFileToBranch, mergeWorkItems, mergeComments } from '../sync.js';
import { DEFAULT_GIT_REMOTE, DEFAULT_GIT_BRANCH } from '../sync-defaults.js';
import { importFromJsonlContent, exportToJsonl } from '../jsonl.js';
import { loadConfig } from '../config.js';
import { displayConflictDetails } from './helpers.js';

function getSyncDefaults(config?: ReturnType<typeof loadConfig>) {
  return {
    gitRemote: config?.syncRemote || DEFAULT_GIT_REMOTE,
    gitBranch: config?.syncBranch || DEFAULT_GIT_BRANCH,
  };
}

async function performSync(
  program: any,
  dataPath: string,
  getDatabase: (prefix?: string) => any,
  options: {
    file: string;
    prefix?: string;
    gitRemote: string;
    gitBranch: string;
    push: boolean;
    dryRun: boolean;
    silent?: boolean;
  }
): Promise<SyncResult> {
  const isJsonMode = program.opts().json;
  const isSilent = options.silent || false;
  
  const db = getDatabase(options.prefix);
  const localItems = db.getAll();
  const localComments = db.getAllComments();
  
  if (!isJsonMode && !isSilent) {
    console.log(`Starting sync for ${options.file}...`);
    console.log(`Local state: ${localItems.length} work items, ${localComments.length} comments`);
    
    if (options.dryRun) {
      console.log('\n[DRY RUN MODE - No changes will be made]');
    }
    
    console.log('\nPulling latest changes from git...');
  }
  
  const gitTarget: GitTarget = {
    remote: options.gitRemote,
    branch: options.gitBranch,
  };

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
  
  if (!isJsonMode && !isSilent) {
    console.log('\nMerging work items...');
  }
  const itemMergeResult = mergeWorkItems(localItems, remoteItems);
  
  if (!isJsonMode && !isSilent) {
    console.log('Merging comments...');
  }
  const commentMergeResult = mergeComments(localComments, remoteComments);
  
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
      console.log(JSON.stringify({
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
      }, null, 2));
      return result;
    }
  } else if (!isSilent) {
    displayConflictDetails(result, itemMergeResult.merged);
    
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
  
  const config = loadConfig();
  const autoSyncEnabled = config?.autoSync === true;
  if (autoSyncEnabled) {
    db.setAutoSync(false);
  }
  db.import(itemMergeResult.merged);
  db.importComments(commentMergeResult.merged);
  if (autoSyncEnabled) {
    db.setAutoSync(true, () => Promise.resolve());
  }
  
  if (!isJsonMode && !isSilent) {
    console.log('\nMerged data saved locally');
  }

  exportToJsonl(itemMergeResult.merged, commentMergeResult.merged, options.file);
  
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
    console.log(JSON.stringify({
      success: true,
      message: 'Sync completed successfully',
      sync: {
        file: options.file,
        summary: result,
        pushed: options.push
      }
    }, null, 2));
  } else if (!isSilent) {
    console.log('\n✓ Sync completed successfully');
  }
  
  return result;
}

export default function register(ctx: PluginContext): void {
  const { program, dataPath, output, utils } = ctx;
  
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
      utils.requireInitialized();
      const isJsonMode = utils.isJsonMode();

      const config = utils.getConfig();
      const defaults = getSyncDefaults(config || undefined);
      const gitRemote = options.gitRemote || defaults.gitRemote;
      const gitBranch = options.gitBranch || defaults.gitBranch;
      
      try {
        await performSync(program, dataPath, utils.getDatabase, {
          file: options.file || dataPath,
          prefix: options.prefix,
          gitRemote,
          gitBranch,
          push: options.push ?? true,
          dryRun: options.dryRun ?? false,
          silent: false
        });
      } catch (error) {
        if (isJsonMode) {
          output.json({
            success: false,
            error: (error as Error).message
          });
        } else {
          console.error('\n✗ Sync failed:', (error as Error).message);
        }
        process.exit(1);
      }
    });
}
