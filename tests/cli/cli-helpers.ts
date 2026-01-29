import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { cleanupTempDir, createTempDir } from '../test-utils.js';
import { exportToJsonl } from '../../src/jsonl.js';
import type { WorkItem, Comment, WorkItemPriority, WorkItemStatus } from '../../src/types.js';

export const execAsync = promisify(childProcess.exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

export const cliPath = path.join(projectRoot, 'src', 'cli.ts');

export async function execWithInput(
  command: string,
  input: string,
  options?: childProcess.ExecOptions
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return await new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, {
      shell: true,
      cwd: options?.cwd,
      env: options?.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

export function enterTempDir(): { tempDir: string; originalCwd: string } {
  const tempDir = createTempDir();
  const originalCwd = process.cwd();
  process.chdir(tempDir);
  return { tempDir, originalCwd };
}

export function leaveTempDir(state: { tempDir: string; originalCwd: string }): void {
  process.chdir(state.originalCwd);
  cleanupTempDir(state.tempDir);
}

export function writeConfig(dir: string, projectName: string = 'Test Project', prefix: string = 'TEST'): void {
  fs.mkdirSync(path.join(dir, '.worklog'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.worklog', 'config.yaml'),
    `projectName: ${projectName}\nprefix: ${prefix}`,
    'utf-8'
  );
}

export function writeInitSemaphore(
  dir: string,
  version: string = '1.0.0',
  initializedAt: string = '2024-01-23T12:00:00.000Z'
): void {
  fs.mkdirSync(path.join(dir, '.worklog'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.worklog', 'initialized'),
    JSON.stringify({ version, initializedAt }),
    'utf-8'
  );
}

export function seedWorkItems(
  dir: string,
  items: Array<{
    id?: string;
    title: string;
    description?: string;
    status?: WorkItemStatus;
    priority?: WorkItemPriority;
    parentId?: string | null;
    tags?: string[];
    assignee?: string;
    stage?: string;
  }>,
  comments: Comment[] = []
): WorkItem[] {
  const now = new Date().toISOString();
  const seeded = items.map((item, index) => ({
    id: item.id ?? `TEST-${index + 1}`,
    title: item.title,
    description: item.description ?? '',
    status: item.status ?? 'open',
    priority: item.priority ?? 'medium',
    parentId: item.parentId ?? null,
    createdAt: now,
    updatedAt: now,
    tags: item.tags ?? [],
    assignee: item.assignee ?? '',
    stage: item.stage ?? '',
    issueType: '',
    createdBy: '',
    deletedBy: '',
    deleteReason: '',
    risk: '',
    effort: '',
  }));

  const dataPath = path.join(dir, '.worklog', 'worklog-data.jsonl');
  exportToJsonl(seeded, comments, dataPath);
  return seeded;
}
