import type { SuiteMatterGraphRead, SuiteMatterGraphTarget } from './suite-matter-graph';

function isDocumentTarget(target: SuiteMatterGraphTarget): boolean {
  return target.kind === 'material' || target.kind === 'document' || target.kind === 'input' ||
    target.kind === 'catalog-document' || target.kind === 'statement' ||
    (target.kind === 'evidence' && (target.evidence.kind === 'DOCUMENT_PASSAGE' || target.evidence.kind === 'ENGINEER_ATTACHMENT'));
}

/** Same authorized matter/work scope; no new relationships are inferred from shared versions. */
export function suiteDocumentPerspective(read: SuiteMatterGraphRead): SuiteMatterGraphRead {
  const targets = new Map([...read.targets].filter(([, target]) => isDocumentTarget(target)));
  const groups = read.graph.groups.map(group => ({...group, items: group.items.filter(item => targets.has(item.id))})).filter(group => group.items.length);
  const relations = read.graph.relations.filter(edge => (edge.source === read.graph.id || targets.has(edge.source)) && (edge.target === read.graph.id || targets.has(edge.target)));
  const ids = new Set(relations.map(edge => edge.id));
  return {
    ...read,
    graph: {...read.graph, groups, relations},
    targets,
    relationDetails: new Map([...read.relationDetails].filter(([id]) => ids.has(id))),
    notices: [...read.notices, '工程文档视角仅包含本事项及所选工作已获授权的资料、预计记录和原文依据，不代表全库。'],
  };
}
