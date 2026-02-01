import type { WorkItemStatus } from '../types.js';

export const WORK_ITEM_STATUSES = [
  'open',
  'in-progress',
  'blocked',
  'completed',
  'deleted',
] as const satisfies readonly WorkItemStatus[];

export const WORK_ITEM_STAGES = [
  '',
  'idea',
  'prd_complete',
  'plan_complete',
  'in_progress',
  'in_review',
  'done',
] as const;

export const STATUS_STAGE_COMPATIBILITY: Record<WorkItemStatus, readonly string[]> = {
  open: ['', 'idea', 'prd_complete', 'plan_complete', 'in_progress'],
  'in-progress': ['in_progress'],
  blocked: ['', 'idea', 'prd_complete', 'plan_complete', 'in_progress'],
  completed: ['in_review', 'done'],
  deleted: [''],
};

export const STAGE_STATUS_COMPATIBILITY: Record<string, WorkItemStatus[]> =
  Object.fromEntries(
    WORK_ITEM_STAGES.map(stage => [stage, [] as WorkItemStatus[]])
  ) as Record<string, WorkItemStatus[]>;

for (const status of WORK_ITEM_STATUSES) {
  for (const stage of STATUS_STAGE_COMPATIBILITY[status]) {
    STAGE_STATUS_COMPATIBILITY[stage].push(status);
  }
}

export const STATUS_STAGE_RULE_NOTES = [
  "Stage '' represents an undefined/blank stage (default on create, imports).",
  "Close dialog sets status=completed with stage in_review/done and status=deleted with stage ''.",
  "Status blocked can pair with active stages (idea/prd/plan/in_progress) or blank stage.",
  "Status in-progress aligns to stage in_progress.",
];
