// Per-command CLI option interfaces for strong typing
import { WorkItemPriority, WorkItemStatus } from './types.js';

export interface InitOptions {}

export interface StatusOptions { prefix?: string }

export interface CreateOptions {
  title: string;
  description?: string;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  parent?: string;
  tags?: string;
  assignee?: string;
  stage?: string;
  risk?: string;
  effort?: string;
  issueType?: string;
  createdBy?: string;
  deletedBy?: string;
  deleteReason?: string;
  prefix?: string;
}

export interface ListOptions {
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  parent?: string;
  tags?: string;
  assignee?: string;
  stage?: string;
  prefix?: string;
}

export interface ShowOptions { children?: boolean; prefix?: string }

export interface UpdateOptions {
  title?: string;
  description?: string;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  parent?: string;
  tags?: string;
  assignee?: string;
  stage?: string;
  risk?: string;
  effort?: string;
  issueType?: string;
  createdBy?: string;
  deletedBy?: string;
  deleteReason?: string;
  prefix?: string;
}

export interface ExportOptions { file?: string; prefix?: string }
export interface ImportOptions { file?: string; prefix?: string }

export interface NextOptions { assignee?: string; search?: string; number?: string; prefix?: string }
export interface InProgressOptions { assignee?: string; prefix?: string }

export interface SyncOptions {
  file?: string;
  prefix?: string;
  gitRemote?: string;
  gitBranch?: string;
  push?: boolean;
  dryRun?: boolean;
}

export interface SyncDebugOptions {
  file?: string;
  prefix?: string;
  gitRemote?: string;
  gitBranch?: string;
}

export interface CommentCreateOptions { author: string; comment: string; references?: string; prefix?: string }
export interface CommentListOptions { prefix?: string }
export interface CommentShowOptions { prefix?: string }
export interface CommentUpdateOptions { author?: string; comment?: string; references?: string; prefix?: string }
export interface CommentDeleteOptions { prefix?: string }

export interface RecentOptions { number?: string; children?: boolean; prefix?: string }
export interface CloseOptions { reason?: string; author?: string; prefix?: string }

export interface DeleteOptions { prefix?: string }
