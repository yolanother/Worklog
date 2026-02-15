import { Command } from 'commander';
import { createPluginContext } from '../../src/cli-utils.js';
import * as path from 'path';

// Import built-in commands (same set as src/cli.ts)
import initCommand from '../../src/commands/init.js';
import statusCommand from '../../src/commands/status.js';
import createCommand from '../../src/commands/create.js';
import listCommand from '../../src/commands/list.js';
import showCommand from '../../src/commands/show.js';
import updateCommand from '../../src/commands/update.js';
import deleteCommand from '../../src/commands/delete.js';
import exportCommand from '../../src/commands/export.js';
import importCommand from '../../src/commands/import.js';
import nextCommand from '../../src/commands/next.js';
import inProgressCommand from '../../src/commands/in-progress.js';
import syncCommand from '../../src/commands/sync.js';
import githubCommand from '../../src/commands/github.js';
import commentCommand from '../../src/commands/comment.js';
import closeCommand from '../../src/commands/close.js';
import recentCommand from '../../src/commands/recent.js';
import pluginsCommand from '../../src/commands/plugins.js';
import tuiCommand from '../../src/commands/tui.js';
import migrateCommand from '../../src/commands/migrate.js';
import depCommand from '../../src/commands/dep.js';
import reSortCommand from '../../src/commands/re-sort.js';
import doctorCommand from '../../src/commands/doctor.js';

const builtInCommands = [
  initCommand,
  statusCommand,
  createCommand,
  listCommand,
  showCommand,
  updateCommand,
  deleteCommand,
  exportCommand,
  importCommand,
  nextCommand,
  inProgressCommand,
  syncCommand,
  githubCommand,
  commentCommand,
  closeCommand,
  recentCommand,
  pluginsCommand,
  tuiCommand,
  migrateCommand,
  depCommand,
  reSortCommand,
  doctorCommand,
];

function splitShellArgs(cmd: string): string[] {
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  const res: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd)) !== null) {
    if (m[1] !== undefined) res.push(m[1]);
    else if (m[2] !== undefined) res.push(m[2]);
    else if (m[3] !== undefined) res.push(m[3]);
  }
  return res;
}

export async function runInProcess(commandLine: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  // Extract args after the CLI path
  const tokens = splitShellArgs(commandLine);
  // find index of the script path (ends with src/cli.ts)
  const cliIndex = tokens.findIndex(t => t.endsWith(path.join('src', 'cli.ts')) || t.endsWith(path.join('dist', 'cli.js')));
  const args = cliIndex >= 0 ? tokens.slice(cliIndex + 1) : tokens;

  // Capture stdout/stderr
  const out: string[] = [];
  const err: string[] = [];
  const origStdoutWrite = process.stdout.write;
  const origStderrWrite = process.stderr.write;
  const origExit = process.exit;
  process.stdout.write = ((chunk: any, _enc?: any, cb?: any) => { out.push(String(chunk)); if (cb) cb(); return true; }) as any;
  process.stderr.write = ((chunk: any, _enc?: any, cb?: any) => { err.push(String(chunk)); if (cb) cb(); return true; }) as any;
  process.exit = ((code?: number) => { throw new Error(`__INPROC_EXIT__:${code ?? 0}`); }) as any;

  try {
    const program = new Command();
    const ctx = createPluginContext(program);
    // Register built-in commands
    for (const r of builtInCommands) r(ctx);

    // Run command
    try {
      program.parse(['node', 'worklog', ...args], { from: 'user' });
      return { stdout: out.join(''), stderr: err.join(''), exitCode: 0 };
    } catch (e: any) {
      if (e && typeof e.message === 'string' && e.message.startsWith('__INPROC_EXIT__')) {
        const code = Number(e.message.split(':')[1]) || 0;
        return { stdout: out.join(''), stderr: err.join(''), exitCode: code };
      }
      throw e;
    }
  } finally {
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;
    process.exit = origExit;
  }
}
