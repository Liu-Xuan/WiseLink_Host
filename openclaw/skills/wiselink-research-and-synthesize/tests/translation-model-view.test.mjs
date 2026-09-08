import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTranslationModelView } from '../scripts/translation-model-view.mjs';
import { validateTranslationBlockOutput } from '../scripts/invoke-hosted-translation-block.mjs';

function fixture() {
  const sourceText = 'Synthetic: retain P/N O-001, 5 seconds and do not remove unless instructed.';
  const cell = { rowSpan: 2, colSpan: 1, inlineContent: [{ text: sourceText, sourceRefIds: ['synthetic-source-ref'] }] };
  const table = { layout: 'grid', continuation: { tableUnitId: 'source-table-long-id' }, rowGroups: [{ kind: 'body', rows: [{ cells: [cell] }] }] };
  return {
    schemaVersion: 'wiselink.3_1.translation_semantic_batch.v2', purpose: 'GENERATE',
    workspaceId: 'TW-synthetic-control-only', generationRequestRef: 'TG-synthetic-control-only', dependencies: { planRevision: 1 },
    blocks: [{ blockId: 'target-table-long-id', kind: 'table', anchorIds: ['source-anchor-long-id'], sourceStructure: [{ sourceUnitId: 'source-table-long-id', kind: 'table', payload: table }] }],
    anchors: [{ anchorId: 'source-anchor-long-id', sourceUnitId: 'source-table-long-id', payloadPath: '/payload/rowGroups/0/rows/0/cells/0/inlineContent/0/text', sourceText, sourceRefIds: ['synthetic-source-ref'] }],
    documentContext: { title: 'Synthetic document', outline: [{ blockId: 'context-heading-long-id', anchorIds: ['context-anchor-long-id'], level: 1 }],
      blocks: [{ blockId: 'context-heading-long-id', kind: 'heading', anchorIds: ['context-anchor-long-id'], sourceStructure: [{ sourceUnitId: 'context-heading-unit', kind: 'heading', payload: { text: 'Synthetic scope', level: 1 } }] }],
      anchors: [{ anchorId: 'context-anchor-long-id', sourceUnitId: 'context-heading-unit', payloadPath: '/payload/text', sourceText: 'Synthetic scope' }],
      conditionAnchorIds: ['context-anchor-long-id'], definitionAnchorIds: [], scopedConditions: [], references: [{ label: 'Synthetic external reference, not supplied' }],
    }, terminology: { terms: [], noTranslate: [] }, previousCandidate: null, correctionIssues: [],
  };
}

test('model aliases preserve exact source, complete context and table layout with one copy of text', () => {
  const batch = fixture(); const original = structuredClone(batch);
  const view = buildTranslationModelView(batch); const input = view.input;
  assert.deepEqual(batch, original);
  assert.equal(input.anchors[0].sourceText, batch.anchors[0].sourceText);
  assert.equal(input.documentContext.anchors[0].sourceText, 'Synthetic scope');
  assert.deepEqual(input.documentContext.references, batch.documentContext.references);
  const table = input.blocks[0].sourceStructure[0].payload;
  assert.equal(table.rowGroups[0].rows[0].cells[0].rowSpan, 2);
  assert.equal(table.rowGroups[0].rows[0].cells[0].colSpan, 1);
  assert.deepEqual(table.rowGroups[0].rows[0].cells[0].inlineContent[0], { text: { sourceAnchorId: 'A1' } });
  assert.equal(table.continuation.tableUnitId, input.blocks[0].sourceStructure[0].sourceUnitId);
  assert.equal(JSON.stringify(input).split(batch.anchors[0].sourceText).length - 1, 1);
  assert.equal(JSON.stringify(input).includes('TG-synthetic-control-only'), false);
  assert.equal(JSON.stringify(input).includes('synthetic-source-ref'), false);
  const restored = view.restoreOutput({ blocks: [{ blockId: 'B1', elements: [{ kind: 'table_cell', translatedText: '合成译文', anchorIds: ['A1'] }] }] });
  validateTranslationBlockOutput(batch, restored);
  assert.equal(restored.blocks[0].blockId, batch.blocks[0].blockId);
  assert.deepEqual(restored.blocks[0].elements[0].anchorIds, batch.blocks[0].anchorIds);
});

test('correction and check keep the complete previous block and restore only their exact source scope', () => {
  const batch = fixture();
  batch.previousBlockRevisionId = 'revision-control-only';
  batch.previousCandidate = { blockId: batch.blocks[0].blockId, elements: [{ elementId: 'element-control-only', kind: 'table_cell', translatedText: '完整旧译文', anchorIds: batch.blocks[0].anchorIds }] };
  batch.correctionIssues = [{ code: 'SYNTHETIC', severity: 'BLOCK', origin: 'TRANSLATION', message: 'Synthetic issue', blockIds: [batch.blocks[0].blockId], anchorIds: batch.blocks[0].anchorIds }];
  for (const purpose of ['CORRECT', 'CHECK']) {
    batch.purpose = purpose; const view = buildTranslationModelView(batch);
    assert.equal(view.input.previousCandidate.elements[0].translatedText, '完整旧译文');
    assert.deepEqual(view.input.correctionIssues[0].anchorIds, ['A1']);
    if (purpose === 'CHECK') {
      const restored = view.restoreOutput({ blockId: 'B1', issues: [{ code: 'SYNTHETIC', severity: 'REVIEW', message: 'Synthetic issue', anchorIds: ['A1'] }] });
      validateTranslationBlockOutput(batch, restored);
      const wrong = view.restoreOutput({ blockId: 'B1', issues: [{ code: 'SYNTHETIC', severity: 'REVIEW', message: 'Synthetic issue', anchorIds: ['A2'] }] });
      assert.throws(() => validateTranslationBlockOutput(batch, wrong), /SEMANTIC_REVIEW_INVALID/u);
    }
  }
});

test('aliases reject unknown or context-only output and do not hide extra output fields', () => {
  const batch = fixture(); const view = buildTranslationModelView(batch);
  assert.throws(() => view.restoreOutput({ blocks: [{ blockId: 'B999', elements: [] }] }), /REFERENCE_INVALID/u);
  const wrong = view.restoreOutput({ blocks: [{ blockId: 'B2', elements: [] }] });
  assert.throws(() => validateTranslationBlockOutput(batch, wrong), /BLOCK_ORDER_INVALID/u);
  const extra = view.restoreOutput({ invented: true, blocks: [{ blockId: 'B1', elements: [] }] });
  assert.throws(() => validateTranslationBlockOutput(batch, extra), /KEYS_INVALID/u);
  batch.anchors[0].sourceText = 'Tampered mapping';
  assert.throws(() => buildTranslationModelView(batch), /LAYOUT_BINDING_INVALID/u);
});
