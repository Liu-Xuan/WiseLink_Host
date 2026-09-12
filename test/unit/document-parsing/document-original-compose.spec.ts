import { composeDocumentOriginal } from '../../../server/modules/document-management/src/hosted/nest/document-original-compose';
import { documentOriginalStructuredSource } from '../../../server/modules/document-management/src/hosted/nest/document-original-adapter';
import { buildTranslationSourcePlan } from '../../../server/modules/canonical-host/canonical-translation-source-plan';
import { originalFixture } from './fixtures/document-original.fixture';

function compose(text: string, markdown: string) {
  const fixture = originalFixture();
  return composeDocumentOriginal({ binding: fixture.binding, producer: fixture.producer, markdown,
    extraction: { pageCount: 1, pages: [{ pageIndex: 0, text, width: 600, height: 800, rotation: 0, imagePaintOperations: 0, items: [] }] } });
}

describe('hybrid original composition (constructed extraction)', () => {
  it('retains omitted words from the real alternate extraction, without inventing repaired prose', () => {
    const result = compose('Do not use method M unless condition X is met.', 'Do not use method M.');
    expect(result.source.units.map(unit => unit.payload.text).join(' ')).toBe('Do not use method M unless condition X is met.');
    expect(result.coverage.unresolvedRanges.some(range => range.reason === 'TEXT_CONFLICT')).toBe(true);
    expect(result.locations.every(location => location.precision === 'PAGE' && location.boxes.length === 0)).toBe(true);
  });
  it('preserves unmatched text around a matched organization candidate', () => {
    const result = compose('Read first.\nVerified paragraph.\nKeep this exception.', 'Verified paragraph.');
    expect(result.source.units.map(unit => unit.payload.text)).toEqual(['Read first.', 'Verified paragraph.', 'Keep this exception.']);
  });
  it('keeps all extra table columns and passes the existing V2 planner', () => {
    const result = compose('Key Value A 12 Extra', '| Key | Value |\n| --- | --- |\n| A | 12 | Extra |');
    const plan = buildTranslationSourcePlan({ documentVersionId: result.binding.documentVersionId,
      packageId: result.binding.parseRunId, title: 'Test table',
      source: documentOriginalStructuredSource(result, result.binding),
      parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'fixture', sha256: 'b'.repeat(64), byteLength: 1, mediaType: 'application/json' } });
    expect(plan.anchors.map(anchor => anchor.sourceText)).toEqual(['Key', 'Value', 'A', '12', 'Extra']);
    expect(result.coverage.unresolvedRanges.some(range => range.reason === 'STRUCTURE_UNCERTAIN')).toBe(true);
  });
  it('reports a failed image inspection separately while preserving extracted text', () => {
    const fixture = originalFixture();
    const result = composeDocumentOriginal({ binding: fixture.binding, producer: fixture.producer, markdown: 'Readable text.',
      extraction: { pageCount: 1, pages: [{ pageIndex: 0, text: 'Readable text.', width: 600, height: 800,
        rotation: 0, imagePaintOperations: null, items: [] }] } });
    expect(result.source.units[0].payload.text).toBe('Readable text.');
    expect(result.coverage.unresolvedRanges).toEqual([expect.objectContaining({ reason: 'FIGURE_UNINTERPRETED', pageIndexes: [0] })]);
  });

});
