import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { JobAidChecklistBinding, JobAidChecklistResult, JobAidChecklistItemId, JobAidMethodUsage,
  JobAidChecklistRuleId } from '@shared/jobaid-checklist.interface';
import type { JobAidProblemIssue, JobAidProblemWorkContent, JobAidSemanticViolationCode } from '@shared/jobaid-problem-assessment.interface';
import { JobAidSemanticValidationError } from './jobaid-semantic-content';

function reject(code: JobAidSemanticViolationCode, path: string, reason: string,
  ruleId: JobAidChecklistRuleId, itemId?: JobAidChecklistItemId): never {
  throw new JobAidSemanticValidationError({ violations: [{ code, fieldPaths: [path], fieldPath: path,
    ruleId, ...(itemId ? { itemId } : {}), message: reason }], omittedViolationCount: 0 });
}
function object(value: unknown, allowed: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key)))
    reject('JOBAID_CHECKLIST_STRUCTURE_INVALID', path, '使用既定字段；候选不可改写 Host 绑定或确认事实。', 'WLCHK.ITEM.STRUCTURE');
  return value as Record<string, unknown>;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim())
    reject('JOBAID_CHECKLIST_STRUCTURE_INVALID', path, '需要非空字符串。', 'WLCHK.ITEM.STRUCTURE');
  return value;
}
function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value))
    reject('JOBAID_CHECKLIST_STRUCTURE_INVALID', path, '需要数组。', 'WLCHK.ITEM.STRUCTURE');
  return value;
}
function choice<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T))
    reject('JOBAID_CHECKLIST_STRUCTURE_INVALID', path, '使用已定义枚举。', 'WLCHK.ITEM.STRUCTURE');
  return value as T;
}
function sourceRefs(raw: unknown, path: string, evidence: AssessmentEvidence[], delivered: string[],
  itemId?: JobAidChecklistItemId, currentDelivered?: string[], scalar = false): string[] {
  const refs = list(raw, path).map((value, index) => text(value, `${path}/${index}`));
  if (new Set(refs).size !== refs.length)
    reject('JOBAID_CHECKLIST_STRUCTURE_INVALID', path, '引用不能重复。', 'WLCHK.ITEM.STRUCTURE', itemId);
  const registry = new Map(evidence.map(item => [item.evidenceRef, item]));
  refs.forEach((ref, index) => {
    const item = registry.get(ref);
    if (!item || !delivered.includes(ref) || (item.kind === 'PRIOR_RESULT' && item.sourceStatement &&
        (item.originalEvidenceRefs.some(root => !registry.has(root) || !delivered.includes(root)) ||
        (currentDelivered && [ref, ...item.originalEvidenceRefs].some(root => !currentDelivered.includes(root))))))
      reject('JOBAID_CHECKLIST_SOURCE_NOT_DELIVERED', scalar ? path : `${path}/${index}`,
        '只能引用本任务获授权且实际交付的来源及其准确上下文。', 'WLCHK.SOURCE.REGISTERED_REFERENCE', itemId);
  });
  return refs;
}

export function parseJobAidMethodUsage(raw: unknown, issueIndex: number, evidence: AssessmentEvidence[],
  delivered: string[]): JobAidMethodUsage[] {
  const path = `/issues/${issueIndex}/methodUsage`;
  const seen = new Set<string>();
  return list(raw === undefined ? [] : raw, path).map((value, index) => {
    const p = `${path}/${index}`;
    const row = object(value, ['methodRef', 'usage', 'basisRefs'], p);
    const methodRef = sourceRefs([row.methodRef], `${p}/methodRef`, evidence, delivered, undefined, undefined, true)[0];
    if (seen.has(methodRef) || !evidence.some(item => item.evidenceRef === methodRef && item.kind === 'METHOD_CLAUSE'))
      reject('JOBAID_METHOD_USAGE_INVALID', `${p}/methodRef`,
        '同一问题按真实 METHOD_CLAUSE evidenceRef 唯一归并用途。', 'WLCHK.METHOD.KNOWN_RULE', 'ENG-METHOD-01');
    seen.add(methodRef);
    return { methodRef,
      usage: choice(row.usage, ['REFERENCE_ONLY', 'APPLIED', 'UNDETERMINED'] as const, `${p}/usage`),
      basisRefs: sourceRefs(row.basisRefs, `${p}/basisRefs`, evidence, delivered, 'ENG-METHOD-01') };
  });
}

/** The existing whitelist already rejects these fields. RC1 adds exact repair metadata only. */
export function assertJobAidCandidateMeasureFields(raw: unknown, path: string): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return; // Original shape error remains authoritative.
  const allowed = ['text', 'addresses', 'limitations', 'status', 'basisRefs'];
  const field = Object.keys(raw).find(key => !allowed.includes(key));
  if (field !== undefined) reject('JOBAID_CHECKLIST_AUTHORITY_FIELD_FORBIDDEN',
    `${path}/${field.replace(/~/gu, '~0').replace(/\//gu, '~1')}`,
    '仅接受既有候选措施字段；候选不得提交确认人、确认时间、批准或权威实施事实字段。',
    'WLCHK.AUTHORITY.NO_PROMOTION', 'ENG-STATUS-01');
}

function resolveResult(issue: JobAidProblemIssue | undefined, pointer: string): boolean {
  if (!issue || !/^\/(body|question|riskScenarios|measures|otherClassifications|openQuestions|requirementHandling)(\/.*)?$/u.test(pointer)) return false;
  let value: unknown = issue;
  for (const token of pointer.slice(1).split('/')) {
    if (/~(?![01])/u.test(token)) return false;
    const key = token.replace(/~1/gu, '/').replace(/~0/gu, '~');
    if (Array.isArray(value) && (!/^(0|[1-9][0-9]*)$/u.test(key) ||
        !Number.isSafeInteger(Number(key)) || Number(key) >= value.length)) return false;
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key) ||
        ['__proto__', 'prototype', 'constructor'].includes(key)) return false;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === 'string' ? !!value.trim() : Array.isArray(value) ? value.length > 0 : value != null;
}

/** Work-level references are checked after merging issue updates and retirements. */
export function parseJobAidChecklistResults(raw: unknown, binding: JobAidChecklistBinding,
  issues: JobAidProblemIssue[], roundCompletion: JobAidProblemWorkContent['roundCompletion'],
  evidence: AssessmentEvidence[], delivered: string[], currentDelivered?: string[]): JobAidChecklistResult[] {
  const seen = new Set<string>();
  const results = list(raw, '/checklistResults').map((value, index): JobAidChecklistResult => {
    const p = `/checklistResults/${index}`;
    const row = object(value, ['itemId', 'itemApplicability', 'outcome', 'resultRefs', 'basisRefs'], p);
    const itemId = choice(row.itemId, binding.definition.items.map(item => item.itemId), `${p}/itemId`);
    const selection = binding.selection.find(item => item.itemId === itemId)!;
    if (seen.has(itemId)) reject('JOBAID_CHECKLIST_STRUCTURE_INVALID', `${p}/itemId`,
      '每个稳定 itemId 只提交一条工作级结果。', 'WLCHK.ITEM.STRUCTURE', itemId);
    seen.add(itemId);
    const itemApplicability = choice(row.itemApplicability, ['APPLICABLE', 'NOT_APPLICABLE', 'UNDETERMINED'] as const, `${p}/itemApplicability`);
    const outcome = choice(row.outcome, ['ANSWERED', 'OPEN', 'CONFLICT', 'DEFERRED'] as const, `${p}/outcome`);
    if ((selection.mode === 'INCLUDE' && itemApplicability !== 'APPLICABLE') ||
        (itemApplicability === 'UNDETERMINED' && !['OPEN', 'CONFLICT'].includes(outcome)) ||
        !binding.acceptance.allowedSavedOutcomes.includes(outcome) ||
        (outcome === 'DEFERRED' && !binding.acceptance.allowedDeferredItemIds.includes(itemId)))
      reject('JOBAID_CHECKLIST_OUTCOME_INVALID', p, '保留核心项、未知和本轮允许延期的准确边界。', 'WLCHK.SCOPE.COVERAGE', itemId);
    const resultRefs = list(row.resultRefs, `${p}/resultRefs`).map((entry, refIndex) => {
      const rp = `${p}/resultRefs/${refIndex}`;
      const ref = object(entry, ['issueKey', 'fieldPath'], rp);
      const issueKey = text(ref.issueKey, `${rp}/issueKey`);
      const fieldPath = text(ref.fieldPath, `${rp}/fieldPath`);
      if (!resolveResult(issues.find(issue => issue.issueKey === issueKey), fieldPath))
        reject('JOBAID_CHECKLIST_RESULT_REF_INVALID', rp, '引用必须指向合并后仍存在的问题及非空内容；退役和旧数组位置不可冒用。', 'WLCHK.ITEM.STRUCTURE', itemId);
      return { issueKey, fieldPath };
    });
    if (!resultRefs.length) reject('JOBAID_CHECKLIST_RESULT_REF_INVALID', `${p}/resultRefs`,
      '用原问题正文说明回答、触发判断或具体未决，不复制另一份正文。', 'WLCHK.SCOPE.COVERAGE', itemId);
    if (['OPEN', 'CONFLICT'].includes(outcome) && (roundCompletion === 'COMPLETE' ||
        (roundCompletion !== 'IN_PROGRESS' && !binding.acceptance.allowedCompletionWithOpenItemIds.includes(itemId)) ||
        !resultRefs.some(ref => issues.find(issue => issue.issueKey === ref.issueKey)!.openQuestions.length)))
      reject('JOBAID_CHECKLIST_OPEN_QUESTION_REQUIRED', p,
        '关联问题须说明具体未决及影响；OPEN/CONFLICT 不自动完成任务。', 'WLCHK.SCOPE.COVERAGE', itemId);
    return { itemId, itemApplicability, outcome, resultRefs,
      basisRefs: sourceRefs(row.basisRefs, `${p}/basisRefs`, evidence, delivered, itemId, currentDelivered) };
  });
  for (const selection of binding.selection) if (selection.mode !== 'EXCLUDE_OPTIONAL' && !seen.has(selection.itemId))
    reject('JOBAID_CHECKLIST_COVERAGE_REQUIRED', '/checklistResults',
      '每个纳入或条件性条目须给出回答或触发判断；不能省略未知。', 'WLCHK.SCOPE.COVERAGE', selection.itemId);
  return results;
}
