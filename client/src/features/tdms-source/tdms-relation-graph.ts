import type { ElementDefinition } from 'cytoscape';
import type {
  TdmsExactEndpoint,
  TdmsRecordSummary,
  TdmsRelationAssertion,
  TdmsRelationReadResponse,
} from '@shared/tdms-source.interface';
import { tdmsSourceVersionLabel } from './tdms-source-presentation';

export interface TdmsRelationGraphNode {
  id: string;
  label: string;
  kind:
    | 'TDMS_NATIVE_RECORD_REVISION'
    | 'TDMS_DOCUMENT_VERSION'
    | 'TDMS_UNRESOLVED';
  endpoint: TdmsExactEndpoint;
}

export interface TdmsRelationGraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  tdmsAuthority: TdmsRelationAssertion['authority'];
  assertionRef: string;
}

export interface TdmsRelationGraphProjection {
  elements: ElementDefinition[];
  nodes: TdmsRelationGraphNode[];
  edges: TdmsRelationGraphEdge[];
  assertions: TdmsRelationAssertion[];
}

/** Exact Host identities only. An unresolved source identity is local to its assertion, never a name join. */
export function tdmsGraphEndpointId(
  endpoint: TdmsExactEndpoint,
  assertionRef = '',
  side = '',
): string {
  if (endpoint.kind === 'NATIVE_RECORD_REVISION')
    return JSON.stringify([endpoint.kind, endpoint.sourceRevisionRef]);
  if (endpoint.kind === 'DOCUMENT_VERSION')
    return JSON.stringify([endpoint.kind, endpoint.documentVersionId]);
  return JSON.stringify([endpoint.kind, assertionRef, side]);
}

export function tdmsGraphEndpointLabel(endpoint: TdmsExactEndpoint): string {
  if (endpoint.kind === 'NATIVE_RECORD_REVISION')
    return `准确来源修订 ${endpoint.sourceRevisionRef}`;
  if (endpoint.kind === 'DOCUMENT_VERSION')
    return `准确文档版本 ${endpoint.documentVersionId}`;
  return `端点未解析 ${endpoint.rawIdentity}`;
}

/** This is a read projection of the authorized response, not another relationship store. */
export function buildTdmsRelationGraph(
  reading: TdmsRelationReadResponse,
  rootRecord?: TdmsRecordSummary,
): TdmsRelationGraphProjection {
  const empty: TdmsRelationGraphProjection = {
    elements: [],
    nodes: [],
    edges: [],
    assertions: [],
  };
  if (
    !reading.receipt.readPerformed ||
    reading.receipt.purpose !== 'WIKI_NATIVE_RELATIONS' ||
    reading.receipt.sourceRevisionRef !== reading.sourceRevisionRef
  )
    return empty;

  const root: TdmsExactEndpoint = {
    kind: 'NATIVE_RECORD_REVISION',
    sourceRevisionRef: reading.sourceRevisionRef,
  };
  const rootId = tdmsGraphEndpointId(root);
  const nodes = new Map<string, TdmsRelationGraphNode>();
  const edges: TdmsRelationGraphEdge[] = [];
  const assertions: TdmsRelationAssertion[] = [];
  const seenAssertions = new Set<string>();
  function addNode(
    endpoint: TdmsExactEndpoint,
    assertionRef = '',
    side = '',
  ): string {
    const id = tdmsGraphEndpointId(endpoint, assertionRef, side);
    if (!nodes.has(id)) {
      const matchesRoot =
        id === rootId &&
        rootRecord?.sourceRevisionRef === reading.sourceRevisionRef;
      const label = matchesRoot
        ? `${rootRecord.title || rootRecord.sourceRecordId}\n${tdmsSourceVersionLabel(rootRecord.sourceVersion)}\n业务版次：${rootRecord.businessVersion ? tdmsSourceVersionLabel(rootRecord.businessVersion, '业务文件') : '未取得，不从技术对象版次推算'}\n${reading.sourceRevisionRef}`
        : tdmsGraphEndpointLabel(endpoint);
      const kind =
        endpoint.kind === 'NATIVE_RECORD_REVISION'
          ? 'TDMS_NATIVE_RECORD_REVISION'
          : endpoint.kind === 'DOCUMENT_VERSION'
            ? 'TDMS_DOCUMENT_VERSION'
            : 'TDMS_UNRESOLVED';
      nodes.set(id, { id, label, kind, endpoint });
    }
    return id;
  }
  addNode(root);
  for (const assertion of reading.relations) {
    if (seenAssertions.has(assertion.assertionRef)) continue;
    // A malformed/disconnected result cannot expose another neighborhood or its count.
    if (
      ![assertion.from, assertion.to].some(
        (endpoint) =>
          endpoint.kind === 'NATIVE_RECORD_REVISION' &&
          endpoint.sourceRevisionRef === reading.sourceRevisionRef,
      )
    )
      continue;
    seenAssertions.add(assertion.assertionRef);
    const source = addNode(assertion.from, assertion.assertionRef, 'from');
    const target = addNode(assertion.to, assertion.assertionRef, 'to');
    edges.push({
      id: JSON.stringify(['TDMS_ASSERTION', assertion.assertionRef]),
      source,
      target,
      label: `${assertion.rawKind}\n${assertion.authority === 'SOURCE_EXPLICIT' ? '源明确关系' : '候选关系，未核实'}`,
      tdmsAuthority: assertion.authority,
      assertionRef: assertion.assertionRef,
    });
    assertions.push(assertion);
  }
  const nodeList = [...nodes.values()];
  return {
    nodes: nodeList,
    edges,
    assertions,
    elements: [
      ...nodeList.map((data) => ({ group: 'nodes' as const, data })),
      ...edges.map((data) => ({ group: 'edges' as const, data })),
    ],
  };
}
