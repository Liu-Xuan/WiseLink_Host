import {
  AEO_EDITOR_PROJECTION_VERSION,
  type AeoAdvisoryBlock,
  type AeoConditionalBranchBlock,
  type AeoContentBlock,
  type AeoDataTableBlock,
  type AeoEditorBlockManifestEntry,
  type AeoEditorProjection,
  type AeoEditorProjectionResult,
  type AeoImageBlock,
  type AeoListBlock,
  type AeoReferenceBlock,
  type AeoTiptapJsonNode,
} from '../../../shared/aeo-editor';

import {
  normalizeAeoContentBlocks,
  normalizeAeoEditorProjection,
} from './aeo-editor-projection.validation';
import {
  canonicalStringify,
  isRecord,
  projectionError,
  requireExactKeys,
  requireNonEmptyString,
  requireNullableString,
  sha256Hex,
} from './aeo-editor-projection.utils';

export function projectAeoBlocksToTiptap(
  procedureItemId: string,
  value: unknown,
): AeoEditorProjection {
  const normalizedProcedureItemId = requireNonEmptyString(
    procedureItemId,
    'AEO_EDITOR_PROCEDURE_ITEM_INVALID',
    'procedureItemId',
  );
  const blocks = normalizeAeoContentBlocks(value);
  const blockManifest = blocks.map(makeManifestEntry);
  return {
    projectionVersion: AEO_EDITOR_PROJECTION_VERSION,
    procedureItemId: normalizedProcedureItemId,
    projectedFromBlockSetHash: hashManifest(blockManifest),
    editorDocument: {
      type: 'doc',
      content: blocks.map(projectBlock),
    },
    blockManifest,
  };
}

export function projectTiptapToAeoBlocks(value: unknown): AeoEditorProjectionResult {
  const projection = normalizeAeoEditorProjection(value);
  if (hashManifest(projection.blockManifest) !== projection.projectedFromBlockSetHash) {
    projectionError(
      'AEO_EDITOR_PROJECTION_STALE',
      'The editor projection manifest no longer matches its block-set hash.',
    );
  }
  const content = projection.editorDocument.content ?? [];
  if (content.length !== projection.blockManifest.length) {
    projectionError(
      'AEO_EDITOR_BLOCK_COVERAGE_INCOMPLETE',
      'The editor document must contain every manifested block exactly once.',
    );
  }
  const manifestByBlockId = new Map(
    projection.blockManifest.map((entry) => [entry.blockId, entry]),
  );
  const seenBlockIds = new Set<string>();
  const blocks = content.map((node, index) => {
    const blockId = editorNodeBlockId(node, index);
    const manifest = manifestByBlockId.get(blockId);
    if (!manifest || seenBlockIds.has(blockId)) {
      projectionError(
        'AEO_EDITOR_BLOCK_COVERAGE_INCOMPLETE',
        'The editor document must contain every manifested block exactly once.',
      );
    }
    seenBlockIds.add(blockId);
    return restoreBlock(node, manifest, index);
  });
  if (seenBlockIds.size !== projection.blockManifest.length) {
    projectionError(
      'AEO_EDITOR_BLOCK_COVERAGE_INCOMPLETE',
      'The editor document must contain every manifested block exactly once.',
    );
  }
  const normalizedBlocks = normalizeAeoContentBlocks(blocks);
  const contentBlockIds = content.map((node, index) =>
    editorNodeBlockId(node, index),
  );
  if (
    normalizedBlocks.some(
      (block, index) => block.blockId !== contentBlockIds[index],
    )
  ) {
    projectionError(
      'AEO_EDITOR_ORDER_INCONSISTENT',
      'Top-level block order and orderKey values must describe the same order.',
    );
  }
  const changedBlockIds = normalizedBlocks.flatMap((block) => {
    const manifest = projection.blockManifest.find(
      (entry) => entry.blockId === block.blockId,
    );
    return manifest && hashBlock(block) !== manifest.projectedFromBlockHash
      ? [block.blockId]
      : [];
  });
  return {
    procedureItemId: projection.procedureItemId,
    projectedFromBlockSetHash: projection.projectedFromBlockSetHash,
    currentBlockSetHash: hashAeoContentBlocks(normalizedBlocks),
    changedBlockIds,
    blocks: normalizedBlocks,
  };
}

export function hashAeoContentBlocks(value: unknown): string {
  return hashManifest(normalizeAeoContentBlocks(value).map(makeManifestEntry));
}

function projectBlock(block: AeoContentBlock): AeoTiptapJsonNode {
  const attrs = commonNodeAttrs(block);
  if (block.blockType === 'PARAGRAPH') {
    return {
      type: 'aeoParagraph',
      attrs,
      content: languageSlots(block.bodyZh, block.bodyEn),
    };
  }
  if (block.blockType === 'ORDERED_LIST' || block.blockType === 'UNORDERED_LIST') {
    return {
      type: 'aeoList',
      attrs: { ...attrs, listKind: block.blockType },
      content: block.items.map((item) => ({
        type: 'aeoListItem',
        attrs: { listItemId: item.listItemId },
        content: languageSlots(item.bodyZh, item.bodyEn),
      })),
    };
  }
  if (block.blockType === 'WARNING' || block.blockType === 'CAUTION' || block.blockType === 'NOTE') {
    return {
      type: 'aeoAdvisory',
      attrs: {
        ...attrs,
        advisoryType: block.blockType,
        titleZh: block.titleZh,
        titleEn: block.titleEn,
      },
      content: languageSlots(block.bodyZh, block.bodyEn),
    };
  }
  if (block.blockType === 'REFERENCE') {
    return atomNode('aeoReference', attrs, {
      referenceKind: block.referenceKind,
      referenceLabel: block.referenceLabel,
      targetRef: block.targetRef,
      bodyZh: block.bodyZh,
      bodyEn: block.bodyEn,
    });
  }
  if (block.blockType === 'DATA_TABLE') {
    return atomNode('aeoDataTable', attrs, {
      columns: block.columns,
      rows: block.rows,
    });
  }
  if (block.blockType === 'CONDITIONAL_BRANCH') {
    return atomNode('aeoConditionalBranch', attrs, {
      branchEdgeId: block.branchEdgeId,
      outcomeLabel: block.outcomeLabel,
      effect: block.effect,
      targetItemId: block.targetItemId,
      notApplicableItemIds: block.notApplicableItemIds,
      displayZh: block.displayZh,
      displayEn: block.displayEn,
      reviewState: block.reviewState,
    });
  }
  if ('imageRef' in block && block.blockType === 'IMAGE') {
    return atomNode('aeoImageAnchor', attrs, {
      imageRef: block.imageRef,
      fileName: block.fileName,
      mediaType: block.mediaType,
      sha256: block.sha256,
      captionZh: block.captionZh,
      captionEn: block.captionEn,
      anchorRole: block.anchorRole,
    });
  }
  return projectionError(
    'AEO_EDITOR_BLOCK_TYPE_UNSUPPORTED',
    `Unsupported AEO block type ${block.blockType}.`,
  );
}

function restoreBlock(
  node: AeoTiptapJsonNode,
  manifest: AeoEditorBlockManifestEntry,
  index: number,
): AeoContentBlock {
  assertNodeEnvelope(node, index);
  const attrs = requireNodeAttrs(node, index);
  const orderKey = assertCommonNodeAttrs(attrs, manifest, index);
  const base = {
    blockId: manifest.blockId,
    orderKey,
    originType: manifest.originType,
    sourceBindings: manifest.sourceBindings,
    engineerDecisionRef: manifest.engineerDecisionRef,
    unresolved: manifest.unresolved,
  };
  let block: AeoContentBlock;
  if (manifest.blockType === 'PARAGRAPH') {
    assertNodeType(node, 'aeoParagraph', manifest.blockId);
    const body = restoreLanguageSlots(node.content, manifest.blockId);
    block = { ...base, blockType: 'PARAGRAPH', ...body };
  } else if (
    manifest.blockType === 'ORDERED_LIST' ||
    manifest.blockType === 'UNORDERED_LIST'
  ) {
    block = restoreList(node, attrs, manifest, base);
  } else if (
    manifest.blockType === 'WARNING' ||
    manifest.blockType === 'CAUTION' ||
    manifest.blockType === 'NOTE'
  ) {
    block = restoreAdvisory(node, attrs, manifest, base);
  } else if (manifest.blockType === 'REFERENCE') {
    block = restoreReference(node, attrs, base);
  } else if (manifest.blockType === 'DATA_TABLE') {
    block = restoreTable(node, attrs, base);
  } else if (manifest.blockType === 'CONDITIONAL_BRANCH') {
    block = restoreBranch(node, attrs, base);
  } else {
    block = restoreImage(node, attrs, base);
  }
  if (immutableStructureHash(block) !== manifest.immutableStructureHash) {
    projectionError(
      'AEO_EDITOR_IMMUTABLE_STRUCTURE_CHANGED',
      `Block ${manifest.blockId} changed immutable identity or structure.`,
    );
  }
  return block;
}

function restoreList(
  node: AeoTiptapJsonNode,
  attrs: Record<string, unknown>,
  manifest: AeoEditorBlockManifestEntry,
  base: Omit<AeoListBlock, 'blockType' | 'items'>,
): AeoListBlock {
  assertNodeType(node, 'aeoList', manifest.blockId);
  if (
    manifest.blockType !== 'ORDERED_LIST' &&
    manifest.blockType !== 'UNORDERED_LIST'
  ) {
    projectionError(
      'AEO_EDITOR_LIST_INVALID',
      `Block ${manifest.blockId} manifest list type is invalid.`,
    );
  }
  requireExactKeys(attrs, ['blockId', 'orderKey', 'blockType', 'listKind'],
    'AEO_EDITOR_NODE_ATTRS_INVALID', `block ${manifest.blockId} attrs`);
  if (attrs.listKind !== manifest.blockType || !Array.isArray(node.content)) {
    projectionError('AEO_EDITOR_LIST_INVALID', `Block ${manifest.blockId} list kind or items are invalid.`);
  }
  const items = node.content.map((item, index) => {
    assertNodeEnvelope(item, index);
    assertNodeType(item, 'aeoListItem', manifest.blockId);
    const itemAttrs = requireNodeAttrs(item, index);
    requireExactKeys(itemAttrs, ['listItemId'], 'AEO_EDITOR_LIST_INVALID', 'list item attrs');
    return {
      listItemId: requireNonEmptyString(itemAttrs.listItemId, 'AEO_EDITOR_LIST_INVALID', 'listItemId'),
      ...restoreLanguageSlots(item.content, `${manifest.blockId} list item ${index}`),
    };
  });
  return { ...base, blockType: manifest.blockType, items };
}

function restoreAdvisory(
  node: AeoTiptapJsonNode,
  attrs: Record<string, unknown>,
  manifest: AeoEditorBlockManifestEntry,
  base: Omit<AeoAdvisoryBlock, 'blockType' | 'titleZh' | 'titleEn' | 'bodyZh' | 'bodyEn'>,
): AeoAdvisoryBlock {
  assertNodeType(node, 'aeoAdvisory', manifest.blockId);
  requireExactKeys(attrs, ['blockId', 'orderKey', 'blockType', 'advisoryType', 'titleZh', 'titleEn'],
    'AEO_EDITOR_NODE_ATTRS_INVALID', `block ${manifest.blockId} attrs`);
  if (attrs.advisoryType !== manifest.blockType) {
    projectionError('AEO_EDITOR_ADVISORY_INVALID', `Block ${manifest.blockId} advisory type changed.`);
  }
  return {
    ...base,
    blockType: manifest.blockType as AeoAdvisoryBlock['blockType'],
    titleZh: requireNullableString(attrs.titleZh, 'AEO_EDITOR_ADVISORY_INVALID', 'titleZh'),
    titleEn: requireNullableString(attrs.titleEn, 'AEO_EDITOR_ADVISORY_INVALID', 'titleEn'),
    ...restoreLanguageSlots(node.content, manifest.blockId),
  };
}

function restoreReference(
  node: AeoTiptapJsonNode,
  attrs: Record<string, unknown>,
  base: Omit<AeoReferenceBlock, 'blockType' | 'referenceKind' | 'referenceLabel' | 'targetRef' | 'bodyZh' | 'bodyEn'>,
): AeoReferenceBlock {
  assertAtom(node, 'aeoReference', base.blockId);
  requireExactKeys(attrs, ['blockId', 'orderKey', 'blockType', 'referenceKind', 'referenceLabel',
    'targetRef', 'bodyZh', 'bodyEn'], 'AEO_EDITOR_NODE_ATTRS_INVALID', `block ${base.blockId} attrs`);
  return {
    ...base,
    blockType: 'REFERENCE',
    referenceKind: attrs.referenceKind as AeoReferenceBlock['referenceKind'],
    referenceLabel: String(attrs.referenceLabel ?? ''),
    targetRef: String(attrs.targetRef ?? ''),
    bodyZh: attrs.bodyZh === null ? null : String(attrs.bodyZh ?? ''),
    bodyEn: attrs.bodyEn === null ? null : String(attrs.bodyEn ?? ''),
  };
}

function restoreTable(node: AeoTiptapJsonNode, attrs: Record<string, unknown>, base: Omit<AeoDataTableBlock, 'blockType' | 'columns' | 'rows'>): AeoDataTableBlock {
  assertAtom(node, 'aeoDataTable', base.blockId);
  requireExactKeys(attrs, ['blockId', 'orderKey', 'blockType', 'columns', 'rows'],
    'AEO_EDITOR_NODE_ATTRS_INVALID', `block ${base.blockId} attrs`);
  return { ...base, blockType: 'DATA_TABLE', columns: attrs.columns as AeoDataTableBlock['columns'], rows: attrs.rows as AeoDataTableBlock['rows'] };
}

function restoreBranch(node: AeoTiptapJsonNode, attrs: Record<string, unknown>, base: Omit<AeoConditionalBranchBlock, 'blockType' | 'branchEdgeId' | 'outcomeLabel' | 'effect' | 'targetItemId' | 'notApplicableItemIds' | 'displayZh' | 'displayEn' | 'reviewState'>): AeoConditionalBranchBlock {
  assertAtom(node, 'aeoConditionalBranch', base.blockId);
  requireExactKeys(attrs, ['blockId', 'orderKey', 'blockType', 'branchEdgeId',
    'outcomeLabel', 'effect', 'targetItemId', 'notApplicableItemIds',
    'displayZh', 'displayEn', 'reviewState'], 'AEO_EDITOR_NODE_ATTRS_INVALID',
  `block ${base.blockId} attrs`);
  return { ...base, blockType: 'CONDITIONAL_BRANCH', branchEdgeId: String(attrs.branchEdgeId ?? ''), outcomeLabel: String(attrs.outcomeLabel ?? ''), effect: String(attrs.effect ?? ''), targetItemId: String(attrs.targetItemId ?? ''), notApplicableItemIds: attrs.notApplicableItemIds as string[], displayZh: String(attrs.displayZh ?? ''), displayEn: String(attrs.displayEn ?? ''), reviewState: attrs.reviewState as AeoConditionalBranchBlock['reviewState'] };
}

function restoreImage(node: AeoTiptapJsonNode, attrs: Record<string, unknown>, base: Omit<AeoImageBlock, 'blockType' | 'imageRef' | 'fileName' | 'mediaType' | 'sha256' | 'captionZh' | 'captionEn' | 'anchorRole'>): AeoImageBlock {
  assertAtom(node, 'aeoImageAnchor', base.blockId);
  requireExactKeys(attrs, ['blockId', 'orderKey', 'blockType', 'imageRef',
    'fileName', 'mediaType', 'sha256', 'captionZh', 'captionEn', 'anchorRole'],
  'AEO_EDITOR_NODE_ATTRS_INVALID', `block ${base.blockId} attrs`);
  return { ...base, blockType: 'IMAGE', imageRef: String(attrs.imageRef ?? ''), fileName: String(attrs.fileName ?? ''), mediaType: String(attrs.mediaType ?? ''), sha256: String(attrs.sha256 ?? ''), captionZh: attrs.captionZh === null ? null : String(attrs.captionZh ?? ''), captionEn: attrs.captionEn === null ? null : String(attrs.captionEn ?? ''), anchorRole: attrs.anchorRole as AeoImageBlock['anchorRole'] };
}

function languageSlots(bodyZh: string | null, bodyEn: string | null): AeoTiptapJsonNode[] {
  return ([['ZH', bodyZh], ['EN', bodyEn]] as const).flatMap(([language, body]) =>
    body === null ? [] : [{ type: 'aeoLanguageSlot', attrs: { language }, content: [{ type: 'paragraph', content: body.length > 0 ? [{ type: 'text', text: body }] : [] }] }]);
}

function restoreLanguageSlots(content: AeoTiptapJsonNode[] | undefined, label: string): { bodyZh: string | null; bodyEn: string | null } {
  if (!Array.isArray(content) || content.length === 0 || content.length > 2) projectionError('AEO_EDITOR_LANGUAGE_SLOTS_INVALID', `${label} language slots are invalid.`);
  const values: { bodyZh: string | null; bodyEn: string | null } = { bodyZh: null, bodyEn: null };
  const seen = new Set<string>();
  for (const slot of content) {
    assertNodeEnvelope(slot, 0);
    assertNodeType(slot, 'aeoLanguageSlot', label);
    const attrs = requireNodeAttrs(slot, 0);
    requireExactKeys(attrs, ['language'], 'AEO_EDITOR_LANGUAGE_SLOTS_INVALID', `${label} language attrs`);
    const language = attrs.language;
    if ((language !== 'ZH' && language !== 'EN') || seen.has(language)) projectionError('AEO_EDITOR_LANGUAGE_SLOTS_INVALID', `${label} has duplicate or unknown language slots.`);
    seen.add(language);
    const body = restorePlainParagraph(slot.content, label);
    if (language === 'ZH') values.bodyZh = body;
    else values.bodyEn = body;
  }
  return values;
}

function restorePlainParagraph(content: AeoTiptapJsonNode[] | undefined, label: string): string {
  if (!Array.isArray(content) || content.length !== 1 || content[0].type !== 'paragraph') projectionError('AEO_EDITOR_TEXT_STRUCTURE_INVALID', `${label} must contain one plain paragraph.`);
  const paragraph = content[0];
  if (paragraph.attrs || paragraph.marks || paragraph.text) projectionError('AEO_EDITOR_TEXT_STRUCTURE_INVALID', `${label} paragraph has unsupported fields.`);
  const children = paragraph.content ?? [];
  if (children.length === 0) return '';
  if (children.length !== 1 || children[0].type !== 'text' || typeof children[0].text !== 'string' || children[0].attrs || children[0].content || children[0].marks) projectionError('AEO_EDITOR_TEXT_STRUCTURE_INVALID', `${label} contains unsupported rich text.`);
  return children[0].text;
}

function atomNode(type: string, common: Record<string, unknown>, payload: Record<string, unknown>): AeoTiptapJsonNode {
  return { type, attrs: { ...common, ...payload } };
}

function commonNodeAttrs(block: AeoContentBlock): Record<string, unknown> {
  return { blockId: block.blockId, orderKey: block.orderKey, blockType: block.blockType };
}

function makeManifestEntry(block: AeoContentBlock): AeoEditorBlockManifestEntry {
  return { blockId: block.blockId, orderKey: block.orderKey, blockType: block.blockType, originType: block.originType, sourceBindings: block.sourceBindings, engineerDecisionRef: block.engineerDecisionRef, unresolved: block.unresolved, projectedFromBlockHash: hashBlock(block), immutableStructureHash: immutableStructureHash(block) };
}

function immutableStructureHash(block: AeoContentBlock): string | null {
  let value: unknown = null;
  if (block.blockType === 'ORDERED_LIST' || block.blockType === 'UNORDERED_LIST') value = { listKind: block.blockType, listItemIds: block.items.map((item) => item.listItemId) };
  else if (block.blockType === 'REFERENCE') value = { referenceKind: block.referenceKind, targetRef: block.targetRef };
  else if (block.blockType === 'DATA_TABLE') value = { columns: block.columns.map((column) => column.columnId), rows: block.rows.map((row) => ({ rowId: row.rowId, cells: row.cells.map((cell) => ({ cellId: cell.cellId, columnId: cell.columnId, rowSpan: cell.rowSpan, columnSpan: cell.columnSpan })) })) };
  else if (block.blockType === 'CONDITIONAL_BRANCH') value = { branchEdgeId: block.branchEdgeId, outcomeLabel: block.outcomeLabel, effect: block.effect, targetItemId: block.targetItemId, notApplicableItemIds: block.notApplicableItemIds, displayZh: block.displayZh, displayEn: block.displayEn, reviewState: block.reviewState };
  else if (block.blockType === 'IMAGE') value = { imageRef: block.imageRef, fileName: block.fileName, mediaType: block.mediaType, sha256: block.sha256, anchorRole: block.anchorRole };
  return value === null ? null : sha256Hex(canonicalStringify(value));
}

function hashBlock(block: AeoContentBlock): string { return sha256Hex(canonicalStringify(block)); }
function hashManifest(entries: AeoEditorBlockManifestEntry[]): string { return sha256Hex(canonicalStringify(entries.map((entry) => ({ blockId: entry.blockId, orderKey: entry.orderKey, blockType: entry.blockType, blockHash: entry.projectedFromBlockHash })))); }

function assertNodeEnvelope(node: AeoTiptapJsonNode, index: number): void {
  if (!isRecord(node) || typeof node.type !== 'string' || node.text !== undefined || node.marks !== undefined) projectionError('AEO_EDITOR_NODE_INVALID', `Editor node ${index} is invalid.`);
}

function requireNodeAttrs(node: AeoTiptapJsonNode, index: number): Record<string, unknown> {
  if (!isRecord(node.attrs)) projectionError('AEO_EDITOR_NODE_ATTRS_INVALID', `Editor node ${index} has no attrs.`);
  return node.attrs;
}

function assertCommonNodeAttrs(
  attrs: Record<string, unknown>,
  manifest: AeoEditorBlockManifestEntry,
  index: number,
): string {
  if (
    attrs.blockId !== manifest.blockId ||
    attrs.blockType !== manifest.blockType
  ) {
    projectionError(
      'AEO_EDITOR_BLOCK_IDENTITY_CHANGED',
      `Editor node ${index} no longer matches its manifest identity.`,
    );
  }
  return requireNonEmptyString(
    attrs.orderKey,
    'AEO_EDITOR_ORDER_KEY_INVALID',
    `block ${manifest.blockId} orderKey`,
  );
}

function editorNodeBlockId(node: AeoTiptapJsonNode, index: number): string {
  assertNodeEnvelope(node, index);
  const attrs = requireNodeAttrs(node, index);
  return requireNonEmptyString(
    attrs.blockId,
    'AEO_EDITOR_BLOCK_ID_INVALID',
    `editor node ${index} blockId`,
  );
}

function assertNodeType(node: AeoTiptapJsonNode, expected: string, blockId: string): void {
  if (node.type !== expected) projectionError('AEO_EDITOR_NODE_TYPE_UNSUPPORTED', `Block ${blockId} has unsupported node type ${node.type}.`);
}

function assertAtom(node: AeoTiptapJsonNode, expected: string, blockId: string): void {
  assertNodeType(node, expected, blockId);
  if (node.content !== undefined) projectionError('AEO_EDITOR_ATOM_CONTENT_INVALID', `Block ${blockId} atom cannot contain child nodes.`);
}
