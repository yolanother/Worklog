/**
 * Update command - Update a work item
 */

import type { PluginContext } from '../plugin-types.js';
import type { UpdateOptions } from '../cli-types.js';
import type { UpdateWorkItemInput, WorkItemStatus, WorkItemPriority, WorkItemRiskLevel, WorkItemEffortLevel } from '../types.js';
import { humanFormatWorkItem, resolveFormat } from './helpers.js';

export default function register(ctx: PluginContext): void {
  const { program, output, utils } = ctx;
  
  program
    .command('update <id>')
    .description('Update a work item')
    .option('-t, --title <title>', 'New title')
    .option('-d, --description <description>', 'New description')
    .option('-s, --status <status>', 'New status')
    .option('-p, --priority <priority>', 'New priority')
    .option('-P, --parent <parentId>', 'New parent ID')
    .option('--tags <tags>', 'New tags (comma-separated)')
    .option('-a, --assignee <assignee>', 'New assignee')
    .option('--stage <stage>', 'New stage')
    .option('--risk <risk>', 'New risk level (Low, Medium, High, Severe)')
    .option('--effort <effort>', 'New effort level (XS, S, M, L, XL)')
    .option('--issue-type <issueType>', 'New issue type (interoperability field)')
    .option('--created-by <createdBy>', 'New created by (interoperability field)')
    .option('--deleted-by <deletedBy>', 'New deleted by (interoperability field)')
    .option('--delete-reason <deleteReason>', 'New delete reason (interoperability field)')
    .option('--prefix <prefix>', 'Override the default prefix')
    .action((id: string, options: UpdateOptions) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);
      const updates: UpdateWorkItemInput = {};
      if (options.title) updates.title = options.title;
      if (options.description) updates.description = options.description;
      if (options.status) updates.status = options.status as WorkItemStatus;
      if (options.priority) updates.priority = options.priority as WorkItemPriority;
      if (options.parent !== undefined) updates.parentId = options.parent;
      
      if (options.tags) updates.tags = options.tags.split(',').map((t: string) => t.trim());
      if (options.assignee !== undefined) updates.assignee = options.assignee;
      if (options.stage !== undefined) updates.stage = options.stage;
      if (options.risk !== undefined) updates.risk = options.risk as WorkItemRiskLevel | '';
      if (options.effort !== undefined) updates.effort = options.effort as WorkItemEffortLevel | '';
      if (options.issueType !== undefined) updates.issueType = options.issueType;
      if (options.createdBy !== undefined) updates.createdBy = options.createdBy;
      if (options.deletedBy !== undefined) updates.deletedBy = options.deletedBy;
      if (options.deleteReason !== undefined) updates.deleteReason = options.deleteReason;
      
      const item = db.update(id, updates);
      if (!item) {
        output.error(`Work item not found: ${id}`, { success: false, error: `Work item not found: ${id}` });
        process.exit(1);
      }
      
      if (utils.isJsonMode()) {
        output.json({ success: true, workItem: item });
      } else {
        const format = resolveFormat(program);
        console.log('Updated work item:');
        console.log(humanFormatWorkItem(item, db, format));
      }
    });
}
