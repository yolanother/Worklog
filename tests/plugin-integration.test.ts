/**
 * Integration tests for external plugin loading
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { createTempDir, cleanupTempDir } from './test-utils.js';
import { fileURLToPath } from 'url';

const execAsync = promisify(childProcess.exec);

// Get the project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const cliPath = path.join(projectRoot, 'dist', 'cli.js');

describe('Plugin Integration Tests', () => {
  let tempDir: string;
  let pluginDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = createTempDir();
    pluginDir = path.join(tempDir, '.worklog', 'plugins');
    fs.mkdirSync(pluginDir, { recursive: true });
    
    originalCwd = process.cwd();
    process.chdir(tempDir);
    
    // Create a basic config
    fs.writeFileSync(
      path.join(tempDir, '.worklog', 'config.yaml'),
      [
        'projectName: Test Project',
        'prefix: TEST',
        'statuses:',
        '  - value: open',
        '    label: Open',
        '  - value: in-progress',
        '    label: In Progress',
        '  - value: blocked',
        '    label: Blocked',
        '  - value: completed',
        '    label: Completed',
        '  - value: deleted',
        '    label: Deleted',
        'stages:',
        '  - value: ""',
        '    label: Undefined',
        '  - value: idea',
        '    label: Idea',
        '  - value: prd_complete',
        '    label: PRD Complete',
        '  - value: plan_complete',
        '    label: Plan Complete',
        '  - value: in_progress',
        '    label: In Progress',
        '  - value: in_review',
        '    label: In Review',
        '  - value: done',
        '    label: Done',
        'statusStageCompatibility:',
        '  open: ["", idea, prd_complete, plan_complete, in_progress]',
        '  in-progress: [in_progress]',
        '  blocked: ["", idea, prd_complete, plan_complete, in_progress]',
        '  completed: [in_review, done]',
        '  deleted: [""]'
      ].join('\n'),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(tempDir, '.worklog', 'initialized'),
      JSON.stringify({
        version: '1.0.0',
        initializedAt: '2024-01-23T12:00:00.000Z'
      }),
      'utf-8'
    );
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupTempDir(tempDir);
  });

  it('should load and execute a simple external plugin', async () => {
    // Create a simple plugin that adds a "hello" command
    const pluginContent = `
export default function register(ctx) {
  ctx.program
    .command('hello')
    .description('Say hello')
    .option('-n, --name <name>', 'Name to greet', 'World')
    .action((options) => {
      if (ctx.utils.isJsonMode()) {
        ctx.output.json({ success: true, message: \`Hello, \${options.name}!\` });
      } else {
        console.log(\`Hello, \${options.name}!\`);
      }
    });
}
`;
    
    fs.writeFileSync(path.join(pluginDir, 'hello.mjs'), pluginContent);
    
    // Verify the plugin command appears in help
    const { stdout: helpOutput } = await execAsync(`node ${cliPath} --help`);
    expect(helpOutput).toContain('hello');
    expect(helpOutput).toContain('Say hello');
    
    // Test the plugin command
    const { stdout } = await execAsync(`node ${cliPath} hello --json`);
    const result = JSON.parse(stdout);
    expect(result.success).toBe(true);
    expect(result.message).toBe('Hello, World!');
    
    // Test with custom name
    const { stdout: stdout2 } = await execAsync(`node ${cliPath} hello --json --name Copilot`);
    const result2 = JSON.parse(stdout2);
    expect(result2.success).toBe(true);
    expect(result2.message).toBe('Hello, Copilot!');
  });

  it('should load multiple plugins in lexicographic order', async () => {
    // Create multiple plugins
    const plugin1 = `
export default function register(ctx) {
  ctx.program.command('cmd-alpha').description('Alpha command');
}
`;
    
    const plugin2 = `
export default function register(ctx) {
  ctx.program.command('cmd-beta').description('Beta command');
}
`;
    
    const plugin3 = `
export default function register(ctx) {
  ctx.program.command('cmd-gamma').description('Gamma command');
}
`;
    
    fs.writeFileSync(path.join(pluginDir, 'z-third.mjs'), plugin3);
    fs.writeFileSync(path.join(pluginDir, 'a-first.mjs'), plugin1);
    fs.writeFileSync(path.join(pluginDir, 'm-second.mjs'), plugin2);
    
    // Verify all commands appear in help
    const { stdout } = await execAsync(`node ${cliPath} --help`);
    expect(stdout).toContain('cmd-alpha');
    expect(stdout).toContain('cmd-beta');
    expect(stdout).toContain('cmd-gamma');
  });

  it('should continue working even if a plugin fails to load', async () => {
    // Create a good plugin
    const goodPlugin = `
export default function register(ctx) {
  ctx.program.command('good').description('Good command');
}
`;
    
    // Create a bad plugin with syntax error
    const badPlugin = `
export default function register(ctx) {
  this is not valid javascript ;;;
}
`;
    
    fs.writeFileSync(path.join(pluginDir, 'good.mjs'), goodPlugin);
    fs.writeFileSync(path.join(pluginDir, 'bad.mjs'), badPlugin);
    
    // The CLI should still work and the good plugin should load
    const { stdout } = await execAsync(`node ${cliPath} --help`);
    expect(stdout).toContain('good');
    
    // Built-in commands should still work
    expect(stdout).toContain('create');
    expect(stdout).toContain('list');
  });

  it('should show plugin information with plugins command', async () => {
    // Create test plugins
    fs.writeFileSync(path.join(pluginDir, 'plugin1.mjs'), 'export default function register(ctx) {}');
    fs.writeFileSync(path.join(pluginDir, 'plugin2.js'), 'export default function register(ctx) {}');
    
    const { stdout } = await execAsync(`node ${cliPath} plugins --json`);
    const result = JSON.parse(stdout);
    
    expect(result.success).toBe(true);
    expect(result.dirExists).toBe(true);
    expect(result.count).toBe(2);
    expect(result.plugins).toHaveLength(2);
    expect(result.plugins[0].name).toBe('plugin1.mjs');
    expect(result.plugins[1].name).toBe('plugin2.js');
  });

  it('should handle empty plugin directory gracefully', async () => {
    const { stdout } = await execAsync(`node ${cliPath} plugins --json`);
    const result = JSON.parse(stdout);
    
    expect(result.success).toBe(true);
    expect(result.dirExists).toBe(true);
    expect(result.count).toBe(0);
    expect(result.plugins).toEqual([]);
  });

  it('should handle non-existent plugin directory gracefully', async () => {
    // Remove the plugin directory
    fs.rmdirSync(pluginDir);
    
    const { stdout } = await execAsync(`node ${cliPath} plugins --json`);
    const result = JSON.parse(stdout);
    
    expect(result.success).toBe(true);
    expect(result.dirExists).toBe(false);
    expect(result.plugins).toEqual([]);
  });

  it('should allow plugin to access worklog database', async () => {
    // Create a plugin that uses the database
    const dbPlugin = `
export default function register(ctx) {
  ctx.program
    .command('count-items')
    .description('Count work items')
    .action(() => {
      ctx.utils.requireInitialized();
      const db = ctx.utils.getDatabase();
      const items = db.getAll();
      ctx.output.json({ success: true, count: items.length });
    });
}
`;
    
    fs.writeFileSync(path.join(pluginDir, 'db-plugin.mjs'), dbPlugin);
    
    // Create a work item first
    await execAsync(`node ${cliPath} create --json -t "Test item"`);
    
    // Test the plugin command
    const { stdout } = await execAsync(`node ${cliPath} count-items`);
    const result = JSON.parse(stdout);
    
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
  });

  it('should respect WORKLOG_PLUGIN_DIR environment variable', async () => {
    // Create a custom plugin directory
    const customPluginDir = path.join(tempDir, 'custom-plugins');
    fs.mkdirSync(customPluginDir, { recursive: true });
    
    const plugin = `
export default function register(ctx) {
  ctx.program.command('custom-cmd').description('Custom command');
}
`;
    
    fs.writeFileSync(path.join(customPluginDir, 'custom.mjs'), plugin);
    
    // Set environment variable
    const env = { ...process.env, WORKLOG_PLUGIN_DIR: customPluginDir };
    
    const { stdout } = await execAsync(`node ${cliPath} --help`, { env });
    expect(stdout).toContain('custom-cmd');
  });

  it('should not load .d.ts or .map files as plugins', async () => {
    // Create files that should be ignored
    fs.writeFileSync(path.join(pluginDir, 'types.d.ts'), '// types');
    fs.writeFileSync(path.join(pluginDir, 'source.js.map'), '// map');
    
    // Create a valid plugin
    const validPlugin = `
export default function register(ctx) {
  ctx.program.command('valid').description('Valid command');
}
`;
    fs.writeFileSync(path.join(pluginDir, 'valid.mjs'), validPlugin);
    
    const { stdout } = await execAsync(`node ${cliPath} plugins --json`);
    const result = JSON.parse(stdout);
    
    // Should only find the valid plugin
    expect(result.count).toBe(1);
    expect(result.plugins[0].name).toBe('valid.mjs');
  });
});
