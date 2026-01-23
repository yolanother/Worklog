# Worklog Examples

This document provides practical examples of using the Worklog system.

## CLI Examples

### Creating Work Items

```bash
# Create a root work item
npm run cli -- create -t "Build authentication system" -d "Implement user login and registration" -s open -p high --tags "security,backend"

# Create a child work item
npm run cli -- create -t "Design database schema" -d "Define user and session tables" -s open -p medium -P WI-1

# Create with minimal info
npm run cli -- create -t "Fix bug in login"
```

### Listing and Filtering

```bash
# List all work items
npm run cli -- list

# List only root items (no parent)
npm run cli -- list -P null

# Filter by status
npm run cli -- list -s in-progress

# Filter by priority
npm run cli -- list -p high

# Filter by tags
npm run cli -- list --tags "backend,api"

# Combine filters
npm run cli -- list -s open -p high
```

### Viewing Work Items

```bash
# Show a specific item
npm run cli -- show WI-1

# Show with children
npm run cli -- show WI-1 -c
```

### Updating Work Items

```bash
# Update status
npm run cli -- update WI-1 -s in-progress

# Update priority
npm run cli -- update WI-1 -p critical

# Update multiple fields
npm run cli -- update WI-1 -s completed -d "Implementation finished and tested"

# Change parent (move in hierarchy)
npm run cli -- update WI-3 -P WI-2

# Add tags
npm run cli -- update WI-1 --tags "urgent,reviewed"
```

### Deleting Work Items

```bash
# Delete a work item
npm run cli -- delete WI-5
```

### Import/Export

```bash
# Export to a specific file
npm run cli -- export -f backup-2024-01-23.jsonl

# Import from a file
npm run cli -- import -f backup-2024-01-23.jsonl
```

## API Examples

### Using curl

```bash
# Health check
curl http://localhost:3000/health

# List all work items
curl http://localhost:3000/items

# Get a specific work item
curl http://localhost:3000/items/WI-1

# Create a new work item
curl -X POST http://localhost:3000/items \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Implement caching",
    "description": "Add Redis caching layer",
    "status": "open",
    "priority": "medium",
    "tags": ["performance", "backend"]
  }'

# Update a work item
curl -X PUT http://localhost:3000/items/WI-1 \
  -H "Content-Type: application/json" \
  -d '{
    "status": "in-progress"
  }'

# Delete a work item
curl -X DELETE http://localhost:3000/items/WI-1

# Get children of a work item
curl http://localhost:3000/items/WI-1/children

# Get all descendants
curl http://localhost:3000/items/WI-1/descendants

# Filter by status
curl "http://localhost:3000/items?status=open"

# Filter by priority
curl "http://localhost:3000/items?priority=high"

# Filter by parent (root items only)
curl "http://localhost:3000/items?parentId=null"

# Export data
curl -X POST http://localhost:3000/export \
  -H "Content-Type: application/json" \
  -d '{"filepath": "backup.jsonl"}'

# Import data
curl -X POST http://localhost:3000/import \
  -H "Content-Type: application/json" \
  -d '{"filepath": "backup.jsonl"}'
```

### Using JavaScript/Node.js

```javascript
// Create a work item
const response = await fetch('http://localhost:3000/items', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Add user profile page',
    description: 'Create a page to display user information',
    status: 'open',
    priority: 'medium',
    tags: ['frontend', 'ui']
  })
});
const newItem = await response.json();
console.log('Created:', newItem.id);

// Get all open items
const openItems = await fetch('http://localhost:3000/items?status=open')
  .then(res => res.json());
console.log(`Found ${openItems.length} open items`);

// Update an item
await fetch(`http://localhost:3000/items/${newItem.id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ status: 'in-progress' })
});
```

## TUI Usage

```bash
# Launch the Terminal UI
npm run tui
```

**Keyboard Controls:**
- `↑` / `↓` or `j` / `k` - Navigate through items
- `Enter` - View selected item details
- `n` - Create a new work item
- `d` - Delete selected item (with confirmation)
- `u` - Update status of selected item
- `q` or `Ctrl+C` - Quit the application

## Git Workflow Example

```bash
# 1. Create some work items
npm run cli -- create -t "Feature: User profiles" -s open -p high
npm run cli -- create -t "Design profile layout" -P WI-1
npm run cli -- create -t "Implement profile API" -P WI-1

# 2. Commit to Git
git add worklog-data.jsonl
git commit -m "Add user profile work items"

# 3. Push to share with team
git push origin main

# 4. Team member pulls and updates
git pull origin main
npm run cli -- update WI-2 -s in-progress

# 5. Commit the update
git add worklog-data.jsonl
git commit -m "Start working on profile layout"
git push origin main
```

## Sample Hierarchy

Here's an example of creating a hierarchical project structure:

```bash
# Create epic
npm run cli -- create -t "MVP Release" -d "First production release" -s open -p critical

# Create features under the epic
npm run cli -- create -t "User Management" -P WI-1 -s open -p high
npm run cli -- create -t "Dashboard" -P WI-1 -s open -p high
npm run cli -- create -t "Reporting" -P WI-1 -s open -p medium

# Create tasks under features
npm run cli -- create -t "User registration" -P WI-2 -s open -p high
npm run cli -- create -t "User login" -P WI-2 -s open -p high
npm run cli -- create -t "Password reset" -P WI-2 -s open -p medium

npm run cli -- create -t "Dashboard layout" -P WI-3 -s open -p high
npm run cli -- create -t "Dashboard widgets" -P WI-3 -s open -p medium

# List root items to see the hierarchy
npm run cli -- list -P null

# View a feature with its tasks
npm run cli -- show WI-2 -c
```

This creates a structure like:
```
WI-1: MVP Release (epic)
├── WI-2: User Management (feature)
│   ├── WI-5: User registration (task)
│   ├── WI-6: User login (task)
│   └── WI-7: Password reset (task)
├── WI-3: Dashboard (feature)
│   ├── WI-8: Dashboard layout (task)
│   └── WI-9: Dashboard widgets (task)
└── WI-4: Reporting (feature)
```
