/**
 * Test utilities and helpers
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Create a temporary directory for test files
 */
export function createTempDir(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-test-'));
  return tmpDir;
}

/**
 * Clean up a temporary directory
 */
export function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Create a temporary JSONL file path in a temp directory
 */
export function createTempJsonlPath(dir: string): string {
  return path.join(dir, 'test-data.jsonl');
}

/**
 * Create a temporary database path in a temp directory
 */
export function createTempDbPath(dir: string): string {
  return path.join(dir, 'test.db');
}

/**
 * Wait for a specified number of milliseconds
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
