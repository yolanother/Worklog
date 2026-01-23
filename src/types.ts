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
  assignee: string;
  stage: string;
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
  assignee?: string;
  stage?: string;
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
  assignee?: string;
  stage?: string;
}

/**
 * Query filters for finding work items
 */
export interface WorkItemQuery {
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  parentId?: string | null;
  tags?: string[];
  assignee?: string;
  stage?: string;
}

/**
 * Configuration for a worklog project
 */
export interface WorklogConfig {
  projectName: string;
  prefix: string;
}

/**
 * Represents a comment on a work item
 */
export interface Comment {
  id: string;
  workItemId: string;
  author: string;
  comment: string;
  createdAt: string;
  references: string[];
}

/**
 * Input for creating a new comment
 */
export interface CreateCommentInput {
  workItemId: string;
  author: string;
  comment: string;
  references?: string[];
}

/**
 * Input for updating an existing comment
 */
export interface UpdateCommentInput {
  author?: string;
  comment?: string;
  references?: string[];
}
