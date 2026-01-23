/**
 * In-memory database for work items
 */

import { WorkItem, CreateWorkItemInput, UpdateWorkItemInput, WorkItemQuery, Comment, CreateCommentInput, UpdateCommentInput } from './types.js';

export class WorklogDatabase {
  private items: Map<string, WorkItem>;
  private comments: Map<string, Comment>;
  private nextId: number;
  private nextCommentId: number;
  private prefix: string;

  constructor(prefix: string = 'WI') {
    this.items = new Map();
    this.comments = new Map();
    this.nextId = 1;
    this.nextCommentId = 1;
    this.prefix = prefix;
  }

  /**
   * Set the prefix for this database
   */
  setPrefix(prefix: string): void {
    this.prefix = prefix;
  }

  /**
   * Get the current prefix
   */
  getPrefix(): string {
    return this.prefix;
  }

  /**
   * Generate a unique ID for a work item
   */
  private generateId(): string {
    return `${this.prefix}-${this.nextId++}`;
  }

  /**
   * Generate a unique ID for a comment
   */
  private generateCommentId(): string {
    return `${this.prefix}-C${this.nextCommentId++}`;
  }

  /**
   * Create a new work item
   */
  create(input: CreateWorkItemInput): WorkItem {
    const id = this.generateId();
    const now = new Date().toISOString();
    
    const item: WorkItem = {
      id,
      title: input.title,
      description: input.description || '',
      status: input.status || 'open',
      priority: input.priority || 'medium',
      parentId: input.parentId || null,
      createdAt: now,
      updatedAt: now,
      tags: input.tags || [],
      assignee: input.assignee || '',
      stage: input.stage || '',
    };

    this.items.set(id, item);
    return item;
  }

  /**
   * Get a work item by ID
   */
  get(id: string): WorkItem | null {
    return this.items.get(id) || null;
  }

  /**
   * Update a work item
   */
  update(id: string, input: UpdateWorkItemInput): WorkItem | null {
    const item = this.items.get(id);
    if (!item) {
      return null;
    }

    const updated: WorkItem = {
      ...item,
      ...input,
      id: item.id, // Prevent ID changes
      createdAt: item.createdAt, // Prevent createdAt changes
      updatedAt: new Date().toISOString(),
    };

    this.items.set(id, updated);
    return updated;
  }

  /**
   * Delete a work item
   */
  delete(id: string): boolean {
    return this.items.delete(id);
  }

  /**
   * List all work items
   */
  list(query?: WorkItemQuery): WorkItem[] {
    let items = Array.from(this.items.values());

    if (query) {
      if (query.status) {
        items = items.filter(item => item.status === query.status);
      }
      if (query.priority) {
        items = items.filter(item => item.priority === query.priority);
      }
      if (query.parentId !== undefined) {
        items = items.filter(item => item.parentId === query.parentId);
      }
      if (query.tags && query.tags.length > 0) {
        items = items.filter(item => 
          query.tags!.some(tag => item.tags.includes(tag))
        );
      }
      if (query.assignee) {
        items = items.filter(item => item.assignee === query.assignee);
      }
      if (query.stage) {
        items = items.filter(item => item.stage === query.stage);
      }
    }

    return items;
  }

  /**
   * Get children of a work item
   */
  getChildren(parentId: string): WorkItem[] {
    return Array.from(this.items.values()).filter(
      item => item.parentId === parentId
    );
  }

  /**
   * Get all descendants (children, grandchildren, etc.) of a work item
   */
  getDescendants(parentId: string): WorkItem[] {
    const descendants: WorkItem[] = [];
    const children = this.getChildren(parentId);
    
    for (const child of children) {
      descendants.push(child);
      descendants.push(...this.getDescendants(child.id));
    }
    
    return descendants;
  }

  /**
   * Clear all work items (useful for import)
   */
  clear(): void {
    this.items.clear();
    this.nextId = 1;
  }

  /**
   * Get all work items as an array
   */
  getAll(): WorkItem[] {
    return Array.from(this.items.values());
  }

  /**
   * Import work items (replaces existing data)
   */
  import(items: WorkItem[]): void {
    this.clear();
    
    // Escape special regex characters in prefix
    const escapedPrefix = this.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Find the highest ID number to continue from
    let maxId = 0;
    for (const item of items) {
      const match = item.id.match(new RegExp(`${escapedPrefix}-(\\d+)`));
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxId) {
          maxId = num;
        }
      }
      this.items.set(item.id, item);
    }
    
    this.nextId = maxId + 1;
  }

  /**
   * Create a new comment
   */
  createComment(input: CreateCommentInput): Comment | null {
    // Verify that the work item exists
    if (!this.items.has(input.workItemId)) {
      return null;
    }

    const id = this.generateCommentId();
    const now = new Date().toISOString();
    
    const comment: Comment = {
      id,
      workItemId: input.workItemId,
      author: input.author,
      comment: input.comment,
      createdAt: now,
      references: input.references || [],
    };

    this.comments.set(id, comment);
    return comment;
  }

  /**
   * Get a comment by ID
   */
  getComment(id: string): Comment | null {
    return this.comments.get(id) || null;
  }

  /**
   * Update a comment
   */
  updateComment(id: string, input: UpdateCommentInput): Comment | null {
    const comment = this.comments.get(id);
    if (!comment) {
      return null;
    }

    const updated: Comment = {
      ...comment,
      ...input,
      id: comment.id, // Prevent ID changes
      workItemId: comment.workItemId, // Prevent workItemId changes
      createdAt: comment.createdAt, // Prevent createdAt changes
    };

    this.comments.set(id, updated);
    return updated;
  }

  /**
   * Delete a comment
   */
  deleteComment(id: string): boolean {
    return this.comments.delete(id);
  }

  /**
   * Get all comments for a work item
   */
  getCommentsForWorkItem(workItemId: string): Comment[] {
    return Array.from(this.comments.values())
      .filter(comment => comment.workItemId === workItemId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Get all comments as an array
   */
  getAllComments(): Comment[] {
    return Array.from(this.comments.values());
  }

  /**
   * Import comments
   */
  importComments(comments: Comment[]): void {
    this.comments.clear();
    
    // Escape special regex characters in prefix
    const escapedPrefix = this.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const commentIdPattern = new RegExp(`${escapedPrefix}-C(\\d+)`);
    
    // Find the highest comment ID number to continue from
    let maxCommentId = 0;
    for (const comment of comments) {
      const match = comment.id.match(commentIdPattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxCommentId) {
          maxCommentId = num;
        }
      }
      this.comments.set(comment.id, comment);
    }
    
    this.nextCommentId = maxCommentId + 1;
  }
}
