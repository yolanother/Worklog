## Issue Tracking with wl (Worklog)

IMPORTANT: This project uses wl (Worklog) for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why wl?

- Agent-optimized planning with parent/child relationships, tags, and comments
- Syncs via a dedicated git ref (`refs/worklog/data`)
- Optional GitHub Issues mirroring
- Optional git hook auto-sync
- Lightweight CLI and JSON-friendly output
- Prevents duplicate tracking systems and confusion

### Issue Types

Track issue types with `--issue-type`:

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

### Issue Management

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

### Branch guidance (branch-per-work-item):

- All work must be performed on branches that include the WL id
- If a branch already exists for the WL issue or one of its ancestors, reuse it and record your involvement in comments

## CRITICAL RULES

- Work is NOT complete, and thus work items should not be marked completed, until a PR has been raised, reviews passed, and code merged
- NEVER stop before pushing - that leaves work stranded locally
- If push fails, resolve and retry until it succeeds
- When using backticks in strings that are to be passed as arguments to shell commands (e.g. wf, gh), escape them properly to avoid errors
