import type {
  TrinityEventItem,
  TrinityKnowledgeItem,
  TrinityMatter,
  TrinitySourceItem,
  TrinitySituationData,
  TrinitySituationMetrics,
} from './trinity-types';

export const TRINITY_STAGE_META = [
  ['question', '理解工程问题', '背景与目标范围', '从背景、现象、对象与资料范围开始，避免只按一份文件的标题理解整件事。', '问题范围、背景与需要核对的目标'],
  ['conditions', '核对要求与条件', '有效版本与适用前提', '核对文件自身要求、适用条件、并行关系和重要限制；信息不足时说明影响哪项判断。', '有效依据、适用条件与重要未知'],
  ['analysis', '分析风险与措施', '风险情景与作用边界', '结合实际问题比较措施的针对性、可能收益和限制，突出关键风险情景。', '风险情景、措施边界与待核因素'],
  ['synthesis', '形成综合评估', '当前认识与关键依据', '把分散分析整理成连贯认识，说明目前成立的认识、重要条件和下一关注。', '连贯认识、关键条件与准确依据'],
  ['review', '协同工程师复核', '追问、纠正与补充', '让重要判断直达依据；关键纠正与新材料进入相应问题的继续分析。', '核查意见、纠正内容与补充材料'],
  ['update', '更新认识与依据', '纳入变化，保留历史', '新材料或关键纠正到来后，只更新真正受影响的认识并保留历史。', '变化范围、保留认识与后续条件'],
].map(([id, title, caption, purpose, output]) => ({ id, title, caption, purpose, output })) as TrinitySituationData['stages'];

export const TRINITY_SOURCE_CATEGORY_META = [
  ['documents', '工程文件', '解析原文 · 保留版本', '保留文件各自的版本、要求和适用条件，解释它对本事项的作用。'],
  ['operation', '运行与故障', '现象 · 事件 · 调查', '结合实际取得的事件与调查记录理解问题；没有取得记录不表示现象不存在。'],
  ['configuration', '构型与对象', '对象 · 时点 · 范围', '对象记录保留范围与截至时点，分别说明已知内容与仍会影响判断的条件。'],
  ['history', '历史工程工作', '已有认识 · 真实依据', '复用以往完整分析及其真实依据，保留当时范围和准确工作身份。'],
  ['knowledge', '知识与方法', '专业知识 · 评估方法', '专业知识帮助理解，工作方法帮助核对重要条件，不为了填满结构制造答案。'],
  ['engineer', '工程师补充', '经验 · 纠正 · 新材料', '工程师可以解释、纠正和补材料；未核对陈述与已核对事实分别保留。'],
].map(([id, title, subtitle, purpose]) => ({ id, title, subtitle, purpose })) as TrinitySituationData['sourceCategories'];

export const TRINITY_RING = {
  viewWidth: 1100,
  viewHeight: 660,
  cx: 550,
  cy: 330,
  outerRx: 465,
  outerRy: 257,
  innerRx: 253,
  innerRy: 154,
  stageStepDeg: 60,
  sourceStepDeg: 60,
  outerArrowOffsetDeg: 30,
  sourceArrowOffsetDeg: 30,
} as const;

export const TRINITY_FLEET_OPTIONS = [
  { value: 'all', label: '全部机型' },
  { value: '737NG', label: '737NG' },
  { value: '777', label: '777' },
  { value: '787', label: '787' },
  { value: '747-8', label: '747-8' },
] as const;

export interface TrinityPoint { x: number; y: number }

const round2 = (v: number): number => Math.round(v * 100) / 100;

export function ringPoint(rx: number, ry: number, angleDeg: number): TrinityPoint {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: round2(TRINITY_RING.cx + rx * Math.cos(rad)),
    y: round2(TRINITY_RING.cy + ry * Math.sin(rad)),
  };
}

export function stageAnchor(index: number): TrinityPoint {
  return ringPoint(
    TRINITY_RING.outerRx,
    TRINITY_RING.outerRy,
    -90 + index * TRINITY_RING.stageStepDeg,
  );
}

export function sourceAnchor(index: number): TrinityPoint {
  return ringPoint(
    TRINITY_RING.innerRx,
    TRINITY_RING.innerRy,
    -90 + index * TRINITY_RING.sourceStepDeg,
  );
}

export function nodePositionPercent(point: TrinityPoint): {
  left: string; top: string;
} {
  return {
    left: `${round2(point.x / TRINITY_RING.viewWidth * 100)}%`,
    top: `${round2(point.y / TRINITY_RING.viewHeight * 100)}%`,
  };
}

export function toggleSelection<T extends string>(current: T | '', next: T): T | '' {
  return current === next ? '' : next;
}

export function readableCoverage(
  data: TrinitySituationData | null,
  field: 'matters' | 'events' | 'knowledge' | 'sources',
): boolean {
  return !!data && !['loading', 'failed', 'denied'].includes(data.availability ?? 'complete')
    && !['loading', 'failed', 'denied'].includes(data.coverage?.[field] ?? 'complete');
}

export function completeCoverage(
  data: TrinitySituationData | null,
  field: 'matters' | 'events' | 'knowledge' | 'sources',
): boolean {
  return !!data && (data.availability ?? 'complete') === 'complete'
    && (data.coverage?.[field] ?? 'complete') === 'complete';
}

export function completeMatterTotal(data: TrinitySituationData | null): boolean {
  if (!data || ['loading', 'failed', 'denied'].includes(data.availability ?? 'complete')) return false;
  if (data.coverage?.matterTotal !== undefined)
    return data.coverage.matterTotal === 'complete';
  return (data.availability ?? 'complete') === 'complete'
    && (data.coverage?.matters ?? 'complete') === 'complete';
}

export function completeAssessmentCoverage(data: TrinitySituationData | null): boolean {
  if (!data || ['loading', 'failed', 'denied'].includes(data.availability ?? 'complete')) return false;
  if (data.coverage?.assessment !== undefined)
    return data.coverage.assessment === 'complete';
  return (data.availability ?? 'complete') === 'complete'
    && (data.coverage?.matters ?? 'complete') === 'complete';
}

export function scopeMatters(
  data: TrinitySituationData,
  level: 'macro' | 'focus',
  fleet: string,
  focusMatterId: string,
): TrinityMatter[] {
  if (!readableCoverage(data, 'matters')) return [];
  const matters = [...new Map(data.matters.map((m) => [m.id, m])).values()];
  if (level === 'focus') return matters.filter((m: TrinityMatter) => m.id === focusMatterId);
  if (fleet === 'all') return matters;
  return matters.filter((m: TrinityMatter) => m.fleet === fleet);
}

export function stageAssociationCount(
  scope: TrinityMatter[],
  stageId: string,
): number {
  return scope.filter((m: TrinityMatter) =>
    m.activeAssessmentStages.includes(stageId)).length;
}

export function scopeSources(
  data: TrinitySituationData,
  scope: TrinityMatter[],
): TrinitySourceItem[] {
  if (!readableCoverage(data, 'matters') || !readableCoverage(data, 'sources'))
    return [];
  const ids: Set<string> = new Set(scope.map((matter: TrinityMatter) => matter.id));
  return [...new Map(data.sources
    .filter((source: TrinitySourceItem) => ids.has(source.matter))
    .map((source: TrinitySourceItem) => [source.id, source])).values()];
}

export function scopeEvents(
  data: TrinitySituationData,
  scope: TrinityMatter[],
): TrinityEventItem[] {
  if (!readableCoverage(data, 'matters') || !readableCoverage(data, 'events')) return [];
  const ids = new Set(scope.map((m: TrinityMatter) => m.id));
  return data.events.filter((e: TrinityEventItem) => ids.has(e.matter));
}

export function scopeKnowledge(
  data: TrinitySituationData,
  scope: TrinityMatter[],
): TrinityKnowledgeItem[] {
  if (!readableCoverage(data, 'matters') || !readableCoverage(data, 'knowledge')) return [];
  const ids = new Set(scope.map((m: TrinityMatter) => m.id));
  return [...new Map(data.knowledge
    .filter((k: TrinityKnowledgeItem) => ids.has(k.matter) || k.reuse.some((r: string) => ids.has(r)))
    .map((k) => [k.id, k])).values()];
}

export function recentEvents(
  data: TrinitySituationData,
  scope: TrinityMatter[],
  asOf: string | null,
  limit = 3,
): TrinityEventItem[] {
  return scopeEvents(data, scope)
    .filter((e: TrinityEventItem) => e.date && (!asOf || e.date <= asOf))
    .sort((a: TrinityEventItem, b: TrinityEventItem) =>
      (b.date || '').localeCompare(a.date || ''))
    .slice(0, limit);
}

export function recentKnowledge(
  data: TrinitySituationData,
  scope: TrinityMatter[],
  limit = 3,
): TrinityKnowledgeItem[] {
  return scopeKnowledge(data, scope).slice(0, limit);
}

export function situationMetrics(
  data: TrinitySituationData | null,
  scope: TrinityMatter[] | null,
): TrinitySituationMetrics {
  if (!data || !scope) {
    return {
      visibleMatters: null,
      sourceCount: null,
      attention: null,
      synthesisPending: null,
    };
  }
  const matterTotalKnown = completeMatterTotal(data);
  const attentionKnown = matterTotalKnown && scope.every(
    (matter: TrinityMatter) => matter.attention !== null,
  );
  return {
    visibleMatters: matterTotalKnown ? scope.length : null,
    sourceCount: completeCoverage(data, 'sources')
      ? scopeSources(data, scope).length : null,
    attention: attentionKnown
      ? scope.filter((m: TrinityMatter) => m.attention).length : null,
    synthesisPending: matterTotalKnown && scope.every(
      (matter: TrinityMatter) => matter.synthesisPending !== null,
    ) ? scope.filter((matter: TrinityMatter) => matter.synthesisPending).length : null,
  };
}

export function stageLabel(
  scope: TrinityMatter[] | null,
  level: 'macro' | 'focus',
  stageId: string,
  focusActive: boolean,
  complete = true,
): string {
  if (!scope) return '评估关联未取得';
  if (!complete) {
    const count = stageAssociationCount(scope, stageId);
    return count ? `已取得 ${count} 项关联 · 部分范围` : '评估关联尚未完整取得';
  }
  if (level === 'focus') return focusActive ? '已有相关工作' : '尚未取得相关工作';
  return `${stageAssociationCount(scope, stageId)} 项关联事项`;
}

export function attentionItems(
  scope: TrinityMatter[] | null,
): TrinityMatter[] {
  if (!scope) return [];
  return scope.filter((m: TrinityMatter) => m.attention);
}

export function formatAsof(
  data: TrinitySituationData | null,
  level: 'macro' | 'focus',
  focusMatter: TrinityMatter | null,
): string {
  const asOf = data?.meta?.asOf
    ? data.meta.origin === 'ISOLATED_EXAMPLE'
      ? `示例资料截至 ${data.meta.asOf}`
      : `当前授权资料截至 ${data.meta.asOf}`
    : '当前授权资料范围';
  const suffix = level === 'focus' && focusMatter
    ? `${focusMatter.fleet} / ATA ${focusMatter.ata}`
    : '信息来源与评估工作分别阅读';
  return `${asOf} · ${suffix}`;
}
