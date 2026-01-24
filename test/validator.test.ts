import { execaSync } from 'execa';
import { describe, it, expect } from 'vitest';
import * as path from 'path';

const cli = path.resolve(__dirname, '..', 'dist', 'cli.js');

describe('CLI documentation validator', () => {
  it('validator script exits zero and prints OK', () => {
    const res = execaSync(process.execPath, [path.resolve(__dirname, '..', 'scripts', 'validate-cli-md.cjs')], { encoding: 'utf-8' });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('OK: All help commands present in CLI.md');
  });
});
