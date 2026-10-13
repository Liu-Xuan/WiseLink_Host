import { createHash } from 'node:crypto';
import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import type { TdmsDailyMetadataEnvelope } from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import {
  copyComplete,
  sealComplete,
  syntheticCompleteEnvelope,
  withCompleteRelation,
} from './tdms-complete-owned.fixture';

// Synthetic wire literals, not source samples, credentials, source authority or upload selections.
export const proofOfCurrent = (env: TdmsDailyMetadataEnvelope): any =>
  env.package.records[0].rawFields.completeOwnedSource;
export function resealCurrent(env: TdmsDailyMetadataEnvelope) {
  sealComplete(env);
  for (const edge of env.package.edges) {
    edge.fromSnapshotId = env.package.records[0].snapshotId;
    const { edgeId: ignored, observedAt: ignoredTime, ...identity } = edge;
    void ignored;
    void ignoredTime;
    edge.edgeId = 'TDMSEDGE-' + hash(identity);
  }
  env.requestId = 'TDMSIMPORT-' + hash(env.package);
  return env;
}
export function currentOwnReference(
  kind: 'current' | 'outside' | 'unknown' = 'current',
) {
  const env = syntheticCompleteEnvelope(),
    r = env.package.records[0],
    p = proofOfCurrent(env);
  const targetRef =
    kind === 'outside' ? 'OR:wt.org.WTUser:1234' : 'OR:wt.doc.WTDocument:1234';
  const actualLabel =
    kind === 'outside'
      ? 'Created By:'
      : kind === 'current'
        ? 'SB/SL文件编号:'
        : 'Unreviewed reference:';
  const fieldId = p.reads[1].fields[0].fieldId;
  const tableId =
    'OWN_FIELD:' +
    createHash('sha256').update(fieldId).digest('hex').slice(0, 32);
  const rawHref = '/infoPage?oid=' + targetRef,
    locator = '#own field-0 link';
  for (const read of p.reads) {
    read.fields[0].value.actualLabel = actualLabel;
    read.fields[0].links = [
      {
        rawHref,
        targetRef,
        numberRaw: 'SYNTHETIC-TARGET',
        nativeRole: 'RELATED',
        locator,
      },
    ];
  }
  r.content.completeOwnedFields = copyComplete(p.reads[1].fields);
  p.targetOccurrences = [
    {
      origin: 'OWN_FIELD',
      tableId,
      occurrenceId: 'OWN_FIELD:' + hash([fieldId, 0, targetRef]),
      linkIndex: 0,
      targetRef,
      numberRaw: 'SYNTHETIC-TARGET',
      rawHref,
      relationshipRole:
        kind === 'outside'
          ? 'OUT_OF_SCOPE_REFERENCE'
          : kind === 'current'
            ? 'CURRENT_CONTENT'
            : 'UNKNOWN',
      modelRoleOrigin:
        kind === 'outside'
          ? 'REVIEWED_OUT_OF_SCOPE_OWN_FIELD_MODEL'
          : kind === 'current'
            ? 'REVIEWED_OWN_FIELD_MODEL'
            : 'UNREVIEWED_OWN_FIELD',
      rawRole: actualLabel,
      nativeLinkRole: 'RELATED',
      nativeColumnLabel: null,
      nativeColumnToken: null,
      fieldId,
      fieldActualLabel: actualLabel,
      tabId: 'tab-own',
      sectionId: 'section-own',
      direction: kind === 'unknown' ? 'UNKNOWN' : 'SOURCE_TO_TARGET',
      rawDirection: null,
      treePath: [],
      nativeRelationId: null,
      sourceVersion: {
        rawRevision: null,
        rawIteration: null,
        confirmation: 'VERSION_UNCONFIRMED',
      },
      ownerSourceVersion: r.sourceVersion,
      locator,
    },
  ];
  if (kind !== 'outside')
    env.package.edges = [
      {
        edgeId: '',
        fromSourceRecordId: r.sourceRecordId,
        toSourceRecordId: targetRef,
        fromSnapshotId: '',
        toSnapshotId: null,
        nativeRelationId: null,
        relationKind: tableId,
        evidenceLocator: locator,
        observedAt: r.observedAt,
        confidence: 'observed_unresolved',
      },
    ];
  return resealCurrent(env);
}
export function currentManyEdges(count = 201) {
  const env = withCompleteRelation(),
    p = proofOfCurrent(env),
    row = p.reads[1].relationTables[0].rows[0],
    table = p.reads[1].relationTables[0];
  const first = p.targetOccurrences[0];
  table.rows = Array.from({ length: count }, (_, i) => {
    const next = copyComplete(row);
    next.occurrenceId = 'row-' + i;
    next.globalIndex = i;
    next.nativeRowId = 'native-row-' + i;
    next.sourceLinks[0].targetRef =
      'OR:wt.change2.WTChangeActivity2:' + (9000 + i);
    next.sourceLinks[0].rawHref =
      '/infoPage?oid=' + next.sourceLinks[0].targetRef;
    next.sourceLinks[0].locator = '#relations row-' + i + ' Number';
    return next;
  });
  table.reportedTotal = count;
  table.countEvidence.rawText = '(' + count + ' objects)';
  table.windows[0].rowOccurrenceIds = table.rows.map(
    (v: any) => v.occurrenceId,
  );
  table.windows[0].globalIndices = table.rows.map((v: any) => v.globalIndex);
  table.windows[0].reportedTotal = count;
  table.terminal.total = count;
  table.terminal.captured = count;
  for (const read of p.reads) read.relationTables = [copyComplete(table)];
  p.targetOccurrences = table.rows.map((v: any) => ({
    ...copyComplete(first),
    occurrenceId: v.occurrenceId,
    targetRef: v.sourceLinks[0].targetRef,
    rawHref: v.sourceLinks[0].rawHref,
    locator: v.sourceLinks[0].locator,
  }));
  const edge = env.package.edges[0];
  env.package.edges = p.targetOccurrences.map((v: any) => ({
    ...copyComplete(edge),
    toSourceRecordId: v.targetRef,
    evidenceLocator: v.locator,
  }));
  return resealCurrent(env);
}
const op = (value: string) =>
  'TDMSOP-' +
  value.repeat(8) +
  '-' +
  value.repeat(4) +
  '-' +
  value.repeat(4) +
  '-' +
  value.repeat(4) +
  '-' +
  value.repeat(12);
export function currentDerivedOriginal(format = 'PDF', large = false) {
  const env = syntheticCompleteEnvelope('SL'),
    p = proofOfCurrent(env),
    r = env.package.records[0];
  const media: Record<string, string> = {
    PDF: 'application/pdf',
    ZIP: 'application/zip',
    DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    PPTX: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  const sourceAttachmentId = 'OR:wt.content.ApplicationData:9900';
  const filename = 'native-original.misleading.bin';
  const metadata = {
    sourceAttachmentId,
    role: 'PRIMARY',
    filename,
    format,
    sizeRaw: 'native 8 bytes',
    ownerTechnicalVersion: copyComplete(r.sourceVersion),
    ownerBusinessVersion: copyComplete(r.businessVersion),
    observedAt: r.observedAt,
    evidenceLocator: '#primary-row',
    bytesCollected: false,
    metadataRevision: 'tdms-complete-owned-primary-metadata@1',
    metadataState: 'VALUE',
    metadataGapCodes: [],
  };
  for (const read of p.reads) {
    read.attachments = [
      {
        ownerSourceRecordId: r.sourceRecordId,
        sourceVersion: copyComplete(r.sourceVersion),
        sourceAttachmentId,
        role: 'PRIMARY',
        filename,
        rawHref: null,
        locator: '#primary-row',
        state: 'VALUE',
        primaryMetadata: copyComplete(metadata),
      },
    ];
    if (large)
      for (const f of read.fields.slice(0, 3))
        f.value = {
          ...f.value,
          state: 'VALUE',
          rawValue: 'a'.repeat(90000),
          observedTotalCodepoints: 90000,
        };
  }
  r.content.completeOwnedFields = copyComplete(p.reads[1].fields);
  resealCurrent(env);
  const bytes = Buffer.from('synthetic original bytes');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const observedAt = '2026-10-13T00:00:01.000Z';
  const binding = {
    ownerSnapshotId: r.snapshotId,
    sourceAttachmentId,
    role: 'PRIMARY',
    filename,
    mediaType: media[format],
    blobSha256: sha256,
    byteLength: bytes.length,
    sourceVersion: copyComplete(r.sourceVersion),
    observedAt,
    evidenceLocator: '#primary-byte-observation',
  };
  const { observedAt: ignoredTime, ...identity } = binding;
  void ignoredTime;
  env.package.artifactBindings = [
    { bindingId: 'TDMSBIND-' + hash(identity), ...binding },
  ];
  env.package.query.originalAcquisition = {
    contentMode: 'COMPLETE_OWN_SOURCE@1',
    originalRevision: 'tdms-complete-primary-bytes@1',
    operationId: op('3'),
    ownOperationId: op('4'),
    receiptSha256: 'a'.repeat(64),
    sourceAttachmentId,
    bytesSha256: sha256,
    byteLength: bytes.length,
    mediaType: media[format],
  };
  env.package.observedAt = observedAt;
  env.requestId = 'TDMSIMPORT-' + hash(env.package);
  const selection = {
    memberId: env.package.artifactBindings[0].bindingId,
    sourceAttachmentId,
    sourceAttachmentVersion: null,
    fileName: filename,
    mediaType: media[format],
    sha256,
    byteLength: bytes.length,
    ownerItemIds: [r.snapshotId],
    selection: {
      bucketId: 'synthetic-bucket',
      filePath: 'tdms-source/uploads/synthetic-original.bin',
      expectedProviderObjectId: 'synthetic-uploaded-object',
    },
  };
  return { env, bytes, selection };
}
function classificationIdentity(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(classificationIdentity);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .filter(
          ([k]) =>
            ![
              'observedAt',
              'itemId',
              'snapshotId',
              'lastSeenAt',
              'documentIdentity',
              'nativeReloadProvenance',
            ].includes(k),
        )
        .map(([k, x]) => [k, classificationIdentity(x)]),
    );
  return v;
}
export function resealClassification(env: TdmsDailyMetadataEnvelope) {
  const r = env.package.records[0];
  r.snapshotId = 'TDMSSNAP-' + hash(classificationIdentity(r));
  env.requestId = 'TDMSIMPORT-' + hash(env.package);
  return env;
}
export function currentClassification(
  kind: 'document' | 'engineering' = 'document',
  directory = false,
) {
  const own = syntheticCompleteEnvelope(kind === 'document' ? 'SL' : 'EO'),
    proof = proofOfCurrent(own),
    native = copyComplete(proof.reads[1]);
  const sourceProof = copyComplete(
    proofOfCurrent(syntheticCompleteEnvelope('AD_ITEM')).requestedCriteria
      .sourceProof,
  );
  sourceProof.targetRef = native.owner.sourceRecordId;
  const engineering = kind === 'engineering',
    key = engineering
      ? 'engineeringClassification'
      : 'documentTargetClassification';
  native.owner.scopeEvidence.nativeTypeOrigin = directory
    ? 'CURRENT_DIRECTORY'
    : 'REQUIRED_RELATION_TARGET';
  const expectedOwner = copyComplete(proof.requestedCriteria.expectedOwner);
  let input: any = {
    profileId: engineering
      ? 'ENGINEERING_INDEPENDENT'
      : 'REQUIRED_DOCUMENT_TARGET',
    profileRevision: engineering
      ? 'tdms-independent-source-profiles@1'
      : 'tdms-required-document-target@1',
    originalReferenceLabel: 'SYNTHETIC-REFERENCE',
    sourceObjectRef: native.owner.sourceRecordId,
    expectedOwner,
    sourceProof,
    purpose: 'COVERAGE',
    primaryPolicy: 'METADATA_ONLY',
    openIfMissing: false,
    classificationRevision: engineering
      ? 'tdms-engineering-own-subtype@1'
      : 'tdms-required-document-own-classification@1',
  };
  if (directory) {
    const scope = {
      schemaVersion: 'wiselink.tdms-discovery-scope.v2',
      strategy: 'TYPE_DATE',
      scopeId: 'synthetic-engineering-scope',
      profileId: 'ENGINEERING_INDEPENDENT',
      profileRevision: 'tdms-independent-source-profiles@1',
      objectType: 'EO整体',
      nativeClass: 'wt.epm.EPMDocument',
      businessType: null,
      oemManufacturerType: null,
      dateField: 'Last Modified',
      dateRange: {
        from: '2026-10-01',
        to: '2026-10-12',
        dateZone: null,
        semanticsEvidenceId: null,
      },
      stateFilter: 'ALL',
      contextRaw: 'All Contexts',
    };
    const expectedRow = {
      sourceRecordId: native.owner.sourceRecordId,
      number: native.owner.number,
      sourceVersion: copyComplete(native.owner.sourceVersion),
      state: { rawCode: null, rawName: native.owner.stateRaw },
      sourceModifiedAt: null,
      sourceModifiedRaw: native.owner.sourceModifiedRaw,
      observedAt: native.owner.observedAt,
      storageType: { rawCode: null, rawName: 'EO整体' },
      sourceCreatedRaw: native.owner.sourceCreatedRaw,
      nativeTypeId: native.owner.nativeTypeId,
      typeEvidence: {
        origin: 'BOUND_DIRECTORY_QUERY',
        nativeTypeId: native.owner.nativeTypeId,
        rawTypeLabel: 'EO整体',
      },
      businessVersion: copyComplete(native.owner.businessVersion),
      businessVersionEvidence: { actualLabel: 'EO版次:', rawValue: '1' },
      orderTypeRaw: 'EO',
      technicalVersionRaw: 'A.1',
      technicalVersionEvidence: { actualLabel: 'Version', rawValue: 'A.1' },
    };
    input = {
      profileId: input.profileId,
      profileRevision: input.profileRevision,
      documentCode: native.owner.number,
      sourceObjectRef: input.sourceObjectRef,
      scope,
      expectedRow,
      directoryProof: {
        operationId: op('1'),
        queryRequestId: 'synthetic-directory-query',
        pageIndex: 0,
        scopeDigest: hash(scope),
        rowDigest: hash(expectedRow),
      },
      purpose: input.purpose,
      primaryPolicy: input.primaryPolicy,
      openIfMissing: false,
      classificationRevision: input.classificationRevision,
    };
  }
  const typed = {
    state: 'VALUE',
    actualLabel: engineering ? '指令类别:' : 'OEM manufacturer type:',
    rawValue: engineering ? 'EO' : '机身',
    locator: engineering ? '#native-subtype' : '#native-oem',
    observedTotalCodepoints: 2,
  };
  const read = {
    owner: native.owner,
    [engineering ? 'nativeSubtype' : 'oemManufacturerTypeEvidence']: typed,
    sourceContext: native.sourceContext,
    observedAt: native.observedAt,
  };
  const observation = {
    schemaVersion: engineering
      ? 'wiselink.tdms-engineering-own-classification.v1'
      : 'wiselink.tdms-required-document-own-classification.v1',
    classificationRevision: input.classificationRevision,
    requestedCriteria: input,
    documentIdentity: proof.documentIdentity,
    nativeReloadProvenance: copyComplete(proof.nativeReloadProvenance),
    reads: [copyComplete(read), copyComplete(read)],
    [engineering ? 'resolvedSubtype' : 'resolvedScopeId']: engineering
      ? 'EO'
      : 'SL',
    disposition: 'IN_SCOPE',
  };
  const r = {
    sourceRecordId: native.owner.sourceRecordId,
    kind: engineering ? 'ENGINEERING_FILE' : 'OBSERVATION',
    number: native.owner.number,
    sourceVersion: native.owner.sourceVersion,
    businessVersion: native.owner.businessVersion,
    state: { rawCode: null, rawName: native.owner.stateRaw },
    observedAt: read.observedAt,
    sourceModifiedAt: null,
    authors: [],
    rawFields: {
      number: native.owner.number,
      storageType: {
        rawCode: null,
        rawName: engineering ? 'EO整体' : native.owner.rawHeaderType,
      },
      sourceModifiedRaw: native.owner.sourceModifiedRaw,
      [key]: observation,
    },
    content: {},
    provenance: [
      {
        fieldPath: 'rawFields.' + key,
        selector: engineering
          ? '#native-subtype'
          : native.owner.nativeTypeEvidence.locator,
        sourceModifiedAt: null,
        observationRef: native.owner.sourceRecordId,
      },
    ],
    coverage: {
      status: 'PARTIAL',
      gaps: engineering
        ? ['OWN_SUBTYPE_CLASSIFICATION_ONLY', 'OWN_COMPLETE_CONTENT_NOT_READ']
        : [
            'REQUIRED_DOCUMENT_NATIVE_CLASSIFICATION_ONLY',
            'OWN_COMPLETE_CONTENT_NOT_READ',
          ],
      readback: 'NON_ATOMIC',
    },
  };
  const env = {
    requestId: '',
    package: {
      schemaVersion: 'wiselink.tdms-daily-package.v1',
      packageId: 'synthetic-' + key,
      sourceSystem: 'TDMS',
      observedAt: read.observedAt,
      coverage: copyComplete(r.coverage),
      query: {
        requestedCriteria: {
          documentCode: r.number,
          sourceObjectRef: r.sourceRecordId,
          ...(engineering ? { objectType: 'EO整体' } : {}),
          nativeClass: engineering ? 'wt.epm.EPMDocument' : 'wt.doc.WTDocument',
        },
        actualCriteria: null,
        scopeMatch: 'UNKNOWN',
        scopeComplete: false,
      },
      records: [{ snapshotId: '', ...r }],
      edges: [],
      artifactBindings: [],
      readFailures: [],
    },
  } as TdmsDailyMetadataEnvelope;
  return resealClassification(env);
}
