/**
 * Integration tests for CLI commands
 * These tests run actual CLI commands using child_process
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { createTempDir, cleanupTempDir } from './test-utils.js';
import { fileURLToPath } from 'url';

const execAsync = promisify(childProcess.exec);

// Get the project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const cliPath = path.join(projectRoot, 'src', 'cli.ts');

describe('CLI Integration Tests', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = createTempDir();
    originalCwd = process.cwd();
    process.chdir(tempDir);
    
    // Create a basic config to avoid init prompts
    fs.mkdirSync('.worklog', { recursive: true });
    fs.writeFileSync(
      '.worklog/config.yaml',
      'projectName: Test Project\nprefix: TEST',
      'utf-8'
    );
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupTempDir(tempDir);
  });

  describe('create command', () => {
    it('should create a work item with required fields', async () => {
      const { stdout } = await execAsync(`tsx ${cliPath} --json create -t "Test task"`);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.workItem).toBeDefined();
      expect(result.workItem.id).toMatch(/^TEST-/);
      expect(result.workItem.title).toBe('Test task');
      expect(result.workItem.status).toBe('open');
      expect(result.workItem.priority).toBe('medium');
    });

    it('should create a work item with all optional fields', async () => {
      const { stdout } = await execAsync(
        `tsx ${cliPath} --json create -t "Full task" -d "Description" -s in-progress -p high --tags "tag1,tag2" -a "john" --stage "dev"`
      );

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.workItem.title).toBe('Full task');
      expect(result.workItem.description).toBe('Description');
      expect(result.workItem.status).toBe('in-progress');
      expect(result.workItem.priority).toBe('high');
      expect(result.workItem.tags).toEqual(['tag1', 'tag2']);
      expect(result.workItem.assignee).toBe('john');
      expect(result.workItem.stage).toBe('dev');
    });
  });

  describe('list command', () => {
    beforeEach(async () => {
      // Create some test items
      await execAsync(`tsx ${cliPath} create -t "Task 1" -s open -p high`);
      await execAsync(`tsx ${cliPath} create -t "Task 2" -s in-progress -p medium`);
      await execAsync(`tsx ${cliPath} create -t "Task 3" -s completed -p low`);
    });

    it('should list all work items', async () => {
      const { stdout } = await execAsync(`tsx ${cliPath} --json list`);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.workItems).toHaveLength(3);
    });

    it('should filter by status', async () => {
      const { stdout } = await execAsync(`tsx ${cliPath} --json list -s open`);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.workItems).toHaveLength(1);
      expect(result.workItems[0].status).toBe('open');
    });

    it('should filter by priority', async () => {
      const { stdout } = await execAsync(`tsx ${cliPath} --json list -p high`);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.workItems).toHaveLength(1);
      expect(result.workItems[0].priority).toBe('high');
    });

    it('should filter by multiple criteria', async () => {
      const { stdout } = await execAsync(`tsx ${cliPath} --json list -s open -p high`);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.workItems).toHaveLength(1);
      expect(result.workItems[0].status).toBe('open');
      expect(result.workItems[0].priority).toBe('high');
    });
  });

  describe('show command', () => {
    let workItemId: string;

    beforeEach(async () => {
      const { stdout } = await execAsync(`tsx ${cliPath} --json create -t "Test task"`);
      const result = JSON.parse(stdout);
      workItemId = result.workItem.id;
    });

    it('should show a work item by ID', async () => {
      const { stdout } = await execAsync(`tsx ${cliPath} --json show ${workItemId}`);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.workItem.id).toBe(workItemId);
      expect(result.workItem.title).toBe('Test task');
    });

    it('should show children when -c flag is used', async () => {
      // Create a child
      await execAsync(`tsx ${cliPath} create -t "Child task" -P ${workItemId}`);

      const { stdout } = await execAsync(`tsx ${cliPath} --json show ${workItemId} -c`);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.children).toBeDefined();
      expect(result.children).toHaveLength(1);
      expect(result.children[0].title).toBe('Child task');
    });

    it('should return error for non-existent ID', async () => {
      try {
        await execAsync(`tsx ${cliPath} --json show TEST-NONEXISTENT`);
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        // Error output goes to stderr in JSON mode
        const result = JSON.parse(error.stderr || '{}');
        expect(result.success).toBe(false);
      }
    });
  });

  describe('update command', () => {
    let workItemId: string;

    beforeEach(async () => {
      const { stdout } = await execAsync(`tsx ${cliPath} --json create -t "Original title"`);
      const result = JSON.parse(stdout);
      workItemId = result.workItem.id;
    });

    it('should update a work item title', async () => {
      const { stdout } = await execAsync(
        `tsx ${cliPath} --json update ${workItemId} -t "Updated title"`
      );

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.workItem.title).toBe('Updated title');
    });

    it('should update multiple fields', async () => {
      const { stdout } = await execAsync(
        `tsx ${cliPath} --json update ${workItemId} -t "Updated" -s completed -p high`
      );

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.workItem.title).toBe('Updated');
      expect(result.workItem.status).toBe('completed');
      expect(result.workItem.priority).toBe('high');
    });
  });

  describe('delete command', () => {
    it('should delete a work item', async () => {
      const createResult = await execAsync(`tsx ${cliPath} --json create -t "To delete"`);
      const created = JSON.parse(createResult.stdout);
      const workItemId = created.workItem.id;

      const { stdout } = await execAsync(
        `tsx ${cliPath} --json delete ${workItemId}`
      );

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.deletedId).toBe(workItemId);

      // Verify it's deleted
      try {
        await execAsync(`tsx ${cliPath} --json show ${workItemId}`);
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        // Error output goes to stderr in JSON mode
        const result = JSON.parse(error.stderr || '{}');
        expect(result.success).toBe(false);
      }
    });
  });

  describe('comment commands', () => {
    let workItemId: string;

    beforeEach(async () => {
      const { stdout } = await execAsync(`tsx ${cliPath} --json create -t "Task with comments"`);
      const result = JSON.parse(stdout);
      workItemId = result.workItem.id;
    });

    it('should create a comment', async () => {
      const { stdout } = await execAsync(
        `tsx ${cliPath} --json comment create ${workItemId} -a "John" -c "Test comment"`
      );

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.comment.workItemId).toBe(workItemId);
      expect(result.comment.author).toBe('John');
      expect(result.comment.comment).toBe('Test comment');
    });

    it('should list comments for a work item', async () => {
      // Create a comment first
      await execAsync(
        `tsx ${cliPath} comment create ${workItemId} -a "Alice" -c "Comment 1"`
      );
      await execAsync(
        `tsx ${cliPath} comment create ${workItemId} -a "Bob" -c "Comment 2"`
      );

      const { stdout } = await execAsync(
        `tsx ${cliPath} --json comment list ${workItemId}`
      );

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.comments).toHaveLength(2);
    });

    it('should show a specific comment', async () => {
      const createResult = await execAsync(
        `tsx ${cliPath} --json comment create ${workItemId} -a "Alice" -c "Test"`
      );
      const created = JSON.parse(createResult.stdout);
      const commentId = created.comment.id;

      const { stdout } = await execAsync(
        `tsx ${cliPath} --json comment show ${commentId}`
      );

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.comment.id).toBe(commentId);
    });

    it('should update a comment', async () => {
      const createResult = await execAsync(
        `tsx ${cliPath} --json comment create ${workItemId} -a "Alice" -c "Original"`
      );
      const created = JSON.parse(createResult.stdout);
      const commentId = created.comment.id;

      const { stdout } = await execAsync(
        `tsx ${cliPath} --json comment update ${commentId} -c "Updated comment"`
      );

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.comment.comment).toBe('Updated comment');
    });

    it('should delete a comment', async () => {
      const createResult = await execAsync(
        `tsx ${cliPath} --json comment create ${workItemId} -a "Alice" -c "To delete"`
      );
      const created = JSON.parse(createResult.stdout);
      const commentId = created.comment.id;

      const { stdout } = await execAsync(
        `tsx ${cliPath} --json comment delete ${commentId}`
      );

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.deletedId).toBe(commentId);
    });
  });

  describe('export and import commands', () => {
    beforeEach(async () => {
      // Create some test data
      await execAsync(`tsx ${cliPath} create -t "Task 1"`);
      await execAsync(`tsx ${cliPath} create -t "Task 2"`);
    });

    it('should export data to a file', async () => {
      const exportPath = path.join(tempDir, 'export-test.jsonl');
      const { stdout } = await execAsync(
        `tsx ${cliPath} --json export -f ${exportPath}`
      );

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.itemsCount).toBe(2);
      expect(fs.existsSync(exportPath)).toBe(true);
    });

    it('should import data from a file', async () => {
      const exportPath = path.join(tempDir, 'export-test.jsonl');
      
      // Export first
      await execAsync(`tsx ${cliPath} export -f ${exportPath}`);

      // Create a new temp dir for import test
      const importTempDir = createTempDir();
      const importOriginalCwd = process.cwd();
      process.chdir(importTempDir);

      try {
        // Create config in new directory
        fs.mkdirSync('.worklog', { recursive: true });
        fs.writeFileSync(
          '.worklog/config.yaml',
          'projectName: Test\nprefix: TEST',
          'utf-8'
        );

        // Import
        const { stdout } = await execAsync(
          `tsx ${cliPath} --json import -f ${exportPath}`
        );

        const result = JSON.parse(stdout);
        expect(result.success).toBe(true);
        expect(result.itemsCount).toBe(2);
      } finally {
        process.chdir(importOriginalCwd);
        cleanupTempDir(importTempDir);
      }
    });
  });

  describe('prefix override', () => {
    it('should use custom prefix when --prefix is specified', async () => {
      const { stdout } = await execAsync(
        `tsx ${cliPath} --json create -t "Custom prefix task" --prefix CUSTOM`
      );

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.workItem.id).toMatch(/^CUSTOM-/);
    });
  });
});
