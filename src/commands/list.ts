/**
 * List command - List work items
 */

import type { PluginContext } from '../plugin-types.js';
import type { ListOptions } from '../cli-types.js';
import type { WorkItemQuery, WorkItemStatus, WorkItemPriority } from '../types.js';
import { displayItemTree } from './helpers.js';

export default function register(ctx: PluginContext): void {
  const { program, output, utils } = ctx;
  
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
      utils.requireInitialized();
      const db = utils.getDatabase(options?.prefix);
      
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

      if (!options.status) {
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
      
      if (utils.isJsonMode()) {
        output.json({ success: true, count: items.length, workItems: items });
      } else {
        if (items.length === 0) {
          console.log('No work items found');
          return;
        }

        console.log(`Found ${items.length} work item(s):\n`);
        console.log('');
        displayItemTree(items);
        console.log('');
      }
    });
}
