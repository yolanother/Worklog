# Worklog Plugin Examples

This directory contains example plugins that demonstrate how to extend Worklog with custom commands.

## Available Examples

### stats-plugin.mjs

A comprehensive example that shows:
- Database access (reading work items and comments)
- JSON output mode support
- Initialization checking
- Error handling
- Statistics calculation and formatting

**Features:**
- Shows total work items
- Breaks down items by status and priority
- Counts items with parents, tags, and comments
- Supports both human-readable and JSON output

**Installation:**

```bash
# Copy to your plugin directory
cp examples/stats-plugin.mjs .worklog/plugins/

# Use it
worklog stats
worklog stats --json
```

**Output Example:**

```
📊 Work Item Statistics

Total Items: 15
Items with Parents: 5
Items with Tags: 8
Items with Comments: 3

By Status:
  open              8 (53.3%)
  in-progress       4 (26.7%)
  completed         3 (20.0%)

By Priority:
  critical          2 (13.3%)
  high              5 (33.3%)
  medium            6 (40.0%)
  low               2 (13.3%)
```

## Creating Your Own Plugins

See [PLUGIN_GUIDE.md](../PLUGIN_GUIDE.md) for complete documentation on creating plugins.

### Quick Template

```javascript
export default function register(ctx) {
  ctx.program
    .command('my-command')
    .description('My custom command')
    .option('--prefix <prefix>', 'Override prefix')
    .action((options) => {
      // Always check initialization
      ctx.utils.requireInitialized();
      
      // Get database
      const db = ctx.utils.getDatabase(options.prefix);
      
      // Your logic here
      const items = db.getAll();
      
      // Support JSON mode
      if (ctx.utils.isJsonMode()) {
        ctx.output.json({ success: true, count: items.length });
      } else {
        console.log(`Found ${items.length} items`);
      }
    });
}
```

## Testing Plugins

1. **Create a test directory:**
   ```bash
   mkdir -p /tmp/plugin-test/.worklog/plugins
   cd /tmp/plugin-test
   ```

2. **Initialize Worklog:**
   ```bash
   worklog init
   ```

3. **Copy your plugin:**
   ```bash
   cp path/to/your-plugin.mjs .worklog/plugins/
   ```

4. **Verify it appears:**
   ```bash
   worklog --help  # Should show your command
   worklog plugins # Lists discovered plugins
   ```

5. **Test your command:**
   ```bash
   worklog your-command
   worklog your-command --json
   ```

## More Examples

For more complex examples, see the [PLUGIN_GUIDE.md](../PLUGIN_GUIDE.md) which includes:
- Bulk tag operations
- CSV export
- Custom report generation
- Subcommand groups
- Async operations

## Contributing Examples

Have a useful plugin example? Please contribute!

1. Create your plugin with clear comments
2. Test it thoroughly
3. Add documentation to this README
4. Submit a pull request

## License

These examples are released under the MIT license, same as Worklog.
