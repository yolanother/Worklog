import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { cleanupTempDir, createTempDir } from '../test-utils.js';

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
