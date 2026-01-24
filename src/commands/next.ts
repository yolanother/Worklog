/**
 * Next command - Find the next work item to work on
 */

import type { PluginContext } from '../plugin-types.js';
import type { NextOptions } from '../cli-types.js';
import { humanFormatWorkItem, resolveFormat, formatTitleAndId } from './helpers.js';
import chalk from 'chalk';

export default function register(ctx: PluginContext): void {
  const { program, output, utils } = ctx;
  
  program
    .command('next')
    .description('Find the next work item to work on based on priority and status')
    .option('-a, --assignee <assignee>', 'Filter by assignee')
    .option('-s, --search <term>', 'Search term for fuzzy matching against title, description, and comments')
    .option('-n, --number <n>', 'Number of items to return (default: 1)', '1')
    .option('--prefix <prefix>', 'Override the default prefix')
    .action(async (options: NextOptions) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);
      const numRequested = parseInt(options.number || '1', 10);
      const count = Number.isNaN(numRequested) || numRequested < 1 ? 1 : numRequested;

      const results = (db as any).findNextWorkItems 
        ? (db as any).findNextWorkItems(count, options.assignee, options.search) 
        : [db.findNextWorkItem(options.assignee, options.search)];

      if (utils.isJsonMode()) {
        if (results.length === 1) {
          const single = results[0];
          output.json({ success: true, workItem: single.workItem, reason: single.reason });
          return;
        }

        output.json({ success: true, count: results.length, results });
        return;
      }

      if (!results || results.length === 0) {
        console.log('No work items found to work on.');
        return;
      }

      const chosenFormat = resolveFormat(program);
      if (results.length === 1) {
        const result = results[0];
        if (!result.workItem) {
          console.log('No work items found to work on.');
          if (result.reason) console.log(`Reason: ${result.reason}`);
          return;
        }

        console.log('\nNext work item to work on:');
        console.log('==========================\n');
        console.log(humanFormatWorkItem(result.workItem, db, chosenFormat));
        console.log(`\nReason:      ${chalk.cyan(result.reason)}`);
        console.log('\n');
        console.log(`Work item ID: ${chalk.green.bold(result.workItem.id)}`);
        console.log(`(Copy the ID above to use it in other commands)`);
        return;
      }

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
}
