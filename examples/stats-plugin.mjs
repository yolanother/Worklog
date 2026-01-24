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
          console.log('\n📊 Work Item Statistics\n');
          console.log(`Total Items: ${stats.total}`);
          console.log(`Items with Parents: ${stats.withParent}`);
          console.log(`Items with Tags: ${stats.withTags}`);
          console.log(`Items with Comments: ${stats.withComments}`);
          
          console.log('\nBy Status:');
          Object.entries(stats.byStatus)
            .sort((a, b) => b[1] - a[1])
            .forEach(([status, count]) => {
              const percentage = stats.total > 0 ? ((count / stats.total) * 100).toFixed(1) : 0;
              console.log(`  ${status.padEnd(15)} ${count.toString().padStart(3)} (${percentage}%)`);
            });
          
          console.log('\nBy Priority:');
          const priorityOrder = ['critical', 'high', 'medium', 'low'];
          priorityOrder.forEach(priority => {
            const count = stats.byPriority[priority] || 0;
            if (count > 0) {
              const percentage = stats.total > 0 ? ((count / stats.total) * 100).toFixed(1) : 0;
              console.log(`  ${priority.padEnd(15)} ${count.toString().padStart(3)} (${percentage}%)`);
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
