import type { DocumentOriginalResult } from '../../../../shared/document-original.interface';

/** Constructed test material; never evidence of a real plugin or OEM PDF run. */
export function originalFixture(): DocumentOriginalResult {
  const refs = ['SR-TEST-P1', 'SR-TEST-P2'];
  return {
    schemaVersion: 'wiselink.document.original.v1',
    binding: { documentVersionId: 'DV-TEST', parseRunId: 'PR-TEST-2', parseRevision: 2,
      sourceArtifactId: 'ART-TEST', sourceSha256: 'a'.repeat(64), sourceByteLength: 1234 },
    producer: { kind: 'OFFICIAL_PLUGIN_HYBRID', instanceId: 'CONSTRUCTED-NOT-CALLED',
      pluginVersion: 'fixture', actionKey: 'fixture', concreteModel: null, extractedAt: '2026-09-13T00:00:00Z' },
    source: {
      modules: [{ moduleId: 'body', order: 0 }],
      units: [
        { unitId: 'u1', kind: 'paragraph', moduleId: 'body', parentUnitId: null, order: 0,
          depth: 0, continuityKey: 'body', sourceRefIds: [refs[0]], sourceSegmentIds: ['s1'], mapping: {},
          payload: { text: 'Do not use method M unless condition X is met. ' +
            'Keep the original part number A-12, limit -0.25 and exception together. '.repeat(8) } },
        { unitId: 'u2', kind: 'table', moduleId: 'body', parentUnitId: null, order: 1,
          depth: 0, continuityKey: 'table1', sourceRefIds: [refs[1]], sourceSegmentIds: ['s2'], mapping: {},
          payload: { layout: 'grid', columns: [], rowGroups: [{ rows: [
            { cells: ['Pressure', '12 kPa', 'Only when X'].map((text, index) => ({
              cellId: `c${index}`, rowSpan: 1, colSpan: 1,
              inlineContent: [{ text, sourceRefIds: [refs[1]] }],
            })) },
          ] }] } },
      ],
      sourceLocators: refs.map((sourceRefId, index) => ({ sourceRefId, kind: 'PDF_PAGE',
        artifactId: 'ART-TEST', pageStart: index, pageEnd: index, charStart: null, charEnd: null,
        charOffsetUnit: null, normalizedPath: null, xpath: null, elementId: null, quote: null, bbox: null })),
      findings: [], references: [],
    },
    locations: refs.map((sourceRefId, pageIndex) => ({ sourceRefId, pageIndex, precision: 'PAGE',
      coordinateSpace: null, viewportWidth: null, viewportHeight: null, boxes: [] })),
    coverage: { knownPageCount: 3, readPageIndexes: [0, 1], unresolvedRanges: [
      { pageIndexes: [1], unitIds: ['u2'], reason: 'STRUCTURE_UNCERTAIN', message: 'Constructed ambiguous extra column.' },
      { pageIndexes: [2], unitIds: [], reason: 'UNREAD', message: 'Constructed unread page.' },
    ] },
    markdown: 'Constructed fixture; see exact structured source.',
  };
}
