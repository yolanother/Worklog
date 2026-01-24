/**
 * Import command - Import work items and comments from JSONL file
 */

import type { PluginContext } from '../plugin-types.js';
import type { ImportOptions } from '../cli-types.js';
import { importFromJsonl } from '../jsonl.js';

export default function register(ctx: PluginContext): void {
  const { program, dataPath, output, utils } = ctx;
  
  program
    .command('import')
    .description('Import work items and comments from JSONL file')
    .option('-f, --file <filepath>', 'Input file path', dataPath)
    .option('--prefix <prefix>', 'Override the default prefix')
    .action((options: ImportOptions) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);
      const { items, comments } = importFromJsonl(options.file || dataPath);
      db.import(items);
      db.importComments(comments);
      
      if (utils.isJsonMode()) {
        output.json({ 
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
}
