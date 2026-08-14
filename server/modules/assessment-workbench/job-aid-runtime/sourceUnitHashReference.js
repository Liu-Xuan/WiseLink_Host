import { createHash } from 'node:crypto';

export const HASH_CONTRACT_VERSION = 'wiselink.v3_1.feishu_native.source_unit_hash.v1';
export const SOURCE_UNIT_SCHEMA_VERSION = 'wiselink.v3_1.feishu_native.source_unit.v1';
export const SOURCE_UNIT_SET_SCHEMA_VERSION = 'wiselink.v3_1.feishu_native.source_unit_set.v1';
export const LOCATOR_SCHEMA_VERSION = 'wiselink.v3_1.feishu_native.source_locator.v1';

function assertUnicodeScalarString(value, field) {
  if (typeof value !== 'string') throw new Error(`STRING_REQUIRED:${field}`);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error(`LONE_SURROGATE:${field}`);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error(`LONE_SURROGATE:${field}`);
  }
  return value;
}

function assertJsonValue(value, path = '$') {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    assertUnicodeScalarString(value, path);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error(`HASH_NUMBER_MUST_BE_SAFE_INTEGER:${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`PLAIN_JSON_OBJECT_REQUIRED:${path}`);
  }
  for (const [key, entry] of Object.entries(value)) {
    assertUnicodeScalarString(key, `${path}.<key>`);
    if (entry === undefined) throw new Error(`UNDEFINED_NOT_ALLOWED:${path}.${key}`);
    assertJsonValue(entry, `${path}.${key}`);
  }
}

export function canonicalizeJcs(value) {
  assertJsonValue(value);
  function serialize(entry) {
    if (entry === null || typeof entry !== 'object') return JSON.stringify(entry);
    if (Array.isArray(entry)) return `[${entry.map((item) => serialize(item)).join(',')}]`;
    return `{${Object.keys(entry).sort().map((key) => `${JSON.stringify(key)}:${serialize(entry[key])}`).join(',')}}`;
  }
  return serialize(value);
}

export function sha256Jcs(value) {
  const canonical = canonicalizeJcs(value);
  const digest = createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
  return { canonical, hash: `sha256:${digest}` };
}

function requiredText(value, field) {
  const normalized = optionalIdentifier(value, field);
  if (normalized === null) throw new Error(`NON_EMPTY_TEXT_REQUIRED:${field}`);
  return normalized;
}

function optionalIdentifier(value, field) {
  if (value === null || value === undefined) return null;
  assertUnicodeScalarString(value, field);
  const normalized = value.trim().normalize('NFC');
  return normalized === '' ? null : normalized;
}

function singleSelect(value, field) {
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new Error(`SINGLE_SELECT_CARDINALITY_INVALID:${field}`);
    return requiredText(value[0], field);
  }
  return requiredText(value, field);
}

export function normalizeSourceText(value, field) {
  if (value === null || value === undefined) return null;
  assertUnicodeScalarString(value, field);
  let normalized = value
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .normalize('NFC')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, ''))
    .join('\n')
    .replace(/^(?:[\t ]*\n)+/, '')
    .replace(/(?:\n[\t ]*)+$/, '');
  if (normalized.trim() === '') normalized = '';
  return normalized === '' ? null : normalized;
}

function safeInteger(value, field, minimum = 0) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`SAFE_INTEGER_REQUIRED:${field}`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function nullableIntegerFromBaseText(value, field, minimum = 0) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value.trim())) {
    throw new Error(`BASE_INTEGER_TEXT_INVALID:${field}`);
  }
  const parsed = Number(value.trim());
  return safeInteger(parsed, field, minimum);
}

function sha256Value(value, field) {
  const normalized = requiredText(value, field);
  if (!/^sha256:[0-9a-f]{64}$/.test(normalized)) throw new Error(`SHA256_VALUE_INVALID:${field}`);
  return normalized;
}

function parseCanonicalJsonCell(value, field, expectedKind) {
  const text = requiredText(value, field);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`JSON_CELL_PARSE_FAILED:${field}`);
  }
  if (expectedKind === 'object' && (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')) {
    throw new Error(`JSON_CELL_OBJECT_REQUIRED:${field}`);
  }
  if (expectedKind === 'array' && !Array.isArray(parsed)) throw new Error(`JSON_CELL_ARRAY_REQUIRED:${field}`);
  const canonical = canonicalizeJcs(parsed);
  if (text !== canonical) throw new Error(`JSON_CELL_NOT_CANONICAL:${field}`);
  return parsed;
}

function normalizeLocator(locator, row) {
  const normalized = {
    schemaVersion: requiredText(locator.schemaVersion, 'locator.schemaVersion'),
    artifactRef: requiredText(locator.artifactRef, 'locator.artifactRef'),
    pageStart: safeInteger(locator.pageStart, 'locator.pageStart', 1),
    pageEnd: safeInteger(locator.pageEnd, 'locator.pageEnd', 1),
    readingOrder: safeInteger(locator.readingOrder, 'locator.readingOrder', 0),
    blockIndex: locator.blockIndex === null || locator.blockIndex === undefined
      ? null
      : safeInteger(locator.blockIndex, 'locator.blockIndex', 0),
    bbox: locator.bbox === null || locator.bbox === undefined
      ? null
      : locator.bbox.map((value, index) => safeInteger(value, `locator.bbox[${index}]`, 0)),
    headingPath: locator.headingPath === null || locator.headingPath === undefined
      ? []
      : locator.headingPath.map((value, index) => requiredText(value, `locator.headingPath[${index}]`)),
    anchorTextHash: sha256Value(locator.anchorTextHash, 'locator.anchorTextHash'),
  };
  if (normalized.schemaVersion !== LOCATOR_SCHEMA_VERSION) throw new Error('LOCATOR_SCHEMA_VERSION_MISMATCH');
  if (normalized.pageEnd < normalized.pageStart) throw new Error('LOCATOR_PAGE_RANGE_INVALID');
  if (normalized.bbox && (normalized.bbox.length !== 4
    || normalized.bbox.some((value) => value > 1_000_000)
    || normalized.bbox[2] < normalized.bbox[0]
    || normalized.bbox[3] < normalized.bbox[1])) {
    throw new Error('LOCATOR_BBOX_INVALID');
  }
  if (normalized.pageStart !== row.pageStart
    || normalized.pageEnd !== row.pageEnd
    || normalized.readingOrder !== row.readingOrder) {
    throw new Error('LOCATOR_BASE_FIELD_MISMATCH');
  }
  return normalized;
}

function normalizeSourceRefs(sourceRefs) {
  const normalized = sourceRefs.map((entry, index) => ({
    artifactRef: requiredText(entry.artifactRef, `sourceRefs[${index}].artifactRef`),
    pageStart: safeInteger(entry.pageStart, `sourceRefs[${index}].pageStart`, 1),
    pageEnd: safeInteger(entry.pageEnd, `sourceRefs[${index}].pageEnd`, 1),
    anchorTextHash: sha256Value(entry.anchorTextHash, `sourceRefs[${index}].anchorTextHash`),
  }));
  for (const [index, entry] of normalized.entries()) {
    if (entry.pageEnd < entry.pageStart) throw new Error(`SOURCE_REF_PAGE_RANGE_INVALID:${index}`);
  }
  normalized.sort((left, right) => {
    const leftCanonical = canonicalizeJcs(left);
    const rightCanonical = canonicalizeJcs(right);
    return leftCanonical < rightCanonical ? -1 : leftCanonical > rightCanonical ? 1 : 0;
  });
  const keys = normalized.map((entry) => canonicalizeJcs(entry));
  if (new Set(keys).size !== keys.length) throw new Error('SOURCE_REFS_DUPLICATE');
  return normalized;
}

export function buildUnitHashPayload(baseRow) {
  const readingOrder = safeInteger(baseRow.reading_order, 'reading_order', 0);
  const pageStart = safeInteger(baseRow.page_number, 'page_number', 1);
  const pageEnd = safeInteger(baseRow.end_page_number, 'end_page_number', 1);
  const locator = normalizeLocator(
    parseCanonicalJsonCell(baseRow.locator_json, 'locator_json', 'object'),
    { readingOrder, pageStart, pageEnd },
  );
  const sourceRefs = normalizeSourceRefs(
    parseCanonicalJsonCell(baseRow.source_refs_json, 'source_refs_json', 'array'),
  );
  const textContent = normalizeSourceText(baseRow.text_content, 'text_content');
  const rawMarkdown = normalizeSourceText(baseRow.raw_markdown, 'raw_markdown');
  if (textContent === null && rawMarkdown === null) throw new Error('UNIT_CANONICAL_SOURCE_CONTENT_REQUIRED');
  if (baseRow.unit_schema_version !== SOURCE_UNIT_SCHEMA_VERSION) throw new Error('UNIT_SCHEMA_VERSION_MISMATCH');
  if (baseRow.source_bounded !== true || baseRow.frozen !== true) throw new Error('UNIT_NOT_FROZEN_SOURCE_BOUNDED');
  return {
    schemaVersion: SOURCE_UNIT_SCHEMA_VERSION,
    documentId: requiredText(baseRow.document_id, 'document_id'),
    documentVersionId: requiredText(baseRow.document_version_id, 'document_version_id'),
    layoutHash: sha256Value(baseRow.layout_hash, 'layout_hash'),
    unitType: singleSelect(baseRow.unit_type, 'unit_type'),
    readingOrder,
    pageStart,
    pageEnd,
    parentUnitId: optionalIdentifier(baseRow.parent_unit_id, 'parent_unit_id'),
    headingLevel: nullableIntegerFromBaseText(baseRow.heading_level, 'heading_level', 1),
    fieldPath: optionalIdentifier(baseRow.field_path, 'field_path'),
    textContent,
    rawMarkdown,
    locator,
    sourceRefs,
  };
}

export function hashUnit(baseRow) {
  const payload = buildUnitHashPayload(baseRow);
  const result = sha256Jcs(payload);
  const digest = result.hash.slice('sha256:'.length);
  return { ...result, payload, unitId: `SU-${digest.slice(0, 24).toUpperCase()}` };
}

export function buildSetHashPayload(baseSetRow, unitIdentities) {
  if (baseSetRow.schema_version !== SOURCE_UNIT_SET_SCHEMA_VERSION) {
    throw new Error('SOURCE_UNIT_SET_SCHEMA_VERSION_MISMATCH');
  }
  const units = unitIdentities.map((entry, index) => ({
    readingOrder: safeInteger(entry.readingOrder, `units[${index}].readingOrder`, 0),
    unitId: requiredText(entry.unitId, `units[${index}].unitId`),
    unitHash: sha256Value(entry.unitHash, `units[${index}].unitHash`),
  })).sort((left, right) => left.readingOrder - right.readingOrder || (left.unitId < right.unitId ? -1 : left.unitId > right.unitId ? 1 : 0));
  if (new Set(units.map((entry) => entry.unitId)).size !== units.length) throw new Error('UNIT_ID_DUPLICATE');
  if (baseSetRow.unit_count !== units.length
    || baseSetRow.source_bounded_unit_count !== units.length) {
    throw new Error('SOURCE_UNIT_SET_COUNT_MISMATCH');
  }
  return {
    schemaVersion: SOURCE_UNIT_SET_SCHEMA_VERSION,
    documentId: requiredText(baseSetRow.document_id, 'set.document_id'),
    documentVersionId: requiredText(baseSetRow.document_version_id, 'set.document_version_id'),
    pdfFileToken: requiredText(baseSetRow.pdf_file_token, 'set.pdf_file_token'),
    pdfSha256: sha256Value(baseSetRow.pdf_sha256, 'set.pdf_sha256'),
    driveSourceVersion: requiredText(baseSetRow.drive_source_version, 'set.drive_source_version'),
    layoutArtifactRef: requiredText(baseSetRow.layout_artifact_ref, 'set.layout_artifact_ref'),
    layoutHash: sha256Value(baseSetRow.layout_hash, 'set.layout_hash'),
    layoutSchemaVersion: requiredText(baseSetRow.layout_schema_version, 'set.layout_schema_version'),
    sourceContractVersion: requiredText(baseSetRow.source_contract_version, 'set.source_contract_version'),
    specManifestId: requiredText(baseSetRow.spec_manifest_id, 'set.spec_manifest_id'),
    specManifestHash: sha256Value(baseSetRow.spec_manifest_hash, 'set.spec_manifest_hash'),
    units,
  };
}

export function hashSet(baseSetRow, unitIdentities) {
  const payload = buildSetHashPayload(baseSetRow, unitIdentities);
  const result = sha256Jcs(payload);
  const digest = result.hash.slice('sha256:'.length);
  return { ...result, payload, setId: `SUS-${digest.slice(0, 24).toUpperCase()}` };
}

export function buildSyntheticVectorInput() {
  const anchorTextHash = `sha256:${'2'.repeat(64)}`;
  const locator = {
    schemaVersion: LOCATOR_SCHEMA_VERSION,
    artifactRef: 'drive://synthetic/layout.json',
    pageStart: 1,
    pageEnd: 1,
    readingOrder: 0,
    blockIndex: 7,
    bbox: [100000, 200000, 900000, 260000],
    headingPath: ['B. Concurrent Requirements'],
    anchorTextHash,
  };
  const sourceRefs = [{
    artifactRef: locator.artifactRef,
    pageStart: 1,
    pageEnd: 1,
    anchorTextHash,
  }];
  const unit = {
    unit_schema_version: SOURCE_UNIT_SCHEMA_VERSION,
    document_id: 'DOC-SYNTHETIC-001',
    document_version_id: 'DV-SYNTHETIC-001',
    layout_hash: `sha256:${'1'.repeat(64)}`,
    unit_type: 'heading',
    reading_order: 0,
    page_number: 1,
    end_page_number: 1,
    parent_unit_id: null,
    heading_level: '3',
    field_path: 'familyFields.groupSpecificConcurrentRequirements',
    text_content: 'B. Concurrent Requirements\r\nNone.  ',
    raw_markdown: '\uFEFF### B. Concurrent Requirements\nNone.\n',
    locator_json: canonicalizeJcs(locator),
    source_refs_json: canonicalizeJcs(sourceRefs),
    source_bounded: true,
    frozen: true,
  };
  const set = {
    schema_version: SOURCE_UNIT_SET_SCHEMA_VERSION,
    document_id: 'DOC-SYNTHETIC-001',
    document_version_id: 'DV-SYNTHETIC-001',
    pdf_file_token: 'file_synthetic_pdf_001',
    pdf_sha256: `sha256:${'3'.repeat(64)}`,
    drive_source_version: 'synthetic-v1',
    layout_artifact_ref: 'drive://synthetic/layout.json',
    layout_hash: `sha256:${'1'.repeat(64)}`,
    layout_schema_version: 'wiselink.v3_1.feishu_native.layout.v1',
    source_contract_version: 'wiselink.v3_1.feishu_native.source_binding.v1',
    spec_manifest_id: 'service_bulletin@synthetic-v1',
    spec_manifest_hash: `sha256:${'4'.repeat(64)}`,
    unit_count: 1,
    source_bounded_unit_count: 1,
  };
  return { unit, set };
}
