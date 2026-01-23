# Quick Start Guide

Get started with Worklog in 5 minutes!

## Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build
```

## Your First Work Item

### Using CLI

```bash
# Create your first work item
npm run cli -- create -t "My first task" -d "Let's get started!"

# See it in the list
npm run cli -- list

# Update its status
npm run cli -- update WI-0J8L1JQ3H8ZQ2K6D -s in-progress

# Mark it complete
npm run cli -- update WI-0J8L1JQ3H8ZQ2K6D -s completed
```

### Using the API

```bash
# Terminal 1: Start the server
npm start

# Terminal 2: Create a work item
curl -X POST http://localhost:3000/items \
  -H "Content-Type: application/json" \
  -d '{
    "title": "API test",
    "status": "open",
    "priority": "medium"
  }'

# List all items
curl http://localhost:3000/items | jq
```

## Creating a Project Hierarchy

```bash
# Create an epic
npm run cli -- create -t "Build MVP" -p critical

# Add features under it
npm run cli -- create -t "User registration" -P WI-0J8L1JQ3H8ZQ2K6D -p high
npm run cli -- create -t "User login" -P WI-0J8L1JQ3H8ZQ2K6D -p high

# Add tasks under features
npm run cli -- create -t "Design login form" -P WI-0J8L1JQ3H8ZQ2K6E -p medium
npm run cli -- create -t "Implement auth API" -P WI-0J8L1JQ3H8ZQ2K6E -p high

# View the hierarchy
npm run cli -- show WI-0J8L1JQ3H8ZQ2K6D -c
```

## Working with Git

```bash
# Your work items are automatically saved to worklog-data.jsonl

# Add to Git
git add worklog-data.jsonl
git commit -m "Add project tasks"
git push

# Team members can pull and see your work items
git pull
npm run cli -- list
```

## Common Commands

```bash
# List all open tasks
npm run cli -- list -s open

# List high priority items
npm run cli -- list -p high

# Show root items only (no parent)
npm run cli -- list -P null

# View a specific item with its children
npm run cli -- show WI-0J8L1JQ3H8ZQ2K6D -c

# Update multiple fields
npm run cli -- update WI-0J8L1JQ3H8ZQ2K6D -s completed -d "All done!"

# Delete a work item
npm run cli -- delete WI-0J8L1JQ3H8ZQ2K6E

# Export to backup
npm run cli -- export -f backup.jsonl

# Import from backup
npm run cli -- import -f backup.jsonl
```

## Next Steps

- Read [README.md](README.md) for complete documentation
- Check [EXAMPLES.md](EXAMPLES.md) for more usage examples
- See [GIT_WORKFLOW.md](GIT_WORKFLOW.md) for team collaboration patterns

## Tips

1. **Start Simple**: Create a few tasks and get comfortable with the CLI
2. **Commit Often**: Keep your work items in sync with Git
3. **Tag Everything**: Use tags to organize and filter (`--tags "urgent,bug"`)
4. **Leverage Hierarchy**: Use parent-child relationships for better organization

Happy tracking! 🚀
