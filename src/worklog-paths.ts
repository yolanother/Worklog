/**
 * Shared path resolution helpers for Worklog
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

function getRepoRoot(): string | null {
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return root || null;
  } catch {
    return null;
  }
}

export function resolveWorklogDir(): string {
  const cwd = process.cwd();
  const cwdWorklog = path.join(cwd, '.worklog');
  if (fs.existsSync(cwdWorklog)) {
    return cwdWorklog;
  }

  const repoRoot = getRepoRoot();
  if (repoRoot) {
    const repoWorklog = path.join(repoRoot, '.worklog');
    if (fs.existsSync(repoWorklog)) {
      return repoWorklog;
    }
    return repoWorklog;
  }

  return cwdWorklog;
}
