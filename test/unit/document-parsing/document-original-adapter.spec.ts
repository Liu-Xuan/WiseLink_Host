import { documentOriginalStructuredSource } from '../../../server/modules/document-management/src/hosted/nest/document-original-adapter';
import { buildTranslationSourcePlan } from '../../../server/modules/canonical-host/canonical-translation-source-plan';
import { originalFixture } from './fixtures/document-original.fixture';

describe('exact original adapter (constructed data)', () => {
  it('feeds the existing V2 planner without losing long prose, table cells, or coverage', () => {
    const result = originalFixture();
    const source = documentOriginalStructuredSource(result, result.binding);
    const plan = buildTranslationSourcePlan({ documentVersionId: result.binding.documentVersionId,
      packageId: result.binding.parseRunId, title: 'Constructed', source,
      parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'fixture-only',
        sha256: 'b'.repeat(64), byteLength: 42, mediaType: 'application/json' } });
    expect(plan.anchors.map(anchor => anchor.sourceText)).toEqual([
      result.source.units[0].payload.text, 'Pressure', '12 kPa', 'Only when X',
    ]);
    expect(source.findings).toHaveLength(2);
    expect(result.source.findings).toHaveLength(0);
    expect(source.sourceLocators[1].pageStart).toBe(1);
    expect(source.sourceLocators.every(locator => locator.bbox === null)).toBe(true);
  });
  it('rejects a different parse revision, even for identical document bytes', () => {
    const result = originalFixture();
    expect(() => documentOriginalStructuredSource(result, { ...result.binding, parseRevision: 3 }))
      .toThrow('DOCUMENT_ORIGINAL_BINDING_MISMATCH');
  });
  it('rejects unaccounted pages and fabricated page-level geometry', () => {
    const result = originalFixture();
    result.coverage.unresolvedRanges.pop();
    expect(() => documentOriginalStructuredSource(result, result.binding)).toThrow('DOCUMENT_ORIGINAL_COVERAGE_UNACCOUNTED');
    const geometry = originalFixture();
    geometry.locations[0].boxes = [[0, 0, 1, 1]];
    expect(() => documentOriginalStructuredSource(geometry, geometry.binding)).toThrow('DOCUMENT_ORIGINAL_LOCATION_PRECISION_INVALID');
  });
});

it('bounds long sections at complete prose boundaries, preserving sentence fragments', () => {
  const result = originalFixture();
  const first = result.source.units[0];
  result.source.units = [
    { ...first, payload: { text: 'A complete statement. '.repeat(320) } },
    { ...first, unitId: 'u-next', order: 1, payload: { text: 'Do not use the method' } },
    { ...first, unitId: 'u-end', order: 2, payload: { text: 'unless condition X is met.' } },
  ];
  const plan = buildTranslationSourcePlan({ documentVersionId: result.binding.documentVersionId,
    packageId: result.binding.parseRunId, title: 'Constructed long section',
    source: documentOriginalStructuredSource(result, result.binding),
    parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'fixture',
      sha256: 'b'.repeat(64), byteLength: 42, mediaType: 'application/json' } });
  expect(plan.blocks.map(block => block.sourceUnitIds)).toEqual([['u1'], ['u-next', 'u-end']]);
});
