/**
 * Core types for the Worklog system
 */

export type WorkItemStatus = 'open' | 'in-progress' | 'completed' | 'blocked';
export type WorkItemPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Represents a work item in the system
 */
export interface WorkItem {
  id: string;
  title: string;
  description: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

/**
 * Input for creating a new work item
 */
export interface CreateWorkItemInput {
  title: string;
  description?: string;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  parentId?: string | null;
  tags?: string[];
}

/**
 * Input for updating an existing work item
 */
export interface UpdateWorkItemInput {
  title?: string;
  description?: string;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  parentId?: string | null;
  tags?: string[];
}

/**
 * Query filters for finding work items
 */
export interface WorkItemQuery {
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  parentId?: string | null;
  tags?: string[];
}
