import { selectMatterDocumentSources, matterDocumentSourceLabel } from '@client/src/features/matter/matter-document-sources';
import type { EngineeringMatterWorkingRevisionReadModel, EngineeringMatterWorkingInputBinding, EngineeringMatterWorkingTextItem } from '@shared/matter-working.interface';
import type { EngineeringMatterWorkspaceRead } from '@client/src/api/engineering-matter';
import type { EngineeringMatterCatalogEntry } from '@shared/api.interface';
import type { AssessmentClaimPremise, AssessmentEvidence, AssessmentReadingClaim } from '@shared/assessment-reading.interface';
import type { MatterMaterialLink } from '@shared/matter-material.interface';
import type { AnyDocumentActivityRevision as DocumentActivityRevision, AnyDocumentActivityStatement as DocumentActivityStatement } from '@shared/document-activity.interface';
import { activityStatementTimeText } from '@client/src/features/trinity/document-activity-presentation';
import type { SuiteGraphGroup, SuiteGraphMatter, SuiteGraphRelation } from './suite-graph-model';

import type { TdmsExactEndpoint, TdmsRecordSummary, TdmsRelationAssertion, TdmsReadReceipt } from '@shared/tdms-source.interface';

export type SuiteMatterGraphTarget =
  | { kind: 'tdms-record'; sourceRevisionRef: string; record: TdmsRecordSummary | null }
  | { kind: 'tdms-unresolved'; endpoint: Extract<TdmsExactEndpoint, {kind: 'UNRESOLVED'}>; assertionRef: string; side: 'from' | 'to' }
  | { kind: 'root' }
  | { kind: 'input'; binding: EngineeringMatterWorkingInputBinding; workRef: string }
  | { kind: 'question'; item: EngineeringMatterWorkingTextItem; workRef: string }
  | { kind: 'material'; material: MatterMaterialLink }
  | { kind: 'claim'; claim: AssessmentReadingClaim; workRef: string }
  | { kind: 'evidence'; evidence: AssessmentEvidence; workRef: string }
  | { kind: 'document'; documentVersionId: string; familyId: string }
  | { kind: 'catalog-document'; entry: EngineeringMatterCatalogEntry }
  | { kind: 'statement'; statement: DocumentActivityStatement; documentVersionId: string; familyId: string; parseRunId: string; candidateRevision: number; runRef: string }
  | { kind: 'matter-node'; matterId: string; title: string; status: string | null };

/** Exact source observations rendered by the Suite source layer; no Host adoption. */
export type SuiteTdmsRelationDetail =
  | { kind: 'TDMS_ASSERTION'; assertion: TdmsRelationAssertion; receipt: TdmsReadReceipt; limitations: string[] }
  | { kind: 'TDMS_DOCUMENT_BINDING'; sourceRevisionRef: string; documentVersionId: string }
  | { kind: 'TDMS_SAVED_EVIDENCE'; sourceRevisionRef: string; evidenceRef: string; workRef: string };

export type SuiteGraphRelationDetailExtension =
  | { kind: 'CATALOG'; entry: EngineeringMatterCatalogEntry }
  | { kind: 'STATEMENT'; statement: DocumentActivityStatement; documentVersionId: string; parseRunId: string; candidateRevision: number; runRef: string }
  | { kind: 'ATA_CLASSIFICATION'; value: string; status: string }
  | { kind: 'DIRECTORY_MEMBERSHIP'; matterId: string };

export type SuiteRelationDetail = MatterMaterialLink | AssessmentClaimPremise | SuiteGraphRelationDetailExtension | { kind: 'FULFILLED_BY'; material: Extract<MatterMaterialLink, {kind: 'EXPECTED'}>; index: number; target: {familyId: string; documentVersionId: string; scope: string} };

export interface SuiteMatterGraphRead {
  graph: SuiteGraphMatter;
  targets: Map<string, SuiteMatterGraphTarget>;
  relationDetails: Map<string, SuiteRelationDetail>;
  /** Exact source relation observations; no Host adoption or execution authority. */
  tdmsRelationDetails?: ReadonlyMap<string, SuiteTdmsRelationDetail>;
  notices: string[];
  workRef: string | null;
  /** True only when the selected work is older than the current work. */
  historical?: boolean;
  /** Explicit selection freezes saved inputs and evidence, even when it is current. */
  pinnedSavedWork?: boolean;
  overviewStatus: 'CURRENT' | 'STALE' | 'NOT_AVAILABLE' | null;
  missingEvidenceRefs: string[];
}

const identity = (...parts: string[]) => JSON.stringify(parts);
const premiseLabels = { SUPPORTS: '支持', LIMITS: '限定', CONTEXT: '背景', CONFLICTS: '冲突' };

function canonicalEvidence(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item === null || typeof item !== 'object') return item;
    const fields = item as Record<string, unknown>;
    return Object.fromEntries(Object.keys(fields).sort().map(key => [key, sort(fields[key])]));
  };
  return JSON.stringify(sort(value));
}

/** Project authorized saved identities only; presentation groups are not engineering entities. */
export function buildSuiteMatterGraph(read: EngineeringMatterWorkspaceRead, selection?: {workRef: string; revision: EngineeringMatterWorkingRevisionReadModel | null}): SuiteMatterGraphRead {
  const { matter, working } = read;
  const current = selection ? selection.revision : working.current;
  if (selection && (!current || current.matterWorkRevisionId !== selection.workRef || current.matterId !== matter.matterId)) {
    throw new Error('指定历史工作尚未准确读回，不显示其他版本。');
  }
  const historical = Boolean(selection && current?.matterWorkRevisionId !== working.current?.matterWorkRevisionId);
  const pinnedSavedWork = Boolean(selection);
  const result = current?.state.substantiveResult;
  if (working.matterId !== matter.matterId || working.currentMatterRevisionId !== matter.currentRevision.matterRevisionId) {
    throw new Error('事项与保存工作范围不一致，请重新读取。');
  }
  if (current && (current.matterId !== matter.matterId || (!historical && current.workingRevision !== working.currentWorkingRevision))) {
    throw new Error('当前保存工作身份不一致。');
  }
  if (result && (result.scope.kind !== 'ENGINEERING_MATTER' || result.scope.matterId !== matter.matterId ||
    result.resultRef !== current?.substantiveResultRef || result.resultRevision !== current?.substantiveResultRevision)) {
    throw new Error('图谱认识与保存工作身份不一致。');
  }
  const root = identity('matter', matter.matterId);
  const groups = new Map<string, SuiteGraphGroup>();
  const targets = new Map<string, SuiteMatterGraphTarget>();
  const relations: SuiteGraphRelation[] = [];
  const missing = new Set<string>();
  const relationDetails = new Map<string, SuiteRelationDetail>();
  const notices: string[] = [];
  if (!pinnedSavedWork && !matter.materials) notices.push('当前读取未提供事项材料关系，不能据此认定没有材料。');
  if (!pinnedSavedWork && working.pendingInputs.length) notices.push(`${working.pendingInputs.length} 项资料变化待核对。`);
  const add = (key: string, groupTitle: string, id: string, title: string, subtitle: string, target: SuiteMatterGraphTarget) => {
    if (targets.has(id)) throw new Error('图谱读回存在重复对象身份。');
    const group = groups.get(key) ?? { key, title: groupTitle, items: [] };
    group.items.push({ id, title, subtitle, kind: target.kind });
    groups.set(key, group);
    targets.set(id, target);
  };
  const currentSources = new Map((pinnedSavedWork ? [] : selectMatterDocumentSources(matter)).map(source => [source.document.documentVersionId, source]));
  for (const material of pinnedSavedWork ? [] : matter.materials ?? []) {
    if (material.disposition !== 'INCLUDED') { notices.push(`已排除资料：${material.contribution || material.materialId}`); continue; }
    const id = identity('material', material.materialId);
    const catalog = matter.catalog.entries.find(entry => entry.document.documentVersionId === material.documentVersionId);
    const title = material.kind === 'EXPECTED' ? material.expected.documentNumber || material.expected.description :
      matterDocumentSourceLabel(currentSources.get(material.documentVersionId) ?? { document: { documentVersionId: material.documentVersionId } });
    const labels = { MEMBER: '事项资料', RELATED: '参考资料', EXPECTED: '预计资料' };
    add(material.kind, labels[material.kind], id, title,
      material.contribution || (catalog ? '' : material.documentVersionId), { kind: 'material', material });
    relationDetails.set(identity('material-link', material.materialId), material);
    relations.push({ id: identity('material-link', material.materialId), source: root, target: id, type: material.kind, label: labels[material.kind] });
    if (material.kind === 'EXPECTED' && material.expected.acquisitionStatus !== 'NOT_ACQUIRED') {
      for (const [index, fulfilled] of material.expected.fulfilledBy.entries()) {
        const documentId = identity('document', fulfilled.documentVersionId);
        if (!targets.has(documentId)) {
          const known = matter.catalog.entries.find(entry => entry.document.documentVersionId === fulfilled.documentVersionId);
          add('fulfilled', '已取得资料', documentId, known?.document.documentCode ?? '已取得资料', known?.document.businessRevision ?? '',
            { kind: 'document', documentVersionId: fulfilled.documentVersionId, familyId: fulfilled.familyId });
        }
        relationDetails.set(identity('fulfilled', material.materialId, String(index)), { kind: 'FULFILLED_BY', material, index, target: fulfilled });
        relations.push({ id: identity('fulfilled', material.materialId, String(index)), source: id, target: documentId, type: 'FULFILLED_BY', label: fulfilled.scope || '取得范围' });
      }
    }
  }
  const workRef = current?.matterWorkRevisionId ?? null;
  if (pinnedSavedWork && current && workRef) {
    notices.push('正在阅读指定保存工作；当前材料目录不作为该工作采用的依据。');
    for (const binding of current.state.substantiveInputs) {
      const id = identity('input', workRef, binding.inputId);
      add('inputs', '当时保存的输入', id, '资料版本', binding.documentVersionId,
        {kind: 'input', binding, workRef});
      relations.push({id: identity('saved-input', workRef, binding.inputId), source: root, target: id, type: 'SAVED_INPUT', label: '该工作保存的输入'});
    }
  }
  if (current && workRef) {
    for (const [kind, items] of [['open', current.state.openQuestions], ['review', current.state.reviewConditions]] as const) {
      for (const item of items) add('questions', '继续核对', identity('question', workRef, kind, item.itemId), item.text, kind === 'review' ? '复看条件' : '未决问题', {kind: 'question', item, workRef});
    }
  }
  if (current && workRef) {
    const evidenceByRef = new Map<string, AssessmentEvidence>();
    for (const evidence of [
      ...(result?.evidence ?? []),
      ...(current.state.problemWork?.evidence ?? []),
    ]) {
      const prior = evidenceByRef.get(evidence.evidenceRef);
      if (prior && canonicalEvidence(prior) !== canonicalEvidence(evidence)) {
        throw new Error('同一保存工作中的 evidenceRef 指向冲突依据。');
      }
      evidenceByRef.set(evidence.evidenceRef, evidence);
    }
    for (const evidence of evidenceByRef.values()) {
      add('evidence', '认识依据', identity('evidence', workRef, evidence.evidenceRef), evidence.title, evidence.versionLabel ?? '', { kind: 'evidence', evidence, workRef });
    }
  }
  if (result && workRef) {
    for (const claim of result.content.claims) {
      const id = identity('claim', workRef, claim.claimId);
      add('claims', '已保存认识', id, claim.text, claim.basis === 'CONDITIONAL_INFERENCE' ? '有条件的推断 · 候选意见' : '来源陈述 · 待工程师核对', { kind: 'claim', claim, workRef });
      relations.push({ id: identity('saved-claim', workRef, claim.claimId), source: root, target: id, type: 'SAVED_CLAIM', label: '保存工作包含' });
      for (const [index, premise] of claim.premises.entries()) {
        const evidenceId = identity('evidence', workRef, premise.evidenceRef);
        if (!targets.has(evidenceId)) { missing.add(premise.evidenceRef); continue; }
        relationDetails.set(identity('premise', workRef, claim.claimId, String(index)), premise);
        relations.push({ id: identity('premise', workRef, claim.claimId, String(index)), source: evidenceId, target: id, type: premise.role, label: premiseLabels[premise.role] });
      }
    }
  }
  return {
    graph: { id: root, title: matter.title, rootKind: 'matter', groups: [...groups.values()], relations },
    targets, relationDetails, notices, workRef, historical, pinnedSavedWork,
    overviewStatus: current?.state.problemWork?.overviewStatus ?? null,
    missingEvidenceRefs: [...missing],
  };
}

/** Node id of the first target matching the predicate; null when absent. */
function findNodeId(targets: ReadonlyMap<string, SuiteMatterGraphTarget>, match: (target: SuiteMatterGraphTarget) => boolean): string | null {
  for (const [nodeId, target] of targets) if (match(target)) return nodeId;
  return null;
}

/** Document node id for a catalog document version, across material/document/catalog kinds. */
export function suiteGraphDocumentNodeId(targets: ReadonlyMap<string, SuiteMatterGraphTarget>, documentVersionId: string): string | null {
  return findNodeId(targets, (target) =>
    (target.kind === 'material' && target.material.documentVersionId === documentVersionId) ||
    (target.kind === 'document' && target.documentVersionId === documentVersionId) ||
    (target.kind === 'catalog-document' && target.entry.document.documentVersionId === documentVersionId));
}

/**
 * Append registered catalog documents that have no node yet (no material link, not
 * fulfilled, not a saved input). The catalog association itself is a registered
 * relation; nothing is inferred from titles. Pinned saved work never receives
 * current registrations.
 */
export function appendSuiteGraphCatalogDocuments(read: SuiteMatterGraphRead, catalog: EngineeringMatterCatalogEntry[]): SuiteMatterGraphRead {
  if (read.pinnedSavedWork || read.historical || catalog.length === 0) return read;
  const targets = new Map(read.targets);
  const relationDetails = new Map(read.relationDetails);
  const relations = [...read.graph.relations];
  const groups = read.graph.groups.map((group) => ({ ...group, items: [...group.items] }));
  let added = 0;
  for (const entry of catalog) {
    const documentVersionId = entry.document.documentVersionId;
    if (suiteGraphDocumentNodeId(targets, documentVersionId) !== null) continue;
    const nodeId = identity('catalog', documentVersionId);
    if (targets.has(nodeId)) continue;
    targets.set(nodeId, { kind: 'catalog-document', entry });
    let group = groups.find((item) => item.key === 'catalog');
    if (!group) {
      group = { key: 'catalog', title: '已登记资料', items: [] };
      groups.push(group);
    }
    group.items.push({
      id: nodeId,
      title: entry.document.documentCode,
      subtitle: `${entry.document.businessRevision} · ${entry.relationRole === 'PRIMARY' ? '主要资料' : '关联资料'}`,
      kind: 'catalog-document',
    });
    const relationId = identity('catalog-link', documentVersionId);
    relations.push({
      id: relationId,
      source: read.graph.id,
      target: nodeId,
      type: 'CATALOG',
      label: entry.relationRole === 'PRIMARY' ? '主要资料' : '关联资料',
    });
    relationDetails.set(relationId, { kind: 'CATALOG', entry });
    added += 1;
  }
  if (added === 0) return read;
  return { ...read, graph: { ...read.graph, groups, relations }, targets, relationDetails };
}

export interface SuiteGraphActivityCandidate {
  candidate: DocumentActivityRevision;
  familyId: string;
}

/** Statement node id for a saved source statement; null when the statement is not in the graph. */
export function suiteGraphStatementNodeId(targets: ReadonlyMap<string, SuiteMatterGraphTarget>, documentVersionId: string, statementId: string): string | null {
  return findNodeId(targets, (target) =>
    target.kind === 'statement' && target.documentVersionId === documentVersionId && target.statement.statementId === statementId);
}

/**
 * Append saved source-declared statements of catalog documents. Each statement keeps
 * its exact saved identity (document version, parse run, candidate revision, run ref);
 * edges only connect a document node already in the graph to its own saved statements.
 */
export function appendSuiteGraphActivityStatements(read: SuiteMatterGraphRead, activities: ReadonlyMap<string, SuiteGraphActivityCandidate>): SuiteMatterGraphRead {
  if (read.pinnedSavedWork || read.historical || activities.size === 0) return read;
  const targets = new Map(read.targets);
  const relationDetails = new Map(read.relationDetails);
  const relations = [...read.graph.relations];
  const groups = read.graph.groups.map((group) => ({ ...group, items: [...group.items] }));
  const notices = read.notices;
  let added = 0;
  let detached = 0;
  for (const [documentVersionId, activity] of activities) {
    const parentId = suiteGraphDocumentNodeId(targets, documentVersionId);
    if (parentId === null) {
      detached += activity.candidate.statements.length;
      continue;
    }
    for (const statement of activity.candidate.statements) {
      const nodeId = identity('statement', documentVersionId, statement.statementId);
      if (targets.has(nodeId)) continue;
      targets.set(nodeId, {
        kind: 'statement',
        statement,
        documentVersionId,
        familyId: activity.familyId,
        parseRunId: activity.candidate.sourceBinding.original.parseRunId,
        candidateRevision: activity.candidate.candidateRevision,
        runRef: activity.candidate.runRef,
      });
      let group = groups.find((item) => item.key === 'statements');
      if (!group) {
        group = { key: 'statements', title: '时间声明', items: [] };
        groups.push(group);
      }
      group.items.push({
        id: nodeId,
        title: statement.label,
        subtitle: activityStatementTimeText(statement),
        kind: 'statement',
      });
      const relationId = identity('declares', documentVersionId, statement.statementId);
      relations.push({ id: relationId, source: parentId, target: nodeId, type: 'DECLARES', label: '资料声明' });
      relationDetails.set(relationId, {
        kind: 'STATEMENT',
        statement,
        documentVersionId,
        parseRunId: activity.candidate.sourceBinding.original.parseRunId,
        candidateRevision: activity.candidate.candidateRevision,
        runRef: activity.candidate.runRef,
      });
      added += 1;
    }
  }
  if (added === 0 && detached === 0) return read;
  const nextNotices = detached > 0 ? [...notices, `${detached} 条已保存声明所属资料未入图，未挂靠到其他节点。`] : notices;
  return { ...read, graph: { ...read.graph, groups, relations }, targets, relationDetails, notices: nextNotices };
}
