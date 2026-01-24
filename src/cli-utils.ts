/**
 * Shared CLI utilities and context factory
 */

import type { Command } from 'commander';
import { WorklogDatabase } from './database.js';
import { loadConfig, isInitialized, getDefaultPrefix } from './config.js';
import { getDefaultDataPath } from './jsonl.js';
import type { PluginContext } from './plugin-types.js';

const WORKLOG_VERSION = '0.0.1';

/**
 * Output formatting helpers
 */
export function createOutputHelpers(program: Command) {
  return {
    json: (data: any) => {
      console.log(JSON.stringify(data, null, 2));
    },
    
    success: (message: string, jsonData?: any) => {
      const isJsonMode = program.opts().json;
      if (isJsonMode) {
        console.log(JSON.stringify(jsonData || { success: true, message }, null, 2));
      } else {
        console.log(message);
      }
    },
    
    error: (message: string, jsonData?: any) => {
      const isJsonMode = program.opts().json;
      if (isJsonMode) {
        console.error(JSON.stringify(jsonData || { success: false, error: message }, null, 2));
      } else {
        console.error(message);
      }
    }
  };
}

/**
 * Check if worklog is initialized and exit if not
 * Outputs proper error messages based on JSON mode
 */
export function createRequireInitialized(program: Command) {
  return (): void => {
    if (!isInitialized()) {
      const isJsonMode = program.opts().json;
      if (isJsonMode) {
        console.log(JSON.stringify({
          success: false,
          initialized: false,
          error: 'Worklog system is not initialized. Run "worklog init" first.'
        }, null, 2));
      } else {
        console.error('Error: Worklog system is not initialized.');
        console.error('Run "worklog init" to initialize the system.');
      }
      process.exit(1);
    }
  };
}

/**
 * Get database instance with optional prefix override
 */
export function getDatabase(prefix?: string, program?: Command): WorklogDatabase {
  const config = loadConfig();
  const effectivePrefix = prefix || config?.prefix || getDefaultPrefix();
  const dataPath = getDefaultDataPath();
  
  // WorklogDatabase constructor signature: (prefix, dbPath?, jsonlPath?, autoExport?, silent?, autoSync?, syncProvider?)
  // Get auto-export and auto-sync settings from config
  const autoExport = config?.autoExport !== false; // Default to true
  const autoSync = config?.autoSync === true; // Default to false
  
  // Determine silent mode: suppress output unless verbose OR not in JSON mode
  const isJsonMode = program?.opts?.()?.json || false;
  const isVerbose = program?.opts?.()?.verbose || false;
  const silent = isJsonMode || !isVerbose;
  
  return new WorklogDatabase(effectivePrefix, undefined, dataPath, autoExport, silent, autoSync);
}

/**
 * Get prefix from config or use override
 */
export function getPrefix(overridePrefix?: string): string {
  if (overridePrefix) {
    return overridePrefix.toUpperCase();
  }
  return getDefaultPrefix();
}

/**
 * Create shared plugin context
 */
export function createPluginContext(program: Command): PluginContext {
  return {
    program,
    version: WORKLOG_VERSION,
    dataPath: getDefaultDataPath(),
    output: createOutputHelpers(program),
    utils: {
      requireInitialized: createRequireInitialized(program),
      getDatabase: (prefix?: string) => getDatabase(prefix, program),
      getConfig: loadConfig,
      getPrefix,
      isJsonMode: () => program.opts().json
    }
  };
}

/**
 * Get Worklog version
 */
export function getVersion(): string {
  return WORKLOG_VERSION;
}
