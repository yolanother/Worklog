import { execaSync } from 'execa';
import { describe, it, expect } from 'vitest';
import * as path from 'path';

const cli = path.resolve(__dirname, '..', 'dist', 'cli.js');

describe('CLI help', () => {
  it('prints grouped help without throwing', () => {
    const result = execaSync(process.execPath, [cli, '--help'], { encoding: 'utf-8' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('Project:');
    expect(result.stdout).toContain('Work items:');
  });
});
