/**
 * SQLite-based persistent storage for work items and comments
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { WorkItem, Comment } from './types.js';

interface DbMetadata {
  lastJsonlImportMtime?: number;
  lastJsonlImportAt?: string;
  schemaVersion: number;
}

const SCHEMA_VERSION = 2;

export class SqlitePersistentStore {
  private db: Database.Database;
  private dbPath: string;
  private verbose: boolean;

  constructor(dbPath: string, verbose: boolean = false) {
    this.dbPath = dbPath;
    this.verbose = verbose;
    
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (error) {
        throw new Error(`Failed to create database directory ${dir}: ${(error as Error).message}`);
      }
    }

    // Open/create database
    try {
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL'); // Better concurrency
    } catch (error) {
      throw new Error(`Failed to open database ${dbPath}: ${(error as Error).message}`);
    }
    
    // Initialize schema
    try {
      this.initializeSchema();
    } catch (error) {
      throw new Error(`Failed to initialize database schema: ${(error as Error).message}`);
    }
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    // Create metadata table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Create work items table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workitems (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        parentId TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        tags TEXT NOT NULL,
        assignee TEXT NOT NULL,
        stage TEXT NOT NULL,
        issueType TEXT NOT NULL,
        createdBy TEXT NOT NULL,
        deletedBy TEXT NOT NULL,
        deleteReason TEXT NOT NULL
      )
    `);

    // Minimal migration for existing databases: add missing columns.
    // We keep this intentionally simple (no destructive ops), since this is a local repo DB.
    const schemaVersionRaw = this.getMetadata('schemaVersion');
    const existingVersion = schemaVersionRaw ? parseInt(schemaVersionRaw, 10) : 1;
    if (existingVersion < 2) {
      const cols = this.db.prepare(`PRAGMA table_info('workitems')`).all() as any[];
      const existingCols = new Set(cols.map(c => String(c.name)));
      const maybeAdd = (name: string) => {
        if (!existingCols.has(name)) {
          this.db.exec(`ALTER TABLE workitems ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`);
        }
      };
      maybeAdd('issueType');
      maybeAdd('createdBy');
      maybeAdd('deletedBy');
      maybeAdd('deleteReason');
    }

    // Create comments table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        workItemId TEXT NOT NULL,
        author TEXT NOT NULL,
        comment TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        refs TEXT NOT NULL,
        FOREIGN KEY (workItemId) REFERENCES workitems(id) ON DELETE CASCADE
      )
    `);

    // Create indexes for common queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_workitems_status ON workitems(status);
      CREATE INDEX IF NOT EXISTS idx_workitems_priority ON workitems(priority);
      CREATE INDEX IF NOT EXISTS idx_workitems_parentId ON workitems(parentId);
      CREATE INDEX IF NOT EXISTS idx_comments_workItemId ON comments(workItemId);
    `);

    // Set schema version if not exists
    const versionStmt = this.db.prepare('SELECT value FROM metadata WHERE key = ?');
    const versionRow = versionStmt.get('schemaVersion') as { value: string } | undefined;
    
    if (!versionRow) {
      this.setMetadata('schemaVersion', SCHEMA_VERSION.toString());
    } else {
      const current = parseInt(versionRow.value, 10);
      if (current < SCHEMA_VERSION) {
        this.setMetadata('schemaVersion', SCHEMA_VERSION.toString());
      }
    }
  }

  /**
   * Get metadata value
   */
  getMetadata(key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM metadata WHERE key = ?');
    const row = stmt.get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  /**
   * Set metadata value
   */
  setMetadata(key: string, value: string): void {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)'
    );
    stmt.run(key, value);
  }

  /**
   * Get all metadata
   */
  getAllMetadata(): DbMetadata {
    const schemaVersion = parseInt(this.getMetadata('schemaVersion') || '1', 10);
    const lastJsonlImportAt = this.getMetadata('lastJsonlImportAt') || undefined;
    const lastJsonlImportMtimeStr = this.getMetadata('lastJsonlImportMtime');
    const lastJsonlImportMtime = lastJsonlImportMtimeStr 
      ? parseInt(lastJsonlImportMtimeStr, 10) 
      : undefined;

    return {
      schemaVersion,
      lastJsonlImportAt,
      lastJsonlImportMtime,
    };
  }

  /**
   * Save a work item
   */
  saveWorkItem(item: WorkItem): void {
    if (this.verbose) {
      // Route debug diagnostics to stderr so stdout remains JSON-clean for --json mode
      console.error(`SqlitePersistentStore.saveWorkItem: saving workitem ${item.id} (status=${item.status})`);
    }

    // Use INSERT ... ON CONFLICT DO UPDATE to avoid triggering DELETE (which would cascade and remove comments)
    const stmt = this.db.prepare(`
      INSERT INTO workitems
      (id, title, description, status, priority, parentId, createdAt, updatedAt, tags, assignee, stage, issueType, createdBy, deletedBy, deleteReason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        status = excluded.status,
        priority = excluded.priority,
        parentId = excluded.parentId,
        createdAt = excluded.createdAt,
        updatedAt = excluded.updatedAt,
        tags = excluded.tags,
        assignee = excluded.assignee,
        stage = excluded.stage,
        issueType = excluded.issueType,
        createdBy = excluded.createdBy,
        deletedBy = excluded.deletedBy,
        deleteReason = excluded.deleteReason
    `);

    stmt.run(
      item.id,
      item.title,
      item.description,
      item.status,
      item.priority,
      item.parentId,
      item.createdAt,
      item.updatedAt,
      JSON.stringify(item.tags),
      item.assignee,
      item.stage,
      item.issueType,
      item.createdBy,
      item.deletedBy,
      item.deleteReason
    );
  }

  /**
   * Get a work item by ID
   */
  getWorkItem(id: string): WorkItem | null {
    const stmt = this.db.prepare('SELECT * FROM workitems WHERE id = ?');
    const row = stmt.get(id) as any;
    
    if (!row) {
      return null;
    }

    return this.rowToWorkItem(row);
  }

  /**
   * Count work items
   */
  countWorkItems(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM workitems');
    const row = stmt.get() as { count: number };
    return row.count;
  }

  /**
   * Get all work items
   */
  getAllWorkItems(): WorkItem[] {
    const stmt = this.db.prepare('SELECT * FROM workitems');
    const rows = stmt.all() as any[];
    return rows.map(row => this.rowToWorkItem(row));
  }

  /**
   * Delete a work item
   */
  deleteWorkItem(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM workitems WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Clear all work items
   */
  clearWorkItems(): void {
    this.db.prepare('DELETE FROM workitems').run();
  }

  /**
   * Save a comment
   */
  saveComment(comment: Comment): void {
    // Debug: log when saving a comment to help trace missing comments
    if (this.verbose) {
      // Send debug output to stderr to avoid contaminating JSON on stdout
      console.error(`SqlitePersistentStore.saveComment: saving comment ${comment.id} for ${comment.workItemId} by ${comment.author}`);
    }

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO comments 
      (id, workItemId, author, comment, createdAt, refs)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      comment.id,
      comment.workItemId,
      comment.author,
      comment.comment,
      comment.createdAt,
      JSON.stringify(comment.references)
    );
    if (this.verbose) {
      try {
        const count = this.getAllComments().length;
        console.error(`SqlitePersistentStore.saveComment: now total comments = ${count}`);
      } catch (_) {}
    }
  }

  /**
   * Get a comment by ID
   */
  getComment(id: string): Comment | null {
    const stmt = this.db.prepare('SELECT * FROM comments WHERE id = ?');
    const row = stmt.get(id) as any;
    
    if (!row) {
      return null;
    }

    return this.rowToComment(row);
  }

  /**
   * Get all comments
   */
  getAllComments(): Comment[] {
    const stmt = this.db.prepare('SELECT * FROM comments');
    const rows = stmt.all() as any[];
    const comments = rows.map(row => this.rowToComment(row));
    if (this.verbose) {
      console.error(`SqlitePersistentStore.getAllComments: returning ${comments.length} comments`);
    }
    return comments;
  }

  /**
   * Get comments for a work item
   */
  getCommentsForWorkItem(workItemId: string): Comment[] {
    const stmt = this.db.prepare('SELECT * FROM comments WHERE workItemId = ? ORDER BY createdAt ASC');
    const rows = stmt.all(workItemId) as any[];
    return rows.map(row => this.rowToComment(row));
  }

  /**
   * Delete a comment
   */
  deleteComment(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM comments WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Clear all comments
   */
  clearComments(): void {
    if (this.verbose) {
      console.error('SqlitePersistentStore.clearComments: clearing all comments');
    }
    this.db.prepare('DELETE FROM comments').run();
  }

  /**
   * Import work items and comments (replaces existing data)
   */
  importData(items: WorkItem[], comments: Comment[]): void {
    // Use a transaction for atomic import
    const importTransaction = this.db.transaction(() => {
      this.clearWorkItems();
      this.clearComments();
      
      for (const item of items) {
        this.saveWorkItem(item);
      }
      
      for (const comment of comments) {
        this.saveComment(comment);
      }
    });

    importTransaction();
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Convert database row to WorkItem
   */
  private rowToWorkItem(row: any): WorkItem {
    try {
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        parentId: row.parentId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        tags: JSON.parse(row.tags),
        assignee: row.assignee,
        stage: row.stage,

        issueType: row.issueType || '',
        createdBy: row.createdBy || '',
        deletedBy: row.deletedBy || '',
        deleteReason: row.deleteReason || '',
      };
    } catch (error) {
      console.error(`Error parsing work item ${row.id}:`, error);
      // Return item with empty tags if parsing fails
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        parentId: row.parentId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        tags: [],
        assignee: row.assignee,
        stage: row.stage,

        issueType: row.issueType || '',
        createdBy: row.createdBy || '',
        deletedBy: row.deletedBy || '',
        deleteReason: row.deleteReason || '',
      };
    }
  }

  /**
   * Convert database row to Comment
   */
  private rowToComment(row: any): Comment {
    try {
      return {
        id: row.id,
        workItemId: row.workItemId,
        author: row.author,
        comment: row.comment,
        createdAt: row.createdAt,
        references: JSON.parse(row.refs),
      };
    } catch (error) {
      console.error(`Error parsing comment ${row.id}:`, error);
      // Return comment with empty references if parsing fails
      return {
        id: row.id,
        workItemId: row.workItemId,
        author: row.author,
        comment: row.comment,
        createdAt: row.createdAt,
        references: [],
      };
    }
  }
}
