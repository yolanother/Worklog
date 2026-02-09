/**
 * Doctor command - Validate work items against config rules
 */

import type { PluginContext } from '../plugin-types.js';
import { loadStatusStageRules } from '../status-stage-rules.js';
import { validateStatusStageItems } from '../doctor/status-stage-check.js';
import { validateDependencyEdges } from '../doctor/dependency-check.js';

interface DoctorOptions {
  prefix?: string;
}

export default function register(ctx: PluginContext): void {
  const { program, output, utils } = ctx;

  program
    .command('doctor')
    .description('Validate work items against status/stage config rules')
    .option('--prefix <prefix>', 'Override the default prefix')
    .action((options: DoctorOptions) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);
      const items = db.getAll();
      let rules;
      try {
        rules = loadStatusStageRules(utils.getConfig());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.error(message, { success: false, error: message });
        process.exit(1);
      }

      const dependencyEdges = db.getAllDependencyEdges();
      const findings = [
        ...validateStatusStageItems(items, rules),
        ...validateDependencyEdges(items, dependencyEdges),
      ];

      if (utils.isJsonMode()) {
        output.json(findings);
        return;
      }

      if (findings.length === 0) {
        console.log('Doctor: no issues found.');
        return;
      }

      console.log('Doctor: validation findings');
      console.log('Rules source: docs/validation/status-stage-inventory.md');
      const byItem = new Map<string, typeof findings>();
      for (const finding of findings) {
        const existing = byItem.get(finding.itemId) || [];
        existing.push(finding);
        byItem.set(finding.itemId, existing);
      }

      for (const [itemId, itemFindings] of byItem.entries()) {
        console.log(`\n${itemId}`);
        for (const finding of itemFindings) {
          console.log(`  - ${finding.message}`);
          if (finding.proposedFix) {
            console.log(`    Suggested: ${JSON.stringify(finding.proposedFix)}`);
          }
        }
      }
    });
}
