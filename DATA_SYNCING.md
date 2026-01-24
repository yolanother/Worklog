# Data Syncing

This document describes the two syncing workflows:

- Git-backed JSONL syncing (canonical data ref)
- GitHub Issues mirroring (optional)

Both workflows can be used independently. The Git-backed workflow is the canonical source of truth for Worklog data.

## Git-Backed Syncing (Canonical JSONL)

Worklog stores work items and comments in `.worklog/worklog-data.jsonl`. The canonical copy is stored on a Git ref (by default `refs/worklog/data`) to avoid normal PR noise.

### Core Commands

- `wl sync`
  - Pulls the remote JSONL ref
  - Merges with local data (conflict resolution)
  - Writes local DB + JSONL
  - Pushes the updated JSONL ref

### Typical Flow

1. Update local items (`wl create`, `wl update`, etc.)
2. Run `wl sync` to publish changes
3. Teammates run `wl sync` to pull the canonical updates

### Auto-Sync

If `autoSync` is enabled, Worklog runs `wl sync` in the background after each local write (debounced). This keeps the canonical ref up to date without manual sync.

### Config Options

Set in `.worklog/config.yaml` (local) or `.worklog/config.defaults.yaml` (team defaults):

- `autoSync` (boolean, default false)
  - Auto-push changes to the canonical Git ref after local writes
- `syncRemote` (string, default `origin`)
  - Git remote used for sync
- `syncBranch` (string, default `refs/worklog/data`)
  - Git ref used for the canonical JSONL file

### Troubleshooting

- If `wl sync` shows no updates but you expected changes, confirm your local JSONL is up to date and the correct ref is used.
- If you want to preview a sync without changes, use `wl sync --dry-run`.

## GitHub Issues Mirroring (Optional)

Worklog can mirror items to GitHub Issues and import updates back.

### Core Commands

- `wl github push` (alias: `wl gh push`)
  - Pushes local Worklog items to GitHub Issues
  - Adds/updates issue titles, bodies, and labels
  - Ensures a `<!-- worklog:id=... -->` marker in the body

- `wl github import` (alias: `wl gh import`)
  - Imports changes from GitHub Issues into Worklog
  - Updates existing Worklog items with GitHub changes
  - Optionally creates new Worklog items for unmarked issues

### Status Label Behavior

Worklog uses `wl:status:<status>` labels to represent status. Only one status label is kept on an issue at a time.

### Closed Issues

- Worklog does not create new items from closed issues.
- If an existing mapped GitHub issue is closed, Worklog marks the corresponding item as `completed`.

### Config Options

Set in `.worklog/config.yaml` (local) or `.worklog/config.defaults.yaml` (team defaults):

- `githubRepo` (string, e.g. `owner/name`)
  - Repo used for GitHub mirroring
- `githubLabelPrefix` (string, default `wl:`)
  - Prefix for Worklog labels
- `githubImportCreateNew` (boolean, default true)
  - When true, `wl github import` creates Worklog items from unmarked issues

### Recommended Flow

1. Ensure canonical JSONL is up to date: `wl sync`
2. Push to GitHub Issues: `wl gh push`
3. Later, import GitHub updates: `wl gh import`

### Troubleshooting

- If `wl gh push` reports errors, re-run with `--json` for detailed failures.
- If the GitHub CLI is older, label creation uses `gh api` or `gh issue label create`.

## Examples

```bash
# Sync Worklog JSONL with git
wl sync

# Push Worklog items to GitHub Issues
wl gh push

# Import GitHub Issue updates
wl gh import

# Import only issues updated since a timestamp
wl gh import --since 2024-01-01T00:00:00Z
```
