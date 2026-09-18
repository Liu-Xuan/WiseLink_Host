import type {
  CanonicalLibraryDocumentSummary,
  EngineeringMatterCatalogEntry,
  EngineeringMatterDirectoryResponse,
} from '@shared/api.interface';
import type { SuiteGraphGroup, SuiteGraphRelation } from './suite-graph-model';
import type {
  SuiteMatterGraphRead,
  SuiteMatterGraphTarget,
  SuiteRelationDetail,
} from './suite-matter-graph';

const identity = (...parts: string[]) => JSON.stringify(parts);

/**
 * Domain focus: the matter's registered catalog documents grouped by their declared
 * ATA observations. ATA metadata is PENDING_REVIEW / DOCUMENT_MENTION_ONLY; groups
 * are display groups marked 待核, never formal applicability or system membership.
 * Documents outside the authorized library page stay out with an explicit notice.
 */
export function buildSuiteDomainGraph(input: {
  matterId: string;
  matterTitle: string;
  catalog: EngineeringMatterCatalogEntry[];
  documents: CanonicalLibraryDocumentSummary[];
}): SuiteMatterGraphRead {
  const root = identity('domain', input.matterId);
  const targets = new Map<string, SuiteMatterGraphTarget>();
  const relationDetails = new Map<string, SuiteRelationDetail>();
  const relations: SuiteGraphRelation[] = [];
  const groups = new Map<string, SuiteGraphGroup>();
  const notices: string[] = [];
  targets.set(root, { kind: 'root' });
  const metadataByVersion = new Map<string, CanonicalLibraryDocumentSummary['versions'][number]>();
  for (const document of input.documents) {
    for (const version of document.versions) metadataByVersion.set(version.documentVersionId, version);
  }
  let missing = 0;
  for (const entry of input.catalog) {
    const documentVersionId = entry.document.documentVersionId;
    const nodeId = identity('catalog', documentVersionId);
    if (targets.has(nodeId)) continue;
    const version = metadataByVersion.get(documentVersionId);
    if (!version) {
      missing += 1;
      continue;
    }
    const ata = version.extractedMetadata?.ata;
    const value = ata && ata.observations.length > 0 ? ata.observations[0].value : null;
    const groupKey = value ? `ata:${value}` : 'unclassified';
    const groupTitle = value ? `ATA ${value} · 资料标注待核` : '未标注领域';
    let group = groups.get(groupKey);
    if (!group) {
      group = { key: groupKey, title: groupTitle, items: [] };
      groups.set(groupKey, group);
    }
    targets.set(nodeId, { kind: 'catalog-document', entry });
    group.items.push({
      id: nodeId,
      title: entry.document.documentCode,
      subtitle: `${entry.document.businessRevision} · ${value ? '资料标注 · 待核' : '资料标注未提供'}`,
      kind: 'catalog-document',
    });
    const relationId = identity('ata-classification', documentVersionId);
    relations.push({
      id: relationId,
      source: root,
      target: nodeId,
      type: 'ATA_CLASSIFICATION',
      label: 'ATA 标注 · 待核',
    });
    relationDetails.set(relationId, {
      kind: 'ATA_CLASSIFICATION',
      value: value ?? '未标注',
      status: ata?.status ?? 'NOT_FOUND',
    });
  }
  if (missing > 0) notices.push(`${missing} 份已登记资料不在本次授权目录页返回，未参与领域分组。`);
  if (input.catalog.length > 0 && groups.size === 0 && missing === 0) {
    notices.push('已登记资料均未被当前授权目录读取返回。');
  }
  return {
    graph: { id: root, title: input.matterTitle, rootKind: 'matter', groups: [...groups.values()], relations },
    targets,
    relationDetails,
    notices,
    workRef: null,
    overviewStatus: null,
    missingEvidenceRefs: [],
  };
}

/**
 * Panorama: the current authorized matter directory page. Matter nodes come from the
 * directory response; only the currently open matter contributes its already-loaded,
 * authorized document relations. No edges are inferred between other matters and
 * documents. The hub is a display node, not an engineering entity.
 */
export function buildSuitePanoramaGraph(input: {
  directory: Pick<EngineeringMatterDirectoryResponse, 'items' | 'nextCursor'> & Partial<EngineeringMatterDirectoryResponse>;
  currentMatterId: string;
  currentMatter: SuiteMatterGraphRead;
}): SuiteMatterGraphRead {
  const root = identity('panorama', input.currentMatterId);
  const targets = new Map<string, SuiteMatterGraphTarget>();
  const relationDetails = new Map<string, SuiteRelationDetail>();
  const relations: SuiteGraphRelation[] = [];
  const groups: SuiteGraphGroup[] = [];
  const notices: string[] = ['全景为当前授权目录页视图，不代表全库。'];
  const matterItems = input.directory.items.map((item) => {
    const nodeId = identity('matter', item.matterId);
    targets.set(nodeId, { kind: 'matter-node', matterId: item.matterId, title: item.title, status: item.overallStatus ?? null });
    const relationId = identity('directory-membership', item.matterId);
    relations.push({
      id: relationId,
      source: root,
      target: nodeId,
      type: 'DIRECTORY_MEMBERSHIP',
      label: '目录登记',
    });
    relationDetails.set(relationId, { kind: 'DIRECTORY_MEMBERSHIP', matterId: item.matterId });
    return {
      id: nodeId,
      title: item.title,
      subtitle: item.matterId === input.currentMatterId ? `当前事项 · 工作修订 ${item.workingRevision}` : `工作修订 ${item.workingRevision}`,
      kind: 'matter-node',
    };
  });
  if (matterItems.length > 0) groups.push({ key: 'matters', title: '目录事项', items: matterItems, columns: 2 });
  const currentMatterNodeId = identity('matter', input.currentMatterId);
  if (!targets.has(currentMatterNodeId)) {
    // The current workspace is separately authorized; it need not be in this directory page.
    targets.set(currentMatterNodeId, { kind: 'matter-node', matterId: input.currentMatterId, title: input.currentMatter.graph.title, status: input.currentMatter.overviewStatus });
    const group = groups.find(item => item.key === 'matters') ?? { key: 'matters', title: '目录事项', items: [], columns: 2 };
    if (!groups.includes(group)) groups.push(group);
    group.items.push({id: currentMatterNodeId, title: input.currentMatter.graph.title, subtitle: '当前已授权事项 · 不在本批目录', kind: 'matter-node'});
    notices.push('当前事项按已读取工作单独保留，不代表其在本批目录中。');
  }

  const itemById = new Map(input.currentMatter.graph.groups.flatMap((group) => group.items.map((item) => [item.id, item])));
  const documentItems: SuiteGraphGroup['items'] = [];
  for (const [nodeId, target] of input.currentMatter.targets) {
    const isDocument =
      target.kind === 'material' || target.kind === 'document' || target.kind === 'catalog-document';
    if (!isDocument) continue;
    const item = itemById.get(nodeId);
    if (!item) continue;
    documentItems.push({ ...item });
    targets.set(nodeId, target);
    const relationId = identity('panorama-document', input.currentMatterId, nodeId);
    const label =
      target.kind === 'material'
        ? target.material.kind === 'EXPECTED'
          ? '预计资料'
          : target.material.kind === 'MEMBER'
            ? '事项资料'
            : '参考资料'
        : target.kind === 'catalog-document'
          ? target.entry.relationRole === 'PRIMARY'
            ? '主要资料'
            : '关联资料'
          : '已取得资料';
    relations.push({ id: relationId, source: currentMatterNodeId, target: nodeId, type: target.kind === 'material' ? 'MATERIAL_LINK' : target.kind === 'catalog-document' ? 'CATALOG' : 'FULFILLED_BY', label });
    if (target.kind === 'material') relationDetails.set(relationId, target.material);
    else if (target.kind === 'catalog-document') relationDetails.set(relationId, { kind: 'CATALOG', entry: target.entry });
  }
  if (documentItems.length > 0) groups.push({ key: 'documents', title: '当前事项资料', items: documentItems });
  if (input.directory.items.length === 0) notices.push('当前授权目录页没有事项。');
  if (input.directory.nextCursor) notices.push('目录还有更多事项未加载。');
  return {
    graph: { id: root, title: '工程资料全景', rootKind: 'display', groups, relations },
    targets,
    relationDetails,
    notices,
    workRef: null,
    overviewStatus: null,
    missingEvidenceRefs: [],
  };
}
