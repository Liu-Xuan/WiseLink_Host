import type {
  TdmsCoverage,
  TdmsRecordKind,
  TdmsSourceContent,
  TdmsSourceVersion,
} from '@shared/tdms-source.interface';
import type { TdmsImportMemberClaims } from './tdms-source.types';
import { tdmsError } from './tdms-source.types';
import {
  canonical,
  hash,
  TDMS_SMALL_PACKAGE_MAX_BYTES,
} from './tdms-source.validation';

/** Frozen collector wire contract; this preparation does not register an ingress or grant rights. */
export interface TdmsDailyMetadataRecord {
  snapshotId: string;
  sourceRecordId: string;
  kind: TdmsRecordKind | 'AEO' | 'EXECUTION_FEEDBACK' | 'EXECUTION_STATUS';
  number: string;
  sourceVersion: TdmsSourceVersion;
  businessVersion: TdmsSourceVersion | null;
  state: { rawCode: string | null; rawName: string | null };
  observedAt: string;
  sourceModifiedAt: string | null;
  authors: Record<string, unknown>[];
  rawFields: Record<string, unknown>;
  content: TdmsSourceContent;
  provenance: Array<{
    fieldPath: string;
    selector: string;
    sourceModifiedAt: string | null;
    observationRef: string;
  }>;
  coverage: TdmsCoverage;
}
export interface TdmsDailyObservedEdge {
  edgeId: string;
  fromSourceRecordId: string;
  toSourceRecordId: string;
  fromSnapshotId: string | null;
  toSnapshotId: string | null;
  nativeRelationId: null;
  relationKind: string;
  evidenceLocator: string;
  observedAt: string;
  confidence: 'observed_unresolved';
}
export interface TdmsDailyMetadataPackage {
  schemaVersion: 'wiselink.tdms-daily-package.v1';
  packageId: string;
  sourceSystem: 'TDMS';
  observedAt: string;
  coverage: TdmsCoverage;
  query: Record<string, unknown>;
  records: TdmsDailyMetadataRecord[];
  edges: TdmsDailyObservedEdge[];
  artifactBindings: TdmsDailyArtifactObservation[];
  readFailures: Array<{
    sourceRecordId: string | null;
    code: string;
    detail?: string;
  }>;
}
export interface TdmsDailyMetadataEnvelope {
  requestId: string;
  package: TdmsDailyMetadataPackage;
}
/** Collector declarations, never a FileService selection or Host byte verification. */
export interface TdmsDailyArtifactObservation {
  bindingId: string;
  ownerSnapshotId: string;
  sourceAttachmentId: string | null;
  role: string;
  filename: string;
  mediaType: string;
  blobSha256: string;
  byteLength: number;
  sourceVersion: TdmsSourceVersion;
  observedAt: string;
  evidenceLocator: string;
}
/** Exact ten-key receipt accepted by the frozen host-client; never synthesized by preparation. */
export interface TdmsDailyMetadataImportReceipt {
  schemaVersion: 'wiselink.tdms-source-import-receipt.v1';
  requestId: string;
  payloadDigest: string;
  status: 'IMPORTED';
  importedAt: string;
  sourceRefs: string[];
  objectCount: number;
  relationCount: number;
  artifactCount: number;
  documentVersionMappings: Array<{
    requestId: string;
    bindingId: string;
    sourceRef: string;
    status: 'REVIEW_REQUIRED';
    documentVersionId: null;
    preflightId: null;
    sha256: string;
    byteLength: number;
    readbackVerified: false;
    mappedAt: string;
  }>;
}

const nativePattern =
  /^(?:OR|VR):(?:wt\.doc\.WTDocument|wt\.change2\.WTChangeOrder2|wt\.change2\.WTChangeRequest2|wt\.epm\.EPMDocument|wt\.part\.WTPart|com\.airchina\.tdms\.statuslink\.TDMSStatusLink):[0-9]{1,24}$/u;
const privateKey =
  /^(?:cookie|cookies|authorization|password|accessToken|refreshToken|headers|transientUrl|downloadUrl|html|rawDom|actorUserId|tenantId|roles|runtimeIngestAuthority|authority)$/iu;
const secret =
  /(?:AUTH_CODE\s*=|Cookie\s*:|Authorization\s*:|Bearer\s+|[?&](?:sign|sig|token|access_token|ticket|session)=)/iu;

/** Lossless, detached metadata preparation. All member entries remain untrusted source claims. */
export function prepareTdmsDailyMetadataImport(raw: unknown) {
  return prepareDailyImport(raw, false);
}
/** Same frozen wire, explicitly wider source adapter; old metadata validator stays exact. */
export function prepareTdmsDailySourceImport(raw: unknown) {
  return prepareDailyImport(raw, true);
}
function prepareDailyImport(raw: unknown, sourceAdapter: boolean) {
  const envelope = exact(plainData(raw), ['requestId', 'package']);
  const p = exact(envelope.package, [
    'schemaVersion',
    'packageId',
    'sourceSystem',
    'observedAt',
    'coverage',
    'query',
    'records',
    'edges',
    'artifactBindings',
    'readFailures',
  ]);
  if (
    p.schemaVersion !== 'wiselink.tdms-daily-package.v1' ||
    p.sourceSystem !== 'TDMS'
  )
    fail('SCHEMA_INVALID');
  text(p.packageId, 160);
  iso(p.observedAt);
  coverage(p.coverage);
  query(p.query);
  const records = list(p.records, 500),
    edges = list(p.edges, 1000);
  if (!sourceAdapter && list(p.artifactBindings, 1000).length)
    fail('ARTIFACT_INGRESS_NOT_IMPLEMENTED');
  const snapshots = new Map<string, string>(),
    sourceIds = new Set<string>();
  for (const value of records) {
    const r = exact(value, [
      'snapshotId',
      'sourceRecordId',
      'kind',
      'number',
      'sourceVersion',
      'businessVersion',
      'state',
      'observedAt',
      'sourceModifiedAt',
      'authors',
      'rawFields',
      'content',
      'provenance',
      'coverage',
    ]);
    if (
      !(
        sourceAdapter
          ? [
              'MANUFACTURER_FILE',
              'PROCESSING_SHEET',
              'ENGINEER_ASSESSMENT',
              'COMMENT',
              'ENGINEERING_FILE',
              'OBSERVATION',
              'AEO',
              'EXECUTION_FEEDBACK',
              'EXECUTION_STATUS',
            ]
          : ['AEO', 'EXECUTION_STATUS']
      ).includes(String(r.kind))
    )
      fail('METADATA_KIND_UNSUPPORTED');
    native(r.sourceRecordId);
    text(r.number, 180);
    iso(r.observedAt);
    version(r.sourceVersion);
    if (r.businessVersion !== null) version(r.businessVersion, true);
    timeOrder(r.observedAt, p.observedAt);
    if (r.sourceModifiedAt !== null) {
      iso(r.sourceModifiedAt);
      timeOrder(r.sourceModifiedAt, r.observedAt);
    }
    rawCode(r.state);
    coverage(r.coverage);
    exact(
      r.content,
      sourceAdapter
        ? [
            'opinions',
            'ownedVisibleBusinessContent',
            'conditions',
            'requiredActions',
            'approvers',
            'sourceEvents',
            'executionDeclaration',
            'futureLcmLinks',
          ]
        : [],
      [],
    );
    for (const author of list(r.authors, 1000)) {
      const a = exact(
        author,
        ['sourcePersonId', 'name', 'displayName', 'role'],
        [],
      );
      for (const [key, value] of Object.entries(a))
        if (value !== null) text(value, key === 'sourcePersonId' ? 160 : 120);
    }
    for (const value of list(r.provenance, 1000)) {
      const f = exact(value, [
        'fieldPath',
        'selector',
        'sourceModifiedAt',
        'observationRef',
      ]);
      text(f.fieldPath, 200);
      text(f.selector, 300);
      if (f.observationRef !== r.sourceRecordId)
        fail('PROVENANCE_OWNER_INVALID');
      if (f.sourceModifiedAt !== null) iso(f.sourceModifiedAt);
    }
    const base = [
      'number',
      'storageType',
      'businessType',
      'oem',
      'issuer',
      'sourceModifiedRaw',
      'unresolvedRelations',
      'ataChapters',
      'createdBy',
      'attachmentObservations',
    ];
    const fields = exact(
      r.rawFields,
      [
        ...base,
        ...(sourceAdapter ? ['opinionCollection', 'ownedBusinessContent'] : []),
        ...(sourceAdapter
          ? ['execution', 'engineering', 'executionStatus']
          : r.kind === 'AEO'
            ? ['execution', 'engineering']
            : ['executionStatus']),
      ],
      [],
    );
    if (fields.number !== undefined && fields.number !== r.number)
      fail('NUMBER_CONFLICT');
    for (const key of ['storageType', 'businessType'])
      if (fields[key] != null) rawCode(fields[key]);
    for (const key of ['oem', 'issuer', 'sourceModifiedRaw', 'createdBy'])
      if (fields[key] !== undefined) text(fields[key], 120);
    if (
      fields.ataChapters !== undefined &&
      list(fields.ataChapters, 40).some(
        (v) => typeof v !== 'string' || !/^\d{2}(?:-\d{2})?$/u.test(v),
      )
    )
      fail('ATA_INVALID');
    if (fields.engineering !== undefined) engineering(fields.engineering, r);
    if (fields.execution !== undefined)
      execution(fields.execution, r.observedAt);
    if (r.kind === 'EXECUTION_STATUS')
      executionStatus(fields.executionStatus, r);
    if (
      r.kind === 'AEO' &&
      !/^(?:OR|VR):wt\.epm\.EPMDocument:\d{1,24}$/u.test(
        String(r.sourceRecordId),
      )
    )
      fail('ENGINEERING_OWNER_INVALID');
    if (fields.unresolvedRelations !== undefined)
      for (const value of list(fields.unresolvedRelations, 320)) {
        const relation = exact(value, [
          'rawKind',
          'fromSourceRecordId',
          'toSourceRecordId',
          'selector',
          'versionGap',
        ]);
        if (
          !['SB RelationShip tree parent-child', 'EFR Document Table'].includes(
            String(relation.rawKind),
          ) ||
          relation.versionGap !== 'RELATION_ID_UNOBSERVED'
        )
          fail('RELATION_EVIDENCE_INVALID');
        native(relation.fromSourceRecordId);
        native(relation.toSourceRecordId);
        text(relation.selector, 300);
      }
    if (fields.attachmentObservations !== undefined)
      attachmentObservations(fields.attachmentObservations, r, p.observedAt);
    if (
      r.snapshotId !==
        'TDMSSNAP-' +
          hash(
            withoutTimes(
              sourceAdapter && fields.ownedBusinessContent !== undefined
                ? ownedLocatorIdentity(r)
                : r,
            ),
          ) ||
      snapshots.has(String(r.snapshotId)) ||
      sourceIds.has(String(r.sourceRecordId))
    )
      fail('SNAPSHOT_INVALID');
    snapshots.set(String(r.snapshotId), String(r.sourceRecordId));
    sourceIds.add(String(r.sourceRecordId));
  }
  // This source mode is an independently collected owner probe, not a batch opinion approval.
  if (
    sourceAdapter &&
    records.some(
      (r) => object(object(r).rawFields).ownedBusinessContent !== undefined,
    ) &&
    (records.length !== 1 ||
      list(p.artifactBindings, 1000).length ||
      object(p.coverage).status !== 'PARTIAL' ||
      object(p.coverage).readback !== 'NON_ATOMIC' ||
      !(object(p.coverage).gaps as string[]).includes('PROBE_ONLY') ||
      object(p.query).scopeComplete !== false ||
      object(p.query).scopeMatch !== 'UNKNOWN' ||
      object(p.query).actualCriteria !== null)
  )
    fail('OWN_CONTENT_PROBE_REQUIRED');
  const bindings = list(p.artifactBindings, 1000);
  const bindingIds = new Set<string>();
  for (const value of bindings) {
    const b = exact(value, [
      'bindingId',
      'ownerSnapshotId',
      'sourceAttachmentId',
      'role',
      'filename',
      'mediaType',
      'blobSha256',
      'byteLength',
      'sourceVersion',
      'observedAt',
      'evidenceLocator',
    ]);
    const owner = records.find(
      (r) => object(r).snapshotId === b.ownerSnapshotId,
    ) as TdmsDailyMetadataRecord | undefined;
    if (
      !owner ||
      bindingIds.has(String(b.bindingId)) ||
      typeof b.blobSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(b.blobSha256) ||
      !Number.isSafeInteger(b.byteLength) ||
      Number(b.byteLength) < 1 ||
      Number(b.byteLength) > 100 * 1024 * 1024
    )
      fail('ARTIFACT_INVALID');
    if (b.sourceAttachmentId !== null) text(b.sourceAttachmentId, 160);
    text(b.role, 80);
    text(b.filename, 255);
    text(b.mediaType, 120);
    text(b.evidenceLocator, 500);
    iso(b.observedAt);
    timeOrder(b.observedAt, p.observedAt);
    version(b.sourceVersion);
    if (
      owner.sourceVersion.confirmation !== 'SOURCE_DECLARED' ||
      canonical(owner.sourceVersion) !== canonical(b.sourceVersion)
    )
      fail('ARTIFACT_OWNER_VERSION_UNVERIFIED');
    const { bindingId, ...identity } = b;
    if (bindingId !== 'TDMSBIND-' + hash(withoutTimes(identity)))
      fail('ARTIFACT_BINDING_INVALID');
    bindingIds.add(String(bindingId));
  }
  const edgeIds = new Set<string>();
  for (const value of edges) {
    const e = exact(value, [
      'edgeId',
      'fromSourceRecordId',
      'toSourceRecordId',
      'fromSnapshotId',
      'toSnapshotId',
      'nativeRelationId',
      'relationKind',
      'evidenceLocator',
      'observedAt',
      'confidence',
    ]);
    native(e.fromSourceRecordId);
    const ownedRecord = sourceAdapter
      ? records.find(
          (r) =>
            object(r).snapshotId === e.fromSnapshotId &&
            object(r).sourceRecordId === e.fromSourceRecordId &&
            object(object(r).rawFields).ownedBusinessContent !== undefined,
        )
      : undefined;
    const ownedProof = ownedRecord
      ? object(object(object(ownedRecord).rawFields).ownedBusinessContent)
      : undefined;
    const lastRead = Array.isArray(ownedProof?.reads)
      ? object(ownedProof.reads[1])
      : undefined;
    const observedLink =
      lastRead &&
      Array.isArray(lastRead.relationTables) &&
      lastRead.relationTables.some((value) => {
        const table = object(value);
        return (
          table.tableTitle === e.relationKind &&
          Array.isArray(table.rows) &&
          table.rows.some(
            (value) =>
              Array.isArray(object(value).sourceLinks) &&
              (object(value).sourceLinks as unknown[]).some(
                (value) =>
                  object(value).targetRef === e.toSourceRecordId &&
                  object(value).evidenceLocator === e.evidenceLocator,
              ),
          )
        );
      });
    if (
      ownedProof &&
      (!observedLink ||
        e.toSnapshotId !== null ||
        e.toSourceRecordId === e.fromSourceRecordId)
    )
      fail('RELATION_EVIDENCE_INVALID');
    if (
      !(
        observedLink &&
        ownedProof?.profileId === 'AD_PROCESSING_FORM' &&
        typeof e.toSourceRecordId === 'string' &&
        /^(?:OR|VR):wt\.change2\.WTChangeActivity2:[0-9]{1,24}$/u.test(
          e.toSourceRecordId,
        )
      )
    )
      native(e.toSourceRecordId);
    text(e.relationKind, 120);
    text(e.evidenceLocator, 300);
    iso(e.observedAt);
    timeOrder(e.observedAt, p.observedAt);
    if (e.confidence !== 'observed_unresolved' || e.nativeRelationId !== null)
      fail('NATIVE_RELATION_UNPROVEN');
    if (e.fromSnapshotId === null && e.toSnapshotId === null)
      fail('RELATION_ENDPOINT_INVALID');
    for (const [id, ref] of [
      [e.fromSnapshotId, e.fromSourceRecordId],
      [e.toSnapshotId, e.toSourceRecordId],
    ])
      if (id !== null && snapshots.get(String(id)) !== ref)
        fail('RELATION_ENDPOINT_INVALID');
    const { edgeId, ...identity } = e;
    if (
      edgeId !== 'TDMSEDGE-' + hash(withoutTimes(identity)) ||
      edgeIds.has(String(edgeId))
    )
      fail('RELATION_ID_INVALID');
    edgeIds.add(String(edgeId));
  }
  for (const value of list(p.readFailures, 1000)) {
    const f = exact(
      value,
      ['sourceRecordId', 'code', 'detail'],
      ['sourceRecordId', 'code'],
    );
    if (f.sourceRecordId !== null) native(f.sourceRecordId);
    if (typeof f.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,119}$/u.test(f.code))
      fail('READ_FAILURE_INVALID');
    if (f.detail !== undefined) text(f.detail, 300);
  }
  const pkg = p as unknown as TdmsDailyMetadataPackage;
  if (
    pkg.coverage.status === 'COMPLETE' &&
    (pkg.coverage.gaps.length ||
      pkg.readFailures.length ||
      pkg.coverage.readback !== 'CONSISTENT' ||
      pkg.query.scopeComplete !== true ||
      pkg.edges.length ||
      pkg.records.some(
        (r) =>
          r.coverage.status !== 'COMPLETE' ||
          r.coverage.gaps.length ||
          r.sourceVersion.confirmation !== 'SOURCE_DECLARED',
      ))
  )
    fail('COMPLETE_COVERAGE_UNPROVEN');
  const payloadDigest = hash(pkg);
  if (envelope.requestId !== 'TDMSIMPORT-' + payloadDigest)
    fail('REQUEST_DIGEST_MISMATCH');
  const sourceRefs = expectedSourceRefs(pkg);
  const memberClaims: TdmsImportMemberClaims = {
    records: pkg.records.map((r) => ({
      recordKind: r.kind,
      sourceRecordId: r.sourceRecordId,
    })),
    artifacts: pkg.artifactBindings.map((b) => ({
      memberId: b.bindingId,
      sourceAttachmentId: b.sourceAttachmentId,
      sourceAttachmentVersion: null,
      owners: pkg.records
        .filter((r) => r.snapshotId === b.ownerSnapshotId)
        .map((r) => ({ recordKind: r.kind, sourceRecordId: r.sourceRecordId })),
    })),
    // Observation retention keys, NOT native relationship IDs or independent rights.
    relationIds: pkg.edges.map((e) => e.edgeId),
    relatedDocumentVersionIds: [],
  };
  return {
    envelope: envelope as unknown as TdmsDailyMetadataEnvelope,
    payloadDigest,
    sourceRefs,
    memberClaims,
    authority: 'NOT_GRANTED_BY_PREPARATION' as const,
  };
}

/** Validate a saved receipt only. An IMPORTED value is never emitted by the preparation helper. */
export function validateTdmsDailyMetadataImportReceipt(
  raw: unknown,
  envelope: unknown,
  sourceAdapter = false,
): TdmsDailyMetadataImportReceipt {
  const prepared = sourceAdapter
      ? prepareTdmsDailySourceImport(envelope)
      : prepareTdmsDailyMetadataImport(envelope),
    pkg = prepared.envelope.package;
  const r = exact(plainData(raw), [
    'schemaVersion',
    'requestId',
    'payloadDigest',
    'status',
    'importedAt',
    'sourceRefs',
    'objectCount',
    'relationCount',
    'artifactCount',
    'documentVersionMappings',
  ]);
  if (
    r.schemaVersion !== 'wiselink.tdms-source-import-receipt.v1' ||
    r.status !== 'IMPORTED' ||
    r.requestId !== prepared.envelope.requestId
  )
    fail('RECEIPT_IDENTITY_MISMATCH');
  iso(r.importedAt);
  if (r.payloadDigest !== prepared.payloadDigest)
    fail('RECEIPT_PAYLOAD_MISMATCH');
  if (
    r.objectCount !== pkg.records.length ||
    r.relationCount !== pkg.edges.length ||
    r.artifactCount !== pkg.artifactBindings.length
  )
    fail('RECEIPT_COUNTS_MISMATCH');
  const wanted = new Set(prepared.sourceRefs),
    actual = list(r.sourceRefs, 10000);
  if (
    actual.length !== wanted.size ||
    actual.some((ref) => typeof ref !== 'string' || !wanted.delete(ref)) ||
    wanted.size
  )
    fail('RECEIPT_SOURCE_REFS_INVALID');
  const mappings = list(r.documentVersionMappings, 1000);
  if (mappings.length !== pkg.artifactBindings.length)
    fail('RECEIPT_DOCUMENT_MAPPINGS_INVALID');
  for (const [index, value] of mappings.entries()) {
    const m = exact(value, [
      'requestId',
      'bindingId',
      'sourceRef',
      'status',
      'documentVersionId',
      'preflightId',
      'sha256',
      'byteLength',
      'readbackVerified',
      'mappedAt',
    ]);
    const b = pkg.artifactBindings[index]!;
    if (
      m.requestId !== prepared.envelope.requestId ||
      m.bindingId !== b.bindingId ||
      m.sourceRef !== 'TDMS:ARTIFACT:' + b.bindingId ||
      m.status !== 'REVIEW_REQUIRED' ||
      m.documentVersionId !== null ||
      m.preflightId !== null ||
      m.sha256 !== b.blobSha256 ||
      m.byteLength !== b.byteLength ||
      m.readbackVerified !== false ||
      m.mappedAt !== r.importedAt
    )
      fail('RECEIPT_DOCUMENT_MAPPINGS_INVALID');
  }
  return r as unknown as TdmsDailyMetadataImportReceipt;
}

/** The collector's optional stored-import envelope must retain the exact expected package. */
export function validateTdmsDailyMetadataImportReadback(
  raw: unknown,
  expectedEnvelope: unknown,
): TdmsDailyMetadataImportReceipt {
  const value = plainData(raw),
    parsed = object(value);
  if (Object.hasOwn(parsed, 'receipt')) {
    exact(parsed, ['receipt', 'package']);
    const expected = prepareTdmsDailyMetadataImport(expectedEnvelope);
    if (canonical(parsed.package) !== canonical(expected.envelope.package))
      fail('READBACK_PACKAGE_MISMATCH');
    return validateTdmsDailyMetadataImportReceipt(
      parsed.receipt,
      expected.envelope,
    );
  }
  return validateTdmsDailyMetadataImportReceipt(parsed, expectedEnvelope);
}

function expectedSourceRefs(pkg: TdmsDailyMetadataPackage): string[] {
  return [
    ...pkg.records.flatMap((r) => [
      'TDMS:SNAPSHOT:' + r.snapshotId,
      ...r.provenance.map((_, i) => 'TDMS:FIELD:' + r.snapshotId + ':' + i),
    ]),
    ...pkg.edges.map((e) => 'TDMS:RELATION:' + e.edgeId),
    ...pkg.artifactBindings.map((b) => 'TDMS:ARTIFACT:' + b.bindingId),
  ];
}
/** Collector comparison identity only; original locators stay byte-for-byte in the envelope. */
function ownedLocatorIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ownedLocatorIdentity);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      typeof v === 'string' &&
      ['panelLocator', 'locator', 'selector'].includes(k)
        ? v.replace(
            /^#infoPage_myTab_tab_jcaGen_\d+(?=\s|$)/u,
            '#infoPage_myTab_tab_jcaGen_DYNAMIC',
          )
        : ownedLocatorIdentity(v),
    ]),
  );
}
function fail(code: string): never {
  throw tdmsError('TDMS_DAILY_' + code);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('FIELDS_INVALID');
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: string[], required = keys) {
  const o = object(value);
  if (
    Object.keys(o).some((k) => !keys.includes(k)) ||
    required.some((k) => !Object.hasOwn(o, k))
  )
    fail('FIELDS_INVALID');
  return o;
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail('LIMIT');
  return value;
}
function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    fail('STRING_INVALID');
}
function native(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !nativePattern.test(value))
    fail('SOURCE_ID_INVALID');
}
function iso(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    fail('TIME_INVALID');
  const normalized =
    value.slice(0, 19) +
    '.' +
    (value.match(/\.(\d{1,3})Z$/u)?.[1] || '0').padEnd(3, '0') +
    'Z';
  if (new Date(value).toISOString() !== normalized) fail('TIME_INVALID');
}
function timeOrder(earlier: unknown, later: unknown) {
  if (Date.parse(String(earlier)) > Date.parse(String(later)))
    fail('TIME_INVALID');
}
function rawCode(value: unknown) {
  const o = exact(value, ['rawCode', 'rawName']);
  for (const field of Object.values(o)) if (field !== null) text(field, 120);
}
function version(value: unknown, business = false) {
  const o = exact(value, ['rawRevision', 'rawIteration', 'confirmation']);
  if (
    !['SOURCE_DECLARED', 'VERSION_UNCONFIRMED'].includes(String(o.confirmation))
  )
    fail('VERSION_INVALID');
  for (const field of [o.rawRevision, o.rawIteration])
    if (field !== null) text(field, 80);
  if (
    o.confirmation === 'SOURCE_DECLARED' &&
    (o.rawRevision === null || (!business && o.rawIteration === null))
  )
    fail('VERSION_INVALID');
}
function coverage(value: unknown) {
  const o = exact(value, ['status', 'gaps', 'readback']);
  if (
    !['PARTIAL', 'COMPLETE'].includes(String(o.status)) ||
    !['NON_ATOMIC', 'CONSISTENT', 'NOT_VERIFIED'].includes(
      String(o.readback),
    ) ||
    list(o.gaps, 300).some(
      (v) => typeof v !== 'string' || !/^[A-Z][A-Z0-9_]{0,119}$/u.test(v),
    )
  )
    fail('COVERAGE_INVALID');
  if (
    o.status === 'COMPLETE' &&
    ((o.gaps as unknown[]).length || o.readback !== 'CONSISTENT')
  )
    fail('COMPLETE_COVERAGE_UNPROVEN');
}
function query(value: unknown) {
  const q = exact(
    value,
    [
      'requestedCriteria',
      'actualCriteria',
      'scopeMatch',
      'scopeComplete',
      'fixtureKind',
      'sourceFixtureSha256',
      'sixAssessmentsEvidence',
      'creatorIsNotOpinionAuthor',
    ],
    [],
  );
  if (
    q.scopeMatch !== undefined &&
    !['MATCHED', 'MISMATCH', 'UNKNOWN'].includes(String(q.scopeMatch))
  )
    fail('QUERY_INVALID');
  if (q.scopeComplete !== undefined && typeof q.scopeComplete !== 'boolean')
    fail('QUERY_INVALID');
  if (q.requestedCriteria !== undefined) {
    const r = exact(
      q.requestedCriteria,
      [
        'documentCode',
        'objectType',
        'keyword',
        'nativeClass',
        'sourceObjectRef',
        'sourceVersion',
      ],
      [],
    );
    for (const key of ['documentCode', 'objectType', 'keyword', 'nativeClass'])
      if (r[key] !== undefined) text(r[key], 200);
    if (r.sourceObjectRef !== undefined) native(r.sourceObjectRef);
    if (r.sourceVersion !== undefined) {
      const v = exact(r.sourceVersion, ['rawRevision', 'rawIteration']);
      text(v.rawRevision, 80);
      text(v.rawIteration, 80);
    }
  }
  if (q.actualCriteria !== undefined && q.actualCriteria !== null) {
    const a = exact(q.actualCriteria, [
      'objectTypes',
      'keyword',
      'gridNativeClass',
      'count',
      'visibleRowCount',
      'contextRaw',
    ]);
    list(a.objectTypes, 10).forEach((v) => text(v, 120));
    for (const key of ['keyword', 'gridNativeClass', 'contextRaw'])
      if (a[key] !== null) text(a[key], key === 'contextRaw' ? 2000 : 200);
    for (const key of ['count', 'visibleRowCount'])
      if (
        a[key] !== null &&
        (!Number.isSafeInteger(a[key]) || Number(a[key]) < 0)
      )
        fail('QUERY_INVALID');
  }
}
function engineering(value: unknown, r: Record<string, unknown>) {
  const o = exact(value, [
    'orderType',
    'documentNumber',
    'title',
    'applicableModel',
    'customer',
    'effectiveDateRaw',
    'issueDateRaw',
    'executionModeRaw',
    'processingSheetNumber',
  ]);
  for (const field of Object.values(o)) if (field !== null) text(field, 1000);
  if (
    o.orderType !== 'AEO' ||
    !/^(?:OR|VR):wt\.epm\.EPMDocument:\d{1,24}$/u.test(String(r.sourceRecordId))
  )
    fail('ENGINEERING_OWNER_INVALID');
  text(o.documentNumber, 180);
}
function executionStatus(value: unknown, r: Record<string, unknown>) {
  const o = exact(value, [
    'engineeringDocumentRef',
    'engineeringDocumentNumber',
    'assetRef',
    'assetNumber',
    'feedbackRef',
    'feedbackNumber',
    'executedDateRaw',
    'stateComments',
    'expiredDateRaw',
    'operatorBase',
  ]);
  if (
    !/^OR:com\.airchina\.tdms\.statuslink\.TDMSStatusLink:\d{1,24}$/u.test(
      String(r.sourceRecordId),
    ) ||
    !/^(?:OR|VR):wt\.epm\.EPMDocument:\d{1,24}$/u.test(
      String(o.engineeringDocumentRef),
    ) ||
    !/^(?:OR|VR):wt\.part\.WTPart:\d{1,24}$/u.test(String(o.assetRef)) ||
    (o.feedbackRef !== null &&
      !/^(?:OR|VR):wt\.doc\.WTDocument:\d{1,24}$/u.test(String(o.feedbackRef)))
  )
    fail('EXECUTION_STATUS_ID_INVALID');
  text(o.engineeringDocumentNumber, 180);
  text(o.assetNumber, 180);
  for (const key of [
    'feedbackNumber',
    'executedDateRaw',
    'stateComments',
    'expiredDateRaw',
    'operatorBase',
  ])
    if (o[key] !== null) text(o[key], 1000);
  if ((o.feedbackRef === null) !== (o.feedbackNumber === null))
    fail('EXECUTION_FEEDBACK_IDENTITY_INCOMPLETE');
}
function execution(value: unknown, observedAt: unknown) {
  const o = exact(value, [
    'status',
    'executedAt',
    'executionDateRaw',
    'feedbackAt',
    'feedbackDateRaw',
    'plannedAt',
    'plannedDateRaw',
    'evidenceLocator',
  ]);
  if (!['executed', 'not_established'].includes(String(o.status)))
    fail('EXECUTION_INVALID');
  text(o.evidenceLocator, 300);
  for (const key of ['executionDateRaw', 'feedbackDateRaw', 'plannedDateRaw'])
    if (o[key] !== null) text(o[key], 120);
  for (const key of ['executedAt', 'feedbackAt', 'plannedAt'])
    if (o[key] !== null) iso(o[key]);
  if (o.executedAt !== null) timeOrder(o.executedAt, observedAt);
  if (o.feedbackAt !== null) timeOrder(o.feedbackAt, observedAt);
  if (
    (o.status === 'executed' &&
      (o.executedAt === null ||
        /TBD|预计|计划|待定|未执行/iu.test(
          String(o.executionDateRaw ?? ''),
        ))) ||
    (o.status === 'not_established' && o.executedAt !== null)
  )
    fail('EXECUTION_NOT_ESTABLISHED');
}
function attachmentObservations(
  value: unknown,
  r: Record<string, unknown>,
  observedAt: unknown,
) {
  for (const item of list(value, 200)) {
    const a = exact(item, [
      'sourceAttachmentId',
      'role',
      'filename',
      'format',
      'sizeRaw',
      'ownerTechnicalVersion',
      'ownerBusinessVersion',
      'observedAt',
      'evidenceLocator',
      'bytesCollected',
    ]);
    if (
      (a.sourceAttachmentId !== null &&
        !/^OR:wt\.content\.ApplicationData:\d{1,24}$/u.test(
          String(a.sourceAttachmentId),
        )) ||
      !['PRIMARY', 'SECONDARY'].includes(String(a.role)) ||
      a.bytesCollected !== false
    )
      fail('ATTACHMENT_OBSERVATION_INVALID');
    text(a.filename, 200);
    text(a.format, 80);
    text(a.sizeRaw, 80);
    text(a.evidenceLocator, 300);
    iso(a.observedAt);
    timeOrder(a.observedAt, observedAt);
    version(a.ownerTechnicalVersion);
    if (a.ownerBusinessVersion !== null) version(a.ownerBusinessVersion, true);
    if (
      canonical(a.ownerTechnicalVersion) !== canonical(r.sourceVersion) ||
      canonical(a.ownerBusinessVersion) !== canonical(r.businessVersion)
    )
      fail('ATTACHMENT_HOLDER_VERSION_MISMATCH');
  }
}
function withoutTimes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutTimes);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !['observedAt', 'itemId', 'snapshotId', 'lastSeenAt'].includes(key),
      )
      .map(([key, value]) => [key, withoutTimes(value)]),
  );
}
/** No getters, identity claims, secrets, JSON omissions, prototype coercion or raw-body side effects. */
function plainData(value: unknown): unknown {
  let visited = 0;
  const walk = (v: unknown, depth: number): unknown => {
    if (++visited > 50000 || depth > 25) fail('LIMIT');
    if (
      v === null ||
      typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isFinite(v))
    )
      return v;
    if (typeof v === 'string') {
      if (
        v.length > 100000 ||
        secret.test(v) ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v)
      )
        fail('SENSITIVE_VALUE_REJECTED');
      return v;
    }
    if (!v || typeof v !== 'object') fail('DATA_INVALID');
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (Object.getOwnPropertySymbols(v).length) fail('DATA_INVALID');
    if (Array.isArray(v)) {
      if (
        v.length > 10000 ||
        Object.keys(descriptors).some(
          (k) => k !== 'length' && !/^(?:0|[1-9]\d*)$/u.test(k),
        )
      )
        fail('LIMIT');
      return Array.from({ length: v.length }, (_, i) => {
        const d = descriptors[String(i)];
        if (!d || !Object.hasOwn(d, 'value') || !d.enumerable)
          fail('ACCESSOR_REJECTED');
        return walk(d.value, depth + 1);
      });
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(v)))
      fail('DATA_INVALID');
    const result: Record<string, unknown> = {};
    for (const [key, d] of Object.entries(descriptors)) {
      if (
        !Object.hasOwn(d, 'value') ||
        !d.enumerable ||
        ['__proto__', 'prototype', 'constructor'].includes(key)
      )
        fail('ACCESSOR_REJECTED');
      if (privateKey.test(key)) fail('RESERVED_CLAIM_REJECTED');
      result[key] = walk(d.value, depth + 1);
    }
    return result;
  };
  const result = walk(value, 0);
  if (Buffer.byteLength(canonical(result)) > TDMS_SMALL_PACKAGE_MAX_BYTES)
    fail('LIMIT');
  return result;
}
