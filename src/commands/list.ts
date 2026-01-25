/**
 * List command - List work items
 */

import type { PluginContext } from '../plugin-types.js';
import type { ListOptions } from '../cli-types.js';
import type { WorkItemQuery, WorkItemStatus, WorkItemPriority } from '../types.js';
import { displayItemTree, humanFormatWorkItem, resolveFormat, sortByPriorityAndDate } from './helpers.js';

export default function register(ctx: PluginContext): void {
  const { program, output, utils } = ctx;
  
  program
    .command('list')
    .description('List work items')
    .argument('[search]', 'Search term (matches title and description)')
    .option('-s, --status <status>', 'Filter by status')
    .option('-p, --priority <priority>', 'Filter by priority')
    
    .option('-n, --number <n>', 'Limit the number of items returned')
    .option('--tags <tags>', 'Filter by tags (comma-separated)')
    .option('-a, --assignee <assignee>', 'Filter by assignee')
    .option('--stage <stage>', 'Filter by stage')
    .option('--prefix <prefix>', 'Override the default prefix')
    .action((search: string | undefined, options: ListOptions) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options?.prefix);
      
      const query: WorkItemQuery = {};
      if (options.status) query.status = options.status as WorkItemStatus;
      if (options.priority) query.priority = options.priority as WorkItemPriority;
      
      if (options.tags) {
        query.tags = options.tags.split(',').map((t: string) => t.trim());
      }
      if (options.assignee) query.assignee = options.assignee;
      if (options.stage) query.stage = options.stage;
      
      let items = db.list(query);

      // Apply --number/-n limit when provided (only for human or JSON output)
      const numRequested = options.number ? parseInt(options.number as any, 10) : NaN;
      const limit = Number.isNaN(numRequested) || numRequested < 1 ? undefined : numRequested;

      // By default hide completed items for human-readable output only.
      // When JSON mode is requested return all matching items so callers
      // can decide how to handle completed items programmatically.
      if (!options.status && !utils.isJsonMode()) {
        items = items.filter(item => item.status !== 'completed');
      }

      if (search) {
        const lower = String(search).toLowerCase();
        items = items.filter(item => {
          const titleMatch = item.title && item.title.toLowerCase().includes(lower);
          const descMatch = item.description && item.description.toLowerCase().includes(lower);
          return Boolean(titleMatch || descMatch);
        });
      }
      
      // Sort then apply limit so we return the highest priority / oldest as intended
      const sortedAll = items.slice().sort(sortByPriorityAndDate);
      const limited = limit ? sortedAll.slice(0, limit) : sortedAll;

      if (utils.isJsonMode()) {
        output.json({ success: true, count: limited.length, workItems: limited });
      } else {
        if (items.length === 0) {
          console.log('No work items found');
          return;
        }

        const displayItems = limited;
        console.log(`Found ${displayItems.length} work item(s):\n`);
        const format = resolveFormat(program);
        if (format.toLowerCase() === 'concise') {
          console.log('');
          displayItemTree(displayItems);
          console.log('');
          return;
        }

        const sortedItems = displayItems;
        console.log('');
        sortedItems.forEach((item, index) => {
          console.log(humanFormatWorkItem(item, null, format));
          if (index < sortedItems.length - 1) console.log('');
        });
        console.log('');
      }
    });
}
