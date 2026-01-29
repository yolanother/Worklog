import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  cliPath,
  execAsync,
  enterTempDir,
  leaveTempDir,
  seedWorkItems,
  writeConfig,
  writeInitSemaphore
} from './cli-helpers.js';
import { cleanupTempDir, createTempDir } from '../test-utils.js';

describe('CLI Init Tests', () => {
  it('should create semaphore when config exists but semaphore does not', async () => {
    const tempState = enterTempDir();
    try {
      fs.mkdirSync('.worklog', { recursive: true });
      fs.writeFileSync(
        '.worklog/config.yaml',
        'projectName: Test Project\nprefix: TEST',
        'utf-8'
      );

      const { stdout } = await execAsync(`tsx ${cliPath} --json init`);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.message).toContain('already exists');
      expect(result.version).toBe('0.0.1');
      expect(result.initializedAt).toBeDefined();

      expect(fs.existsSync('.worklog/initialized')).toBe(true);
      const semaphore = JSON.parse(fs.readFileSync('.worklog/initialized', 'utf-8'));
      expect(semaphore.version).toBe('0.0.1');
      expect(semaphore.initializedAt).toBeDefined();
    } finally {
      leaveTempDir(tempState);
    }
  });

  it('should allow init command without initialization', async () => {
    const tempState = enterTempDir();
    try {
      fs.rmSync('.worklog', { recursive: true, force: true });
      try {
        await execAsync(`tsx ${cliPath} --json init`, { timeout: 1000 });
      } catch (error: any) {
        const errorOutput = error.stdout || error.stderr || '';
        expect(errorOutput).not.toContain('not initialized');
      }
    } finally {
      leaveTempDir(tempState);
    }
  });

  it('should sync remote work items on init in new checkout', async () => {
    const sourceRepo = createTempDir();
    const remoteRepo = createTempDir();
    const cloneRepo = createTempDir();

    try {
      await execAsync('git init', { cwd: sourceRepo });
      await execAsync('git config user.email "test@example.com"', { cwd: sourceRepo });
      await execAsync('git config user.name "Test User"', { cwd: sourceRepo });
      fs.writeFileSync(path.join(sourceRepo, 'README.md'), 'seed repo', 'utf-8');
      await execAsync('git add README.md', { cwd: sourceRepo });
      await execAsync('git commit -m "init"', { cwd: sourceRepo });

      await execAsync('git init --bare', { cwd: remoteRepo });
      await execAsync(`git remote add origin ${remoteRepo}`, { cwd: sourceRepo });
      await execAsync('git push -u origin HEAD', { cwd: sourceRepo });

      writeConfig(sourceRepo, 'Sync Test', 'SYNC');
      writeInitSemaphore(sourceRepo, '0.0.1');

      seedWorkItems(sourceRepo, [
        { title: 'Seed item' },
      ]);
      await execAsync(`tsx ${cliPath} sync`, { cwd: sourceRepo });

      await execAsync(`git clone ${remoteRepo} ${cloneRepo}`);
      await execAsync('git config user.email "test@example.com"', { cwd: cloneRepo });
      await execAsync('git config user.name "Test User"', { cwd: cloneRepo });

      writeConfig(cloneRepo, 'Sync Test', 'SYNC');

      await execAsync(
        `tsx ${cliPath} init --project-name "Sync Test" --prefix SYNC --auto-export yes --auto-sync no --workflow-inline no --agents-template skip --stats-plugin-overwrite no`,
        { cwd: cloneRepo }
      );

      const { stdout } = await execAsync(`tsx ${cliPath} --json list`, { cwd: cloneRepo });
      const listResult = JSON.parse(stdout);
      expect(listResult.success).toBe(true);
      expect(listResult.workItems).toHaveLength(1);
      expect(listResult.workItems[0].title).toBe('Seed item');
    } finally {
      cleanupTempDir(sourceRepo);
      cleanupTempDir(remoteRepo);
      cleanupTempDir(cloneRepo);
    }
  }, 60000);

  // Removed: outside-repo .worklog simulation (not part of the target scenario).
});
