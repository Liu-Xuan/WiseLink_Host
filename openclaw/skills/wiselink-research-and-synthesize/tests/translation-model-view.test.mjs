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

function checkDocument(input) {
  return input.document.map((entry) => entry.source).join('\n\n');
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

function realisticCheckBatch() {
  const blocks = []; const anchors = [];
  const add = (block, unitId, path, sourceText) => {
    const anchorId = `source-anchor-${anchors.length + 1}`;
    block.anchorIds.push(anchorId);
    anchors.push({ anchorId, sourceUnitId: unitId, payloadPath: path,
      sourceText, sourceRefIds: [`source-ref-${anchors.length + 1}`] });
  };
  for (let index = 0; index < 29; index++) {
    const block = { blockId: `source-block-${index + 1}`, order: index,
      kind: 'prose', anchorIds: [], sourceStructure: [] };
    for (let part = 0; part < 3; part++) {
      const unitId = `source-unit-${index + 1}-${part + 1}`;
      const sourceText = `Before operating valve V-${index + 1}, verify pressure is below ${20 + part} psi and retain warning condition ${index + 1}.`;
      block.sourceStructure.push({ sourceUnitId: unitId, kind: 'paragraph',
        payload: { text: sourceText, sourceRefIds: [`source-ref-${anchors.length + 1}`] } });
      add(block, unitId, '/payload/text', sourceText);
    }
    blocks.push(block);
  }
  const tableUnit = 'source-table-unit';
  const table = { blockId: 'source-table-block', order: 29, kind: 'table',
    anchorIds: [], sourceStructure: [] };
  const payload = { layout: 'grid', caption: 'Operating limits [1]',
    columns: ['Part number', 'Pressure', 'Duration', 'Action'].map((name) => ({ name })),
    rowGroups: [{ kind: 'body', rows: [] }], continuation: { tableUnitId: tableUnit } };
  add(table, tableUnit, '/payload/caption', payload.caption);
  payload.columns.forEach((column, index) =>
    add(table, tableUnit, `/payload/columns/${index}/name`, column.name));
  for (let row = 0; row < 5; row++) {
    const values = [`V-${row + 1}`, `${20 + row} psi`, `${5 + row} s`, 'Do not close [1]'];
    payload.rowGroups[0].rows.push({ cells: values.map((text) => ({
      rowSpan: 1, colSpan: 1, inlineContent: [{ text }],
    })) });
    values.forEach((text, column) => add(table, tableUnit,
      `/payload/rowGroups/0/rows/${row}/cells/${column}/inlineContent/0/text`, text));
  }
  table.sourceStructure.push({ sourceUnitId: tableUnit, kind: 'table', payload });
  blocks.push(table);
  const heading = { blockId: 'source-heading-block', order: 30, kind: 'heading',
    anchorIds: [], sourceStructure: [{ sourceUnitId: 'heading-unit', kind: 'heading',
      payload: { text: 'Applicability', level: 2 } }] };
  add(heading, 'heading-unit', '/payload/text', 'Applicability');
  blocks.push(heading);
  const advisory = { blockId: 'source-advisory-block', order: 31, kind: 'advisory',
    anchorIds: [], sourceStructure: [] };
  for (let index = 0; index < 2; index++) {
    const sourceUnitId = `advisory-unit-${index + 1}`;
    const sourceText = index === 0 ? 'WARNING: Disconnect power before servicing.'
      : 'This condition applies only to V-1 through V-5.';
    advisory.sourceStructure.push({ sourceUnitId, kind: 'advisory',
      payload: { text: sourceText, warningLevel: 'WARNING' } });
    add(advisory, sourceUnitId, '/payload/text', sourceText);
  }
  blocks.push(advisory);
  blocks.push({ blockId: 'source-figure-block', order: 32, kind: 'figure',
    anchorIds: [], sourceStructure: [{ sourceUnitId: 'figure-unit', kind: 'figure',
      payload: { figureNumber: 7, layout: 'image-only' } }] });
  const targets = [...blocks.slice(0, 6), table, advisory];
  const targetIds = new Set(targets.flatMap((block) => block.anchorIds));
  const candidate = (block) => ({ blockId: block.blockId,
    elements: block.anchorIds.map((anchorId) => ({ kind: block.kind === 'table' ? 'table_cell' : 'paragraph',
      translatedText: `已校核的技术译文 ${anchorId}。`, anchorIds: [anchorId] })) });
  return { schemaVersion: 'wiselink.3_1.translation_semantic_batch.v2',
    purpose: 'CHECK_BATCH', sourceLocale: 'en', targetLocale: 'zh-CN',
    sourcePlanAnchorCount: anchors.length, sourcePlanBlockCount: blocks.length,
    blocks: targets, anchors: anchors.filter((anchor) => targetIds.has(anchor.anchorId)),
    documentContext: { title: 'Valve operating limits',
      blocks: blocks.filter((block) => !targets.includes(block)),
      anchors: anchors.filter((anchor) => !targetIds.has(anchor.anchorId)),
      outline: [{ blockId: heading.blockId, anchorIds: heading.anchorIds, level: 2 }],
      scopedConditions: [{ advisoryBlockId: advisory.blockId,
        targetBlockIds: [table.blockId, blocks[0].blockId], anchorIds: advisory.anchorIds }],
      conditionAnchorIds: advisory.anchorIds, definitionAnchorIds: [], references: [] },
    terminology: { terms: [], noTranslate: ['V-1'] }, previousCandidate: null,
    checkCandidates: targets.map((block) => ({ blockId: block.blockId,
      candidate: candidate(block) })), correctionIssues: [] };
}

test('compact checks carry one complete annotated document, exact candidates and conditions', () => {
  const batch = realisticCheckBatch();
  const view = buildTranslationModelView(batch);
  const input = view.input;
  const document = checkDocument(input);
  assert.deepEqual(input.document.map((entry) => entry.section),
    Array.from({ length: 33 }, (_value, index) => index + 1));
  assert.equal(batch.anchors.length + batch.documentContext.anchors.length, 115);
  for (const anchor of [...batch.anchors, ...batch.documentContext.anchors]) {
    assert.equal(document.split(anchor.sourceText).length - 1 >= 1, true);
  }
  const markedAliases = [...document.matchAll(/⟦WL-ANCHOR:A\d+⟧ /gu)]
    .map((match) => match[0]);
  assert.equal(markedAliases.length, 115);
  assert.equal(new Set(markedAliases).size, 115);
  assert.match(document, /<table><caption>⟦WL-ANCHOR:A\d+⟧ Operating limits \[1\]<\/caption>/u);
  assert.match(document, /<thead><tr><th>⟦WL-ANCHOR:A\d+⟧ Part number<\/th>/u);
  assert.match(document, /<td>⟦WL-ANCHOR:A\d+⟧ Do not close \[1\]<\/td>/u);
  assert.deepEqual(input.documentContext.scopedConditions[0].targetBlockIds,
    [input.blocks[6].blockId, input.blocks[0].blockId]);
  assert.ok(input.documentContext.metadata.some((entry) =>
    entry.units?.some((unit) => unit.payload.warningLevel === 'WARNING')));
  const tableMetadata = input.documentContext.metadata.find((entry) =>
    entry.blockId === input.blocks[6].blockId);
  assert.deepEqual(Object.keys(tableMetadata.units[0].payload), ['continuation']);
  assert.deepEqual(input.previousCandidates.map((entry) => entry.elements.length),
    batch.blocks.map((block) => block.anchorIds.length));
  assert.ok(!JSON.stringify(input).includes('source-ref-'));
  assert.ok(!JSON.stringify({ ...input, document: '' }).includes('Before operating valve V-1'));
  const compactBytes = Buffer.byteLength(JSON.stringify(input));
  const fullBatchBytes = Buffer.byteLength(JSON.stringify(batch));
  assert.ok(compactBytes < fullBatchBytes * 0.65,
    `expected compact model input below 65% of Host batch: ${compactBytes}/${fullBatchBytes}`);
  const valid = { checks: input.blocks.map((block) => ({ blockId: block.blockId, issues: [] })) };
  validateTranslationBlockOutput(batch, view.restoreOutput(valid));
  assert.throws(() => view.restoreOutput({ checks: [{ blockId: 'B999', issues: [] }] }),
    /OUTPUT_REFERENCE_INVALID/u);
});

test('check table keeps empty column heading in its original position', () => {
  const batch = fixture();
  batch.purpose = 'CHECK';
  const payload = batch.blocks[0].sourceStructure[0].payload;
  payload.columns = [{ name: 'Part' }, { name: '' }, { name: 'Limit' }];
  for (const [index, text] of [[0, 'Part'], [2, 'Limit']]) {
    const anchorId = `column-${index}`;
    batch.blocks[0].anchorIds.push(anchorId);
    batch.anchors.push({ anchorId, sourceUnitId: 'source-table-long-id',
      payloadPath: `/payload/columns/${index}/name`, sourceText: text });
  }
  batch.sourcePlanAnchorCount += 2;
  const document = checkDocument(buildTranslationModelView(batch).input);
  assert.match(document, /<thead><tr><th>⟦WL-ANCHOR:A\d+⟧ Part<\/th><th><\/th><th>⟦WL-ANCHOR:A\d+⟧ Limit<\/th><\/tr><\/thead>/u);
});

test('check projection retains literal footnotes and empty table cells with safe anchor markup', () => {
  const batch = fixture();
  batch.purpose = 'CHECK';
  batch.blocks[0].sourceStructure[0].payload.rowGroups[0].rows[0].cells.push({
    rowSpan: 1, colSpan: 1, inlineContent: [{ text: '' }],
  });
  batch.anchors[0].sourceText = 'Retain <P/N O-001> [1] for 5 seconds.';
  batch.blocks[0].sourceStructure[0].payload.rowGroups[0].rows[0].cells[0].inlineContent[0].text =
    batch.anchors[0].sourceText;
  const view = buildTranslationModelView(batch);
  assert.match(checkDocument(view.input), /<td rowspan="2">⟦WL-ANCHOR:A1⟧ Retain &lt;P\/N O-001&gt; \[1\] for 5 seconds\.<\/td><td><\/td>/u);
  assert.equal(view.input.targetAnchors[0].anchorId, 'A1');
  assert.equal(JSON.stringify(view.input).includes('synthetic-source-ref'), false);
  batch.blocks[0].sourceStructure[0].payload.rowGroups[0].rows[0].cells[0].inlineContent[0].text =
    'different source text';
  assert.throws(() => buildTranslationModelView(batch), /MODEL_LAYOUT_BINDING_INVALID/u);
});

test('check projection carries source fields outside the natural table layout', () => {
  const batch = fixture();
  batch.purpose = 'CHECK';
  batch.blocks[0].sourceStructure[0].payload.rawText = 'Unrendered table OCR line.';
  batch.blocks[0].anchorIds.push('unrendered-anchor');
  batch.anchors.push({ anchorId: 'unrendered-anchor', sourceUnitId: 'source-table-long-id',
    payloadPath: '/payload/rawText', sourceText: 'Unrendered table OCR line.' });
  const input = buildTranslationModelView(batch).input;
  assert.match(checkDocument(input), /Source field \/payload\/rawText: ⟦WL-ANCHOR:A\d+⟧ Unrendered table OCR line\./u);
  assert.equal(checkDocument(input).match(/Unrendered table OCR line\./gu).length, 1);
});

test('non-first check target resolves every context block and multiple condition scopes', () => {
  const batch = realisticCheckBatch();
  const allBlocks = [...batch.blocks, ...batch.documentContext.blocks]
    .sort((left, right) => left.order - right.order);
  const allAnchors = [...batch.anchors, ...batch.documentContext.anchors];
  const target = allBlocks.find((block) => block.blockId === 'source-table-block');
  const ids = new Set(target.anchorIds);
  batch.purpose = 'CHECK';
  batch.blocks = [target];
  batch.anchors = allAnchors.filter((anchor) => ids.has(anchor.anchorId));
  batch.documentContext.blocks = allBlocks.filter((block) => block !== target);
  batch.documentContext.anchors = allAnchors.filter((anchor) => !ids.has(anchor.anchorId));
  batch.documentContext.scopedConditions.push({ advisoryBlockId: 'source-advisory-block',
    targetBlockIds: ['source-table-block'], anchorIds: allBlocks[31].anchorIds.slice(0, 1) });
  batch.previousCandidate = batch.checkCandidates.find((entry) => entry.blockId === target.blockId).candidate;
  batch.previousBlockRevisionId = 'synthetic-table-revision';
  delete batch.checkCandidates;
  const input = buildTranslationModelView(batch).input;
  assert.equal(input.sourceCoverage, 'FULL');
  assert.equal(input.blocks[0].section, 30);
  assert.equal(input.documentContext.sectionMap.length, 33);
  for (const scope of input.documentContext.scopedConditions) {
    const advisory = input.documentContext.sectionMap.find((entry) =>
      entry.blockId === scope.advisoryBlockId);
    assert.equal(advisory.section, 32);
    assert.ok(scope.anchorIds.every((id) => advisory.anchorIds.includes(id)));
    assert.ok(scope.targetBlockIds.every((id) => input.documentContext.sectionMap.some((entry) =>
      entry.blockId === id)));
  }
  assert.equal(input.documentContext.sectionMap.find((entry) => entry.blockId === input.blocks[0].blockId).section, 30);
  assert.ok(input.documentContext.sectionMap.some((entry) => entry.section === 1 && entry.anchorIds.length === 3));
  assert.deepEqual(input.previousCandidate.elements.map((element) => element.translatedText),
    batch.previousCandidate.elements.map((element) => element.translatedText));
});

test('partial registered context remains partial without expanding its source scope', () => {
  const batch = fixture();
  batch.purpose = 'CHECK';
  batch.sourcePlanAnchorCount += 1;
  batch.sourcePlanBlockCount += 1;
  const input = buildTranslationModelView(batch).input;
  assert.equal(input.sourceCoverage, 'PARTIAL_REGISTERED');
  assert.equal(input.documentContext.sectionMap.length, 2);
  assert.equal(input.document.length, 2);
});

test('literal alias and section text remain source, while correction rejects copied generated markers', () => {
  const batch = fixture();
  batch.purpose = 'CORRECT';
  const literal = 'Read [A1] and <!-- WL-SECTION:99 --> with <valve> & [1].';
  batch.anchors[0].sourceText = literal;
  batch.blocks[0].sourceStructure[0].payload.rowGroups[0].rows[0].cells[0].inlineContent[0].text = literal;
  batch.previousCandidate = { blockId: batch.blocks[0].blockId,
    elements: [{ kind: 'table_cell', translatedText: '旧译文。', anchorIds: batch.blocks[0].anchorIds }] };
  batch.previousBlockRevisionId = 'synthetic-correction';
  const view = buildTranslationModelView(batch);
  assert.match(checkDocument(view.input), /⟦WL-ANCHOR:A1⟧ Read \[A1\] and &lt;!-- WL-SECTION:99 --&gt; with &lt;valve&gt; &amp; \[1\]/u);
  const result = (translatedText) => ({ blocks: [{ blockId: 'B1', elements: [
    { kind: 'table_cell', translatedText, anchorIds: ['A1'] },
  ] }] });
  assert.throws(() => view.restoreOutput(result('复制 ⟦WL-ANCHOR:A1⟧ 标记。')),
    /OUTPUT_MARKER_LEAK/u);
  assert.equal(view.restoreOutput(result('保留字面 [A1] 和 [1]。')).blocks[0].elements[0].translatedText,
    '保留字面 [A1] 和 [1]。');
  const literalMarker = 'Literal ⟦WL-ANCHOR:A1⟧ label [1].';
  batch.anchors[0].sourceText = literalMarker;
  batch.blocks[0].sourceStructure[0].payload.rowGroups[0].rows[0].cells[0].inlineContent[0].text = literalMarker;
  const literalView = buildTranslationModelView(batch);
  assert.equal(literalView.restoreOutput(result('保留 ⟦WL-ANCHOR:A1⟧ [1]。')).blocks[0].elements[0].translatedText,
    '保留 ⟦WL-ANCHOR:A1⟧ [1]。');

  batch.blocks[0] = { blockId: 'target-table-long-id', kind: 'prose',
    anchorIds: ['source-anchor-long-id'], sourceStructure: [{ sourceUnitId: 'source-table-long-id',
      kind: 'paragraph', payload: { text: literal } }] };
  batch.anchors[0].payloadPath = '/payload/text';
  batch.anchors[0].sourceText = literal;
  const prose = buildTranslationModelView(batch).input;
  assert.equal(prose.document.length, 2);
  assert.equal(prose.document[0].section, 1);
  assert.match(prose.document[0].source, /Read \[A1\] and <!-- WL-SECTION:99 --> with <valve> & \[1\]/u);
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
