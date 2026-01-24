import { WorkItem, Comment, WorkItemRiskLevel, WorkItemEffortLevel } from './types.js';
import chalk from 'chalk';
import {
  GithubConfig,
  GithubIssueRecord,
  GithubIssueComment,
  stripWorklogMarkers,
  extractWorklogId,
  extractWorklogCommentId,
  extractParentId,
  extractParentIssueNumber,
  extractChildIds,
  extractChildIssueNumbers,
  getIssueHierarchy,
  addSubIssueLink,
  addSubIssueLinkResult,
  buildWorklogCommentMarker,
  workItemToIssuePayload,
  createGithubIssue,
  updateGithubIssue,
  listGithubIssues,
  getGithubIssue,
  listGithubIssueComments,
  createGithubIssueComment,
  updateGithubIssueComment,
  normalizeGithubLabelPrefix,
  issueToWorkItemFields,
} from './github.js';
import { mergeWorkItems } from './sync.js';

export interface GithubSyncResult {
  updated: number;
  created: number;
  skipped: number;
  errors: string[];
  commentsCreated?: number;
  commentsUpdated?: number;
}

export interface GithubSyncTiming {
  totalMs: number;
  upsertMs: number;
  commentListMs: number;
  commentUpsertMs: number;
  hierarchyCheckMs: number;
  hierarchyLinkMs: number;
  hierarchyVerifyMs: number;
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
  onProgress?: (progress: GithubProgress) => void,
  onVerboseLog?: (message: string) => void
): { updatedItems: WorkItem[]; result: GithubSyncResult; timing: GithubSyncTiming } {
  const startTime = Date.now();
  const labelPrefix = normalizeGithubLabelPrefix(config.labelPrefix);
  const issueItems = items.filter(item => item.status !== 'deleted');
  const linkedPairs = new Set<string>();
  let linkedCount = 0;
  const nodeIdCache = new Map<number, string>();
  const timing = {
    totalMs: 0,
    upsertMs: 0,
    commentListMs: 0,
    commentUpsertMs: 0,
    hierarchyCheckMs: 0,
    hierarchyLinkMs: 0,
    hierarchyVerifyMs: 0,
  };
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

  const sortCommentsByCreatedAt = (left: Comment, right: Comment) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();
    if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) {
      return 0;
    }
    if (Number.isNaN(leftTime)) {
      return -1;
    }
    if (Number.isNaN(rightTime)) {
      return 1;
    }
    return leftTime - rightTime;
  };

  const buildGithubCommentBody = (comment: Comment) => {
    const marker = buildWorklogCommentMarker(comment.id);
    const authorLabel = comment.author ? `**${comment.author}**` : '**worklog**';
    const body = stripWorklogMarkers(comment.comment);
    return `${marker}\n\n${authorLabel}\n\n${body}`.trim();
  };

  const maxIsoTimestamp = (left?: string | null, right?: string | null): string | null => {
    if (!left && !right) {
      return null;
    }
    if (!left) {
      return right || null;
    }
    if (!right) {
      return left || null;
    }
    const leftTime = new Date(left).getTime();
    const rightTime = new Date(right).getTime();
    if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) {
      return left;
    }
    if (Number.isNaN(leftTime)) {
      return right;
    }
    if (Number.isNaN(rightTime)) {
      return left;
    }
    return leftTime >= rightTime ? left : right;
  };

  const latestCommentTimestamp = (itemComments: Comment[]): string | null => {
    let latest: string | null = null;
    for (const comment of itemComments) {
      latest = maxIsoTimestamp(latest, comment.createdAt);
    }
    return latest;
  };

  const commentNeedsSync = (item: WorkItem, itemComments: Comment[]): boolean => {
    if (itemComments.length === 0) {
      return false;
    }
    if (!item.githubIssueUpdatedAt) {
      return true;
    }
    const latest = latestCommentTimestamp(itemComments);
    if (!latest) {
      return true;
    }
    const issueUpdatedAt = new Date(item.githubIssueUpdatedAt).getTime();
    if (Number.isNaN(issueUpdatedAt)) {
      return true;
    }
    const latestCommentTime = new Date(latest).getTime();
    if (Number.isNaN(latestCommentTime)) {
      return true;
    }
    return latestCommentTime > issueUpdatedAt;
  };

  const upsertGithubIssueComments = (
    issueConfig: GithubConfig,
    issueNumber: number,
    itemComments: Comment[],
    existingComments: GithubIssueComment[]
  ): { created: number; updated: number; latestUpdatedAt: string | null } => {
    const byWorklogId = new Map<string, GithubIssueComment>();
    for (const ghComment of existingComments) {
      const markerId = extractWorklogCommentId(ghComment.body || undefined);
      if (!markerId) {
        continue;
      }
      if (!byWorklogId.has(markerId)) {
        byWorklogId.set(markerId, ghComment);
      }
    }

    let created = 0;
    let updated = 0;
    let latestUpdatedAt: string | null = null;
    const sorted = [...itemComments].sort(sortCommentsByCreatedAt);
    for (const comment of sorted) {
      const body = buildGithubCommentBody(comment);
      const existing = byWorklogId.get(comment.id);
      if (existing) {
        const bodyMatch = (existing.body || '').trim() === body.trim();
        if (!bodyMatch) {
          const updatedComment = updateGithubIssueComment(issueConfig, existing.id, body);
          updated += 1;
          latestUpdatedAt = maxIsoTimestamp(latestUpdatedAt, updatedComment.updatedAt);
        }
        continue;
      }
      const createdComment = createGithubIssueComment(issueConfig, issueNumber, body);
      created += 1;
      latestUpdatedAt = maxIsoTimestamp(latestUpdatedAt, createdComment.updatedAt);
    }

    return { created, updated, latestUpdatedAt };
  };

  for (const item of issueItems) {
    if (onProgress) {
      onProgress({ phase: 'push', current: processed + 1, total: issueItems.length });
    }
    const itemComments = byItemId.get(item.id) || [];
    const shouldSyncComments = commentNeedsSync(item, itemComments);
    if (
      item.githubIssueNumber &&
      item.githubIssueUpdatedAt &&
      new Date(item.updatedAt).getTime() <= new Date(item.githubIssueUpdatedAt).getTime() &&
      !shouldSyncComments
    ) {
      if (onVerboseLog) {
        onVerboseLog(`[upsert] skip ${item.id} (no issue or comment changes)`);
      }
      skippedUpdates += 1;
      processed += 1;
      continue;
    }
    const payload = workItemToIssuePayload(item, itemComments, labelPrefix, items);

    try {
      let issue: GithubIssueRecord | null = null;
      let issueNumber = item.githubIssueNumber;
      let issueUpdatedAt = item.githubIssueUpdatedAt || null;
      const shouldUpdateIssue = !item.githubIssueNumber
        || !item.githubIssueUpdatedAt
        || new Date(item.updatedAt).getTime() > new Date(item.githubIssueUpdatedAt).getTime();
      if (shouldUpdateIssue) {
        const upsertStart = Date.now();
        if (onVerboseLog) {
          onVerboseLog(`[upsert] ${item.githubIssueNumber ? 'update' : 'create'} ${item.id}`);
        }
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
        timing.upsertMs += Date.now() - upsertStart;
        if (onVerboseLog) {
          onVerboseLog(`[upsert] ${item.id} completed in ${Date.now() - upsertStart}ms`);
        }
        issueNumber = issue.number;
        issueUpdatedAt = issue.updatedAt;
      } else if (onVerboseLog) {
        onVerboseLog(`[upsert] issue unchanged for ${item.id}`);
      }

      const shouldSyncCommentsNow = itemComments.length > 0 && (shouldSyncComments || shouldUpdateIssue);
      if (shouldSyncCommentsNow && issueNumber) {
        const commentListStart = Date.now();
        const existingComments = listGithubIssueComments(config, issueNumber);
        timing.commentListMs += Date.now() - commentListStart;
        const commentUpsertStart = Date.now();
        const commentSummary = upsertGithubIssueComments(config, issueNumber, itemComments, existingComments);
        timing.commentUpsertMs += Date.now() - commentUpsertStart;
        result.commentsCreated = (result.commentsCreated || 0) + commentSummary.created;
        result.commentsUpdated = (result.commentsUpdated || 0) + commentSummary.updated;
        issueUpdatedAt = maxIsoTimestamp(issueUpdatedAt, commentSummary.latestUpdatedAt);
      } else if (onVerboseLog && itemComments.length > 0) {
        onVerboseLog(`[upsert] comments unchanged for ${item.id}`);
      }

      updatedById.set(item.id, {
        ...item,
        githubIssueNumber: issueNumber ?? item.githubIssueNumber,
        githubIssueId: issue?.id ?? item.githubIssueId,
        githubIssueUpdatedAt: issueUpdatedAt ?? item.githubIssueUpdatedAt,
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
  if (onVerboseLog) {
    onVerboseLog(`[hierarchy] ${pairs.length} parent-child pair(s) to verify`);
  }
  for (let idx = 0; idx < pairs.length; idx += 1) {
    if (onProgress) {
      onProgress({ phase: 'hierarchy', current: idx + 1, total: pairs.length || 1 });
    }
    const [parentNumberRaw, childNumberRaw] = pairs[idx].split(':');
    const parentNumber = Number(parentNumberRaw);
    const childNumber = Number(childNumberRaw);
    try {
      if (onVerboseLog) {
        onVerboseLog(`[hierarchy] ${idx + 1}/${pairs.length} checking ${parentNumber} -> ${childNumber}`);
      }
      const checkStart = Date.now();
      const hierarchy = getIssueHierarchy(config, parentNumber);
      timing.hierarchyCheckMs += Date.now() - checkStart;
      if (onVerboseLog) {
        onVerboseLog(
          `[hierarchy] fetched ${parentNumber} in ${Date.now() - checkStart}ms (children: ${hierarchy.childIssueNumbers.length})`
        );
      }
      if (hierarchy.childIssueNumbers.includes(childNumber)) {
        linkedCount += 1;
        if (onVerboseLog) {
          onVerboseLog(`[hierarchy] already linked ${parentNumber} -> ${childNumber}`);
        }
        continue;
      }
      const linkStart = Date.now();
      const linkResult = addSubIssueLinkResult(config, parentNumber, childNumber, nodeIdCache);
      timing.hierarchyLinkMs += Date.now() - linkStart;
      if (onVerboseLog) {
        onVerboseLog(
          `[hierarchy] link ${parentNumber} -> ${childNumber} ${linkResult.ok ? 'ok' : 'failed'} in ${
            Date.now() - linkStart
          }ms`
        );
      }
      if (!linkResult.ok) {
        result.errors.push(`link ${parentNumber}->${childNumber}: ${linkResult.error || 'sub-issue link not created'}`);
        continue;
      }
      const verifyStart = Date.now();
      const updatedHierarchy = getIssueHierarchy(config, parentNumber);
      timing.hierarchyVerifyMs += Date.now() - verifyStart;
      if (onVerboseLog) {
        onVerboseLog(`[hierarchy] verify ${parentNumber} in ${Date.now() - verifyStart}ms`);
      }
      if (updatedHierarchy.childIssueNumbers.includes(childNumber)) {
        linkedCount += 1;
        if (onVerboseLog) {
          onVerboseLog(`[hierarchy] verified ${parentNumber} -> ${childNumber}`);
        }
        continue;
      }
      result.errors.push(`link ${parentNumber}->${childNumber}: sub-issue link not created`);
    } catch (error) {
      result.errors.push(`link ${parentNumber}->${childNumber}: ${(error as Error).message}`);
    }
  }

  result.updated += linkedCount;
  timing.totalMs = Date.now() - startTime;
  return { updatedItems, result, timing };
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
  markersFound: number;
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

  const remoteItemsById = new Map<string, WorkItem>();
  const issueMetaById = new Map<string, { number: number; id: number; updatedAt: string }>();
  const parentHints = new Map<string, string>();
  const childHints = new Map<string, string[]>();
  const parentIssueHints = new Map<string, number>();
  const childIssueHints = new Map<string, number[]>();
  const seenIssueNumbers = new Set<number>();
  let markersFound = 0;

  const shouldReplaceRemote = (existingUpdatedAt: string | null | undefined, nextUpdatedAt: string): boolean => {
    if (!existingUpdatedAt) {
      return true;
    }
    const existingTime = new Date(existingUpdatedAt).getTime();
    const nextTime = new Date(nextUpdatedAt).getTime();
    if (Number.isNaN(existingTime) && Number.isNaN(nextTime)) {
      return true;
    }
    if (Number.isNaN(existingTime)) {
      return true;
    }
    if (Number.isNaN(nextTime)) {
      return false;
    }
    return nextTime >= existingTime;
  };

  let processed = 0;
  for (const issue of issues) {
    if (onProgress) {
      onProgress({ phase: 'import', current: processed + 1, total: issues.length });
    }
    const markerId = extractWorklogId(issue.body);
    if (markerId) {
      markersFound += 1;
    }
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
          risk: '',
          effort: '',
        };

    const tags = labelFields.tags.length > 0
      ? Array.from(new Set([...(base.tags || []), ...labelFields.tags]))
      : base.tags;

    const remoteItem: WorkItem = {
      ...base,
      title: issue.title || base.title,
      description: issue.body ? stripWorklogMarkers(issue.body) : base.description,
      status: isClosed ? 'completed' : (labelFields.status || base.status),
      priority: labelFields.priority || base.priority,
      tags,
      risk: (labelFields.risk || base.risk) as WorkItemRiskLevel | '',
      effort: (labelFields.effort || base.effort) as WorkItemEffortLevel | '',
      updatedAt: updatedAt,
    };

    const hierarchy = hierarchyByIssueNumber.get(issue.number);
    const parentIssueNumber = parentByChildIssueNumber.get(issue.number)
      ?? hierarchy?.parentIssueNumber
      ?? extractParentIssueNumber(issue.body);
    const childIssueNumbers = hierarchy?.childIssueNumbers ?? extractChildIssueNumbers(issue.body);

    const existingMeta = issueMetaById.get(remoteItem.id);
    const shouldReplace = existingMeta
      ? shouldReplaceRemote(existingMeta.updatedAt, issue.updatedAt)
      : true;
    if (existingMeta) {
      const removedIssueNumber = shouldReplace ? existingMeta.number : issue.number;
      const removedIssueUrl = `https://github.com/${config.repo}/issues/${removedIssueNumber}`;
      console.error(
        chalk.red(
          `Duplicate Worklog marker detected for ${remoteItem.id}. `
          + `Duplicates should not occur. Ignoring ${removedIssueUrl} during sync. `
          + 'Remove the duplicate from GitHub after confirming it has no additional content of value.'
        )
      );
      if (!shouldReplace) {
        seenIssueNumbers.add(issue.number);
        processed += 1;
        continue;
      }
    }
    if (shouldReplace) {
      remoteItemsById.set(remoteItem.id, remoteItem);
      issueMetaById.set(remoteItem.id, {
        number: issue.number,
        id: issue.id,
        updatedAt: issue.updatedAt,
      });
      if (parentId) {
        parentHints.set(remoteItem.id, parentId);
      } else {
        parentHints.delete(remoteItem.id);
      }
      if (childIds.length > 0) {
        childHints.set(remoteItem.id, childIds);
      } else {
        childHints.delete(remoteItem.id);
      }
      if (parentIssueNumber) {
        parentIssueHints.set(remoteItem.id, parentIssueNumber);
      } else {
        parentIssueHints.delete(remoteItem.id);
      }
      if (childIssueNumbers.length > 0) {
        childIssueHints.set(remoteItem.id, childIssueNumbers);
      } else {
        childIssueHints.delete(remoteItem.id);
      }
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
        remoteItemsById.set(item.id, {
          ...item,
          title: issue.title || item.title,
          description: issue.body ? stripWorklogMarkers(issue.body) : item.description,
          status: 'completed',
          priority: labelFields.priority || item.priority,
          tags,
          risk: (labelFields.risk || item.risk) as WorkItemRiskLevel | '',
          effort: (labelFields.effort || item.effort) as WorkItemEffortLevel | '',
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

  const remoteItems = Array.from(remoteItemsById.values());
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
    markersFound,
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
