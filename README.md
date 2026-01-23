# Worklog

A simple experimental issue tracker for AI agents. This is a lightweight worklog system similar to an issue tracker, designed to track a hierarchy of work items with basic fields.

## Features

- **API**: REST API built with Express
- **CLI**: Command-line interface for quick operations
- **Git-Friendly**: Data stored in JSONL format for easy Git syncing
- **In-Memory Database**: Fast runtime performance
- **Hierarchical Work Items**: Support for parent-child relationships
- **Multi-Project Support**: Configure custom prefixes for issue IDs per project

## Installation

```bash
npm install
```

## Configuration

Before using Worklog, you should initialize your project configuration:

```bash
npm run cli -- init
```

This will prompt you for:
- **Project name**: A descriptive name for your project
- **Issue ID prefix**: A short prefix for your issue IDs (e.g., WI, PROJ, TASK)

The configuration is saved to `.worklog/config.yaml` and should be committed to version control so all team members use the same prefix.

**Example:**
```
Project name: MyProject
Issue ID prefix: MP
```

This will create issues with IDs like `MP-1`, `MP-2`, etc.

If no configuration exists, the system defaults to using `WI` as the prefix.

## Usage

### CLI

The CLI tool allows you to manage work items from the command line. All commands support the `--prefix` flag to override the default prefix from configuration.

```bash
# Initialize project configuration (run this first)
npm run cli -- init

# Create a new work item
npm run cli -- create -t "My first task" -d "Description here" -s open -p high

# Create with a custom prefix override
npm run cli -- create -t "Task for another project" --prefix OTHER

# List all work items
npm run cli -- list

# List with filters
npm run cli -- list -s open -p high

# Show a specific work item
npm run cli -- show WI-1

# Show with children
npm run cli -- show WI-1 -c

# Update a work item
npm run cli -- update WI-1 -s in-progress

# Delete a work item
npm run cli -- delete WI-1

# Export data
npm run cli -- export -f backup.jsonl

# Import data
npm run cli -- import -f backup.jsonl
```

### API Server (Optional)

**Note:** The API server is only needed if you want to interact with Worklog via REST API. The CLI can be used without starting the server.

Start the API server:

```bash
npm start
```

The server will run on `http://localhost:3000` by default. It automatically loads data from `worklog-data.jsonl` if it exists.

**Note:** The project will automatically build before starting. If you prefer to build manually, run:

```bash
npm run build
npm start
```

#### API Endpoints

- `GET /health` - Health check
- `POST /items` - Create a work item
- `GET /items` - List work items (with optional filters)
- `GET /items/:id` - Get a specific work item
- `PUT /items/:id` - Update a work item
- `DELETE /items/:id` - Delete a work item
- `GET /items/:id/children` - Get children of a work item
- `GET /items/:id/descendants` - Get all descendants
- `POST /export` - Export data to JSONL
- `POST /import` - Import data from JSONL

## Data Format

Work items are stored in JSONL (JSON Lines) format, with each line representing one work item. This format is Git-friendly as changes to individual items create minimal diffs.

### Work Item Structure

```json
{
  "id": "WI-1",
  "title": "Example task",
  "description": "Task description",
  "status": "open",
  "priority": "medium",
  "parentId": null,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "tags": ["feature", "backend"],
  "assignee": "john.doe",
  "stage": "development"
}
```

### Fields

- **id**: Unique identifier (auto-generated)
- **title**: Short title of the work item
- **description**: Detailed description
- **status**: `open`, `in-progress`, `completed`, or `blocked`
- **priority**: `low`, `medium`, `high`, or `critical`
- **parentId**: ID of parent work item (null for root items)
- **createdAt**: ISO timestamp of creation
- **updatedAt**: ISO timestamp of last update
- **tags**: Array of string tags
- **assignee**: Person assigned to the work item
- **stage**: Current stage of the work item in the workflow

## Development

Build the project:

```bash
npm run build
```

Run in development mode with auto-reload:

```bash
npm run dev
```

## Git Workflow

The system is optimized for Git-based workflows:

1. Make changes using the CLI or API
2. Data is automatically saved to `worklog-data.jsonl`
3. Commit the JSONL file to Git
4. Share with your team through Git push/pull
5. The JSONL format minimizes merge conflicts

## License

MIT
