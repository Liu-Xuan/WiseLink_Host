import type {
  TrinityEventItem,
  TrinityKnowledgeItem,
  TrinityMatter,
  TrinitySituationData,
  TrinitySituationMetrics,
} from './trinity-types';

export const TRINITY_STAGE_META = [
  ['discover', '发现与接收', '文件 · 故障 · 可靠性信号', '识别新问题，登记原始来源和发生范围。', '来源身份、版本和问题线索'],
  ['track', '跟踪与界定', '范围 · 进展 · 关注条件', '连接调查背景与持续事项，保留真正需要复看的条件。', '事项背景、版本发展与待核问题'],
  ['assess', '分析与评估', '理解 · 取证 · 交互复核', '逐份文件按自身有效版理解要求，在事项内形成综合认识。', '问题论点、实际依据与评估修订'],
  ['issue', '工程决策与颁发', '我方决定 · 工程文件', '在授权业务入口记录决定和颁发的工程文件。', '决定理由、措施范围与正式文件引用'],
  ['prepare', '计划与准备', '工卡 · 工作包 · 资源', '按决定组织实施对象、工卡、窗口和实际资源条件。', '准备条件、工卡依赖与计划变更'],
  ['execute', '实施与记录', '实际执行 · 偏差 · 构型', '关联实际记录、对象范围与处理偏差。', '完成记录、偏差与构型事实来源'],
  ['verify', '效果与验证', '观察窗口 · 效果 · 风险', '结合有范围的运行和可靠性记录，核对措施是否达到目的。', '验证结论、观察限制与反例'],
  ['improve', '改进与复看', '经验 · 修订 · 再评估', '将验证和新材料带回调查、文件和工作方法。', '经验修订、复看条件与新的问题'],
].map(([id, title, caption, purpose, output]) => ({ id, title, caption, purpose, output })) as TrinitySituationData['stages'];

export const TRINITY_KNOWLEDGE_STAGE_META = [
  ['acquire', '获取来源', '外部系统、知识库、工程文档和原生记录，以实际授权及源身份取得。'],
  ['organize', '组织关联', '按事项、技术对象和用途组织；相关不自动合并，同号不同来源不混。'],
  ['understand', '理解提炼', '在正常工程分析中保存完整论点、条件、实际来源和重要未知。'],
  ['persist', '保存沉淀', '完整工作与来源绑定持续保存，Wiki、索引和图谱直接复用。'],
  ['govern', '治理更新', '版本、责任、适用范围、复用依据和撤回理由贯穿所有工作节点。'],
  ['reuse', '检索复用', '先查已有工作，按确切版本复用；新信息再挑战和更新已有认识。'],
].map(([id, title, purpose]) => ({ id, title, purpose })) as TrinitySituationData['knowledgeStages'];

export const TRINITY_RING = {
  viewWidth: 1000,
  viewHeight: 610,
  cx: 500,
  cy: 305,
  outerRx: 378,
  outerRy: 234,
  innerRx: 210,
  innerRy: 136,
  stageStepDeg: 45,
  knowledgeStepDeg: 60,
  outerArrowOffsetDeg: 24,
  knowledgeArrowOffsetDeg: 32,
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

export function knowledgeAnchor(index: number): TrinityPoint {
  return ringPoint(
    TRINITY_RING.innerRx,
    TRINITY_RING.innerRy,
    -90 + index * TRINITY_RING.knowledgeStepDeg,
  );
}

export function nodePositionPercent(point: TrinityPoint): {
  left: string; top: string;
} {
  return { left: `${round2(point.x / 10)}%`, top: `${round2(point.y / 6.1)}%` };
}

function arrowAngle(rx: number, ry: number, a: number): number {
  const rad = (a * Math.PI) / 180;
  return round2((Math.atan2(ry * Math.cos(rad), -rx * Math.sin(rad)) * 180) / Math.PI);
}

export interface TrinityArrowSpec {
  d: string;
  transform: string;
  kind: 'business' | 'knowledge';
}

export function buildRingArrows(): TrinityArrowSpec[] {
  const arrows: TrinityArrowSpec[] = [];
  const BUSINESS_ARROW = 'M-5 -3 4 0 -5 3z';
  const KNOWLEDGE_ARROW = 'M-4 -2.5 3 0 -4 2.5z';
  for (let i = 0; i < 8; i += 1) {
    const angle = -90 + i * TRINITY_RING.stageStepDeg + TRINITY_RING.outerArrowOffsetDeg;
    const p = ringPoint(TRINITY_RING.outerRx, TRINITY_RING.outerRy, angle);
    const deg = arrowAngle(TRINITY_RING.outerRx, TRINITY_RING.outerRy, angle);
    arrows.push({
      d: BUSINESS_ARROW,
      transform: `translate(${p.x} ${p.y}) rotate(${deg})`,
      kind: 'business',
    });
  }
  for (let i = 0; i < 6; i += 1) {
    const angle = -90 + i * TRINITY_RING.knowledgeStepDeg + TRINITY_RING.knowledgeArrowOffsetDeg;
    const p = ringPoint(TRINITY_RING.innerRx, TRINITY_RING.innerRy, angle);
    const deg = arrowAngle(TRINITY_RING.innerRx, TRINITY_RING.innerRy, angle);
    arrows.push({
      d: KNOWLEDGE_ARROW,
      transform: `translate(${p.x} ${p.y}) rotate(${deg})`,
      kind: 'knowledge',
    });
  }
  return arrows;
}

export function toggleSelection<T extends string>(current: T | '', next: T): T | '' {
  return current === next ? '' : next;
}

export function readableCoverage(data: TrinitySituationData | null, field: 'matters' | 'events' | 'knowledge'): boolean {
  return !!data && !['loading', 'failed', 'denied'].includes(data.availability ?? 'complete')
    && !['loading', 'failed', 'denied'].includes(data.coverage?.[field] ?? 'complete');
}

export function completeCoverage(data: TrinitySituationData | null, field: 'matters' | 'events' | 'knowledge'): boolean {
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

export function completeLifecycleCoverage(data: TrinitySituationData | null): boolean {
  if (!data || ['loading', 'failed', 'denied'].includes(data.availability ?? 'complete')) return false;
  if (data.coverage?.lifecycle !== undefined)
    return data.coverage.lifecycle === 'complete';
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
  return scope.filter((m: TrinityMatter) => m.activeStages.includes(stageId)).length;
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
      attention: null,
      knowledgeWorks: null,
      effectWatch: null,
    };
  }
  const knowledgeList = scopeKnowledge(data, scope);
  const matterTotalKnown = completeMatterTotal(data);
  const attentionKnown = matterTotalKnown && scope.every(
    (matter: TrinityMatter) => matter.attention !== null,
  );
  return {
    visibleMatters: matterTotalKnown ? scope.length : null,
    attention: attentionKnown
      ? scope.filter((m: TrinityMatter) => m.attention).length : null,
    knowledgeWorks: completeCoverage(data, 'knowledge') ? knowledgeList.length : null,
    effectWatch: completeLifecycleCoverage(data)
      ? scope.filter((m: TrinityMatter) => m.activeStages.includes('verify')).length
      : null,
  };
}

export function stageLabel(
  scope: TrinityMatter[] | null,
  level: 'macro' | 'focus',
  stageId: string,
  focusActive: boolean,
  complete = true,
): string {
  if (!scope) return '阶段关联未取得';
  if (!complete) {
    const count = stageAssociationCount(scope, stageId);
    return count ? `已取得 ${count} 项关联 · 部分范围` : '阶段关联尚未完整取得';
  }
  if (level === 'focus') return focusActive ? '当前有工作在此环节' : '无当前阶段记录';
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
    : '业务状态与知识状态分别阅读';
  return `${asOf} · ${suffix}`;
}
