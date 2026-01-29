/**
 * Create command - Create a new work item
 */

import type { PluginContext } from '../plugin-types.js';
import type { CreateOptions } from '../cli-types.js';
import type { WorkItemStatus, WorkItemPriority, WorkItemRiskLevel, WorkItemEffortLevel } from '../types.js';
import { humanFormatWorkItem, resolveFormat } from './helpers.js';
import { promises as fs } from 'fs';

export default function register(ctx: PluginContext): void {
  const { program, output, utils } = ctx;
  
  program
    .command('create')
    .description('Create a new work item')
    .requiredOption('-t, --title <title>', 'Title of the work item')
    .option('-d, --description <description>', 'Description of the work item', '')
    .option('--description-file <file>', 'Read description from a file')
    .option('-s, --status <status>', 'Status (open, in-progress, completed, blocked, deleted)', 'open')
    .option('-p, --priority <priority>', 'Priority (low, medium, high, critical)', 'medium')
    .option('-P, --parent <parentId>', 'Parent work item ID')
    .option('--tags <tags>', 'Comma-separated list of tags')
    .option('-a, --assignee <assignee>', 'Assignee of the work item')
    .option('--stage <stage>', 'Stage of the work item in the workflow')
    .option('--risk <risk>', 'Risk level (Low, Medium, High, Severe)')
    .option('--effort <effort>', 'Effort level (XS, S, M, L, XL)')
    .option('--issue-type <issueType>', 'Issue type (interoperability field)')
    .option('--created-by <createdBy>', 'Created by (interoperability field)')
    .option('--deleted-by <deletedBy>', 'Deleted by (interoperability field)')
    .option('--delete-reason <deleteReason>', 'Delete reason (interoperability field)')
    .option('--prefix <prefix>', 'Override the default prefix')
    .action(async (options: CreateOptions) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);

      let description = options.description || '';
      if (options.descriptionFile) {
        try {
          description = await fs.readFile(options.descriptionFile, 'utf8');
        } catch (err) {
          // Print a helpful error and exit with failure
          console.error(`Failed to read description file: ${options.descriptionFile}`);
          process.exit(1);
        }
      }

      const item = db.createWithNextSortIndex({
        title: options.title,
        description: description,
        status: (options.status || 'open') as WorkItemStatus,
        priority: (options.priority || 'medium') as WorkItemPriority,
        parentId: utils.normalizeCliId(options.parent, options.prefix) || null,
        tags: options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [],
        assignee: options.assignee || '',
        stage: options.stage || '',
        risk: (options.risk || '') as WorkItemRiskLevel | '',
        effort: (options.effort || '') as WorkItemEffortLevel | '',
        issueType: options.issueType || '',
        createdBy: options.createdBy || '',
        deletedBy: options.deletedBy || '',
        deleteReason: options.deleteReason || '',
      });
      
      if (utils.isJsonMode()) {
        output.json({ success: true, workItem: item });
      } else {
        const format = resolveFormat(program);
        console.log(humanFormatWorkItem(item, db, format));
      }
    });
}
