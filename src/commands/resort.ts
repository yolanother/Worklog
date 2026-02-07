/**
 * Resort command - recompute sort_index ordering
 */

import type { PluginContext } from '../plugin-types.js';
import type { ResortOptions } from '../cli-types.js';

const DEFAULT_SORT_GAP = 100;

export default function register(ctx: PluginContext): void {
  const { program, output, utils } = ctx;

  program
    .command('resort')
    .description('Recompute sort_index values for active work items from current database state')
    .option('--dry-run', 'Preview changes without writing to the database')
    .option('--gap <gap>', `Gap between sort_index values (default: ${DEFAULT_SORT_GAP})`, String(DEFAULT_SORT_GAP))
    .option('--prefix <prefix>', 'Override the default prefix')
    .action((options: ResortOptions) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);
      const dryRun = Boolean(options.dryRun);
      const gap = parseInt(options.gap || String(DEFAULT_SORT_GAP), 10);

      if (Number.isNaN(gap) || gap <= 0) {
        output.error('Gap must be a positive integer', { success: false, error: 'Gap must be a positive integer' });
        process.exit(1);
      }

      const ordered = db
        .getAllOrderedByHierarchySortIndex()
        .filter(item => item.status !== 'completed' && item.status !== 'deleted');

      if (dryRun) {
        const preview = db.previewSortIndexOrderForItems(ordered, gap);
        if (utils.isJsonMode()) {
          output.json({ success: true, dryRun: true, gap, count: preview.length, items: preview });
          return;
        }

        console.log(`Dry run: ${preview.length} item(s) would be updated.`);
        preview.forEach((entry: { id: string; title: string; sortIndex: number }) => {
          console.log(`${entry.id} ${entry.title} -> ${entry.sortIndex}`);
        });
        return;
      }

      const result = db.assignSortIndexValuesForItems(ordered, gap);
      if (utils.isJsonMode()) {
        output.json({ success: true, updated: result.updated, gap });
        return;
      }
      console.log(`Resort complete. Updated ${result.updated} item(s).`);
    });
}
