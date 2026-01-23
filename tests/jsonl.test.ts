/**
 * Tests for JSONL import/export functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { importFromJsonl, exportToJsonl } from '../src/jsonl.js';
import { WorkItem, Comment } from '../src/types.js';
import { createTempDir, cleanupTempDir } from './test-utils.js';
import * as path from 'path';

describe('JSONL Import/Export', () => {
  let tempDir: string;
  let testFilePath: string;

  beforeEach(() => {
    tempDir = createTempDir();
    testFilePath = path.join(tempDir, 'test.jsonl');
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('exportToJsonl', () => {
    it('should export work items and comments to JSONL format', () => {
      const items: WorkItem[] = [
        {
          id: 'WI-001',
          title: 'Task 1',
          description: 'Description 1',
          status: 'open',
          priority: 'high',
          parentId: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          tags: ['tag1', 'tag2'],
          assignee: 'john',
          stage: 'dev',
        },
        {
          id: 'WI-002',
          title: 'Task 2',
          description: 'Description 2',
          status: 'completed',
          priority: 'low',
          parentId: 'WI-001',
          createdAt: '2024-01-02T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
          tags: [],
          assignee: '',
          stage: '',
        },
      ];

      const comments: Comment[] = [
        {
          id: 'WI-C001',
          workItemId: 'WI-001',
          author: 'Alice',
          comment: 'Test comment',
          createdAt: '2024-01-01T01:00:00.000Z',
          references: ['WI-002'],
        },
      ];

      exportToJsonl(items, comments, testFilePath);

      expect(fs.existsSync(testFilePath)).toBe(true);
      const content = fs.readFileSync(testFilePath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(3);
      
      // Check first work item
      const line1 = JSON.parse(lines[0]);
      expect(line1.type).toBe('workitem');
      expect(line1.data.id).toBe('WI-001');

      // Check second work item
      const line2 = JSON.parse(lines[1]);
      expect(line2.type).toBe('workitem');
      expect(line2.data.id).toBe('WI-002');

      // Check comment
      const line3 = JSON.parse(lines[2]);
      expect(line3.type).toBe('comment');
      expect(line3.data.id).toBe('WI-C001');
    });

    it('should create directory if it does not exist', () => {
      const nestedPath = path.join(tempDir, 'nested', 'dir', 'file.jsonl');
      const items: WorkItem[] = [];
      const comments: Comment[] = [];

      exportToJsonl(items, comments, nestedPath);

      expect(fs.existsSync(nestedPath)).toBe(true);
    });

    it('should export empty arrays as empty file with newline', () => {
      exportToJsonl([], [], testFilePath);

      expect(fs.existsSync(testFilePath)).toBe(true);
      const content = fs.readFileSync(testFilePath, 'utf-8');
      expect(content).toBe('\n');
    });
  });

  describe('importFromJsonl', () => {
    it('should import work items and comments from JSONL format', () => {
      const content = [
        JSON.stringify({ type: 'workitem', data: {
          id: 'WI-001',
          title: 'Task 1',
          description: 'Desc',
          status: 'open',
          priority: 'high',
          parentId: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          tags: ['test'],
          assignee: 'john',
          stage: 'dev',
        }}),
        JSON.stringify({ type: 'comment', data: {
          id: 'WI-C001',
          workItemId: 'WI-001',
          author: 'Alice',
          comment: 'Test',
          createdAt: '2024-01-01T01:00:00.000Z',
          references: [],
        }}),
      ].join('\n') + '\n';

      fs.writeFileSync(testFilePath, content, 'utf-8');

      const result = importFromJsonl(testFilePath);

      expect(result.items).toHaveLength(1);
      expect(result.comments).toHaveLength(1);
      expect(result.items[0].id).toBe('WI-001');
      expect(result.comments[0].id).toBe('WI-C001');
    });

    it('should handle old format (work items without type field)', () => {
      const content = [
        JSON.stringify({
          id: 'WI-001',
          title: 'Old format task',
          description: '',
          status: 'open',
          priority: 'medium',
          parentId: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          tags: [],
        }),
      ].join('\n') + '\n';

      fs.writeFileSync(testFilePath, content, 'utf-8');

      const result = importFromJsonl(testFilePath);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('WI-001');
      expect(result.items[0].assignee).toBe('');
      expect(result.items[0].stage).toBe('');
    });

    it('should handle missing assignee and stage fields', () => {
      const content = [
        JSON.stringify({ type: 'workitem', data: {
          id: 'WI-001',
          title: 'Task',
          description: '',
          status: 'open',
          priority: 'medium',
          parentId: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          tags: [],
        }}),
      ].join('\n') + '\n';

      fs.writeFileSync(testFilePath, content, 'utf-8');

      const result = importFromJsonl(testFilePath);

      expect(result.items[0].assignee).toBe('');
      expect(result.items[0].stage).toBe('');
    });

    it('should throw error for non-existent file', () => {
      expect(() => importFromJsonl('non-existent.jsonl')).toThrow('File not found');
    });

    it('should skip empty lines', () => {
      const content = [
        JSON.stringify({ type: 'workitem', data: {
          id: 'WI-001',
          title: 'Task',
          description: '',
          status: 'open',
          priority: 'medium',
          parentId: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          tags: [],
          assignee: '',
          stage: '',
        }}),
        '',
        '   ',
        JSON.stringify({ type: 'workitem', data: {
          id: 'WI-002',
          title: 'Task 2',
          description: '',
          status: 'open',
          priority: 'medium',
          parentId: null,
          createdAt: '2024-01-02T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
          tags: [],
          assignee: '',
          stage: '',
        }}),
      ].join('\n') + '\n';

      fs.writeFileSync(testFilePath, content, 'utf-8');

      const result = importFromJsonl(testFilePath);

      expect(result.items).toHaveLength(2);
    });
  });

  describe('round-trip', () => {
    it('should preserve data through export and import cycle', () => {
      const originalItems: WorkItem[] = [
        {
          id: 'WI-001',
          title: 'Task 1',
          description: 'Description with special chars: "quotes" and \'apostrophes\'',
          status: 'in-progress',
          priority: 'critical',
          parentId: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T12:30:45.123Z',
          tags: ['feature', 'urgent', 'backend'],
          assignee: 'john.doe@example.com',
          stage: 'development',
        },
        {
          id: 'WI-002',
          title: 'Task 2',
          description: '',
          status: 'open',
          priority: 'low',
          parentId: 'WI-001',
          createdAt: '2024-01-02T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
          tags: [],
          assignee: '',
          stage: '',
        },
      ];

      const originalComments: Comment[] = [
        {
          id: 'WI-C001',
          workItemId: 'WI-001',
          author: 'Alice Smith',
          comment: 'Comment with **markdown** and [links](https://example.com)',
          createdAt: '2024-01-01T06:00:00.000Z',
          references: ['WI-002', 'src/file.ts', 'https://docs.example.com'],
        },
      ];

      // Export
      exportToJsonl(originalItems, originalComments, testFilePath);

      // Import
      const { items, comments } = importFromJsonl(testFilePath);

      // Verify items
      expect(items).toHaveLength(originalItems.length);
      expect(items[0]).toEqual(originalItems[0]);
      expect(items[1]).toEqual(originalItems[1]);

      // Verify comments
      expect(comments).toHaveLength(originalComments.length);
      expect(comments[0]).toEqual(originalComments[0]);
    });
  });
});
