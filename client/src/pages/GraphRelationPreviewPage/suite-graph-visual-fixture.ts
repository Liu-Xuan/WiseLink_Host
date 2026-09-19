import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import type { SuiteMatterGraphRead, SuiteMatterGraphTarget } from '@client/src/pages/RelationGraphPage/suite-matter-graph';
import type { SuiteGraphTimelineEvent } from '@client/src/pages/RelationGraphPage/suite-graph-timeline';
import type { SuiteGraphGroup, SuiteGraphRelation } from '@client/src/pages/RelationGraphPage/suite-graph-model';
import { WL_ASSETS } from '@client/src/lib/graph/assets';

const MATTER_ID = 'preview:gear';
const WORK_REF = 'preview:gear:work:3';

const groups: SuiteGraphGroup[] = [
  {
    key: 'objects', title: '对象与构型', color: '#4f83d6', columns: 1,
    items: [
      { id: 'g-a1', title: '示例子机队 A', subtitle: '记录范围 · 2 个位置', kind: 'plane', picture: WL_ASSETS['aircraft-reference'] },
      { id: 'g-a2', title: '示例子机队 B', subtitle: '构型 G2 · 待核', kind: 'plane', picture: WL_ASSETS['aircraft-reference'] },
      { id: 'g-a3', title: '安装与检查记录', subtitle: 'REC-DEMO-032 · C1', kind: 'record' },
    ],
  },
  {
    key: 'domains', title: '专业定位', color: '#c88b2d', columns: 2,
    items: [
      { id: 'g-t1', title: 'ATA 32', subtitle: '起落架', kind: 'chapter' },
      { id: 'g-t2', title: '问题分支 X', subtitle: '条件需核对', kind: 'topic' },
      { id: 'g-t3', title: '检查范围', subtitle: '已有论点', kind: 'topic' },
    ],
  },
  {
    key: 'documents', title: '技术资料', color: '#2a9d93', columns: 1,
    items: [
      { id: 'g-d1', title: 'SB-DEMO-032', subtitle: 'R02 · 措施与条件', kind: 'document' },
      { id: 'g-d2', title: 'FTD-DEMO-032', subtitle: 'R03 · 调查进展', kind: 'document' },
      { id: 'g-d3', title: '检查说明 NOTE-DEMO', subtitle: 'R01 · 工况与限制', kind: 'document' },
      { id: 'g-d4', title: '历史问题工作', subtitle: '修订 02 · 有根来源', kind: 'work' },
    ],
  },
  {
    key: 'questions', title: '待核问题', color: '#d65c68', columns: 1,
    items: [
      { id: 'g-q1', title: '发生条件是否相同', subtitle: '比较温度与速度', kind: 'question' },
      { id: 'g-q2', title: '现有检查说明什么', subtitle: '保留工况与限制', kind: 'question' },
      { id: 'g-q3', title: '措施针对哪类现象', subtitle: '不扩展到全部分支', kind: 'question' },
      { id: 'g-q4', title: '更换记录能否说明完成', subtitle: '需核对目标状态', kind: 'question' },
    ],
  },
  {
    key: 'systems', title: '系统与部件', color: '#23a7bd', columns: 2,
    items: [
      { id: 'g-s1', title: '前起落架', subtitle: '技术对象', kind: 'component' },
      { id: 'g-s2', title: '机轮组件', subtitle: '对象关系', kind: 'component' },
      { id: 'g-s3', title: '转向系统', subtitle: '相关背景', kind: 'component' },
      { id: 'g-s4', title: '减振部件', subtitle: '检查对象', kind: 'component' },
    ],
  },
  {
    key: 'records', title: '观察与记录', color: '#8b6fc9', columns: 1,
    items: [
      { id: 'g-r1', title: '滑行现象记录', subtitle: 'EVT-DEMO-01 · 条件 X', kind: 'event' },
      { id: 'g-r2', title: '检查结果', subtitle: 'REC-DEMO-02 · 工况限定', kind: 'record' },
      { id: 'g-r3', title: '工程师补充', subtitle: '补充记录 · 尚待核对', kind: 'discussion' },
    ],
  },
];

const relations: SuiteGraphRelation[] = groups.flatMap((group: SuiteGraphGroup) =>
  group.items.map((item, index: number) => ({
    id: `preview:relation:${group.key}:${index}`,
    source: MATTER_ID,
    target: item.id,
    type: 'PREVIEW_REGISTERED',
    label: group.title,
  })),
);

function questionTarget(id: string, text: string): SuiteMatterGraphTarget {
  return {
    kind: 'question',
    workRef: WORK_REF,
    item: { itemId: id, text, basisRefs: [] },
  };
}

const targets = new Map<string, SuiteMatterGraphTarget>([
  [MATTER_ID, { kind: 'root' }],
  ['g-q1', questionTarget('g-q1', '两份现象记录的运行条件不同，应分别核对。')],
  ['g-q2', questionTarget('g-q2', '检查未见异常不能扩展为其他条件下均不存在问题。')],
  ['g-q3', questionTarget('g-q3', '措施范围必须与文件自身条件一起阅读。')],
  ['g-q4', questionTarget('g-q4', '更换记录与目标状态需要分别核对。')],
  ['g-d1', { kind: 'document', documentVersionId: 'preview:dv:sb:r02', familyId: 'preview:family:sb' }],
  ['g-d2', { kind: 'document', documentVersionId: 'preview:dv:ftd:r03', familyId: 'preview:family:ftd' }],
  ['g-d3', { kind: 'document', documentVersionId: 'preview:dv:note:r01', familyId: 'preview:family:note' }],
]);

for (const group of groups) {
  for (const item of group.items) {
    if (!targets.has(item.id)) targets.set(item.id, { kind: 'root' });
  }
}

export const SUITE_GRAPH_VISUAL_READ: SuiteMatterGraphRead = {
  graph: {
    id: MATTER_ID,
    title: '前起落架抖振问题',
    code: 'MAT-DEMO-032',
    picture: WL_ASSETS['gear-reference'],
    rootKind: 'matter',
    groups,
    relations,
  },
  targets,
  relationDetails: new Map(),
  notices: [],
  workRef: WORK_REF,
  historical: false,
  overviewStatus: 'CURRENT',
  missingEvidenceRefs: [],
};

export const SUITE_GRAPH_VISUAL_REVISION: EngineeringMatterWorkingRevisionReadModel = {
  matterWorkRevisionId: WORK_REF,
  matterId: MATTER_ID,
  workingRevision: 3,
  basedOnMatterRevisionId: 'preview:matter:revision:3',
  updateKind: 'INITIAL_SYNTHESIS',
  changeSummary: '补充说明明确了原检查的适用条件。',
  substantiveResultRef: 'preview:result:3',
  substantiveResultRevision: 3,
  state: {
    schemaVersion: 'wiselink.3_1.engineering_matter_working_state.v1',
    focus: { question: '不同工况下的抖振记录是否说明同一原因？', targetRefs: [] },
    substantiveResult: {
      resultRef: 'preview:result:3',
      resultRevision: 3,
      scope: { kind: 'ENGINEERING_MATTER', matterId: MATTER_ID },
      candidateOnly: true,
      evidence: [],
      content: {
        schemaVersion: 'wiselink.3_1.assessment_reading.v1',
        headline: '前起落架抖振问题',
        listBrief: '运行条件不同，需分别核对；检查结果仅覆盖已记录工况。',
        lead: '该事项汇集滑行阶段的现象记录、检查结果和相关技术说明。当前重点是区分发生条件，核对检查能够说明的范围。',
        claims: [
          { claimId: 'preview:claim:1', text: '两份现象记录的运行条件不同，应分别核对，不自动合并为同一原因。', basis: 'CONDITIONAL_INFERENCE', premises: [] },
          { claimId: 'preview:claim:2', text: '已有检查只覆盖所记录的工况；未见异常不扩展为其他条件下均不存在问题。', basis: 'CONDITIONAL_INFERENCE', premises: [] },
          { claimId: 'preview:claim:3', text: '措施与目标位置的实际状态分别保存，仍需完整构型核对。', basis: 'CONDITIONAL_INFERENCE', premises: [] },
        ],
        decisiveClaimIds: ['preview:claim:1', 'preview:claim:2'],
      },
    },
    openQuestions: [
      { itemId: 'preview:open:1', text: '补齐目标准确件号、记录时点与措施状态。', basisRefs: [] },
      { itemId: 'preview:open:2', text: '核对温度和速度条件是否影响现象比较。', basisRefs: [] },
    ],
    reviewConditions: [
      { itemId: 'preview:review:1', text: '新修订或完整构型记录到达后重新核对。', basisRefs: [] },
    ],
    substantiveInputs: [],
    coverage: [],
  },
  change: {
    changedBecause: null,
    addedClaimIds: [],
    replacedClaimIds: [],
    retiredClaims: [],
    explicitlyUnchangedClaimIds: [],
    openQuestionDelta: null,
    reviewConditionDelta: null,
    coverageUpdates: [],
  },
  source: null,
  createdAt: '2026-06-28T09:00:00.000Z',
};

export const SUITE_GRAPH_VISUAL_TIMELINE: SuiteGraphTimelineEvent[] = [
  ['2026-04-08', '问题线索进入', '记录现象和来源，尚未认定共同原因。', MATTER_ID],
  ['2026-04-15', '相关资料归集', '保留各文件身份与版本，按问题组织。', 'g-d1'],
  ['2026-05-06', '形成初始分析', '解释问题分支与现有资料的作用。', 'g-q1'],
  ['2026-05-28', '工程师补充记录', '补充当前对象情况，核对分析前提。', 'g-r3'],
  ['2026-06-12', '来源修订到达', '本文件改版与其他参考资料分开比较。', 'g-d2'],
  ['2026-07-03', '条件范围复看', '继续核对温度、速度和目标构型。', 'g-q2'],
].map(([date, title, detail, nodeId], index: number) => ({
  id: `preview:event:${index}`,
  kind: index === 3 ? 'work' : 'source',
  date,
  sortKey: Date.parse(`${date}T00:00:00.000Z`),
  title,
  detail,
  nodeId,
  pins: null,
  statement: null,
  sourceLabel: null,
}));
