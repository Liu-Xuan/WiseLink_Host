import type { CanonicalLibraryQuicklookResponse, CanonicalLibraryTasksResponse, CanonicalReferenceMentionPreviewItem, CanonicalRelatedContextPreviewResponse, EngineeringMatterDirectoryResponse } from '@shared/api.interface';
import type { DocumentParsingStatus } from '@shared/document-parsing.interface';
export function documentStatus(id = 'dv-r3'): DocumentParsingStatus {
  return { documentVersionId: id, familyId: 'family-a', documentCode: 'SB-A', documentTitle: `Selected ${id}`,
    normalizedFamily: 'SB', issuerAuthority: 'OEM', businessRevision: 'R3', revisionDate: '2020-02-02',
    sourceGeneratedDate: '2020-02-02', selectedVersionIsCurrent: false, originalFilename: `${id}.pdf`,
    latestRun: null, publishedRun: null, runtimeAvailable: false,
    runtime: { state: 'NOT_CONFIGURED', errorCode: null, lastCompletedAt: null } };
}
export function documentQuicklook(id = 'dv-r3', workItemId = 'wi-r3'): CanonicalLibraryQuicklookResponse {
  return { document: { kind: 'TASK', workItemId, revision: 5, phase: 'ACTIVE', documentId: 'document-a', documentVersionId: id,
    documentCode: 'SB-A', businessRevision: 'R3', sourceGeneratedDate: '2020-02-02', normalizedFamily: 'SB',
    originalFilename: `${id}.pdf`, byteLength: 80, familyId: 'family-a', selectedVersionIsCurrent: false,
    packageRegistered: true, sourceReadability: 'NOT_CHECKED', createdAt: '2020-02-02', updatedAt: '2020-02-02' },
    result: null, fileReadPerformed: false };
}
export function referenceMention(index = 1): CanonicalReferenceMentionPreviewItem {
  return { mentionRef: `mention-ref-${index}`, mentionId: `mention-${index}`, primaryDocumentVersionRef: 'dv-r3',
    mentionSourceRef: `source-${index}`, citationText: 'FTD R3', matchedText: 'See FTD revision 3',
    normalizedIdentity: { documentNumber: 'FTD', title: null, publisher: null }, permissionState: 'AUTHORIZED',
    targetResolution: { status: 'RESOLVED_EXACT', workItemId: 'wi-ftd-r4', documentVersionId: 'ftd-r4',
      canonicalDocumentNumber: 'FTD', businessRevision: 'R4' },
    sourceRefIds: [`source-${index}`], sourceLocators: [], candidateOnly: true,
  } as CanonicalReferenceMentionPreviewItem;
}
export function referencePreview(): CanonicalRelatedContextPreviewResponse {
  return { schemaVersion: 'wiselink.3_1.related_context_preview.v1', status: 'FRESH_READ', mode: 'EXPLICIT_PREVIEW',
    documentVersionId: 'dv-r3', revision: 5, totalMentionCount: 2, mentions: [referenceMention(1), referenceMention(2)],
    snapshot: { snapshotRef: 'receipt-a', workItemRef: 'wi-r3', inputRevision: 5, primaryDocumentVersionRef: 'dv-r3',
      availability: 'AVAILABLE', candidateOnly: true, readOnly: true, includedInAssessmentInput: false },
    authority: { candidateOnly: true, readOnly: true, includedInAssessmentInput: false },
  } as CanonicalRelatedContextPreviewResponse;
}
export function familyPage(): CanonicalLibraryTasksResponse {
  return {scope: 'CURRENT_USER_OWNED_WORK_ITEMS', order: 'CREATED_AT_DESC_WORK_ITEM_ID_DESC', fileReadPerformed: false,
    items: [documentQuicklook().document, {...documentQuicklook('dv-r4', 'wi-r4').document, businessRevision: 'R4', selectedVersionIsCurrent: true}], nextCursor: null};
}
export function mattersPage(): EngineeringMatterDirectoryResponse {
  return { items: ['m1', 'm2', 'm3'].map(matterId => ({matterId, title: matterId, primaryWorkItemId: 'wi-r3',
    createdAt: '2020-02-02', updatedAt: '2020-02-02', currentMatterRevisionId: `rev-${matterId}`, workingRevision: 2, result: null})),
    nextCursor: null, fileReadPerformed: false };
}
