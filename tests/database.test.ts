/**
 * Tests for WorklogDatabase
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorklogDatabase } from '../src/database.js';
import { createTempDir, cleanupTempDir, createTempJsonlPath, createTempDbPath } from './test-utils.js';

describe('WorklogDatabase', () => {
  let tempDir: string;
  let dbPath: string;
  let jsonlPath: string;
  let db: WorklogDatabase;

  beforeEach(() => {
    tempDir = createTempDir();
    dbPath = createTempDbPath(tempDir);
    jsonlPath = createTempJsonlPath(tempDir);
    db = new WorklogDatabase('TEST', dbPath, jsonlPath, true, true);
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('create', () => {
    it('should create a work item with required fields', () => {
      const item = db.create({
        title: 'Test task',
      });

      expect(item).toBeDefined();
      expect(item.id).toMatch(/^TEST-[A-Z0-9]+$/);
      expect(item.title).toBe('Test task');
      expect(item.description).toBe('');
      expect(item.status).toBe('open');
      expect(item.priority).toBe('medium');
      expect(item.parentId).toBe(null);
      expect(item.tags).toEqual([]);
      expect(item.assignee).toBe('');
      expect(item.stage).toBe('');
      expect(item.issueType).toBe('');
      expect(item.createdBy).toBe('');
      expect(item.deletedBy).toBe('');
      expect(item.deleteReason).toBe('');
      expect(item.createdAt).toBeDefined();
      expect(item.updatedAt).toBeDefined();
    });

    it('should create a work item with all optional fields', () => {
      const item = db.create({
        title: 'Full task',
        description: 'A complete description',
        status: 'in-progress',
        priority: 'high',
        tags: ['feature', 'backend'],
        assignee: 'john.doe',
        stage: 'development',
        issueType: 'task',
        createdBy: 'john.doe',
      });

      expect(item.title).toBe('Full task');
      expect(item.description).toBe('A complete description');
      expect(item.status).toBe('in-progress');
      expect(item.priority).toBe('high');
      expect(item.tags).toEqual(['feature', 'backend']);
      expect(item.assignee).toBe('john.doe');
      expect(item.stage).toBe('development');
      expect(item.issueType).toBe('task');
      expect(item.createdBy).toBe('john.doe');
    });

    it('should create a work item with a parent', () => {
      const parent = db.create({ title: 'Parent task' });
      const child = db.create({
        title: 'Child task',
        parentId: parent.id,
      });

      expect(child.parentId).toBe(parent.id);
    });

    it('should generate unique IDs for multiple items', () => {
      const item1 = db.create({ title: 'Task 1' });
      const item2 = db.create({ title: 'Task 2' });
      const item3 = db.create({ title: 'Task 3' });

      expect(item1.id).not.toBe(item2.id);
      expect(item2.id).not.toBe(item3.id);
      expect(item1.id).not.toBe(item3.id);
    });
  });

  describe('get', () => {
    it('should retrieve a work item by ID', () => {
      const created = db.create({ title: 'Test task' });
      const retrieved = db.get(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.title).toBe('Test task');
    });

    it('should return null for non-existent ID', () => {
      const result = db.get('TEST-NONEXISTENT');
      expect(result).toBe(null);
    });
  });

  describe('list', () => {
    beforeEach(() => {
      // Create test data
      db.create({ title: 'Task 1', status: 'open', priority: 'high' });
      db.create({ title: 'Task 2', status: 'in-progress', priority: 'medium' });
      db.create({ title: 'Task 3', status: 'completed', priority: 'low' });
      db.create({ title: 'Task 4', status: 'open', priority: 'high', tags: ['backend'] });
      db.create({ title: 'Task 5', status: 'blocked', priority: 'critical', assignee: 'alice' });
    });

    it('should list all work items when no filters are provided', () => {
      const items = db.list({});
      expect(items).toHaveLength(5);
    });

    it('should filter by status', () => {
      const openItems = db.list({ status: 'open' });
      expect(openItems).toHaveLength(2);
      openItems.forEach(item => expect(item.status).toBe('open'));
    });

    it('should filter by priority', () => {
      const highPriorityItems = db.list({ priority: 'high' });
      expect(highPriorityItems).toHaveLength(2);
      highPriorityItems.forEach(item => expect(item.priority).toBe('high'));
    });

    it('should filter by status and priority', () => {
      const items = db.list({ status: 'open', priority: 'high' });
      expect(items).toHaveLength(2);
      items.forEach(item => {
        expect(item.status).toBe('open');
        expect(item.priority).toBe('high');
      });
    });

    it('should filter by tags', () => {
      const items = db.list({ tags: ['backend'] });
      expect(items).toHaveLength(1);
      expect(items[0].tags).toContain('backend');
    });

    it('should filter by assignee', () => {
      const items = db.list({ assignee: 'alice' });
      expect(items).toHaveLength(1);
      expect(items[0].assignee).toBe('alice');
    });

    it('should filter by parentId null (root items)', () => {
      const items = db.list({ parentId: null });
      expect(items).toHaveLength(5);
    });
  });

  describe('update', () => {
    it('should update a work item title', async () => {
      const item = db.create({ title: 'Original title' });
      // Wait a moment to ensure updatedAt timestamp will be different
      await new Promise(resolve => setTimeout(resolve, 10));
      const updated = db.update(item.id, { title: 'Updated title' });

      expect(updated).toBeDefined();
      expect(updated?.title).toBe('Updated title');
      expect(updated?.id).toBe(item.id);
      expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(item.updatedAt).getTime()
      );
    });

    it('should update multiple fields', () => {
      const item = db.create({ title: 'Task' });
      const updated = db.update(item.id, {
        title: 'Updated task',
        status: 'in-progress',
        priority: 'high',
        description: 'New description',
      });

      expect(updated?.title).toBe('Updated task');
      expect(updated?.status).toBe('in-progress');
      expect(updated?.priority).toBe('high');
      expect(updated?.description).toBe('New description');
    });

    it('should return null for non-existent ID', () => {
      const result = db.update('TEST-NONEXISTENT', { title: 'Updated' });
      expect(result).toBe(null);
    });
  });

  describe('delete', () => {
    it('should delete a work item', () => {
      const item = db.create({ title: 'To delete' });
      const deleted = db.delete(item.id);

      expect(deleted).toBe(true);
      expect(db.get(item.id)).toBe(null);
    });

    it('should return false for non-existent ID', () => {
      const result = db.delete('TEST-NONEXISTENT');
      expect(result).toBe(false);
    });
  });

  describe('getChildren', () => {
    it('should return children of a work item', () => {
      const parent = db.create({ title: 'Parent' });
      const child1 = db.create({ title: 'Child 1', parentId: parent.id });
      const child2 = db.create({ title: 'Child 2', parentId: parent.id });
      db.create({ title: 'Other task' }); // Unrelated task

      const children = db.getChildren(parent.id);
      expect(children).toHaveLength(2);
      expect(children.map(c => c.id)).toContain(child1.id);
      expect(children.map(c => c.id)).toContain(child2.id);
    });

    it('should return empty array for item with no children', () => {
      const item = db.create({ title: 'No children' });
      const children = db.getChildren(item.id);
      expect(children).toEqual([]);
    });
  });

  describe('getDescendants', () => {
    it('should return all descendants including nested children', () => {
      const parent = db.create({ title: 'Parent' });
      const child1 = db.create({ title: 'Child 1', parentId: parent.id });
      const child2 = db.create({ title: 'Child 2', parentId: parent.id });
      const grandchild = db.create({ title: 'Grandchild', parentId: child1.id });

      const descendants = db.getDescendants(parent.id);
      expect(descendants).toHaveLength(3);
      expect(descendants.map(d => d.id)).toContain(child1.id);
      expect(descendants.map(d => d.id)).toContain(child2.id);
      expect(descendants.map(d => d.id)).toContain(grandchild.id);
    });
  });

  describe('comments', () => {
    let workItemId: string;

    beforeEach(() => {
      const item = db.create({ title: 'Task with comments' });
      workItemId = item.id;
    });

    it('should create a comment', () => {
      const comment = db.createComment({
        workItemId,
        author: 'John Doe',
        comment: 'This is a comment',
      });

      expect(comment).toBeDefined();
      expect(comment?.id).toMatch(/^TEST-C[A-Z0-9]+$/);
      expect(comment?.workItemId).toBe(workItemId);
      expect(comment?.author).toBe('John Doe');
      expect(comment?.comment).toBe('This is a comment');
      expect(comment?.references).toEqual([]);
    });

    it('should create a comment with references', () => {
      const comment = db.createComment({
        workItemId,
        author: 'Jane Doe',
        comment: 'Comment with references',
        references: ['TEST-123', 'src/file.ts', 'https://example.com'],
      });

      expect(comment?.references).toEqual(['TEST-123', 'src/file.ts', 'https://example.com']);
    });

    it('should get a comment by ID', () => {
      const created = db.createComment({
        workItemId,
        author: 'John',
        comment: 'Test',
      });
      const retrieved = db.getComment(created!.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created!.id);
    });

    it('should list comments for a work item', () => {
      db.createComment({ workItemId, author: 'A', comment: 'Comment 1' });
      db.createComment({ workItemId, author: 'B', comment: 'Comment 2' });

      const comments = db.getCommentsForWorkItem(workItemId);
      expect(comments).toHaveLength(2);
    });

    it('should update a comment', () => {
      const comment = db.createComment({
        workItemId,
        author: 'John',
        comment: 'Original',
      });
      const updated = db.updateComment(comment!.id, {
        comment: 'Updated comment',
      });

      expect(updated?.comment).toBe('Updated comment');
      expect(updated?.author).toBe('John');
    });

    it('should delete a comment', () => {
      const comment = db.createComment({
        workItemId,
        author: 'John',
        comment: 'To delete',
      });
      const deleted = db.deleteComment(comment!.id);

      expect(deleted).toBe(true);
      expect(db.getComment(comment!.id)).toBe(null);
    });
  });

  describe('import and export', () => {
    it('should import work items', () => {
      const items = [
        {
          id: 'TEST-001',
          title: 'Imported 1',
          description: '',
          status: 'open' as const,
          priority: 'medium' as const,
          parentId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tags: [],
          assignee: '',
          stage: '',
          issueType: '',
          createdBy: '',
          deletedBy: '',
          deleteReason: '',
        },
        {
          id: 'TEST-002',
          title: 'Imported 2',
          description: '',
          status: 'completed' as const,
          priority: 'high' as const,
          parentId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tags: ['test'],
          assignee: 'alice',
          stage: 'done',
          issueType: '',
          createdBy: '',
          deletedBy: '',
          deleteReason: '',
        },
      ];

      db.import(items);
      const allItems = db.getAll();

      expect(allItems).toHaveLength(2);
      expect(allItems.find(i => i.id === 'TEST-001')).toBeDefined();
      expect(allItems.find(i => i.id === 'TEST-002')).toBeDefined();
    });
  });
});
