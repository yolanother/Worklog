/**
 * Configuration management for Worklog projects
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { WorklogConfig } from './types.js';
import * as readline from 'readline';

const CONFIG_DIR = '.worklog';
const CONFIG_FILE = 'config.yaml';

/**
 * Get the path to the config directory
 */
export function getConfigDir(): string {
  return path.join(process.cwd(), CONFIG_DIR);
}

/**
 * Get the path to the config file
 */
export function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILE);
}

/**
 * Check if config file exists
 */
export function configExists(): boolean {
  return fs.existsSync(getConfigPath());
}

/**
 * Load configuration from file
 */
export function loadConfig(): WorklogConfig | null {
  if (!configExists()) {
    return null;
  }

  try {
    const content = fs.readFileSync(getConfigPath(), 'utf-8');
    const config = yaml.load(content) as WorklogConfig;
    return config;
  } catch (error) {
    console.error('Error loading config:', error);
    return null;
  }
}

/**
 * Save configuration to file
 */
export function saveConfig(config: WorklogConfig): void {
  const configDir = getConfigDir();
  
  // Ensure directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const content = yaml.dump(config);
  fs.writeFileSync(getConfigPath(), content, 'utf-8');
}

/**
 * Get the default prefix (WI if no config exists)
 */
export function getDefaultPrefix(): string {
  const config = loadConfig();
  return config?.prefix || 'WI';
}

/**
 * Prompt user for input
 */
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Interactive initialization of config
 */
export async function initConfig(): Promise<WorklogConfig> {
  console.log('Initializing Worklog configuration...\n');

  const projectName = await prompt('Project name: ');
  const prefix = await prompt('Issue ID prefix (e.g., WI, PROJ, TASK): ');

  if (!projectName || !prefix) {
    throw new Error('Project name and prefix are required');
  }

  // Validate prefix (alphanumeric only)
  if (!/^[A-Z0-9]+$/i.test(prefix)) {
    throw new Error('Prefix must contain only alphanumeric characters');
  }

  const config: WorklogConfig = {
    projectName,
    prefix: prefix.toUpperCase()
  };

  saveConfig(config);
  console.log(`\nConfiguration saved to ${getConfigPath()}`);
  console.log(`Project: ${config.projectName}`);
  console.log(`Prefix: ${config.prefix}`);

  return config;
}
