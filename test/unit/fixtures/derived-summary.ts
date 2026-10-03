import type { DerivedSummaryReadModel, DerivedSummaryRevision, DerivedSummaryRevisionReadModel } from '@shared/derived-summary.interface';
import type { EngineeringKnowledgeRead } from '@shared/engineering-issue-search.interface';
import { jobAidReadingResult } from '@shared/jobaid-problem-assessment.interface';
import { jobAidReadingFixture } from '../semantic-reading-ui.fixtures';

export function summaryKnowledge(): EngineeringKnowledgeRead {
  const revision = jobAidReadingFixture().current!;
  return { entry: { subjectKind: 'WORK_ITEM', subjectId: revision.workItemId, workRef: revision.workRevisionRef,
    workRevision: revision.workRevision, current: false, headline: revision.content.headline, listBrief: revision.content.listBrief,
    createdAt: revision.createdAt, overviewStatus: revision.content.overviewStatus }, content: revision.content, reading: jobAidReadingResult(revision) };
}
export function summaryRevision(ref = 'DSR-1', revision = 1): DerivedSummaryRevision {
  return { summaryId: 'DS-1', summaryRef: ref, revision,
    scope: { kind: 'ATA4', title: 'B787 ATA46-00 选定资料', fleetFamilyId: 'B787', fleetModelIds: ['B787-9'], ata2: '46', ata4: '46-00', selectionReason: '仅选定资料，未纳入其他 ATA4。' },
    classificationStatus: 'CANDIDATE', candidateOnly: true,
    members: [{ member: { kind: 'WORK_ITEM_WORK', workItemId: 'WI-1', documentVersionId: 'DV-1', workRef: 'JAWR-1', workRevision: 3, issueKeys: ['I1'] },
      evidenceRef: 'MEMBER-1', headline: '确切叶子工作', body: '原问题正文', issues: [], evidence: [], rootRefs: ['ROOT-1'], limitations: ['构型待核'], current: false, overviewStatus: 'STALE', leaves: [] }],
    content: { headline: `概述 ${ref}`, listBrief: '有限概述', body: `确切正文 ${ref}`, limitations: ['其他 ATA4 未纳入'] },
    evidence: [], usedEvidenceRefs: ['MEMBER-1'], coverage: [{ member: { kind: 'WORK_ITEM_WORK', workItemId: 'WI-1', documentVersionId: 'DV-1', workRef: 'JAWR-1', workRevision: 3, issueKeys: ['I1'] },
      evidenceRef: 'MEMBER-1', delivered: true, used: true, rootRefs: ['ROOT-1'], limitation: '仅覆盖选定问题' }],
    requestId: 'REQ-1', attemptRef: 'AQ-1', createdAt: '2026-10-03T00:00:00Z' };
}
export function summaryHead(): DerivedSummaryReadModel {
  const current = summaryRevision('DSR-2', 2);
  return { summaryId: current.summaryId, scope: current.scope, classificationStatus: 'CANDIDATE', currentSummaryRef: current.summaryRef,
    currentRevision: current.revision, current, memberNotices: [{ member: current.members[0].member, current: false, limitations: ['当前工作已有新变化，原概述未覆盖'] }] };
}
export function summaryExact(ref = 'DSR-1'): DerivedSummaryRevisionReadModel {
  const revision = summaryRevision(ref);
  return { summaryId: revision.summaryId, currentSummaryRef: 'DSR-2', currentRevision: 2, revision,
    memberNotices: [{ member: revision.members[0].member, current: false, limitations: ['当前工作已有新变化，原概述未覆盖'] }] };
}
