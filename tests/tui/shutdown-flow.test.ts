import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

describe('TUI shutdown flow', () => {
  it('uses shared shutdown helper and avoids direct process.exit', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const rootDir = path.resolve(testDir, '../..');
    const tuiPath = path.join(rootDir, 'src/commands/tui.ts');
    const source = readFileSync(tuiPath, 'utf8');

    expect(source).toContain('const shutdown = () =>');
    expect(source).not.toMatch(/process\.exit/);

    const shutdownCalls = source.match(/shutdown\(\);/g) || [];
    expect(shutdownCalls.length).toBeGreaterThanOrEqual(2);
  });
});
