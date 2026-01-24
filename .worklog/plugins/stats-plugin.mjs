/**
 * Example Plugin: Custom Work Item Statistics
 * 
 * This plugin demonstrates how to create a Worklog plugin that:
 * - Accesses the database
 * - Supports JSON output mode
 * - Respects initialization status
 * - Uses proper error handling
 * 
 * Installation:
 * 1. Copy this file to .worklog/plugins/stats-example.mjs
 * 2. Run: worklog stats
 */

export default function register(ctx) {
  ctx.program
    .command('stats')
    .description('Show custom work item statistics')
    .option('--prefix <prefix>', 'Override the default prefix')
    .action((options) => {
      // Ensure Worklog is initialized
      ctx.utils.requireInitialized();
      
      try {
        // Get database instance
        const db = ctx.utils.getDatabase(options.prefix);
        
        // Fetch all work items
        const items = db.getAll();
        
        // Calculate statistics
        const stats = {
          total: items.length,
          byStatus: {},
          byPriority: {},
          withParent: items.filter(i => i.parentId !== null).length,
          withComments: 0,
          withTags: items.filter(i => i.tags && i.tags.length > 0).length
        };
        
        // Count by status
        items.forEach(item => {
          const status = item.status;
          stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
        });
        
        // Count by priority
        items.forEach(item => {
          const priority = item.priority;
          stats.byPriority[priority] = (stats.byPriority[priority] || 0) + 1;
        });
        
        // Count items with comments
        items.forEach(item => {
          const comments = db.getCommentsForWorkItem(item.id);
          if (comments.length > 0) {
            stats.withComments++;
          }
        });
        
        // Output results
        if (ctx.utils.isJsonMode()) {
          ctx.output.json({ success: true, stats });
        } else {
          const renderBar = (count, max, width = 20) => {
            if (max <= 0) return '';
            const barLength = Math.round((count / max) * width);
            return '█'.repeat(barLength).padEnd(width, ' ');
          };

          const formatLine = (label, count, total, max) => {
            const percentage = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
            const bar = renderBar(count, max);
            return { label, count, percentage, bar };
          };

          console.log('\n📊 Work Item Statistics\n');
          console.log(`Total Items: ${stats.total}`);
          console.log(`Items with Parents: ${stats.withParent}`);
          console.log(`Items with Tags: ${stats.withTags}`);
          console.log(`Items with Comments: ${stats.withComments}`);
          
          console.log('\nBy Status:');
          const statusEntries = Object.entries(stats.byStatus).sort((a, b) => b[1] - a[1]);
          const statusMax = statusEntries.reduce((max, entry) => Math.max(max, entry[1]), 0);
          const statusLabelWidth = statusEntries.reduce((max, entry) => Math.max(max, entry[0].length), 0);
          const statusCountWidth = Math.max(3, statusEntries.reduce((max, entry) => Math.max(max, entry[1].toString().length), 0));
          const percentWidth = 5;
          const priorityOrder = ['critical', 'high', 'medium', 'low'];
          const priorityLabelWidth = priorityOrder.reduce((max, label) => Math.max(max, label.length), 0);
          const priorityCountWidth = Math.max(
            3,
            priorityOrder.reduce((max, label) => Math.max(max, (stats.byPriority[label] || 0).toString().length), 0)
          );
          const labelWidth = Math.max(statusLabelWidth, priorityLabelWidth);
          const countWidth = Math.max(statusCountWidth, priorityCountWidth);
          statusEntries
            .map(([status, count]) => formatLine(status, count, stats.total, statusMax))
            .forEach(({ label, count, percentage, bar }) => {
              const paddedLabel = label.padEnd(labelWidth);
              const paddedCount = count.toString().padStart(countWidth);
              const paddedPercent = percentage.toString().padStart(percentWidth);
              console.log(`  ${paddedLabel} ${paddedCount} (${paddedPercent}%) ${bar}`);
            });
          
          console.log('\nBy Priority:');
          const priorityMax = Object.values(stats.byPriority).reduce((max, value) => Math.max(max, value), 0);
          priorityOrder.forEach(priority => {
            const count = stats.byPriority[priority] || 0;
            if (count > 0) {
              const { percentage, bar } = formatLine(priority, count, stats.total, priorityMax);
              const paddedLabel = priority.padEnd(labelWidth);
              const paddedCount = count.toString().padStart(countWidth);
              const paddedPercent = percentage.toString().padStart(percentWidth);
              console.log(`  ${paddedLabel} ${paddedCount} (${paddedPercent}%) ${bar}`);
            }
          });
          
          console.log('');
        }
      } catch (error) {
        ctx.output.error(`Failed to generate statistics: ${error.message}`, {
          success: false,
          error: error.message
        });
        process.exit(1);
      }
    });
}
