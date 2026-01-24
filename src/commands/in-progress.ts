/**
 * In-progress command - List all in-progress work items
 */

import type { PluginContext } from '../plugin-types.js';
import type { InProgressOptions } from '../cli-types.js';
import type { WorkItemQuery, WorkItemStatus } from '../types.js';
import { displayItemTree } from './helpers.js';

export default function register(ctx: PluginContext): void {
  const { program, output, utils } = ctx;
  
  program
    .command('in-progress')
    .description('List all in-progress work items in a tree layout showing dependencies')
    .option('-a, --assignee <assignee>', 'Filter by assignee')
    .option('--prefix <prefix>', 'Override the default prefix')
    .action((options: InProgressOptions) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);
      
      const query: WorkItemQuery = { status: 'in-progress' as WorkItemStatus };
      if (options.assignee) {
        query.assignee = options.assignee;
      }
      const items = db.list(query);
      
      if (utils.isJsonMode()) {
        output.json({ success: true, count: items.length, workItems: items });
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
}
