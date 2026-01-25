#!/usr/bin/env node
/**
 * Command-line interface for the Worklog system - Plugin-based architecture
 */

import { Command } from 'commander';
import { createPluginContext, getVersion } from './cli-utils.js';
import { loadPlugins } from './plugin-loader.js';

// Import built-in command modules
import initCommand from './commands/init.js';
import statusCommand from './commands/status.js';
import createCommand from './commands/create.js';
import listCommand from './commands/list.js';
import showCommand from './commands/show.js';
import updateCommand from './commands/update.js';
import deleteCommand from './commands/delete.js';
import exportCommand from './commands/export.js';
import importCommand from './commands/import.js';
import nextCommand from './commands/next.js';
import inProgressCommand from './commands/in-progress.js';
import syncCommand from './commands/sync.js';
import githubCommand from './commands/github.js';
import commentCommand from './commands/comment.js';
import closeCommand from './commands/close.js';
import recentCommand from './commands/recent.js';
import pluginsCommand from './commands/plugins.js';

// Allowed formats for validation
const ALLOWED_FORMATS = new Set(['concise', 'normal', 'full', 'raw']);

function isValidFormat(fmt: any): boolean {
  if (!fmt || typeof fmt !== 'string') return false;
  return ALLOWED_FORMATS.has(fmt.toLowerCase());
}

// Create commander program
const program = new Command();

program
  .name('worklog')
  .description('CLI for Worklog - an issue tracker for agents')
  .version(getVersion())
  .option('--json', 'Output in JSON format (machine-readable)')
  .option('--verbose', 'Show verbose output including debug messages')
  .option('-F, --format <format>', 'Human display format (choices: concise|normal|full|raw)');

// Validate CLI-provided format early before any command action runs
program.hook('preAction', () => {
  const cliFormat = program.opts().format;
  if (cliFormat && !isValidFormat(cliFormat)) {
    console.error(`Invalid --format value: ${cliFormat}`);
    console.error(`Valid formats: ${Array.from(ALLOWED_FORMATS).join(', ')}`);
    process.exit(1);
  }
});

// Create shared plugin context
const ctx = createPluginContext(program);

// Register built-in commands
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
  pluginsCommand
];

const builtInCommandNames = new Set([
  'init',
  'status',
  'create',
  'list',
  'show',
  'update',
  'delete',
  'export',
  'import',
  'next',
  'in-progress',
  'sync',
  'github',
  'comment',
  'close',
  'recent',
  'plugins'
]);

// Register each built-in command
for (const registerFn of builtInCommands) {
  try {
    registerFn(ctx);
  } catch (error) {
    console.error(`Failed to register built-in command: ${error}`);
    process.exit(1);
  }
}

// Load external plugins (quietly - verbose will be handled per-command if needed)
try {
  await loadPlugins(ctx, { verbose: false });
} catch (error) {
  // Silently continue with built-in commands only
}

// Customize help output to group commands for readability and ensure global
// options appear on subcommand help as well. Commander applies help
// configuration per-Command instance, so apply the same formatter to the
// program and each registered command recursively.

const formatHelp = (cmd: any, helper: any) => {
  const usage = helper.commandUsage(cmd);
  const description = cmd.description() || '';

  // Build groups and mapping of command name -> group
  const groupsDef: { name: string; names: string[] }[] = [
    { name: 'Issue Management', names: ['create', 'update', 'comment', 'close', 'delete'] },
    { name: 'Status', names: ['in-progress', 'next', 'recent', 'list', 'show'] },
    { name: 'Team', names: ['sync', 'github', 'import', 'export'] },
    { name: 'Plugins', names: [] },
  ];

  const visible = helper.visibleCommands(cmd) as any[];

  const groups: Map<string, any[]> = new Map();
  for (const g of groupsDef) groups.set(g.name, []);
  groups.set('Other', []);

  let helpCommand: any | null = null;
  for (const c of visible) {
    const name = c.name();
    if (name === 'help') {
      helpCommand = c;
      continue;
    }
    if (name === 'plugins' || !builtInCommandNames.has(name)) {
      groups.get('Plugins')!.push(c);
      continue;
    }

    const matched = groupsDef.find(g => g.names.includes(name));
    if (matched) {
      groups.get(matched.name)!.push(c);
    } else {
      groups.get('Other')!.push(c);
    }
  }

  if (helpCommand) {
    groups.get('Other')!.push(helpCommand);
  }

  // Compose help text
  let out = '';
  out += `Usage: ${usage}\n\n`;
  if (description) out += `${description}\n\n`;

  for (const [groupName, cmds] of groups) {
    if (!cmds || cmds.length === 0) continue;
    out += `${groupName}:\n`;
    const terms = cmds.map((c: any) => helper.subcommandTerm(c));
    const pad = Math.max(...terms.map((t: string) => t.length)) + 2;
    for (const c of cmds) {
      const term = helper.subcommandTerm(c);
      const desc = c.description();
      out += `  ${term.padEnd(pad)} ${desc}\n`;
    }
    out += '\n';
  }

  // Global + command-specific options
  const cmdOptions = helper.visibleOptions ? helper.visibleOptions(cmd) : [];
  const globalOptions = program.options || [];

  const seen = new Set<string>();
  const options: any[] = [];
  for (const o of [...globalOptions, ...cmdOptions]) {
    const key = o.flags || o.long || JSON.stringify(o);
    if (!seen.has(key)) {
      seen.add(key);
      options.push(o);
    }
  }

  if (options.length > 0) {
    out += 'Options:\n';
    const terms = options.map((o: any) => (helper.optionTerm ? helper.optionTerm(o) : o.flags));
    const padOptions = Math.max(...terms.map((t: string) => t.length)) + 2;
    for (let i = 0; i < options.length; i++) {
      const o = options[i];
      const term = terms[i];
      const desc = o.description || '';
      out += `  ${term.padEnd(padOptions)} ${desc}\n`;
    }
    out += '\n';
  }

  return out;
};

function applyHelpFormatting(cmd: any) {
  cmd.configureHelp({ formatHelp });
  if (cmd.commands && cmd.commands.length > 0) {
    for (const sub of cmd.commands) applyHelpFormatting(sub);
  }
}

applyHelpFormatting(program);

// Parse command line arguments
program.parse();
