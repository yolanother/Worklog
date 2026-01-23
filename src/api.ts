/**
 * REST API for the Worklog system
 */

import express, { Request, Response } from 'express';
import { WorklogDatabase } from './database.js';
import { CreateWorkItemInput, UpdateWorkItemInput, WorkItemQuery } from './types.js';
import { exportToJsonl, importFromJsonl, getDefaultDataPath } from './jsonl.js';

export function createAPI(db: WorklogDatabase) {
  const app = express();
  app.use(express.json());

  // Health check
  app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Create a work item
  app.post('/items', (req: Request, res: Response) => {
    try {
      const input: CreateWorkItemInput = req.body;
      const item = db.create(input);
      res.status(201).json(item);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // Get a work item by ID
  app.get('/items/:id', (req: Request, res: Response) => {
    const item = db.get(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Work item not found' });
      return;
    }
    res.json(item);
  });

  // Update a work item
  app.put('/items/:id', (req: Request, res: Response) => {
    try {
      const input: UpdateWorkItemInput = req.body;
      const item = db.update(req.params.id, input);
      if (!item) {
        res.status(404).json({ error: 'Work item not found' });
        return;
      }
      res.json(item);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // Delete a work item
  app.delete('/items/:id', (req: Request, res: Response) => {
    const deleted = db.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Work item not found' });
      return;
    }
    res.status(204).send();
  });

  // List work items with optional filters
  app.get('/items', (req: Request, res: Response) => {
    const query: WorkItemQuery = {};
    
    if (req.query.status) {
      query.status = req.query.status as any;
    }
    if (req.query.priority) {
      query.priority = req.query.priority as any;
    }
    if (req.query.parentId !== undefined) {
      query.parentId = req.query.parentId === 'null' ? null : req.query.parentId as string;
    }
    if (req.query.tags) {
      query.tags = Array.isArray(req.query.tags) ? req.query.tags as string[] : [req.query.tags as string];
    }

    const items = db.list(query);
    res.json(items);
  });

  // Get children of a work item
  app.get('/items/:id/children', (req: Request, res: Response) => {
    const children = db.getChildren(req.params.id);
    res.json(children);
  });

  // Get descendants of a work item
  app.get('/items/:id/descendants', (req: Request, res: Response) => {
    const descendants = db.getDescendants(req.params.id);
    res.json(descendants);
  });

  // Export to JSONL
  app.post('/export', (req: Request, res: Response) => {
    try {
      const filepath = req.body.filepath || getDefaultDataPath();
      const items = db.getAll();
      exportToJsonl(items, filepath);
      res.json({ message: 'Export successful', filepath, count: items.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Import from JSONL
  app.post('/import', (req: Request, res: Response) => {
    try {
      const filepath = req.body.filepath || getDefaultDataPath();
      const items = importFromJsonl(filepath);
      db.import(items);
      res.json({ message: 'Import successful', count: items.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return app;
}
