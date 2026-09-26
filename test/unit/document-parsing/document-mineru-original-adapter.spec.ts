import { documentMineruOriginal } from '../../../server/modules/document-management/src/hosted/nest/document-mineru-original-adapter';
import { documentOriginalReadingCoverage, documentOriginalStructuredSource } from '../../../server/modules/document-management/src/hosted/nest/document-original-adapter';
import { readMineruArtifacts } from '../../../server/modules/professional-input/mineru/mineru-artifacts';
import type { MineruParseResult } from '../../../server/modules/professional-input/mineru/mineru-artifact-store';
import { buildTranslationSourcePlan } from '../../../server/modules/canonical-host/canonical-translation-source-plan';

const text = (content: string) => [{ type: 'text', content }];
const block = (type: string, content: Record<string, unknown>) => ({ type, content, bbox: [20, 30, 900, 150] });
const binding = { documentVersionId: 'DV-native', parseRunId: 'PR-native', parseRevision: 2,
  sourceArtifactId: 'source-native', sourceSha256: 'a'.repeat(64), sourceByteLength: 1024 };
const documentVersion = { documentVersionId: binding.documentVersionId, documentId: 'DOC-native', familyId: 'family-native',
  sourceArtifactId: binding.sourceArtifactId, pdfSha256: binding.sourceSha256, byteLength: binding.sourceByteLength };
function fixture(): MineruParseResult {
  const markdown = '# Raw scan\n\nThe OCR-only warning is absent from this markdown.';
  const middle = { _version_name: '3.4.5', _backend: 'pipeline', pdf_info: [0, 1, 2].map(page_idx => ({ page_idx, page_size: [600, 800] })) };
  const contentListV2 = [[
    block('title', { level: 1, title_content: text('Raw scan') }),
    block('paragraph', { paragraph_content: text('OCR-only: do not operate unless condition X is satisfied.') }),
    block('list', { list_items: [{ item_content: text('Remove A.') }, { item_content: text('Retain B.') }] }),
    block('table', { table_type: 'complex_table', html: '<table><tr><th rowspan="2">Limit</th><th colspan="2">Values</th></tr><tr><td>10</td><td>20</td></tr></table>',
      table_caption: text('Load limits'), table_footnote: text('Except configuration B.') }),
    block('page_footnote', { page_footnote_content: text('Keep this safety note.') }),
  ], [
    block('image', { image_caption: text('Figure A'), image_source: { path: 'images/a.png' } }),
    block('new_unsupported_structure', { data: { retained: 'uninterpreted source data' } }),
    block('code', { code_caption: text('Example'), code_body: 'retain original code body' }),
  ], []];
  return { sourceSha256: binding.sourceSha256, sourceByteLength: binding.sourceByteLength,
    rawArtifacts: { markdown, middle, contentListV2 }, middle, contentListV2,
    document: readMineruArtifacts({ markdown, middle, contentListV2, assetPaths: ['images/a.png'] }),
    assets: [{ path: 'images/a.png', bytes: new Uint8Array([1]), mediaType: 'image/png', sha256: 'b'.repeat(64) }],
    titleEnhancement: { status: 'DISABLED' } };
}
function convert(result = fixture()) { return documentMineruOriginal({ binding, documentVersion, result }); }

describe('offline MinerU original adapter', () => {
  it('retains raw OCR source and accurate producer independently of markdown and enhanced reading', () => {
    const result = fixture();
    result.document.blocks[0].content.title_content = text('Enhanced title not adopted');
    const before = structuredClone(result);
    const original = convert(result);
    expect(original.binding).toEqual(binding);
    expect(original.producer).toMatchObject({ kind: 'MINERU_LOCAL', pluginVersion: '3.4.5',
      engine: { name: 'MinerU', version: '3.4.5', backend: 'pipeline' }, concreteModel: null });
    expect(original.source.units[0].payload.text).toBe('Raw scan');
    expect(original.source.units.map(unit => unit.payload.text)).toContain('OCR-only: do not operate unless condition X is satisfied.');
    expect(result).toEqual(before);
    expect(original.locations.every(location => location.precision === 'NATIVE_SELECTOR' && !location.boxes.length)).toBe(true);
    expect(original.source.units[0].mapping).toMatchObject({ pageIndex: 0, sourcePointer: '/raw/contentListV2/0/0',
      sourceArtifactPath: 'raw/mineru-candidate.json', nativeBbox: [20, 30, 900, 150] });
    expect(original.source.sourceLocators.every(locator => locator.artifactId === binding.sourceArtifactId)).toBe(true);
  });

  it('preserves merged table cells, lists and footnotes in the actual downstream source plan', () => {
    const original = convert();
    const table = original.source.units.find(unit => unit.kind === 'table')!;
    expect(JSON.stringify(table.payload)).toContain('"rowSpan":2');
    expect(JSON.stringify(table.payload)).toContain('"colSpan":2');
    const source = documentOriginalStructuredSource(original, binding);
    const plan = buildTranslationSourcePlan({ documentVersionId: binding.documentVersionId, packageId: binding.parseRunId,
      title: '', source, parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'fixture://offline',
        sha256: 'b'.repeat(64), byteLength: 1, mediaType: 'application/json' } });
    const anchors = plan.anchors.map(anchor => anchor.sourceText);
    for (const expected of ['Limit', 'Values', '10', '20', 'Load limits', 'Except configuration B.',
      'Remove A.', 'Retain B.', 'Keep this safety note.']) expect(anchors).toContain(expected);
    expect(plan.blocks.some(entry => entry.organization === 'EXPLICIT_LIST')).toBe(true);
  });

  it('keeps figure, unsupported structure and unread-page limitations visible in reading coverage', () => {
    const original = convert();
    const coverage = documentOriginalReadingCoverage(original);
    expect(coverage.readPageIndexes).toEqual([0, 1]);
    expect(coverage.unresolvedRanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'FIGURE_UNINTERPRETED', pageIndexes: [1], readingImpact: 'LIMITATION' }),
      expect.objectContaining({ reason: 'STRUCTURE_UNCERTAIN', pageIndexes: [1], readingImpact: 'LIMITATION' }),
      expect.objectContaining({ reason: 'UNREAD', pageIndexes: [2], readingImpact: 'LIMITATION' }),
    ]));
    const unsupported = original.source.units.find(unit => unit.payload.originalBlockType === 'new_unsupported_structure')!;
    expect(unsupported.kind).toBe('preserved_source');
    expect(unsupported.payload.rawMineruContent).toEqual({ data: { retained: 'uninterpreted source data' } });
    expect(original.source.units.find(unit => unit.kind === 'figure')?.payload.assetPath).toBe('images/a.png');
  });

  it('uses validated heading levels without changing original title text', () => {
    const result = fixture();
    const original = documentMineruOriginal({ binding, documentVersion, result,
      validatedTitleLevels: [{ id: result.document.blocks[0].id, level: 3 }] });
    expect(original.source.units[0].payload).toMatchObject({ text: 'Raw scan', level: 3 });
    expect(result.document.blocks[0].headingLevel).toBe(1);
    expect(() => documentMineruOriginal({ binding, documentVersion, result,
      validatedTitleLevels: [{ id: 'unknown', level: 3 }] })).toThrow('DOCUMENT_MINERU_TITLE_LEVELS_INVALID');
  });

  it.each(['sha', 'bytes', 'artifact', 'version', 'backend'])('rejects invalid source or producer binding: %s', mismatch => {
    const result = fixture();
    if (mismatch === 'sha') result.sourceSha256 = 'b'.repeat(64);
    if (mismatch === 'bytes') result.sourceByteLength += 1;
    if (mismatch === 'version') result.rawArtifacts.middle = { ...result.document.middle, _version_name: '9.9.9' };
    if (mismatch === 'backend') result.rawArtifacts.middle = { ...result.document.middle, _backend: 'remote-model' };
    expect(() => documentMineruOriginal({ binding, result,
      documentVersion: mismatch === 'artifact' ? { ...documentVersion, sourceArtifactId: 'other' } : documentVersion })).toThrow();
  });
});
