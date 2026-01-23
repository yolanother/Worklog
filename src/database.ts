/**
 * Persistent database for work items with SQLite backend
 */

import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { WorkItem, CreateWorkItemInput, UpdateWorkItemInput, WorkItemQuery, Comment, CreateCommentInput, UpdateCommentInput } from './types.js';
import { SqlitePersistentStore } from './persistent-store.js';
import { importFromJsonl, exportToJsonl, getDefaultDataPath } from './jsonl.js';

const UNIQUE_TIME_LENGTH = 9;
const UNIQUE_RANDOM_BYTES = 4;
const UNIQUE_RANDOM_LENGTH = 7;
const UNIQUE_ID_LENGTH = UNIQUE_TIME_LENGTH + UNIQUE_RANDOM_LENGTH;
const MAX_ID_GENERATION_ATTEMPTS = 10;

export class WorklogDatabase {
  private store: SqlitePersistentStore;
  private prefix: string;
  private jsonlPath: string;
  private autoExport: boolean;
  private silent: boolean;

  constructor(prefix: string = 'WI', dbPath?: string, jsonlPath?: string, autoExport: boolean = true, silent: boolean = false) {
    this.prefix = prefix;
    this.jsonlPath = jsonlPath || getDefaultDataPath();
    this.autoExport = autoExport;
    this.silent = silent;
    
    // Use default DB path if not provided
    const defaultDbPath = path.join(path.dirname(this.jsonlPath), 'worklog.db');
    const actualDbPath = dbPath || defaultDbPath;
    
    this.store = new SqlitePersistentStore(actualDbPath);
    
    // Refresh from JSONL if needed
    this.refreshFromJsonlIfNewer();
  }

  /**
   * Refresh database from JSONL file if JSONL is newer
   */
  private refreshFromJsonlIfNewer(): void {
    if (!fs.existsSync(this.jsonlPath)) {
      return; // No JSONL file, nothing to refresh from
    }

    const jsonlStats = fs.statSync(this.jsonlPath);
    const jsonlMtime = jsonlStats.mtimeMs;

    const metadata = this.store.getAllMetadata();
    const lastImportMtime = metadata.lastJsonlImportMtime;

    // If DB is empty or JSONL is newer, refresh from JSONL
    const itemCount = this.store.countWorkItems();
    const shouldRefresh = itemCount === 0 || !lastImportMtime || jsonlMtime > lastImportMtime;

    if (shouldRefresh) {
      if (!this.silent) {
        console.log(`Refreshing database from ${this.jsonlPath}...`);
      }
      const { items: jsonlItems, comments: jsonlComments } = importFromJsonl(this.jsonlPath);
      this.store.importData(jsonlItems, jsonlComments);
      
      // Update metadata
      this.store.setMetadata('lastJsonlImportMtime', jsonlMtime.toString());
      this.store.setMetadata('lastJsonlImportAt', new Date().toISOString());
      
      if (!this.silent) {
        console.log(`Loaded ${jsonlItems.length} work items and ${jsonlComments.length} comments from JSONL`);
      }
    }
  }

  /**
   * Export current database state to JSONL
   */
  private exportToJsonl(): void {
    if (!this.autoExport) {
      return;
    }
    
    const items = this.store.getAllWorkItems();
    const comments = this.store.getAllComments();
    exportToJsonl(items, comments, this.jsonlPath);
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
    for (let attempt = 0; attempt < MAX_ID_GENERATION_ATTEMPTS; attempt += 1) {
      const id = `${this.prefix}-${this.generateUniqueId()}`;
      if (!this.store.getWorkItem(id)) {
        return id;
      }
    }
    throw new Error('Unable to generate a unique work item ID');
  }

  /**
   * Generate a unique ID for a comment
   */
  private generateCommentId(): string {
    for (let attempt = 0; attempt < MAX_ID_GENERATION_ATTEMPTS; attempt += 1) {
      const id = `${this.prefix}-C${this.generateUniqueId()}`;
      if (!this.store.getComment(id)) {
        return id;
      }
    }
    throw new Error('Unable to generate a unique comment ID');
  }

  /**
   * Generate a globally unique, human-readable identifier
   */
  private generateUniqueId(): string {
    const timeRaw = Date.now().toString(36).toUpperCase();
    if (timeRaw.length > UNIQUE_TIME_LENGTH) {
      throw new Error('Timestamp overflow while generating unique ID');
    }
    const timePart = timeRaw.padStart(UNIQUE_TIME_LENGTH, '0');
    const randomBytesValue = randomBytes(UNIQUE_RANDOM_BYTES);
    const randomNumber = randomBytesValue.readUInt32BE(0);
    const randomPart = randomNumber.toString(36).toUpperCase().padStart(UNIQUE_RANDOM_LENGTH, '0');
    const id = `${timePart}${randomPart}`;
    if (id.length !== UNIQUE_ID_LENGTH) {
      throw new Error('Generated unique ID has unexpected length');
    }
    return id;
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

      issueType: input.issueType || '',
      createdBy: input.createdBy || '',
      deletedBy: input.deletedBy || '',
      deleteReason: input.deleteReason || '',
    };

    this.store.saveWorkItem(item);
    this.exportToJsonl();
    return item;
  }

  /**
   * Get a work item by ID
   */
  get(id: string): WorkItem | null {
    return this.store.getWorkItem(id);
  }

  /**
   * Update a work item
   */
  update(id: string, input: UpdateWorkItemInput): WorkItem | null {
    const item = this.store.getWorkItem(id);
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

    this.store.saveWorkItem(updated);
    this.exportToJsonl();
    return updated;
  }

  /**
   * Delete a work item
   */
  delete(id: string): boolean {
    const result = this.store.deleteWorkItem(id);
    if (result) {
      this.exportToJsonl();
    }
    return result;
  }

  /**
   * List all work items
   */
  list(query?: WorkItemQuery): WorkItem[] {
    let items = this.store.getAllWorkItems();

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
      if (query.issueType) {
        items = items.filter(item => item.issueType === query.issueType);
      }
      if (query.createdBy) {
        items = items.filter(item => item.createdBy === query.createdBy);
      }
      if (query.deletedBy) {
        items = items.filter(item => item.deletedBy === query.deletedBy);
      }
      if (query.deleteReason) {
        items = items.filter(item => item.deleteReason === query.deleteReason);
      }
    }

    return items;
  }

  /**
   * Get children of a work item
   */
  getChildren(parentId: string): WorkItem[] {
    return this.store.getAllWorkItems().filter(
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
   * Check if a work item is a leaf node (has no children)
   */
  isLeafNode(itemId: string): boolean {
    return this.getChildren(itemId).length === 0;
  }

  /**
   * Get all leaf nodes that are descendants of a parent item
   */
  getLeafDescendants(parentId: string): WorkItem[] {
    const descendants = this.getDescendants(parentId);
    return descendants.filter(item => this.isLeafNode(item.id));
  }

  /**
   * Find the next work item to work on based on priority and creation time
   * @param assignee - Optional assignee filter
   * @param searchTerm - Optional search term for fuzzy matching
   * @returns The next work item to work on, or null if none found
   */
  findNextWorkItem(assignee?: string, searchTerm?: string): WorkItem | null {
    let items = this.store.getAllWorkItems();

    // Filter out deleted items first
    items = items.filter(item => item.status !== 'deleted');

    // Apply filters
    items = this.applyFilters(items, assignee, searchTerm);

    // Find in-progress items
    const inProgressItems = items.filter(item => item.status === 'in-progress');

    if (inProgressItems.length === 0) {
      // No in-progress items, find highest priority and oldest non-in-progress item
      const openItems = items.filter(item => item.status !== 'completed');
      if (openItems.length === 0) {
        return null;
      }
      return this.selectHighestPriorityOldest(openItems);
    }

    // There are in-progress items
    // Find the highest priority and oldest in-progress item
    const selectedInProgress = this.selectHighestPriorityOldest(inProgressItems);
    if (!selectedInProgress) {
      return null;
    }

    // Get leaf descendants that are not in progress or completed
    const leafDescendants = this.getLeafDescendants(selectedInProgress.id);
    
    // Apply the same filters to leaf descendants and filter by workable status
    const filteredLeaves = this.applyFilters(leafDescendants, assignee, searchTerm).filter(
      item => item.status !== 'in-progress' && item.status !== 'completed' && item.status !== 'deleted'
    );

    if (filteredLeaves.length === 0) {
      // No suitable leaf descendants, return the in-progress item itself
      return selectedInProgress;
    }

    // Select highest priority and oldest leaf descendant
    return this.selectHighestPriorityOldest(filteredLeaves);
  }

  /**
   * Apply assignee and search term filters to a list of work items
   */
  private applyFilters(items: WorkItem[], assignee?: string, searchTerm?: string): WorkItem[] {
    let filtered = items;

    // Filter by assignee if provided
    if (assignee) {
      filtered = filtered.filter(item => item.assignee === assignee);
    }

    // Filter by search term if provided (fuzzy match against title, description, and comments)
    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      filtered = filtered.filter(item => {
        // Check title and description
        const titleMatch = item.title.toLowerCase().includes(lowerSearchTerm);
        const descriptionMatch = item.description?.toLowerCase().includes(lowerSearchTerm) || false;
        
        // Check comments
        const comments = this.getCommentsForWorkItem(item.id);
        const commentMatch = comments.some(comment => 
          comment.comment.toLowerCase().includes(lowerSearchTerm)
        );
        
        return titleMatch || descriptionMatch || commentMatch;
      });
    }

    return filtered;
  }

  /**
   * Helper method to select the highest priority and oldest item from a list
   */
  private selectHighestPriorityOldest(items: WorkItem[]): WorkItem | null {
    if (items.length === 0) {
      return null;
    }

    // Define priority order
    const priorityOrder: { [key: string]: number } = {
      'critical': 4,
      'high': 3,
      'medium': 2,
      'low': 1,
    };

    // Sort by priority (descending) then by createdAt (ascending - oldest first)
    const sorted = items.sort((a, b) => {
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      // If priorities are equal, sort by creation time (oldest first)
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    return sorted[0];
  }

  /**
   * Clear all work items (useful for import)
   */
  clear(): void {
    this.store.clearWorkItems();
  }

  /**
   * Get all work items as an array
   */
  getAll(): WorkItem[] {
    return this.store.getAllWorkItems();
  }

  /**
   * Import work items (replaces existing data)
   */
  import(items: WorkItem[]): void {
    this.store.clearWorkItems();
    for (const item of items) {
      this.store.saveWorkItem(item);
    }
    this.exportToJsonl();
  }

  /**
   * Create a new comment
   */
  createComment(input: CreateCommentInput): Comment | null {
    // Validate required fields
    if (!input.author || input.author.trim() === '') {
      throw new Error('Author is required');
    }
    if (!input.comment || input.comment.trim() === '') {
      throw new Error('Comment text is required');
    }
    
    // Verify that the work item exists
    if (!this.store.getWorkItem(input.workItemId)) {
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

    this.store.saveComment(comment);
    this.exportToJsonl();
    return comment;
  }

  /**
   * Get a comment by ID
   */
  getComment(id: string): Comment | null {
    return this.store.getComment(id);
  }

  /**
   * Update a comment
   */
  updateComment(id: string, input: UpdateCommentInput): Comment | null {
    const comment = this.store.getComment(id);
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

    this.store.saveComment(updated);
    this.exportToJsonl();
    return updated;
  }

  /**
   * Delete a comment
   */
  deleteComment(id: string): boolean {
    const result = this.store.deleteComment(id);
    if (result) {
      this.exportToJsonl();
    }
    return result;
  }

  /**
   * Get all comments for a work item
   */
  getCommentsForWorkItem(workItemId: string): Comment[] {
    return this.store.getCommentsForWorkItem(workItemId);
  }

  /**
   * Get all comments as an array
   */
  getAllComments(): Comment[] {
    return this.store.getAllComments();
  }

  /**
   * Import comments
   */
  importComments(comments: Comment[]): void {
    this.store.clearComments();
    for (const comment of comments) {
      this.store.saveComment(comment);
    }
    this.exportToJsonl();
  }
}
