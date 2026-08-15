import {
  AEO_EDITOR_PROJECTION_VERSION,
  type AeoBlockUnresolved,
  type AeoContentBlock,
  type AeoContentBlockType,
  type AeoContentOriginType,
  type AeoEditorBlockManifestEntry,
  type AeoEditorProjection,
  type AeoSourceBinding,
  type AeoTiptapJsonNode,
} from '../../../shared/aeo-editor';

import {
  compareText,
  isRecord,
  projectionError,
  requireEnum,
  requireExactKeys,
  requireNonEmptyString,
  requireNullableString,
  requirePositiveInteger,
  requireSha256,
} from './aeo-editor-projection.utils';

const BLOCK_TYPES: readonly AeoContentBlockType[] = [
  'PARAGRAPH',
  'ORDERED_LIST',
  'UNORDERED_LIST',
  'REFERENCE',
  'WARNING',
  'CAUTION',
  'NOTE',
  'DATA_TABLE',
  'CONDITIONAL_BRANCH',
  'IMAGE',
];

const ORIGIN_TYPES: readonly AeoContentOriginType[] = [
  'SOURCE_ADOPTED',
  'SOURCE_ADAPTED',
  'HISTORICAL_OCCURRENCE_COPIED',
  'CATEGORY_PATTERN_INSTANTIATED',
  'LOCAL_METHOD',
  'ENGINEER_AUTHORED',
  'MODEL_SUGGESTED_UNGROUNDED',
];

const SOURCE_ORIGIN_TYPES: readonly AeoSourceBinding['originType'][] = [
  'SOURCE_ADOPTED',
  'SOURCE_ADAPTED',
  'HISTORICAL_OCCURRENCE_COPIED',
  'CATEGORY_PATTERN_INSTANTIATED',
  'LOCAL_METHOD',
];

const BASE_KEYS = [
  'blockId',
  'orderKey',
  'blockType',
  'originType',
  'sourceBindings',
  'engineerDecisionRef',
  'unresolved',
];

export function normalizeAeoContentBlocks(value: unknown): AeoContentBlock[] {
  if (!Array.isArray(value) || value.length === 0) {
    projectionError(
      'AEO_EDITOR_BLOCKS_INVALID',
      'AEO editor blocks must be a non-empty array.',
    );
  }
  const blocks = value.map((entry, index) => normalizeBlock(entry, index));
  assertUnique(blocks.map((entry) => entry.blockId), 'blockId');
  assertUnique(blocks.map((entry) => entry.orderKey), 'orderKey');
  return blocks.sort((left, right) => {
    const byOrder = compareText(left.orderKey, right.orderKey);
    return byOrder || compareText(left.blockId, right.blockId);
  });
}

export function normalizeAeoEditorProjection(
  value: unknown,
): AeoEditorProjection {
  if (!isRecord(value)) {
    projectionError(
      'AEO_EDITOR_PROJECTION_INVALID',
      'AEO editor projection must be an object.',
    );
  }
  requireExactKeys(
    value,
    [
      'projectionVersion',
      'procedureItemId',
      'projectedFromBlockSetHash',
      'editorDocument',
      'blockManifest',
    ],
    'AEO_EDITOR_PROJECTION_FIELDS_INVALID',
    'AEO editor projection',
  );
  if (value.projectionVersion !== AEO_EDITOR_PROJECTION_VERSION) {
    projectionError(
      'AEO_EDITOR_PROJECTION_VERSION_UNSUPPORTED',
      'AEO editor projection version is unsupported.',
    );
  }
  if (!Array.isArray(value.blockManifest) || value.blockManifest.length === 0) {
    projectionError(
      'AEO_EDITOR_PROJECTION_MANIFEST_INVALID',
      'AEO editor projection manifest must be non-empty.',
    );
  }
  const blockManifest = value.blockManifest.map((entry, index) =>
    normalizeManifestEntry(entry, index),
  );
  assertUnique(blockManifest.map((entry) => entry.blockId), 'manifest blockId');
  return {
    projectionVersion: AEO_EDITOR_PROJECTION_VERSION,
    procedureItemId: requireNonEmptyString(
      value.procedureItemId,
      'AEO_EDITOR_PROCEDURE_ITEM_INVALID',
      'procedureItemId',
    ),
    projectedFromBlockSetHash: requireSha256(
      value.projectedFromBlockSetHash,
      'AEO_EDITOR_BLOCK_SET_HASH_INVALID',
      'projectedFromBlockSetHash',
    ),
    editorDocument: normalizeEditorDocument(value.editorDocument),
    blockManifest,
  };
}

function normalizeBlock(value: unknown, index: number): AeoContentBlock {
  if (!isRecord(value)) {
    projectionError('AEO_EDITOR_BLOCK_INVALID', `Block ${index} is invalid.`);
  }
  const blockType = requireEnum(
    value.blockType,
    BLOCK_TYPES,
    'AEO_EDITOR_BLOCK_TYPE_UNSUPPORTED',
    `block ${index} type`,
  );
  const base = normalizeBlockBase(value, index, blockType);
  if (blockType === 'PARAGRAPH') {
    requireExactKeys(value, [...BASE_KEYS, 'bodyZh', 'bodyEn'],
      'AEO_EDITOR_BLOCK_FIELDS_INVALID', `block ${base.blockId}`);
    const bodyZh = nullableBody(value.bodyZh, base.blockId, 'bodyZh');
    const bodyEn = nullableBody(value.bodyEn, base.blockId, 'bodyEn');
    requireLanguageContent(bodyZh, bodyEn, base.blockId);
    return { ...base, blockType, bodyZh, bodyEn };
  }
  if (blockType === 'ORDERED_LIST' || blockType === 'UNORDERED_LIST') {
    requireExactKeys(value, [...BASE_KEYS, 'items'],
      'AEO_EDITOR_BLOCK_FIELDS_INVALID', `block ${base.blockId}`);
    if (!Array.isArray(value.items) || value.items.length === 0) {
      projectionError('AEO_EDITOR_LIST_INVALID', `Block ${base.blockId} list is empty.`);
    }
    const items = value.items.map((entry, itemIndex) =>
      normalizeListItem(entry, base.blockId, itemIndex),
    );
    assertUnique(items.map((entry) => entry.listItemId), 'listItemId');
    return { ...base, blockType, items };
  }
  if (blockType === 'WARNING' || blockType === 'CAUTION' || blockType === 'NOTE') {
    requireExactKeys(value, [...BASE_KEYS, 'titleZh', 'titleEn', 'bodyZh', 'bodyEn'],
      'AEO_EDITOR_BLOCK_FIELDS_INVALID', `block ${base.blockId}`);
    const bodyZh = nullableBody(value.bodyZh, base.blockId, 'bodyZh');
    const bodyEn = nullableBody(value.bodyEn, base.blockId, 'bodyEn');
    requireLanguageContent(bodyZh, bodyEn, base.blockId);
    return {
      ...base,
      blockType,
      titleZh: nullableBody(value.titleZh, base.blockId, 'titleZh'),
      titleEn: nullableBody(value.titleEn, base.blockId, 'titleEn'),
      bodyZh,
      bodyEn,
    };
  }
  if (blockType === 'REFERENCE') return normalizeReference(value, base);
  if (blockType === 'DATA_TABLE') return normalizeDataTable(value, base);
  if (blockType === 'CONDITIONAL_BRANCH') return normalizeBranch(value, base);
  return normalizeImage(value, base);
}

function normalizeBlockBase(
  value: Record<string, unknown>,
  index: number,
  blockType: AeoContentBlockType,
) {
  const blockId = requireNonEmptyString(
    value.blockId, 'AEO_EDITOR_BLOCK_ID_INVALID', `block ${index} blockId`,
  );
  const originType = requireEnum(
    value.originType, ORIGIN_TYPES, 'AEO_EDITOR_ORIGIN_UNSUPPORTED',
    `block ${blockId} originType`,
  );
  if (!Array.isArray(value.sourceBindings) || !Array.isArray(value.unresolved)) {
    projectionError('AEO_EDITOR_PROVENANCE_INVALID', `Block ${blockId} provenance is invalid.`);
  }
  const sourceBindings = value.sourceBindings.map((entry, bindingIndex) =>
    normalizeSourceBinding(entry, blockId, bindingIndex),
  );
  const unresolved = value.unresolved.map((entry, unresolvedIndex) =>
    normalizeUnresolved(entry, blockId, unresolvedIndex),
  );
  const engineerDecisionRef = requireNullableString(
    value.engineerDecisionRef, 'AEO_EDITOR_DECISION_INVALID',
    `block ${blockId} engineerDecisionRef`,
  );
  assertProvenance(blockId, originType, sourceBindings, engineerDecisionRef, unresolved);
  return {
    blockId,
    orderKey: requireNonEmptyString(
      value.orderKey, 'AEO_EDITOR_ORDER_KEY_INVALID', `block ${blockId} orderKey`,
    ),
    blockType,
    originType,
    sourceBindings,
    engineerDecisionRef,
    unresolved,
  };
}

function normalizeSourceBinding(
  value: unknown,
  blockId: string,
  index: number,
): AeoSourceBinding {
  if (!isRecord(value)) {
    projectionError('AEO_EDITOR_SOURCE_BINDING_INVALID', `Block ${blockId} binding ${index} is invalid.`);
  }
  requireExactKeys(value, [
    'bindingId', 'originType', 'usage', 'sourceArtifactRef', 'sourceNodeRef',
    'sourceVersion', 'sourceSha256', 'locator', 'language',
  ], 'AEO_EDITOR_SOURCE_BINDING_FIELDS_INVALID', `block ${blockId} binding ${index}`);
  return {
    bindingId: requireNonEmptyString(value.bindingId, 'AEO_EDITOR_SOURCE_BINDING_INVALID', 'bindingId'),
    originType: requireEnum(value.originType, SOURCE_ORIGIN_TYPES,
      'AEO_EDITOR_SOURCE_BINDING_INVALID', 'binding originType'),
    usage: requireEnum(value.usage, ['ADOPTED', 'ADAPTED', 'COPIED', 'INSTANTIATED', 'REFERENCE_ONLY'],
      'AEO_EDITOR_SOURCE_BINDING_INVALID', 'binding usage'),
    sourceArtifactRef: requireNonEmptyString(value.sourceArtifactRef, 'AEO_EDITOR_SOURCE_BINDING_INVALID', 'sourceArtifactRef'),
    sourceNodeRef: requireNonEmptyString(value.sourceNodeRef, 'AEO_EDITOR_SOURCE_BINDING_INVALID', 'sourceNodeRef'),
    sourceVersion: requireNonEmptyString(value.sourceVersion, 'AEO_EDITOR_SOURCE_BINDING_INVALID', 'sourceVersion'),
    sourceSha256: requireSha256(value.sourceSha256, 'AEO_EDITOR_SOURCE_BINDING_INVALID', 'sourceSha256'),
    locator: requireNonEmptyString(value.locator, 'AEO_EDITOR_SOURCE_BINDING_INVALID', 'locator'),
    language: requireEnum(value.language, ['ZH', 'EN', 'BILINGUAL', 'NONE'],
      'AEO_EDITOR_SOURCE_BINDING_INVALID', 'binding language'),
  };
}

function normalizeUnresolved(value: unknown, blockId: string, index: number): AeoBlockUnresolved {
  if (!isRecord(value)) {
    projectionError('AEO_EDITOR_UNRESOLVED_INVALID', `Block ${blockId} unresolved ${index} is invalid.`);
  }
  requireExactKeys(value, ['unresolvedId', 'code', 'message', 'severity', 'blocksCheckpoint'],
    'AEO_EDITOR_UNRESOLVED_FIELDS_INVALID', `block ${blockId} unresolved ${index}`);
  if (typeof value.blocksCheckpoint !== 'boolean') {
    projectionError('AEO_EDITOR_UNRESOLVED_INVALID', 'blocksCheckpoint must be boolean.');
  }
  return {
    unresolvedId: requireNonEmptyString(value.unresolvedId, 'AEO_EDITOR_UNRESOLVED_INVALID', 'unresolvedId'),
    code: requireNonEmptyString(value.code, 'AEO_EDITOR_UNRESOLVED_INVALID', 'unresolved code'),
    message: requireNonEmptyString(value.message, 'AEO_EDITOR_UNRESOLVED_INVALID', 'unresolved message'),
    severity: requireEnum(value.severity, ['INFO', 'WARNING', 'BLOCKING'],
      'AEO_EDITOR_UNRESOLVED_INVALID', 'unresolved severity'),
    blocksCheckpoint: value.blocksCheckpoint,
  };
}

function normalizeListItem(value: unknown, blockId: string, index: number) {
  if (!isRecord(value)) projectionError('AEO_EDITOR_LIST_INVALID', `Block ${blockId} item ${index} is invalid.`);
  requireExactKeys(value, ['listItemId', 'bodyZh', 'bodyEn'],
    'AEO_EDITOR_LIST_FIELDS_INVALID', `block ${blockId} item ${index}`);
  const bodyZh = nullableBody(value.bodyZh, blockId, 'bodyZh');
  const bodyEn = nullableBody(value.bodyEn, blockId, 'bodyEn');
  requireLanguageContent(bodyZh, bodyEn, `${blockId} list item ${index}`);
  return {
    listItemId: requireNonEmptyString(value.listItemId, 'AEO_EDITOR_LIST_INVALID', 'listItemId'),
    bodyZh,
    bodyEn,
  };
}

function normalizeReference(value: Record<string, unknown>, base: ReturnType<typeof normalizeBlockBase>): AeoContentBlock {
  requireExactKeys(value, [...BASE_KEYS, 'referenceKind', 'referenceLabel', 'targetRef', 'bodyZh', 'bodyEn'],
    'AEO_EDITOR_BLOCK_FIELDS_INVALID', `block ${base.blockId}`);
  return {
    ...base,
    blockType: 'REFERENCE',
    referenceKind: requireEnum(value.referenceKind, ['AMM', 'SB', 'AEO', 'OTHER'], 'AEO_EDITOR_REFERENCE_INVALID', 'referenceKind'),
    referenceLabel: requireNonEmptyString(value.referenceLabel, 'AEO_EDITOR_REFERENCE_INVALID', 'referenceLabel'),
    targetRef: requireNonEmptyString(value.targetRef, 'AEO_EDITOR_REFERENCE_INVALID', 'targetRef'),
    bodyZh: nullableBody(value.bodyZh, base.blockId, 'bodyZh'),
    bodyEn: nullableBody(value.bodyEn, base.blockId, 'bodyEn'),
  };
}

function normalizeDataTable(value: Record<string, unknown>, base: ReturnType<typeof normalizeBlockBase>): AeoContentBlock {
  requireExactKeys(value, [...BASE_KEYS, 'columns', 'rows'],
    'AEO_EDITOR_BLOCK_FIELDS_INVALID', `block ${base.blockId}`);
  if (!Array.isArray(value.columns) || value.columns.length === 0 || !Array.isArray(value.rows) || value.rows.length === 0) {
    projectionError('AEO_EDITOR_TABLE_INVALID', `Block ${base.blockId} table is empty.`);
  }
  const columns = value.columns.map((entry, index) => normalizeColumn(entry, base.blockId, index));
  assertUnique(columns.map((entry) => entry.columnId), 'columnId');
  const columnIds = new Set(columns.map((entry) => entry.columnId));
  const rows = value.rows.map((entry, index) => normalizeRow(entry, base.blockId, index, columnIds));
  assertUnique(rows.map((entry) => entry.rowId), 'rowId');
  return { ...base, blockType: 'DATA_TABLE', columns, rows };
}

function normalizeColumn(value: unknown, blockId: string, index: number) {
  if (!isRecord(value)) projectionError('AEO_EDITOR_TABLE_INVALID', `Block ${blockId} column ${index} is invalid.`);
  requireExactKeys(value, ['columnId', 'titleZh', 'titleEn'], 'AEO_EDITOR_TABLE_FIELDS_INVALID', 'table column');
  return {
    columnId: requireNonEmptyString(value.columnId, 'AEO_EDITOR_TABLE_INVALID', 'columnId'),
    titleZh: nullableBody(value.titleZh, blockId, 'titleZh'),
    titleEn: nullableBody(value.titleEn, blockId, 'titleEn'),
  };
}

function normalizeRow(value: unknown, blockId: string, index: number, columnIds: Set<string>) {
  if (!isRecord(value) || !Array.isArray(value.cells) || value.cells.length === 0) {
    projectionError('AEO_EDITOR_TABLE_INVALID', `Block ${blockId} row ${index} is invalid.`);
  }
  requireExactKeys(value, ['rowId', 'cells'], 'AEO_EDITOR_TABLE_FIELDS_INVALID', 'table row');
  const cells = value.cells.map((entry, cellIndex) => normalizeCell(entry, blockId, cellIndex, columnIds));
  assertUnique(cells.map((entry) => entry.cellId), 'cellId');
  assertUnique(cells.map((entry) => entry.columnId), 'row columnId');
  return {
    rowId: requireNonEmptyString(value.rowId, 'AEO_EDITOR_TABLE_INVALID', 'rowId'),
    cells,
  };
}

function normalizeCell(value: unknown, blockId: string, index: number, columnIds: Set<string>) {
  if (!isRecord(value)) projectionError('AEO_EDITOR_TABLE_INVALID', `Block ${blockId} cell ${index} is invalid.`);
  requireExactKeys(value, ['cellId', 'columnId', 'textZh', 'textEn', 'rowSpan', 'columnSpan'],
    'AEO_EDITOR_TABLE_FIELDS_INVALID', 'table cell');
  const columnId = requireNonEmptyString(value.columnId, 'AEO_EDITOR_TABLE_INVALID', 'cell columnId');
  if (!columnIds.has(columnId)) projectionError('AEO_EDITOR_TABLE_INVALID', `Unknown column ${columnId}.`);
  return {
    cellId: requireNonEmptyString(value.cellId, 'AEO_EDITOR_TABLE_INVALID', 'cellId'),
    columnId,
    textZh: nullableBody(value.textZh, blockId, 'textZh'),
    textEn: nullableBody(value.textEn, blockId, 'textEn'),
    rowSpan: requirePositiveInteger(value.rowSpan, 'AEO_EDITOR_TABLE_INVALID', 'rowSpan'),
    columnSpan: requirePositiveInteger(value.columnSpan, 'AEO_EDITOR_TABLE_INVALID', 'columnSpan'),
  };
}

function normalizeBranch(value: Record<string, unknown>, base: ReturnType<typeof normalizeBlockBase>): AeoContentBlock {
  requireExactKeys(value, [...BASE_KEYS, 'branchEdgeId', 'outcomeLabel', 'effect', 'targetItemId',
    'notApplicableItemIds', 'displayZh', 'displayEn', 'reviewState'],
  'AEO_EDITOR_BLOCK_FIELDS_INVALID', `block ${base.blockId}`);
  if (!Array.isArray(value.notApplicableItemIds)) projectionError('AEO_EDITOR_BRANCH_INVALID', 'notApplicableItemIds must be an array.');
  const notApplicableItemIds = value.notApplicableItemIds.map((entry) =>
    requireNonEmptyString(entry, 'AEO_EDITOR_BRANCH_INVALID', 'notApplicableItemId'));
  assertUnique(notApplicableItemIds, 'notApplicableItemId');
  return {
    ...base,
    blockType: 'CONDITIONAL_BRANCH',
    branchEdgeId: requireNonEmptyString(value.branchEdgeId, 'AEO_EDITOR_BRANCH_INVALID', 'branchEdgeId'),
    outcomeLabel: requireNonEmptyString(value.outcomeLabel, 'AEO_EDITOR_BRANCH_INVALID', 'outcomeLabel'),
    effect: requireNonEmptyString(value.effect, 'AEO_EDITOR_BRANCH_INVALID', 'effect'),
    targetItemId: requireNonEmptyString(value.targetItemId, 'AEO_EDITOR_BRANCH_INVALID', 'targetItemId'),
    notApplicableItemIds,
    displayZh: requireNonEmptyString(value.displayZh, 'AEO_EDITOR_BRANCH_INVALID', 'displayZh'),
    displayEn: requireNonEmptyString(value.displayEn, 'AEO_EDITOR_BRANCH_INVALID', 'displayEn'),
    reviewState: requireEnum(value.reviewState, ['NEEDS_ENGINEERING_REVIEW', 'ENGINEERING_REVIEWED'],
      'AEO_EDITOR_BRANCH_INVALID', 'reviewState'),
  };
}

function normalizeImage(value: Record<string, unknown>, base: ReturnType<typeof normalizeBlockBase>): AeoContentBlock {
  requireExactKeys(value, [...BASE_KEYS, 'imageRef', 'fileName', 'mediaType', 'sha256', 'captionZh', 'captionEn', 'anchorRole'],
    'AEO_EDITOR_BLOCK_FIELDS_INVALID', `block ${base.blockId}`);
  const mediaType = requireNonEmptyString(value.mediaType, 'AEO_EDITOR_IMAGE_INVALID', 'mediaType');
  if (!mediaType.startsWith('image/')) projectionError('AEO_EDITOR_IMAGE_INVALID', 'Image mediaType must start with image/.');
  return {
    ...base,
    blockType: 'IMAGE',
    imageRef: requireNonEmptyString(value.imageRef, 'AEO_EDITOR_IMAGE_INVALID', 'imageRef'),
    fileName: requireNonEmptyString(value.fileName, 'AEO_EDITOR_IMAGE_INVALID', 'fileName'),
    mediaType,
    sha256: requireSha256(value.sha256, 'AEO_EDITOR_IMAGE_INVALID', 'image sha256'),
    captionZh: nullableBody(value.captionZh, base.blockId, 'captionZh'),
    captionEn: nullableBody(value.captionEn, base.blockId, 'captionEn'),
    anchorRole: requireEnum(value.anchorRole, ['INLINE', 'AFTER_ITEM', 'APPENDIX'],
      'AEO_EDITOR_IMAGE_INVALID', 'anchorRole'),
  };
}

function normalizeManifestEntry(value: unknown, index: number): AeoEditorBlockManifestEntry {
  if (!isRecord(value)) projectionError('AEO_EDITOR_MANIFEST_INVALID', `Manifest ${index} is invalid.`);
  requireExactKeys(value, ['blockId', 'orderKey', 'blockType', 'originType', 'sourceBindings',
    'engineerDecisionRef', 'unresolved', 'projectedFromBlockHash', 'immutableStructureHash'],
  'AEO_EDITOR_MANIFEST_FIELDS_INVALID', `manifest ${index}`);
  const stub = normalizeBlockBase({ ...value, blockType: value.blockType }, index,
    requireEnum(value.blockType, BLOCK_TYPES, 'AEO_EDITOR_MANIFEST_INVALID', 'manifest blockType'));
  return {
    ...stub,
    projectedFromBlockHash: requireSha256(value.projectedFromBlockHash, 'AEO_EDITOR_MANIFEST_INVALID', 'projectedFromBlockHash'),
    immutableStructureHash: value.immutableStructureHash === null
      ? null
      : requireSha256(value.immutableStructureHash, 'AEO_EDITOR_MANIFEST_INVALID', 'immutableStructureHash'),
  };
}

function normalizeEditorDocument(value: unknown): AeoTiptapJsonNode {
  if (!isRecord(value)) projectionError('AEO_EDITOR_DOCUMENT_INVALID', 'editorDocument must be an object.');
  requireExactKeys(value, ['type', 'content'], 'AEO_EDITOR_DOCUMENT_FIELDS_INVALID', 'editorDocument');
  if (value.type !== 'doc' || !Array.isArray(value.content) || value.content.length === 0) {
    projectionError('AEO_EDITOR_DOCUMENT_INVALID', 'editorDocument must be a non-empty doc.');
  }
  return { type: 'doc', content: value.content as AeoTiptapJsonNode[] };
}

function assertProvenance(
  blockId: string,
  originType: AeoContentOriginType,
  bindings: AeoSourceBinding[],
  decisionRef: string | null,
  unresolved: AeoBlockUnresolved[],
): void {
  assertUnique(bindings.map((entry) => entry.bindingId), 'bindingId');
  if (originType === 'ENGINEER_AUTHORED' && decisionRef === null) {
    projectionError('AEO_EDITOR_PROVENANCE_INCOMPLETE', `Block ${blockId} needs an engineer decision.`);
  }
  if (originType === 'MODEL_SUGGESTED_UNGROUNDED') {
    const blocked = unresolved.some((entry) => entry.blocksCheckpoint);
    if (!blocked) projectionError('AEO_EDITOR_UNGROUNDED_NOT_BLOCKED', `Block ${blockId} must remain blocked.`);
    return;
  }
  if (originType !== 'ENGINEER_AUTHORED' && !bindings.some((entry) => entry.originType === originType)) {
    projectionError('AEO_EDITOR_PROVENANCE_INCOMPLETE', `Block ${blockId} lost its matching source binding.`);
  }
}

function nullableBody(value: unknown, blockId: string, label: string): string | null {
  return requireNullableString(value, 'AEO_EDITOR_TEXT_INVALID', `block ${blockId} ${label}`);
}

function requireLanguageContent(zh: string | null, en: string | null, label: string): void {
  if (zh === null && en === null) projectionError('AEO_EDITOR_TEXT_INVALID', `${label} has no language content.`);
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    projectionError('AEO_EDITOR_IDENTITY_DUPLICATE', `${label} values must be unique.`);
  }
}
