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
const INIT_SEMAPHORE_FILE = 'initialized';

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
 * Get the path to the initialization semaphore file
 */
export function getInitSemaphorePath(): string {
  return path.join(getConfigDir(), INIT_SEMAPHORE_FILE);
}

/**
 * Check if config file exists
 */
export function configExists(): boolean {
  return fs.existsSync(getConfigPath());
}

/**
 * Check if the system has been initialized
 */
export function isInitialized(): boolean {
  return fs.existsSync(getInitSemaphorePath());
}

/**
 * Write initialization semaphore file with version information
 */
export function writeInitSemaphore(version: string): void {
  const configDir = getConfigDir();
  
  // Ensure directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const initData = {
    version,
    initializedAt: new Date().toISOString()
  };
  
  fs.writeFileSync(getInitSemaphorePath(), JSON.stringify(initData, null, 2), 'utf-8');
}

/**
 * Read initialization information from semaphore file
 */
export function readInitSemaphore(): { version: string; initializedAt: string } | null {
  const semaphorePath = getInitSemaphorePath();
  
  if (!fs.existsSync(semaphorePath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(semaphorePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error reading initialization semaphore:', error);
    return null;
  }
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
export async function initConfig(existingConfig?: WorklogConfig | null): Promise<WorklogConfig> {
  if (existingConfig) {
    console.log('Current Worklog configuration:\n');
    console.log(`  Project: ${existingConfig.projectName}`);
    console.log(`  Prefix: ${existingConfig.prefix}`);
    console.log(`  Auto-export: ${existingConfig.autoExport !== false ? 'enabled' : 'disabled'}\n`);

    const shouldChange = await prompt('Do you want to change these settings? (y/N): ');
    
    if (shouldChange.toLowerCase() !== 'y' && shouldChange.toLowerCase() !== 'yes') {
      console.log('\nKeeping existing configuration.');
      return existingConfig;
    }

    console.log('\nEnter new values (press Enter to keep current value):\n');
  } else {
    console.log('Initializing Worklog configuration...\n');
  }

  const projectNamePrompt = existingConfig 
    ? `Project name (${existingConfig.projectName}): `
    : 'Project name: ';
  const projectNameInput = await prompt(projectNamePrompt);
  const projectName = projectNameInput || existingConfig?.projectName;

  const prefixPrompt = existingConfig
    ? `Issue ID prefix (${existingConfig.prefix}): `
    : 'Issue ID prefix (e.g., WI, PROJ, TASK): ';
  const prefixInput = await prompt(prefixPrompt);
  const prefix = prefixInput || existingConfig?.prefix;

  // Prompt for auto-export setting
  const currentAutoExport = existingConfig?.autoExport !== false ? 'Y' : 'n';
  const autoExportPrompt = existingConfig
    ? `Auto-export data to JSONL after changes? (Y/n) [${currentAutoExport}]: `
    : 'Auto-export data to JSONL after changes? (Y/n) [Y]: ';
  const autoExportInput = await prompt(autoExportPrompt);
  let autoExport: boolean;
  if (autoExportInput.trim() === '') {
    // Use default or existing value
    autoExport = existingConfig?.autoExport !== false;
  } else {
    autoExport = autoExportInput.toLowerCase() !== 'n' && autoExportInput.toLowerCase() !== 'no';
  }

  if (!projectName || !prefix) {
    throw new Error('Project name and prefix are required');
  }

  // Validate prefix (alphanumeric only)
  if (!/^[A-Z0-9]+$/i.test(prefix)) {
    throw new Error('Prefix must contain only alphanumeric characters');
  }

  const config: WorklogConfig = {
    projectName,
    prefix: prefix.toUpperCase(),
    autoExport
  };

  saveConfig(config);
  console.log(`\nConfiguration saved to ${getConfigPath()}`);
  console.log(`Project: ${config.projectName}`);
  console.log(`Prefix: ${config.prefix}`);
  console.log(`Auto-export: ${config.autoExport ? 'enabled' : 'disabled'}`);

  return config;
}
