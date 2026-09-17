import { buildSuiteDomainGraph, buildSuitePanoramaGraph } from '../../client/src/pages/RelationGraphPage/suite-graph-perspectives';
import type {
  CanonicalLibraryDocumentSummary,
  EngineeringMatterCatalogEntry,
  EngineeringMatterDirectoryResponse,
} from '@shared/api.interface';
import type { SuiteMatterGraphRead } from '../../client/src/pages/RelationGraphPage/suite-matter-graph';

function catalogEntry(documentVersionId: string, code = 'SB-001', role: 'PRIMARY' | 'RELATED' = 'PRIMARY'): EngineeringMatterCatalogEntry {
  return {
    workItemId: `wi-${documentVersionId}`,
    relationRole: role,
    linkedAtWorkItemRevision: 1,
    currentWorkItemRevision: 1,
    workItemChangedSinceLink: false,
    workItemStatus: 'ACTIVE',
    document: {
      documentId: `doc-${documentVersionId}`,
      documentVersionId,
      documentCode: code,
      businessRevision: 'R02',
      normalizedFamily: code,
    },
    documentCurrentness: {
      familyId: `family-${documentVersionId}`,
      currentDocumentVersionId: documentVersionId,
      currentGeneration: 1,
      selectedVersionIsCurrent: true,
    },
    sourceNavigation: { status: 'AVAILABLE', sourceRefCount: 1, structuredContentPath: `/document-versions/${documentVersionId}` },
  };
}

function libraryDocument(documentVersionId: string, ataValue: string | null): CanonicalLibraryDocumentSummary {
  return {
    kind: 'DOCUMENT',
    familyId: `family-${documentVersionId}`,
    documentId: `doc-${documentVersionId}`,
    documentCode: 'SB-001',
    normalizedFamily: 'SB-001',
    issuerAuthority: 'AUTH',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    workItemCount: 1,
    versions: [{
      documentVersionId,
      businessRevision: 'R02',
      revisionDate: '2026-01-01',
      sourceGeneratedDate: '2026-01-01',
      originalFilename: 'sb.pdf',
      byteLength: 10,
      committedAt: '2026-01-01T00:00:00.000Z',
      selectedVersionIsCurrent: true,
      readerWorkItemId: 'wi-reader',
      workItemCount: 1,
      extractedMetadata: ataValue === null ? null : {
        schemaVersion: 'wiselink.document_metadata.v1',
        source: 'ACTUAL_PDF_TEXT',
        sourceSha256: 'sha',
        sourceByteLength: 10,
        pageCount: 1,
        inspectedPages: [0],
        extractedAt: '2026-01-01T00:00:00.000Z',
        title: { status: 'NOT_FOUND', observations: [] },
        documentType: { status: 'NOT_FOUND', observations: [] },
        issuer: { status: 'NOT_FOUND', observations: [] },
        ata: { status: 'PENDING_REVIEW', observations: ataValue ? [{ value: ataValue, status: 'PENDING_REVIEW', evidence: [{ page: 0, text: 'ATA' }] }] : [] },
        mentionedAircraftModels: { status: 'NOT_FOUND', observations: [] },
        aircraftModelSemantics: 'DOCUMENT_MENTION_ONLY',
        applicabilityAssessment: 'NOT_EVALUATED',
      },
    }],
  };
}

function currentMatterRead(): SuiteMatterGraphRead {
  const entry = catalogEntry('dv-current');
  const nodeId = JSON.stringify(['catalog', 'dv-current']);
  return {
    graph: {
      id: 'root',
      title: '当前事项',
      rootKind: 'matter',
      groups: [{ key: 'catalog', title: '目录资料', items: [{ id: nodeId, title: 'SB-001', subtitle: 'R02', kind: 'catalog-document' }] }],
      relations: [],
    },
    targets: new Map([[nodeId, { kind: 'catalog-document', entry }]]),
    relationDetails: new Map(),
    notices: [],
    workRef: null,
    overviewStatus: null,
    missingEvidenceRefs: [],
  };
}

const directory: EngineeringMatterDirectoryResponse = {
  items: [
    {
      matterId: 'matter-current',
      title: '当前事项',
      primaryWorkItemId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      currentMatterRevisionId: 'rev-1',
      workingRevision: 3,
      result: null,
      overallStatus: 'CURRENT',
    },
    {
      matterId: 'matter-other',
      title: '其他事项',
      primaryWorkItemId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      currentMatterRevisionId: 'rev-2',
      workingRevision: 1,
      result: null,
      overallStatus: null,
    },
  ],
  nextCursor: null,
  fileReadPerformed: false,
};

describe('buildSuiteDomainGraph', () => {
  it('groups catalog documents by declared ATA observations and marks every group as pending review', () => {
    const read = buildSuiteDomainGraph({
      matterId: 'matter-a',
      matterTitle: '事项 A',
      catalog: [catalogEntry('dv-1'), catalogEntry('dv-2'), catalogEntry('dv-3')],
      documents: [libraryDocument('dv-1', '32'), libraryDocument('dv-2', '32'), libraryDocument('dv-3', null)],
    });
    expect(read.graph.groups.map((group) => group.key)).toEqual(['ata:32', 'unclassified']);
    expect(read.graph.groups[0].title).toContain('待核');
    expect(read.graph.groups[0].items).toHaveLength(2);
    expect(read.graph.groups[1].title).toBe('未标注领域');
    const ataRelations = read.graph.relations.filter((relation) => relation.type === 'ATA_CLASSIFICATION');
    expect(ataRelations).toHaveLength(3);
    const detail = read.relationDetails.get(ataRelations[0].id);
    expect(detail).toMatchObject({ kind: 'ATA_CLASSIFICATION', value: '32', status: 'PENDING_REVIEW' });
  });

  it('excludes documents outside the authorized library page with an explicit notice and asserts no currentness', () => {
    const read = buildSuiteDomainGraph({
      matterId: 'matter-a',
      matterTitle: '事项 A',
      catalog: [catalogEntry('dv-1'), catalogEntry('dv-missing')],
      documents: [libraryDocument('dv-1', '32')],
    });
    expect(read.graph.groups).toHaveLength(1);
    expect(read.notices.some((notice) => notice.includes('1 份已登记资料不在本次授权目录页返回'))).toBe(true);
    expect(read.graph.relations.every((relation) => relation.type !== 'CURRENTNESS')).toBe(true);
  });
});

describe('buildSuitePanoramaGraph', () => {
  it('lists directory matters as nodes and only the current matter contributes document relations', () => {
    const read = buildSuitePanoramaGraph({
      directory,
      currentMatterId: 'matter-current',
      currentMatter: currentMatterRead(),
    });
    const mattersGroup = read.graph.groups.find((group) => group.key === 'matters');
    expect(mattersGroup?.items).toHaveLength(2);
    const documentRelations = read.graph.relations.filter((relation) => relation.type === 'CATALOG');
    expect(documentRelations).toHaveLength(1);
    expect(documentRelations[0].source).toBe(JSON.stringify(['matter', 'matter-current']));
    expect(read.graph.relations.every((relation) => relation.source !== JSON.stringify(['matter', 'matter-other']) || relation.type === 'DIRECTORY_MEMBERSHIP')).toBe(true);
    const membership = read.graph.relations.find((relation) => relation.type === 'DIRECTORY_MEMBERSHIP');
    expect(read.relationDetails.get(membership!.id)).toMatchObject({ kind: 'DIRECTORY_MEMBERSHIP' });
    expect(read.notices).toContain('全景为当前授权目录页视图，不代表全库。');
  });

  it('notes empty authorized directories instead of fabricating matters', () => {
    const read = buildSuitePanoramaGraph({
      directory: { items: [], nextCursor: null, fileReadPerformed: false },
      currentMatterId: 'matter-current',
      currentMatter: currentMatterRead(),
    });
    expect(read.notices).toContain('当前授权目录页没有事项。');
  });
});

it('never emits dangling document edges when the current matter lies beyond the directory page', () => {
  const read = buildSuitePanoramaGraph({ directory: {...directory, items: directory.items.filter(item => item.matterId !== 'matter-current')}, currentMatterId: 'matter-current', currentMatter: currentMatterRead() });
  const nodes = new Set([read.graph.id, ...read.graph.groups.flatMap(group => group.items.map(item => item.id))]);
  expect(read.graph.relations.filter(edge => !nodes.has(edge.source) || !nodes.has(edge.target))).toEqual([]);
});
