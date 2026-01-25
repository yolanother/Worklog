import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  cliPath,
  execAsync,
  execWithInput,
  enterTempDir,
  leaveTempDir,
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

      await execAsync(`tsx ${cliPath} --json create -t "Seed item"`, { cwd: sourceRepo });
      await execAsync(`tsx ${cliPath} sync`, { cwd: sourceRepo });

      await execAsync(`git clone ${remoteRepo} ${cloneRepo}`);
      await execAsync('git config user.email "test@example.com"', { cwd: cloneRepo });
      await execAsync('git config user.name "Test User"', { cwd: cloneRepo });

      writeConfig(cloneRepo, 'Sync Test', 'SYNC');

      const initResult = await execWithInput(`tsx ${cliPath} init`, 'n\n', { cwd: cloneRepo });
      expect(initResult.exitCode).toBe(0);

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
  });

  it('should sync when .worklog points outside repo', async () => {
    const sourceRepo = createTempDir();
    const remoteRepo = createTempDir();
    const cloneRepo = createTempDir();
    const globalWorklogDir = createTempDir();

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

      await execAsync(`tsx ${cliPath} --json create -t "Seed item"`, { cwd: sourceRepo });
      await execAsync(`tsx ${cliPath} sync`, { cwd: sourceRepo });

      await execAsync(`git clone ${remoteRepo} ${cloneRepo}`);
      await execAsync('git config user.email "test@example.com"', { cwd: cloneRepo });
      await execAsync('git config user.name "Test User"', { cwd: cloneRepo });

      fs.mkdirSync(globalWorklogDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalWorklogDir, 'config.yaml'),
        'projectName: Sync Test\nprefix: SYNC\n',
        'utf-8'
      );
      fs.writeFileSync(
        path.join(globalWorklogDir, 'initialized'),
        JSON.stringify({ version: '0.0.1', initializedAt: '2024-01-23T12:00:00.000Z' }),
        'utf-8'
      );

      fs.symlinkSync(globalWorklogDir, path.join(cloneRepo, '.worklog'), 'dir');

      const initResult = await execWithInput(`tsx ${cliPath} init`, 'n\n', { cwd: cloneRepo });
      expect(initResult.exitCode).toBe(0);
      expect(initResult.stderr).toContain(path.join(cloneRepo, '.worklog', 'worklog-data.jsonl'));

      const { stdout } = await execAsync(`tsx ${cliPath} --json list`, { cwd: cloneRepo });
      const listResult = JSON.parse(stdout);
      expect(listResult.success).toBe(true);
      expect(listResult.workItems).toHaveLength(1);
    } finally {
      cleanupTempDir(sourceRepo);
      cleanupTempDir(remoteRepo);
      cleanupTempDir(cloneRepo);
      cleanupTempDir(globalWorklogDir);
    }
  });
});
