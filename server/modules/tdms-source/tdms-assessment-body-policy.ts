import type {
  TdmsPackageRecord,
  TdmsRawCode,
  TdmsRecordRevision,
} from '@shared/tdms-source.interface';
import type { TdmsSourceBodyReadPolicy } from '@shared/tdms-source-body-policy';
import { tdmsError } from './tdms-source.types';

type BodyPolicyRecord = Pick<TdmsPackageRecord, 'recordKind' | 'fileType' | 'state' | 'sourceRecordId' | 'sourceVersion'> & {
  rawFields?: Record<string, unknown>;
};
const ASSESSMENT_TYPES: ReadonlySet<string> = new Set([
  'SB评估单', 'SL评估单', '工程文件编写评估单', 'AD分处理单', 'AD处理条目',
]);
const NON_OPINION_TYPES: Readonly<Record<string, readonly string[]>> = {
  MANUFACTURER_FILE: ['SB', 'SL', 'AD', 'SB文档', 'SL文档', 'AD文档', 'AEO', 'EO', 'EF', 'CEO'],
  ENGINEERING_FILE: ['AEO', 'EO', 'EF', 'CEO', 'Publication Source'],
  PROCESSING_SHEET: ['SB处理单', 'SL处理单'],
  OBSERVATION: ['single aircraft status', '单机执行状态', 'EO反馈单', '单机执行反馈单'],
  SOURCE_EVENT: ['EO反馈单', '单机执行反馈单'],
};
export function isEstimatedState(state: TdmsRawCode | null): boolean {
  return state?.rawName === 'Estimated' &&
    (state.rawCode === null || state.rawCode === 'Estimated');
}
export function isAssessmentBodyOwner(record: BodyPolicyRecord, inspectNativeProof = false): boolean {
  if (record.recordKind === 'ENGINEER_ASSESSMENT' || record.recordKind === 'COMMENT' ||
    [record.fileType?.rawName, record.fileType?.rawCode].some(
      (value: string | null | undefined) => typeof value === 'string' && ASSESSMENT_TYPES.has(value),
    ) || (record.recordKind === 'OBSERVATION' &&
      /^(?:OR|VR):wt\.change2\.WTChangeActivity2:[0-9]+$/u.test(record.sourceRecordId))) return true;
  if (!inspectNativeProof) return false;
  const scope: string | null = nativeScope(record);
  return ['SB_ASSESSMENT_FORM', 'SL_ASSESSMENT_FORM', 'ENGINEERING_ASSESSMENT', 'AD_PROCESSING_FORM', 'AD_ITEM']
    .includes(scope ?? '');
}
function nativeScope(record: BodyPolicyRecord): string | null {
  if (!record.rawFields) return null;
  const complete: Record<string, unknown> | null = plain(record.rawFields.completeOwnedSource);
  const requested: Record<string, unknown> | null = plain(complete?.requestedCriteria);
  if (typeof requested?.scopeId === 'string') return requested.scopeId;
  const bounded: Record<string, unknown> | null = plain(record.rawFields.profileOwnedBody ?? record.rawFields.ownedBusinessContent);
  return typeof bounded?.profileId === 'string' ? bounded.profileId : null;
}
function isKnownNonOpinionSource(record: BodyPolicyRecord): boolean {
  const types: readonly string[] | undefined = NON_OPINION_TYPES[record.recordKind];
  if (!!types && [record.fileType?.rawName, record.fileType?.rawCode].some(
    (value: string | null | undefined) => typeof value === 'string' && types.includes(value),
  )) return true;
  return record.recordKind === 'OBSERVATION' &&
    /^(?:OR|VR):com\.airchina\.tdms\.statuslink\.TDMSStatusLink:[0-9]+$/u.test(record.sourceRecordId);
}
function plain(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function sameVersion(value: unknown, record: BodyPolicyRecord): boolean {
  const version: Record<string, unknown> | null = plain(value);
  return version?.rawRevision === record.sourceVersion.rawRevision &&
    version?.rawIteration === record.sourceVersion.rawIteration &&
    version?.confirmation === record.sourceVersion.confirmation;
}
/** Reuse independent own before/after observations; a parent or another lane is not proof. */
function hasOwnEstimatedEvidence(record: TdmsRecordRevision): boolean {
  const collection: Record<string, unknown> | null = plain(record.rawFields.opinionCollection);
  if (collection?.mode === 'ESTIMATED_OPINION') {
    const subject: Record<string, unknown> | null = plain(collection.approvalSubject);
    return subject?.sourceRecordId === record.sourceRecordId && sameVersion(subject.sourceVersion, record) &&
      [collection.before, collection.after].every((value: unknown) => {
        const observation: Record<string, unknown> | null = plain(value);
        const state: Record<string, unknown> | null = plain(observation?.state);
        return observation?.sourceRecordId === record.sourceRecordId &&
          observation?.recordKind === 'ENGINEER_ASSESSMENT' &&
          observation?.objectBinding === 'EXACT_CURRENT_DETAIL' &&
          sameVersion(observation?.sourceVersion, record) &&
          state?.rawName === 'Estimated' && (state.rawCode === null || state.rawCode === 'Estimated');
      });
  }
  for (const key of ['completeOwnedSource', 'profileOwnedBody', 'ownedBusinessContent']) {
    const proof: Record<string, unknown> | null = plain(record.rawFields[key]);
    if (!Array.isArray(proof?.reads) || proof.reads.length !== 2) continue;
    if (proof.reads.every((value: unknown) => {
      const read: Record<string, unknown> | null = plain(value);
      const owner: Record<string, unknown> | null = plain(read?.owner);
      return owner?.sourceRecordId === record.sourceRecordId && owner?.stateRaw === 'Estimated' &&
        sameVersion(owner.sourceVersion, record);
    })) return true;
  }
  return false;
}
const OPINION_LABEL: RegExp = /(?:评估|评价)(?:意见|结论)|(?:Assessment|Evaluation)\s*(?:Opinion|Conclusion)/iu;
export function isAssessmentOpinionLabel(value: unknown): boolean {
  return typeof value === 'string' && OPINION_LABEL.test(value);
}
/** A related row has no independent child qualification in the current contract. */
function assertNoParentOpinionFields(fields: unknown): void {
  if (!Array.isArray(fields)) return;
  for (const value of fields) {
    const field: Record<string, unknown> | null = plain(value);
    const ownValue: Record<string, unknown> | null = plain(field?.value);
    // Qualification uses labels only. Never read a child's rawValue/text here.
    if (isAssessmentOpinionLabel(field?.actualLabel) || isAssessmentOpinionLabel(ownValue?.actualLabel))
      throw tdmsError('TDMS_RELATED_ASSESSMENT_BODY_REQUIRES_OWN_ESTIMATED_RECORD');
  }
}
function completeStateOnlyMetadata(record: TdmsPackageRecord): boolean {
  const proof: Record<string, unknown> | null = plain(record.rawFields.completeOwnedSource);
  if (!proof || !Array.isArray(proof.reads) || proof.reads.length !== 2 ||
      Object.keys(record.content).some((key: string) => key !== 'completeOwnedFields') ||
      record.artifactMemberIds.length || record.unreadAttachments?.length) return false;
  const stateOnly = (fields: unknown): boolean => Array.isArray(fields) && fields.every((value: unknown) => {
    const field: Record<string, unknown> | null = plain(value);
    const ownValue: Record<string, unknown> | null = plain(field?.value);
    return ownValue?.rawValue === null &&
      ['NOT_APPLICABLE', 'NOT_READ', 'ABSENT', 'NOT_LOADED'].includes(String(ownValue.state));
  });
  return stateOnly(record.content.completeOwnedFields) && proof.reads.every((value: unknown) => {
    const read: Record<string, unknown> | null = plain(value);
    const owner: Record<string, unknown> | null = plain(read?.owner);
    return owner?.sourceRecordId === record.sourceRecordId && owner.stateRaw === record.state?.rawName &&
      stateOnly(read?.fields) && Array.isArray(read?.attachments) && read.attachments.length === 0;
  });
}
export function assertNoRelatedAssessmentBody(
  rawFields: Record<string, unknown>,
  allowOwnAssessmentFields = false,
): void {
  const proof: Record<string, unknown> | null = plain(rawFields.completeOwnedSource);
  if (!Array.isArray(proof?.reads)) return;
  for (const value of proof.reads) {
    const read: Record<string, unknown> | null = plain(value);
    if (!allowOwnAssessmentFields) assertNoParentOpinionFields(read?.fields);
    if (!Array.isArray(read?.relationTables)) continue;
    for (const tableValue of read.relationTables) {
      const table: Record<string, unknown> | null = plain(tableValue);
      if (!Array.isArray(table?.rows)) continue;
      for (const rowValue of table.rows) {
        const row: Record<string, unknown> | null = plain(rowValue);
        if (!Array.isArray(row?.cells)) continue;
        for (const cellValue of row.cells) {
          const cell: Record<string, unknown> | null = plain(cellValue);
          if (isAssessmentOpinionLabel(cell?.actualLabel))
            throw tdmsError('TDMS_RELATED_ASSESSMENT_BODY_REQUIRES_OWN_ESTIMATED_RECORD');
        }
      }
    }
  }
}
export function rejectEmbeddedAssessmentBodies(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) rejectEmbeddedAssessmentBodies(child);
    return;
  }
  const object: Record<string, unknown> | null = plain(value);
  if (!object) return;
  const embedded: boolean = object.recordKind === 'ENGINEER_ASSESSMENT' || object.recordKind === 'COMMENT' ||
    object.kind === 'ENGINEER_ASSESSMENT' || object.kind === 'COMMENT';
  if (embedded && ['text', 'body', 'content', 'opinions'].some((key: string) => Object.hasOwn(object, key)))
    throw tdmsError('TDMS_EMBEDDED_ASSESSMENT_BODY_FORBIDDEN');
  for (const child of Object.values(object)) rejectEmbeddedAssessmentBodies(child);
}
export function safeSourceRecordSummary(record: TdmsRecordRevision): import('@shared/tdms-source.interface').TdmsRecordSummary {
  const assessment: boolean = isAssessmentBodyOwner(record);
  const withheld: boolean = assessment ? !isEstimatedState(record.state) : !isKnownNonOpinionSource(record);
  return {
    recordRef: record.recordRef, sourceRevisionRef: record.sourceRevisionRef,
    recordKind: record.recordKind, sourceRecordId: record.sourceRecordId,
    sourceKey: record.sourceKey, sourceInstanceId: record.sourceInstanceId,
    title: record.title, fileType: record.fileType, sourceVersion: record.sourceVersion,
    ...(record.businessVersion === undefined ? {} : { businessVersion: record.businessVersion }),
    state: record.state, authors: record.authors, observedAt: record.observedAt, capturedAt: record.capturedAt,
    coverage: record.coverage, relatedDocumentVersionIds: record.relatedDocumentVersionIds,
    fieldSelectors: withheld ? [] : record.fieldSelectors,
    sourceVerification: record.sourceVerification, currentness: record.currentness,
  };
}
/** Run before the Complete1/bounded/probe early-return paths and before any acquisition/write. */
export function assertAssessmentBodyIngress(record: TdmsPackageRecord): void {
  rejectEmbeddedAssessmentBodies(record.rawFields);
  const ownAssessment: boolean = isAssessmentBodyOwner(record, true);
  assertNoRelatedAssessmentBody(record.rawFields, ownAssessment);
  if (!ownAssessment) {
    assertNoParentOpinionFields(record.content.completeOwnedFields);
    assertNoParentOpinionFields(record.content.boundedOwnedBody);
    assertNoParentOpinionFields(record.content.ownedVisibleBusinessContent);
  }
  if (!ownAssessment) {
    if (!isKnownNonOpinionSource(record) && (Object.keys(record.content).length ||
        ['completeOwnedSource', 'profileOwnedBody', 'ownedBusinessContent'].some(
          (key: string) => record.rawFields[key] !== undefined,
        ))) throw tdmsError('TDMS_SOURCE_BODY_OWNER_UNCONFIRMED');
    return;
  }
  if (isEstimatedState(record.state)) return;
  if (record.artifactMemberIds.length || record.unreadAttachments?.length)
    throw tdmsError('TDMS_UNAPPROVED_OPINION_ARTIFACT_FORBIDDEN');
  if (plain(record.rawFields.opinionCollection)?.mode === 'ESTIMATED_OPINION' && record.content.opinions?.length)
    throw tdmsError('TDMS_OPINION_NOT_APPROVED');
  // NOT_APPLICABLE/null is source state metadata, not a read or blank draft body.
  // The full Complete1 validator still verifies every owner/field/roster claim.
  if (completeStateOnlyMetadata(record)) return;
  const metadataKeys: ReadonlySet<string> = new Set([
    'number', 'storageType', 'businessType', 'opinionCollection', 'unresolvedRelations',
    'sourceModifiedRaw', 'documentTargetClassification', 'engineeringClassification',
  ]);
  if (Object.keys(record.content).length || record.artifactMemberIds.length ||
      Object.keys(record.rawFields).some((key: string) => !metadataKeys.has(key)) ||
      ['completeOwnedSource', 'profileOwnedBody', 'ownedBusinessContent'].some(
        (key: string) => record.rawFields[key] !== undefined,
      ))
    throw tdmsError('TDMS_UNAPPROVED_ASSESSMENT_BODY_FORBIDDEN');
}
/** Finite copy avoids inspecting/cloning a retained draft body, including legacy opaque proof blobs. */
function metadataOnly(record: TdmsRecordRevision, reason: string): TdmsRecordRevision {
  return {
    recordRef: record.recordRef, sourceRevisionRef: record.sourceRevisionRef,
    captureRef: record.captureRef, recordKind: record.recordKind, sourceRecordId: record.sourceRecordId,
    sourceKey: record.sourceKey, sourceInstanceId: record.sourceInstanceId,
    title: record.title, fileType: record.fileType, sourceVersion: record.sourceVersion,
    ...(record.businessVersion === undefined ? {} : { businessVersion: record.businessVersion }),
    state: record.state, authors: record.authors, sourceModifiedAt: record.sourceModifiedAt,
    observedAt: record.observedAt, capturedAt: record.capturedAt,
    coverage: { ...record.coverage, status: 'PARTIAL', gaps: [...new Set([...record.coverage.gaps, reason])] },
    relatedDocumentVersionIds: record.relatedDocumentVersionIds,
    rawFields: {}, content: {}, fieldSelectors: [], fieldProvenance: [], artifacts: [], unreadAttachments: [],
    sourceVerification: record.sourceVerification, currentness: record.currentness, selectedHead: record.selectedHead,
  };
}
export function sourceBodyReadingProjection(record: TdmsRecordRevision): {
  record: TdmsRecordRevision;
  bodyReadPolicy: TdmsSourceBodyReadPolicy;
  limitation: string | null;
} {
  const assessment: boolean = isAssessmentBodyOwner(record);
  const estimated: boolean = assessment && isEstimatedState(record.state);
  let kind: TdmsSourceBodyReadPolicy['kind'] = 'METADATA_ONLY';
  let limitation: string | null = assessment
    ? estimated ? 'ASSESSMENT_BODY_QUALIFICATION_UNCONFIRMED' : 'UNAPPROVED_ASSESSMENT_BODY_WITHHELD'
    : 'SOURCE_BODY_OWNER_UNCONFIRMED';
  if (estimated && hasOwnEstimatedEvidence(record)) {
    kind = 'ESTIMATED_ASSESSMENT'; limitation = null;
  } else if (!assessment && isKnownNonOpinionSource(record)) {
    kind = record.recordKind === 'PROCESSING_SHEET' ? 'OWN_PROCESSING_FIELDS' : 'NON_OPINION_SOURCE';
    limitation = null;
  }
  if (kind !== 'METADATA_ONLY') {
    try {
      if (kind === 'ESTIMATED_ASSESSMENT' && record.content.opinions?.some(
        (opinion) => !isEstimatedState(opinion.state) || !opinion.sourceSelector?.trim(),
      )) throw tdmsError('TDMS_ASSESSMENT_OPINION_OWN_STATE_UNCONFIRMED');
      assertNoRelatedAssessmentBody(record.rawFields, kind === 'ESTIMATED_ASSESSMENT');
      if (kind === 'NON_OPINION_SOURCE' || kind === 'OWN_PROCESSING_FIELDS') {
        assertNoParentOpinionFields(record.content.completeOwnedFields);
        assertNoParentOpinionFields(record.content.boundedOwnedBody);
        assertNoParentOpinionFields(record.content.ownedVisibleBusinessContent);
      }
      rejectEmbeddedAssessmentBodies(record.rawFields);
    } catch {
      kind = 'METADATA_ONLY'; limitation = 'RELATED_ASSESSMENT_BODY_WITHHELD';
    }
  }
  return {
    record: limitation ? metadataOnly(record, limitation) : record,
    bodyReadPolicy: { kind, sourceRecordId: record.sourceRecordId, sourceRevisionRef: record.sourceRevisionRef },
    limitation,
  };
}
