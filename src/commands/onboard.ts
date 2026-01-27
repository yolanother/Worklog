/**
 * Onboard command - Generate repo-local instructions/config for consistent agent and contributor setup
 */

import type { PluginContext } from '../plugin-types.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// AGENTS.md template content
const AGENTS_MD_TEMPLATE = `## work-item Tracking with Worklog (wl)

IMPORTANT: This project uses Worklog (wl) for ALL work-item tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

## CRITICAL RULES

- Use Worklog (wl), described below, for ALL task tracking, do NOT use markdown TODOs, task lists, or other tracking methods
- Whenever you are provided with, or discover, a new work item create it in wl immediately
- Whenever you are provided with or discover important context (specifications, designs, user-stories) ensure the information is added to the description of the relevant work item(s) OR create a new work item if none exist
- Whenever you create a planning document (PRD, spec, design doc) add references to the document in the description of any work item that is directly related to the document
- Work items cannot be closed until all child items are closed, all blocking dependencies resolved and a Producer has reviewed and approved the work
- Never commit changes without associating them with a work item
- Never commit changes without ensuring all tests and quality checks pass
- Whenever a comment is made add a comment to impacted the work item(s) describing the changes, the files affected, and including the commit hash.
- Never push changes until all work items associated with the changes are closed
- If push fails, resolve and retry until it succeeds
- When using backticks in arguments to shell commands, escape them properly to avoid errors

### Important Rules

- Use wl as a primary source of truth, only the source code is more authoritative
- Always use \`--json\` flag for programmatic use
- When new work items are discovered or prompted while working on an existing item create a new work item with \`wl create\`
  - If the item must be completed before the current work item can be completed add it as a child of the current item (\`wl create --parent <current-work-item-id>\`)
  - If the item is related to the current work item but not blocking its completion add a reference to the current item in the description (\`discovered-from:<current-work-item-id>\`)
- Check \`wl next\` before asking "what should I work on?" and always offer the response as a next steps suggestion, with an explanation
- Run \`wl --help\` and \`wl <cmd> --help\` to learn about the capabilities of WorkLog (wl) and discover available flags
- Use work items to track all significant work, including bugs, features, tasks, epics, chores
- Use clear, concise titles and detailed descriptions for all work items
- Use parent/child relationships to track dependencies and subtasks
- Use priorities to indicate the importance of work items
- Use stages to track workflow progress
- Do NOT clutter repo root with planning documents

### work-item Types

Track work-item types with \`--issue-type\`:

- bug - Something broken
- feature - New functionality
- task - Work item (tests, docs, refactoring)
- epic - Large feature with subtasks
- chore - Maintenance (dependencies, tooling)

### Work Item Descriptions

- Use clear, concise titles summarizing the work item.
- Do not escape special characters
- The description must provide sufficient context for understanding and implementing the work item.
- At a minimum include:
  - A summary of the problem or feature.
  - Example User Stories if applicable.
  - Expected behaviour and outcomes.
  - Steps to reproduce (for bugs).
  - Suggested implementation approach if relevant.
  - Links to related work items or documentation.
  - Measurable and testable acceptance criteria.

### Priorities

Worklog uses named priorities:

- critical - Security, data loss, broken builds
- high - Major features, important bugs
- medium - Default, nice-to-have
- low - Polish, optimization

### Dependencies

Use parent/child relationships to track blocking dependencies.

- Child items must be completed before the parent can be closed.
- If a work item blocks another, make it a child of the blocked item.
- If a work item blocks multiple items, create the parent/child relationships with the highest priority item as the parent unless one of the items is in-progress, in which case that item should be the parent.
  - If in doubt raise for product manager review.

Other types of dependencies can be tracked in descriptions, for example \`discovered-from:<work-item-id>\`, \`related-to:<work-item-id>\`, \`blocked-by:<work-item-id>\`.

Worklog does not enforce these relationships but they can be used for planning and tracking.

### Workflow management

- Use the \`--stage\` flag to track workflow stages according to your particular process,
  - e.g. \`idea\`, \`prd_complete\`, \`milestones_defined\`, \`plan_complete\`, \`in_progress\`\`done\`.
- Use the \`--assignee\` flag to assign work items to agents.
- Use the \`--tags\` flag to add arbitrary tags for filtering and organization. Though avoid over-tagging.
- Use comments to document progress, decisions, and context.
- Use \`risk\` and \`effort\` fields to track complexity and potential issues.
  - If available use the \`effort_and_risk\` agent skill to estimate these values.

1. Check ready work: \`wl next\`
2. Claim your task: \`wl update <id> --status in-progress\`
3. Work on it: implement, test, document
4. Discover new work? Create a linked issue:

- \`wl create "Found bug" --priority high --tags "discovered-from:<parent-id>"\`

5. Complete: \`wl close <id> --reason "PR #123 merged"\`
6. Sync: run \`wl sync\` before ending the session

### Work-Item Management

\`\`\`bash
# Create work items
wl create --help  # Show help for creating work items
wl create --title "Bug title" --description "<details>" --priority high --issue-type bug --json
wl create --title "Feature title" --description "<details>" --priority medium --issue-type feature --json
wl create --title "Epic title" --description "<details>" --priority high --issue-type epic --json
wl create --title "Subtask" --parent <parent-id> --priority medium --json
wl create --title "Found bug" --priority high --tags "discovered-from:WL-123" --json

# Update work items
wl update --help  # Show help for updating work items
wl update <work-item-id> --status in-progress --json
wl update <work-item-id> --priority high --json

# Comments
wl comment --help  # Show help for comment commands
wl comment list <work-item-id> --json
wl comment show <work-item-id>-C1 --json
wl comment update <work-item-id>-C1 --comment "Revised" --json
wl comment delete <work-item-id>-C1 --json

# Close or delete
# wl close: provide -r reason for closing; can close multiple ids
wl close <work-item-id> --reason "PR #123 merged" --json
wl close <work-item-id-1> <work-item-id-2> --json

# *Destructive command ask for confirmation before running* Delete a work item permanently
wl delete <work-item-id> --json
\`\`\`

### Project Status

\`\`\`bash
# Show the next ready work items (JSON output)
# Display a recommendation for the next item to work on in JSON
wl next --json
# Display a recommendation for the next item assigned to \`agent-name\` to work on
wl next --assignee "agent-name" --json
# Display a recommendation for the next item to work on that matches a keyword (in title/description/comments)
wl next --search "keyword" --json

# Show all items with status \`in-progress\` in JSON
wl in-progress --json
# Show in-progress items assigned to \`agent-name\`
wl in-progress --assignee "agent-name" --json

# Show recently created or updated work items
wl recent --json
# Show the 10 most recently created or updated items
wl recent --number 10 --json
# Include child/subtask items when showing recent items
wl recent --children --json

# List all work items except those in a completed state
wl list --json
# Limit list output
wl list -n 5 --json
# List items filtered by status (open, in-progress, closed, etc.)
wl list --status open --json
# List items filtered by priority (critical, high, medium, low)
wl list --priority high --json
# List items filtered by comma-separated tags
wl list --tags "frontend,bug" --json
# List items filtered by assignee (short or full name)
wl list --assignee alice --json
# List items filtered by stage (e.g. triage, review, done)
wl list --stage review --json

# Show details for a specific work item
wl show <work-item-id> --comments --json
# Show details including child/subtask items
wl show <work-item-id> --children --json
\`\`\`

#### Team

\`\`\`bash
 # Sync local worklog data with the remote (shares changes)
 wl sync
 # Import issues from GitHub into the worklog (GitHub -> worklog)
 wl github import
 # Push worklog changes to GitHub issues (worklog -> GitHub)
 wl github push
\`\`\`

#### Plugins

Depending on your setup, you may have additional wl plugins installed. Check available plugins with \`wl --help\` (See plugins section) to view more information about the features provided by each plugin run \`wl <plugin-command> --help\`

#### Help

Run \`wl --help\` to see general help text and available commands.
Run \`wl <command> --help\` to see help text and all available flags for any command.
`;

// GitHub Copilot instructions template
const COPILOT_INSTRUCTIONS_TEMPLATE = `# Instructions for GitHub Copilot

This repository uses Worklog (wl) for issue tracking and work management.

## Key Commands

- Check next task: \`wl next\`
- Start work: \`wl update <id> --status in-progress\`
- Complete work: \`wl close <id> --reason "description"\`
- Create subtask: \`wl create --title "title" --parent <id>\`
- Sync changes: \`wl sync\`

## Rules

1. Always use Worklog for task tracking (not markdown TODOs)
2. Associate all commits with work items
3. Close work items only after tests pass and work is reviewed
4. Run \`wl sync\` before ending work sessions
5. Use \`--json\` flag for programmatic interaction

## Work Item Types

- bug: Something broken
- feature: New functionality  
- task: Work item (tests, docs, refactoring)
- epic: Large feature with subtasks
- chore: Maintenance (dependencies, tooling)

## Priorities

- critical: Security, data loss, broken builds
- high: Major features, important bugs
- medium: Default, nice-to-have
- low: Polish, optimization

For detailed usage, run \`wl --help\` or see AGENTS.md.
`;

export default function register(ctx: PluginContext): void {
  const { program, output, utils } = ctx;
  
  program
    .command('onboard')
    .description('Generate repo-local instructions/config for consistent agent and contributor setup')
    .option('--force', 'Overwrite existing files')
    .option('--copilot', 'Also generate GitHub Copilot instructions')
    .option('--dry-run', 'Show what would be created without actually creating files')
    .action(async (options: any) => {
      const cwd = process.cwd();
      const filesCreated: string[] = [];
      const filesUpdated: string[] = [];
      const filesSkipped: string[] = [];
      
      // Check if project is initialized
      const configPath = path.join(cwd, '.worklog', 'config.yaml');
      const configPathJson = path.join(cwd, '.worklog', 'config.json');
      if (!fs.existsSync(configPath) && !fs.existsSync(configPathJson)) {
        output.error('Worklog is not initialized in this directory. Run "wl init" first.');
        process.exit(1);
      }
      
      // AGENTS.md file
      const agentsPath = path.join(cwd, 'AGENTS.md');
      const agentsExists = fs.existsSync(agentsPath);
      
      if (options.dryRun) {
        console.log('DRY RUN: The following changes would be made:');
        console.log('');
      }
      
      // Handle AGENTS.md
      if (agentsExists && !options.force) {
        filesSkipped.push('AGENTS.md');
        if (!options.dryRun) {
          console.log('⚠ AGENTS.md already exists. Use --force to overwrite.');
        }
      } else {
        if (options.dryRun) {
          console.log(`Would ${agentsExists ? 'update' : 'create'}: AGENTS.md`);
        } else {
          fs.writeFileSync(agentsPath, AGENTS_MD_TEMPLATE, 'utf-8');
          if (agentsExists) {
            filesUpdated.push('AGENTS.md');
          } else {
            filesCreated.push('AGENTS.md');
          }
        }
      }
      
      // GitHub Copilot instructions (if requested)
      if (options.copilot) {
        const copilotPath = path.join(cwd, '.github', 'copilot-instructions.md');
        const githubDir = path.join(cwd, '.github');
        const copilotExists = fs.existsSync(copilotPath);
        
        if (copilotExists && !options.force) {
          filesSkipped.push('.github/copilot-instructions.md');
          if (!options.dryRun) {
            console.log('⚠ .github/copilot-instructions.md already exists. Use --force to overwrite.');
          }
        } else {
          if (options.dryRun) {
            console.log(`Would ${copilotExists ? 'update' : 'create'}: .github/copilot-instructions.md`);
          } else {
            // Create .github directory if it doesn't exist
            if (!fs.existsSync(githubDir)) {
              fs.mkdirSync(githubDir, { recursive: true });
            }
            
            fs.writeFileSync(copilotPath, COPILOT_INSTRUCTIONS_TEMPLATE, 'utf-8');
            if (copilotExists) {
              filesUpdated.push('.github/copilot-instructions.md');
            } else {
              filesCreated.push('.github/copilot-instructions.md');
            }
          }
        }
      }
      
      // Summary output
      if (!options.dryRun) {
        console.log('');
        console.log('Onboarding files summary:');
        console.log('========================');
        
        if (filesCreated.length > 0) {
          output.success('Created:');
          filesCreated.forEach(file => console.log(`  ✓ ${file}`));
        }
        
        if (filesUpdated.length > 0) {
          output.success('Updated:');
          filesUpdated.forEach(file => console.log(`  ✓ ${file}`));
        }
        
        if (filesSkipped.length > 0) {
          console.log('⚠ Skipped (already exist):');
          filesSkipped.forEach(file => console.log(`  ⚠ ${file}`));
        }
        
        if (filesCreated.length === 0 && filesUpdated.length === 0) {
          console.log('No changes made. All files already exist.');
          console.log('Use --force to overwrite existing files.');
        } else {
          console.log('');
          output.success('Onboarding setup complete!');
          console.log('');
          console.log('Next steps:');
          console.log('  1. Review AGENTS.md for Worklog usage guidelines');
          console.log('  2. Run "wl create" to create your first work item');
          console.log('  3. Use "wl next" to see recommended tasks');
        }
      } else {
        console.log('');
        console.log('No files were created (dry run mode)');
      }
    });
}