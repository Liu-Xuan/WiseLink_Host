import type { DerivedSummaryMember, DerivedSummaryScopeSelection } from '@shared/derived-summary.interface';
import type { EngineeringKnowledgeRead } from '@shared/engineering-issue-search.interface';

export const summaryMemberKey = (member: DerivedSummaryMember): string => member.kind === 'DERIVED_SUMMARY'
  ? JSON.stringify([member.kind, member.summaryId, member.summaryRef])
  : JSON.stringify([member.kind, member.kind === 'WORK_ITEM_WORK' ? member.workItemId : member.matterId,
    member.kind === 'WORK_ITEM_WORK' ? member.documentVersionId : null, member.workRef, member.workRevision, member.issueKeys]);

export function memberFromKnowledge(read: EngineeringKnowledgeRead, issueKeys: string[]): DerivedSummaryMember {
  const keys = [...new Set(issueKeys)];
  if (!keys.length || keys.some(key => !read.content.issues.some(issue => issue.issueKey === key))) throw new Error('请选择这份确切保存工作中的问题。');
  if (read.entry.subjectKind === 'ENGINEERING_MATTER') return { kind: 'MATTER_WORK', matterId: read.entry.subjectId,
    workRef: read.entry.workRef, workRevision: read.entry.workRevision, issueKeys: keys };
  const scope = read.reading?.scope;
  if (scope?.kind !== 'WORK_ITEM' || scope.workItemId !== read.entry.subjectId || !scope.documentVersionId)
    throw new Error('保存工作的文档版本身份未能读回，不能加入概述。');
  return { kind: 'WORK_ITEM_WORK', workItemId: scope.workItemId, documentVersionId: scope.documentVersionId,
    workRef: read.entry.workRef, workRevision: read.entry.workRevision, issueKeys: keys };
}

export function summaryMemberRoute(member: DerivedSummaryMember): string {
  if (member.kind === 'DERIVED_SUMMARY') return `/summaries/${encodeURIComponent(member.summaryId)}?${new URLSearchParams({ summaryRef: member.summaryRef })}`;
  return `/knowledge?${new URLSearchParams({ subjectKind: member.kind === 'WORK_ITEM_WORK' ? 'WORK_ITEM' : 'ENGINEERING_MATTER',
    subjectId: member.kind === 'WORK_ITEM_WORK' ? member.workItemId : member.matterId, workRef: member.workRef })}`;
}

export function summaryScopeError(scope: DerivedSummaryScopeSelection, members: DerivedSummaryMember[]): string | null {
  if (!scope.title.trim() || !scope.fleetFamilyId.trim() || !scope.selectionReason.trim()) return '请填写范围标题、父机型与选取理由。';
  if (scope.title.length > 240 || scope.fleetFamilyId.length > 96 || scope.selectionReason.length > 4000) return '范围字段超出允许长度，请缩短后提交。';
  if (!members.length) return '请明确加入至少一份确切保存工作或子概述。';
  if (scope.kind !== 'FLEET' && !/^\d{2}$/u.test(scope.ata2 ?? '')) return '请选择两位 ATA2 范围。';
  if (scope.kind === 'ATA4' && (!/^\d{2}-\d{2}$/u.test(scope.ata4 ?? '') || !scope.ata4?.startsWith(`${scope.ata2}-`))) return 'ATA4 需为与 ATA2 一致的四位范围，如 46-00。';
  return null;
}

export function scopeFromParams(params: URLSearchParams): DerivedSummaryScopeSelection {
  const kind = params.get('kind') === 'ATA2' ? 'ATA2' : params.get('kind') === 'FLEET' ? 'FLEET' : 'ATA4';
  return { kind, title: params.get('title') ?? '', fleetFamilyId: params.get('fleetFamilyId') ?? '',
    fleetModelIds: params.getAll('fleetModelId'), ata2: kind === 'FLEET' ? null : params.get('ata2'),
    ata4: kind === 'ATA4' ? params.get('ata4') : null, selectionReason: '' };
}

export function upperSummaryRoute(id: string, ref: string, scope: DerivedSummaryScopeSelection): string {
  const params = new URLSearchParams({ kind: scope.kind === 'ATA4' ? 'ATA2' : 'FLEET',
    fleetFamilyId: scope.fleetFamilyId, fromSummaryId: id, fromSummaryRef: ref });
  scope.fleetModelIds.forEach(model => params.append('fleetModelId', model));
  if (scope.kind === 'ATA4' && scope.ata2) params.set('ata2', scope.ata2);
  return `/summaries/new?${params}`;
}
