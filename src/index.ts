/**
 * Main entry point for the Worklog API server
 */

import { WorklogDatabase } from './database.js';
import { createAPI } from './api.js';
import { importFromJsonl, getDefaultDataPath } from './jsonl.js';
import * as fs from 'fs';

const PORT = process.env.PORT || 3000;

// Create database instance
const db = new WorklogDatabase();

// Try to load existing data on startup
const dataPath = getDefaultDataPath();
if (fs.existsSync(dataPath)) {
  try {
    console.log(`Loading existing data from ${dataPath}...`);
    const items = importFromJsonl(dataPath);
    db.import(items);
    console.log(`Loaded ${items.length} work items`);
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
