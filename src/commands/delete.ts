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
      
      const normalizedId = utils.normalizeCliId(id, options.prefix) || id;
      const existing = db.get(normalizedId);
      const deleted = db.delete(normalizedId);
      if (!deleted) {
        output.error(`Work item not found: ${normalizedId}`, { success: false, error: `Work item not found: ${normalizedId}` });
        process.exit(1);
      }
      
      if (utils.isJsonMode()) {
        output.json({
          success: true,
          message: `Deleted work item: ${normalizedId}`,
          deletedId: normalizedId,
          deletedWorkItem: existing || undefined,
        });
      } else {
        console.log(`Deleted work item: ${normalizedId}`);
      }
    });
}
