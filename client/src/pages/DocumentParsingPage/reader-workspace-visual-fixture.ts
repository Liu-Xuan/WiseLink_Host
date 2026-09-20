import type { DocumentOriginalResult } from '@shared/document-original.interface';

/** Explicitly constructed visual material. It is never used by canonical routes or APIs. */
export function readerWorkspaceVisualFixture(): DocumentOriginalResult {
  const sourceRefIds = ['PREVIEW-SOURCE-1', 'PREVIEW-SOURCE-2', 'PREVIEW-SOURCE-3'];
  return {
    schemaVersion: 'wiselink.document.original.v1',
    binding: {
      documentVersionId: 'PREVIEW-DOCUMENT-VERSION',
      parseRunId: 'PREVIEW-PARSE-RUN',
      parseRevision: 7,
      sourceArtifactId: 'PREVIEW-ARTIFACT',
      sourceSha256: 'p'.repeat(64),
      sourceByteLength: 102400,
    },
    producer: {
      kind: 'OFFICIAL_PLUGIN_HYBRID',
      instanceId: 'PREVIEW-CONSTRUCTED-ONLY',
      pluginVersion: 'preview',
      actionKey: 'preview',
      concreteModel: null,
      extractedAt: '2026-09-20T00:00:00Z',
    },
    source: {
      modules: [{ moduleId: 'body', order: 0 }],
      units: [
        {
          unitId: 'preview-heading-1', kind: 'heading', moduleId: 'body',
          parentUnitId: null, order: 0, depth: 0, continuityKey: 'body',
          sourceRefIds: [sourceRefIds[0]], sourceSegmentIds: ['preview-segment-1'],
          mapping: {}, payload: { text: '1. Inspection scope and operating conditions' },
        },
        {
          unitId: 'preview-paragraph-1', kind: 'paragraph', moduleId: 'body',
          parentUnitId: 'preview-heading-1', order: 1, depth: 1, continuityKey: 'body',
          sourceRefIds: [sourceRefIds[0]], sourceSegmentIds: ['preview-segment-2'],
          mapping: {}, payload: { text: 'Confirm the installed configuration before applying the procedure. Keep the part number, operating limit and exception together when reading this section.' },
        },
        {
          unitId: 'preview-heading-2', kind: 'heading', moduleId: 'body',
          parentUnitId: null, order: 2, depth: 0, continuityKey: 'body',
          sourceRefIds: [sourceRefIds[1]], sourceSegmentIds: ['preview-segment-3'],
          mapping: {}, payload: { text: '2. Required checks' },
        },
        {
          unitId: 'preview-table-1', kind: 'table', moduleId: 'body',
          parentUnitId: 'preview-heading-2', order: 3, depth: 1, continuityKey: 'preview-table',
          sourceRefIds: [sourceRefIds[1]], sourceSegmentIds: ['preview-segment-4'],
          mapping: {}, payload: {
            layout: 'grid', columns: [], rowGroups: [{ rows: [
              { rowId: 'preview-row-1', cells: ['Check', 'Limit', 'Evidence'].map((text, index) => ({
                cellId: `preview-cell-${index}`, rowSpan: 1, colSpan: 1,
                inlineContent: [{ text, sourceRefIds: [sourceRefIds[1]] }],
              })) },
              { rowId: 'preview-row-2', cells: ['Configuration', 'Within range', 'Recorded'].map((text, index) => ({
                cellId: `preview-cell-2-${index}`, rowSpan: 1, colSpan: 1,
                inlineContent: [{ text, sourceRefIds: [sourceRefIds[2]] }],
              })) },
            ] }],
          },
        },
        {
          unitId: 'preview-paragraph-2', kind: 'paragraph', moduleId: 'body',
          parentUnitId: null, order: 4, depth: 0, continuityKey: 'body',
          sourceRefIds: [sourceRefIds[2]], sourceSegmentIds: ['preview-segment-5'],
          mapping: {}, payload: { text: 'The reference page is intentionally longer than the viewport so that scrolling, focus and return positioning can be checked.' },
        },
      ],
      sourceLocators: sourceRefIds.map((sourceRefId, index) => ({
        sourceRefId, kind: 'PDF_PAGE', artifactId: 'PREVIEW-ARTIFACT',
        pageStart: index, pageEnd: index, charStart: null, charEnd: null,
        charOffsetUnit: null, normalizedPath: null, xpath: null, elementId: null,
        quote: null, bbox: null,
      })),
      findings: [], references: [],
    },
    locations: sourceRefIds.map((sourceRefId, pageIndex) => ({
      sourceRefId, pageIndex, precision: 'PAGE', coordinateSpace: null,
      viewportWidth: null, viewportHeight: null, boxes: [],
    })),
    coverage: {
      knownPageCount: 4, readPageIndexes: [0, 1, 2], unresolvedRanges: [
        { pageIndexes: [3], unitIds: [], reason: 'UNREAD', message: 'Preview page retained to test a long reading surface.' },
      ],
    },
    markdown: 'Constructed visual preview only.',
  };
}
