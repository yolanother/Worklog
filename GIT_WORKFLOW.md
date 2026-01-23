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

### 1. Pull Latest Changes

```bash
# Pull the latest work items from your team
git pull origin main

# The worklog-data.jsonl file will be automatically updated
# View the latest items
npm run cli -- list
```

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
  -P WI-5 \
  -s open \
  -p high

npm run cli -- create \
  -t "Send password reset email" \
  -P WI-5 \
  -s open \
  -p medium

# View your work
npm run cli -- show WI-5 -c
```

### 3. Update Status as You Work

```bash
# Start working on a task
npm run cli -- update WI-6 -s in-progress

# Mark it complete when done
npm run cli -- update WI-6 -s completed

# View all in-progress items
npm run cli -- list -s in-progress
```

### 4. Commit Your Changes

```bash
# Check what changed
git diff worklog-data.jsonl

# The diff shows only the lines that changed - very Git-friendly!
# Example diff:
# -{"id":"WI-6","status":"open",...}
# +{"id":"WI-6","status":"completed",...}

# Commit your work
git add worklog-data.jsonl
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
npm run cli -- create -t "User Authentication" -P WI-1 -p high
npm run cli -- create -t "Admin Dashboard" -P WI-1 -p high
npm run cli -- create -t "Reporting Module" -P WI-1 -p medium

# Commit and push
git add worklog-data.jsonl
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
npm run cli -- update WI-2 -s in-progress
git add worklog-data.jsonl
git commit -m "Start working on user authentication"
git push origin main
```

### Scenario 2: Handling Merge Conflicts

If two people update different work items, Git merges automatically. If they update the same item:

```bash
# After git pull, if there's a conflict in worklog-data.jsonl
git pull origin main

# Check the conflict
git status

# The conflict will be on specific lines (JSONL format)
# Edit worklog-data.jsonl to resolve
# Each line is independent, so conflicts are rare and easy to fix

# After resolving
git add worklog-data.jsonl
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

1. **Commit Frequently**: Commit work item updates separately from code changes for clearer history
2. **Use Descriptive Commits**: `git commit -m "Create feature breakdown for auth module"`
3. **Pull Before Creating**: Always pull latest before creating new items to avoid ID conflicts
4. **Tag Appropriately**: Use tags consistently across the team (e.g., "frontend", "backend", "bug", "feature")
5. **Keep JSONL Clean**: Don't manually edit worklog-data.jsonl; use the CLI or API
6. **Backup Before Major Changes**: Export before restructuring work hierarchies

## Migration and Sync

### Moving Between Repositories

```bash
# Export from old project
cd old-project
npm run cli -- export -f ~/transfer.jsonl

# Import to new project
cd new-project
npm run cli -- import -f ~/transfer.jsonl
git add worklog-data.jsonl
git commit -m "Import work items from old project"
```

### Syncing with External Tools

You can write scripts to sync with other tools:

```bash
#!/bin/bash
# sync-to-jira.sh
# Example: Export open items for external tracking

npm run cli -- list -s open -p high | \
  grep "^\[WI-" | \
  while read line; do
    # Parse and send to external API
    echo "Would sync: $line"
  done
```

## Troubleshooting

### Reset to Last Known Good State

```bash
# If data gets corrupted
git checkout HEAD -- worklog-data.jsonl
# Or restore from a backup
npm run cli -- import -f backups/last-good.jsonl
```

### Find Lost Work Items

```bash
# Search Git history
git log --all --full-history --oneline -- worklog-data.jsonl

# View a specific version
git show <commit>:worklog-data.jsonl | jq
```

### Verify Data Integrity

```bash
# Check that JSONL is valid
cat worklog-data.jsonl | while read line; do echo "$line" | jq empty; done && echo "Valid JSONL"
```
