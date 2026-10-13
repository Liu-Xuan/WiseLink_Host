// Pure classification evidence from frozen TDMS 0.2.54. PARTIAL self-observation only.
import {
  assertKeys,
  fail,
  iso,
  plainData,
  sha256,
  stable,
  text,
  version,
  withoutTimes,
  validateRequiredTargetSourceProof,
  validateCompleteOwnedOwner,
  COMPLETE_OWN_PROFILES,
  validateCompleteSourceContext,
} from './tdms-complete-owned-source.validation';
import { isNativeReloadProvenance } from './tdms-native-reload-provenance';
export const DOCUMENT_TARGET_CLASSIFICATION_PROFILE =
  'REQUIRED_DOCUMENT_TARGET';
export const DOCUMENT_TARGET_CLASSIFICATION_PROFILE_REVISION =
  'tdms-required-document-target@1';
export const DOCUMENT_TARGET_CLASSIFICATION_REVISION =
  'tdms-required-document-own-classification@1';
export const DOCUMENT_TARGET_CLASSIFICATION_SCHEMA =
  'wiselink.tdms-required-document-own-classification.v1';
export const DOCUMENT_TARGET_CLASSIFICATION_INPUT_KEYS = Object.freeze([
  'profileId',
  'profileRevision',
  'originalReferenceLabel',
  'sourceObjectRef',
  'expectedOwner',
  'sourceProof',
  'purpose',
  'primaryPolicy',
  'openIfMissing',
  'classificationRevision',
]);
const unknown = () => ({
  rawRevision: null,
  rawIteration: null,
  confirmation: 'VERSION_UNCONFIRMED',
});
const ownerKeys = Object.freeze([
  'sourceRecordId',
  'number',
  'nativeTypeId',
  'nativeTypeEvidence',
  'rawHeaderIdentifier',
  'rawHeaderType',
  'sourceVersion',
  'technicalVersionEvidence',
  'technicalVersionFieldEvidence',
  'businessVersion',
  'businessVersionEvidence',
  'stateRaw',
  'sourceModifiedRaw',
  'sourceCreatedRaw',
  'contextRaw',
  'scopeEvidence',
  'observedAt',
]);
const states = new Set([
  'VALUE',
  'BLANK',
  'ABSENT',
  'NOT_APPLICABLE',
  'NOT_LOADED',
  'NOT_READ',
  'TRUNCATED',
  'ACCESS_DENIED',
]);
function typed(v) {
  assertKeys(v, [
    'state',
    'actualLabel',
    'rawValue',
    'locator',
    'observedTotalCodepoints',
  ]);
  text(v.actualLabel, 200);
  text(v.locator, 700);
  if (
    !states.has(v.state) ||
    !Number.isSafeInteger(v.observedTotalCodepoints) ||
    v.observedTotalCodepoints < 0 ||
    v.observedTotalCodepoints > 100000 ||
    ([
      'ABSENT',
      'NOT_APPLICABLE',
      'NOT_LOADED',
      'NOT_READ',
      'ACCESS_DENIED',
    ].includes(v.state) &&
      (v.rawValue !== null || v.observedTotalCodepoints !== 0)) ||
    (v.state === 'BLANK' &&
      (v.rawValue !== '' || v.observedTotalCodepoints !== 0)) ||
    (v.state === 'VALUE' &&
      (typeof v.rawValue !== 'string' ||
        !v.rawValue.trim() ||
        [...v.rawValue].length !== v.observedTotalCodepoints))
  )
    fail('TDMS_DOCUMENT_TARGET_NATIVE_FIELD_INVALID');
  return v;
}
export function validateDocumentTargetClassificationInput(raw) {
  const v = plainData(raw);
  assertKeys(v, DOCUMENT_TARGET_CLASSIFICATION_INPUT_KEYS);
  if (
    v.profileId !== DOCUMENT_TARGET_CLASSIFICATION_PROFILE ||
    v.profileRevision !== DOCUMENT_TARGET_CLASSIFICATION_PROFILE_REVISION ||
    v.classificationRevision !== DOCUMENT_TARGET_CLASSIFICATION_REVISION ||
    v.purpose !== 'COVERAGE' ||
    v.primaryPolicy !== 'METADATA_ONLY' ||
    v.openIfMissing !== false ||
    !/^(?:OR|VR):wt\.doc\.WTDocument:\d{1,24}$/u.test(
      v.sourceObjectRef || '',
    ) ||
    typeof v.originalReferenceLabel !== 'string' ||
    v.originalReferenceLabel.length > 500
  )
    fail('TDMS_DOCUMENT_TARGET_CLASSIFICATION_INPUT_INVALID');
  assertKeys(v.expectedOwner, [
    'nativeTypeId',
    'sourceVersion',
    'sourceModifiedRaw',
  ]);
  if (v.expectedOwner.nativeTypeId !== null)
    text(v.expectedOwner.nativeTypeId, 250);
  if (v.expectedOwner.sourceModifiedRaw !== null)
    text(v.expectedOwner.sourceModifiedRaw, 200);
  version(v.expectedOwner.sourceVersion);
  if (
    (v.expectedOwner.sourceVersion.confirmation === 'SOURCE_DECLARED' &&
      !/^\d{1,20}$/u.test(v.expectedOwner.sourceVersion.rawIteration || '')) ||
    (v.expectedOwner.sourceVersion.confirmation === 'VERSION_UNCONFIRMED' &&
      stable(v.expectedOwner.sourceVersion) !== stable(unknown()))
  )
    fail('TDMS_DOCUMENT_TARGET_CLASSIFICATION_INPUT_INVALID');
  validateRequiredTargetSourceProof(v.sourceProof, v.sourceObjectRef);
  return v;
}
export function resolveDocumentTargetNativeScope(owner) {
  if (
    owner?.nativeTypeEvidence?.state !== 'VALUE' ||
    owner.nativeTypeEvidence.rawValue !== owner.nativeTypeId
  )
    return { scopeId: null, disposition: 'UNKNOWN' };
  const values = Object.values(COMPLETE_OWN_PROFILES).filter(
    (p) =>
      p.nativeClass === 'wt.doc.WTDocument' &&
      p.nativeTypeId === owner.nativeTypeId &&
      (p.rawHeaderType || p.objectType) === owner.rawHeaderType &&
      (!p.businessType || p.businessType === owner.scopeEvidence?.businessType),
  );
  if (values.length === 1)
    return { scopeId: values[0].scopeId, disposition: 'IN_SCOPE' };
  const feedback = COMPLETE_OWN_PROFILES.AIRCRAFT_FEEDBACK.headerNativeTypes;
  if (feedback[owner.rawHeaderType] === owner.nativeTypeId)
    return { scopeId: 'AIRCRAFT_FEEDBACK', disposition: 'IN_SCOPE' };
  const known = new Set(
    Object.values(COMPLETE_OWN_PROFILES)
      .flatMap((p) => [
        p.nativeTypeId,
        ...Object.values(p.headerNativeTypes || {}),
      ])
      .filter(Boolean),
  );
  // An unknown display header is not proof of an out-of-scope soft type.
  return !known.has(owner.nativeTypeId) &&
    /^WCTYPE\|wt\.doc\.WTDocument\|[A-Za-z0-9._|]+$/u.test(
      owner.nativeTypeId || '',
    ) &&
    ['Type:', 'Type', 'Native Type ID:', 'Native Type ID'].includes(
      owner.nativeTypeEvidence.actualLabel,
    )
    ? { scopeId: null, disposition: 'OUT_OF_SCOPE' }
    : { scopeId: null, disposition: 'UNKNOWN' };
}
function validateMinimalOwner(o, input) {
  assertKeys(o, ownerKeys);
  iso(o.observedAt);
  for (const k of [
    'number',
    'rawHeaderIdentifier',
    'rawHeaderType',
    'stateRaw',
    'sourceModifiedRaw',
  ])
    text(o[k], 500);
  if (
    o.sourceRecordId !== input.sourceObjectRef ||
    o.rawHeaderIdentifier.split(',')[0].trim() !== o.number ||
    (input.expectedOwner.nativeTypeId !== null &&
      input.expectedOwner.nativeTypeId !== o.nativeTypeId) ||
    (input.expectedOwner.sourceModifiedRaw !== null &&
      input.expectedOwner.sourceModifiedRaw !== o.sourceModifiedRaw)
  )
    fail('TDMS_DOCUMENT_TARGET_OWNER_CHANGED');
  for (const k of ['sourceCreatedRaw', 'contextRaw'])
    if (o[k] !== null) text(o[k], 250);
  for (const k of [
    'nativeTypeEvidence',
    'technicalVersionEvidence',
    'technicalVersionFieldEvidence',
    'businessVersionEvidence',
  ])
    typed(o[k]);
  version(o.sourceVersion);
  if (o.businessVersion !== null)
    version(o.businessVersion, { business: true });
  assertKeys(o.scopeEvidence, [
    'nativeTypeOrigin',
    'businessType',
    'engineeringSubtype',
    'rawTypeField',
  ]);
  if (
    o.scopeEvidence.nativeTypeOrigin !== 'REQUIRED_RELATION_TARGET' ||
    o.scopeEvidence.engineeringSubtype !== null ||
    (input.expectedOwner.sourceVersion.confirmation === 'SOURCE_DECLARED' &&
      stable(o.sourceVersion) !== stable(input.expectedOwner.sourceVersion))
  )
    fail('TDMS_DOCUMENT_TARGET_OWNER_CHANGED');
  if (o.nativeTypeId !== null) {
    text(o.nativeTypeId, 250);
    if (
      o.nativeTypeEvidence.state !== 'VALUE' ||
      o.nativeTypeEvidence.rawValue !== o.nativeTypeId
    )
      fail('TDMS_DOCUMENT_TARGET_TYPE_UNVERIFIED');
  } else if (o.nativeTypeEvidence.state !== 'NOT_READ')
    fail('TDMS_DOCUMENT_TARGET_TYPE_UNVERIFIED');
}
export function documentTargetClassificationStableProjection(v) {
  if (Array.isArray(v))
    return v.map(documentTargetClassificationStableProjection);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(
    Object.entries(v)
      .filter(
        ([k]) =>
          ![
            'observedAt',
            'documentIdentity',
            'nativeReloadProvenance',
          ].includes(k),
      )
      .map(([k, x]) => [k, documentTargetClassificationStableProjection(x)]),
  );
}
export function validateDocumentTargetClassificationObservation(raw, rawInput) {
  const input = validateDocumentTargetClassificationInput(rawInput),
    v = plainData(raw);
  assertKeys(v, [
    'schemaVersion',
    'classificationRevision',
    'requestedCriteria',
    'documentIdentity',
    'nativeReloadProvenance',
    'reads',
    'resolvedScopeId',
    'disposition',
  ]);
  if (
    v.schemaVersion !== DOCUMENT_TARGET_CLASSIFICATION_SCHEMA ||
    v.classificationRevision !== DOCUMENT_TARGET_CLASSIFICATION_REVISION ||
    stable(v.requestedCriteria) !== stable(input) ||
    !Array.isArray(v.reads) ||
    v.reads.length !== 2
  )
    fail('TDMS_DOCUMENT_TARGET_CLASSIFICATION_OBSERVATION_INVALID');
  text(v.documentIdentity, 200);
  let resolved;
  for (const read of v.reads) {
    assertKeys(read, [
      'owner',
      'oemManufacturerTypeEvidence',
      'sourceContext',
      'observedAt',
    ]);
    iso(read.observedAt);
    validateMinimalOwner(read.owner, input);
    typed(read.oemManufacturerTypeEvidence);
    validateCompleteSourceContext(read.sourceContext);
    resolved = resolveDocumentTargetNativeScope(read.owner);
    if (resolved.scopeId)
      validateCompleteOwnedOwner(read.owner, {
        scopeId: resolved.scopeId,
        sourceObjectRef: input.sourceObjectRef,
        documentCode: read.owner.number,
        expectedOwner: input.expectedOwner,
        sourceProof: input.sourceProof,
      });
    if (Date.parse(read.owner.observedAt) > Date.parse(read.observedAt))
      fail('TDMS_DOCUMENT_TARGET_TIME_INVALID');
  }
  if (
    !isNativeReloadProvenance(v.nativeReloadProvenance, {
      sourceRecordId: input.sourceObjectRef,
      documentIdentity: v.documentIdentity,
      observedAt: v.reads[0].owner.observedAt,
    }) ||
    Date.parse(v.reads[0].observedAt) >
      Date.parse(v.reads[1].owner.observedAt) ||
    stable(documentTargetClassificationStableProjection(v.reads[0])) !==
      stable(documentTargetClassificationStableProjection(v.reads[1]))
  )
    fail('TDMS_DOCUMENT_TARGET_FRESH_DOUBLE_READ_REQUIRED');
  if (
    v.resolvedScopeId !== resolved.scopeId ||
    v.disposition !== resolved.disposition
  )
    fail('TDMS_DOCUMENT_TARGET_CLASSIFICATION_DISPOSITION_INVALID');
  return v;
}
export function documentTargetClassificationRecord(raw, rawInput) {
  const input = validateDocumentTargetClassificationInput(rawInput),
    o = validateDocumentTargetClassificationObservation(raw, input),
    owner = o.reads[1].owner,
    record = {
      sourceRecordId: owner.sourceRecordId,
      kind: 'OBSERVATION',
      number: owner.number,
      sourceVersion: owner.sourceVersion,
      businessVersion: owner.businessVersion,
      state: { rawCode: null, rawName: owner.stateRaw },
      observedAt: o.reads[1].observedAt,
      sourceModifiedAt: null,
      authors: [],
      rawFields: {
        number: owner.number,
        storageType: { rawCode: null, rawName: owner.rawHeaderType },
        sourceModifiedRaw: owner.sourceModifiedRaw,
        documentTargetClassification: o,
      },
      content: {},
      provenance: [
        {
          fieldPath: 'rawFields.documentTargetClassification',
          selector: owner.nativeTypeEvidence.locator,
          sourceModifiedAt: null,
          observationRef: owner.sourceRecordId,
        },
      ],
      coverage: {
        status: 'PARTIAL',
        gaps: [
          'REQUIRED_DOCUMENT_NATIVE_CLASSIFICATION_ONLY',
          'OWN_COMPLETE_CONTENT_NOT_READ',
        ],
        readback: 'NON_ATOMIC',
      },
    };
  record.snapshotId = snapshotIdentity(record);
  return record;
}
export function validateDocumentTargetClassificationRecord(record) {
  const o = record.rawFields?.documentTargetClassification,
    expected = documentTargetClassificationRecord(o, o?.requestedCriteria);
  if (stable(expected) !== stable(record))
    fail('TDMS_DOCUMENT_TARGET_CLASSIFICATION_RECORD_INVALID');
}
export const LEGACY_ENGINEERING_CLASSIFICATION_REVISION =
  'tdms-engineering-own-subtype@1';
export const ENGINEERING_CLASSIFICATION_REVISION =
  'tdms-engineering-own-subtype@2';
export const ENGINEERING_CLASSIFICATION_SCHEMA =
  'wiselink.tdms-engineering-own-classification.v1';
const directoryKeys = [
  'profileId',
  'profileRevision',
  'documentCode',
  'sourceObjectRef',
  'scope',
  'expectedRow',
  'directoryProof',
  'purpose',
  'primaryPolicy',
  'openIfMissing',
  'classificationRevision',
];
export const ENGINEERING_CLASSIFICATION_TARGET_INPUT_KEYS = Object.freeze([
  'profileId',
  'profileRevision',
  'originalReferenceLabel',
  'sourceObjectRef',
  'expectedOwner',
  'sourceProof',
  'purpose',
  'primaryPolicy',
  'openIfMissing',
  'classificationRevision',
]);
export function engineeringClassificationIsRelated(input) {
  return !!input && Object.hasOwn(input, 'sourceProof');
}
// Exact profile-source.mjs@0.2.54 projection: omit only top-level observedAt.
// The retained row and all identity/version/source-modification fields stay intact.
const profileRowDigest = (row) =>
  sha256(
    Object.fromEntries(
      Object.entries(row).filter(([key]) => key !== 'observedAt'),
    ),
  );
export function validateEngineeringClassificationInput(raw) {
  const v = plainData(raw),
    p = SOURCE_PROFILES.ENGINEERING_INDEPENDENT,
    related = engineeringClassificationIsRelated(v);
  assertKeys(
    v,
    related ? ENGINEERING_CLASSIFICATION_TARGET_INPUT_KEYS : directoryKeys,
  );
  if (
    v.profileId !== 'ENGINEERING_INDEPENDENT' ||
    v.profileRevision !== SOURCE_PROFILE_REVISION ||
    ![
      LEGACY_ENGINEERING_CLASSIFICATION_REVISION,
      ENGINEERING_CLASSIFICATION_REVISION,
    ].includes(v.classificationRevision) ||
    v.purpose !== 'COVERAGE' ||
    v.primaryPolicy !== 'METADATA_ONLY' ||
    v.openIfMissing !== false ||
    !/^(?:OR|VR):wt\.epm\.EPMDocument:\d{1,24}$/u.test(v.sourceObjectRef || '')
  )
    fail('TDMS_ENGINEERING_CLASSIFICATION_INPUT_INVALID');
  if (related) {
    if (
      typeof v.originalReferenceLabel !== 'string' ||
      v.originalReferenceLabel.length > 500
    )
      fail('TDMS_ENGINEERING_CLASSIFICATION_REFERENCE_LABEL_INVALID');
    assertKeys(v.expectedOwner, [
      'nativeTypeId',
      'sourceVersion',
      'sourceModifiedRaw',
    ]);
    const own = v.expectedOwner;
    if (
      (own.nativeTypeId !== null && own.nativeTypeId !== p.nativeTypeId) ||
      (own.sourceModifiedRaw !== null &&
        (typeof own.sourceModifiedRaw !== 'string' ||
          !own.sourceModifiedRaw.trim() ||
          own.sourceModifiedRaw.length > 200))
    )
      fail('TDMS_ENGINEERING_CLASSIFICATION_OWNER_BINDING_INVALID');
    version(own.sourceVersion);
    if (
      (own.sourceVersion.confirmation === 'SOURCE_DECLARED' &&
        !/^\d{1,20}$/u.test(own.sourceVersion.rawIteration || '')) ||
      (own.sourceVersion.confirmation === 'VERSION_UNCONFIRMED' &&
        (own.sourceVersion.rawRevision !== null ||
          own.sourceVersion.rawIteration !== null))
    )
      fail('TDMS_ENGINEERING_CLASSIFICATION_VERSION_INVALID');
    validateRequiredTargetSourceProof(v.sourceProof, v.sourceObjectRef);
  } else {
    text(v.documentCode, 180);
    if (/[*?\r\n]/u.test(v.documentCode))
      fail('TDMS_ENGINEERING_CLASSIFICATION_INPUT_INVALID');
    validateDateScope(v.scope);
    validateProfileDirectoryRow(v.expectedRow, v.scope);
    const r = v.expectedRow,
      d = v.directoryProof;
    assertKeys(d, [
      'operationId',
      'queryRequestId',
      'pageIndex',
      'scopeDigest',
      'rowDigest',
    ]);
    if (
      v.scope.profileId !== v.profileId ||
      v.scope.nativeClass !== p.nativeClass ||
      r.sourceRecordId !== v.sourceObjectRef ||
      r.number !== v.documentCode ||
      !/^TDMSOP-[A-F0-9]{8}(?:-[A-F0-9]{4}){3}-[A-F0-9]{12}$/u.test(
        d.operationId || '',
      ) ||
      !Number.isSafeInteger(d.pageIndex) ||
      d.pageIndex < 0 ||
      d.scopeDigest !== sha256(v.scope) ||
      d.rowDigest !== profileRowDigest(r)
    )
      fail('TDMS_ENGINEERING_CLASSIFICATION_BINDING_INVALID');
    text(d.queryRequestId, 120);
  }
  return v;
}
export function engineeringClassificationStableProjection(v) {
  if (Array.isArray(v)) return v.map(engineeringClassificationStableProjection);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(
    Object.entries(v)
      .filter(
        ([k]) =>
          ![
            'observedAt',
            'documentIdentity',
            'nativeReloadProvenance',
          ].includes(k),
      )
      .map(([k, x]) => [k, engineeringClassificationStableProjection(x)]),
  );
}
export function validateEngineeringClassificationObservation(raw, rawInput) {
  const input = validateEngineeringClassificationInput(rawInput),
    v = plainData(raw);
  assertKeys(v, [
    'schemaVersion',
    'classificationRevision',
    'requestedCriteria',
    'documentIdentity',
    'nativeReloadProvenance',
    'reads',
    'resolvedSubtype',
    'disposition',
  ]);
  if (
    v.schemaVersion !== ENGINEERING_CLASSIFICATION_SCHEMA ||
    v.classificationRevision !== input.classificationRevision ||
    stable(v.requestedCriteria) !== stable(input) ||
    !Array.isArray(v.reads) ||
    v.reads.length !== 2
  )
    fail('TDMS_ENGINEERING_CLASSIFICATION_DOUBLE_READ_REQUIRED');
  text(v.documentIdentity, 200);
  if (
    !isNativeReloadProvenance(v.nativeReloadProvenance, {
      sourceRecordId: input.sourceObjectRef,
      documentIdentity: v.documentIdentity,
      observedAt: v.reads[0]?.owner?.observedAt,
    })
  )
    fail('TDMS_ENGINEERING_CLASSIFICATION_FRESH_RELOAD_REQUIRED');
  const related = engineeringClassificationIsRelated(input),
    expectedOwner = related
      ? input.expectedOwner
      : {
          nativeTypeId: input.expectedRow.nativeTypeId,
          sourceVersion: input.expectedRow.sourceVersion,
          sourceModifiedRaw: input.expectedRow.sourceModifiedRaw,
        };
  let subtype = null;
  for (const read of v.reads) {
    assertKeys(read, ['owner', 'nativeSubtype', 'sourceContext', 'observedAt']);
    iso(read.observedAt);
    validateCompleteSourceContext(read.sourceContext);
    const o = read.owner,
      ownInput = {
        scopeId: 'EO',
        sourceObjectRef: input.sourceObjectRef,
        documentCode: related ? o?.number : input.documentCode,
        expectedOwner,
        sourceProof: related
          ? input.sourceProof
          : {
              kind: 'CURRENT_DIRECTORY',
              operationId: input.directoryProof.operationId,
            },
      };
    validateCompleteOwnedOwner(o, ownInput, { classification: true });
    if (!related) {
      const row = input.expectedRow;
      if (
        o.sourceCreatedRaw !== row.sourceCreatedRaw ||
        o.stateRaw !== row.state.rawName ||
        o.sourceVersion.confirmation !== 'SOURCE_DECLARED' ||
        (row.businessVersion?.confirmation === 'SOURCE_DECLARED' &&
          stable(o.businessVersion) !== stable(row.businessVersion))
      )
        fail('TDMS_ENGINEERING_CLASSIFICATION_OWNER_CHANGED');
    }
    const value = read.nativeSubtype;
    assertKeys(value, [
      'state',
      'actualLabel',
      'rawValue',
      'locator',
      'observedTotalCodepoints',
    ]);
    text(value.rawValue, 120);
    text(value.locator, 700);
    if (
      value.state !== 'VALUE' ||
      !['指令类别:', '指令类别', '指令类别：'].includes(value.actualLabel) ||
      value.observedTotalCodepoints !== [...value.rawValue].length ||
      value.rawValue !== o.scopeEvidence.engineeringSubtype
    )
      fail('TDMS_ENGINEERING_CLASSIFICATION_SUBTYPE_UNVERIFIED');
    subtype = value.rawValue;
    if (Date.parse(o.observedAt) > Date.parse(read.observedAt))
      fail('TDMS_TIME_INVALID');
  }
  if (
    Date.parse(v.reads[0].observedAt) >
      Date.parse(v.reads[1].owner.observedAt) ||
    stable(engineeringClassificationStableProjection(v.reads[0])) !==
      stable(engineeringClassificationStableProjection(v.reads[1]))
  )
    fail('TDMS_ENGINEERING_CLASSIFICATION_CHANGED');
  const resolved = (input.classificationRevision ===
  LEGACY_ENGINEERING_CLASSIFICATION_REVISION
    ? ['EO', 'EF', 'AEO']
    : ['EO', 'AEO']
  ).includes(subtype)
    ? subtype
    : null;
  if (
    v.resolvedSubtype !== resolved ||
    v.disposition !== (resolved ? 'IN_SCOPE' : 'OUT_OF_SCOPE')
  )
    fail('TDMS_ENGINEERING_CLASSIFICATION_DISPOSITION_INVALID');
  return v;
}
export function engineeringClassificationRecord(raw, input) {
  const o = validateEngineeringClassificationObservation(raw, input),
    owner = o.reads[1].owner;
  const record = {
    sourceRecordId: owner.sourceRecordId,
    kind: 'ENGINEERING_FILE',
    number: owner.number,
    sourceVersion: owner.sourceVersion,
    businessVersion: owner.businessVersion,
    state: { rawCode: null, rawName: owner.stateRaw },
    observedAt: o.reads[1].observedAt,
    sourceModifiedAt: null,
    authors: [],
    rawFields: {
      number: owner.number,
      storageType: { rawCode: null, rawName: 'EO整体' },
      sourceModifiedRaw: owner.sourceModifiedRaw,
      engineeringClassification: o,
    },
    content: {},
    provenance: [
      {
        fieldPath: 'rawFields.engineeringClassification',
        selector: o.reads[1].nativeSubtype.locator,
        sourceModifiedAt: null,
        observationRef: owner.sourceRecordId,
      },
    ],
    coverage: {
      status: 'PARTIAL',
      gaps: [
        'OWN_SUBTYPE_CLASSIFICATION_ONLY',
        'OWN_COMPLETE_CONTENT_NOT_READ',
        ...(o.classificationRevision === ENGINEERING_CLASSIFICATION_REVISION &&
        o.reads[1].nativeSubtype.rawValue === 'EF'
          ? ['NATIVE_EPM_EF_NOT_EFREQUEST_OUT_OF_CURRENT_SCOPE']
          : []),
        ...(owner.sourceVersion.confirmation === 'VERSION_UNCONFIRMED'
          ? ['TECHNICAL_VERSION_UNCONFIRMED']
          : []),
        ...(owner.nativeTypeEvidence.state !== 'VALUE'
          ? ['NATIVE_TYPE_UNOBSERVED']
          : []),
        ...(o.reads[1].sourceContext.principalDisplayName === null
          ? ['SOURCE_PRINCIPAL_UNOBSERVED']
          : []),
      ],
      readback: 'NON_ATOMIC',
    },
  };
  record.snapshotId = snapshotIdentity(record);
  return record;
}
export function validateEngineeringClassificationRecord(record) {
  const v = record.rawFields?.engineeringClassification,
    input = v?.requestedCriteria;
  const expected = engineeringClassificationRecord(v, input);
  if (stable(record) !== stable(expected))
    fail('TDMS_ENGINEERING_CLASSIFICATION_RECORD_INVALID');
}
export const SOURCE_PROFILE_REVISION = 'tdms-independent-source-profiles@1';
const root = (
  objectType,
  nativeClass,
  leaf,
  kind,
  { textBeans = 'name', ...extra } = {},
) => {
  const nativeTypeId = `WCTYPE|${nativeClass}|${leaf}`;
  return Object.freeze({
    objectType,
    nativeClass,
    nativeTypeId,
    gridId: `${nativeClass}.defaultSearchView`,
    kind,
    profileRevision: SOURCE_PROFILE_REVISION,
    businessTypes: Object.freeze([null]),
    directorySupported: true,
    collectionSupported: false,
    identitySupported: true,
    formalContentSupported: false,
    primaryPolicy: 'METADATA_ONLY',
    nameBean:
      nativeTypeId + '~' + (textBeans === 'search' ? 'search_name' : 'name'),
    numberBean:
      nativeTypeId +
      '~' +
      (textBeans === 'search' ? 'search_number' : 'number'),
    createdBean: nativeTypeId + '~thePersistInfo.createStamp',
    modifiedBean: nativeTypeId + '~thePersistInfo.modifyStamp',
    stateBean: nativeTypeId + '~state.state',
    ...extra,
  });
};
export const SOURCE_PROFILES = Object.freeze({
  AD_PROCESSING_FORM: root(
    'AD分处理单',
    'wt.change2.WTChangeOrder2',
    'com.airchina.ADForm',
    'PROCESSING_SHEET',
    { businessVersionLabel: 'AD分处理单版本:' },
  ),
  SB_ASSESSMENT_FORM: root(
    'SB评估单',
    'wt.change2.WTChangeOrder2',
    'com.airchina.SBForm',
    'ENGINEER_ASSESSMENT',
    { businessVersionLabel: 'SB评估单版本:' },
  ),
  ENGINEERING_ASSESSMENT: root(
    '工程文件编写评估单',
    'wt.doc.WTDocument',
    'com.airchina.EFRequest',
    'ENGINEER_ASSESSMENT',
    {
      textBeans: 'search',
      identitySupported: false,
      businessVersionLabel: null,
    },
  ),
  ENGINEERING_INDEPENDENT: root(
    'EO整体',
    'wt.epm.EPMDocument',
    'com.airchina.DynamicDocument|com.airchina.EODocument',
    'ENGINEERING_FILE',
    {
      textBeans: 'search',
      businessVersionLabel: 'EO版次:',
      rawHeaderType: 'Publication Source',
      declaredTechnicalVersion: true,
    },
  ),
  SB_PROCESSING_FORM: root(
    'SB处理单',
    'wt.change2.WTChangeRequest2',
    'com.airchina.SBMainForm',
    'PROCESSING_SHEET',
    { businessVersionLabel: 'SB处理单版本:' },
  ),
});
export const isSourceProfile = (id) => Object.hasOwn(SOURCE_PROFILES, id);
export const DATE_SCOPE_SCHEMA = 'wiselink.tdms-discovery-scope.v2';
export const PROFILE_REVISION = 'tdms-document-profiles@1';
export const SB_BUSINESS_TYPES = Object.freeze([
  'SB',
  'SIL',
  'SB-IN',
  'SL',
  'MT',
]);
export const DOCUMENT_PROFILES = Object.freeze({
  SB_DOCUMENT: Object.freeze({
    objectType: 'SB文档',
    nativeClass: 'wt.doc.WTDocument',
    nativeTypeId: 'WCTYPE|wt.doc.WTDocument|com.airchina.SBDocument',
    businessTypes: SB_BUSINESS_TYPES,
    directorySupported: true,
    collectionSupported: true,
  }),
  AD_DOCUMENT: Object.freeze({
    objectType: 'AD文档',
    nativeClass: 'wt.doc.WTDocument',
    nativeTypeId: 'WCTYPE|wt.doc.WTDocument|com.airchina.ADDocument',
    businessTypes: [null],
    directorySupported: true,
    collectionSupported: true,
  }),
});
export const dateProfile = (id) =>
  DOCUMENT_PROFILES[id] ?? SOURCE_PROFILES[id] ?? null;
export const dateProfileRevision = (id) =>
  isSourceProfile(id) ? SOURCE_PROFILE_REVISION : PROFILE_REVISION;
export function dateDay(raw) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(raw))
    fail('TDMS_DATE_INVALID');
  const value = Date.parse(raw + 'T00:00:00.000Z');
  if (
    !Number.isFinite(value) ||
    new Date(value).toISOString().slice(0, 10) !== raw
  )
    fail('TDMS_DATE_INVALID');
  return raw;
}
function zone(raw, { nullable = false } = {}) {
  if (nullable && raw === null) return raw;
  text(raw, 80);
  try {
    new Intl.DateTimeFormat('en', { timeZone: raw }).format(0);
  } catch {
    fail('TDMS_DATE_ZONE_INVALID');
  }
  return raw;
}
export function validateDateScope(raw) {
  const scope = plainData(raw);
  assertKeys(scope, [
    'schemaVersion',
    'strategy',
    'scopeId',
    'profileId',
    'profileRevision',
    'objectType',
    'nativeClass',
    'businessType',
    'oemManufacturerType',
    'dateField',
    'dateRange',
    'stateFilter',
    'contextRaw',
  ]);
  const profile = dateProfile(scope.profileId);
  if (
    scope.schemaVersion !== DATE_SCOPE_SCHEMA ||
    scope.strategy !== 'TYPE_DATE' ||
    !profile ||
    scope.profileRevision !== dateProfileRevision(scope.profileId) ||
    scope.objectType !== profile.objectType ||
    !/^[A-Za-z0-9:_-]{1,100}$/u.test(scope.scopeId) ||
    scope.stateFilter !== 'ALL' ||
    scope.contextRaw !== 'All Contexts' ||
    scope.nativeClass !== profile.nativeClass ||
    !['Created On', 'Last Modified'].includes(scope.dateField)
  )
    fail('TDMS_DATE_SCOPE_INVALID');
  if (scope.profileId === 'SB_DOCUMENT') {
    if (scope.nativeClass !== profile.nativeClass)
      fail('TDMS_SOURCE_PROFILE_MISMATCH');
    assertKeys(scope.businessType, ['rawCode', 'rawName']);
    if (
      !SB_BUSINESS_TYPES.includes(scope.businessType.rawName) ||
      (scope.businessType.rawCode !== null &&
        scope.businessType.rawCode !== scope.businessType.rawName)
    )
      fail('TDMS_BUSINESS_TYPE_INVALID');
  } else if (scope.businessType !== null) fail('TDMS_SOURCE_PROFILE_MISMATCH');
  if (scope.profileId === 'SB_DOCUMENT') {
    assertKeys(scope.oemManufacturerType, ['rawCode', 'rawName']);
    if (scope.oemManufacturerType.rawName !== '机身')
      fail('TDMS_OEM_MANUFACTURER_TYPE_REQUIRED');
    if (
      scope.oemManufacturerType.rawCode !== null &&
      scope.oemManufacturerType.rawCode !== 'AC'
    )
      fail('TDMS_OEM_MANUFACTURER_TYPE_REQUIRED');
  } else if (scope.oemManufacturerType !== null)
    fail('TDMS_AD_SCOPE_OEM_UNSUPPORTED');
  assertKeys(scope.dateRange, [
    'from',
    'to',
    'dateZone',
    'semanticsEvidenceId',
  ]);
  if (scope.dateRange.from !== null) dateDay(scope.dateRange.from);
  dateDay(scope.dateRange.to);
  if (
    scope.dateRange.from !== null &&
    scope.dateRange.from > scope.dateRange.to
  )
    fail('TDMS_DATE_RANGE_INVALID');
  zone(scope.dateRange.dateZone, { nullable: true });
  if (scope.dateRange.semanticsEvidenceId !== null)
    text(scope.dateRange.semanticsEvidenceId, 160);
  return scope;
}
export function validateProfileDirectoryRow(row, scope) {
  const profile = SOURCE_PROFILES[scope.profileId];
  if (!profile) fail('TDMS_SOURCE_PROFILE_MISMATCH');
  assertKeys(row, [
    'sourceRecordId',
    'number',
    'sourceVersion',
    'state',
    'sourceModifiedAt',
    'sourceModifiedRaw',
    'observedAt',
    'storageType',
    'sourceCreatedRaw',
    'nativeTypeId',
    'typeEvidence',
    'businessVersion',
    'businessVersionEvidence',
    'orderTypeRaw',
    'technicalVersionRaw',
    'technicalVersionEvidence',
  ]);
  text(row.number, 180);
  version(row.sourceVersion);
  iso(row.observedAt);
  if (
    !new RegExp(
      '^(?:OR|VR):' +
        profile.nativeClass.replaceAll('.', '\\.') +
        ':\\d{1,24}$',
      'u',
    ).test(row.sourceRecordId)
  )
    fail('TDMS_DISCOVERY_ROW_IDENTITY_INVALID');
  for (const field of ['state', 'storageType']) {
    assertKeys(row[field], ['rawCode', 'rawName']);
    for (const value of Object.values(row[field]))
      if (value !== null) text(value, 120);
  }
  for (const field of [
    'sourceModifiedRaw',
    'sourceCreatedRaw',
    'technicalVersionRaw',
  ])
    if (row[field] !== null) text(row[field], 180);
  if (row.sourceModifiedAt !== null) {
    iso(row.sourceModifiedAt);
    if (Date.parse(row.sourceModifiedAt) > Date.parse(row.observedAt))
      fail('TDMS_DISCOVERY_TIME_INVALID');
  }
  assertKeys(row.typeEvidence, ['origin', 'nativeTypeId', 'rawTypeLabel']);
  if (
    row.nativeTypeId !== profile.nativeTypeId ||
    row.typeEvidence.nativeTypeId !== profile.nativeTypeId ||
    row.typeEvidence.origin !== 'BOUND_DIRECTORY_QUERY' ||
    row.typeEvidence.rawTypeLabel !== row.storageType.rawName ||
    (row.storageType.rawName !== null &&
      ![profile.objectType, profile.rawHeaderType].includes(
        row.storageType.rawName,
      ))
  )
    fail('TDMS_PROFILE_ROW_TYPE_UNVERIFIED');
  if (
    row.sourceVersion.confirmation === 'VERSION_UNCONFIRMED' &&
    (row.sourceVersion.rawRevision !== null ||
      row.sourceVersion.rawIteration !== null)
  )
    fail('TDMS_PROFILE_ROW_VERSION_UNVERIFIED');
  if (row.technicalVersionRaw === null) {
    if (
      row.technicalVersionEvidence !== null ||
      row.sourceVersion.confirmation !== 'VERSION_UNCONFIRMED'
    )
      fail('TDMS_PROFILE_ROW_VERSION_UNVERIFIED');
  } else {
    assertKeys(row.technicalVersionEvidence, ['actualLabel', 'rawValue']);
    if (
      row.technicalVersionEvidence.actualLabel !== 'Version' ||
      row.technicalVersionEvidence.rawValue !== row.technicalVersionRaw ||
      (row.sourceVersion.confirmation === 'SOURCE_DECLARED' &&
        row.technicalVersionRaw !==
          row.sourceVersion.rawRevision + '.' + row.sourceVersion.rawIteration)
    )
      fail('TDMS_PROFILE_ROW_VERSION_UNVERIFIED');
  }
  if (row.businessVersion !== null) {
    version(row.businessVersion, { business: true });
    assertKeys(row.businessVersionEvidence, ['actualLabel', 'rawValue']);
    if (
      !profile.businessVersionLabel ||
      row.businessVersion.confirmation !== 'SOURCE_DECLARED' ||
      row.businessVersion.rawIteration !== null ||
      row.businessVersionEvidence.actualLabel !==
        profile.businessVersionLabel ||
      row.businessVersionEvidence.rawValue !== row.businessVersion.rawRevision
    )
      fail('TDMS_PROFILE_ROW_BUSINESS_VERSION_UNVERIFIED');
  } else if (row.businessVersionEvidence !== null)
    fail('TDMS_PROFILE_ROW_BUSINESS_VERSION_UNVERIFIED');
  if (row.orderTypeRaw !== null) {
    if (scope.profileId !== 'ENGINEERING_INDEPENDENT')
      fail('TDMS_PROFILE_ROW_ORDER_TYPE_UNVERIFIED');
    text(row.orderTypeRaw, 120);
  }
}
function snapshotIdentity(record) {
  return (
    'TDMSSNAP-' +
    sha256(
      withoutTimes(
        record.rawFields.documentTargetClassification
          ? documentTargetClassificationStableProjection(record)
          : engineeringClassificationStableProjection(record),
      ),
    )
  );
}

export function hasNativeClassification(record) {
  return (
    record?.rawFields?.documentTargetClassification !== undefined ||
    record?.rawFields?.engineeringClassification !== undefined
  );
}

export function assertNativeClassificationPackage(pkg) {
  const classified = pkg.records.filter(hasNativeClassification);
  if (!classified.length) return;
  if (
    pkg.records.length !== 1 ||
    pkg.relations.length ||
    pkg.artifacts.length ||
    pkg.readFailures.length ||
    pkg.query.scopeMatch !== 'UNKNOWN' ||
    pkg.query.actualCriteria !== null ||
    pkg.query.originalAcquisition !== undefined
  )
    fail('TDMS_CLASSIFICATION_PACKAGE_INVALID');
  const r = classified[0];
  const document = r.rawFields.documentTargetClassification !== undefined;
  if (
    r.recordKind !== (document ? 'OBSERVATION' : 'ENGINEERING_FILE') ||
    r.artifactMemberIds.length ||
    r.unreadAttachments?.length ||
    r.relatedDocumentVersionIds.length ||
    r.formalDocumentArtifactMemberId != null ||
    stable(r.fileType) !== stable(r.rawFields.storageType) ||
    stable(pkg.coverage) !== stable(r.coverage) ||
    pkg.observedAt !== r.observedAt
  )
    fail('TDMS_CLASSIFICATION_NATIVE_BINDING_INVALID');
  const record = {
    snapshotId: r.itemId,
    sourceRecordId: r.sourceRecordId,
    kind: r.recordKind,
    number: r.title,
    sourceVersion: r.sourceVersion,
    businessVersion: r.businessVersion,
    state: r.state,
    observedAt: r.observedAt,
    sourceModifiedAt: r.sourceModifiedAt,
    authors: r.authors,
    rawFields: r.rawFields,
    content: r.content,
    provenance: r.fieldProvenance,
    coverage: r.coverage,
  };
  if (document) validateDocumentTargetClassificationRecord(record);
  else validateEngineeringClassificationRecord(record);
}
