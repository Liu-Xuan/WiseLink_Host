import {
  HASH_CONTRACT_VERSION,
  LOCATOR_SCHEMA_VERSION,
  SOURCE_UNIT_SCHEMA_VERSION,
  SOURCE_UNIT_SET_SCHEMA_VERSION,
  hashSet,
  hashUnit,
} from './sourceUnitHashReference.js';

export const WISELINK_V3_1_FEISHU_NATIVE_SOURCE_UNIT_CONSUMPTION_SCHEMA =
  'wiselink.v3_1.feishu_native.source_unit_consumption.v1';

export const WISELINK_V3_1_FEISHU_NATIVE_SOURCE_UNIT_READBACK_SCHEMA =
  'wiselink.v3_1.feishu_native.source_unit_readback.v1';

/**
 * Select and consume one current Feishu-native SourceUnitSet from Base table
 * readbacks. Empty tables are an explicit WAITING_INPUT result. Any partial,
 * ambiguous, or identity-drifting set fails closed without fallback.
 */
export function consumeFeishuNativeSourceUnitTables({
  sourceUnitSetRecords,
  sourceUnitRecords,
  documentId,
  documentVersionId,
} = {}) {
  if (!Array.isArray(sourceUnitSetRecords) || !Array.isArray(sourceUnitRecords)) {
    throw new TypeError('sourceUnitSetRecords and sourceUnitRecords must be arrays.');
  }
  const requestedDocumentId = optionalText(documentId);
  const requestedDocumentVersionId = optionalText(documentVersionId);
  const matchingSets = sourceUnitSetRecords.filter((record) => {
    const row = recordFields(record, 'SourceUnitSets record');
    if (requestedDocumentId && normalizedRequiredText(row.document_id, 'document_id')
      !== requestedDocumentId) return false;
    if (requestedDocumentVersionId
      && normalizedRequiredText(row.document_version_id, 'document_version_id')
        !== requestedDocumentVersionId) return false;
    return row.is_current === true;
  });

  if (matchingSets.length === 0) {
    return frozenWaitingInput({
      reasonCode: sourceUnitSetRecords.length === 0
        ? 'NO_SOURCE_UNIT_SET_RECORDS'
        : 'NO_MATCHING_CURRENT_SOURCE_UNIT_SET',
      documentId: requestedDocumentId,
      documentVersionId: requestedDocumentVersionId,
      observedSetRecordCount: sourceUnitSetRecords.length,
      observedUnitRecordCount: sourceUnitRecords.length,
    });
  }
  if (matchingSets.length > 1) {
    throw new Error('MULTIPLE_CURRENT_SOURCE_UNIT_SETS');
  }

  const setRow = recordFields(matchingSets[0], 'SourceUnitSets record');
  const lifecycleStatus = normalizeSingleSelect(setRow.lifecycle_status, 'lifecycle_status');
  if (lifecycleStatus !== 'FROZEN') {
    return frozenWaitingInput({
      reasonCode: 'CURRENT_SOURCE_UNIT_SET_NOT_FROZEN',
      documentId: normalizedRequiredText(setRow.document_id, 'document_id'),
      documentVersionId: normalizedRequiredText(
        setRow.document_version_id,
        'document_version_id',
      ),
      observedSetRecordCount: 1,
      observedUnitRecordCount: sourceUnitRecords.length,
    });
  }

  const setId = normalizedRequiredText(setRow.source_unit_set_id, 'source_unit_set_id');
  const matchingUnits = sourceUnitRecords.filter((record) => (
    optionalText(recordFields(record, 'SourceUnits record').source_unit_set_id) === setId
  ));
  return adaptFeishuNativeSourceUnitSetRecord({
    sourceUnitSetRecord: matchingSets[0],
    sourceUnitRecords: matchingUnits,
  });
}

export function adaptFeishuNativeSourceUnitSetRecord({
  sourceUnitSetRecord,
  sourceUnitRecords,
} = {}) {
  const setRow = recordFields(sourceUnitSetRecord, 'sourceUnitSetRecord');
  if (!Array.isArray(sourceUnitRecords)) throw new TypeError('sourceUnitRecords must be an array.');

  const lifecycleStatus = normalizeSingleSelect(setRow.lifecycle_status, 'lifecycle_status');
  if (lifecycleStatus !== 'FROZEN' || setRow.is_current !== true) {
    throw new Error('SOURCE_UNIT_SET_NOT_FROZEN_CURRENT');
  }
  if (setRow.schema_version !== SOURCE_UNIT_SET_SCHEMA_VERSION) {
    throw new Error('SOURCE_UNIT_SET_SCHEMA_VERSION_MISMATCH');
  }

  const storedSetId = normalizedRequiredText(
    setRow.source_unit_set_id,
    'source_unit_set_id',
  );
  const storedSetHash = normalizedSha256(setRow.set_hash, 'set_hash');
  const setDocumentId = normalizedRequiredText(setRow.document_id, 'set.document_id');
  const setDocumentVersionId = normalizedRequiredText(
    setRow.document_version_id,
    'set.document_version_id',
  );
  const setLayoutHash = normalizedSha256(setRow.layout_hash, 'set.layout_hash');
  const setSpecManifestId = normalizedRequiredText(
    setRow.spec_manifest_id,
    'set.spec_manifest_id',
  );

  const unitRows = sourceUnitRecords.map((record, index) => ({
    record,
    fields: recordFields(record, `sourceUnitRecords[${index}]`),
  }));
  if (unitRows.length === 0) throw new Error('SOURCE_UNIT_SET_HAS_NO_UNITS');

  const seenStoredUnitIds = new Set();
  const verifiedUnits = unitRows.map(({ record, fields }, index) => {
    const label = `sourceUnitRecords[${index}]`;
    if (normalizedRequiredText(fields.source_unit_set_id, `${label}.source_unit_set_id`)
      !== storedSetId) throw new Error(`SOURCE_UNIT_SET_MEMBERSHIP_MISMATCH:${index}`);
    if (fields.unit_schema_version !== SOURCE_UNIT_SCHEMA_VERSION) {
      throw new Error(`UNIT_SCHEMA_VERSION_MISMATCH:${index}`);
    }
    if (normalizedRequiredText(fields.document_id, `${label}.document_id`) !== setDocumentId
      || normalizedRequiredText(
        fields.document_version_id,
        `${label}.document_version_id`,
      ) !== setDocumentVersionId) {
      throw new Error(`SOURCE_UNIT_DOCUMENT_IDENTITY_MISMATCH:${index}`);
    }
    if (normalizedSha256(fields.layout_hash, `${label}.layout_hash`) !== setLayoutHash) {
      throw new Error(`SOURCE_UNIT_LAYOUT_HASH_MISMATCH:${index}`);
    }
    if (normalizedRequiredText(fields.spec_manifest_id, `${label}.spec_manifest_id`)
      !== setSpecManifestId) throw new Error(`SOURCE_UNIT_SPEC_MANIFEST_MISMATCH:${index}`);

    const computed = hashUnit(fields);
    const storedUnitId = normalizedRequiredText(fields.unit_id, `${label}.unit_id`);
    const storedUnitHash = normalizedSha256(fields.unit_hash, `${label}.unit_hash`);
    if (storedUnitId !== computed.unitId) throw new Error(`SOURCE_UNIT_ID_MISMATCH:${index}`);
    if (storedUnitHash !== computed.hash) throw new Error(`SOURCE_UNIT_HASH_MISMATCH:${index}`);
    if (seenStoredUnitIds.has(storedUnitId)) throw new Error(`SOURCE_UNIT_ID_DUPLICATE:${storedUnitId}`);
    seenStoredUnitIds.add(storedUnitId);

    return {
      recordId: optionalText(record?.record_id ?? record?.recordId),
      schemaVersion: SOURCE_UNIT_SCHEMA_VERSION,
      unitId: computed.unitId,
      unitHash: computed.hash,
      unitType: computed.payload.unitType,
      readingOrder: computed.payload.readingOrder,
      pageStart: computed.payload.pageStart,
      pageEnd: computed.payload.pageEnd,
      parentUnitId: computed.payload.parentUnitId,
      headingLevel: computed.payload.headingLevel,
      fieldPath: computed.payload.fieldPath,
      textContent: computed.payload.textContent,
      rawMarkdown: computed.payload.rawMarkdown,
      locator: structuredClone(computed.payload.locator),
      sourceRefs: structuredClone(computed.payload.sourceRefs),
      sourceBounded: true,
      frozen: true,
      layoutHash: computed.payload.layoutHash,
      specManifestId: setSpecManifestId,
      canonicalPayload: structuredClone(computed.payload),
    };
  });

  const computedSet = hashSet(setRow, verifiedUnits.map((unit) => ({
    readingOrder: unit.readingOrder,
    unitId: unit.unitId,
    unitHash: unit.unitHash,
  })));
  if (storedSetId !== computedSet.setId) throw new Error('SOURCE_UNIT_SET_ID_MISMATCH');
  if (storedSetHash !== computedSet.hash) throw new Error('SOURCE_UNIT_SET_HASH_MISMATCH');

  return deepFreeze({
    schemaVersion: WISELINK_V3_1_FEISHU_NATIVE_SOURCE_UNIT_READBACK_SCHEMA,
    consumptionContractVersion:
      WISELINK_V3_1_FEISHU_NATIVE_SOURCE_UNIT_CONSUMPTION_SCHEMA,
    hashContractVersion: HASH_CONTRACT_VERSION,
    status: 'READY',
    productionConsumptionAllowed: true,
    sourceUnitSetId: computedSet.setId,
    sourceUnitSetHash: computedSet.hash,
    setId: computedSet.setId,
    setHash: computedSet.hash,
    documentId: computedSet.payload.documentId,
    documentVersionId: computedSet.payload.documentVersionId,
    pdfFileToken: computedSet.payload.pdfFileToken,
    pdfSha256: computedSet.payload.pdfSha256,
    driveSourceVersion: computedSet.payload.driveSourceVersion,
    layoutArtifactRef: computedSet.payload.layoutArtifactRef,
    layoutArtifactSha256: normalizedSha256(
      setRow.layout_artifact_sha256,
      'set.layout_artifact_sha256',
    ),
    layoutHash: computedSet.payload.layoutHash,
    layoutSchemaVersion: computedSet.payload.layoutSchemaVersion,
    sourceContractVersion: computedSet.payload.sourceContractVersion,
    specManifestId: computedSet.payload.specManifestId,
    specManifestHash: computedSet.payload.specManifestHash,
    lifecycleStatus,
    isCurrent: true,
    frozen: true,
    packageCurrentAtFreeze: true,
    unitCount: verifiedUnits.length,
    sourceBoundUnitCount: verifiedUnits.length,
    units: verifiedUnits,
    canonicalSetPayload: structuredClone(computedSet.payload),
    authorityBoundary: {
      canCreateEvidenceRef: false,
      canCloseAssessment: false,
      canActivateParserSpecification: false,
      fallbackAllowed: false,
      silentFailureAllowed: false,
    },
  });
}

function frozenWaitingInput({
  reasonCode,
  documentId,
  documentVersionId,
  observedSetRecordCount,
  observedUnitRecordCount,
}) {
  return deepFreeze({
    schemaVersion: WISELINK_V3_1_FEISHU_NATIVE_SOURCE_UNIT_READBACK_SCHEMA,
    consumptionContractVersion:
      WISELINK_V3_1_FEISHU_NATIVE_SOURCE_UNIT_CONSUMPTION_SCHEMA,
    hashContractVersion: HASH_CONTRACT_VERSION,
    status: 'WAITING_INPUT',
    productionConsumptionAllowed: false,
    reasonCode,
    documentId,
    documentVersionId,
    observedSetRecordCount,
    observedUnitRecordCount,
    fallbackAttempted: false,
    silentFailure: false,
  });
}

function recordFields(record, label) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const fields = record.fields && typeof record.fields === 'object' && !Array.isArray(record.fields)
    ? record.fields
    : record;
  return fields;
}

function normalizeSingleSelect(value, field) {
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new Error(`SINGLE_SELECT_CARDINALITY_INVALID:${field}`);
    return normalizedRequiredText(value[0], field);
  }
  return normalizedRequiredText(value, field);
}

function normalizedRequiredText(value, field) {
  const normalized = optionalText(value);
  if (normalized === null) throw new Error(`NON_EMPTY_TEXT_REQUIRED:${field}`);
  return normalized;
}

function optionalText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error('TEXT_VALUE_REQUIRED');
  const normalized = value.trim().normalize('NFC');
  return normalized || null;
}

function normalizedSha256(value, field) {
  const normalized = normalizedRequiredText(value, field);
  if (!/^sha256:[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error(`SHA256_VALUE_INVALID:${field}`);
  }
  return normalized;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export {
  LOCATOR_SCHEMA_VERSION,
  SOURCE_UNIT_SCHEMA_VERSION,
  SOURCE_UNIT_SET_SCHEMA_VERSION,
};
