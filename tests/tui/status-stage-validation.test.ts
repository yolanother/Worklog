import { describe, it, expect } from 'vitest';
import {
  getAllowedStagesForStatus,
  getAllowedStatusesForStage,
  isStatusStageCompatible,
} from '../../src/tui/status-stage-validation.js';
import { loadStatusStageRules } from '../../src/status-stage-rules.js';

describe('Status/Stage Validation Helper', () => {
  const rulesConfig = loadStatusStageRules();
  const rules = {
    statusStage: rulesConfig.statusStageCompatibility,
    stageStatus: rulesConfig.stageStatusCompatibility,
  };

  it('returns allowed stages for status', () => {
    expect(getAllowedStagesForStatus('open', rules)).toEqual([
      '',
      'idea',
      'prd_complete',
      'plan_complete',
      'in_progress',
    ]);
  });

  it('returns allowed statuses for stage', () => {
    expect(getAllowedStatusesForStage('in_review', rules)).toEqual(['completed']);
  });

  it('accepts valid status/stage pairs', () => {
    expect(isStatusStageCompatible('completed', 'done', rules)).toBe(true);
    expect(isStatusStageCompatible('blocked', 'idea', rules)).toBe(true);
  });

  it('rejects invalid status/stage pairs', () => {
    expect(isStatusStageCompatible('completed', 'idea', rules)).toBe(false);
    expect(isStatusStageCompatible('deleted', 'in_review', rules)).toBe(false);
  });

  it('covers compatibility permutations for all statuses', () => {
    rulesConfig.statusValues.forEach((status) => {
      const allowedStages = new Set(rulesConfig.statusStageCompatibility[status]);
      rulesConfig.stageValues.forEach((stage) => {
        const compatible = isStatusStageCompatible(status, stage, rules);
        if (allowedStages.has(stage)) {
          expect(compatible).toBe(true);
        } else {
          expect(compatible).toBe(false);
        }
      });
    });
  });

  it('matches allowed statuses for each stage', () => {
    rulesConfig.stageValues.forEach((stage) => {
      const expected = [...(rulesConfig.stageStatusCompatibility[stage] ?? [])].sort();
      const actual = [...getAllowedStatusesForStage(stage, rules)].sort();
      expect(actual).toEqual(expected);
    });
  });
});
