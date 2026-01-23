# Git Workflow Guide

This guide demonstrates how to use Worklog in a Git-based team environment.

## Initial Setup

```bash
# Clone the repository
git clone <your-repo>
cd <your-repo>

# Install dependencies
npm install

# Build the project
npm run build
```

## Daily Workflow

### 1. Sync with Team (Recommended)

The `sync` command automatically pulls the latest changes, merges them with your local work, and pushes updates back:

```bash
# Sync your work items with the team
npm run cli -- sync

# This will:
# 1. Pull the latest .worklog/worklog-data.jsonl from git
# 2. Merge with your local changes
# 3. Resolve conflicts using updatedAt timestamps (newer wins)
# 4. Push the merged data back to git
```

**Conflict Resolution**: When the same work item is modified both locally and remotely, the sync command automatically resolves conflicts by comparing `updatedAt` timestamps. The more recent update always takes precedence.

```bash
# Preview what would be synced without making changes
npm run cli -- sync --dry-run

# Sync but don't push (useful for reviewing changes first)
npm run cli -- sync --no-push
```

### 1b. Manual Pull (Alternative)

Alternatively, you can manually pull changes:

```bash
# Pull the latest work items from your team
git pull origin main

# The .worklog/worklog-data.jsonl file will be automatically updated
# View the latest items
npm run cli -- list
```

**Note**: Manual git pull may result in merge conflicts if the same work items are modified locally and remotely. The `sync` command handles this automatically.

### 2. Create New Work Items

```bash
# Create a new task for today's work
npm run cli -- create \
  -t "Implement password reset feature" \
  -d "Allow users to reset their password via email" \
  -s open \
  -p high \
  --tags "security,backend"

# Create sub-tasks
npm run cli -- create \
  -t "Add password reset endpoint" \
  -P WI-0J8L1JQ3H8ZQ2K6D \
  -s open \
  -p high

npm run cli -- create \
  -t "Send password reset email" \
  -P WI-0J8L1JQ3H8ZQ2K6D \
  -s open \
  -p medium

# View your work
npm run cli -- show WI-0J8L1JQ3H8ZQ2K6D -c
```

### 3. Update Status as You Work

```bash
# Start working on a task
npm run cli -- update WI-0J8L1JQ3H8ZQ2K6E -s in-progress

# Mark it complete when done
npm run cli -- update WI-0J8L1JQ3H8ZQ2K6E -s completed

# View all in-progress items
npm run cli -- list -s in-progress
```

### 4. Commit Your Changes

```bash
# Check what changed
git diff .worklog/worklog-data.jsonl

# The diff shows only the lines that changed - very Git-friendly!
# Example diff:
# -{"id":"WI-0J8L1JQ3H8ZQ2K6E","status":"open",...}
# +{"id":"WI-0J8L1JQ3H8ZQ2K6E","status":"completed",...}

# Commit your work
git add .worklog/worklog-data.jsonl
git commit -m "Complete password reset endpoint implementation"
git push origin main
```

## Team Collaboration

### Scenario 1: Assigning Work

Team lead creates the work breakdown:

```bash
# Create epic
npm run cli -- create \
  -t "Q1 2024 Release" \
  -d "Features for Q1 release" \
  -s open \
  -p critical

# Break down into features
npm run cli -- create -t "User Authentication" -P WI-0J8L1JQ3H8ZQ2K6D -p high
npm run cli -- create -t "Admin Dashboard" -P WI-0J8L1JQ3H8ZQ2K6D -p high
npm run cli -- create -t "Reporting Module" -P WI-0J8L1JQ3H8ZQ2K6D -p medium

# Commit and push
git add .worklog/worklog-data.jsonl
git commit -m "Create Q1 release work breakdown"
git push origin main
```

Team members pull and pick up tasks:

```bash
# Pull latest
git pull origin main

# View available work
npm run cli -- list -s open

# Pick a task and update status
npm run cli -- update WI-0J8L1JQ3H8ZQ2K6E -s in-progress
git add .worklog/worklog-data.jsonl
git commit -m "Start working on user authentication"
git push origin main
```

### Scenario 2: Handling Concurrent Updates with Sync

The `sync` command automatically handles concurrent updates:

```bash
# You and a teammate both modify WI-0J8L1JQ3H8ZQ2K6D at the same time
# Your change: status = "in-progress"
# Teammate's change: priority = "high"

# When you run sync
npm run cli -- sync

# The sync command will:
# 1. Detect the conflict
# 2. Compare updatedAt timestamps
# 3. Keep the most recent version
# 4. Report the resolution

# Output will show:
# Conflict resolution:
#   - WI-0J8L1JQ3H8ZQ2K6D: Remote version is newer (remote: 2024-01-15T14:30:00, local: 2024-01-15T14:25:00)
# 
# Sync summary:
#   Work items updated: 1
```

**Best Practice**: Run `sync` frequently (before and after making changes) to minimize conflicts.

### Scenario 2b: Manual Merge Conflicts (When Not Using Sync)

If you use manual git pull instead of sync, you may encounter merge conflicts:

```bash
# After git pull, if there's a conflict in .worklog/worklog-data.jsonl
git pull origin main

# Check the conflict
git status

# The conflict will be on specific lines (JSONL format)
# Edit .worklog/worklog-data.jsonl to resolve
# Each line is independent, so conflicts are rare and easy to fix

# After resolving
git add .worklog/worklog-data.jsonl
git commit -m "Merge work item updates"
git push origin main
```

### Scenario 3: Backing Up and Archiving

```bash
# Create a backup before major changes
npm run cli -- export -f backups/before-q1-planning.jsonl
git add backups/
git commit -m "Backup work items before Q1 planning"

# Archive completed work for the quarter
npm run cli -- list -s completed > completed-q1.txt
git add completed-q1.txt
git commit -m "Archive Q1 completed work"
```

## Using the API in CI/CD

You can query work items in your CI/CD pipeline:

```yaml
# .github/workflows/check-blockers.yml
name: Check for Blockers

on:
  schedule:
    - cron: '0 9 * * 1-5'  # Weekdays at 9 AM

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm install
      - run: npm run build
      - name: Check for blocked items
        run: |
          npm start &
          sleep 5
          BLOCKED=$(curl -s http://localhost:3000/items?status=blocked | jq length)
          if [ "$BLOCKED" -gt 0 ]; then
            echo "Warning: $BLOCKED blocked work items found"
            curl -s http://localhost:3000/items?status=blocked | jq
          fi
```

## Best Practices

1. **Use Sync Command**: Use `npm run cli -- sync` instead of manual git operations for automatic conflict resolution
2. **Sync Frequently**: Run sync before starting work and after completing tasks to minimize conflicts
3. **Review Before Pushing**: Use `--dry-run` to preview changes before syncing
4. **Commit Frequently**: Commit work item updates separately from code changes for clearer history
5. **Use Descriptive Commits**: The sync command uses "Sync work items and comments" as the commit message
6. **Tag Appropriately**: Use tags consistently across the team (e.g., "frontend", "backend", "bug", "feature")
7. **Keep JSONL Clean**: Don't manually edit .worklog/worklog-data.jsonl; use the CLI or API
8. **Backup Before Major Changes**: Export before restructuring work hierarchies

## Sync Command Details

The `sync` command provides automatic synchronization with git, including intelligent conflict resolution:

### How Sync Works

1. **Pull**: Fetches the latest `.worklog/worklog-data.jsonl` from the git repository
2. **Merge**: Combines local and remote changes
3. **Conflict Resolution**: Automatically resolves conflicts using `updatedAt` timestamps
4. **Export**: Saves the merged data to the local file
5. **Push**: Commits and pushes the changes back to git

### Conflict Resolution Strategy

When the same work item exists in both local and remote with different content:

- **Compare Timestamps**: Uses the `updatedAt` field to determine which version is newer
- **Most Recent Wins**: The version with the later `updatedAt` timestamp is kept
- **Report Conflicts**: All resolved conflicts are reported in the output

Example:
```
Conflict resolution:
  - TEST-0J8L1JQ3H8ZQ2K6D: Remote version is newer (remote: 2024-01-15T14:30:00, local: 2024-01-15T14:25:00)
  - TEST-2: Local version is newer (local: 2024-01-15T14:35:00, remote: 2024-01-15T14:20:00)
```

### Sync Options

```bash
# Standard sync (pull, merge, push)
npm run cli -- sync

# Preview changes without making any modifications
npm run cli -- sync --dry-run

# Sync but don't push (review changes first)
npm run cli -- sync --no-push

# Sync a custom data file
npm run cli -- sync -f custom-data.jsonl

# Combine options
npm run cli -- sync --dry-run --prefix PROJ
```

### When to Use Sync

- **At the start of your workday**: Get the latest updates from your team
- **Before creating new items**: Ensure you have the latest data
- **After making changes**: Share your updates with the team
- **When switching branches**: After checking out a different git branch
- **Before major reorganizations**: Ensure you're working with the latest data

## Migration and Sync

### Moving Between Repositories

```bash
# Export from old project
cd old-project
npm run cli -- export -f ~/transfer.jsonl

# Import to new project
cd new-project
npm run cli -- import -f ~/transfer.jsonl
git add .worklog/worklog-data.jsonl
git commit -m "Import work items from old project"
```

### Syncing with External Tools

You can write scripts to sync with other tools:

```bash
#!/bin/bash
# sync-to-jira.sh
# Example: Export open items for external tracking

npm run cli -- list -s open -p high | \
  grep '^\[[A-Z0-9]\+-' | \
  while read line; do
    # Parse and send to external API
    echo "Would sync: $line"
  done
```

## Troubleshooting

### Reset to Last Known Good State

```bash
# If data gets corrupted
git checkout HEAD -- .worklog/worklog-data.jsonl
# Or restore from a backup
npm run cli -- import -f backups/last-good.jsonl
```

### Find Lost Work Items

```bash
# Search Git history
git log --all --full-history --oneline -- .worklog/worklog-data.jsonl

# View a specific version
git show <commit>:.worklog/worklog-data.jsonl | jq
```

### Verify Data Integrity

```bash
# Check that JSONL is valid
cat .worklog/worklog-data.jsonl | while read line; do echo "$line" | jq empty; done && echo "Valid JSONL"
```
