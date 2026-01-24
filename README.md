# Worklog

A simple experimental issue tracker for AI agents. This is a lightweight worklog system similar to an issue tracker, designed to track a hierarchy of work items with basic fields.

## Features

- **Persistent Database**: SQLite-backed storage that persists across CLI/API executions
- **API**: REST API built with Express
- **CLI**: Command-line interface for quick operations
- **Pluggable Commands**: Extend the CLI with custom commands via plugins (see [Plugin Guide](PLUGIN_GUIDE.md))
- **Git-Friendly**: Data stored in JSONL format for easy Git syncing and collaboration
- **Auto-Refresh**: Database automatically refreshes from JSONL when file is updated (e.g., after git pull)
- **Hierarchical Work Items**: Support for parent-child relationships
- **Comments**: Add comments to work items with markdown support and references
- **Multi-Project Support**: Configure custom prefixes for issue IDs per project
- **Data Syncing**: Git-backed syncing and optional GitHub Issue mirroring
- **Risk and Effort Estimation**: Track risk (Low/Medium/High/Severe) and effort (XS/S/M/L/XL) for each work item

## Installation

### For Development

```bash
npm install
npm run build
```

### As a Global CLI Tool

To install the CLI globally so you can use `worklog` or `wl` commands from anywhere:

```bash
npm install -g .
```

Or, for local development with live updates:

```bash
npm link
```

This will make the `worklog` and `wl` commands available globally.

## Configuration

Worklog uses a two-tier configuration system:

1. **Default configuration** (`.worklog/config.defaults.yaml`): Committed to version control and contains the team's default settings
2. **Local configuration** (`.worklog/config.yaml`): Not committed to version control, contains user-specific overrides

### First-Time Setup

Before using Worklog, initialize your project configuration:

```bash
worklog init
# or use the short alias
wl init
```

**Note:** If you haven't installed the CLI globally, you can still use `npm run cli -- init` for development.

This will prompt you for:
- **Project name**: A descriptive name for your project
- **Issue ID prefix**: A short prefix for your issue IDs (e.g., WI, PROJ, TASK)
- **Auto-sync**: Enable automatic git sync after changes (optional)

Optional GitHub settings (edit `.worklog/config.yaml` manually):
- `githubRepo`: `owner/name` for GitHub Issue mirroring
- `githubLabelPrefix`: label prefix (default `wl:`)
- `githubImportCreateNew`: create work items from unmarked issues (default `true`)

See `DATA_SYNCING.md` for full sync workflow details (git-backed + GitHub Issues).

The configuration is saved to `.worklog/config.yaml` as your local configuration.

After creating the configuration, `init` will automatically sync the database with the remote repository to pull any existing work items and comments.

**Example:**
```
Project name: MyProject
Issue ID prefix: MP
```

This will create issues with IDs like `MP-0J8L1JQ3H8ZQ2K6D`, `MP-0J8L1JQ3H8ZQ2K6E`, etc.

### Configuration Override System

The system loads configuration in this order:
1. First loads `.worklog/config.defaults.yaml` if it exists (team defaults)
2. Then loads `.worklog/config.yaml` if it exists (your overrides)
3. Values in `config.yaml` override those in `config.defaults.yaml`

**For teams**: Commit `.worklog/config.defaults.yaml` to share default settings. Team members can then create their own `.worklog/config.yaml` to override specific values as needed.

**For individual users**: If no defaults file exists, just use `worklog init` to create your local `config.yaml`.

If no configuration exists at all, the system defaults to using `WI` as the prefix.

## Data Storage and Persistence

Worklog uses a **dual-storage model** to combine the benefits of persistent databases and Git-friendly text files:

### Storage Architecture

1. **SQLite Database** (`.worklog/worklog.db`)
   - Primary runtime storage
   - Persists across CLI and API executions
   - Fast queries and transactions
   - Located in `.worklog/worklog.db` (not committed to Git)

2. **JSONL Export** (`.worklog/worklog-data.jsonl`)
   - Git-friendly text format (one JSON object per line)
   - Automatically exported on every write operation
   - Used for collaboration via Git (pull/push)
   - Located in `.worklog/worklog-data.jsonl` (not committed to Git)

### How It Works

**On Startup (CLI or API)**:
- Database connects to persistent SQLite file
- Checks if JSONL file is newer than database's last import
- If JSONL is newer (e.g., after `git pull`), automatically refreshes database from JSONL
- If database is empty and JSONL exists, imports from JSONL

**On Write Operations** (create/update/delete):
- Changes saved to database immediately
- Database automatically exports current state to JSONL
- If auto-sync is enabled, Worklog pushes updates to the git data ref automatically

### Source of Truth Model

- **Database**: Runtime source of truth for CLI and API operations
- **JSONL**: Import/export boundary for Git workflows
- If auto-sync is enabled, the git JSONL ref acts as the team-wide canonical source

### Git Workflow

The JSONL format enables team collaboration:

```bash
# Pull latest changes from team
git pull

# Your next CLI/API call automatically refreshes from the updated JSONL
worklog list

# Make changes
worklog create -t "New task"

# JSONL is automatically updated, commit and push
git add .worklog/worklog-data.jsonl
git commit -m "Add new task"
git push
```

The `sync` command provides automated Git workflow:

```bash
# Pull, merge, and push in one command
worklog sync

# Dry run to preview changes
worklog sync --dry-run
```

## Usage

### CLI

The CLI tool allows you to manage work items from the command line. All commands support the `--prefix` flag to override the default prefix from configuration.

#### Output Formats

By default, commands output human-readable content. You can use the `--json` flag to get machine-readable JSON output instead, which is useful for scripting and automation:

```bash
# Human-readable output (default)
worklog list

# Machine-readable JSON output
worklog --json list
```

#### Human Display Formats (new)

Worklog supports a global human display `--format` (short: `-F`) to control how work items and comments are rendered for humans. Valid values: `concise`, `normal`, `full`, `raw`.

- `concise` — compact, one-line title + gray ID (good for lists)
- `normal`  — multi-line human-friendly view with key fields
- `full`    — `normal` plus tags/stage and inlined comments (if available)
- `raw`     — JSON stringified work item/comment (useful for copy/paste)

Format precedence: CLI `--format` > per-command provided format (if implemented) > `config.humanDisplay` > default `concise`.

Examples:

```bash
# Show next item in concise form (default)
wl next

# Force normal output
wl next --format normal

# Show full details (includes comments when available)
wl show WI-0J8L1JQ3H8ZQ2K6D --format full

# Output raw JSON for scripting or copy/paste
wl --format raw show WI-0J8L1JQ3H8ZQ2K6D
```

**Note:** For development, you can also use `npm run cli -- <command>` if you haven't installed the CLI globally.

#### Examples

```bash
# Initialize project configuration (run this first)
worklog init

# Create a new work item
worklog create -t "My first task" -d "Description here" -s open -p high

# Create with JSON output
worklog --json create -t "My first task" -d "Description here" -s open -p high

# Create with a custom prefix override
worklog create -t "Task for another project" --prefix OTHER

# List all work items
worklog list

# List with filters
worklog list -s open -p high

# Show a specific work item
worklog show WI-0J8L1JQ3H8ZQ2K6D

# Show with children
worklog show WI-0J8L1JQ3H8ZQ2K6D -c

# Update a work item
worklog update WI-0J8L1JQ3H8ZQ2K6D -s in-progress

# Delete a work item
worklog delete WI-0J8L1JQ3H8ZQ2K6D

# Create a comment on a work item
worklog comment-create WI-0J8L1JQ3H8ZQ2K6D -a "John Doe" -c "This is a comment with **markdown**" -r "WI-0J8L1JQ3H8ZQ2K6E,src/api.ts,https://example.com"

# List comments for a work item
worklog comment-list WI-0J8L1JQ3H8ZQ2K6D

# Show a specific comment
worklog comment-show WI-C0J8L1JQ3H8ZQ2K6F

# Update a comment
worklog comment-update WI-C0J8L1JQ3H8ZQ2K6F -c "Updated comment text"

# Delete a comment
worklog comment-delete WI-C0J8L1JQ3H8ZQ2K6F

# Export data
worklog export -f backup.jsonl

# Import data
worklog import -f backup.jsonl

# Sync with git (pull, merge with conflict resolution, and push)
worklog sync

# Sync with options
worklog sync --dry-run        # Preview changes without applying
worklog sync --no-push        # Pull and merge but don't push
worklog sync -f custom.jsonl  # Sync a different file

# Mirror work items to GitHub Issues
worklog github push --repo owner/name

# Shorthand
worklog gh push --repo owner/name

# Import updates from GitHub Issues (only items with worklog markers)
worklog github import --repo owner/name --since 2024-01-01T00:00:00Z

# Create new Worklog items from GitHub Issues and push markers back
worklog github import --repo owner/name --create-new

Note: GitHub syncs can be slow when there are many changes. For best performance, run imports and pushes regularly (some teams set up a cron job) to keep each sync small.

# Enable auto-sync via config defaults
# .worklog/config.defaults.yaml
# autoSync: true

# Using the short alias 'wl'
wl list                       # Same as 'worklog list'
wl create -t "Quick task"     # Same as 'worklog create -t "Quick task"'
```

### API Server (Optional)

**Note:** The API server is only needed if you want to interact with Worklog via REST API. The CLI can be used without starting the server.

Start the API server:

```bash
npm start
```

The server will run on `http://localhost:3000` by default. It automatically loads data from `.worklog/worklog-data.jsonl` if it exists.

**Note:** The project will automatically build before starting. If you prefer to build manually, run:

```bash
npm run build
npm start
```

#### API Endpoints

**Work Items:**
- `GET /health` - Health check
- `POST /items` - Create a work item
- `GET /items` - List work items (with optional filters)
- `GET /items/:id` - Get a specific work item
- `PUT /items/:id` - Update a work item
- `DELETE /items/:id` - Delete a work item
- `GET /items/:id/children` - Get children of a work item
- `GET /items/:id/descendants` - Get all descendants

**Comments:**
- `POST /items/:id/comments` - Create a comment on a work item
- `GET /items/:id/comments` - Get all comments for a work item
- `GET /comments/:commentId` - Get a specific comment
- `PUT /comments/:commentId` - Update a comment
- `DELETE /comments/:commentId` - Delete a comment

**Data Management:**
- `POST /export` - Export data to JSONL
- `POST /import` - Import data from JSONL

**Note:** All endpoints also support project prefix routing via `/projects/:prefix/...`

## Data Format

Work items and comments are stored in JSONL (JSON Lines) format, with each line representing one item. This format is Git-friendly as changes to individual items create minimal diffs.

### Work Item Structure

```json
{
  "id": "WI-0J8L1JQ3H8ZQ2K6D",
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

#### Work Item Fields

- **id**: Unique identifier (auto-generated)
- **title**: Short title of the work item
- **description**: Detailed description
- **status**: `open`, `in-progress`, `completed`, `blocked`, or `deleted`
- **priority**: `low`, `medium`, `high`, or `critical`
- **parentId**: ID of parent work item (null for root items)
- **createdAt**: ISO timestamp of creation
- **updatedAt**: ISO timestamp of last update
- **tags**: Array of string tags
- **assignee**: Person assigned to the work item
- **stage**: Current stage of the work item in the workflow
- **issueType**: Optional interoperability field for imported issue types
- **createdBy**: Optional interoperability field for imported creator/actor
- **deletedBy**: Optional interoperability field for imported deleter/actor
- **deleteReason**: Optional interoperability field for imported deletion reason

### Comment Structure

```json
{
  "id": "WI-C0J8L1JQ3H8ZQ2K6F",
  "workItemId": "WI-0J8L1JQ3H8ZQ2K6D",
  "author": "Jane Doe",
  "comment": "This is a comment with **markdown** support!",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "references": ["WI-0J8L1JQ3H8ZQ2K6E", "src/api.ts", "https://example.com/docs"]
}
```

#### Comment Fields

- **id**: Unique identifier (auto-generated, format: `PREFIX-C<unique>`)
- **workItemId**: ID of the work item this comment belongs to
- **author**: Name of the comment author (freeform string)
- **comment**: Comment text in markdown format
- **createdAt**: ISO timestamp of creation
- **references**: Array of references (work item IDs, relative file paths, or URLs)

## Plugins

Worklog supports a pluggable command architecture that allows you to extend the CLI with custom commands without modifying the Worklog codebase. 

### Quick Example

Create `.worklog/plugins/hello.mjs`:

```javascript
export default function register(ctx) {
  ctx.program
    .command('hello')
    .description('Say hello')
    .option('-n, --name <name>', 'Name to greet', 'World')
    .action((options) => {
      console.log(`Hello, ${options.name}!`);
    });
}
```

Then use it:

```bash
worklog hello --name Alice
# Output: Hello, Alice!
```

For complete plugin development documentation, see the [Plugin Development Guide](PLUGIN_GUIDE.md).

### List Installed Plugins

```bash
worklog plugins          # List discovered plugins
worklog plugins --json   # JSON output with details
```

## Development

Build the project:

```bash
npm run build
```

Run in development mode with auto-reload:

```bash
npm run dev
```

### Testing

The project includes a comprehensive test suite with 67 passing tests covering:

- Database operations (CRUD, queries, relationships)
- JSONL import/export functionality
- Sync operations and conflict resolution
- Configuration management

Run tests:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

See [tests/README.md](tests/README.md) for detailed testing documentation.

## Git Workflow

The system is optimized for Git-based workflows:

1. Make changes using the CLI or API
2. Data is automatically saved to `.worklog/worklog-data.jsonl`
3. Commit the JSONL file to Git
4. Share with your team through Git push/pull
5. The JSONL format minimizes merge conflicts

## License

MIT
