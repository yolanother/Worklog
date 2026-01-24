import { execSync } from 'child_process';
import { WorkItem, Comment, WorkItemStatus, WorkItemPriority } from './types.js';

export interface GithubConfig {
  repo: string;
  labelPrefix: string;
}

export interface GithubIssueRecord {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  labels: string[];
  updatedAt: string;
  subIssuesSummary?: { total: number; completed: number };
}

const WORKLOG_MARKER_PREFIX = '<!-- worklog:id=';
const WORKLOG_MARKER_SUFFIX = ' -->';

function runGh(command: string, input?: string): string {
  return execSync(command, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    input,
  }).trim();
}

function runGhDetailed(command: string, input?: string): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      input,
    }).trim();
    return { ok: true, stdout, stderr: '' };
  } catch (error: any) {
    const stdout = (error?.stdout ? String(error.stdout) : '').trim();
    const stderr = (error?.stderr ? String(error.stderr) : error?.message || '').trim();
    return { ok: false, stdout, stderr };
  }
}

function runGhSafe(command: string, input?: string): string | null {
  try {
    return runGh(command, input);
  } catch {
    return null;
  }
}

function runGhJson(command: string, input?: string): any {
  const output = runGh(command, input);
  return JSON.parse(output);
}

function runGhSafeJson(command: string, input?: string): any | null {
  const output = runGhSafe(command, input);
  if (output === null || output.trim() === '') {
    return null;
  }
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function runGhJsonDetailed(command: string, input?: string): { ok: boolean; data?: any; error?: string } {
  const result = runGhDetailed(command, input);
  if (!result.ok) {
    const error = result.stderr || result.stdout || 'GraphQL request failed';
    return { ok: false, error };
  }
  try {
    const data = JSON.parse(result.stdout);
    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      const message = data.errors.map((entry: any) => entry?.message || String(entry)).join('; ');
      return { ok: false, error: message || 'GraphQL request returned errors' };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'Invalid JSON response from GraphQL' };
  }
}

function quoteShellValue(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function labelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  }
  const color = (hash % 0xffffff).toString(16).padStart(6, '0');
  return color === '000000' ? 'ededed' : color;
}

function isStatusLabel(label: string, labelPrefix: string): boolean {
  const normalizedPrefix = normalizeGithubLabelPrefix(labelPrefix);
  if (!label.startsWith(normalizedPrefix)) {
    return false;
  }
  const value = label.slice(normalizedPrefix.length);
  if (value.startsWith('status:')) {
    return true;
  }
  return value === 'open' || value === 'in-progress' || value === 'completed' || value === 'blocked' || value === 'deleted';
}

function ensureGithubLabels(config: GithubConfig, labels: string[]): void {
  const unique = Array.from(new Set(labels.filter(label => label.trim() !== '')));
  if (unique.length === 0) {
    return;
  }

  const { owner, name } = parseRepoSlug(config.repo);
  const existingRaw = runGhSafe(`gh api repos/${owner}/${name}/labels --paginate`);
  const existing = new Set<string>();
  if (existingRaw) {
    try {
      const parsed = JSON.parse(existingRaw) as Array<{ name?: string }>;
      for (const entry of parsed) {
        if (entry.name) {
          existing.add(entry.name);
        }
      }
    } catch {
      // Ignore parse errors and attempt creation below.
    }
  }

  for (const label of unique) {
    if (existing.has(label)) {
      continue;
    }
    const color = labelColor(label);
    const createCommand = `gh api -X POST repos/${owner}/${name}/labels -f name=${JSON.stringify(label)} -f color=${JSON.stringify(color)}`;
    const result = runGhSafe(createCommand);
    if (result !== null) {
      continue;
    }
    const fallbackCommand = `gh issue label create ${JSON.stringify(label)} --repo ${config.repo} --color ${color}`;
    runGhSafe(fallbackCommand);
  }
}

export function normalizeGithubLabelPrefix(prefix?: string): string {
  if (!prefix) return 'wl:';
  return prefix.endsWith(':') ? prefix : `${prefix}:`;
}

export function parseRepoSlug(repo: string): { owner: string; name: string } {
  const parts = repo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid GitHub repo: ${repo}`);
  }
  return { owner: parts[0], name: parts[1] };
}

export function getRepoFromGitRemote(): string | null {
  try {
    const output = runGh('gh repo view --json nameWithOwner');
    const parsed = JSON.parse(output) as { nameWithOwner?: string };
    return parsed.nameWithOwner || null;
  } catch {
    return null;
  }
}

export function buildWorklogMarker(workItemId: string): string {
  return `${WORKLOG_MARKER_PREFIX}${workItemId}${WORKLOG_MARKER_SUFFIX}`;
}

export function extractWorklogId(body?: string | null): string | null {
  if (!body) return null;
  const start = body.indexOf(WORKLOG_MARKER_PREFIX);
  if (start === -1) return null;
  const end = body.indexOf(WORKLOG_MARKER_SUFFIX, start + WORKLOG_MARKER_PREFIX.length);
  if (end === -1) return null;
  const id = body.slice(start + WORKLOG_MARKER_PREFIX.length, end).trim();
  return id || null;
}

export function extractParentId(body?: string | null): string | null {
  if (!body) return null;
  const lines = body.split('\n');
  for (const line of lines) {
    if (!line.startsWith('Parent:')) {
      continue;
    }
    const match = line.match(/^Parent:\s*([^\s-]+(?:-[^\s-]+)*)/);
    if (match && match[1]) {
      return match[1];
    }
    return null;
  }
  return null;
}

export function extractParentIssueNumber(body?: string | null): number | null {
  if (!body) return null;
  const lines = body.split('\n');
  for (const line of lines) {
    if (!line.startsWith('Parent:')) {
      continue;
    }
    const match = line.match(/#(\d+)/);
    if (match && match[1]) {
      return Number(match[1]);
    }
    return null;
  }
  return null;
}

export interface IssueHierarchy {
  parentIssueNumber: number | null;
  childIssueNumbers: number[];
}

function getIssueNodeId(config: GithubConfig, issueNumber: number): string {
  const { owner, name } = parseRepoSlug(config.repo);
  const query = `query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) { id }
    }
  }`;
  const output = runGhJsonDetailed(
    `gh api graphql -f query=${quoteShellValue(query)} -f owner=${quoteShellValue(owner)} -f name=${quoteShellValue(name)} -F number=${issueNumber}`
  );
  if (!output.ok) {
    throw new Error(output.error || 'Unable to query GitHub issue node ID');
  }
  const id = output.data?.data?.repository?.issue?.id;
  if (!id) {
    throw new Error(`Unable to resolve GitHub issue node ID for #${issueNumber}`);
  }
  return id;
}

export function getIssueHierarchy(config: GithubConfig, issueNumber: number): IssueHierarchy {
  const { owner, name } = parseRepoSlug(config.repo);
  const query = `query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        parent { number }
        subIssues(first: 100) { nodes { number } }
      }
    }
  }`;
  const output = runGhJsonDetailed(
    `gh api graphql -f query=${quoteShellValue(query)} -f owner=${quoteShellValue(owner)} -f name=${quoteShellValue(name)} -F number=${issueNumber}`
  );
  if (!output.ok) {
    throw new Error(output.error || 'Unable to query issue hierarchy');
  }
  const issue = output.data?.data?.repository?.issue;
  const parentIssueNumber = issue?.parent?.number ?? null;
  const childIssueNumbers = Array.isArray(issue?.subIssues?.nodes)
    ? issue.subIssues.nodes.map((node: any) => node?.number).filter((value: any) => typeof value === 'number')
    : [];
  return { parentIssueNumber, childIssueNumbers };
}

export function addSubIssueLink(
  config: GithubConfig,
  parentIssueNumber: number,
  childIssueNumber: number,
  cache?: Map<number, string>
): void {
  const nodeCache = cache ?? new Map<number, string>();
  const resolveNodeId = (issueNumber: number) => {
    const cached = nodeCache.get(issueNumber);
    if (cached) {
      return cached;
    }
    const nodeId = getIssueNodeId(config, issueNumber);
    nodeCache.set(issueNumber, nodeId);
    return nodeId;
  };
  const parentNodeId = resolveNodeId(parentIssueNumber);
  const childNodeId = resolveNodeId(childIssueNumber);
  const mutation = `mutation($parent: ID!, $child: ID!) {
    addSubIssue(input: { issueId: $parent, subIssueId: $child }) { issue { id } subIssue { id } }
  }`;
  const result = runGhJsonDetailed(
    `gh api graphql -f query=${quoteShellValue(mutation)} -f parent=${quoteShellValue(parentNodeId)} -f child=${quoteShellValue(childNodeId)}`
  );
  if (!result.ok) {
    throw new Error(result.error || `Failed to link #${childIssueNumber} as sub-issue of #${parentIssueNumber}`);
  }
  const mutationResult = result.data?.data?.addSubIssue;
  if (!mutationResult?.subIssue?.id || !mutationResult?.issue?.id) {
    throw new Error('addSubIssue returned no data (sub-issues may be disabled for this repo/org)');
  }
}

export function addSubIssueLinkResult(
  config: GithubConfig,
  parentIssueNumber: number,
  childIssueNumber: number,
  cache?: Map<number, string>
): { ok: boolean; error?: string } {
  try {
    addSubIssueLink(config, parentIssueNumber, childIssueNumber, cache);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export function listParentIssueNumbersFromTimeline(config: GithubConfig, issueNumber: number): number[] {
  const command = `gh api repos/${config.repo}/issues/${issueNumber}/timeline --paginate`;
  const output = runGhSafeJson(command);
  if (!Array.isArray(output)) {
    return [];
  }
  const parents: number[] = [];
  for (const event of output) {
    if (event?.event === 'added_to_parent' && typeof event?.parent_issue?.number === 'number') {
      parents.push(event.parent_issue.number);
    }
  }
  return parents;
}

export function extractChildIds(body?: string | null): string[] {
  if (!body) return [];
  const lines = body.split('\n');
  const childIds: string[] = [];
  let inChildren = false;
  for (const line of lines) {
    if (line.trim() === '') {
      if (inChildren) {
        break;
      }
      continue;
    }
    if (line.startsWith('Children:') || line.startsWith('Pending children:')) {
      inChildren = true;
      continue;
    }
    if (!inChildren) {
      continue;
    }
    if (!line.startsWith('- ')) {
      break;
    }
    const match = line.match(/^-\s*([^\s-]+(?:-[^\s-]+)*)/);
    if (match && match[1]) {
      childIds.push(match[1]);
    }
  }
  return childIds;
}

export function extractChildIssueNumbers(body?: string | null): number[] {
  if (!body) return [];
  const lines = body.split('\n');
  const childIssueNumbers: number[] = [];
  let inChildren = false;
  for (const line of lines) {
    if (line.trim() === '') {
      if (inChildren) {
        break;
      }
      continue;
    }
    if (line.startsWith('Sub-issues:') || line.startsWith('Children:')) {
      inChildren = true;
      continue;
    }
    if (!inChildren) {
      continue;
    }
    const match = line.match(/#(\d+)/);
    if (!match || !match[1]) {
      if (!line.startsWith('-')) {
        break;
      }
      continue;
    }
    childIssueNumbers.push(Number(match[1]));
  }
  return childIssueNumbers;
}

export function workItemToIssuePayload(
  item: WorkItem,
  comments: Comment[],
  labelPrefix: string,
  allItems?: WorkItem[]
): { title: string; body: string; labels: string[]; state: 'open' | 'closed' } {
  const marker = buildWorklogMarker(item.id);
  const summaryLines: string[] = [marker];
  if (allItems) {
    void allItems;
  }
  summaryLines.push('');
  if (item.description) {
    summaryLines.push(item.description);
  }
  if (comments.length > 0) {
    summaryLines.push('', '---', '', '## Comments', '');
    for (const comment of comments) {
      summaryLines.push(`- ${comment.author}: ${comment.comment}`);
    }
  }

  const labels = new Set<string>();
  labels.add(`${labelPrefix}status:${item.status}`);
  labels.add(`${labelPrefix}priority:${item.priority}`);
  if (item.stage) {
    labels.add(`${labelPrefix}stage:${item.stage}`);
  }
  if (item.issueType) {
    labels.add(`${labelPrefix}type:${item.issueType}`);
  }
  for (const tag of item.tags) {
    labels.add(`${labelPrefix}tag:${tag}`);
  }

  const state = item.status === 'completed' || item.status === 'deleted' ? 'closed' : 'open';
  return {
    title: item.title,
    body: summaryLines.join('\n'),
    labels: Array.from(labels),
    state,
  };
}

export function issueToWorkItemFields(
  issue: GithubIssueRecord,
  labelPrefix: string
): { status: WorkItemStatus; priority: WorkItemPriority; tags: string[] } {
  const normalizedPrefix = normalizeGithubLabelPrefix(labelPrefix);
  const tags: string[] = [];
  let status: WorkItemStatus = issue.state === 'closed' ? 'completed' : 'open';
  let priority: WorkItemPriority = 'medium';

  for (const label of issue.labels) {
    if (label.startsWith(normalizedPrefix)) {
      const value = label.slice(normalizedPrefix.length);
      if (value.startsWith('status:')) {
        const nextStatus = value.slice('status:'.length);
        if (nextStatus === 'open' || nextStatus === 'in-progress' || nextStatus === 'completed' || nextStatus === 'blocked' || nextStatus === 'deleted') {
          status = nextStatus;
        }
        continue;
      }
      if (value === 'open' || value === 'in-progress' || value === 'completed' || value === 'blocked' || value === 'deleted') {
        status = value;
        continue;
      }
      if (value.startsWith('priority:')) {
        const prio = value.slice('priority:'.length);
        if (prio === 'low' || prio === 'medium' || prio === 'high' || prio === 'critical') {
          priority = prio;
        }
        continue;
      }
      if (value.startsWith('tag:')) {
        const tag = value.slice('tag:'.length);
        if (tag) {
          tags.push(tag);
        }
      }
      continue;
    }
    tags.push(label);
  }

  return { status, priority, tags: Array.from(new Set(tags)) };
}

export function createGithubIssue(config: GithubConfig, payload: { title: string; body: string; labels: string[] }): GithubIssueRecord {
  const command = `gh issue create --repo ${config.repo} --title ${JSON.stringify(payload.title)} --body-file -`;
  const output = runGh(command, payload.body);
  let issueNumber: number | null = null;
  const match = output.match(/\/(\d+)$/);
  if (match) {
    issueNumber = parseInt(match[1], 10);
  }
  if (issueNumber !== null && payload.labels.length > 0) {
    ensureGithubLabels(config, payload.labels);
    runGh(`gh issue edit ${issueNumber} --repo ${config.repo} --add-label ${JSON.stringify(payload.labels.join(','))}`);
  }
  if (issueNumber === null) {
    const view = runGh(`gh issue list --repo ${config.repo} --limit 1 --json number,id,title,body,state,labels,updatedAt`);
    const parsed = JSON.parse(view) as any[];
    if (parsed.length > 0) {
      return normalizeGithubIssue(parsed[0]);
    }
    throw new Error('Failed to create GitHub issue');
  }
  const view = runGh(`gh issue view ${issueNumber} --repo ${config.repo} --json number,id,title,body,state,labels,updatedAt`);
  const parsed = JSON.parse(view) as any;
  return normalizeGithubIssue(parsed);
}

export function updateGithubIssue(
  config: GithubConfig,
  issueNumber: number,
  payload: { title: string; body: string; labels: string[]; state: 'open' | 'closed' }
): GithubIssueRecord {
  const command = `gh issue edit ${issueNumber} --repo ${config.repo} --title ${JSON.stringify(payload.title)} --body-file -`;
  runGh(command, payload.body);

  if (payload.state === 'closed') {
    runGh(`gh issue close ${issueNumber} --repo ${config.repo}`);
  } else {
    runGh(`gh issue reopen ${issueNumber} --repo ${config.repo}`);
  }

  if (payload.labels.length > 0) {
    const normalizedPrefix = normalizeGithubLabelPrefix(config.labelPrefix);
    const desiredStatusLabel = payload.labels.find(label => label.startsWith(`${normalizedPrefix}status:`)) || null;
    const current = getGithubIssue(config, issueNumber);
    const statusLabelsToRemove = current.labels.filter(label => isStatusLabel(label, config.labelPrefix) && label !== desiredStatusLabel);
    if (statusLabelsToRemove.length > 0) {
      runGhSafe(`gh issue edit ${issueNumber} --repo ${config.repo} --remove-label ${JSON.stringify(statusLabelsToRemove.join(','))}`);
    }

    ensureGithubLabels(config, payload.labels);
    const labelsCommand = `gh issue edit ${issueNumber} --repo ${config.repo} --add-label ${JSON.stringify(payload.labels.join(','))}`;
    runGh(labelsCommand);
  }

  const output = runGh(`gh issue view ${issueNumber} --repo ${config.repo} --json number,id,title,body,state,labels,updatedAt`);
  const parsed = JSON.parse(output) as any;
  return normalizeGithubIssue(parsed);
}

export function listGithubIssues(config: GithubConfig, since?: string): GithubIssueRecord[] {
  const sinceParam = since ? `&since=${encodeURIComponent(since)}` : '';
  const apiPath = `repos/${config.repo}/issues?state=all&per_page=100${sinceParam}`;
  const apiCommand = `gh api ${quoteShellValue(apiPath)} --paginate`;
  const output = runGh(apiCommand);
  const parsed = JSON.parse(output) as any[];
  const issuesOnly = parsed.filter(entry => {
    if (entry.pull_request) {
      return false;
    }
    if (typeof entry.html_url === 'string' && entry.html_url.includes('/pull/')) {
      return false;
    }
    if (typeof entry.pull_request_url === 'string' && entry.pull_request_url.length > 0) {
      return false;
    }
    return true;
  });
  return issuesOnly.map(entry =>
    normalizeGithubIssue({
      id: entry.id,
      number: entry.number,
      title: entry.title,
      body: entry.body,
      state: entry.state,
      labels: entry.labels || [],
      updatedAt: entry.updated_at,
      subIssuesSummary: entry.sub_issues_summary
        ? {
            total: entry.sub_issues_summary.total ?? 0,
            completed: entry.sub_issues_summary.completed ?? 0,
          }
        : undefined,
    })
  );
}

export function getGithubIssue(config: GithubConfig, issueNumber: number): GithubIssueRecord {
  const command = `gh issue view ${issueNumber} --repo ${config.repo} --json number,id,title,body,state,labels,updatedAt`;
  const output = runGh(command);
  const parsed = JSON.parse(output) as any;
  return normalizeGithubIssue(parsed);
}

function normalizeGithubIssue(raw: any): GithubIssueRecord {
  const stateRaw = typeof raw.state === 'string' ? raw.state.toLowerCase() : '';
  return {
    id: raw.id,
    number: raw.number,
    title: raw.title ?? '',
    body: raw.body ?? null,
    state: stateRaw === 'closed' ? 'closed' : 'open',
    labels: Array.isArray(raw.labels) ? raw.labels.map((l: any) => l.name || l) : [],
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
    subIssuesSummary: raw.subIssuesSummary,
  };
}
