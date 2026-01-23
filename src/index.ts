/**
 * Main entry point for the Worklog API server
 */

import { WorklogDatabase } from './database.js';
import { createAPI } from './api.js';
import { loadConfig } from './config.js';

const PORT = process.env.PORT || 3000;

// Load configuration and create database instance with prefix
const config = loadConfig();
const prefix = config?.prefix || 'WI';

// Create database instance - it will automatically:
// 1. Connect to persistent SQLite storage
// 2. Check if JSONL is newer than DB and refresh if needed
const db = new WorklogDatabase(prefix);

if (config) {
  console.log(`Using project: ${config.projectName} (prefix: ${config.prefix})`);
} else {
  console.log('No configuration found. Using default prefix: WI');
  console.log('Run "npm run cli -- init" to set up your project.');
}

console.log(`Database ready with ${db.getAll().length} work items and ${db.getAllComments().length} comments`);

// Create and start the API server
const app = createAPI(db);

app.listen(PORT, () => {
  console.log(`Worklog API server running on http://localhost:${PORT}`);
});
