import * as sourcePlanning from '../../server/modules/canonical-host/canonical-translation-source-plan';
import * as adapter from '../../server/modules/document-management/src/hosted/nest/document-original-adapter';
import { buildDocumentSemanticMap } from '../../server/modules/document-management/src/hosted/nest/document-semantic-map';
import { GENERIC_SEMANTIC_PROFILE } from '../../server/modules/document-management/src/hosted/nest/document-semantic-profile';
import { documentOriginalEngineeringReading, prepareDocumentOriginalEngineeringReader } from '../../server/modules/canonical-host/document-original-engineering-reading';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

function fixture() {
  const original = originalFixture();
  return { original, structuredSource: original.source, run: {
    documentVersionId: original.binding.documentVersionId, parseRunId: original.binding.parseRunId,
    parseRevision: original.binding.parseRevision,
    manifestArtifact: { relativePath: 'original/manifest.json', readback: 'VERIFIED',
      sha256: 'b'.repeat(64), byteLength: 100, mediaType: 'application/json' },
  } } as Parameters<typeof documentOriginalEngineeringReading>[0];
}

describe('engineering original evidence', () => {
  it('retains long original text, table content and honest coverage across pages', () => {
    const loaded = fixture();
    const first = documentOriginalEngineeringReading(loaded, 0, 1);
    expect(first.evidence[0].excerpt).toEqual(loaded.original.source.units[0].payload.text);
    expect(first.evidence[0].workItemId).toBeNull();
    expect(first.nextOffset).toBe(1);
    expect(first.coverage.unresolvedRanges).toHaveLength(2);
    const second = documentOriginalEngineeringReading(loaded, 1, 1);
    expect(second.evidence[0].excerpt).toContain('12 kPa');
    expect(second.evidence[0].excerpt).toContain('Only when X');
    expect(second.nextOffset).toBeNull();
    expect(second.sourceRefs).toEqual(second.evidence.map(item => item.evidenceRef));
  });

  it('gives one locator identical complete evidence when it spans multiple units', () => {
    const loaded = fixture();
    loaded.structuredSource.units.push({ ...loaded.structuredSource.units[0], unitId: 'u3', order: 2,
      payload: { text: 'Retained exception from the same source locator.' } });
    const first = documentOriginalEngineeringReading(loaded, 0, 1);
    const last = documentOriginalEngineeringReading(loaded, 2, 1);
    expect(first.evidence).toEqual(last.evidence);
    expect(first.evidence[0].excerpt).toContain('Retained exception');
  });

  it('rejects drifted manifest binding and invalid offsets', () => {
    const loaded = fixture();
    expect(() => documentOriginalEngineeringReading(loaded, -1, 1)).toThrow('RANGE_INVALID');
    loaded.run.parseRunId = 'different';
    expect(() => documentOriginalEngineeringReading(loaded, 0, 1)).toThrow('BINDING_INVALID');
  });
});

it('returns only source findings bound to the selected original range, keeping diagnostics out of engineering input', () => {
  const loaded = fixture();
  loaded.structuredSource.findings = [
    { findingId: 'diagnostic', code: 'TEXT_CONFLICT', message: 'internal diagnostic', severity: 'warning',
      readingImpact: 'DIAGNOSTIC', affectedUnitIds: ['u1'], sourceRefIds: [] },
    { findingId: 'unlocated', code: 'UNKNOWN', message: 'no specific location', severity: 'warning',
      affectedUnitIds: [], sourceRefIds: [] },
    { findingId: 'local', code: 'STRUCTURE_UNCERTAIN', message: 'local table limit', severity: 'warning',
      readingImpact: 'LIMITATION', affectedUnitIds: ['u2'], sourceRefIds: [] },
  ];
  expect(documentOriginalEngineeringReading(loaded, 0, 1).findings).toEqual([]);
  expect(documentOriginalEngineeringReading(loaded, 1, 1).findings.map(finding => finding.findingId)).toEqual(['local']);
});


it('prepares plan/coverage once, keeps cross-page quotes complete, and detaches returned mutable coverage/evidence', () => {
  const loaded = fixture();
  loaded.structuredSource.units.push({ ...loaded.structuredSource.units[0], unitId: 'u3', order: 2,
    payload: { text: 'Retained final exception for the same locator.' } });
  const before = structuredClone(loaded);
  const plan = jest.spyOn(sourcePlanning, 'buildTranslationSourcePlan');
  const coverage = jest.spyOn(adapter, 'documentOriginalReadingCoverage');
  try {
    const read = prepareDocumentOriginalEngineeringReader(loaded);
    const first = read(0, 1);
    const expected = structuredClone(first.evidence);
    first.evidence[0].excerpt = 'Caller changed its returned evidence.';
    first.coverage.unresolvedRanges.length = 0;
    const table = read(1, 1);
    const last = read(2, 1);
    expect(last.evidence).toEqual(expected);
    expect(last.evidence[0].excerpt).toContain('Retained final exception');
    expect(last.coverage.unresolvedRanges).toHaveLength(2);
    expect(table.evidence[0].excerpt).toContain('12 kPa');
    expect(table.sourceLocators.map(locator => locator.sourceRefId)).toEqual(['SR-TEST-P2']);
    expect(last.nextOffset).toBeNull();
    expect(read(3, 20).evidence).toEqual([]);
    expect(() => read(0, 21)).toThrow('RANGE_INVALID');
    expect(() => read(-1, 1)).toThrow('RANGE_INVALID');
    expect(plan).toHaveBeenCalledTimes(1);
    expect(coverage).toHaveBeenCalledTimes(1);
    expect(loaded).toEqual(before);
  } finally { plan.mockRestore(); coverage.mockRestore(); }
});

it('each separately loaded original prepares its own exact content, with no cross-request plan cache', () => {
  const first = fixture(); const second = fixture();
  second.original.source.units[0].payload.text = 'New independently loaded source content.';
  const originalRead = prepareDocumentOriginalEngineeringReader(first);
  const changedRead = prepareDocumentOriginalEngineeringReader(second);
  expect(originalRead(0, 1).evidence[0].excerpt).toContain('Do not use method M');
  expect(changedRead(0, 1).evidence[0].excerpt).toBe('New independently loaded source content.');
  const invalid = fixture(); invalid.run.parseRunId = 'another-parse';
  expect(() => prepareDocumentOriginalEngineeringReader(invalid)).toThrow('BINDING_INVALID');
});

it('keeps semantic revisions scoped to their prepared reader and rejects a foreign source binding', () => {
  const loaded = fixture();
  const firstMap = buildDocumentSemanticMap({ original: loaded.original, profile: GENERIC_SEMANTIC_PROFILE, semanticRevision: 1 });
  const secondMap = buildDocumentSemanticMap({ original: loaded.original, profile: GENERIC_SEMANTIC_PROFILE, semanticRevision: 2 });
  const first = prepareDocumentOriginalEngineeringReader(loaded, firstMap);
  const second = prepareDocumentOriginalEngineeringReader(loaded, secondMap);
  expect(first(0, 1).semanticMap?.semanticRevision).toBe(1);
  expect(second(0, 1).semanticMap?.semanticRevision).toBe(2);
  const other = fixture(); other.original.binding.parseRunId = 'other-parse'; other.run.parseRunId = 'other-parse';
  expect(() => prepareDocumentOriginalEngineeringReader(other, firstMap)).toThrow();
});
