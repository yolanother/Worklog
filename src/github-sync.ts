import { WorkItem, Comment } from './types.js';
import {
  GithubConfig,
  GithubIssueRecord,
  extractWorklogId,
  extractParentId,
  extractParentIssueNumber,
  extractChildIds,
  extractChildIssueNumbers,
  getIssueHierarchy,
  addSubIssueLink,
  addSubIssueLinkResult,
  workItemToIssuePayload,
  createGithubIssue,
  updateGithubIssue,
  listGithubIssues,
  getGithubIssue,
  normalizeGithubLabelPrefix,
  issueToWorkItemFields,
} from './github.js';
import { mergeWorkItems } from './sync.js';

export interface GithubSyncResult {
  updated: number;
  created: number;
  skipped: number;
  errors: string[];
}

export interface GithubProgress {
  phase: 'push' | 'import' | 'close-check' | 'hierarchy';
  current: number;
  total: number;
}

export function upsertIssuesFromWorkItems(
  items: WorkItem[],
  comments: Comment[],
  config: GithubConfig,
  onProgress?: (progress: GithubProgress) => void
): { updatedItems: WorkItem[]; result: GithubSyncResult } {
  const labelPrefix = normalizeGithubLabelPrefix(config.labelPrefix);
  const issueItems = items.filter(item => item.status !== 'deleted');
  const linkedPairs = new Set<string>();
  let linkedCount = 0;
  const nodeIdCache = new Map<number, string>();
  const byItemId = new Map<string, Comment[]>();
  for (const comment of comments) {
    const list = byItemId.get(comment.workItemId) || [];
    list.push(comment);
    byItemId.set(comment.workItemId, list);
  }

  const updatedItems: WorkItem[] = [...items];
  const result: GithubSyncResult = { updated: 0, created: 0, skipped: 0, errors: [] };
  const updatedById = new Map<string, WorkItem>();
  let processed = 0;
  let skippedUpdates = 0;

  for (const item of issueItems) {
      if (onProgress) {
        onProgress({ phase: 'push', current: processed + 1, total: issueItems.length });
      }
    if (
      item.githubIssueNumber &&
      item.githubIssueUpdatedAt &&
      new Date(item.updatedAt).getTime() <= new Date(item.githubIssueUpdatedAt).getTime()
    ) {
      skippedUpdates += 1;
      processed += 1;
      continue;
    }
    const itemComments = byItemId.get(item.id) || [];
    const payload = workItemToIssuePayload(item, itemComments, labelPrefix, items);

    try {
      let issue: GithubIssueRecord;
      if (item.githubIssueNumber) {
        issue = updateGithubIssue(config, item.githubIssueNumber, payload);
        result.updated += 1;
      } else {
        issue = createGithubIssue(config, {
          title: payload.title,
          body: payload.body,
          labels: payload.labels,
        });
        result.created += 1;
      }

      updatedById.set(item.id, {
        ...item,
        githubIssueNumber: issue.number,
        githubIssueId: issue.id,
        githubIssueUpdatedAt: issue.updatedAt,
      });
    } catch (error) {
      result.errors.push(`${item.id}: ${(error as Error).message}`);
      updatedById.set(item.id, item);
    }
    processed += 1;
  }

  result.skipped = items.length - issueItems.length + skippedUpdates;

  for (let idx = 0; idx < updatedItems.length; idx += 1) {
    const item = updatedItems[idx];
    const updated = updatedById.get(item.id);
    if (updated) {
      updatedItems[idx] = updated;
    }
  }

  const issueById = new Map(updatedItems.map(item => [item.id, item]));
  for (const item of updatedItems) {
    if (item.status === 'deleted' || !item.parentId) {
      continue;
    }
    const parent = issueById.get(item.parentId);
    if (!parent || parent.status === 'deleted') {
      continue;
    }
    if (parent.githubIssueNumber && item.githubIssueNumber) {
      linkedPairs.add(`${parent.githubIssueNumber}:${item.githubIssueNumber}`);
    }
  }

  const pairs = Array.from(linkedPairs.values());
  for (let idx = 0; idx < pairs.length; idx += 1) {
    if (onProgress) {
      onProgress({ phase: 'push', current: issueItems.length + idx + 1, total: issueItems.length + pairs.length });
    }
    const [parentNumberRaw, childNumberRaw] = pairs[idx].split(':');
    const parentNumber = Number(parentNumberRaw);
    const childNumber = Number(childNumberRaw);
    try {
      const hierarchy = getIssueHierarchy(config, parentNumber);
      if (hierarchy.childIssueNumbers.includes(childNumber)) {
        linkedCount += 1;
        continue;
      }
      const linkResult = addSubIssueLinkResult(config, parentNumber, childNumber, nodeIdCache);
      if (!linkResult.ok) {
        result.errors.push(`link ${parentNumber}->${childNumber}: ${linkResult.error || 'sub-issue link not created'}`);
        continue;
      }
      const updatedHierarchy = getIssueHierarchy(config, parentNumber);
      if (updatedHierarchy.childIssueNumbers.includes(childNumber)) {
        linkedCount += 1;
        continue;
      }
      result.errors.push(`link ${parentNumber}->${childNumber}: sub-issue link not created`);
    } catch (error) {
      result.errors.push(`link ${parentNumber}->${childNumber}: ${(error as Error).message}`);
    }
  }

  result.updated += linkedCount;
  return { updatedItems, result };
}

export function importIssuesToWorkItems(
  items: WorkItem[],
  config: GithubConfig,
  options?: { since?: string; createNew?: boolean; generateId?: () => string; onProgress?: (progress: GithubProgress) => void }
): {
  updatedItems: WorkItem[];
  createdItems: WorkItem[];
  issues: GithubIssueRecord[];
  updatedIds: Set<string>;
  mergedItems: WorkItem[];
  conflictDetails: { conflicts: string[]; conflictDetails: import('./types.js').ConflictDetail[] };
} {
  const since = options?.since;
  const createNew = options?.createNew === true;
  const generateId = options?.generateId;
  const onProgress = options?.onProgress;
  const issues = listGithubIssues(config, since);
  const byId = new Map(items.map(item => [item.id, item]));
  const byIssueNumber = new Map<number, WorkItem>();
  for (const item of items) {
    if (item.githubIssueNumber) {
      byIssueNumber.set(item.githubIssueNumber, item);
    }
  }

  const hierarchyByIssueNumber = new Map<number, { parentIssueNumber: number | null; childIssueNumbers: number[] }>();
  const parentIssueNumbers = issues
    .filter(issue => (issue.subIssuesSummary?.total ?? 0) > 0)
    .map(issue => issue.number);
  const parentByChildIssueNumber = new Map<number, number>();
  let hierarchyChecked = 0;
  for (const issueNumber of parentIssueNumbers) {
    if (onProgress) {
      onProgress({ phase: 'hierarchy', current: hierarchyChecked + 1, total: parentIssueNumbers.length || 1 });
    }
    hierarchyChecked += 1;
    try {
      const hierarchy = getIssueHierarchy(config, issueNumber);
      hierarchyByIssueNumber.set(issueNumber, hierarchy);
      for (const childNumber of hierarchy.childIssueNumbers) {
        parentByChildIssueNumber.set(childNumber, issueNumber);
      }
    } catch {
      continue;
    }
  }

  const remoteItems: WorkItem[] = [];
  const issueMetaById = new Map<string, { number: number; id: number; updatedAt: string }>();
  const parentHints = new Map<string, string>();
  const childHints = new Map<string, string[]>();
  const parentIssueHints = new Map<string, number>();
  const childIssueHints = new Map<string, number[]>();
  const seenIssueNumbers = new Set<number>();

  let processed = 0;
  for (const issue of issues) {
    if (onProgress) {
      onProgress({ phase: 'import', current: processed + 1, total: issues.length });
    }
    const markerId = extractWorklogId(issue.body);
    const parentId = extractParentId(issue.body);
    const childIds = extractChildIds(issue.body);
    const existingByMarker = markerId ? byId.get(markerId) : undefined;
    const existing = existingByMarker || byIssueNumber.get(issue.number);
    const updatedAt = issue.updatedAt;
    const labelFields = issueToWorkItemFields(issue, config.labelPrefix);
    const isClosed = issue.state === 'closed';

    if (!existing && isClosed) {
      processed += 1;
      continue;
    }

    if (!existing && !markerId && !createNew) {
      processed += 1;
      continue;
    }

    if (!existing && !markerId && createNew && !generateId) {
      processed += 1;
      continue;
    }

    const newId = existing?.id || markerId || generateId!();
    const base: WorkItem = existing
      ? { ...existing }
      : {
          id: newId,
          title: 'Untitled',
          description: '',
          status: 'open',
          priority: 'medium',
          parentId: null,
          createdAt: updatedAt,
          updatedAt: updatedAt,
          tags: [],
          assignee: '',
          stage: '',
          issueType: '',
          createdBy: '',
          deletedBy: '',
          deleteReason: '',
        };

    const tags = labelFields.tags.length > 0
      ? Array.from(new Set([...(base.tags || []), ...labelFields.tags]))
      : base.tags;

    const remoteItem: WorkItem = {
      ...base,
      title: issue.title || base.title,
      description: issue.body || base.description,
      status: isClosed ? 'completed' : (labelFields.status || base.status),
      priority: labelFields.priority || base.priority,
      tags,
      updatedAt: updatedAt,
    };

    const hierarchy = hierarchyByIssueNumber.get(issue.number);
    const parentIssueNumber = parentByChildIssueNumber.get(issue.number)
      ?? hierarchy?.parentIssueNumber
      ?? extractParentIssueNumber(issue.body);
    const childIssueNumbers = hierarchy?.childIssueNumbers ?? extractChildIssueNumbers(issue.body);

    remoteItems.push(remoteItem);
    issueMetaById.set(remoteItem.id, {
      number: issue.number,
      id: issue.id,
      updatedAt: issue.updatedAt,
    });
    if (parentId) {
      parentHints.set(remoteItem.id, parentId);
    }
    if (childIds.length > 0) {
      childHints.set(remoteItem.id, childIds);
    }
    if (parentIssueNumber) {
      parentIssueHints.set(remoteItem.id, parentIssueNumber);
    }
    if (childIssueNumbers.length > 0) {
      childIssueHints.set(remoteItem.id, childIssueNumbers);
    }
    seenIssueNumbers.add(issue.number);
    processed += 1;
  }

  let checked = 0;
  for (const item of items) {
    if (!item.githubIssueNumber) {
      checked += 1;
      continue;
    }
    if (seenIssueNumbers.has(item.githubIssueNumber)) {
      checked += 1;
      continue;
    }
    if (onProgress) {
      onProgress({ phase: 'close-check', current: checked + 1, total: items.length });
    }
    try {
    const issue = getGithubIssue(config, item.githubIssueNumber);
    const hierarchy = hierarchyByIssueNumber.get(issue.number);
    const parentIssueNumber = parentByChildIssueNumber.get(issue.number)
      ?? hierarchy?.parentIssueNumber
      ?? extractParentIssueNumber(issue.body);
    const childIssueNumbers = hierarchy?.childIssueNumbers ?? extractChildIssueNumbers(issue.body);
      const parentId = extractParentId(issue.body);
      const childIds = extractChildIds(issue.body);
      if (issue.state !== 'closed') {
        checked += 1;
        continue;
      }

      const existingUpdatedAt = item.githubIssueUpdatedAt ? new Date(item.githubIssueUpdatedAt).getTime() : null;
      const issueUpdatedAt = new Date(issue.updatedAt).getTime();
      if (existingUpdatedAt !== null && existingUpdatedAt >= issueUpdatedAt && item.status === 'completed') {
        checked += 1;
        continue;
      }

      const labelFields = issueToWorkItemFields(issue, config.labelPrefix);
      const tags = labelFields.tags.length > 0
        ? Array.from(new Set([...item.tags, ...labelFields.tags]))
        : item.tags;
      remoteItems.push({
        ...item,
        title: issue.title || item.title,
        description: issue.body || item.description,
        status: 'completed',
        priority: labelFields.priority || item.priority,
        tags,
        updatedAt: issue.updatedAt,
      });
      if (parentId) {
        parentHints.set(item.id, parentId);
      }
      if (childIds.length > 0) {
        childHints.set(item.id, childIds);
      }
      if (parentIssueNumber) {
        parentIssueHints.set(item.id, parentIssueNumber);
      }
      if (childIssueNumbers.length > 0) {
        childIssueHints.set(item.id, childIssueNumbers);
      }
      issueMetaById.set(item.id, {
        number: issue.number,
        id: issue.id,
        updatedAt: issue.updatedAt,
      });
      checked += 1;
    } catch {
      checked += 1;
      continue;
    }
  }

  const mergeResult = mergeWorkItems(items, remoteItems, {
    defaultValueFields: ['status'],
    sameTimestampStrategy: 'local',
  });
  const mergedItems = mergeResult.merged.map(item => {
    const meta = issueMetaById.get(item.id);
    const parentId = parentHints.get(item.id) ?? null;
    if (!meta) {
      return parentId ? { ...item, parentId } : item;
    }
    return {
      ...item,
      parentId: parentId ?? item.parentId,
      githubIssueNumber: meta.number,
      githubIssueId: meta.id,
      githubIssueUpdatedAt: meta.updatedAt,
    };
  });

  if (childHints.size > 0) {
    const itemsById = new Map(mergedItems.map(item => [item.id, item]));
    for (const [parentId, childIds] of childHints.entries()) {
      for (const childId of childIds) {
        const child = itemsById.get(childId);
        if (!child) {
          continue;
        }
        child.parentId = parentId;
      }
    }
  }

  if (parentIssueHints.size > 0) {
    const itemsByIssue = new Map<number, WorkItem>();
    for (const item of mergedItems) {
      if (item.githubIssueNumber) {
        itemsByIssue.set(item.githubIssueNumber, item);
      }
    }
    for (const [childId, parentIssueNumber] of parentIssueHints.entries()) {
      const child = mergedItems.find(item => item.id === childId);
      const parent = itemsByIssue.get(parentIssueNumber);
      if (!child || !parent) {
        continue;
      }
      child.parentId = parent.id;
    }
  }

  if (childIssueHints.size > 0) {
    const itemsByIssue = new Map<number, WorkItem>();
    for (const item of mergedItems) {
      if (item.githubIssueNumber) {
        itemsByIssue.set(item.githubIssueNumber, item);
      }
    }
    for (const [parentId, issueNumbers] of childIssueHints.entries()) {
      for (const issueNumber of issueNumbers) {
        const child = itemsByIssue.get(issueNumber);
        if (!child) {
          continue;
        }
        child.parentId = parentId;
      }
    }
  }

  const localById = new Map(items.map(item => [item.id, item]));
  const updatedItems: WorkItem[] = [];
  const createdItems: WorkItem[] = [];
  const updatedIds = new Set<string>();

  for (const item of mergedItems) {
    const local = localById.get(item.id);
    if (!local) {
      createdItems.push(item);
      continue;
    }
    if (stableItemKeyForImport(local) !== stableItemKeyForImport(item)) {
      updatedItems.push(item);
      updatedIds.add(item.id);
    }
  }

  return {
    updatedItems,
    createdItems,
    issues,
    updatedIds,
    mergedItems,
    conflictDetails: {
      conflicts: mergeResult.conflicts,
      conflictDetails: mergeResult.conflictDetails,
    },
  };
}

function stableItemKeyForImport(item: WorkItem): string {
  const {
    updatedAt,
    githubIssueNumber,
    githubIssueId,
    githubIssueUpdatedAt,
    ...rest
  } = item;
  const normalized = {
    ...rest,
    tags: [...(item.tags || [])].slice().sort(),
  };
  const keys = Object.keys(normalized).sort();
  return JSON.stringify(normalized, keys);
}
