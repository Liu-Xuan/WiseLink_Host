import type { AtlasGraph, AtlasNode, AtlasEdge } from '@client/src/features/atlas/atlas-model';
import type { CanonicalLibraryDocumentSummary, CanonicalLibraryDocumentVersionSummary } from '@shared/api.interface';
import { ataDirectoryCode, ataDirectoryLabel } from '../WorkspaceHomePage/library-ata-directory';
import type { LibraryMacroRead } from './library-macro-read';

export type MacroTarget =
  | { kind: 'classification'; title: string; raw: string[] }
  | { kind: 'family'; familyId: string; title: string }
  | { kind: 'version'; documentVersionId: string; familyId: string; readerWorkItemId?: string; title: string; version: string; current: boolean; ata: string[] }
  | { kind: 'matter'; matterId: string; title: string; revision: number }
  | { kind: 'relation'; title: string; explanation: string; source: string; target: string };
export const macroFamilyId = (id: string) => `library:family:${id}`;
export const macroVersionId = (id: string) => `library:version:${id}`;
export const macroMatterId = (id: string) => `library:matter:${id}`;
export const LIBRARY_MACRO_NODE_LIMIT = 1024;
const clusterId = (value: string | null) => `library:cluster:${JSON.stringify(value)}`;
const ataValues = (version: CanonicalLibraryDocumentVersionSummary) => [...new Set(version.extractedMetadata?.ata.observations.map(observation => observation.value) ?? [])];

/** Display projection only. Classification is tied to its observing version;
 * family membership and registered material links never become citation edges. */
export function buildLibraryMacroGraph(read: LibraryMacroRead, groupBy: 'ata' | 'normalizedFamily', filtered: boolean) {
  const nodes = new Map<string, AtlasNode>(), edges = new Map<string, AtlasEdge>(), targets = new Map<string, MacroTarget>();
  const addNode = (node: AtlasNode, target: MacroTarget) => {
    nodes.set(node.id, node); targets.set(node.id, target);
    if (nodes.size > LIBRARY_MACRO_NODE_LIMIT) throw new Error('当前范围超过 1024 个图谱节点，请用筛选缩小范围后查看。');
  };
  const edge = (source: string, target: string, kind: string, title: string, explanation: string) => {
    const id = `library:edge:${JSON.stringify([source, target, kind])}`;
    edges.set(id, { id, source, target, kind, explanation, sourceRefs: [] });
    targets.set(id, { kind: 'relation', title, explanation, source, target });
  };
  const classification = (id: string, title: string, raw: string) => {
    if (!nodes.has(id)) addNode({ id, kind: 'classification', title, code: title, sourceRefs: [] }, { kind: 'classification', title, raw: [] });
    const target = targets.get(id);
    if (target?.kind === 'classification' && !target.raw.includes(raw)) target.raw.push(raw);
    return id;
  };
  const addDocument = (document: CanonicalLibraryDocumentSummary) => {
    const familyId = macroFamilyId(document.familyId);
    addNode({ id: familyId, kind: 'family', title: document.documentCode, code: document.documentCode, familyId: document.familyId, sourceRefs: [] },
      { kind: 'family', familyId: document.familyId, title: document.documentCode });
    for (const version of document.versions) {
      const id = macroVersionId(version.documentVersionId), rawValues = ataValues(version);
      addNode({ id, kind: 'document', title: version.originalFilename, code: document.documentCode, version: version.businessRevision,
        documentVersionId: version.documentVersionId, workItemId: version.readerWorkItemId || undefined, familyId: document.familyId, sourceRefs: [] },
      { kind: 'version', title: version.originalFilename, documentVersionId: version.documentVersionId, familyId: document.familyId,
        readerWorkItemId: version.readerWorkItemId || undefined, version: version.businessRevision, current: version.selectedVersionIsCurrent, ata: rawValues });
      edge(familyId, id, 'HAS_VERSION', '文档族版本', 'Host 文档族所登记的准确版本。');
      if (groupBy === 'normalizedFamily') {
        const raw = document.normalizedFamily, category = classification(clusterId(raw || null), raw || '未分类资料', raw);
        edge(category, familyId, 'CLASSIFIED_AS', '资料类别', 'Host 登记的资料类别。');
        continue;
      }
      for (const raw of rawValues.length ? rawValues : [null]) {
        const code = raw === null ? null : ataDirectoryCode(raw);
        if (code) {
          const parent = classification(`library:ata2:${code.ata2}`, ataDirectoryLabel(code.ata2), raw!);
          const leaf = code.ata4 ? classification(`library:ata4:${code.ata4}`, ataDirectoryLabel(code.ata4), raw!) : parent;
          if (leaf !== parent) edge(parent, leaf, 'ATA_SUBCHAPTER', 'ATA 子章节', '现有 ATA 字典的父子分类。');
          edge(leaf, id, 'CLASSIFIED_AS', '原文 ATA 标注', `此准确版本的原始 ATA 标注：${raw}。`);
        } else {
          const title = raw === null ? '未取得 ATA 标注' : `原始 ATA ${raw || '空值'}`;
          const leaf = classification(clusterId(raw), title, raw ?? '__UNKNOWN__');
          edge(leaf, id, 'CLASSIFIED_AS', '原文 ATA 标注', raw === null ? '该版本尚无已读回 ATA 观察。' : `原值 ${raw || '空值'} 保留；标点含义未核定。`);
        }
      }
    }
  };
  read.documents.forEach(addDocument);
  if (read.familyVersions) {
    const { familyId, versions } = read.familyVersions, id = macroFamilyId(familyId);
    addNode({ id, kind: 'family', title: '所选文档族', code: familyId, familyId, sourceRefs: [] }, { kind: 'family', familyId, title: '所选文档族' });
    for (const version of versions) {
      const versionId = macroVersionId(version.documentVersionId);
      addNode({ id: versionId, kind: 'document', title: version.businessRevision, code: version.businessRevision, documentVersionId: version.documentVersionId, familyId, workItemId: version.readerWorkItemId, sourceRefs: [] },
        { kind: 'version', title: version.businessRevision, documentVersionId: version.documentVersionId, familyId, readerWorkItemId: version.readerWorkItemId, version: version.businessRevision, current: version.isCurrent, ata: [] });
      edge(id, versionId, 'HAS_VERSION', '文档族版本', 'Host 文档族所登记的准确版本；此旧深链未读取 ATA 元数据。');
    }
  }
  let outsideLinks = 0;
  for (const matter of read.matters) {
    const links = matter.materials !== undefined
      ? matter.materials.flatMap(material => material.disposition === 'INCLUDED' && material.kind !== 'EXPECTED'
        ? [{ documentVersionId: material.documentVersionId, familyId: material.familyId, role: material.kind }] : [])
      : matter.catalog.entries.map(entry => ({ documentVersionId: entry.document.documentVersionId, familyId: entry.documentCurrentness.familyId, role: 'LEGACY_WORK_ITEM' }));
    const visible = links.filter(link => {
      const target = targets.get(macroVersionId(link.documentVersionId));
      return target?.kind === 'version' && target.familyId === link.familyId;
    });
    // In a filtered graph, unrelated matters stay outside that scope. A full
    // overview retains authorized isolated matters without inventing an edge.
    if (filtered && !visible.length) continue;
    const id = macroMatterId(matter.matterId);
    addNode({ id, kind: 'matter', title: matter.title, code: matter.title, sourceRefs: [] },
      { kind: 'matter', title: matter.title, matterId: matter.matterId, revision: matter.currentRevision.revisionNo });
    outsideLinks += links.length - visible.length;
    visible.forEach(link => edge(id, macroVersionId(link.documentVersionId), link.role === 'RELATED' ? 'RELATED_MATERIAL' : link.role === 'LEGACY_WORK_ITEM' ? 'WORK_ITEM_MEMBERSHIP' : 'MATTER_MATERIAL',
      link.role === 'RELATED' ? '登记相关资料' : link.role === 'LEGACY_WORK_ITEM' ? '登记工作关联' : '事项资料', link.role === 'LEGACY_WORK_ITEM' ? 'Host 已登记工作关联的准确版本。' : 'Host 当前事项修订中 INCLUDED 的准确来源版本。'));
  }
  const graph: AtlasGraph = { nodes: [...nodes.values()], edges: [...edges.values()], notices: [] };
  return { graph, targets, outsideLinks, counts: {
    classifications: graph.nodes.filter(node => node.kind === 'classification').length,
    families: graph.nodes.filter(node => node.kind === 'family').length,
    versions: graph.nodes.filter(node => node.kind === 'document').length,
    matters: graph.nodes.filter(node => node.kind === 'matter').length,
    materials: graph.edges.filter(item => ['MATTER_MATERIAL', 'RELATED_MATERIAL', 'WORK_ITEM_MEMBERSHIP'].includes(item.kind)).length,
  } };
}
