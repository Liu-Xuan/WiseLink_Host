import { isEqual } from 'es-toolkit';
import { readJobAidWorkCorrection, saveJobAidWorkCorrection,
  type CanonicalHostClientError, type CanonicalHostIdentityContext } from '@client/src/api/canonical-host';
import type { JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import {
  JOBAID_WORK_CORRECTION_RECEIPT_SCHEMA,
  JOBAID_WORK_CORRECTION_SCHEMA,
  type JobAidWorkCorrectionChange,
  type JobAidWorkCorrectionReceipt,
  type JobAidWorkCorrectionRequest,
} from '@shared/jobaid-work-correction.interface';

/** Only receipt identity survives reload. The exact command stays in live component memory. */
type JobAidCorrectionRequestIdentity = Pick<JobAidWorkCorrectionRequest,
  'schemaVersion' | 'requestId' | 'baseWorkRef' | 'baseWorkRevision' | 'expectedWorkItemRevision'>;
export interface PendingJobAidCorrection {
  workItemId: string;
  documentVersionId: string;
  request: JobAidCorrectionRequestIdentity;
  command?: JobAidWorkCorrectionRequest;
}
export interface JobAidCorrectionDraft {
  issueKey: string;
  body: string;
  severityReasons: string[];
  reason: string;
  contribution: '' | 'ENGINEER' | 'AI_ASSISTED';
  evidenceRefs: string[];
}

export function jobAidCorrectionStorageKey(identity: CanonicalHostIdentityContext, workItemId: string): string {
  return `wiselink:jobaid-correction:${JSON.stringify([identity.tenantId, identity.userId, workItemId])}`;
}

export function readPendingJobAidCorrection(key: string): PendingJobAidCorrection | null {
  const raw: string | null = window.sessionStorage.getItem(key);
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || typeof value.workItemId !== 'string' ||
    typeof value.documentVersionId !== 'string' || !isRecord(value.request) ||
    value.request.schemaVersion !== JOBAID_WORK_CORRECTION_SCHEMA ||
    typeof value.request.requestId !== 'string' || typeof value.request.baseWorkRef !== 'string' ||
    typeof value.request.baseWorkRevision !== 'number' || !Number.isSafeInteger(value.request.baseWorkRevision) ||
    typeof value.request.expectedWorkItemRevision !== 'number' || !Number.isSafeInteger(value.request.expectedWorkItemRevision))
    throw new Error('本标签页的待核对更正记录无法读取；本次未发送新请求。');
  return { workItemId: value.workItemId, documentVersionId: value.documentVersionId,
    request: { schemaVersion: JOBAID_WORK_CORRECTION_SCHEMA, requestId: value.request.requestId,
      baseWorkRef: value.request.baseWorkRef, baseWorkRevision: value.request.baseWorkRevision,
      expectedWorkItemRevision: value.request.expectedWorkItemRevision } };
}

export function writePendingJobAidCorrection(key: string, pending: PendingJobAidCorrection | null): void {
  if (!pending) { window.sessionStorage.removeItem(key); return; }
  const request: JobAidCorrectionRequestIdentity = correctionRequestIdentity(pending.request);
  window.sessionStorage.setItem(key, JSON.stringify({ workItemId: pending.workItemId,
    documentVersionId: pending.documentVersionId, request }));
}

function correctionRequestIdentity(request: JobAidCorrectionRequestIdentity): JobAidCorrectionRequestIdentity {
  return { schemaVersion: request.schemaVersion, requestId: request.requestId,
    baseWorkRef: request.baseWorkRef, baseWorkRevision: request.baseWorkRevision,
    expectedWorkItemRevision: request.expectedWorkItemRevision };
}

export function jobAidCorrectionEvidence(work: JobAidWorkRevision) {
  const delivered: Set<string> = new Set(work.content.readSourceRefs);
  return work.content.evidence.filter((item) => delivered.has(item.evidenceRef));
}

export function prepareJobAidCorrection(
  work: JobAidWorkRevision,
  workItemRevision: number,
  draft: JobAidCorrectionDraft,
  requestId: string,
): PendingJobAidCorrection {
  const issue = work.content.issues.find((item) => item.issueKey === draft.issueKey);
  if (!issue || work.content.historicalSourceSchema || !Number.isSafeInteger(workItemRevision) || workItemRevision < 1)
    throw new Error('当前工作版本无法更正，请重新读取。');
  const reason: string = draft.reason.trim();
  if (!reason || !draft.contribution) throw new Error('请填写更正理由并选择实际贡献方式。');
  const available: Set<string> = new Set(jobAidCorrectionEvidence(work).map((item) => item.evidenceRef));
  if (!draft.evidenceRefs.length || draft.evidenceRefs.length > 200 || draft.evidenceRefs.some((ref) => !available.has(ref)))
    throw new Error('请选择本工作已登记并实际读过的依据。');
  const attribution: string = draft.contribution === 'AI_ASSISTED' ? 'AI 整理，经本人核对' : '工程师撰写';
  const recordedReason: string = `贡献方式：${attribution}。基于本工作已登记依据整理，本次更正未正式采用。\n更正理由：${reason}`;
  if (recordedReason.length > 4000) throw new Error('更正理由过长，请缩短后保存。');
  const changes: JobAidWorkCorrectionChange[] = [];
  const text = { issueKey: issue.issueKey, issueRef: issue.issueRef,
    reason: recordedReason, evidenceRefs: [...new Set(draft.evidenceRefs)] };
  const body: string = draft.body.trim();
  if (body !== issue.body) changes.push({ ...text, field: 'ISSUE_BODY', expectedOldValue: issue.body, newValue: body });
  issue.riskScenarios.forEach((scenario, index) => {
    if (!scenario.severity) return;
    const newValue: string = (draft.severityReasons[index] ?? scenario.severity.reason).trim();
    if (newValue !== scenario.severity.reason) changes.push({ ...text, field: 'RISK_SEVERITY_REASON',
      scenarioIndex: index, expectedScenario: structuredClone(scenario),
      expectedOldValue: scenario.severity.reason, newValue });
  });
  if (!changes.length) throw new Error('文案尚未变化。');
  if (changes.length > 20 || changes.some((change) => !change.newValue || change.newValue.length > 1_000_000))
    throw new Error('请保留完整正文与理由；单次最多更正 20 处。');
  const refs: Set<string> = new Set(text.evidenceRefs);
  for (const change of changes) {
    const marked: string = `${change.newValue}\n${change.reason}`;
    const stripped: string = marked.replace(/\[\[([^\[\]\r\n]+)\]\]/gu, '');
    if (stripped.includes('[[') || stripped.includes(']]') ||
      [...marked.matchAll(/\[\[([^\[\]\r\n]+)\]\]/gu)].some((match) => !refs.has(match[1])))
      throw new Error('正文和理由的引文必须来自所选依据，并保留完整的双中括号。');
  }
  const command: JobAidWorkCorrectionRequest = { schemaVersion: JOBAID_WORK_CORRECTION_SCHEMA, requestId,
    baseWorkRef: work.workRevisionRef, baseWorkRevision: work.workRevision,
    expectedWorkItemRevision: workItemRevision, changes };
  return { workItemId: work.workItemId, documentVersionId: work.documentVersionId,
    request: correctionRequestIdentity(command), command };
}

/** An unrelated latest-work response must never stand in for this immutable receipt. */
export function assertJobAidCorrectionReceipt(pending: PendingJobAidCorrection, receipt: JobAidWorkCorrectionReceipt): void {
  const request: JobAidCorrectionRequestIdentity = pending.request;
  const command: JobAidWorkCorrectionRequest | undefined = pending.command;
  const work: JobAidWorkRevision | undefined = receipt?.work;
  const changed = command?.changes.filter((item) => item.newValue !== item.expectedOldValue);
  if (!work || receipt.schemaVersion !== JOBAID_WORK_CORRECTION_RECEIPT_SCHEMA ||
    receipt.requestId !== request.requestId || receipt.workItemId !== pending.workItemId ||
    receipt.baseWorkRef !== request.baseWorkRef || receipt.baseWorkRevision !== request.baseWorkRevision ||
    receipt.workItemRevision !== request.expectedWorkItemRevision || receipt.executionKind !== 'HOST_MANUAL_CORRECTION' ||
    receipt.modelRequests !== 0 || receipt.semanticReanalysisPerformed !== false ||
    receipt.adopted !== false || receipt.candidateCarrierAdvanced !== false ||
    !receipt.executionAttemptId || work.workItemId !== pending.workItemId ||
    work.documentVersionId !== pending.documentVersionId || work.workRevisionRef !== receipt.workRevisionRef ||
    work.workRevision !== receipt.workRevision || !Array.isArray(receipt.changedFields) ||
    (command && !isEqual(correctionRequestIdentity(command), request)) ||
    (changed && !isEqual(receipt.changedFields, changed.map((item) => ({
      field: item.field, issueKey: item.issueKey, issueRef: item.issueRef,
      ...(item.field === 'RISK_SEVERITY_REASON' ? { scenarioIndex: item.scenarioIndex } : {}),
    }))))) throw new Error('更正回执与原请求不一致，请核对同一请求的保存结果。');
  if (receipt.status === 'SAVED' ? !receipt.changedFields.length || work.requestId !== request.requestId ||
    work.actionAttemptId !== receipt.executionAttemptId || work.previousWorkRevisionRef !== request.baseWorkRef ||
    work.workRevision !== request.baseWorkRevision + 1 || work.basedOnWorkItemRevision !== request.expectedWorkItemRevision
    : receipt.status !== 'UNCHANGED' || (changed && changed.length !== 0) || work.workRevisionRef !== request.baseWorkRef)
    throw new Error('尚未读回准确的更正工作版本，请继续核对原请求。');
  for (const change of command?.changes ?? []) {
    const issue = work.content.issues.find((item) => item.issueKey === change.issueKey && item.issueRef === change.issueRef);
    if (!issue) throw new Error('更正回执缺少原问题，请继续核对原请求。');
    if (change.field === 'ISSUE_BODY') {
      if (issue.body !== change.newValue) throw new Error('正文读回不一致，请继续核对原请求。');
    } else {
      const scenario = structuredClone(change.expectedScenario);
      if (!scenario.severity) throw new Error('原情景缺少严重性理由。');
      scenario.severity.reason = change.newValue;
      if (!isEqual(issue.riskScenarios[change.scenarioIndex], scenario))
        throw new Error('情景读回不一致，请继续核对原请求。');
    }
  }
}

export function isJobAidCorrectionMissing(caught: unknown): boolean {
  const failure = caught as CanonicalHostClientError | null;
  return failure?.statusCode === 404 && failure.code === 'JOBAID_CORRECTION_REQUEST_NOT_FOUND';
}

/** These codes are thrown before the save transaction can commit, never at post-commit readback. */
export function isDefiniteJobAidCorrectionRejection(caught: unknown): boolean {
  return ['JOBAID_CORRECTION_REQUEST_INVALID', 'JOBAID_CORRECTION_WORK_ITEM_INVALID',
    'JOBAID_CORRECTION_CITATION_MALFORMED', 'JOBAID_CORRECTION_DUPLICATE_TARGET',
    'JOBAID_CORRECTION_EVIDENCE_NOT_DELIVERED', 'JOBAID_CORRECTION_WORK_ITEM_CONFLICT',
    'JOBAID_CORRECTION_ACTIVE_EXECUTION', 'JOBAID_CORRECTION_BASE_CONFLICT',
    'JOBAID_CORRECTION_CURRENT_V3_REQUIRED', 'JOBAID_CORRECTION_ISSUE_CONFLICT',
    'JOBAID_CORRECTION_SCENARIO_CONFLICT', 'JOBAID_CORRECTION_OLD_VALUE_CONFLICT',
    'JOBAID_CORRECTION_PROTECTED_FIELD_CHANGED'].includes((caught as CanonicalHostClientError | null)?.code ?? '');
}

export function jobAidCorrectionFailureMessage(caught: unknown): string {
  const failure = caught as CanonicalHostClientError | null;
  if ([401, 403, 404].includes(failure?.statusCode ?? 0) && !isJobAidCorrectionMissing(caught))
    return '当前身份无法操作此事项，请重新核对登录和访问权限。';
  if (failure?.code === 'JOBAID_CORRECTION_ACTIVE_EXECUTION') return '本事项正在分析，待本轮结束并重新读取后再更正。';
  if (isDefiniteJobAidCorrectionRejection(caught)) return '本次更正未保存，版本或依据已变化，请重新读取后核对。';
  return '保存结果尚未确认，请核对原请求；重试会沿用同一请求。';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export type JobAidCorrectionResolution =
  | { receipt: JobAidWorkCorrectionReceipt; rejected: false; missing: false }
  | { error: unknown; rejected: boolean; missing: boolean };

/** A timeout or post-commit readback failure is recovered by exact request id. */
export async function resolveJobAidCorrection(
  pending: PendingJobAidCorrection,
  action: 'READ' | 'SEND' | 'RETRY',
  isCurrent: () => boolean,
): Promise<JobAidCorrectionResolution> {
  const read = () => readJobAidWorkCorrection(pending.workItemId, pending.request.requestId);
  const confirmed = (receipt: JobAidWorkCorrectionReceipt): JobAidCorrectionResolution => {
    assertJobAidCorrectionReceipt(pending, receipt);
    return { receipt, rejected: false, missing: false };
  };
  if (action !== 'SEND') {
    try { return confirmed(await read()); }
    catch (error: unknown) {
      if (action === 'READ' || !pending.command || !isJobAidCorrectionMissing(error) || !isCurrent())
        return { error, rejected: false, missing: isJobAidCorrectionMissing(error) };
    }
  }
  if (!isCurrent() || !pending.command)
    return { error: new Error('原提交内容已不在本标签页内存中，请继续核对原请求回执。'), rejected: false, missing: false };
  try { return confirmed(await saveJobAidWorkCorrection(pending.workItemId, pending.command)); }
  catch (postError: unknown) {
    if (!isCurrent()) return { error: postError, rejected: false, missing: false };
    try { return confirmed(await read()); }
    catch (readError: unknown) {
      const missing: boolean = isJobAidCorrectionMissing(readError);
      const rejected: boolean = missing && isDefiniteJobAidCorrectionRejection(postError);
      return { error: rejected ? postError : readError, rejected, missing };
    }
  }
}
