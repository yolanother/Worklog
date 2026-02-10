import { loadStatusStageRules } from '../status-stage-rules.js';

export interface StatusStageValidationRules {
  statusStage?: Record<string, readonly string[]>;
  stageStatus?: Record<string, readonly string[]>;
}

const resolveStatusStageRules = (rules?: StatusStageValidationRules) =>
  rules?.statusStage ?? loadStatusStageRules().statusStageCompatibility;

const resolveStageStatusRules = (rules?: StatusStageValidationRules) =>
  rules?.stageStatus ?? loadStatusStageRules().stageStatusCompatibility;

export const getAllowedStagesForStatus = (
  status?: string,
  rules?: StatusStageValidationRules
): readonly string[] => {
  if (!status) return [];
  const statusStageRules = resolveStatusStageRules(rules);
  return statusStageRules[status] ?? [];
};

export const getAllowedStatusesForStage = (
  stage?: string,
  rules?: StatusStageValidationRules
): readonly string[] => {
  if (stage === undefined) return [];
  const stageStatusRules = resolveStageStatusRules(rules);
  // If a stage has no explicit reverse mapping but the 'deleted' status is configured
  // to allow all stages, we should not surface 'deleted' here unless it's present
  // in the derived stageStatus rules. Return the configured mapping as-is.
  return stageStatusRules[stage] ?? [];
};

export const isStatusStageCompatible = (
  status?: string,
  stage?: string,
  rules?: StatusStageValidationRules
): boolean => {
  if (!status || stage === undefined) return true;
  const allowedStages = getAllowedStagesForStatus(status, rules);
  if (allowedStages.length > 0 && !allowedStages.includes(stage)) return false;
  const allowedStatuses = getAllowedStatusesForStage(stage, rules);
  if (allowedStatuses.length > 0 && !allowedStatuses.includes(status)) return false;
  return true;
};
