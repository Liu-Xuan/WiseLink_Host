import { documentGraph } from '@client/src/features/atlas/atlas-model';
import type { MatterDocumentSource } from '@client/src/features/matter/matter-document-sources';
import type { CanonicalLibraryWorkItemSummary, CanonicalReferenceMentionPreviewItem, EngineeringMatterDirectoryResponse } from '@shared/api.interface';
import type { SuiteGraphMatter, SuiteGraphGroup, SuiteGraphRelation } from './suite-graph-model';
import type { DocumentNeighborhoodRead, DocumentReferenceRead } from './document-neighborhood-read';

export type DocumentNeighborhoodTarget =
  | { kind: 'document'; documentVersionId: string; readerWorkItemId?: string; title: string; businessRevision: string; candidate: boolean }
  | { kind: 'family'; familyId: string }
  | { kind: 'mention'; mention: CanonicalReferenceMentionPreviewItem; receipt: DocumentReferenceRead['receipt'] }
  | { kind: 'matter'; matter: EngineeringMatterDirectoryResponse['items'][number] };
export interface DocumentNeighborhoodProjection {
  graph: SuiteGraphMatter;
  targets: Map<string, DocumentNeighborhoodTarget>;
  relations: Map<string, { label: string; mention?: CanonicalReferenceMentionPreviewItem; receipt?: DocumentReferenceRead['receipt'] }>;
  sources: MatterDocumentSource[];
}
export const documentNeighborhoodNodeId = (documentVersionId: string) => JSON.stringify(['document', documentVersionId]);

/** True family membership, exact WorkItem membership, and source occurrences are distinct edges. */
export function buildDocumentNeighborhood(read: DocumentNeighborhoodRead): DocumentNeighborhoodProjection {
  const document = read.document;
  const root = documentNeighborhoodNodeId(document.documentVersionId);
  const atlasCenter = read.quicklook ? documentGraph(read.quicklook, null).nodes[0] : null;
  const title = document.documentTitle || atlasCenter?.title || document.originalFilename || document.documentCode;
  const targets = new Map<string, DocumentNeighborhoodTarget>([[root, { kind: 'document',
    documentVersionId: document.documentVersionId, readerWorkItemId: read.quicklook?.document.workItemId,
    title, businessRevision: document.businessRevision, candidate: false }]]);
  const groups = new Map<string, SuiteGraphGroup>();
  const relations = new Map<string, {label: string; mention?: CanonicalReferenceMentionPreviewItem; receipt?: DocumentReferenceRead['receipt']}>();
  const edges: SuiteGraphRelation[] = [];
  const sources = new Map<string, MatterDocumentSource>([[document.documentVersionId, {
    document: { documentVersionId: document.documentVersionId, documentCode: document.documentCode,
      businessRevision: document.businessRevision }, familyId: document.familyId,
  }]]);
  const add = (group: string, heading: string, id: string, label: string, subtitle: string, target: DocumentNeighborhoodTarget) => {
    if (targets.has(id)) return;
    const bucket = groups.get(group) ?? { key: group, title: heading, items: [] };
    bucket.items.push({ id, title: label, subtitle, kind: target.kind === 'mention' ? 'evidence' : target.kind });
    groups.set(group, bucket); targets.set(id, target);
  };
  const edge = (id: string, source: string, target: string, type: string, label: string,
    authority: SuiteGraphRelation['authority'], mention?: CanonicalReferenceMentionPreviewItem) => {
    edges.push({ id, source, target, type, label, authority, currentness: 'UNKNOWN' });
    relations.set(id, { label, ...(mention ? { mention, receipt: read.references?.receipt } : {}) });
  };
  const familyId = JSON.stringify(['family', document.familyId]);
  add('versions', '文档族与版本', familyId, document.documentCode, 'Host 已登记文档族', { kind: 'family', familyId: document.familyId });
  edge(JSON.stringify(['version', document.documentVersionId]), familyId, root, 'HAS_VERSION', '文档族版本', 'HOST_RECORDED');
  const addVersion = (item: CanonicalLibraryWorkItemSummary) => {
    const id = documentNeighborhoodNodeId(item.documentVersionId);
    add('versions', '文档族与版本', id, item.documentCode, `${item.businessRevision} · ${item.selectedVersionIsCurrent ? '库内当前版本' : '库内历史版本'}`, {
      kind: 'document', documentVersionId: item.documentVersionId, readerWorkItemId: item.workItemId,
      title: item.originalFilename || item.documentCode, businessRevision: item.businessRevision, candidate: false,
    });
    if (!sources.has(item.documentVersionId)) {
      sources.set(item.documentVersionId, { document: item, familyId: item.familyId });
      edge(JSON.stringify(['version', item.documentVersionId]), familyId, id, 'HAS_VERSION', '文档族版本', 'HOST_RECORDED');
    }
  };
  read.family?.items.forEach(addVersion);
  for (const matter of read.matters?.items ?? []) {
    const id = JSON.stringify(['matter', matter.matterId]);
    add('matters', '此工作登记的事项', id, matter.title, '当前登记关系；保存认识按工作读取', { kind: 'matter', matter });
    edge(JSON.stringify(['member', matter.matterId, read.quicklook?.document.workItemId]), id, root,
      'WORK_ITEM_MEMBERSHIP', '此阅读工作登记资料', 'HOST_RECORDED');
  }
  for (const mention of read.references?.mentions ?? []) {
    const occurrence = JSON.stringify(['mention', read.references!.receipt.snapshotRef, mention.mentionId]);
    add('references', '正文引用出现位置', occurrence, mention.citationText, '来源明确提及；目标版次待核',
      { kind: 'mention', mention, receipt: read.references!.receipt });
    edge(JSON.stringify(['occurrence', mention.mentionId]), root, occurrence, 'REFERENCE_OCCURRENCE',
      '正文引用出现位置', 'SOURCE_EXPLICIT', mention);
    const resolution = mention.targetResolution;
    if (resolution.status !== 'RESOLVED_EXACT' || mention.permissionState !== 'AUTHORIZED') continue;
    const id = documentNeighborhoodNodeId(resolution.documentVersionId);
    add('candidates', '文号匹配候选 · 版次待核', id, resolution.canonicalDocumentNumber,
      `${resolution.businessRevision ?? '版次未返回'} · 被引版次尚未核实`, { kind: 'document',
        documentVersionId: resolution.documentVersionId, readerWorkItemId: resolution.workItemId,
        title: resolution.canonicalDocumentNumber, businessRevision: resolution.businessRevision ?? '', candidate: true });
    edge(JSON.stringify(['resolution', mention.mentionId]), occurrence, id, 'REFERENCE_RESOLUTION_CANDIDATE',
      'Host 文号匹配候选；被引版次未核实', 'CANDIDATE_ONLY', mention);
    if (!sources.has(resolution.documentVersionId)) sources.set(resolution.documentVersionId, {
      document: { documentVersionId: resolution.documentVersionId, documentCode: resolution.canonicalDocumentNumber,
        businessRevision: resolution.businessRevision ?? undefined },
    });
  }
  return { graph: { id: root, title, code: `${document.documentCode} · ${document.businessRevision}`,
    rootKind: 'document', groups: [...groups.values()], relations: edges }, targets, relations, sources: [...sources.values()] };
}
