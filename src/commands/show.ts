/**
 * Show command - Show details of a work item
 */

import type { PluginContext } from '../plugin-types.js';
import type { ShowOptions } from '../cli-types.js';
import { displayItemTree, humanFormatComment, resolveFormat } from './helpers.js';

export default function register(ctx: PluginContext): void {
  const { program, output, utils } = ctx;
  
  program
    .command('show <id>')
    .description('Show details of a work item')
    .option('-c, --children', 'Also show children')
    .option('--prefix <prefix>', 'Override the default prefix')
    .action((id: string, options: ShowOptions) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);
      
      const item = db.get(id);
      if (!item) {
        output.error(`Work item not found: ${id}`, { success: false, error: `Work item not found: ${id}` });
        process.exit(1);
      }
      
      if (utils.isJsonMode()) {
        const result: any = { success: true, workItem: item };
        result.comments = db.getCommentsForWorkItem(id);
        if (options.children) {
          const children = db.getChildren(id);
          result.children = children;
        }
        output.json(result);
        return;
      }

      if (options.children) {
        const itemsToDisplay = [item, ...db.getDescendants(id)];
        console.log('');
        displayItemTree(itemsToDisplay);
        console.log('');

        const comments = db.getCommentsForWorkItem(id);
        if (comments.length > 0) {
          console.log('Comments:');
          comments.forEach(c => {
            console.log(humanFormatComment(c, resolveFormat(program)));
            console.log('');
          });
        }
        return;
      }

      const chosenFormat = resolveFormat(program);
      console.log('');
      displayItemTree([item]);
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
}
