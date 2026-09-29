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
    sourcePlanAnchorCount: 2, sourcePlanBlockCount: 2,
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

test('natural model view keeps full source and table topology without Host anchors', () => {
  const batch = fixture(); const original = structuredClone(batch);
  const view = buildTranslationModelView(batch); const input = view.input;
  assert.deepEqual(batch, original);
  assert.match(input.document, /<table><tbody><tr><td rowspan="2">Synthetic:/u);
  assert.match(input.document, /Synthetic scope/u);
  assert.deepEqual(input.targetSections, [1]);
  assert.equal(JSON.stringify(input).includes('source-anchor-long-id'), false);
  assert.equal(JSON.stringify(input).includes('TG-synthetic-control-only'), false);
  assert.equal(JSON.stringify(input).includes('synthetic-source-ref'), false);
  const restored = view.restoreOutput({ markdown: '<!-- WL-SECTION:1 -->\n<table><tbody><tr><td rowspan="2">合成译文 P/N O-001，5 秒</td></tr></tbody></table>' });
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

test('natural sections reject missing, duplicated and extra output', () => {
  const batch = fixture(); const view = buildTranslationModelView(batch);
  assert.throws(() => view.restoreOutput({ markdown: '<!-- WL-SECTION:2 -->\ntext' }), /BOUNDARY_INVALID/u);
  assert.throws(() => view.restoreOutput({ markdown: '<!-- WL-SECTION:1 -->\ntext\n<!-- WL-SECTION:1 -->\ntext' }), /BOUNDARY_INVALID/u);
  assert.throws(() => view.restoreOutput({ invented: true, markdown: '<!-- WL-SECTION:1 -->\ntext' }), /OUTPUT_INVALID/u);
  assert.throws(() => view.restoreOutput({ markdown: '<!-- WL-SECTION:1 -->\n<table><tbody><tr><td rowspan="3">错位</td></tr></tbody></table>' }), /TOPOLOGY_CHANGED/u);
  assert.throws(() => view.restoreOutput({ markdown: '<!-- WL-SECTION:1 -->\n<table><tbody><tr><td rowspan="2"><script>hidden</script></td></tr></tbody></table>' }), /HTML_INVALID/u);
});

test('empty source-only sections at the start, middle and end keep their marker boundaries', () => {
  const blocks = [1, 2, 3, 4].map((index) => ({ blockId: `b${index}`, order: index,
    kind: 'prose', anchorIds: index === 2 ? ['a2'] : [], sourceStructure: index === 2
      ? [{ sourceUnitId: 'u2', kind: 'paragraph', payload: { text: 'Only source prose.' } }] : [] }));
  const batch = { purpose: 'GENERATE', sourceLocale: 'en', targetLocale: 'zh-CN',
    sourcePlanAnchorCount: 1, sourcePlanBlockCount: 4, blocks,
    anchors: [{ anchorId: 'a2', sourceUnitId: 'u2', payloadPath: '/payload/text',
      sourceText: 'Only source prose.' }],
    documentContext: { blocks: [], anchors: [], scopedConditions: [] }, terminology: {} };
  const view = buildTranslationModelView(batch);
  const markdown = '<!-- WL-SECTION:1 -->\n\n<!-- WL-SECTION:2 -->\n唯一译文。\n\n' +
    '<!-- WL-SECTION:3 -->\n\n<!-- WL-SECTION:4 -->';
  assert.deepEqual(view.restoreOutput({ markdown }).blocks.map((block) => block.elements.length),
    [0, 1, 0, 0]);
  for (const index of [1, 3, 4]) {
    const forged = markdown.replace(`<!-- WL-SECTION:${index} -->`,
      `<!-- WL-SECTION:${index} -->\n伪造正文。`);
    assert.throws(() => view.restoreOutput({ markdown: forged }), /STRUCTURE_ONLY_OUTPUT_INVALID/u);
  }
  assert.throws(() => view.restoreOutput({ markdown: markdown.replace('唯一译文。', '') }),
    /SECTION_EMPTY/u);
});

test('old registered narrow context is not silently widened or called as full source', () => {
  const batch = fixture();
  batch.documentContext.blocks = [];
  batch.documentContext.anchors = [];
  assert.throws(() => buildTranslationModelView(batch), /FULL_DOCUMENT_CONTEXT_REQUIRED/u);
});

test('source limitations and warning scope remain explicit without anchor IDs', () => {
  const batch = fixture();
  batch.blocks[0].sourceIssues = [{ origin: 'SOURCE', severity: 'REVIEW', code: 'OCR_DOUBT',
    message: 'Synthetic ordinary word is uncertain.', anchorIds: ['source-anchor-long-id'] }];
  batch.documentContext.scopedConditions = [{ advisoryBlockId: 'context-heading-long-id',
    targetBlockIds: ['target-table-long-id'], anchorIds: ['context-anchor-long-id'] }];
  const input = buildTranslationModelView(batch).input;
  assert.deepEqual(input.readingNotes, [{ section: 1, severity: 'REVIEW', code: 'OCR_DOUBT',
    message: 'Synthetic ordinary word is uncertain.' }]);
  assert.deepEqual(input.conditionScopes, [{ advisorySection: 2, targetSections: [1] }]);
  assert.ok(!JSON.stringify(input).includes('source-anchor-long-id'));
});

test('33 synthetic source groups and 115 anchors remain complete across a scoped output', () => {
  const blocks = []; const anchors = [];
  for (let index = 0; index < 33; index++) {
    const count = index < 16 ? 4 : 3;
    const ids = [];
    for (let part = 0; part < count; part++) {
      const anchorId = `a${anchors.length + 1}`;
      ids.push(anchorId);
      anchors.push({ anchorId, sourceUnitId: `u${index + 1}`, payloadPath: '/payload/text',
        sourceText: `Synthetic source ${index + 1}, portion ${part + 1}.` });
    }
    blocks.push({ blockId: `b${index + 1}`, order: index, kind: 'prose', anchorIds: ids,
      sourceStructure: [{ sourceUnitId: `u${index + 1}`, kind: 'paragraph', payload: {} }] });
  }
  const batch = { schemaVersion: 'wiselink.3_1.translation_semantic_batch.v2', purpose: 'GENERATE',
    sourceLocale: 'en', targetLocale: 'zh-CN', sourcePlanAnchorCount: 115, sourcePlanBlockCount: 33,
    blocks: blocks.slice(0, 1), anchors: anchors.slice(0, 4), documentContext: {
      blocks: blocks.slice(1), anchors: anchors.slice(4), scopedConditions: [],
    }, terminology: { terms: [], noTranslate: [] } };
  const view = buildTranslationModelView(batch);
  assert.equal(view.input.targetSections.length, 1);
  assert.equal(view.input.document.match(/<!-- WL-SECTION:/gu).length, 33);
  assert.ok(anchors.every((anchor) => view.input.document.includes(anchor.sourceText)));
  const result = view.restoreOutput({ markdown: '<!-- WL-SECTION:1 -->\n第一自然段。\n\n第二自然段。' });
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].elements.length, 2);
  assert.deepEqual(result.blocks[0].elements.map((element) => element.anchorIds),
    [blocks[0].anchorIds, blocks[0].anchorIds]);
});

test('same-shape table value swaps and footnote reassignment fail before SAVE', () => {
  const batch = fixture();
  const table = batch.blocks[0].sourceStructure[0].payload;
  table.rowGroups[0].rows[0].cells = [
    { rowSpan: 1, colSpan: 1, inlineContent: [{ text: 'Valve 10 [1]' }] },
    { rowSpan: 1, colSpan: 1, inlineContent: [{ text: 'Pump 20' }] },
  ];
  batch.blocks[0].anchorIds = ['a1', 'a3'];
  batch.anchors = [
    { anchorId: 'a1', sourceUnitId: 'source-table-long-id',
      payloadPath: '/payload/rowGroups/0/rows/0/cells/0/inlineContent/0/text', sourceText: 'Valve 10 [1]' },
    { anchorId: 'a3', sourceUnitId: 'source-table-long-id',
      payloadPath: '/payload/rowGroups/0/rows/0/cells/1/inlineContent/0/text', sourceText: 'Pump 20' },
  ];
  batch.sourcePlanAnchorCount = 3;
  const view = buildTranslationModelView(batch);
  const wrap = (cells) => ({ markdown: `<!-- WL-SECTION:1 -->\n<table><tbody><tr>${cells}</tr></tbody></table>` });
  assert.throws(() => view.restoreOutput(wrap('<td>阀门 20 [1]</td><td>泵 10</td>')), /VALUE_MISMATCH/u);
  assert.throws(() => view.restoreOutput(wrap('<td>阀门 10</td><td>泵 20 [1]</td>')), /VALUE_MISMATCH/u);
  assert.throws(() => view.restoreOutput(wrap('<td>阀门 10 [1]</td><td><img src="x">泵 20</td>')), /HTML_INVALID/u);
});

test('a text-only list stays translatable and a nested list keeps its structure', () => {
  const plain = fixture();
  plain.blocks[0] = { blockId: 'b1', order: 0, kind: 'list', anchorIds: ['a1'],
    sourceStructure: [{ sourceUnitId: 'u1', kind: 'list', payload: { text: 'Synthetic list text.' } }] };
  plain.anchors[0] = { anchorId: 'a1', sourceUnitId: 'u1', payloadPath: '/payload/text', sourceText: 'Synthetic list text.' };
  assert.deepEqual(buildTranslationModelView(plain).restoreOutput({ markdown: '<!-- WL-SECTION:1 -->\n合成列表正文。' }).blocks[0].elements,
    [{ kind: 'paragraph', translatedText: '合成列表正文。', anchorIds: ['a1'] }]);

  const nested = fixture();
  nested.blocks[0] = { blockId: 'b1', order: 0, kind: 'list', anchorIds: ['a1', 'a3'], sourceStructure: [
    { sourceUnitId: 'root', kind: 'list', payload: { itemUnitIds: ['i1', 'sub'] } },
    { sourceUnitId: 'i1', kind: 'list_item', payload: { text: 'First item.' } },
    { sourceUnitId: 'sub', kind: 'list', payload: { itemUnitIds: ['i2'], ordered: true } },
    { sourceUnitId: 'i2', kind: 'list_item', payload: { text: 'Second item.' } },
  ] };
  nested.anchors = [
    { anchorId: 'a1', sourceUnitId: 'i1', payloadPath: '/payload/text', sourceText: 'First item.' },
    { anchorId: 'a3', sourceUnitId: 'i2', payloadPath: '/payload/text', sourceText: 'Second item.' },
  ];
  nested.sourcePlanAnchorCount = 3;
  const view = buildTranslationModelView(nested);
  assert.match(view.input.document, /<ul><li>First item\.<ol><li>Second item\.<\/li><\/ol><\/li><\/ul>/u);
  assert.deepEqual(view.restoreOutput({ markdown: '<!-- WL-SECTION:1 -->\n<ul><li>第一项。<ol><li>第二项。</li></ol></li></ul>' }).blocks[0].elements,
    [{ kind: 'list_item', translatedText: '第一项。', anchorIds: ['a1'] },
      { kind: 'list_item', translatedText: '第二项。', anchorIds: ['a3'] }]);
  assert.throws(() => view.restoreOutput({ markdown: '<!-- WL-SECTION:1 -->\n<ul><li>第一项。<ul><li>第二项。</li></ul></li></ul>' }), /LIST_TOPOLOGY_CHANGED/u);
});

test('table column-name source anchors stay visible and align to labels', () => {
  const batch = fixture();
  const table = batch.blocks[0].sourceStructure[0].payload;
  table.columns = [{ name: 'Pressure' }];
  batch.blocks[0].anchorIds.push('a3');
  batch.anchors.push({ anchorId: 'a3', sourceUnitId: 'source-table-long-id',
    payloadPath: '/payload/columns/0/name', sourceText: 'Pressure' });
  batch.sourcePlanAnchorCount = 3;
  const view = buildTranslationModelView(batch);
  assert.match(view.input.document, /<thead><tr><th>Pressure<\/th><\/tr><\/thead>/u);
  const result = view.restoreOutput({ markdown: '<!-- WL-SECTION:1 -->\n<table><thead><tr><th>压力</th></tr></thead><tbody><tr><td rowspan="2">P/N O-001，5 秒</td></tr></tbody></table>' });
  assert.deepEqual(result.blocks[0].elements.map((element) => [element.kind, element.anchorIds]),
    [['label', ['a3']], ['table_cell', ['source-anchor-long-id']]]);
  assert.throws(() => view.restoreOutput({ markdown: '<!-- WL-SECTION:1 -->\n<table><thead><tr><th colspan="2">压力</th></tr></thead><tbody><tr><td rowspan="2">P/N O-001，5 秒</td></tr></tbody></table>' }),
    /TABLE_ALIGNMENT_UNSUPPORTED/u);
  assert.throws(() => view.restoreOutput({ markdown: '<!-- WL-SECTION:1 -->\n<table><thead><tr><th rowspan="2">压力</th></tr></thead><tbody><tr><td rowspan="2">P/N O-001，5 秒</td></tr></tbody></table>' }),
    /TABLE_ALIGNMENT_UNSUPPORTED/u);
  assert.throws(() => view.restoreOutput({ markdown: '<!-- WL-SECTION:1 -->\n<table colspan="2"><thead><tr><th>压力</th></tr></thead><tbody><tr><td rowspan="2">P/N O-001，5 秒</td></tr></tbody></table>' }),
    /HTML_INVALID/u);
});

test('a non-grid extracted table remains a text translation scope', () => {
  const batch = fixture();
  batch.blocks[0].sourceStructure[0].payload = { layout: 'text', text: 'Valve 10 remains open.' };
  batch.anchors[0].payloadPath = '/payload/text';
  batch.anchors[0].sourceText = 'Valve 10 remains open.';
  const view = buildTranslationModelView(batch);
  assert.match(view.input.document, /Valve 10 remains open\./u);
  assert.deepEqual(view.restoreOutput({ markdown: '<!-- WL-SECTION:1 -->\n阀门 10 保持打开。' }).blocks[0].elements,
    [{ kind: 'paragraph', translatedText: '阀门 10 保持打开。', anchorIds: ['source-anchor-long-id'] }]);
});
