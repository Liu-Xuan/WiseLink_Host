import type {
  CanonicalLibraryDocumentSummary,
  CanonicalLibraryDocumentsResponse,
  CanonicalLibraryTasksResponse,
  CanonicalLibraryWorkItemSummary,
  CanonicalLibraryQuicklookResponse,
  CanonicalSourceBoundEngineeringStatement,
} from '@shared/api.interface';

export function libraryDocument(
  workItemId: string,
): CanonicalLibraryWorkItemSummary {
  return {
    kind: 'TASK',
    workItemId,
    revision: 4,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    documentId: `DOC-${workItemId}`,
    documentVersionId: `DV-${workItemId}`,
    documentCode: '737-34-3830',
    businessRevision: 'Original Issue',
    normalizedFamily: 'SB',
    originalFilename: '737-34-3830.pdf',
    byteLength: 273349,
    familyId: '737',
    selectedVersionIsCurrent: true,
    packageRegistered: true,
    sourceReadability: 'NOT_CHECKED',
    createdAt: '2026-09-05T09:00:00.000Z',
    updatedAt: '2026-09-06T09:00:00.000Z',
  };
}

export function libraryTasks(
  ids: string[],
  nextCursor: string | null = null,
): CanonicalLibraryTasksResponse {
  return {
    scope: 'CURRENT_USER_OWNED_WORK_ITEMS',
    order: 'CREATED_AT_DESC_WORK_ITEM_ID_DESC',
    items: ids.map(libraryDocument),
    nextCursor,
    fileReadPerformed: false,
  };
}

export function libraryFamily(
  familyId: string,
): CanonicalLibraryDocumentSummary {
  return {
    kind: 'DOCUMENT',
    familyId,
    documentId: `DOC-${familyId}`,
    documentCode: `SB-${familyId}`,
    normalizedFamily: 'SB',
    issuerAuthority: 'BOEING',
    workItemCount: 3,
    createdAt: '2026-09-05T09:00:00.000Z',
    updatedAt: '2026-09-06T09:00:00.000Z',
    versions: [
      {
        documentVersionId: `DV-${familyId}-2`,
        businessRevision: 'R2',
        revisionDate: '2026-09-02',
        originalFilename: 'new.pdf',
        byteLength: 200,
        committedAt: '2026-09-06T09:00:00.000Z',
        selectedVersionIsCurrent: true,
        readerWorkItemId: 'WI-NEW',
        workItemCount: 2,
      },
      {
        documentVersionId: `DV-${familyId}-1`,
        businessRevision: 'R1',
        revisionDate: '2026-09-01',
        originalFilename: 'old.pdf',
        byteLength: 100,
        committedAt: '2026-09-05T09:00:00.000Z',
        selectedVersionIsCurrent: false,
        readerWorkItemId: 'WI-OLD',
        workItemCount: 1,
      },
    ],
  };
}

export function libraryDocuments(
  ids: string[],
  nextCursor: string | null = null,
): CanonicalLibraryDocumentsResponse {
  return {
    scope: 'CURRENT_USER_DOCUMENT_CATALOG',
    order: 'FAMILY_CREATED_AT_DESC_FAMILY_ID_DESC',
    items: ids.map(libraryFamily),
    nextCursor,
    fileReadPerformed: false,
  };
}

export function libraryStatement(
  text: string,
  sourceRefIds: string[] = [],
): CanonicalSourceBoundEngineeringStatement {
  return { text, basis: 'SOURCE_FACT', sourceRefIds };
}

export function libraryQuicklook(
  workItemId: string,
): CanonicalLibraryQuicklookResponse {
  return {
    document: libraryDocument(workItemId),
    fileReadPerformed: false,
    result: {
      status: 'CANDIDATE_ONLY',
      revision: 2,
      sourceResultId: 'result-2',
      overallCandidate: '既有候选意见',
      missingInputs: ['尚需当前机队构型'],
      gap: null,
      staleReason: null,
      sourceCount: 3,
      engineeringSummary: {
        schemaVersion: 'wiselink.3_1.overall_engineering_summary.v1',
        conclusion: libraryStatement('需结合当前构型评估维修计划。', [
          'source-1',
        ]),
        whyItMatters: [
          libraryStatement('旧构型可能触发空中重启。', ['source-2']),
        ],
        applicability: {
          sourceScope: libraryStatement('适用于资料列出的构型。'),
          fleetMatch: libraryStatement('当前机队匹配尚待核对。'),
          requiredFacts: [libraryStatement('尚需当前机队构型')],
        },
        implementationImpact: [],
        dispositionPriority: [],
        nextActions: [libraryStatement('核对飞机号与部件号。')],
      },
    },
  };
}
