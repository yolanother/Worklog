/**
 * Delete command - Delete a work item
 */

import type { PluginContext } from '../plugin-types.js';
import type { DeleteOptions } from '../cli-types.js';

export default function register(ctx: PluginContext): void {
  const { program, output, utils } = ctx;
  
  program
    .command('delete <id>')
    .description('Delete a work item')
    .option('--prefix <prefix>', 'Override the default prefix')
    .action((id: string, options: DeleteOptions) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);
      
      const deleted = db.delete(id);
      if (!deleted) {
        output.error(`Work item not found: ${id}`, { success: false, error: `Work item not found: ${id}` });
        process.exit(1);
      }
      
      if (utils.isJsonMode()) {
        output.json({ success: true, message: `Deleted work item: ${id}`, deletedId: id });
      } else {
        console.log(`Deleted work item: ${id}`);
      }
    });
}
