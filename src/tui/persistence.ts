import * as fs from 'fs';
import * as path from 'path';

export type FsLike = Pick<typeof fs, 'existsSync' | 'readFileSync' | 'writeFileSync' | 'mkdirSync'>;

export function createPersistence(worklogDir: string, opts?: { fs?: FsLike; debugLog?: (msg: string) => void }) {
  const fsImpl: FsLike = opts?.fs ?? fs;
  const debugLog = opts?.debugLog ?? (() => {});
  const statePath = path.join(worklogDir, 'tui-state.json');

  function loadPersistedState(prefix?: string) {
    try {
      if (!fsImpl.existsSync(statePath)) return null;
      const raw = fsImpl.readFileSync(statePath, 'utf8');
      const j = JSON.parse(raw || '{}');
      const val = j[prefix || 'default'] || null;
      debugLog(`loadPersistedState prefix=${String(prefix || 'default')} path=${statePath} present=${val !== null}`);
      return val;
    } catch (err) {
      debugLog(`loadPersistedState error: ${String(err)}`);
      return null;
    }
  }

  function savePersistedState(prefix: string | undefined, state: any) {
    try {
      if (!fsImpl.existsSync(worklogDir)) fsImpl.mkdirSync(worklogDir, { recursive: true });
      let j: any = {};
      if (fsImpl.existsSync(statePath)) {
        try { j = JSON.parse(fsImpl.readFileSync(statePath, 'utf8') || '{}'); } catch { j = {}; }
      }
      j[prefix || 'default'] = state;
      fsImpl.writeFileSync(statePath, JSON.stringify(j, null, 2), 'utf8');
      try {
        const keys = Object.keys(state || {}).join(',');
        debugLog(`savePersistedState prefix=${String(prefix || 'default')} path=${statePath} keys=[${keys}]`);
      } catch (_) {}
    } catch (err) {
      debugLog(`savePersistedState error: ${String(err)}`);
      // ignore persistence errors but log for debugging
    }
  }

  return { loadPersistedState, savePersistedState, statePath };
}
