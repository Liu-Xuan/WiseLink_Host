import { documentMineruOriginal } from '../../../server/modules/document-management/src/hosted/nest/document-mineru-original-adapter';
import { reconcileMineruTextCoverage } from '../../../server/modules/document-management/src/hosted/nest/document-mineru-text-coverage';
import { documentOriginalReadingCoverage } from '../../../server/modules/document-management/src/hosted/nest/document-original-adapter';
import { buildDocumentSemanticMap } from '../../../server/modules/document-management/src/hosted/nest/document-semantic-map';
import type { DocumentPdfPage } from '../../../server/modules/document-management/src/hosted/nest/document-original-pdf';
const binding = { documentVersionId: 'DV', parseRunId: 'PR', parseRevision: 1, sourceArtifactId: 'SRC', sourceSha256: 'a'.repeat(64), sourceByteLength: 12 };
function paragraph(text: string, bbox: number[]) { return { type: 'paragraph', bbox, content: { paragraph_content: [{ type: 'text', content: text }] } }; }
function title(text: string, bbox: number[], level = 1) { return { type: 'title', bbox, content: { level, title_content: [{ type: 'text', content: text }] } }; }
function page(lines: Array<{ text: string; top: number; x?: number; size?: number }>, pageIndex = 0): DocumentPdfPage {
  return { pageIndex, width: 1000, height: 1000, rotation: 0, text: lines.map(line => line.text).join('\n'),
    items: lines.map(line => ({ text: line.text, transform: [line.size ?? 10, 0, 0, line.size ?? 10,
      line.x ?? 10, 1000 - line.top - (line.size ?? 10)], width: 100, height: line.size ?? 10, hasEOL: true })) };
}
function fixture(blocks: unknown[][], pages: DocumentPdfPage[], extra: Record<string, unknown> = {}) {
  const middle = { _version_name: '3.4.5', _backend: 'pipeline', pdf_info: blocks.map((_p, page_idx) => ({ page_idx, page_size: [1000, 1000], ...extra })) };
  const rawArtifacts = { markdown: 'Raw OCR remains archived.', contentListV2: blocks, middle };
  const original = documentMineruOriginal({ binding, documentVersion: { documentVersionId: 'DV', documentId: 'DOC', familyId: 'FAM', sourceArtifactId: 'SRC', pdfSha256: binding.sourceSha256, byteLength: 12 },
    result: { sourceSha256: binding.sourceSha256, sourceByteLength: 12, rawArtifacts, assets: [] } });
  return { original, extraction: { pageCount: blocks.length, pages }, rawMiddle: middle, rawContentListV2: blocks };
}
it('preserves repeated text by physical occurrence, inserts only outside-region text, and merges actual reading order', () => {
  const input = fixture([[paragraph('Repeat', [10, 100, 120, 115]), paragraph('Last', [10, 300, 120, 315])]],
    [page([{ text: 'Repeat', top: 100 }, { text: 'Missing condition', top: 180 }, { text: 'Repeat', top: 220 }, { text: 'Last', top: 300 }])]);
  const before = structuredClone(input);
  const result = reconcileMineruTextCoverage(input);
  expect(result.source.units.map(unit => unit.payload.text)).toEqual(['Repeat', 'Missing condition', 'Repeat', 'Last']);
  const supplements = result.source.units.filter(unit => unit.mapping.extraction === 'PDFJS_TEXT_LAYER');
  expect(supplements).toHaveLength(2);
  expect(result.producer).toMatchObject({ kind: 'MINERU_LOCAL_PDFJS', supplementaryExtraction: 'PDFJS_TEXT_LAYER' });
  expect(result.locations.filter(location => location.precision === 'TEXT_ITEM')).toHaveLength(2);
  expect(supplements[0].mapping.textItems).toEqual([{ pageIndex: 0, itemIndexes: [1] }]);
  expect(input).toEqual(before);
});
it('recovers only a geometrically corroborated missing heading and preserves its source binding', () => {
  const input = fixture([[
    title('Scope', [10, 100, 130, 114]), paragraph('All aircraft', [10, 130, 130, 142]),
    title('Background', [10, 200, 130, 214]), paragraph('Existing context', [10, 230, 130, 242]),
    paragraph('Description body', [10, 320, 130, 332]),
  ]], [page([
    { text: 'Scope', top: 100, size: 12 }, { text: 'All aircraft', top: 130, size: 9 },
    { text: 'Background', top: 200, size: 12 }, { text: 'Existing context', top: 230, size: 9 },
    { text: 'Description', top: 300, size: 12 }, { text: 'Description body', top: 320, size: 9 },
  ])]);
  const result = reconcileMineruTextCoverage(input);
  const recovered = result.source.units.find(unit => unit.payload.text === 'Description');
  expect(recovered).toMatchObject({ kind: 'heading', payload: { level: 1 }, mapping: {
    headingRecovery: { method: 'MATCHED_PDF_GEOMETRY' }, extraction: 'PDFJS_TEXT_LAYER' } });
  expect(recovered?.sourceRefIds).toEqual([`${recovered?.unitId}:source`]);
  expect(result.markdown).toContain('# Description');
  const map = buildDocumentSemanticMap({ original: result, semanticRevision: 1,
    profile: { profileRef: 'test', roles: [{ roleKey: 'APPLICABILITY', aliases: ['Scope'] },
      { roleKey: 'DESCRIPTION', aliases: ['Description'] }] } });
  const scope = map.sections.find(section => section.titleRaw === 'Scope');
  const description = map.sections.find(section => section.titleRaw === 'Description');
  expect(scope?.bodyUnitIds.map(id => result.source.units.find(unit => unit.unitId === id)?.payload.text)).toEqual(['All aircraft']);
  expect(description?.bodyUnitIds.map(id => result.source.units.find(unit => unit.unitId === id)?.payload.text)).toEqual(['Description body']);
  expect(input.original.source.units.some(unit => unit.payload.text === 'Description')).toBe(false);
});
it('does not promote a short body line or infer a heading without two matching anchors', () => {
  const blocks = [title('Scope', [10, 100, 130, 114]), paragraph('All aircraft', [10, 130, 130, 142]),
    paragraph('Description body', [10, 320, 130, 332])];
  const result = reconcileMineruTextCoverage(fixture([blocks], [page([
    { text: 'Scope', top: 100, size: 12 }, { text: 'All aircraft', top: 130, size: 9 },
    { text: 'Short body', top: 260, size: 9 },
    { text: 'Description', top: 300, size: 12 }, { text: 'Description body', top: 320, size: 9 },
  ])]));
  expect(result.source.units.find(unit => unit.payload.text === 'Short body')?.kind).toBe('paragraph');
  expect(result.source.units.find(unit => unit.payload.text === 'Description')?.kind).toBe('paragraph');
  expect(result.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({
    reason: 'STRUCTURE_UNCERTAIN', message: expect.stringContaining('Description') }));
});
it('keeps a title-like supplement as text when matching headings disagree on level', () => {
  const result = reconcileMineruTextCoverage(fixture([[
    title('First', [10, 100, 130, 114], 1), paragraph('First body', [10, 130, 130, 142]),
    title('Second', [10, 200, 130, 214], 2), paragraph('Second body', [10, 230, 130, 242]),
    paragraph('Third body', [10, 320, 130, 332]),
  ]], [page([
    { text: 'First', top: 100, size: 12 }, { text: 'First body', top: 130, size: 9 },
    { text: 'Second', top: 200, size: 12 }, { text: 'Second body', top: 230, size: 9 },
    { text: 'Third', top: 300, size: 12 }, { text: 'Third body', top: 320, size: 9 },
  ])]));
  expect(result.source.units.find(unit => unit.payload.text === 'Third')?.kind).toBe('paragraph');
  expect(result.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({
    reason: 'STRUCTURE_UNCERTAIN', message: expect.stringContaining('Third') }));
});
it('retains a table without injecting a partly unmatched physical line into its relationships', () => {
  const table = { type: 'table', bbox: [10, 100, 200, 200], content: { html: '<table><tr><td>Covered</td></tr></table>' } };
  const result = reconcileMineruTextCoverage(fixture([[table]], [page([{ text: 'Covered extra limit', top: 120 }])]));
  expect(result.source.units).toHaveLength(1); expect(result.source.units[0].kind).toBe('table');
  expect(result.source.units[0].mapping.extraction).toBe('MINERU_LOCAL');
  expect(result.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({ reason: 'TEXT_CONFLICT', readingImpact: 'LIMITATION' }));
  expect(documentOriginalReadingCoverage(result).unresolvedRanges.some(range => range.message.includes('Covered extra limit'))).toBe(true);
});
it('recovers a continuous single-column prose region with PDF item provenance and retained raw pointer', () => {
  const table = { type: 'table', bbox: [10, 100, 400, 190], content: {
    table_type: 'simple_table', table_nest_level: 1, table_caption: [], table_footnote: [],
    html: '<table><tr><td>Aircraft certified for fail operational autoland may see warning messages.</td></tr>' +
      '<tr><td>Operators have also experienced warning status during approach.</td></tr>' +
      '<tr><td>Displayed on the maintenance page for the crew to review.</td></tr></table>',
  } };
  const lines = [
    'Some operators have experienced a loss of guidance and autopilot disconnects on approach.',
    'Aircraft certified for fail operational autoland may see warning messages.',
    'Operators have also experienced warning status during approach.',
    'Displayed on the maintenance page for the crew to review.',
    'In addition, the flight crew should review the indicated condition before departure.',
  ].map((text, index) => ({ text, top: 105 + index * 18 }));
  const input = fixture([[table]], [page(lines)]);
  const result = reconcileMineruTextCoverage(input);
  const unit = result.source.units[0];
  expect(result.source.units).toHaveLength(1);
  expect(unit.kind).toBe('paragraph');
  expect(unit.payload.text).toContain('Some operators');
  expect(unit.payload.text).toContain('In addition');
  expect(unit.payload.rawMineruContent).toEqual(table.content);
  expect(unit.mapping.sourcePointer).toBe('/raw/contentListV2/0/0');
  expect(unit.mapping.textItems).toHaveLength(5);
  expect(result.locations[0].precision).toBe('TEXT_ITEM');
  expect(result.source.findings).toContainEqual(expect.objectContaining({
    code: 'PDF_TEXT_REGION_RECOVERY', message: expect.stringContaining('决定性工程判断仍须核对 PDF 原页') }));
  expect(result.coverage.unresolvedRanges.filter(range => range.reason === 'TEXT_CONFLICT')).toEqual([]);
  expect(input.original.source.units[0].kind).toBe('table');
});
it('refuses prose recovery when an omitted raw furniture block overlaps the candidate', () => {
  const table = { type: 'table', bbox: [10, 100, 400, 190], content: {
    table_type: 'simple_table', table_nest_level: 1, table_caption: [], table_footnote: [],
    html: '<table><tr><td>Aircraft certified for fail operational autoland may see warning messages.</td></tr>' +
      '<tr><td>Operators have also experienced warning status during approach.</td></tr>' +
      '<tr><td>Displayed on the maintenance page for the crew to review.</td></tr></table>',
  } };
  const footer = { type: 'page_footer', bbox: [10, 160, 200, 185],
    content: { page_footer_content: [{ type: 'text', content: 'Publication footer' }] } };
  const lines = [
    'Some operators have experienced a loss of guidance and autopilot disconnects on approach.',
    'Aircraft certified for fail operational autoland may see warning messages.',
    'Operators have also experienced warning status during approach.',
    'Displayed on the maintenance page for the crew to review.',
    'In addition, the flight crew should review the indicated condition before departure.',
  ].map((text, index) => ({ text, top: 105 + index * 18 }));
  const input = fixture([[table, footer]], [page(lines)]);
  expect(input.original.source.units).toHaveLength(1);
  const result = reconcileMineruTextCoverage(input);
  expect(result.source.units[0].kind).toBe('table');
  expect(result.source.findings.some(finding => finding.code === 'PDF_TEXT_REGION_RECOVERY')).toBe(false);
  expect(result.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({
    reason: 'TEXT_CONFLICT', readingImpact: 'LIMITATION' }));
});
it('keeps a one-column table when its rows have a header or the PDF has separate columns', () => {
  const table = { type: 'table', bbox: [10, 100, 700, 205], content: {
    table_type: 'simple_table', table_nest_level: 1,
    html: '<table><tr><th>Aircraft certified for fail operational autoland</th></tr>' +
      '<tr><td>Operators have also experienced warning status</td></tr>' +
      '<tr><td>Displayed on the maintenance page</td></tr></table>',
  } };
  const lines = [
    { text: 'Missing explanation about the condition', top: 105 },
    { text: 'Aircraft certified for fail operational autoland', top: 123 },
    { text: 'Operators have also experienced warning status', top: 141 },
    { text: 'Displayed on the maintenance page', top: 159 },
  ];
  const header = reconcileMineruTextCoverage(fixture([[table]], [page(lines)]));
  expect(header.source.units[0].kind).toBe('table');
  expect(header.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({
    reason: 'TEXT_CONFLICT', readingImpact: 'LIMITATION' }));
  const noHeader = structuredClone(table);
  noHeader.content.html = noHeader.content.html.replace('<th>', '<td>').replace('</th>', '</td>');
  const columns = reconcileMineruTextCoverage(fixture([[noHeader]],
    [page([...lines, { text: 'Another column', top: 141, x: 500 }])]));
  expect(columns.source.units[0].kind).toBe('table');
  expect(columns.source.findings.some(finding => finding.code === 'PDF_TEXT_REGION_RECOVERY')).toBe(false);
});
it('honors discarded/preprocessing regions and keeps geometry-uncertain text as a limitation', () => {
  const result = reconcileMineruTextCoverage(fixture([[paragraph('Body', [10, 300, 120, 315])]], [page([{ text: 'Discarded header', top: 20 }, { text: 'Body', top: 300 }])],
    { discarded_blocks: [{ type: 'header', bbox: [0, 0, 200, 60], lines: [{ spans: [{ content: 'Discarded header' }] }] }] }));
  expect(result.source.units).toHaveLength(1);
  const invalid = fixture([[paragraph('Body', [10, 300, 120, 315])]], [page([{ text: 'Missing', top: 180 }])], { discarded_blocks: [{ type: 'header' }] });
  const limited = reconcileMineruTextCoverage(invalid);
  expect(limited.source.units).toHaveLength(1);
  expect(limited.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({ reason: 'STRUCTURE_UNCERTAIN', readingImpact: 'LIMITATION' }));
});
it('keeps OCR-only scanned pages and does not declare them unread because PDF.js has no text', () => {
  const result = reconcileMineruTextCoverage(fixture([[paragraph('OCR-only warning', [10, 100, 200, 140])]], [page([])]));
  expect(result.source.units[0].payload.text).toBe('OCR-only warning');
  expect(result.coverage.readPageIndexes).toEqual([0]);
  expect(result.coverage.unresolvedRanges.filter(range => range.reason === 'UNREAD')).toEqual([]);
});
it('does not join separated columns or supplement unsupported page rotation', () => {
  const p = page([{ text: 'A', top: 180 }, { text: 'B', top: 180, x: 500 }]);
  const input = fixture([[paragraph('Body', [10, 300, 120, 315])]], [p]);
  const result = reconcileMineruTextCoverage(input);
  expect(result.source.units).toHaveLength(1);
  expect(result.coverage.unresolvedRanges.some(range => range.message.includes('多列'))).toBe(true);
  p.rotation = 90;
  expect(reconcileMineruTextCoverage(input).source.units).toHaveLength(1);
});

it('reports body present only in raw middle as undelivered, without blindly supplementing it', () => {
  const result = reconcileMineruTextCoverage(fixture([[paragraph('Body', [10, 300, 120, 315])]],
    [page([{ text: 'Hidden body', top: 100 }])],
    { preproc_blocks: [{ type: 'text', bbox: [10, 100, 200, 120], lines: [{ spans: [{ content: 'Hidden body' }] }] }] }));
  expect(result.source.units.map(unit => unit.payload.text)).toEqual(['Body']);
  expect(result.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({ reason: 'TEXT_CONFLICT', message: expect.stringContaining('Hidden body') }));
});
it('preserves column-major OCR order when appending a footer and limits ambiguous middle insertion', () => {
  const input = fixture([[paragraph('Left top', [10, 100, 120, 115]), paragraph('Left bottom', [10, 300, 120, 315]),
    paragraph('Right top', [500, 100, 620, 115])]], [page([{ text: 'Middle', top: 200 }, { text: 'Footer', top: 500 }])]);
  const result = reconcileMineruTextCoverage(input);
  expect(result.source.units.map(unit => unit.payload.text)).toEqual(['Left top', 'Left bottom', 'Right top', 'Footer']);
  expect(result.source.units.filter(unit => unit.mapping.extraction !== 'PDFJS_TEXT_LAYER').map(unit => unit.unitId))
    .toEqual(input.original.source.units.map(unit => unit.unitId));
  expect(result.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({ reason: 'STRUCTURE_UNCERTAIN', message: expect.stringContaining('Middle') }));
});

it('matches a visible multi-cell table row without mixing structural identities into its text', () => {
  const table = { type: 'table', bbox: [10, 100, 400, 200],
    content: { html: '<table><tr><td>Alpha</td><td>Beta</td></tr></table>' } };
  const result = reconcileMineruTextCoverage(fixture([[table]], [page([{ text: 'Alpha Beta', top: 120 }])]));
  expect(result.source.units).toHaveLength(1);
  expect(result.coverage.unresolvedRanges.filter(range => range.reason === 'TEXT_CONFLICT')).toEqual([]);
});

it('reuses Reader furniture omission only inside the omitted native region', () => {
  const footer = { type: 'page_footer', bbox: [0, 900, 300, 940],
    content: { page_footer_content: [{ type: 'text', content: 'Publication footer' }] } };
  const input = fixture([[paragraph('Body', [10, 100, 120, 115]), footer,
    paragraph('PROPRIETARY notice', [0, 950, 300, 980])]],
  [page([{ text: 'Publication footer', top: 910 }, { text: 'PROPRIETARY notice', top: 960 }, { text: 'Missing body', top: 880 }])],
  { preproc_blocks: [{ type: 'text', bbox: [0, 870, 300, 980] }] });
  const result = reconcileMineruTextCoverage(input);
  const conflicts = result.coverage.unresolvedRanges.filter(range => range.reason === 'TEXT_CONFLICT');
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].message).toContain('Missing body');
  expect(result.source.units.map(unit => unit.payload.text)).toEqual(['Body']);
});

it('does not exclude a PDF line only partially overlapping an omitted native footer', () => {
  const footer = { type: 'page_footer', bbox: [0, 900, 300, 940],
    content: { page_footer_content: [{ type: 'text', content: 'Footer' }] } };
  const result = reconcileMineruTextCoverage(fixture([[paragraph('Body', [10, 100, 120, 115]), footer]],
    [page([{ text: 'Edge body', top: 895 }])]));
  expect(result.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({
    reason: 'TEXT_CONFLICT', message: expect.stringContaining('Edge body'), readingImpact: 'LIMITATION' }));
});

const proseLines = [
  'Some operators have experienced a loss of guidance and autopilot disconnects on approach.',
  'Aircraft certified for fail operational autoland may see warning messages.',
  'Operators have also experienced warning status during approach.',
  'Displayed on the maintenance page for the crew to review.',
  'In addition, the flight crew should review the indicated condition before departure.',
  'The remaining indication must be checked against the applicable aircraft configuration.',
];
function proseGapFixture(options: {
  texts?: string[]; tops?: number[]; html?: string; content?: Record<string, unknown>; extra?: unknown[];
} = {}) {
  const texts = options.texts ?? proseLines;
  const tops = options.tops ?? [122, 134.5, 147, 159.5, 184.5, 197];
  const table = { type: 'table', bbox: [10, 100, 400, tops.at(-1)! + 12], content: {
    table_type: 'simple_table', table_nest_level: 1, table_caption: [], table_footnote: [],
    html: options.html ?? `<table>${texts.slice(1, 4).map(text => `<tr><td>${text}</td></tr>`).join('')}</table>`,
    ...options.content,
  } };
  const p = page([{ text: 'Description', top: 100, size: 12 },
    ...texts.map((text, index) => ({ text, top: tops[index], size: 9 }))]);
  return fixture([[table, ...options.extra ?? []]], [p]);
}
it('preserves a corroborated paragraph blank line using body pitch, excluding the larger initial label', () => {
  const input = proseGapFixture();
  const before = structuredClone(input);
  const result = reconcileMineruTextCoverage(input);
  const unit = result.source.units[0];
  const expected = `Description\n\n${proseLines.slice(0, 4).join(' ')}\n\n${proseLines.slice(4).join(' ')}`;
  expect(unit.kind).toBe('paragraph');
  expect(unit.payload.text).toBe(expected);
  expect(unit.payload.rawMineruContent).toEqual(input.original.source.units[0].payload.rawMineruContent);
  expect(unit.mapping.sourcePointer).toBe('/raw/contentListV2/0/0');
  expect(unit.mapping.textItems).toHaveLength(7);
  expect(result.source.sourceLocators[0].quote).toBe(expected);
  expect(result.locations[0].boxes).toHaveLength(7);
  expect(result.markdown).toContain(expected);
  expect(result.coverage.unresolvedRanges.filter(range => range.reason === 'TEXT_CONFLICT')).toEqual([]);
  expect(input).toEqual(before);
});
it.each([
  ['irregular large gap', [122, 134.5, 147, 159.5, 190.75, 203.25]],
  ['unstable ordinary pitch', [122, 136.5, 147, 159.5, 184.5, 197]],
  ['too few ordinary gaps to infer pitch', [122, 134.5, 159.5, 172]],
])('keeps the raw table and limitations for %s', (_name, tops) => {
  const input = proseGapFixture({ tops, texts: proseLines.slice(0, tops.length) });
  const result = reconcileMineruTextCoverage(input);
  expect(result.source.units[0].kind).toBe('table');
  expect(result.source.findings.some(finding => finding.code === 'PDF_TEXT_REGION_RECOVERY')).toBe(false);
  expect(result.coverage.unresolvedRanges.some(range => range.reason === 'TEXT_CONFLICT')).toBe(true);
});
it.each(['numeric', 'key/value'])('does not use blank row spacing to flatten a single-column %s table', kind => {
  const texts = proseLines.map((_line, index) => kind === 'numeric'
    ? `Inspection channel ${index + 1} measured value ${100 + index} lower bound 50 upper bound 200 reference count 30`
    : `Aircraft configuration assignment ${index + 1}: inspection category normal reference channel initial condition supported response value accepted`);
  const result = reconcileMineruTextCoverage(proseGapFixture({ texts }));
  expect(result.source.units[0].kind).toBe('table');
  expect(result.source.findings.some(finding => finding.code === 'PDF_TEXT_REGION_RECOVERY')).toBe(false);
});
it.each(['font change', 'left alignment change', 'multiple physical runs', 'no text layer'])('refuses paragraph recovery with %s', reason => {
  const input = proseGapFixture();
  const p = input.extraction.pages[0];
  if (reason === 'font change') {
    const item = p.items[3];
    item.transform[0] = 11; item.transform[3] = 11; item.height = 11;
  } else if (reason === 'left alignment change') p.items[3].transform[4] = 40;
  else if (reason === 'multiple physical runs') {
    const item = { ...p.items[3], text: 'Separate column', transform: [...p.items[3].transform] };
    item.transform[4] = 500;
    p.items.push(item); p.text += '\nSeparate column';
  } else { p.items = []; p.text = ''; }
  const result = reconcileMineruTextCoverage(input);
  expect(result.source.units[0].kind).toBe('table');
  expect(result.source.findings.some(finding => finding.code === 'PDF_TEXT_REGION_RECOVERY')).toBe(false);
});
it.each(['header', 'merged cell', 'caption', 'footnote', 'raw overlap', 'no shared phrase'])('preserves structural/source fences for %s with paragraph gaps', reason => {
  const options: Parameters<typeof proseGapFixture>[0] = {};
  if (reason === 'header') options.html = `<table><tr><th>${proseLines[1]}</th></tr><tr><td>${proseLines[2]}</td></tr><tr><td>${proseLines[3]}</td></tr></table>`;
  else if (reason === 'merged cell') options.html = `<table><tr><td rowspan="2">${proseLines[1]}</td></tr><tr></tr><tr><td>${proseLines[3]}</td></tr></table>`;
  else if (reason === 'caption' || reason === 'footnote') options.content = {
    [reason === 'caption' ? 'table_caption' : 'table_footnote']: [{ type: 'text', content: 'Retain this structural boundary.' }],
  };
  else if (reason === 'raw overlap') options.extra = [{ type: 'page_footer', bbox: [10, 180, 200, 205],
    content: { page_footer_content: [{ type: 'text', content: 'Publication footer' }] } }];
  else options.html = '<table><tr><td>One independent unrelated statement describes another system and condition.</td></tr>' +
    '<tr><td>Second independent unrelated row lists different equipment and criteria.</td></tr>' +
    '<tr><td>Third independent unrelated row retains the distinct original observation.</td></tr></table>';
  const result = reconcileMineruTextCoverage(proseGapFixture(options));
  expect(result.source.units[0].kind).toBe('table');
  expect(result.source.findings.some(finding => finding.code === 'PDF_TEXT_REGION_RECOVERY')).toBe(false);
});

function footer(text: string, bbox = [0, 900, 950, 980]) {
  return { type: 'page_footer', bbox, content: { page_footer_content: [{ type: 'text', content: text }] } };
}
const generatedUnits = (result: ReturnType<typeof reconcileMineruTextCoverage>) =>
  result.source.units.filter(unit => unit.payload.role === 'SOURCE_GENERATED_DATE');

it('preserves an explicit generated-on statement as an ordinary same-source unit with real PDF item geometry', () => {
  const text = 'The document generated on 05/06/2032 by Reference application.';
  const input = fixture([[paragraph('Body condition.', [10, 100, 200, 120]), footer(text)]],
    [page([{ text: 'Body condition.', top: 100 }, { text, top: 910 }])]);
  const before = structuredClone(input);
  const result = reconcileMineruTextCoverage(input), units = generatedUnits(result);
  expect(units).toHaveLength(1);
  const unit = units[0], ref = unit.sourceRefIds[0];
  expect(unit.kind).toBe('paragraph');
  expect(unit.payload.text).toBe(text);
  expect(unit.mapping).toMatchObject({ supplementation: 'EXPLICIT_GENERATED_ON_FOOTER', pageIndex: 0,
    sourcePointer: '/raw/contentListV2/0/1', sourceArtifactPath: 'original/pages-0.json',
    textItems: [{ pageIndex: 0, itemIndexes: [1] }] });
  expect(result.binding).toEqual(before.original.binding);
  expect(result.source.sourceLocators.find(value => value.sourceRefId === ref)).toMatchObject({
    artifactId: binding.sourceArtifactId, quote: text, pageStart: 0, pageEnd: 0 });
  expect(result.locations.find(value => value.sourceRefId === ref)).toMatchObject({ precision: 'TEXT_ITEM',
    coordinateSpace: 'PDF_VIEWPORT_TOP_LEFT', pageIndex: 0, boxes: [[10, 910, 100, 10]] });
  expect(result.markdown).toContain(text);
  const semantic = buildDocumentSemanticMap({ original: result, semanticRevision: 2, profile: { profileRef: 'test', roles: [] } });
  expect(semantic.unassignedUnitIds).toContain(unit.unitId);
  expect(result.source.units.map(value => value.payload.text)).toEqual(['Body condition.', text]);
  expect(input).toEqual(before); // A new parse result, not a mutation of an old published original.
});

it('recovers the complete bounded wrapped sentence inside a filtered publication notice, without retaining unrelated legal text', () => {
  const notice = 'PROPRIETARY legal notice. The document generated on 2032-05-06 by Reference application. Other legal conditions.';
  const input = fixture([[paragraph('Body.', [10, 100, 200, 120]), paragraph(notice, [0, 900, 950, 980])]],
    [page([{ text: 'Body.', top: 100 },
      { text: 'PROPRIETARY legal notice. The document generated', top: 910 },
      { text: 'on 2032-05-06 by Reference application. Other legal conditions.', top: 922 }])]);
  const result = reconcileMineruTextCoverage(input), unit = generatedUnits(result)[0];
  expect(unit.payload.text).toBe('The document generated on 2032-05-06 by Reference application.');
  expect(unit.mapping.textItems).toEqual([{ pageIndex: 0, itemIndexes: [1] }, { pageIndex: 0, itemIndexes: [2] }]);
  expect(result.locations.find(value => value.sourceRefId === unit.sourceRefIds[0])?.boxes).toHaveLength(2);
  expect(result.markdown).not.toContain('PROPRIETARY legal notice');
  expect(result.markdown).not.toContain('Other legal conditions');
});

it('keeps an uncovered body supplement before a generated-date footer when both share the same insertion slot', () => {
  const text = 'The document generated on 05/06/2032.';
  const result = reconcileMineruTextCoverage(fixture([[paragraph('First body.', [10, 100, 200, 120]), footer(text)]],
    [page([{ text: 'First body.', top: 100 }, { text: 'Later body condition.', top: 500 }, { text, top: 910 }])]));
  expect(result.source.units.map(unit => unit.payload.text)).toEqual(['First body.', 'Later body condition.', text]);
});

it('accepts a proved discarded middle footer and deduplicates only the same physical statement across overlapping raw regions', () => {
  const text = 'Document generated on 6 May 2032.';
  const extra = { discarded_blocks: [{ type: 'footer', bbox: [0, 900, 950, 980] }] };
  const middleOnly = reconcileMineruTextCoverage(fixture([[paragraph('Body.', [10, 100, 200, 120])]],
    [page([{ text: 'Body.', top: 100 }, { text, top: 910 }])], extra));
  expect(generatedUnits(middleOnly)[0].mapping.sourcePointer).toBe('/raw/middle/pdf_info/0/discarded_blocks/0');
  const both = reconcileMineruTextCoverage(fixture([[paragraph('Body.', [10, 100, 200, 120]), footer(text, [0, 905, 950, 935])]],
    [page([{ text: 'Body.', top: 100 }, { text: 'Copyright legal notice.', top: 900 }, { text, top: 910 }])], extra));
  expect(generatedUnits(both)).toHaveLength(1);
  expect(generatedUnits(both)[0].mapping.sourcePointer).toBe('/raw/contentListV2/0/1');
});

it.each([
  'Copyright legal notice.',
  'The document generated on an unspecified day.',
  'Example: The document generated on 05/06/2032.',
  '“The document generated on 05/06/2032.”',
])('does not invent a source-generation date from an unrelated or nondeclarative footer: %s', text => {
  const result = reconcileMineruTextCoverage(fixture([[paragraph('Body.', [10, 100, 200, 120]), footer(text)]],
    [page([{ text: 'Body.', top: 100 }, { text, top: 910 }])]));
  expect(generatedUnits(result)).toEqual([]);
  expect(result.source.units.map(unit => unit.payload.text)).toEqual(['Body.']);
});

it('keeps a body date reference as body text and does not promote an omitted block outside the physical footer', () => {
  const text = 'The document generated on 05/06/2032.';
  const body = reconcileMineruTextCoverage(fixture([[paragraph(text, [10, 300, 300, 320])]], [page([{ text, top: 300 }])]));
  expect(body.source.units[0].payload.text).toBe(text);
  expect(generatedUnits(body)).toEqual([]);
  const omittedBody = reconcileMineruTextCoverage(fixture([[footer(text, [0, 300, 950, 340])]], [page([{ text, top: 310 }])]));
  expect(generatedUnits(omittedBody)).toEqual([]);
});

it.each(['cross-column wrap', 'large gap', 'different font', 'multiple physical runs', 'rotation', 'partial footer overlap', 'incomplete sentence'])(
  'does not join uncertain generated-date evidence with %s', reason => {
    const lines = [{ text: 'The document generated', top: 910 }, { text: 'on 05/06/2032 by Reference application.', top: 922 }];
    const p = page(lines);
    if (reason === 'cross-column wrap') p.items[1].transform[4] = 500;
    if (reason === 'large gap') p.items[1].transform[5] -= 35;
    if (reason === 'different font') { p.items[1].transform[0] = 8; p.items[1].transform[3] = 8; }
    if (reason === 'multiple physical runs') {
      p.items[1].transform[5] = p.items[0].transform[5]; p.items[1].transform[4] = 500;
    }
    if (reason === 'rotation') p.rotation = 90;
    if (reason === 'partial footer overlap') p.items[0].transform[5] += 20;
    if (reason === 'incomplete sentence') {
      p.items[1].text = 'on 05/06/2032 by'; p.text = p.items.map(item => item.text).join('\n');
    }
    const input = fixture([[paragraph('Body.', [10, 100, 200, 120]), footer(lines.map(value => value.text).join(' '))]], [p]);
    const result = reconcileMineruTextCoverage(input);
    expect(generatedUnits(result)).toEqual([]);
  });

it('preserves conflicting explicit footer dates and their independent locations as a limitation, without changing any revision date', () => {
  const first = 'Document generated on 2032-05-06.', second = 'Document generated on 2032-05-07.';
  const input = fixture([[paragraph('Body.', [10, 100, 200, 120]), footer(`${first} ${second}`)]],
    [page([{ text: 'Body.', top: 100 }, { text: first, top: 910 }, { text: second, top: 922 }])]);
  const result = reconcileMineruTextCoverage(input), units = generatedUnits(result);
  expect(units.map(unit => unit.payload.text)).toEqual([first, second]);
  expect(new Set(units.map(unit => unit.unitId)).size).toBe(2);
  expect(result.binding).toEqual(input.original.binding);
  expect(result.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({
    reason: 'TEXT_CONFLICT', unitIds: units.map(unit => unit.unitId), readingImpact: 'LIMITATION',
    message: expect.stringContaining('不同的文档生成日期') }));
});
