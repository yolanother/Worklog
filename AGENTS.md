## Workflow for AI Agents

It is expected that a session will be started by a human operator who will supply an initial prompt which defines the overall goals and context for the work to be done. When receiving such a prompt the agent will create an initial work-item in the worklog to track the work required to meet those goals. The work-item is created with a command such as `wl create "<work-item-title>" --description "<detailed-description-of-goals-and-context>" --issue-type <type-of-work-item> --json` (see [Work-Item Management](#work-item-management) below for more information). Remember the work-item id that is returnedm this will be referred to below as the <base-item-id>.

Once the item has been created the agent should confirm with the operator that the work-item accurately reflects the goals and context provided. If the operator requests changes to the work-item the agent should update the work-item description and acceptance criteria accordingly `wl update <id> --description "<updated-description>"`. DO NOT remove existing content unless it is incorrect, ONLY add to it with appropriate clarifications.

Once approved the agent should ask if they may ask further clarifying questions if required during the planning and implementation of <base-item-id>, the agent should make it clear that if the operator says no the agent will attempt to complete the task without further guidance, but being able to ask questions increases the chances of success. The agent will wait for confirmation from the operator before proceeding and remember the response.

The agent(s) will then plan and execute the work required to meet those goals by following the steps below.

0. **Claim the work-item** created by the operator:
   - Claim it with `wl update <id> --status in-progress --assignee @your-agent-name`
1. **Ensure the work-item is clearly defined**:
   - Review the description, acceptance criteria, and any related files/paths in the work item description and comments (retrieved with `wl show <id> --children --json`)
   - Review any existing work-items in the repository that may be related to this work-item (`wl list <search-terms> --include-closed` and `wl show <id> --children --json`).
   - If the work-item is not clearly defined:
     - Search the worklog (`wl list <search-terms> --include-closed` and `wl show <id> --children --json`) and repository for any existing information that may clarify the requirements
     - If the operator has allowed further questions ask for clarification on specific requirements, acceptance criteria, and context. Where possible provide suggested responses, but always allow for a free form text response.
     - If the operator has not allowed further questions attempt to clarify the requirements based on the existing information in the repository and worklog.
     - Update the work-item description and acceptance criteria with any clarifications found `wl update <id> --description "<updated-description>"`. DO NOT remove existing content unless it is incorrect, ONLY add to it with appropriate clarifications.
   - Once the work-item is clearly defined update its stage to `intake_complete` using `wl update <id> --stage intake_complete`
2. **Plan the work**:
   - Break down the work into smaller sub-tasks if necessary
   - Each sub-task should be a discrete unit of work that can be completed independently, if a sub-task is still too large break it down further with sub-tasks of its own
   - Define acceptance criteria for each sub-task
   - Create child work-items for each sub-task using `wl create -t "<sub-task-title>" -d "<detailed-description>" --parent <base-item-id> --issue-type <type-of-work-item> --priority <critical|high|medium|low> --json`
   - Once planning is complete update the parent work-item stage to `plan_complete` using `wl update <base-item-id> --stage plan_complete`
3. **Decide what to work on next**:
   - Use `wl next --json` to get a recommendation for the next work-item to work on. The id of this item will be referred to below as <WIP-id>.
   - If the recommended work-item has no children proceed to the next step.
   - If the recommended work-item has children claim this work-item and mark it as in progress using `wl update <WIP-id> --status in-progress --assignee @your-agent-name`
   - Repeat this step to get the next recommended work-item until a leaf work-item (one with no children) is reached.
4. **Implement the work-item**:
   - Review the content of the selected work-item
   - Review the description, acceptance criteria, and any related files/paths in the work item description and comments (retrieved with `wl show <WIP-id> --children --json`)
   - Review any existing work-items in the repository that may be related to this work-item (`wl list <search-terms> --include-closed` and `wl show <id> --children --json`).
   - If the work-item is not clearly defined:
     - Search the worklog (`wl list <search-terms> --include-closed` and `wl show <id> --children --json`) and repository for any existing information that may clarify the requirements
     - If the operator has allowed further questions ask for clarification on specific requirements, acceptance criteria, and context. Where possible provide suggested responses, but always allow for a free form text response.
     - If the operator has not allowed further questions attempt to clarify the requirements based on the existing information in the repository and worklog.
     - Update the work-item description and acceptance criteria with any clarifications found with `wl update <WIP-id> --description "<updated-description>"`. DO NOT remove existing content unless it is incorrect, ONLY add to it with appropriate clarifications.
     - Create a new branch for the work-item following the branch naming conventions (e.g. `wl-<WIP-id>-short-description`)
   - Complete all work required to meet the acceptance criteria (code, tests, documentation, etc.)
   - If new work-items are discovered during implementation create new work-items using `wl create "<work-item-title>" --description "<detailed-description-of-goals-and-context>" --issue-type <type-of-work-item> --json`. If the item must be completed in order to satisfy the requirements of the parent work-item, make the new item a child of the parent work-item using `--parent <parent-id>`. If it is an optional item make it a sibling of the <base-item-id> and add a reference to the base item in the description using `discovered-from:<base-item-id>`.
   - Regularly run all tests and checks to ensure nothing is broken
   - If any tests/checks fail, fix the issues and repeat until all tests/checks pass
     Commit changes regularly with clear commit messages that reference the WIP id and summarise the changes made.
   - If a particularly complex issue is identified or a significant design decisions or assumption is made record this in a comment on the work-item using `wl comment add <WIP-id> --comment "<detailed-comment>" --author @your-agent-name --json`
   - Once the acceptance criteria of <WIP-id> has been satisfied and all tests pass, Commit final changes to the branch with a message such as `<WIP-id>: Completed work to satisfy acceptance criteria: <acceptance-criteria-summary>`
   - When work is complete record a comment on the work-item summarising the changes made and the reason for them, including the commit hash using `wl comment add <id> --comment "Completed work, see commit <commit-hash> for details." --author @your-agent-name --json`
5. **Merge work into main**:
   - Update the branch against main
   - Run all tests and checks to ensure nothing is broken
   - If any tests/checks fail, fix the issues and repeat until all tests/checks pass
   - Push the branch to the remote repository
   - Switch back to main, merge the branch and push the updated main branch to the remote repository
   - Close the work-item with a comment summarising the changes made and the reason for them, including the commit hash using `wl close <WIP-id> --reason "Completed work, see merge commit <merge-commit-hash> for details." --json`
6. **Update the operator**:
   - Provide the operator a summary of the work completed, including any relevant links (work-item id, commit hashes, PR links, etc.)
   - Go back to the `Decide what to work on next` step to continue working on the overall goals defined by the operator until all work-items are complete.
   - Once there are no descendents of <base-item-id> left to work on, inform the operator that all required work is complete and summaries any remaining tasks that were siblings of <base-item-id> (`wl list --json`).

## work-item Tracking with Worklog (wl)

IMPORTANT: This project uses Worklog (wl) for ALL work-item tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why Worklog (wl)?

- Agent-optimized planning with parent/child relationships, tags, and comments
- Syncs via a dedicated git ref (`refs/worklog/data`)
- Optional GitHub Issues mirroring
- Optional git hook auto-sync
- Lightweight CLI and JSON-friendly output
- Prevents duplicate tracking systems and confusion

### work-item Types

Track work-item types with `--issue-type`:

- bug - Something broken
- feature - New functionality
- task - Work item (tests, docs, refactoring)
- epic - Large feature with subtasks
- chore - Maintenance (dependencies, tooling)

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

Other types of dependencies can be tracked in descriptions, for example `discovered-from:<work-item-id>`, `related-to:<work-item-id>`, `blocked-by:<work-item-id>`.

Worklog does not enforce these relationships but they can be used for planning and tracking.

### Workflow management

- Use the `--stage` flag to track workflow stages according to your particular process,
  - e.g. `idea`, `prd_complete`, `milestones_defined`, `plan_complete`, `in_progress``done`.
- Use the `--assignee` flag to assign work items to agents.
- Use the `--tags` flag to add arbitrary tags for filtering and organization. Though avoid over-tagging.
- Use comments to document progress, decisions, and context.
- Use `risk` and `effort` fields to track complexity and potential issues.
  - If available use the `effort_and_risk` agent skill to estimate these values.

1. Check ready work: `wl next`
2. Claim your task: `wl update <id> --status in-progress`
3. Work on it: implement, test, document
4. Discover new work? Create a linked issue:

- `wl create "Found bug" --priority high --tags "discovered-from:<parent-id>"`

5. Complete: `wl close <id> --reason "PR #123 merged"`
6. Sync: run `wl sync` before ending the session

### Work-Item Management

```bash
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

# *Destructive command ask for confirmation before running* Dekete a work item permanently
wl delete <work-item-id> --json
```

### Project Status

```bash
# Show the next ready work items (JSON output)
# Display a recommendation for the next item to work on in JSON
wl next --json
# Display a recommendation for the next item assigned to `agent-name` to work on
wl next --assignee "agent-name" --json
# Display a recommendation for the next item to work on that matches a keyword (in title/description/comments)
wl next --search "keyword" --json

# Show all items with status `in-progress` in JSON
wl in-progress --json
# Show in-progress items assigned to `agent-name`
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
```

#### Team

```bash
 # Sync local worklog data with the remote (shares changes)
 wl sync
 # Import issues from GitHub into the worklog (GitHub -> worklog)
 wl github import
 # Push worklog changes to GitHub issues (worklog -> GitHub)
 wl github push
```

#### Plugins

Depending on your setup, you may have additional wl plugins installed. Check available plugins with `wl --help` (See plugins section) to view more information about the features provided by each plugin run `wl <plugin-command> --help`

#### Help

Run `wl --help` to see general help text and available commands.
Run `wl <command> --help` to see help text and all available flags for any command.

### Important Rules

- Use wl for ALL task tracking, do NOT use markdown TODOs, task lists, or other tracking methods
- Whenever committing code changes add a comment to the relevant work item(s) summarising the changes and the reason for them, include the commit hash.
  - if there is still work remaining note this in the comment.
- Use wl as a primary source of truth, only the source code is more authoritative
- Always use `--json` flag for programmatic use
- When new work items are discovered while working on an existing item create a new work item with `wl create`
  - If the item must be completed before the current work item can be completed add it as a child of the current item (`wl create --parent <current-work-item-id>`)
  - If the item is related to the current work item but not blocking its completion add a reference to the current item in the description (`discovered-from:<current-work-item-id>`)
- Check `wl next` before asking "what should I work on?" and offer the response as a suggestion, with an explanation
- Run `wl <cmd> --help` to discover available flags
- Do NOT create markdown TODO lists
- Do NOT use external issue trackers
- Do NOT duplicate tracking systems
- Do NOT clutter repo root with planning documents

## CRITICAL RULES

- Work is NOT complete, and thus work items should not be marked completed, until a PR has been raised, reviews passed, and code merged
- NEVER stop before pushing - that leaves work stranded locally
- If push fails, resolve and retry until it succeeds
- When using backticks in strings that are to be passed as arguments to shell commands (e.g. wf, gh), escape them properly to avoid errors
