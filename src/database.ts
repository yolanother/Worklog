/**
 * In-memory database for work items
 */

import { WorkItem, CreateWorkItemInput, UpdateWorkItemInput, WorkItemQuery } from './types.js';

export class WorklogDatabase {
  private items: Map<string, WorkItem>;
  private nextId: number;

  constructor() {
    this.items = new Map();
    this.nextId = 1;
  }

  /**
   * Generate a unique ID for a work item
   */
  private generateId(): string {
    return `WI-${this.nextId++}`;
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
    
    // Find the highest ID number to continue from
    let maxId = 0;
    for (const item of items) {
      const match = item.id.match(/WI-(\d+)/);
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
}
