import { createHash } from 'node:crypto';
import type { JobAidChecklistBinding, JobAidChecklistFeedback } from '@shared/jobaid-checklist.interface';
import type { JobAidSemanticViolation } from '@shared/jobaid-problem-assessment.interface';

/** Implementation identifier, separate from the authored RC1 definition and method versions. */
export const JOBAID_RC1_VALIDATOR_BUILD_REF = 'wiselink.jobaid-checklist-validator.rc1.2';

export function jobAidChecklistFeedback(input: {
  checklistBinding: JobAidChecklistBinding;
  taskRef: string;
  taskBaselineHash: string;
  basedOnWorkItemRevision: number;
  workJson: string;
  violations: JobAidSemanticViolation[];
}): JobAidChecklistFeedback {
  const binding = input.checklistBinding;
  return {
    contractVersion: binding.contractVersion,
    ruleset: { definitionId: binding.definitionId, definitionVersion: binding.definitionVersion,
      definitionContentHash: binding.definitionContentHash, validatorBuildRef: JOBAID_RC1_VALIDATOR_BUILD_REF },
    candidateBinding: { taskRef: input.taskRef, taskBaselineHash: input.taskBaselineHash,
      basedOnWorkItemRevision: input.basedOnWorkItemRevision,
      candidateDigest: 'sha256:' + createHash('sha256').update(input.workJson, 'utf8').digest('hex') },
    checkPhase: 'PRECHECK',
    findings: [
      ...input.violations.map((violation): JobAidChecklistFeedback['findings'][number] => ({
        code: violation.code, ruleId: violation.ruleId ?? null, itemId: violation.itemId ?? null,
        fieldPath: violation.fieldPath ?? null, reason: violation.message,
        checkNature: 'DETERMINISTIC', assessment: 'VIOLATED', disposition: 'BLOCK',
        retryability: 'REPAIRABLE', recoveryScope: 'CANDIDATE',
      })),
      ...binding.definition.ruleCatalog.filter(rule => rule.nature === 'SEMANTIC_RUBRIC')
        .map((rule): JobAidChecklistFeedback['findings'][number] => ({
          code: null, ruleId: rule.ruleId, itemId: null, fieldPath: null, reason: rule.meaning,
          checkNature: 'SEMANTIC_REVIEW', assessment: 'NOT_MACHINE_ASSESSED', disposition: 'REVIEW',
          retryability: 'NONE', recoveryScope: 'CANDIDATE',
        })),
    ],
    semanticNotAssessedByHost: true,
  };
}
