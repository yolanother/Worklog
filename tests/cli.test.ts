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
    // Create initialization semaphore
    fs.writeFileSync(
      '.worklog/initialized',
      JSON.stringify({
        version: '1.0.0',
        initializedAt: '2024-01-23T12:00:00.000Z'
      }),
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
        // Create initialization semaphore
        fs.writeFileSync(
          '.worklog/initialized',
          JSON.stringify({
            version: '1.0.0',
            initializedAt: '2024-01-23T12:00:00.000Z'
          }),
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

  describe('status command', () => {
    it('should fail when system is not initialized', async () => {
      // Remove config and semaphore to simulate uninitialized state
      fs.rmSync('.worklog', { recursive: true, force: true });
      
      try {
        await execAsync(`tsx ${cliPath} --json status`);
        throw new Error('Expected status command to fail, but it succeeded');
      } catch (error: any) {
        const result = JSON.parse(error.stdout || '{}');
        expect(result.success).toBe(false);
        expect(result.initialized).toBe(false);
        expect(result.error).toContain('not initialized');
      }
    });

    it('should show status when initialized', async () => {
      // Create semaphore file
      fs.writeFileSync(
        '.worklog/initialized',
        JSON.stringify({
          version: '1.0.0',
          initializedAt: '2024-01-23T12:00:00.000Z'
        }),
        'utf-8'
      );

      const { stdout } = await execAsync(`tsx ${cliPath} --json status`);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.initialized).toBe(true);
      expect(result.version).toBe('1.0.0');
      expect(result.initializedAt).toBe('2024-01-23T12:00:00.000Z');
      expect(result.config).toBeDefined();
      expect(result.config.projectName).toBe('Test Project');
      expect(result.config.prefix).toBe('TEST');
      expect(result.database).toBeDefined();
      expect(result.database.workItems).toBe(0);
      expect(result.database.comments).toBe(0);
    });

    it('should show correct counts in database summary', async () => {
      // Create semaphore file
      fs.writeFileSync(
        '.worklog/initialized',
        JSON.stringify({
          version: '1.0.0',
          initializedAt: '2024-01-23T12:00:00.000Z'
        }),
        'utf-8'
      );

      // Create some work items
      await execAsync(`tsx ${cliPath} create -t "Item 1"`);
      await execAsync(`tsx ${cliPath} create -t "Item 2"`);

      // Get first item ID for comment
      const { stdout: listOutput } = await execAsync(`tsx ${cliPath} --json list`);
      const listResult = JSON.parse(listOutput);
      const firstItemId = listResult.workItems[0].id;

      // Add a comment
      await execAsync(`tsx ${cliPath} comment create ${firstItemId} -a "Test Author" -c "Test comment"`);

      // Check status
      const { stdout } = await execAsync(`tsx ${cliPath} --json status`);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.database.workItems).toBe(2);
      expect(result.database.comments).toBe(1);
    });

    it('should output human-readable format by default', async () => {
      // Create semaphore file
      fs.writeFileSync(
        '.worklog/initialized',
        JSON.stringify({
          version: '1.0.0',
          initializedAt: '2024-01-23T12:00:00.000Z'
        }),
        'utf-8'
      );

      const { stdout } = await execAsync(`tsx ${cliPath} status`);

      expect(stdout).toContain('Worklog System Status');
      expect(stdout).toContain('Initialized: Yes');
      expect(stdout).toContain('Version: 1.0.0');
      expect(stdout).toContain('Configuration:');
      expect(stdout).toContain('Database Summary:');
      expect(stdout).toContain('Work Items:');
      expect(stdout).toContain('Comments:');
    });
  });

  describe('init command', () => {
    beforeEach(() => {
      // Remove default config for init tests
      fs.rmSync('.worklog', { recursive: true, force: true });
    });

    it('should create semaphore when config exists but semaphore does not', async () => {
      // Create config without semaphore
      fs.mkdirSync('.worklog', { recursive: true });
      fs.writeFileSync(
        '.worklog/config.yaml',
        'projectName: Test Project\nprefix: TEST',
        'utf-8'
      );

      const { stdout } = await execAsync(`tsx ${cliPath} --json init`);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true); // Init is now idempotent
      expect(result.message).toContain('already exists');
      expect(result.version).toBe('0.0.1');
      expect(result.initializedAt).toBeDefined();

      // Verify semaphore was created
      expect(fs.existsSync('.worklog/initialized')).toBe(true);
      const semaphore = JSON.parse(fs.readFileSync('.worklog/initialized', 'utf-8'));
      expect(semaphore.version).toBe('0.0.1');
      expect(semaphore.initializedAt).toBeDefined();
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

  describe('verbose flag', () => {
    it('should suppress debug messages by default', async () => {
      // When verbose is not specified, debug messages should be suppressed
      const { stdout, stderr } = await execAsync(
        `tsx ${cliPath} --json create -t "Test task"`
      );

      // Parse the JSON output
      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      
      // Check that the "Refreshing database" message is NOT in stderr or stdout
      const output = stdout + stderr;
      expect(output).not.toContain('Refreshing database from');
    });

    it('should show debug messages when --verbose is specified', async () => {
      // First create a work item to generate JSONL file
      await execAsync(`tsx ${cliPath} --json create -t "Initial task"`);
      
      // Remove the database so refresh will be triggered
      const dbPath = path.join('.worklog', 'worklog.db');
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
      
      // When verbose is specified, debug messages should be shown
      // Note: We use verbose without --json since JSON mode suppresses all debug output
      const { stdout, stderr } = await execAsync(
        `tsx ${cliPath} --verbose create -t "Test task verbose"`
      );

      // Check that the "Refreshing database" or "Loaded" message IS in stderr or stdout
      const output = stdout + stderr;
      const hasDebugMessage = output.includes('Refreshing database from') || output.includes('Loaded');
      expect(hasDebugMessage).toBe(true);
    });
  });

  describe('initialization check', () => {
    beforeEach(() => {
      // Remove worklog directory to simulate uninitialized state
      fs.rmSync('.worklog', { recursive: true, force: true });
    });

    it('should allow init command without initialization', async () => {
      // Init command in JSON mode without interaction will just report that config doesn't exist
      // We're not testing the interactive prompt here, just that init doesn't require prior initialization
      // This test passes if init doesn't exit with error about not being initialized
      try {
        const { stdout, stderr } = await execAsync(`tsx ${cliPath} --json init`, { timeout: 1000 });
        // If we get here, that's fine - init command ran
      } catch (error: any) {
        // Check that the error is NOT about initialization requirement
        const errorOutput = error.stdout || error.stderr || '';
        expect(errorOutput).not.toContain('not initialized');
        // It's OK if it fails for other reasons (like needing interactive input)
      }
    });

    it('should fail create command when not initialized', async () => {
      try {
        await execAsync(`tsx ${cliPath} --json create -t "Test"`);
        throw new Error('Expected create command to fail, but it succeeded');
      } catch (error: any) {
        const result = JSON.parse(error.stdout || '{}');
        expect(result.success).toBe(false);
        expect(result.initialized).toBe(false);
        expect(result.error).toContain('not initialized');
      }
    });

    it('should fail list command when not initialized', async () => {
      try {
        await execAsync(`tsx ${cliPath} --json list`);
        throw new Error('Expected list command to fail, but it succeeded');
      } catch (error: any) {
        const result = JSON.parse(error.stdout || '{}');
        expect(result.success).toBe(false);
        expect(result.initialized).toBe(false);
        expect(result.error).toContain('not initialized');
      }
    });

    it('should fail show command when not initialized', async () => {
      try {
        await execAsync(`tsx ${cliPath} --json show TEST-1`);
        throw new Error('Expected show command to fail, but it succeeded');
      } catch (error: any) {
        const result = JSON.parse(error.stdout || '{}');
        expect(result.success).toBe(false);
        expect(result.initialized).toBe(false);
        expect(result.error).toContain('not initialized');
      }
    });

    it('should fail update command when not initialized', async () => {
      try {
        await execAsync(`tsx ${cliPath} --json update TEST-1 -t "Updated"`);
        throw new Error('Expected update command to fail, but it succeeded');
      } catch (error: any) {
        const result = JSON.parse(error.stdout || '{}');
        expect(result.success).toBe(false);
        expect(result.initialized).toBe(false);
        expect(result.error).toContain('not initialized');
      }
    });

    it('should fail delete command when not initialized', async () => {
      try {
        await execAsync(`tsx ${cliPath} --json delete TEST-1`);
        throw new Error('Expected delete command to fail, but it succeeded');
      } catch (error: any) {
        const result = JSON.parse(error.stdout || '{}');
        expect(result.success).toBe(false);
        expect(result.initialized).toBe(false);
        expect(result.error).toContain('not initialized');
      }
    });

    it('should fail export command when not initialized', async () => {
      try {
        await execAsync(`tsx ${cliPath} --json export -f /tmp/test.jsonl`);
        throw new Error('Expected export command to fail, but it succeeded');
      } catch (error: any) {
        const result = JSON.parse(error.stdout || '{}');
        expect(result.success).toBe(false);
        expect(result.initialized).toBe(false);
        expect(result.error).toContain('not initialized');
      }
    });

    it('should fail import command when not initialized', async () => {
      try {
        await execAsync(`tsx ${cliPath} --json import -f /tmp/test.jsonl`);
        throw new Error('Expected import command to fail, but it succeeded');
      } catch (error: any) {
        const result = JSON.parse(error.stdout || '{}');
        expect(result.success).toBe(false);
        expect(result.initialized).toBe(false);
        expect(result.error).toContain('not initialized');
      }
    });

    it('should fail sync command when not initialized', async () => {
      try {
        await execAsync(`tsx ${cliPath} --json sync --dry-run`);
        throw new Error('Expected sync command to fail, but it succeeded');
      } catch (error: any) {
        const result = JSON.parse(error.stdout || '{}');
        expect(result.success).toBe(false);
        expect(result.initialized).toBe(false);
        expect(result.error).toContain('not initialized');
      }
    });

    it('should fail next command when not initialized', async () => {
      try {
        await execAsync(`tsx ${cliPath} --json next`);
        throw new Error('Expected next command to fail, but it succeeded');
      } catch (error: any) {
        const result = JSON.parse(error.stdout || '{}');
        expect(result.success).toBe(false);
        expect(result.initialized).toBe(false);
        expect(result.error).toContain('not initialized');
      }
    });

    it('should fail comment create command when not initialized', async () => {
      try {
        await execAsync(`tsx ${cliPath} --json comment create TEST-1 -a "Author" -c "Comment"`);
        throw new Error('Expected comment create command to fail, but it succeeded');
      } catch (error: any) {
        const result = JSON.parse(error.stdout || '{}');
        expect(result.success).toBe(false);
        expect(result.initialized).toBe(false);
        expect(result.error).toContain('not initialized');
      }
    });

    it('should fail comment list command when not initialized', async () => {
      try {
        await execAsync(`tsx ${cliPath} --json comment list TEST-1`);
        throw new Error('Expected comment list command to fail, but it succeeded');
      } catch (error: any) {
        const result = JSON.parse(error.stdout || '{}');
        expect(result.success).toBe(false);
        expect(result.initialized).toBe(false);
        expect(result.error).toContain('not initialized');
      }
    });

    it('should fail comment show command when not initialized', async () => {
      try {
        await execAsync(`tsx ${cliPath} --json comment show C-1`);
        throw new Error('Expected comment show command to fail, but it succeeded');
      } catch (error: any) {
        const result = JSON.parse(error.stdout || '{}');
        expect(result.success).toBe(false);
        expect(result.initialized).toBe(false);
        expect(result.error).toContain('not initialized');
      }
    });

    it('should fail comment update command when not initialized', async () => {
      try {
        await execAsync(`tsx ${cliPath} --json comment update C-1 -c "Updated"`);
        throw new Error('Expected comment update command to fail, but it succeeded');
      } catch (error: any) {
        const result = JSON.parse(error.stdout || '{}');
        expect(result.success).toBe(false);
        expect(result.initialized).toBe(false);
        expect(result.error).toContain('not initialized');
      }
    });

    it('should fail comment delete command when not initialized', async () => {
      try {
        await execAsync(`tsx ${cliPath} --json comment delete C-1`);
        throw new Error('Expected comment delete command to fail, but it succeeded');
      } catch (error: any) {
        const result = JSON.parse(error.stdout || '{}');
        expect(result.success).toBe(false);
        expect(result.initialized).toBe(false);
        expect(result.error).toContain('not initialized');
      }
    });
  });

  describe('next command', () => {
    it('should find the next work item when items exist', async () => {
      // Create some work items
      await execAsync(`tsx ${cliPath} create -t "Task 1" -s open -p low`);
      await execAsync(`tsx ${cliPath} create -t "Task 2" -s open -p high`);
      
      const { stdout } = await execAsync(`tsx ${cliPath} --json next`);
      
      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.workItem).toBeDefined();
      expect(result.workItem.title).toBe('Task 2'); // Should select high priority
    });

    it('should return null when no work items exist', async () => {
      const { stdout } = await execAsync(`tsx ${cliPath} --json next`);
      
      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.workItem).toBeNull();
    });

    it('should filter by assignee', async () => {
      await execAsync(`tsx ${cliPath} create -t "John task" -p high -a "john"`);
      await execAsync(`tsx ${cliPath} create -t "Jane task" -p critical -a "jane"`);
      
      const { stdout } = await execAsync(`tsx ${cliPath} --json next -a john`);
      
      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.workItem.title).toBe('John task');
      expect(result.workItem.assignee).toBe('john');
    });

    it('should filter by search term in title', async () => {
      await execAsync(`tsx ${cliPath} create -t "Regular task" -p critical`);
      await execAsync(`tsx ${cliPath} create -t "Bug fix needed" -p low`);
      
      const { stdout } = await execAsync(`tsx ${cliPath} --json next -s bug`);
      
      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.workItem.title).toBe('Bug fix needed');
    });

    it('should filter by search term in description', async () => {
      await execAsync(`tsx ${cliPath} create -t "Task 1" -d "Some work" -p critical`);
      await execAsync(`tsx ${cliPath} create -t "Task 2" -d "Authentication issue" -p low`);
      
      const { stdout } = await execAsync(`tsx ${cliPath} --json next -s authentication`);
      
      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.workItem.title).toBe('Task 2');
    });

    it('should prioritize in-progress items', async () => {
      await execAsync(`tsx ${cliPath} create -t "Open task" -s open -p critical`);
      const { stdout: inProgressStdout } = await execAsync(`tsx ${cliPath} --json create -t "In progress task" -s in-progress -p low`);
      const inProgressResult = JSON.parse(inProgressStdout);
      const inProgressId = inProgressResult.workItem.id;
      
      const { stdout } = await execAsync(`tsx ${cliPath} --json next`);
      
      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      // When there's an in-progress item, it should look at that or its descendants
      // Since in-progress has no children, it should return itself
      expect(result.workItem.id).toBe(inProgressId);
    });

    it('should skip completed items', async () => {
      await execAsync(`tsx ${cliPath} create -t "Completed task" -s completed -p critical`);
      const { stdout: openStdout } = await execAsync(`tsx ${cliPath} --json create -t "Open task" -s open -p low`);
      const openResult = JSON.parse(openStdout);
      
      const { stdout } = await execAsync(`tsx ${cliPath} --json next`);
      
      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.workItem.title).toBe('Open task');
    });

    it('should include a reason in the result', async () => {
      await execAsync(`tsx ${cliPath} create -t "Task 1" -s open -p high`);
      
      const { stdout } = await execAsync(`tsx ${cliPath} --json next`);
      
      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.reason).toBeDefined();
      expect(typeof result.reason).toBe('string');
    });
  });
});
