import type {
  TdmsExactEndpoint,
  TdmsRecordSummary,
  TdmsRelationAssertion,
  TdmsRelationReadResponse,
} from '@shared/tdms-source.interface';
import { tdmsGraphEndpointId } from '@client/src/features/tdms-source/tdms-relation-graph';
import { tdmsRawCodeLabel, tdmsRecordKindLabel, tdmsSourceVersionLabel } from '@client/src/features/tdms-source/tdms-source-presentation';
import type { SuiteGraphRelation } from './suite-graph-model';
import type { SuiteMatterGraphRead, SuiteMatterGraphTarget, SuiteTdmsRelationDetail } from './suite-matter-graph';

export interface SuiteTdmsSourceProjectionInput {
  /** Already authorized metadata from the current read resource; never a source of matter membership by itself. */
  records: readonly TdmsRecordSummary[];
  relations: readonly TdmsRelationReadResponse[];
  includeCandidates?: boolean;
  includeHistoricalAssertions?: boolean;
}

const identity = (...parts: string[]) => JSON.stringify(parts);
const nativeId = (ref: string) => tdmsGraphEndpointId({ kind: 'NATIVE_RECORD_REVISION', sourceRevisionRef: ref });
const nonempty = (value: string | null | undefined): value is string => typeof value === 'string' && value.trim().length > 0;

/** Explicit allowlist: passing a full revision must not copy opinions/raw fields/artifacts into graph metadata. */
function metadata(record: TdmsRecordSummary): TdmsRecordSummary {
  return {
    recordRef: record.recordRef, sourceRevisionRef: record.sourceRevisionRef,
    recordKind: record.recordKind, sourceRecordId: record.sourceRecordId,
    sourceKey: record.sourceKey, sourceInstanceId: record.sourceInstanceId,
    title: record.title, fileType: record.fileType, sourceVersion: record.sourceVersion,
    ...(record.businessVersion === undefined ? {} : { businessVersion: record.businessVersion }),
    state: record.state, authors: record.authors, observedAt: record.observedAt,
    capturedAt: record.capturedAt, coverage: record.coverage,
    relatedDocumentVersionIds: [...record.relatedDocumentVersionIds],
    fieldSelectors: record.fieldSelectors, sourceVerification: record.sourceVerification,
    currentness: record.currentness,
  };
}

/** The source kind/status is not evidence of currentness, approval correctness, or execution. */
function currentness(assertion: TdmsRelationAssertion): SuiteGraphRelation['currentness'] {
  return assertion.selectedHead === true ? 'SELECTED_HOST_OBSERVATION'
    : assertion.selectedHead === false ? 'HISTORICAL_HOST_OBSERVATION' : 'UNKNOWN';
}

function endpointValid(endpoint: TdmsExactEndpoint): boolean {
  return endpoint.kind === 'NATIVE_RECORD_REVISION' ? nonempty(endpoint.sourceRevisionRef)
    : endpoint.kind === 'DOCUMENT_VERSION' ? nonempty(endpoint.documentVersionId)
      : endpoint.kind === 'UNRESOLVED' && nonempty(endpoint.rawIdentity);
}

function documentVersion(target: SuiteMatterGraphTarget): string | null {
  if (target.kind === 'material') return target.material.kind === 'EXPECTED' ? null : target.material.documentVersionId;
  if (target.kind === 'document') return target.documentVersionId;
  if (target.kind === 'catalog-document') return target.entry.document.documentVersionId;
  if (target.kind === 'input') return target.binding.documentVersionId;
  if (target.kind === 'evidence' && (target.evidence.kind === 'DOCUMENT_PASSAGE' || target.evidence.kind === 'ENGINEER_ATTACHMENT')) return target.evidence.documentVersionId;
  return null;
}

/**
 * Pure data seam for the EXISTING Suite graph. No fetch/cache/model, current-head
 * lookup, DOM, renderer, timeline synthesis, navigation or permission grant.
 * Call with a fresh, currently authorized base read and matching resource results.
 * A receipt records a past authorized read; it cannot replace current authorization.
 */
export function appendSuiteTdmsSources(read: SuiteMatterGraphRead, input: SuiteTdmsSourceProjectionInput): SuiteMatterGraphRead {
  if ([...read.targets.values()].some(target => target.kind === 'tdms-record' || target.kind === 'tdms-unresolved')) {
    throw new Error('TDMS 投影须从当前已授权的原图重新生成，不能叠加旧投影。');
  }
  const targets = new Map(read.targets);
  const tdmsRelationDetails = new Map<string, SuiteTdmsRelationDetail>();
  const groups = read.graph.groups.map(group => ({ ...group, items: [...group.items] }));
  const relations = [...read.graph.relations];
  const notices = new Set(read.notices);
  const records = new Map<string, TdmsRecordSummary>();
  const documentNodes = new Map<string, string>();
  // Only actual graph nodes count. A detached target-map entry does not establish relevance.
  const baseIds = new Set(read.graph.groups.flatMap(group => group.items.map(item => item.id)));
  for (const [id, target] of read.targets) {
    if (!baseIds.has(id)) continue;
    const version = documentVersion(target);
    if (version && !documentNodes.has(version)) documentNodes.set(version, id);
  }
  for (const record of input.records) {
    if (!nonempty(record.sourceRevisionRef) || !nonempty(record.recordRef)) continue;
    const clean = metadata(record);
    const prior = records.get(clean.sourceRevisionRef);
    if (prior && JSON.stringify(prior) !== JSON.stringify(clean)) throw new Error('同一准确 TDMS 修订读回了冲突元数据。');
    records.set(clean.sourceRevisionRef, clean);
  }
  const relevantRefs = new Set<string>();
  function addRecord(ref: string, record: TdmsRecordSummary | null = records.get(ref) ?? null): string {
    const id = nativeId(ref);
    if (targets.has(id)) {
      const prior = targets.get(id);
      if (prior?.kind !== 'tdms-record') throw new Error('TDMS 来源与原图对象身份冲突。');
      if (prior.record && record && JSON.stringify(prior.record) !== JSON.stringify(record)) {
        throw new Error('同一准确 TDMS 修订读回了冲突元数据。');
      }
      return id;
    }
    const key = `tdms:${record?.recordKind ?? 'UNKNOWN'}`;
    let group = groups.find(item => item.key === key);
    if (!group) {
      group = { key, title: record ? `TDMS ${tdmsRecordKindLabel(record.recordKind)}` : 'TDMS 准确来源（元数据未取得）', items: [] };
      groups.push(group);
    }
    group.items.push({
      id, kind: 'tdms-record', title: record?.title || record?.sourceRecordId || '准确 TDMS 来源修订',
      subtitle: record
        ? `${record.businessVersion ? tdmsSourceVersionLabel(record.businessVersion, '业务文件') : '业务版次未取得'} · ${tdmsRawCodeLabel(record.state)} · ${record.coverage.status === 'COMPLETE' ? '所声明范围完整' : record.coverage.status === 'PARTIAL' ? '部分覆盖' : '覆盖未知'}`
        : '仅获准关系端点身份；来源内容与版本元数据未读',
    });
    targets.set(id, { kind: 'tdms-record', sourceRevisionRef: ref, record });
    relevantRefs.add(ref);
    return id;
  }
  function addRelation(relation: SuiteGraphRelation, detail: SuiteTdmsRelationDetail): void {
    if (relations.some(item => item.id === relation.id)) throw new Error('TDMS 图谱关系身份重复。');
    relations.push(relation);
    tdmsRelationDetails.set(relation.id, detail);
  }

  // The Host-authorized base owns work/task membership; here we check only its
  // saved source/receipt structure, not the validity of a taskContextRef or grant.
  // Do not replace its saved metadata with today's catalogue, even for the same ref.
  for (const [evidenceNodeId, target] of read.targets) {
    if (!baseIds.has(evidenceNodeId) || target.kind !== 'evidence' || target.workRef !== read.workRef || !nonempty(target.workRef)) continue;
    const evidence = target.evidence;
    if (evidence.kind !== 'TDMS_NATIVE_RECORD') continue;
    const ref = evidence.nativeSource.sourceRevisionRef;
    const receipt = evidence.nativeReadReceipt;
    if (!nonempty(ref) || receipt.sourceRevisionRef !== ref || receipt.readPerformed !== true ||
      receipt.purpose !== 'JOB_AID_NATIVE_RECORD' || !nonempty(receipt.receiptRef) || !nonempty(receipt.permissionRevision) ||
      !nonempty(receipt.taskContextRef) || (evidence.nativeScope && evidence.nativeScope.sourceRevisionRef !== ref)) {
      notices.add('存在未能准确核对的 TDMS 保存依据，未创建来源连线。');
      continue;
    }
    const id = addRecord(ref, metadata(evidence.nativeSource));
    addRelation({
      id: identity('TDMS_SAVED_EVIDENCE', target.workRef, evidence.evidenceRef), source: evidenceNodeId, target: id,
      type: 'TDMS_SAVED_EVIDENCE', label: '该保存依据引用的准确来源', authority: 'HOST_RECORDED',
      currentness: read.historical ? 'HISTORICAL_HOST_OBSERVATION' : 'UNKNOWN',
    }, { kind: 'TDMS_SAVED_EVIDENCE', sourceRevisionRef: ref, evidenceRef: evidence.evidenceRef, workRef: target.workRef });
  }

  // History evidence contains exact source refs but no saved assertion allowset.
  // Therefore today's document bindings/relations cannot be presented as that work's historical relations.
  if (!read.historical && !read.pinnedSavedWork) {
    for (const record of records.values()) {
      for (const version of new Set(record.relatedDocumentVersionIds)) {
        const documentNodeId = documentNodes.get(version);
        if (!documentNodeId) continue;
        const id = addRecord(record.sourceRevisionRef);
        addRelation({
          id: identity('TDMS_DOCUMENT_BINDING', record.sourceRevisionRef, version), source: documentNodeId, target: id,
          type: 'TDMS_DOCUMENT_BINDING', label: '已登记准确文档关联', authority: 'HOST_RECORDED', currentness: 'UNKNOWN',
        }, { kind: 'TDMS_DOCUMENT_BINDING', sourceRevisionRef: record.sourceRevisionRef, documentVersionId: version });
      }
    }
    const assertions = new Map<string, { assertion: TdmsRelationAssertion; reading: TdmsRelationReadResponse }>();
    for (const reading of input.relations) {
      const receipt = reading.receipt;
      if (receipt.readPerformed !== true || receipt.purpose !== 'WIKI_NATIVE_RELATIONS' ||
        receipt.sourceRevisionRef !== reading.sourceRevisionRef || !nonempty(receipt.receiptRef) || !nonempty(receipt.permissionRevision)) {
        notices.add('存在未能准确核对的 TDMS 关系读回，未投影其内容。');
        continue;
      }
      for (const assertion of reading.relations) {
        if (!nonempty(assertion.assertionRef) || !endpointValid(assertion.from) || !endpointValid(assertion.to) ||
          ![assertion.from, assertion.to].some(endpoint => endpoint.kind === 'NATIVE_RECORD_REVISION' && endpoint.sourceRevisionRef === reading.sourceRevisionRef)) continue;
        if (assertion.authority !== 'SOURCE_EXPLICIT' && assertion.authority !== 'CANDIDATE_ONLY') continue;
        const prior = assertions.get(assertion.assertionRef);
        if (prior && JSON.stringify(prior.assertion) !== JSON.stringify(assertion)) throw new Error('同一 TDMS assertionRef 读回了冲突关系。');
        if (!prior) assertions.set(assertion.assertionRef, { assertion, reading });
      }
    }
    // Presentation filters cannot hide conflicting claims for one immutable ID.
    for (const [ref, { assertion }] of assertions) {
      if ((assertion.authority === 'CANDIDATE_ONLY' && !input.includeCandidates) ||
        (assertion.selectedHead === false && !input.includeHistoricalAssertions)) assertions.delete(ref);
    }
    const connected = (endpoint: TdmsExactEndpoint): boolean => endpoint.kind === 'NATIVE_RECORD_REVISION'
      ? relevantRefs.has(endpoint.sourceRevisionRef)
      : endpoint.kind === 'DOCUMENT_VERSION' && documentNodes.has(endpoint.documentVersionId);
    const representable = (endpoint: TdmsExactEndpoint): boolean => endpoint.kind !== 'DOCUMENT_VERSION' || documentNodes.has(endpoint.documentVersionId);
    function nodeFor(endpoint: TdmsExactEndpoint, assertion: TdmsRelationAssertion, side: 'from' | 'to'): string {
      if (endpoint.kind === 'NATIVE_RECORD_REVISION') return addRecord(endpoint.sourceRevisionRef);
      if (endpoint.kind === 'DOCUMENT_VERSION') return documentNodes.get(endpoint.documentVersionId)!;
      const id = tdmsGraphEndpointId(endpoint, assertion.assertionRef, side);
      let group = groups.find(item => item.key === 'tdms:UNRESOLVED');
      if (!group) { group = { key: 'tdms:UNRESOLVED', title: 'TDMS 未解析端点', items: [] }; groups.push(group); }
      if (!targets.has(id)) {
        group.items.push({ id, kind: 'tdms-unresolved', title: endpoint.rawIdentity, subtitle: endpoint.versionGap || '准确版本未解析' });
        targets.set(id, { kind: 'tdms-unresolved', endpoint, assertionRef: assertion.assertionRef, side });
      }
      return id;
    }
    // Closure only over actual authorized assertions; catalogue proximity/title/order is never a join.
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const [ref, { assertion, reading }] of assertions) {
        if (!connected(assertion.from) && !connected(assertion.to)) continue;
        assertions.delete(ref);
        if (!representable(assertion.from) || !representable(assertion.to)) {
          notices.add('部分 TDMS 关系的准确文档端点不在当前原图，未推算文档身份或事项归属。');
          continue;
        }
        const source = nodeFor(assertion.from, assertion, 'from');
        const target = nodeFor(assertion.to, assertion, 'to');
        const temporal = currentness(assertion);
        addRelation({
          id: identity('TDMS_ASSERTION', ref), source, target, type: 'TDMS_ASSERTION',
          label: `${assertion.rawKind} · ${assertion.authority === 'SOURCE_EXPLICIT' ? '源明确关系' : '候选，待核'} · ${temporal === 'HISTORICAL_HOST_OBSERVATION' ? '历史观察' : temporal === 'UNKNOWN' ? '当前性未知' : 'Host 选定观察'}`,
          authority: assertion.authority, currentness: temporal,
        }, { kind: 'TDMS_ASSERTION', assertion, receipt: reading.receipt, limitations: [...reading.limitations] });
        reading.limitations.forEach(notice => notices.add(notice));
        progressed = true;
      }
    }
  } else if (input.records.length || input.relations.length) {
    notices.add('指定保存工作仅使用其准确保存依据；当前目录和未随工作保存的来源关系未混入。');
  }
  if (targets.size === read.targets.size && relations.length === read.graph.relations.length && notices.size === read.notices.length) return read;
  if (targets.size > read.targets.size) notices.add('TDMS 目录可读不证明事项归属；来源声明和批准状态不代表工程采用、执行核验或源端最新版。');
  return { ...read, graph: { ...read.graph, groups, relations }, targets, tdmsRelationDetails, notices: [...notices] };
}
