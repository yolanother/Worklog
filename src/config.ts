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
const CONFIG_DEFAULTS_FILE = 'config.defaults.yaml';

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
 * Get the path to the config defaults file
 */
export function getConfigDefaultsPath(): string {
  return path.join(getConfigDir(), CONFIG_DEFAULTS_FILE);
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
  let config: WorklogConfig | null = null;
  
  // First, load defaults if they exist
  const defaultsPath = getConfigDefaultsPath();
  if (fs.existsSync(defaultsPath)) {
    try {
      const content = fs.readFileSync(defaultsPath, 'utf-8');
      config = yaml.load(content, { schema: yaml.CORE_SCHEMA }) as WorklogConfig;
    } catch (error) {
      console.error('Error loading config defaults:', error);
      console.error('Continuing without defaults...');
    }
  }
  
  // Then, load user config and merge with defaults
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const userConfig = yaml.load(content, { schema: yaml.CORE_SCHEMA }) as WorklogConfig;
      
      // Merge user config over defaults
      config = config ? { ...config, ...userConfig } : userConfig;
    } catch (error) {
      console.error('Error loading config:', error);
      return null;
    }
  }
  
  // If no config was loaded at all, return null
  if (!config) {
    return null;
  }
  
  // Validate config structure
  if (!config || typeof config !== 'object') {
    console.error('Invalid config: must be an object');
    return null;
  }
  
  if (!config.projectName || typeof config.projectName !== 'string') {
    console.error('Invalid config: projectName must be a string');
    return null;
  }
  
  if (!config.prefix || typeof config.prefix !== 'string') {
    console.error('Invalid config: prefix must be a string');
    return null;
  }
  
  return config;
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
