import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  cliPath,
  execAsync,
} from './cli-helpers.js';
import { cleanupTempDir, createTempDir } from '../test-utils.js';

describe('Git Worktree Support', () => {
  it('should place .worklog in main repo when initializing main repository', async () => {
    const tempDir = createTempDir();
    try {
      // Initialize a git repo
      await execAsync('git init', { cwd: tempDir });
      await execAsync('git config user.email "test@example.com"', { cwd: tempDir });
      await execAsync('git config user.name "Test User"', { cwd: tempDir });
      fs.writeFileSync(path.join(tempDir, 'README.md'), 'test repo', 'utf-8');
      await execAsync('git add README.md', { cwd: tempDir });
      await execAsync('git commit -m "init"', { cwd: tempDir });

      // Initialize worklog in the main repo
      await execAsync(
        `tsx ${cliPath} init --project-name "Main Repo" --prefix MAIN --auto-export yes --auto-sync no --workflow-inline no --agents-template skip --stats-plugin-overwrite no`,
        { cwd: tempDir }
      );

      // Check that .worklog was created in the main repo
      expect(fs.existsSync(path.join(tempDir, '.worklog'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.worklog', 'config.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.worklog', 'initialized'))).toBe(true);
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  it('should place .worklog in worktree when initializing a worktree', async () => {
    const tempDir = createTempDir();
    try {
      // Initialize a git repo
      await execAsync('git init', { cwd: tempDir });
      await execAsync('git config user.email "test@example.com"', { cwd: tempDir });
      await execAsync('git config user.name "Test User"', { cwd: tempDir });
      fs.writeFileSync(path.join(tempDir, 'README.md'), 'test repo', 'utf-8');
      await execAsync('git add README.md', { cwd: tempDir });
      await execAsync('git commit -m "init"', { cwd: tempDir });

      // Initialize worklog in the main repo
      await execAsync(
        `tsx ${cliPath} init --project-name "Main Repo" --prefix MAIN --auto-export yes --auto-sync no --workflow-inline no --agents-template skip --stats-plugin-overwrite no`,
        { cwd: tempDir }
      );

      // Create a worktree
      const worktreeDir = path.join(tempDir, 'worktrees', 'test-worktree');
      await execAsync(`git worktree add ${worktreeDir}`, { cwd: tempDir });

      // Initialize worklog in the worktree
      await execAsync(
        `tsx ${cliPath} init --project-name "Test Worktree" --prefix WKT --auto-export yes --auto-sync no --workflow-inline no --agents-template skip --stats-plugin-overwrite no`,
        { cwd: worktreeDir }
      );

      // Check that .worklog was created in the worktree, not the main repo
      expect(fs.existsSync(path.join(worktreeDir, '.worklog'))).toBe(true);
      expect(fs.existsSync(path.join(worktreeDir, '.worklog', 'config.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(worktreeDir, '.worklog', 'initialized'))).toBe(true);

      // Verify configs are different
      const mainConfig = fs.readFileSync(path.join(tempDir, '.worklog', 'config.yaml'), 'utf-8');
      const worktreeConfig = fs.readFileSync(path.join(worktreeDir, '.worklog', 'config.yaml'), 'utf-8');
      
      expect(mainConfig).toContain('MAIN');
      expect(worktreeConfig).toContain('WKT');
      expect(mainConfig).not.toEqual(worktreeConfig);
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  it('should maintain separate state between main repo and worktree', async () => {
    const tempDir = createTempDir();
    try {
      // Initialize a git repo
      await execAsync('git init', { cwd: tempDir });
      await execAsync('git config user.email "test@example.com"', { cwd: tempDir });
      await execAsync('git config user.name "Test User"', { cwd: tempDir });
      fs.writeFileSync(path.join(tempDir, 'README.md'), 'test repo', 'utf-8');
      await execAsync('git add README.md', { cwd: tempDir });
      await execAsync('git commit -m "init"', { cwd: tempDir });

      // Initialize worklog in the main repo
      await execAsync(
        `tsx ${cliPath} init --project-name "Main Repo" --prefix MAIN --auto-export yes --auto-sync no --workflow-inline no --agents-template skip --stats-plugin-overwrite no`,
        { cwd: tempDir }
      );

      // Create a work item in the main repo
      const createMainResult = await execAsync(
        `tsx ${cliPath} --json create --title "Main Repo Item"`,
        { cwd: tempDir }
      );
      const mainItem = JSON.parse(createMainResult.stdout);
      expect(mainItem.success).toBe(true);

      // Create a worktree
      const worktreeDir = path.join(tempDir, 'worktrees', 'test-worktree');
      await execAsync(`git worktree add ${worktreeDir}`, { cwd: tempDir });

      // Initialize worklog in the worktree
      await execAsync(
        `tsx ${cliPath} init --project-name "Test Worktree" --prefix WKT --auto-export yes --auto-sync no --workflow-inline no --agents-template skip --stats-plugin-overwrite no`,
        { cwd: worktreeDir }
      );

      // Create a work item in the worktree
      const createWorktreeResult = await execAsync(
        `tsx ${cliPath} --json create --title "Worktree Item"`,
        { cwd: worktreeDir }
      );
      const worktreeItem = JSON.parse(createWorktreeResult.stdout);
      expect(worktreeItem.success).toBe(true);

      // List items in main repo - should only have the main repo item
      const mainListResult = await execAsync(
        `tsx ${cliPath} --json list`,
        { cwd: tempDir }
      );
      const mainList = JSON.parse(mainListResult.stdout);
      expect(mainList.workItems).toHaveLength(1);
      expect(mainList.workItems[0].title).toBe('Main Repo Item');

      // List items in worktree - should only have the worktree item
      const worktreeListResult = await execAsync(
        `tsx ${cliPath} --json list`,
        { cwd: worktreeDir }
      );
      const worktreeList = JSON.parse(worktreeListResult.stdout);
      expect(worktreeList.workItems).toHaveLength(1);
      expect(worktreeList.workItems[0].title).toBe('Worktree Item');
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  it('should find main repo .worklog when in subdirectory of main repo (not worktree)', async () => {
    const tempDir = createTempDir();
    try {
      // Initialize a git repo
      await execAsync('git init', { cwd: tempDir });
      await execAsync('git config user.email "test@example.com"', { cwd: tempDir });
      await execAsync('git config user.name "Test User"', { cwd: tempDir });
      fs.writeFileSync(path.join(tempDir, 'README.md'), 'test repo', 'utf-8');
      await execAsync('git add README.md', { cwd: tempDir });
      await execAsync('git commit -m "init"', { cwd: tempDir });

      // Initialize worklog in the main repo
      await execAsync(
        `tsx ${cliPath} init --project-name "Main Repo" --prefix MAIN --auto-export yes --auto-sync no --workflow-inline no --agents-template skip --stats-plugin-overwrite no`,
        { cwd: tempDir }
      );

      // Create a subdirectory in the repo
      const subDir = path.join(tempDir, 'src', 'components');
      fs.mkdirSync(subDir, { recursive: true });

      // Create a work item from the subdirectory - should use main repo's .worklog
      const createResult = await execAsync(
        `tsx ${cliPath} --json create --title "Item from subdirectory"`,
        { cwd: subDir }
      );
      const createData = JSON.parse(createResult.stdout);
      expect(createData.success).toBe(true);

      // List items from the subdirectory - should find the item created via subdirectory
      const listResult = await execAsync(
        `tsx ${cliPath} --json list`,
        { cwd: subDir }
      );
      const listData = JSON.parse(listResult.stdout);
      expect(listData.workItems).toHaveLength(1);
      expect(listData.workItems[0].title).toBe('Item from subdirectory');

      // Also verify from main repo
      const mainListResult = await execAsync(
        `tsx ${cliPath} --json list`,
        { cwd: tempDir }
      );
      const mainListData = JSON.parse(mainListResult.stdout);
      expect(mainListData.workItems).toHaveLength(1);
      expect(mainListData.workItems[0].title).toBe('Item from subdirectory');
    } finally {
      cleanupTempDir(tempDir);
    }
  });
});
