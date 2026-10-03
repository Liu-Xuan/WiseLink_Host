import type {
  CreateDerivedSummaryRequest, DerivedSummaryContent, DerivedSummaryMember,
  DerivedSummaryScopeSelection, RequestDerivedSummaryUpdate,
} from '@shared/derived-summary.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';

export function summaryError(code: string, statusCode = 409): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode });
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).some(key => !keys.includes(key))) throw summaryError('DERIVED_SUMMARY_INPUT_INVALID', 400);
  return value as Record<string, unknown>;
}

export function summaryText(value: unknown, max = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw summaryError('DERIVED_SUMMARY_INPUT_INVALID', 400);
  return value.trim();
}

function texts(value: unknown, allowEmpty = true): string[] {
  if (!Array.isArray(value) || (!allowEmpty && !value.length)) throw summaryError('DERIVED_SUMMARY_INPUT_INVALID', 400);
  const values = value.map(item => summaryText(item, 255));
  if (new Set(values).size !== values.length) throw summaryError('DERIVED_SUMMARY_INPUT_INVALID', 400);
  return values;
}

function revision(value: unknown, allowZero = false): number {
  if (!Number.isSafeInteger(value) || Number(value) < (allowZero ? 0 : 1) || Number(value) >= 2147483647)
    throw summaryError('DERIVED_SUMMARY_INPUT_INVALID', 400);
  return Number(value);
}

function nullableCode(value: unknown, pattern: RegExp): string | null {
  if (value === null) return null;
  const text = summaryText(value, 8);
  if (!pattern.test(text)) throw summaryError('DERIVED_SUMMARY_SCOPE_INVALID', 400);
  return text;
}

export function parseSummaryScope(input: unknown): DerivedSummaryScopeSelection {
  const value = object(input, ['kind', 'title', 'fleetFamilyId', 'fleetModelIds', 'ata2', 'ata4', 'selectionReason']);
  if (!['ATA4', 'ATA2', 'FLEET'].includes(String(value.kind))) throw summaryError('DERIVED_SUMMARY_SCOPE_INVALID', 400);
  const ata2 = nullableCode(value.ata2, /^\d{2}$/u);
  const ata4 = nullableCode(value.ata4, /^\d{2}-\d{2}$/u);
  if ((value.kind === 'ATA4' && (!ata2 || !ata4 || !ata4.startsWith(`${ata2}-`))) ||
    (value.kind === 'ATA2' && (!ata2 || ata4)) || (value.kind === 'FLEET' && (ata2 || ata4)))
    throw summaryError('DERIVED_SUMMARY_SCOPE_INVALID', 400);
  return { kind: value.kind as DerivedSummaryScopeSelection['kind'], title: summaryText(value.title, 240),
    fleetFamilyId: summaryText(value.fleetFamilyId, 96), fleetModelIds: texts(value.fleetModelIds),
    ata2, ata4, selectionReason: summaryText(value.selectionReason) };
}

export function parseSummaryMember(input: unknown): DerivedSummaryMember {
  const value = object(input, ['kind', 'workItemId', 'documentVersionId', 'workRef', 'workRevision',
    'issueKeys', 'matterId', 'summaryId', 'summaryRef', 'summaryRevision']);
  if (value.kind === 'WORK_ITEM_WORK') {
    object(input, ['kind', 'workItemId', 'documentVersionId', 'workRef', 'workRevision', 'issueKeys']);
    return { kind: value.kind, workItemId: summaryText(value.workItemId, 96),
      documentVersionId: summaryText(value.documentVersionId, 96), workRef: summaryText(value.workRef, 96),
      workRevision: revision(value.workRevision), issueKeys: texts(value.issueKeys) };
  }
  if (value.kind === 'MATTER_WORK') {
    object(input, ['kind', 'matterId', 'workRef', 'workRevision', 'issueKeys']);
    return { kind: value.kind, matterId: summaryText(value.matterId, 96), workRef: summaryText(value.workRef, 96),
      workRevision: revision(value.workRevision), issueKeys: texts(value.issueKeys) };
  }
  if (value.kind === 'DERIVED_SUMMARY') {
    object(input, ['kind', 'summaryId', 'summaryRef', 'summaryRevision']);
    return { kind: value.kind, summaryId: summaryText(value.summaryId, 96), summaryRef: summaryText(value.summaryRef, 96),
      summaryRevision: revision(value.summaryRevision) };
  }
  throw summaryError('DERIVED_SUMMARY_MEMBER_INVALID', 400);
}

export function summaryMemberRef(member: DerivedSummaryMember): string {
  if (member.kind === 'DERIVED_SUMMARY') return `DERIVED_SUMMARY:${encodeURIComponent(member.summaryId)}:${encodeURIComponent(member.summaryRef)}`;
  const subject = member.kind === 'WORK_ITEM_WORK' ? member.workItemId : member.matterId;
  const issues = member.issueKeys.length ? `ISSUES:${member.issueKeys.map(encodeURIComponent).sort().join(',')}` : 'ALL_ISSUES';
  return `${member.kind}:${encodeURIComponent(subject)}:${encodeURIComponent(member.workRef)}:${issues}`;
}

export function parseSummaryRequest(input: unknown, update = false): CreateDerivedSummaryRequest | RequestDerivedSummaryUpdate {
  const value = object(input, ['requestId', 'scope', 'members', 'instruction', 'modelRef', ...(update ? ['expectedSummaryRevision'] : [])]);
  if (!Array.isArray(value.members) || !value.members.length) throw summaryError('DERIVED_SUMMARY_MEMBERS_REQUIRED', 400);
  const members = value.members.map(parseSummaryMember);
  if (new Set(members.map(summaryMemberRef)).size !== members.length) throw summaryError('DERIVED_SUMMARY_DUPLICATE_MEMBER', 400);
  const request = { requestId: summaryText(value.requestId, 96), scope: parseSummaryScope(value.scope),
    members, instruction: summaryText(value.instruction), modelRef: summaryText(value.modelRef, 128) };
  return update ? { ...request, expectedSummaryRevision: revision(value.expectedSummaryRevision, true) } : request;
}

export function parseSummaryContent(input: unknown): DerivedSummaryContent {
  const value = object(input, ['headline', 'listBrief', 'body', 'limitations']);
  if (!Array.isArray(value.limitations)) throw summaryError('DERIVED_SUMMARY_CONTENT_INVALID', 400);
  return { headline: summaryText(value.headline, 240), listBrief: summaryText(value.listBrief, 2000),
    body: summaryText(value.body, 1_000_000), limitations: value.limitations.map(item => summaryText(item)) };
}

export function summaryCitations(content: DerivedSummaryContent, allowedRefs: Set<string>): string[] {
  const refs = [...new Set([...`${content.body}\n${content.limitations.join('\n')}`.matchAll(/\[\[([^\]]+)\]\]/gu)]
    .map(match => match[1]!))];
  if (!refs.length || refs.some(ref => !allowedRefs.has(ref))) throw summaryError('DERIVED_SUMMARY_CITATION_INVALID', 400);
  return refs;
}

export function assertSummaryReplay(expected: unknown, actual: unknown): void {
  if (canonicalJson(expected) !== canonicalJson(actual)) throw summaryError('DERIVED_SUMMARY_REQUEST_ID_REUSED');
}
