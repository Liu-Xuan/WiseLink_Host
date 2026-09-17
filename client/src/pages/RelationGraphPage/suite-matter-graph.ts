import type { EngineeringMatterWorkingRevisionReadModel, EngineeringMatterWorkingInputBinding, EngineeringMatterWorkingTextItem } from '@shared/matter-working.interface';
import type { EngineeringMatterWorkspaceRead } from '@client/src/api/engineering-matter';
import type { AssessmentClaimPremise, AssessmentEvidence, AssessmentReadingClaim } from '@shared/assessment-reading.interface';
import type { MatterMaterialLink } from '@shared/matter-material.interface';
import type { SuiteGraphGroup, SuiteGraphMatter, SuiteGraphRelation } from './suite-graph-model';

export type SuiteMatterGraphTarget =
  | { kind: 'input'; binding: EngineeringMatterWorkingInputBinding; workRef: string }
  | { kind: 'question'; item: EngineeringMatterWorkingTextItem; workRef: string }
  | { kind: 'material'; material: MatterMaterialLink }
  | { kind: 'claim'; claim: AssessmentReadingClaim; workRef: string }
  | { kind: 'evidence'; evidence: AssessmentEvidence; workRef: string }
  | { kind: 'document'; documentVersionId: string; familyId: string };

export type SuiteRelationDetail = MatterMaterialLink | AssessmentClaimPremise | { kind: 'FULFILLED_BY'; material: Extract<MatterMaterialLink, {kind: 'EXPECTED'}>; index: number; target: {familyId: string; documentVersionId: string; scope: string} };

export interface SuiteMatterGraphRead {
  graph: SuiteGraphMatter;
  targets: Map<string, SuiteMatterGraphTarget>;
  relationDetails: Map<string, SuiteRelationDetail>;
  notices: string[];
  workRef: string | null;
  overviewStatus: 'CURRENT' | 'STALE' | 'NOT_AVAILABLE' | null;
  missingEvidenceRefs: string[];
}

const identity = (...parts: string[]) => JSON.stringify(parts);
const premiseLabels = { SUPPORTS: '支持', LIMITS: '限定', CONTEXT: '背景', CONFLICTS: '冲突' };

/** Project authorized saved identities only; presentation groups are not engineering entities. */
export function buildSuiteMatterGraph(read: EngineeringMatterWorkspaceRead, selection?: {workRef: string; revision: EngineeringMatterWorkingRevisionReadModel | null}): SuiteMatterGraphRead {
  const { matter, working } = read;
  const current = selection ? selection.revision : working.current;
  if (selection && (!current || current.matterWorkRevisionId !== selection.workRef || current.matterId !== matter.matterId)) {
    throw new Error('指定历史工作尚未准确读回，不显示其他版本。');
  }
  const historical = Boolean(selection && current?.matterWorkRevisionId !== working.current?.matterWorkRevisionId);
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
  if (!historical && !matter.materials) notices.push('当前读取未提供事项材料关系，不能据此认定没有材料。');
  if (!historical && working.pendingInputs.length) notices.push(`${working.pendingInputs.length} 项资料变化待核对。`);
  const add = (key: string, groupTitle: string, id: string, title: string, subtitle: string, target: SuiteMatterGraphTarget) => {
    if (targets.has(id)) throw new Error('图谱读回存在重复对象身份。');
    const group = groups.get(key) ?? { key, title: groupTitle, items: [] };
    group.items.push({ id, title, subtitle, kind: target.kind });
    groups.set(key, group);
    targets.set(id, target);
  };
  for (const material of historical ? [] : matter.materials ?? []) {
    if (material.disposition !== 'INCLUDED') { notices.push(`已排除资料：${material.contribution || material.materialId}`); continue; }
    const id = identity('material', material.materialId);
    const catalog = matter.catalog.entries.find(entry => entry.document.documentVersionId === material.documentVersionId);
    const title = material.kind === 'EXPECTED' ? material.expected.documentNumber || material.expected.description :
      catalog ? `${catalog.document.documentCode} · ${catalog.document.businessRevision}` : `资料版本 ${material.documentVersionId}`;
    const labels = { MEMBER: '事项资料', RELATED: '参考资料', EXPECTED: '预计资料' };
    add(material.kind, labels[material.kind], id, title, material.contribution, { kind: 'material', material });
    relationDetails.set(identity('material-link', material.materialId), material);
    relations.push({ id: identity('material-link', material.materialId), source: root, target: id, type: material.kind, label: labels[material.kind] });
    if (material.kind === 'EXPECTED') {
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
  if (historical && current && workRef) {
    notices.push('正在阅读指定历史工作；当前材料目录不作为当时采用的依据。');
    for (const binding of current.state.substantiveInputs) {
      const id = identity('input', workRef, binding.inputId);
      add('inputs', '当时保存的输入', id, `资料版本 ${binding.documentVersionId}`, '', {kind: 'input', binding, workRef});
      relations.push({id: identity('saved-input', workRef, binding.inputId), source: root, target: id, type: 'SAVED_INPUT', label: '该工作保存的输入'});
    }
  }
  if (current && workRef) {
    for (const [kind, items] of [['open', current.state.openQuestions], ['review', current.state.reviewConditions]] as const) {
      for (const item of items) add('questions', '继续核对', identity('question', workRef, kind, item.itemId), item.text, kind === 'review' ? '复看条件' : '未决问题', {kind: 'question', item, workRef});
    }
  }
  if (result && workRef) {
    for (const evidence of result.evidence) {
      add('evidence', '认识依据', identity('evidence', workRef, evidence.evidenceRef), evidence.title, evidence.versionLabel ?? '', { kind: 'evidence', evidence, workRef });
    }
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
    targets, relationDetails, notices, workRef, overviewStatus: current?.state.problemWork?.overviewStatus ?? null,
    missingEvidenceRefs: [...missing],
  };
}
