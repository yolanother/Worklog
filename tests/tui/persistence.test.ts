import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPersistence } from '../../src/tui/persistence.js';
import * as path from 'path';

describe('tui persistence', () => {
  const worklogDir = path.join('/tmp', 'worklog-test');
  let fsMock: any;

  beforeEach(() => {
    fsMock = {
      existsSync: vi.fn().mockReturnValue(false),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    };
  });

  it('returns null when file missing', () => {
    const p = createPersistence(worklogDir, { fs: fsMock });
    const v = p.loadPersistedState('prefix');
    expect(v).toBeNull();
  });

  it('loads JSON when present', () => {
    fsMock.existsSync = vi.fn().mockImplementation((p: string) => true);
    fsMock.readFileSync = vi.fn().mockReturnValue('{"default": {"expanded": ["a"]}}');
    const p = createPersistence(worklogDir, { fs: fsMock });
    const v = p.loadPersistedState(undefined);
    expect(v).toEqual({ expanded: ['a'] });
  });

  it('saves state and creates dir when needed', () => {
    fsMock.existsSync = vi.fn().mockImplementation((p: string) => false);
    const p = createPersistence(worklogDir, { fs: fsMock });
    p.savePersistedState('prefix', { expanded: ['x'] });
    expect(fsMock.mkdirSync).toHaveBeenCalled();
    expect(fsMock.writeFileSync).toHaveBeenCalled();
  });

  it('handles corrupt json gracefully', () => {
    fsMock.existsSync = vi.fn().mockImplementation((p: string) => true);
    fsMock.readFileSync = vi.fn().mockReturnValue('not-json');
    const p = createPersistence(worklogDir, { fs: fsMock });
    const v = p.loadPersistedState(undefined);
    expect(v).toBeNull();
  });
});
