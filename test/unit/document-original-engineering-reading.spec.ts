import { documentOriginalEngineeringReading } from '../../server/modules/canonical-host/document-original-engineering-reading';
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
