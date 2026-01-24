/**
 * Comment commands - Manage comments on work items
 */

import type { PluginContext } from '../plugin-types.js';
import type { 
  CommentCreateOptions, 
  CommentListOptions, 
  CommentShowOptions, 
  CommentUpdateOptions, 
  CommentDeleteOptions 
} from '../cli-types.js';
import type { UpdateCommentInput } from '../types.js';
import { humanFormatComment, resolveFormat } from './helpers.js';

export default function register(ctx: PluginContext): void {
  const { program, output, utils } = ctx;
  
  const commentCommand = program
    .command('comment')
    .description('Manage comments on work items');

  commentCommand
    .command('create <workItemId>')
    .alias('add')
    .description('Create a comment on a work item')
    .requiredOption('-a, --author <author>', 'Author of the comment')
    .requiredOption('-c, --comment <comment>', 'Comment text (markdown supported)')
    .option('-r, --references <references>', 'Comma-separated list of references (work item IDs, file paths, or URLs)')
    .option('--prefix <prefix>', 'Override the default prefix')
    .action((workItemId: string, options: CommentCreateOptions) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);
      
      const comment = db.createComment({
        workItemId,
        author: options.author,
        comment: options.comment,
        references: options.references ? options.references.split(',').map((r: string) => r.trim()) : [],
      });
      
      if (!comment) {
        output.error(`Work item not found: ${workItemId}`, { success: false, error: `Work item not found: ${workItemId}` });
        process.exit(1);
      }
      
      if (utils.isJsonMode()) {
        output.json({ success: true, comment });
      } else {
        const format = resolveFormat(program);
        console.log('Created comment:');
        console.log(humanFormatComment(comment, format));
      }
    });

  commentCommand
    .command('list <workItemId>')
    .description('List all comments for a work item')
    .option('--prefix <prefix>', 'Override the default prefix')
    .action((workItemId: string, options: CommentListOptions) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);
      
      const workItem = db.get(workItemId);
      if (!workItem) {
        output.error(`Work item not found: ${workItemId}`, { success: false, error: `Work item not found: ${workItemId}` });
        process.exit(1);
      }
      
      const comments = db.getCommentsForWorkItem(workItemId);
      
      if (utils.isJsonMode()) {
        output.json({ success: true, count: comments.length, workItemId, comments });
      } else {
        if (comments.length === 0) {
          console.log('No comments found for this work item');
          return;
        }
        
        console.log(`Found ${comments.length} comment(s) for ${workItemId}:\n`);
        comments.forEach(comment => {
          console.log(`[${comment.id}] by ${comment.author} at ${comment.createdAt}`);
          console.log(`  ${comment.comment}`);
          if (comment.references.length > 0) {
            console.log(`  References: ${comment.references.join(', ')}`);
          }
          console.log();
        });
      }
    });

  commentCommand
    .command('show <commentId>')
    .description('Show details of a comment')
    .option('--prefix <prefix>', 'Override the default prefix')
    .action((commentId: string, options: CommentShowOptions) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);
      
      const comment = db.getComment(commentId);
      if (!comment) {
        output.error(`Comment not found: ${commentId}`, { success: false, error: `Comment not found: ${commentId}` });
        process.exit(1);
      }
      
      if (utils.isJsonMode()) {
        output.json({ success: true, comment });
      } else {
        const format = resolveFormat(program);
        console.log(humanFormatComment(comment, format));
      }
    });

  commentCommand
    .command('update <commentId>')
    .description('Update a comment')
    .option('-a, --author <author>', 'New author')
    .option('-c, --comment <comment>', 'New comment text')
    .option('-r, --references <references>', 'New references (comma-separated)')
    .option('--prefix <prefix>', 'Override the default prefix')
    .action((commentId: string, options: CommentUpdateOptions) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);
      
      const updates: UpdateCommentInput = {};
      if (options.author) updates.author = options.author;
      if (options.comment) updates.comment = options.comment;
      if (options.references) updates.references = options.references.split(',').map((r: string) => r.trim());
      
      const comment = db.updateComment(commentId, updates);
      if (!comment) {
        output.error(`Comment not found: ${commentId}`, { success: false, error: `Comment not found: ${commentId}` });
        process.exit(1);
      }
      
      if (utils.isJsonMode()) {
        output.json({ success: true, comment });
      } else {
        const format = resolveFormat(program);
        console.log('Updated comment:');
        console.log(humanFormatComment(comment, format));
      }
    });

  commentCommand
    .command('delete <commentId>')
    .description('Delete a comment')
    .option('--prefix <prefix>', 'Override the default prefix')
    .action((commentId: string, options: CommentDeleteOptions) => {
      utils.requireInitialized();
      const db = utils.getDatabase(options.prefix);
      
      const deleted = db.deleteComment(commentId);
      if (!deleted) {
        output.error(`Comment not found: ${commentId}`, { success: false, error: `Comment not found: ${commentId}` });
        process.exit(1);
      }
      
      if (utils.isJsonMode()) {
        output.json({ success: true, message: `Deleted comment: ${commentId}`, deletedId: commentId });
      } else {
        console.log(`Deleted comment: ${commentId}`);
      }
    });
}
