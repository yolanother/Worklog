/**
 * Main entry point for the Worklog API server
 */

import { WorklogDatabase } from './database.js';
import { createAPI } from './api.js';
import { importFromJsonl, getDefaultDataPath } from './jsonl.js';
import { loadConfig } from './config.js';
import * as fs from 'fs';

const PORT = process.env.PORT || 3000;

// Load configuration and create database instance with prefix
const config = loadConfig();
const prefix = config?.prefix || 'WI';
const db = new WorklogDatabase(prefix);

if (config) {
  console.log(`Using project: ${config.projectName} (prefix: ${config.prefix})`);
} else {
  console.log('No configuration found. Using default prefix: WI');
  console.log('Run "npm run cli -- init" to set up your project.');
}

// Try to load existing data on startup
const dataPath = getDefaultDataPath();
if (fs.existsSync(dataPath)) {
  try {
    console.log(`Loading existing data from ${dataPath}...`);
    const { items, comments } = importFromJsonl(dataPath);
    db.import(items);
    db.importComments(comments);
    console.log(`Loaded ${items.length} work items and ${comments.length} comments`);
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

// Create and start the API server
const app = createAPI(db);

app.listen(PORT, () => {
  console.log(`Worklog API server running on http://localhost:${PORT}`);
  console.log(`Data file: ${dataPath}`);
});
