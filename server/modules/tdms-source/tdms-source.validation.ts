import { createHash } from 'node:crypto';
import {
  TDMS_SOURCE_PACKAGE_SCHEMA,
  type TdmsReadContext,
  type TdmsSourcePackage,
  type TdmsCoverage,
  type TdmsPackageRelation,
} from '@shared/tdms-source.interface';
import { tdmsError } from './tdms-source.types';
import { createOpinionCollectionIngress } from './tdms-opinion-collection.validation';
import { createBoundedOwnedBodyValidator, createOwnedVisibleContentValidator } from './tdms-owned-visible-content.validation';
export const TDMS_SMALL_PACKAGE_MAX_BYTES = 512 * 1024;
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const o = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(o)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(o[k]))
      .join(',') +
    '}'
  );
}
export function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function identifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 255 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw tdmsError('TDMS_IDENTIFIER_INVALID');
  return value;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw tdmsError('TDMS_INPUT_INVALID');
  return value as Record<string, unknown>;
}
export function strict(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some((k) => !keys.includes(k)))
    throw tdmsError('TDMS_INPUT_UNKNOWN_FIELD');
}
export function readContext(value: unknown): TdmsReadContext {
  const o = object(value);
  strict(o, [
    'matterId',
    'documentVersionId',
    'workItemId',
    'jobAidAttemptRef',
  ]);
  for (const v of Object.values(o)) identifier(v);
  if (Object.keys(o).length > 1) throw tdmsError('TDMS_READ_CONTEXT_AMBIGUOUS');
  return o as TdmsReadContext;
}
function coverage(value: unknown): asserts value is TdmsCoverage {
  const o = object(value);
  strict(o, ['status', 'gaps', 'readback']);
  if (
    !['COMPLETE', 'PARTIAL', 'UNKNOWN'].includes(String(o.status)) ||
    !['CONSISTENT', 'NON_ATOMIC', 'NOT_VERIFIED'].includes(
      String(o.readback),
    ) ||
    !Array.isArray(o.gaps) ||
    o.gaps.some((v) => typeof v !== 'string')
  )
    throw tdmsError('TDMS_COVERAGE_INVALID');
}
function date(value: unknown): void {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw tdmsError('TDMS_TIMESTAMP_INVALID');
}
function strings(value: unknown): asserts value is string[] {
  if (!Array.isArray(value)) throw tdmsError('TDMS_LIST_INVALID');
  value.forEach(identifier);
}
function rawCode(value: unknown): void {
  if (value === null) return;
  const o = object(value);
  strict(o, ['rawCode', 'rawName', 'controlledMapping']);
  if (
    ![o.rawCode, o.rawName, o.controlledMapping ?? null].every(
      (v) => v === null || typeof v === 'string',
    )
  )
    throw tdmsError('TDMS_RAW_CODE_INVALID');
  // A raw OR/VR code is intentionally not resolved by this validator.
}
function version(value: unknown): void {
  const o = object(value);
  strict(o, ['rawRevision', 'rawIteration', 'confirmation']);
  if (
    ![o.rawRevision, o.rawIteration].every(
      (v) => v === null || typeof v === 'string',
    ) ||
    !['SOURCE_DECLARED', 'VERSION_UNCONFIRMED'].includes(String(o.confirmation))
  )
    throw tdmsError('TDMS_VERSION_INVALID');
}
function endpoint(value: unknown): void {
  const e = object(value);
  if (e.kind === 'PACKAGE_RECORD') {
    strict(e, ['kind', 'itemId']);
    identifier(e.itemId);
  } else if (e.kind === 'NATIVE_RECORD_REVISION') {
    strict(e, ['kind', 'sourceRevisionRef']);
    identifier(e.sourceRevisionRef);
  } else if (e.kind === 'DOCUMENT_VERSION') {
    strict(e, ['kind', 'documentVersionId']);
    identifier(e.documentVersionId);
  } else if (e.kind === 'UNRESOLVED') {
    strict(e, ['kind', 'rawIdentity', 'versionGap']);
    identifier(e.rawIdentity);
    identifier(e.versionGap);
  } else throw tdmsError('TDMS_ENDPOINT_INVALID');
}
export const assertOpinionCollectionIngress = createOpinionCollectionIngress({
  canonical,
  identifier,
  object,
  strict,
  date,
  rawCode,
  version,
  ownedVisibleContent: createOwnedVisibleContentValidator({
    canonical,
    object,
    strict,
    date,
  }),
  boundedOwnedBody: createBoundedOwnedBodyValidator({ canonical, object, strict, date }),
});
export function sourcePackage(value: unknown): TdmsSourcePackage {
  const serialized = JSON.stringify(value);
  if (
    !serialized ||
    Buffer.byteLength(serialized) > TDMS_SMALL_PACKAGE_MAX_BYTES
  )
    throw tdmsError('TDMS_SMALL_PACKAGE_LIMIT');
  const p = object(value);
  strict(p, [
    'schemaVersion',
    'packageId',
    'observedAt',
    'coverage',
    'query',
    'readFailures',
    'records',
    'relations',
    'artifacts',
  ]);
  if (p.schemaVersion !== TDMS_SOURCE_PACKAGE_SCHEMA)
    throw tdmsError('TDMS_PACKAGE_SCHEMA_INVALID');
  identifier(p.packageId);
  date(p.observedAt);
  coverage(p.coverage);
  const q = object(p.query);
  strict(q, ['requestedCriteria', 'actualCriteria', 'scopeMatch']);
  object(q.requestedCriteria);
  if (q.actualCriteria !== null) object(q.actualCriteria);
  if (!['MATCHED', 'MISMATCH', 'UNKNOWN'].includes(String(q.scopeMatch)))
    throw tdmsError('TDMS_QUERY_INVALID');
  for (const name of ['readFailures', 'records', 'relations', 'artifacts'])
    if (!Array.isArray(p[name]) || (p[name] as unknown[]).length > 200)
      throw tdmsError('TDMS_PACKAGE_LIST_INVALID');
  if ((p.records as unknown[]).some(r => object(object(r).rawFields).profileOwnedBody !== undefined) &&
      (q.scopeMatch !== 'UNKNOWN' || q.actualCriteria !== null))
    throw tdmsError('TDMS_BOUNDED_BODY_LIMITS_REQUIRED');
  const ids = new Set<string>();
  const memberIds = new Set<string>();
  const sourceIds = new Set<string>();
  for (const item of p.artifacts as unknown[]) {
    const a = object(item);
    strict(a, [
      'memberId',
      'sourceAttachmentId',
      'sourceAttachmentVersion',
      'fileName',
      'mediaType',
      'sha256',
      'byteLength',
      'bytesBase64',
    ]);
    const id = identifier(a.memberId);
    if (memberIds.has(id)) throw tdmsError('TDMS_ARTIFACT_DUPLICATE');
    memberIds.add(id);
    identifier(a.sourceAttachmentId);
    identifier(a.fileName);
    identifier(a.mediaType);
    if (a.sourceAttachmentVersion !== null)
      identifier(a.sourceAttachmentVersion);
    if (
      typeof a.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(a.sha256) ||
      typeof a.bytesBase64 !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
        a.bytesBase64,
      )
    )
      throw tdmsError('TDMS_ARTIFACT_BYTES_INVALID');
    const bytes = Buffer.from(a.bytesBase64, 'base64');
    if (
      !Number.isSafeInteger(a.byteLength) ||
      a.byteLength !== bytes.length ||
      bytes.length === 0 ||
      createHash('sha256').update(bytes).digest('hex') !== a.sha256
    )
      throw tdmsError('TDMS_ARTIFACT_IDENTITY_MISMATCH');
  }
  for (const item of p.records as unknown[]) {
    const r = object(item);
    strict(r, [
      'itemId',
      'recordKind',
      'sourceRecordId',
      'expectedHeadRevisionRef',
      'sourceVersion',
      'businessVersion',
      'title',
      'fileType',
      'state',
      'authors',
      'sourceModifiedAt',
      'observedAt',
      'coverage',
      'rawFields',
      'content',
      'fieldProvenance',
      'artifactMemberIds',
      'unreadAttachments',
      'relatedDocumentVersionIds',
      'formalDocumentArtifactMemberId',
    ]);
    const id = identifier(r.itemId);
    if (ids.has(id)) throw tdmsError('TDMS_RECORD_DUPLICATE');
    ids.add(id);
    if (
      ![
        'MANUFACTURER_FILE',
        'PROCESSING_SHEET',
        'ENGINEER_ASSESSMENT',
        'COMMENT',
        'ENGINEERING_FILE',
        'SOURCE_EVENT',
        'OBSERVATION',
      ].includes(String(r.recordKind))
    )
      throw tdmsError('TDMS_RECORD_KIND_INVALID');
    identifier(r.sourceRecordId);
    const sid = canonical([r.recordKind, r.sourceRecordId]);
    if (sourceIds.has(sid)) throw tdmsError('TDMS_RECORD_IDENTITY_DUPLICATE');
    sourceIds.add(sid);
    if (r.expectedHeadRevisionRef !== null)
      identifier(r.expectedHeadRevisionRef);
    version(r.sourceVersion);
    if (r.businessVersion != null) version(r.businessVersion);
    identifier(r.title);
    rawCode(r.fileType);
    rawCode(r.state);
    date(r.observedAt);
    if (r.sourceModifiedAt !== null) date(r.sourceModifiedAt);
    coverage(r.coverage);
    object(r.rawFields);
    object(r.content);
    const content = object(r.content);
    strict(content, [
      'ownedVisibleBusinessContent',
      'boundedOwnedBody',
      'opinions',
      'conditions',
      'requiredActions',
      'approvers',
      'sourceEvents',
      'executionDeclaration',
      'futureLcmLinks',
    ]);
    for (const field of ['conditions', 'requiredActions'])
      if (
        content[field] !== undefined &&
        (!Array.isArray(content[field]) ||
          (content[field] as unknown[]).some((v) => typeof v !== 'string'))
      )
        throw tdmsError('TDMS_CONTENT_INVALID');
    if (content.futureLcmLinks !== undefined) {
      if (!Array.isArray(content.futureLcmLinks))
        throw tdmsError('TDMS_LCM_LINK_INVALID');
      for (const value of content.futureLcmLinks) {
        const link = object(value);
        strict(link, [
          'externalRecordId',
          'aircraftRef',
          'softwareItemRef',
          'aeoVersionRef',
          'feedbackRef',
          'integrationStatus',
        ]);
        if (link.integrationStatus !== 'NOT_CONNECTED')
          throw tdmsError('TDMS_LCM_CONFIGURATION_AUTHORITY_NOT_CONNECTED');
      }
    }
    if (!Array.isArray(r.authors) || !Array.isArray(r.fieldProvenance))
      throw tdmsError('TDMS_RECORD_FIELDS_INVALID');
    for (const person of r.authors) {
      const a = object(person);
      strict(a, ['sourcePersonId', 'name', 'role']);
      if (
        ![a.sourcePersonId, a.name, a.role].every(
          (v) => v === null || typeof v === 'string',
        )
      )
        throw tdmsError('TDMS_PERSON_INVALID');
    }
    const fields = new Set<string>();
    for (const item of r.fieldProvenance) {
      const f = object(item);
      strict(f, [
        'fieldPath',
        'selector',
        'sourceModifiedAt',
        'observationRef',
      ]);
      identifier(f.fieldPath);
      identifier(f.selector);
      identifier(f.observationRef);
      if (fields.has(String(f.fieldPath)))
        throw tdmsError('TDMS_FIELD_PROVENANCE_DUPLICATE');
      fields.add(String(f.fieldPath));
      if (f.sourceModifiedAt !== null) date(f.sourceModifiedAt);
    }
    strings(r.artifactMemberIds);
    strings(r.relatedDocumentVersionIds);
    if ((r.artifactMemberIds as string[]).some((v) => !memberIds.has(v)))
      throw tdmsError('TDMS_ARTIFACT_MEMBER_MISSING');
    if (
      r.formalDocumentArtifactMemberId != null &&
      (!(r.artifactMemberIds as string[]).includes(
        identifier(r.formalDocumentArtifactMemberId),
      ) ||
        !['MANUFACTURER_FILE', 'ENGINEERING_FILE'].includes(
          String(r.recordKind),
        ))
    )
      throw tdmsError('TDMS_FORMAL_ARTIFACT_INVALID');
    if (r.unreadAttachments !== undefined) {
      if (!Array.isArray(r.unreadAttachments))
        throw tdmsError('TDMS_UNREAD_ATTACHMENT_INVALID');
      for (const value of r.unreadAttachments) {
        const a = object(value);
        strict(a, [
          'sourceAttachmentId',
          'sourceAttachmentVersion',
          'fileName',
          'mediaType',
          'byteLength',
          'readStatus',
          'gap',
          'selector',
        ]);
        identifier(a.sourceAttachmentId);
        identifier(a.fileName);
        identifier(a.selector);
        identifier(a.gap);
        if (
          !['NOT_READ', 'FAILED'].includes(String(a.readStatus)) ||
          (a.byteLength !== null &&
            (!Number.isSafeInteger(a.byteLength) || Number(a.byteLength) < 0))
        )
          throw tdmsError('TDMS_UNREAD_ATTACHMENT_INVALID');
      }
    }
  }
  const relationIds = new Set<string>();
  for (const item of p.relations as unknown[]) {
    const r = object(item);
    strict(r, [
      'sourceRelationId',
      'expectedHeadAssertionRef',
      'rawKind',
      'controlledKind',
      'from',
      'to',
      'authority',
      'selector',
      'observedAt',
      'coverage',
      'scope',
      'completionEffect',
      'changeClass',
      'rawFields',
    ]);
    const id = identifier(r.sourceRelationId);
    if (relationIds.has(id)) throw tdmsError('TDMS_RELATION_DUPLICATE');
    relationIds.add(id);
    if (r.expectedHeadAssertionRef !== null)
      identifier(r.expectedHeadAssertionRef);
    identifier(r.rawKind);
    identifier(r.selector);
    date(r.observedAt);
    coverage(r.coverage);
    object(r.scope);
    object(r.rawFields);
    endpoint(r.from);
    endpoint(r.to);
    if (
      !['SOURCE_EXPLICIT', 'CANDIDATE_ONLY'].includes(String(r.authority)) ||
      ![
        'OLD_COMPLETION_RECOGNIZED',
        'REEXECUTE_NEW_VERSION',
        'UNSPECIFIED',
      ].includes(String(r.completionEffect)) ||
      !['EQUIVALENT', 'REPLACES', 'UNSPECIFIED'].includes(
        String(r.changeClass),
      ) ||
      (r.controlledKind !== null &&
        ![
          'FILE_PROCESSING',
          'PROCESSING_ASSESSMENT',
          'ASSESSMENT_COMMENT',
          'REFERENCES',
          'PRODUCES_ENGINEERING_FILE',
          'VERSION_CHANGE',
          'OTHER',
        ].includes(String(r.controlledKind)))
    )
      throw tdmsError('TDMS_RELATION_FIELDS_INVALID');
    for (const e of [r.from, r.to].map(object))
      if (e.kind === 'PACKAGE_RECORD' && !ids.has(String(e.itemId)))
        throw tdmsError('TDMS_RELATION_RECORD_MISSING');
  }
  for (const item of p.readFailures as unknown[]) {
    const f = object(item);
    strict(f, ['sourceRecordId', 'code', 'detail']);
    if (f.sourceRecordId !== null) identifier(f.sourceRecordId);
    identifier(f.code);
    if (typeof f.detail !== 'string')
      throw tdmsError('TDMS_READ_FAILURE_INVALID');
  }
  assertOpinionCollectionIngress(p as unknown as TdmsSourcePackage);
  return structuredClone(value) as TdmsSourcePackage;
}
/** Enum values are source-declared labels, never a confirmed Host completion rule. */
export function relationVerificationGaps(r: TdmsPackageRelation): string[] {
  if (r.changeClass === 'UNSPECIFIED' && r.completionEffect === 'UNSPECIFIED')
    return [];
  const gaps: string[] = [];
  if (r.authority !== 'SOURCE_EXPLICIT')
    gaps.push('CANDIDATE_REVISION_RULE_NOT_SOURCE_AUTHORITY');
  if (r.from.kind === 'UNRESOLVED' || r.to.kind === 'UNRESOLVED')
    gaps.push('REVISION_RULE_EXACT_ENDPOINT_NOT_VERIFIED');
  if (!Object.keys(r.scope).length)
    gaps.push('REVISION_RULE_SCOPE_NOT_VERIFIED');
  if (typeof r.rawFields.basis !== 'string' || !r.rawFields.basis.trim())
    gaps.push('REVISION_RULE_SOURCE_BASIS_NOT_CAPTURED');
  return gaps;
}
export function packageGaps(p: Omit<TdmsSourcePackage, 'artifacts'>): string[] {
  const gaps = new Set(p.coverage.gaps);
  if (
    p.query.scopeMatch !== 'MATCHED' ||
    p.query.actualCriteria === null ||
    canonical(p.query.requestedCriteria) !== canonical(p.query.actualCriteria)
  )
    gaps.add('QUERY_CRITERIA_NOT_VERIFIED_MATCH');
  if (p.coverage.readback !== 'CONSISTENT')
    gaps.add('SOURCE_READBACK_NOT_ATOMIC_VERIFIED');
  if (p.readFailures.length) gaps.add('SOURCE_READ_FAILURES');
  for (const r of p.records) {
    for (const gap of r.coverage.gaps) gaps.add(gap);
    if (
      r.coverage.status !== 'COMPLETE' ||
      r.coverage.readback !== 'CONSISTENT'
    )
      gaps.add('RECORD_COVERAGE_INCOMPLETE');
    if (r.sourceVersion.confirmation === 'VERSION_UNCONFIRMED')
      gaps.add('SOURCE_VERSION_UNCONFIRMED');
    if (r.unreadAttachments?.length) gaps.add('ATTACHMENTS_NOT_READ');
  }
  for (const r of p.relations) {
    for (const gap of relationVerificationGaps(r)) gaps.add(gap);
    for (const gap of r.coverage.gaps) gaps.add(gap);
    if (
      r.coverage.status !== 'COMPLETE' ||
      r.coverage.readback !== 'CONSISTENT'
    )
      gaps.add('RELATION_COVERAGE_INCOMPLETE');
    if (r.from.kind === 'UNRESOLVED' || r.to.kind === 'UNRESOLVED')
      gaps.add('RELATION_ENDPOINT_UNRESOLVED');
  }
  return [...gaps].sort();
}
