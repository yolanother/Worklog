# Multi-Project Setup Example

This document demonstrates how to use Worklog with multiple projects, each with its own prefix.

## Setup

### Initialize Your Project

First, initialize your project configuration:

```bash
npm run cli -- init
```

When prompted:
- **Project name**: Enter your project name (e.g., "My Web App")
- **Issue ID prefix**: Enter a short prefix (e.g., "WEB", "API", "PROJ")

This creates a `.worklog/config.yaml` file with your configuration:

```yaml
projectName: My Web App
prefix: WEB
```

## Using the Default Prefix

All CLI commands will use the prefix from your config by default:

```bash
# Create a work item - will use WEB prefix
npm run cli -- create -t "Add user authentication"

# Output: Created work item with id WEB-1
```

## Working with Multiple Projects

### Using CLI with Custom Prefix

You can override the default prefix for any command using the `--prefix` flag:

```bash
# Create work items for different projects
npm run cli -- create -t "API: Add login endpoint" --prefix API
npm run cli -- create -t "Frontend: Create login form" --prefix FRONT
npm run cli -- create -t "Backend: Setup database" --prefix BACK

# List items from a specific project
npm run cli -- list --prefix API

# Update items from different projects
npm run cli -- update API-1 -s completed --prefix API
npm run cli -- update FRONT-1 -s in-progress --prefix FRONT
```

### Using API with Custom Prefix

The API supports both legacy routes (using default prefix) and prefix-based routes:

#### Legacy Routes (use default prefix from config)

```bash
# Create item with default prefix
curl -X POST http://localhost:3000/items \
  -H "Content-Type: application/json" \
  -d '{"title": "Task with default prefix"}'

# Get all items
curl http://localhost:3000/items
```

#### Prefix-Based Routes

```bash
# Create item with API prefix
curl -X POST http://localhost:3000/projects/API/items \
  -H "Content-Type: application/json" \
  -d '{"title": "Add authentication endpoint"}'

# Get items for API project
curl http://localhost:3000/projects/API/items

# Create item with FRONT prefix
curl -X POST http://localhost:3000/projects/FRONT/items \
  -H "Content-Type: application/json" \
  -d '{"title": "Create login form"}'

# Get specific item
curl http://localhost:3000/projects/API/items/API-1

# Update item
curl -X PUT http://localhost:3000/projects/API/items/API-1 \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}'
```

## Workflow Example

Here's a complete workflow using multiple projects:

```bash
# Initialize main project
npm run cli -- init
# Project name: WebApp
# Prefix: WEB

# Create main web app tasks
npm run cli -- create -t "Setup project structure"
npm run cli -- create -t "Create homepage"

# Create API tasks with custom prefix
npm run cli -- create -t "Design REST API" --prefix API
npm run cli -- create -t "Implement user endpoints" --prefix API

# Create mobile tasks with custom prefix
npm run cli -- create -t "Setup React Native" --prefix MOB
npm run cli -- create -t "Create login screen" --prefix MOB

# List all tasks (shows all prefixes)
npm run cli -- list

# List tasks for specific project
npm run cli -- list --prefix API

# Update status
npm run cli -- update WEB-1 -s completed
npm run cli -- update API-1 -s in-progress --prefix API
npm run cli -- update MOB-1 -s completed --prefix MOB
```

## Best Practices

1. **Commit Configuration**: Always commit `.worklog/config.yaml` to version control so team members use the same prefix.

2. **Consistent Prefixes**: Use short, meaningful prefixes:
   - `WEB` for web application
   - `API` for API services
   - `MOB` for mobile app
   - `DOC` for documentation
   - `TEST` for testing tasks

3. **Shared Data**: All items regardless of prefix are stored in the same `worklog-data.jsonl` file, making it easy to track work across projects.

4. **Override When Needed**: Use `--prefix` flag only when you need to work with a different project temporarily. Most of the time, use the default prefix from config.

## Migrating Existing Data

If you have existing data with `WI` prefix and want to migrate to a new prefix:

1. Initialize config with your new prefix
2. Your existing `WI-*` items will continue to work
3. New items will use the new prefix
4. Both old and new items can coexist in the same database
