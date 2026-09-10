import {
  catalogGraph,
  documentGraph,
  initialAtlasLocation,
} from '../../client/src/features/atlas/atlas-model';
import {
  readExample,
  exampleEdges,
} from '../../client/src/features/atlas/example-provider';
import { classificationRecords } from '../../client/src/features/atlas/AtlasClassification';
import type {
  CanonicalLibraryDocumentsResponse,
  CanonicalLibraryQuicklookResponse,
  CanonicalRelatedContextPreviewResponse,
  CanonicalReferenceMentionPreviewItem,
} from '@shared/api.interface';
function quicklook(): CanonicalLibraryQuicklookResponse {
  return {
    document: {
      workItemId: 'WI-SB',
      documentVersionId: 'SB-R1',
      documentCode: 'SB',
      businessRevision: 'R1',
      originalFilename: 'SB.pdf',
      familyId: 'SB-family',
      revision: 5,
    },
    result: null,
    fileReadPerformed: false,
  } as CanonicalLibraryQuicklookResponse;
}
function preview(): CanonicalRelatedContextPreviewResponse {
  return {
    revision: 5,
    snapshot: { workItemRef: 'WI-SB' },
    mentions: [
      {
        mentionId: 'mention-1',
        primaryDocumentVersionRef: 'SB-R1',
        permissionState: 'AUTHORIZED',
        citationText: 'FTD R3',
        normalizedIdentity: { documentNumber: 'FTD' },
        targetResolution: {
          status: 'RESOLVED_EXACT',
          workItemId: 'WI-FTD-R3',
          documentVersionId: 'FTD-R3',
          businessRevision: 'R3',
        },
        sourceRefIds: ['source-SB-1'],
        sourceLocators: [],
        matchedText: 'See FTD R3',
      },
    ],
  } as CanonicalRelatedContextPreviewResponse;
}
describe('Atlas exact read projection and isolated source records', () => {
  it('uses the explicitly resolved R3, never a newer R4', () => {
    const graph = documentGraph(quicklook(), preview());
    expect(graph.nodes.find((n) => n.id === 'FTD-R3')?.workItemId).toBe(
      'WI-FTD-R3',
    );
    expect(graph.nodes.some((n) => n.id === 'FTD-R4')).toBe(false);
    expect(graph.edges[0].sourceRefs).toEqual(['source-SB-1']);
  });
  it.each(['DENIED', 'NOT_CHECKED'] as const)(
    'does not make %s target navigable',
    (permission) => {
      const p = preview();
      p.mentions[0].permissionState = permission;
      const g = documentGraph(quicklook(), p);
      expect(g.nodes[1].kind).toBe('reference');
      expect(g.nodes[1].workItemId).toBeUndefined();
    },
  );
  it('keeps unresolved target as source occurrence without a fabricated version', () => {
    const p = preview();
    p.mentions[0].targetResolution = { status: 'DOCUMENT_NOT_INGESTED' };
    const g = documentGraph(quicklook(), p);
    expect(g.nodes[1].documentVersionId).toBeUndefined();
    expect(g.nodes[1].sourceRefs).toEqual(['source-SB-1']);
  });
  it('rejects cross-work-item and version drift', () => {
    const p = preview();
    p.revision = 6;
    expect(() => documentGraph(quicklook(), p)).toThrow('不一致');
    p.revision = 5;
    p.mentions[0].primaryDocumentVersionRef = 'SB-R2';
    expect(() => documentGraph(quicklook(), p)).toThrow('不一致');
  });
  it('preserves separate reference occurrences to the same exact version', () => {
    const p = preview();
    p.mentions.push({
      ...p.mentions[0],
      mentionId: 'mention-2',
      sourceRefIds: ['source-SB-2'],
    } as CanonicalReferenceMentionPreviewItem);
    const g = documentGraph(quicklook(), p);
    expect(g.nodes).toHaveLength(2);
    expect(g.edges).toHaveLength(2);
  });
  it('uses only actual catalog membership without code-based relationships', () => {
    const catalog = {
      items: [
        {
          familyId: 'f1',
          documentCode: 'SB',
          versions: [
            {
              documentVersionId: 'v1',
              readerWorkItemId: 'w1',
              originalFilename: 'SB R1',
              businessRevision: 'R1',
              selectedVersionIsCurrent: false,
            },
            {
              documentVersionId: 'v2',
              readerWorkItemId: 'w2',
              originalFilename: 'SB R2',
              businessRevision: 'R2',
              selectedVersionIsCurrent: true,
            },
          ],
        },
      ],
    } as CanonicalLibraryDocumentsResponse;
    const g = catalogGraph(catalog);
    expect(g.nodes).toHaveLength(3);
    expect(g.edges.every((e) => e.kind === '文档族版本')).toBe(true);
  });
  it('retains complete panorama and exact example version relations', () => {
    expect(
      readExample({
        ...initialAtlasLocation,
        space: 'EXAMPLE',
        view: 'panorama',
      }).nodes.length,
    ).toBeGreaterThan(100);
    const g = readExample({
      ...initialAtlasLocation,
      space: 'EXAMPLE',
      focus: 'sb-r2',
    });
    expect(
      g.edges.some((e) => e.source === 'sb-r2' && e.target === 'ftd-r3'),
    ).toBe(true);
  });
  it('does not merge duplicate raw rows or invent an iSpec 34-61 record', () => {
    const duplicates = classificationRecords.filter((r) => r.code === '45-45');
    expect(duplicates.length).toBeGreaterThanOrEqual(2);
    expect(new Set(duplicates.map((r) => r.identity)).size).toBe(
      duplicates.length,
    );
    expect(
      classificationRecords.filter(
        (r) => r.namespace === 'ispec' && r.code === '34-61',
      ),
    ).toHaveLength(0);
  });
  it('preserves differences in 34-60 and chapter 42 across source namespaces', () => {
    for (const code of ['34-60', '42']) {
      const rows = classificationRecords.filter((r) => r.code === code);
      expect(new Set(rows.map((r) => r.namespace)).size).toBe(2);
      expect(new Set(rows.map((r) => r.titleEN)).size).toBeGreaterThan(1);
    }
  });
  it('expands every family aggregate to actual version-level source edges', () => {
    const network = readExample({
      ...initialAtlasLocation,
      space: 'EXAMPLE',
      view: 'network',
    });
    expect(network.edges.length).toBeGreaterThan(0);
    for (const edge of network.edges) {
      expect(edge.memberEdgeRefs?.length).toBeGreaterThan(0);
      for (const id of edge.memberEdgeRefs ?? [])
        expect(exampleEdges.find((source) => source.id === id)?.kind).toBe(
          'REFERS_TO',
        );
    }
  });
  it('keeps a selected matter distinct from the default FMC matter', () => {
    const graph = readExample({
      ...initialAtlasLocation,
      space: 'EXAMPLE',
      view: 'matter',
      focus: 'mf-b',
    });
    expect(graph.nodes.some((node) => node.id === 'mf-b')).toBe(true);
    expect(graph.nodes.some((node) => node.id === 'mf-a')).toBe(false);
  });
  it('does not lose limiting evidence when drilling into the evidence view', () => {
    const graph = readExample({
      ...initialAtlasLocation,
      space: 'EXAMPLE',
      view: 'evidence',
      focus: 'mf-a',
    });
    expect(graph.edges.some((edge) => edge.kind === 'LIMITS')).toBe(true);
    expect(
      graph.edges.every(
        (edge) =>
          graph.nodes.some((node) => node.id === edge.source) &&
          graph.nodes.some((node) => node.id === edge.target),
      ),
    ).toBe(true);
  });
});
