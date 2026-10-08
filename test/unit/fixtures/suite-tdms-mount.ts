import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { EngineeringMatterCatalogEntry } from '@shared/api.interface';
import type { EngineeringMatterWorkspaceRead } from '@client/src/api/engineering-matter';
import type {
  TdmsCatalogueResponse,
  TdmsCoverage,
  TdmsRecordReadResponse,
  TdmsRecordSummary,
  TdmsRelationAssertion,
  TdmsRelationReadResponse,
  TdmsReadReceipt,
} from '@shared/tdms-source.interface';
import { libraryMatterFixture } from '../fixtures/library-matter';
import { jobAidReadingFixture } from '../semantic-reading-ui.fixtures';

const OBSERVED_AT = '2026-10-05T10:00:00.000Z';
const COVERAGE: TdmsCoverage = {
  status: 'PARTIAL',
  gaps: ['source-side verification is unavailable'],
  readback: 'NOT_VERIFIED',
};

export function suiteTdmsSummary(
  sourceRevisionRef: string,
  extra: Partial<TdmsRecordSummary> = {},
): TdmsRecordSummary {
  return {
    recordRef: `record-${sourceRevisionRef}`,
    sourceRevisionRef,
    recordKind: 'ENGINEER_ASSESSMENT',
    sourceRecordId: `assessment-${sourceRevisionRef}`,
    sourceKey: 'TDMS-test',
    sourceInstanceId: 'instance-test',
    title: `TDMS 评估 ${sourceRevisionRef}`,
    fileType: { rawCode: 'EA', rawName: '工程评估' },
    sourceVersion: {
      rawRevision: '7',
      rawIteration: null,
      confirmation: 'SOURCE_DECLARED',
    },
    businessVersion: {
      rawRevision: 'R07',
      rawIteration: null,
      confirmation: 'SOURCE_DECLARED',
    },
    state: { rawCode: 'RELEASED', rawName: '已发布' },
    authors: [],
    observedAt: OBSERVED_AT,
    capturedAt: OBSERVED_AT,
    coverage: COVERAGE,
    relatedDocumentVersionIds: [],
    fieldSelectors: [],
    sourceVerification: 'DECLARED_ONLY',
    currentness: 'SELECTED_HOST_OBSERVATION',
    ...extra,
  };
}

export function suiteTdmsCatalogue(
  records: TdmsRecordSummary[],
  nextAfter: string | null = null,
): TdmsCatalogueResponse {
  return {
    records,
    sourceStatus: 'AVAILABLE',
    hasMore: nextAfter !== null,
    nextAfter,
    readPerformed: false,
    limitations: ['目录仅提供登记元数据，不包含来源正文。'],
  };
}

export function suiteTdmsDisabledCatalogue(): TdmsCatalogueResponse {
  return {
    records: [],
    sourceStatus: 'DISABLED',
    hasMore: false,
    nextAfter: null,
    readPerformed: false,
    limitations: ['TDMS 目录读取已禁用。'],
  };
}

export function suiteTdmsReceipt(
  sourceRevisionRef: string,
  purpose: TdmsReadReceipt['purpose'],
): TdmsReadReceipt {
  return {
    receiptRef: `receipt-${purpose}-${sourceRevisionRef}`,
    sourceRevisionRef,
    readAt: OBSERVED_AT,
    purpose,
    fieldPaths: null,
    taskContextRef: null,
    readPerformed: true,
    permissionRevision: 'membership-revision-test',
    engineeringAdoption: 'NOT_CREATED',
    executionVerified: false,
  };
}

export function suiteTdmsRecordRead(
  sourceRevisionRef: string,
  body = `准确来源正文 ${sourceRevisionRef}`,
): TdmsRecordReadResponse {
  return {
    record: {
      ...suiteTdmsSummary(sourceRevisionRef),
      captureRef: `capture-${sourceRevisionRef}`,
      sourceModifiedAt: null,
      rawFields: { privateField: `raw-${sourceRevisionRef}` },
      content: {
        opinions: [{
          text: body,
          author: null,
          state: null,
          conditions: ['仅为来源声明'],
          requiredActions: [],
          sourceSelector: `/opinions/${sourceRevisionRef}`,
        }],
      },
      fieldProvenance: [],
      artifacts: [{
        memberId: `artifact-${sourceRevisionRef}`,
        sourceArtifactId: `source-file-${sourceRevisionRef}`,
        acquisitionId: `acquisition-${sourceRevisionRef}`,
        fileName: `source-${sourceRevisionRef}.pdf`,
        mediaType: 'application/pdf',
        sha256: 'a'.repeat(64),
        byteLength: 128,
        immutableReadbackVerified: true,
        documentVersionId: 'document-bound-v1',
        registrationGap: null,
      }],
      unreadAttachments: [],
      selectedHead: true,
    },
    selectedFields: null,
    receipt: suiteTdmsReceipt(sourceRevisionRef, 'WIKI_NATIVE_RECORD'),
    limitations: ['正文为指定 Host 保存观察，不证明源端当前性。'],
  };
}

export function suiteTdmsAssertion(
  sourceRevisionRef: string,
  assertionRef: string,
  extra: Partial<TdmsRelationAssertion> = {},
): TdmsRelationAssertion {
  return {
    relationRef: `relation-${assertionRef}`,
    assertionRef,
    sourceRelationId: `source-relation-${assertionRef}`,
    captureRef: `capture-${sourceRevisionRef}`,
    rawKind: `源关系 ${assertionRef}`,
    controlledKind: 'REFERENCES',
    from: { kind: 'NATIVE_RECORD_REVISION', sourceRevisionRef },
    to: {
      kind: 'UNRESOLVED',
      rawIdentity: `未解析身份 ${assertionRef}`,
      versionGap: '没有准确来源修订身份',
    },
    authority: 'SOURCE_EXPLICIT',
    selector: `/relations/${assertionRef}`,
    observedAt: OBSERVED_AT,
    coverage: COVERAGE,
    scope: { applicability: 'source-declared' },
    completionEffect: 'UNSPECIFIED',
    changeClass: 'UNSPECIFIED',
    rawFields: {},
    selectedHead: true,
    sourceVerification: 'DECLARED_ONLY',
    ...extra,
  };
}

export function suiteTdmsRelationsRead(
  sourceRevisionRef: string,
  assertions: TdmsRelationAssertion[],
  limitations = ['关系为来源声明，未独立核验。'],
): TdmsRelationReadResponse {
  return {
    sourceRevisionRef,
    relations: assertions,
    receipt: suiteTdmsReceipt(sourceRevisionRef, 'WIKI_NATIVE_RELATIONS'),
    limitations,
  };
}

export function suiteMatterCatalogEntry(
  documentVersionId = 'document-bound-v1',
): EngineeringMatterCatalogEntry {
  return {
    workItemId: 'work-item-primary',
    relationRole: 'PRIMARY',
    linkedAtWorkItemRevision: 3,
    currentWorkItemRevision: 3,
    workItemChangedSinceLink: false,
    workItemStatus: 'ACTIVE',
    document: {
      documentId: 'document-bound',
      documentVersionId,
      documentCode: 'SB-001',
      businessRevision: 'R02',
      normalizedFamily: 'SB-001',
    },
    documentCurrentness: {
      familyId: 'family-bound',
      currentDocumentVersionId: documentVersionId,
      currentGeneration: 1,
      selectedVersionIsCurrent: true,
    },
    sourceNavigation: {
      status: 'NOT_PARSED',
      sourceRefCount: 0,
      structuredContentPath: null,
    },
  };
}

export function suiteMatterWithCatalogue(): EngineeringMatterWorkspaceRead {
  const workspace = libraryMatterFixture();
  workspace.matter.catalog.entries = [suiteMatterCatalogEntry()];
  return workspace;
}

export function suiteProblemOnlyWorkspace(
  sourceRevisionRef = 'saved-source-v1',
): EngineeringMatterWorkspaceRead {
  const workspace = libraryMatterFixture();
  const current = workspace.working.current;
  if (!current) throw new Error('Fixture requires a current saved work.');
  current.substantiveResultRef = null;
  current.substantiveResultRevision = null;
  current.state.substantiveResult = null;
  const problemWork = jobAidReadingFixture().current!.content;
  problemWork.evidence = [suiteTdmsSavedEvidence(sourceRevisionRef, current.matterWorkRevisionId)];
  current.state.problemWork = problemWork;
  workspace.matter.catalog.entries = [suiteMatterCatalogEntry()];
  return workspace;
}

export function suiteHistoricalProblemOnlyWork(
  sourceRevisionRef = 'saved-source-v1',
  workRef = 'test-working-2',
) {
  const workspace = suiteProblemOnlyWorkspace(sourceRevisionRef);
  const current = workspace.working.current;
  if (!current) throw new Error('Fixture requires a current saved work.');
  const historical = structuredClone(current);
  historical.matterWorkRevisionId = workRef;
  historical.workingRevision = 2;
  historical.changeSummary = '历史问题工作用于隔离读取测试。';
  const problemWork = historical.state.problemWork;
  if (!problemWork) throw new Error('Fixture requires saved problem work.');
  problemWork.evidence = [suiteTdmsSavedEvidence(sourceRevisionRef, workRef)];
  return historical;
}

function suiteTdmsSavedEvidence(
  sourceRevisionRef: string,
  workRef: string,
): Extract<AssessmentEvidence, { kind: 'TDMS_NATIVE_RECORD' }> {
  return {
    evidenceRef: `evidence-${sourceRevisionRef}`,
    title: `保存的 TDMS 依据 ${sourceRevisionRef}`,
    versionLabel: '来源声明 R07',
    excerpt: '保存依据仅引用准确来源修订。',
    kind: 'TDMS_NATIVE_RECORD',
    nativeSource: suiteTdmsSummary(sourceRevisionRef),
    nativeReadReceipt: {
      ...suiteTdmsReceipt(sourceRevisionRef, 'JOB_AID_NATIVE_RECORD'),
      purpose: 'JOB_AID_NATIVE_RECORD',
      taskContextRef: workRef,
      fieldPaths: ['content.opinions'],
    },
  };
}
