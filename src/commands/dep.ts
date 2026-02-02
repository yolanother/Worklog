/**
 * Dependency commands - Manage dependency edges
 */

import type { PluginContext } from '../plugin-types.js';
import type { DepOptions } from '../cli-types.js';

export default function register(ctx: PluginContext): void {
  const { program, output, utils } = ctx;

  const depCommand = program
    .command('dep')
    .description('Manage dependency edges');

  depCommand
    .command('add <itemId> <dependsOnId>')
    .description('Add a dependency edge (item depends on dependsOn)')
    .option('--prefix <prefix>', 'Override the default prefix')
    .action((itemId: string, dependsOnId: string, options: DepOptions) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);
      const normalizedItemId = utils.normalizeCliId(itemId, options.prefix) || itemId;
      const normalizedDependsOnId = utils.normalizeCliId(dependsOnId, options.prefix) || dependsOnId;

      const warnings: string[] = [];
      const item = db.get(normalizedItemId);
      const dependsOn = db.get(normalizedDependsOnId);
      if (!item) warnings.push(`Work item not found: ${normalizedItemId}`);
      if (!dependsOn) warnings.push(`Work item not found: ${normalizedDependsOnId}`);

      if (warnings.length > 0) {
        if (utils.isJsonMode()) {
          output.json({ success: true, warnings, edge: null });
        } else {
          warnings.forEach(w => console.warn(`Warning: ${w}`));
        }
        return;
      }

      const edge = db.addDependencyEdge(normalizedItemId, normalizedDependsOnId);
      if (utils.isJsonMode()) {
        output.json({ success: true, edge });
      } else {
        console.log(`Added dependency: ${normalizedItemId} depends on ${normalizedDependsOnId}`);
      }
    });

  depCommand
    .command('rm <itemId> <dependsOnId>')
    .description('Remove a dependency edge (item depends on dependsOn)')
    .option('--prefix <prefix>', 'Override the default prefix')
    .action((itemId: string, dependsOnId: string, options: DepOptions) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);
      const normalizedItemId = utils.normalizeCliId(itemId, options.prefix) || itemId;
      const normalizedDependsOnId = utils.normalizeCliId(dependsOnId, options.prefix) || dependsOnId;

      const warnings: string[] = [];
      const item = db.get(normalizedItemId);
      const dependsOn = db.get(normalizedDependsOnId);
      if (!item) warnings.push(`Work item not found: ${normalizedItemId}`);
      if (!dependsOn) warnings.push(`Work item not found: ${normalizedDependsOnId}`);

      if (warnings.length > 0) {
        if (utils.isJsonMode()) {
          output.json({ success: true, warnings, removed: false, edge: null });
        } else {
          warnings.forEach(w => console.warn(`Warning: ${w}`));
        }
        return;
      }

      const removed = db.removeDependencyEdge(normalizedItemId, normalizedDependsOnId);
      if (utils.isJsonMode()) {
        output.json({ success: true, removed, edge: { fromId: normalizedItemId, toId: normalizedDependsOnId } });
      } else if (removed) {
        console.log(`Removed dependency: ${normalizedItemId} depends on ${normalizedDependsOnId}`);
      } else {
        console.log(`No dependency found: ${normalizedItemId} depends on ${normalizedDependsOnId}`);
      }
    });
}
