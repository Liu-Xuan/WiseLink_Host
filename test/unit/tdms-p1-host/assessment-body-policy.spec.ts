import type { TdmsPackageRecord, TdmsRecordRevision } from '@shared/tdms-source.interface';
import { canReadTdmsSourceBody } from '@shared/tdms-source-body-policy';
import {
  assertAssessmentBodyIngress,
  sourceBodyReadingProjection,
} from '@server/modules/tdms-source/tdms-assessment-body-policy';
import { sourcePackage } from '@server/modules/tdms-source/tdms-source.validation';
import { TdmsSourceService } from '@server/modules/tdms-source/tdms-source.service';
import type { TdmsSourceAuthorization } from '@server/modules/tdms-source/tdms-source.types';
import { fixture, actor } from '../tdms-source/tdms-fixtures';
import { MemoryTdmsRepository } from '../tdms-source/tdms-memory-double';
import { copyComplete, sealComplete, syntheticCompleteEnvelope, type CompleteScope } from '../tdms-source/tdms-complete-owned.fixture';

const DRAFT_MARKER = 'SYNTHETIC-DRAFT-BODY-NEVER-DELIVER';
interface SyntheticRead {
  owner: { stateRaw: string };
  fields: Array<{ value: { actualLabel: string; rawValue: string; observedTotalCodepoints: number } }>;
}
function draftEnvelope(scope: CompleteScope, state = 'Estimating') {
  const envelope = syntheticCompleteEnvelope(scope);
  const record = envelope.package.records[0]!;
  const proof = record.rawFields.completeOwnedSource as { reads: SyntheticRead[] };
  record.state.rawName = state;
  for (const read of proof.reads) {
    read.owner.stateRaw = state;
    read.fields[0]!.value.rawValue = DRAFT_MARKER;
    read.fields[0]!.value.observedTotalCodepoints = [...DRAFT_MARKER].length;
  }
  record.content.completeOwnedFields = copyComplete(proof.reads[1]!.fields) as typeof record.content.completeOwnedFields;
  return sealComplete(envelope);
}
function stored(record: TdmsPackageRecord): TdmsRecordRevision {
  return {
    recordRef: 'TDMS-REC-own', sourceRevisionRef: 'TDMS-REV-own', captureRef: 'TDMS-CAP-own',
    recordKind: record.recordKind, sourceRecordId: record.sourceRecordId, sourceKey: 'TDMS', sourceInstanceId: 'synthetic',
    title: record.title, fileType: record.fileType, sourceVersion: record.sourceVersion,
    businessVersion: record.businessVersion, state: record.state, authors: record.authors,
    sourceModifiedAt: record.sourceModifiedAt, observedAt: record.observedAt, capturedAt: record.observedAt,
    coverage: record.coverage, rawFields: record.rawFields, content: record.content,
    fieldProvenance: record.fieldProvenance, fieldSelectors: [], artifacts: [], unreadAttachments: [],
    relatedDocumentVersionIds: [], sourceVerification: 'DECLARED_ONLY', currentness: 'SELECTED_HOST_OBSERVATION', selectedHead: true,
  };
}
function assessment(id: number, estimated: boolean): TdmsPackageRecord {
  const record: TdmsPackageRecord = fixture().records[0]!;
  record.itemId = `assessment-${id}`;
  record.sourceRecordId = `OR:wt.change2.WTChangeOrder2:${id}`;
  record.title = `Synthetic-${id}`;
  record.recordKind = 'ENGINEER_ASSESSMENT';
  record.fileType = { rawCode: null, rawName: 'SB评估单' };
  record.state = { rawCode: null, rawName: estimated ? 'Estimated' : 'Estimating' };
  record.sourceVersion = { rawRevision: 'A', rawIteration: '2', confirmation: 'SOURCE_DECLARED' };
  record.content = {};
  record.rawFields = {
    number: record.title, storageType: record.fileType,
    opinionCollection: {
      schemaVersion: 'wiselink.tdms-opinion-collection.v1', mode: 'METADATA_ONLY',
      reason: 'STATE_NOT_ESTIMATED', approvalSubject: null, before: null, after: null,
    },
  };
  if (estimated) {
    const observation = {
      sourceRecordId: record.sourceRecordId, sourceVersion: record.sourceVersion,
      recordKind: 'ENGINEER_ASSESSMENT', objectBinding: 'EXACT_CURRENT_DETAIL', state: record.state,
      sourceModifiedAt: record.sourceModifiedAt, observedAt: record.observedAt,
      identitySelector: '#infoPageIdentityObjectIdentifier',
      stateSelector: '.attributePanel[oid] .attributePanel-label[State] => .attributePanel-value',
      versionSelector: '.attributePanel[oid] .attributePanel-label[Version] => .attributePanel-value',
    };
    record.rawFields.opinionCollection = {
      schemaVersion: 'wiselink.tdms-opinion-collection.v1', mode: 'ESTIMATED_OPINION',
      reason: 'APPROVED_CURRENT_EXACT_VERSION',
      approvalSubject: { sourceRecordId: record.sourceRecordId, sourceVersion: record.sourceVersion },
      before: { ...observation, observedAt: '2026-10-05T09:59:59Z' }, after: observation,
    };
    record.content = { opinions: [{
      text: 'SYNTHETIC-APPROVED-OWN-BODY', author: null, state: record.state,
      conditions: [], requiredActions: [],
      sourceSelector: '.attributePanel[oid] .attributePanel-label[评估意见] => .attributePanel-value',
    }] };
  }
  return record;
}

describe('Host estimated-only assessment body admission and exact legacy projection', () => {
  it.each(['SB_ASSESSMENT_FORM', 'ENGINEERING_ASSESSMENT', 'AD_PROCESSING_FORM', 'AD_ITEM'] as CompleteScope[])(
    'rejects a draft Complete1 %s before admission/file/database writes', async (scope: CompleteScope) => {
      const repository = new MemoryTdmsRepository();
      const authorization: TdmsSourceAuthorization = {
        available: true, catalogue: jest.fn(async () => []),
        authorize: jest.fn(async () => { throw new Error('UNEXPECTED_AUTH'); }),
        authorizeImport: jest.fn(async () => { throw new Error('UNEXPECTED_IMPORT'); }),
      };
      const artifacts = { acquire: jest.fn(async () => { throw new Error('UNEXPECTED_BYTES'); }) };
      const service = new TdmsSourceService(repository, authorization, artifacts, { assertRead: jest.fn() });
      await expect(service.importDailyMetadata(actor(), draftEnvelope(scope)))
        .rejects.toThrow(/TDMS_(?:UNAPPROVED_ASSESSMENT_BODY_FORBIDDEN|ESTIMATING_STATE_ONLY_REQUIRED)/u);
      expect(authorization.authorizeImport).not.toHaveBeenCalled();
      expect(artifacts.acquire).not.toHaveBeenCalled();
      expect(repository.state.revisions).toHaveLength(0);
      expect(repository.state.captures).toHaveLength(0);
    },
  );

  it.each(['Approved', '已批准', 'UNKNOWN'])('does not substitute %s for this assessment Estimated status', (state: string) => {
    const record: TdmsPackageRecord = assessment(1, false);
    record.state = { rawName: state, rawCode: null };
    record.content = { opinions: [{ text: DRAFT_MARKER, author: null, state: record.state, conditions: [], requiredActions: [], sourceSelector: 'own' }] };
    expect(() => assertAssessmentBodyIngress(record)).toThrow('TDMS_UNAPPROVED_ASSESSMENT_BODY_FORBIDDEN');
  });

  it.each(['BLANK', 'TRUNCATED'])('does not admit %s opaque values as unapproved state-only metadata', (state: string) => {
    const record: TdmsPackageRecord = assessment(1, false);
    const fields = [{ value: { state, rawValue: state === 'BLANK' ? '' : DRAFT_MARKER } }];
    record.content = { ownedVisibleBusinessContent: fields };
    record.rawFields.completeOwnedSource = {
      reads: [1, 2].map(() => ({ owner: { sourceRecordId: record.sourceRecordId, stateRaw: 'Estimating' }, fields, attachments: [] })),
    };
    expect(() => assertAssessmentBodyIngress(record)).toThrow('TDMS_UNAPPROVED_ASSESSMENT_BODY_FORBIDDEN');
  });

  it('retains two lane identities under one parent while only the own Estimated record carries body', () => {
    const packet = fixture();
    const approved: TdmsPackageRecord = assessment(1, true);
    const draft: TdmsPackageRecord = assessment(2, false);
    packet.records = [approved, draft];
    packet.relations = [approved, draft].map((record: TdmsPackageRecord, index: number) => ({
      sourceRelationId: `parent-link-${index}`, expectedHeadAssertionRef: null,
      rawKind: 'PROCESSING_ASSESSMENT', controlledKind: 'PROCESSING_ASSESSMENT',
      from: { kind: 'UNRESOLVED', rawIdentity: 'SYNTHETIC-SAME-PARENT', versionGap: 'VERSION_UNCONFIRMED' },
      to: { kind: 'PACKAGE_RECORD', itemId: record.itemId }, authority: 'SOURCE_EXPLICIT',
      selector: '#synthetic-parent', observedAt: packet.observedAt, coverage: packet.coverage,
      scope: {}, completionEffect: 'UNSPECIFIED', changeClass: 'UNSPECIFIED', rawFields: {},
    }));
    expect(sourcePackage(packet).records).toHaveLength(2);
    draft.content = { opinions: [{ text: DRAFT_MARKER, author: null, state: draft.state, conditions: [], requiredActions: [], sourceSelector: 'own' }] };
    expect(() => sourcePackage(packet)).toThrow('TDMS_UNAPPROVED_ASSESSMENT_BODY_FORBIDDEN');
  });

  it('refuses nested child assessment text regardless of parent Estimated', () => {
    const packet = fixture();
    packet.records[0]!.state = { rawName: 'Estimated', rawCode: null };
    packet.records[0]!.rawFields.childAssessment = { recordKind: 'ENGINEER_ASSESSMENT', state: 'Estimating', text: DRAFT_MARKER };
    expect(() => sourcePackage(packet)).toThrow('TDMS_EMBEDDED_ASSESSMENT_BODY_FORBIDDEN');
  });

  it('metadata projection does not inspect legacy unapproved rawFields/content getters', () => {
    const record: TdmsRecordRevision = stored(assessment(1, false));
    const bodyRead = jest.fn(() => { throw new Error(DRAFT_MARKER); });
    Object.defineProperty(record, 'content', { get: bodyRead });
    Object.defineProperty(record, 'rawFields', { get: bodyRead });
    const projection = sourceBodyReadingProjection(record);
    expect(projection.bodyReadPolicy.kind).toBe('METADATA_ONLY');
    expect(projection.record.content).toEqual({});
    expect(projection.record.rawFields).toEqual({});
    expect(bodyRead).not.toHaveBeenCalled();
    expect(JSON.stringify(projection)).not.toContain(DRAFT_MARKER);
  });

  it('legacy parent professional field labels deny body before rawValue is inspected', () => {
    const base: TdmsPackageRecord = fixture().records[0]!;
    base.recordKind = 'PROCESSING_SHEET'; base.fileType = { rawName: 'SB处理单', rawCode: null };
    base.state = { rawName: 'Estimated', rawCode: null };
    const rawValue = jest.fn(() => { throw new Error(DRAFT_MARKER); });
    const value = { actualLabel: '专业评估意见:' };
    Object.defineProperty(value, 'rawValue', { get: rawValue, enumerable: true });
    base.rawFields.completeOwnedSource = { reads: [{ fields: [{ value }] }] };
    const projection = sourceBodyReadingProjection(stored(base));
    expect(projection.bodyReadPolicy.kind).toBe('METADATA_ONLY');
    expect(rawValue).not.toHaveBeenCalled();
    expect(JSON.stringify(projection)).not.toContain(DRAFT_MARKER);
  });

  it('keeps exact old approval and does not borrow a newer revision approval', () => {
    const old: TdmsRecordRevision = stored(assessment(1, false));
    const current: TdmsRecordRevision = stored(assessment(1, true));
    current.sourceRevisionRef = 'TDMS-REV-later-approved';
    const oldProjection = sourceBodyReadingProjection(old);
    const currentProjection = sourceBodyReadingProjection(current);
    expect(canReadTdmsSourceBody(oldProjection)).toBe(false);
    expect(canReadTdmsSourceBody(currentProjection)).toBe(true);
    expect(currentProjection.bodyReadPolicy.sourceRevisionRef).toBe('TDMS-REV-later-approved');
    expect(currentProjection.record.content.opinions?.[0]?.text).toBe('SYNTHETIC-APPROVED-OWN-BODY');
  });
});
