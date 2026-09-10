import type { AtlasView } from './atlas-model';
export interface GuideScene {
  id: string;
  title: string;
  caption: string;
  view: AtlasView;
  seconds: number;
  focus?: string;
  focusArea?: 'review-answer';
  target: 'graph' | 'reading' | 'classification' | 'source';
}
export interface GuideTrack {
  id: string;
  title: string;
  scenes: GuideScene[];
}
export const atlasTitle =
  '从一份文件，看清一件事；从每项认识，了解机队技术全貌。';
const scene = (
  id: string,
  title: string,
  caption: string,
  view: AtlasView,
  seconds: number,
  focus?: string,
): GuideScene => ({
  id,
  title,
  caption,
  view,
  seconds,
  focus,
  focusArea: id === 'correction' ? 'review-answer' : undefined,
  target:
    view === 'source'
      ? 'source'
      : view === 'classification'
        ? 'classification'
        : [
              'documents',
              'family',
              'domain',
              'matter',
              'panorama',
              'source',
            ].includes(view)
          ? 'graph'
          : 'reading',
});
const scenes = {
  start: scene(
    'start',
    '从日常工程文件开始',
    'WiseLink 围绕文件背后的工程事项，组织调查资料、技术说明、历史认识和相关记录，帮助工程师看清问题、形成判断，再了解机队整体。',
    'documents',
    18,
  ),
  document: scene(
    'document',
    '这份文件为何值得关注',
    '先看文件主题、版本、问题现象、涉及范围和主要措施。材料被找到，并不等于正文已经读到或用于判断。',
    'documents',
    18,
  ),
  exact: scene(
    'exact',
    '核对引用的确切版本',
    'SB 明确引用 FTD R3，就核对 R3。库内已有 R4，也不能自动替换该引用。RB 是独立资料，附件归属于具体版本。',
    'documents',
    18,
    'ftd-r3',
  ),
  family: scene(
    'family',
    '看清版本与附件归属',
    '文档族帮助理解修订脉络；当前库内版本、引用目标版本和评估依据版本各自保留。',
    'family',
    16,
    'sb-r1',
  ),
  source: scene(
    'source',
    '深入原文与来源',
    '来源位置帮助核对原文。目标正文未取得时，只显示引用出现位置，不把引用文本包装成目标正文。',
    'source',
    17,
    'sb-r1',
  ),
  gather: scene(
    'gather',
    '围绕事项归集资料',
    '调查说明、历史文件、相关措施、已有意见和可取得的对象记录共同组成背景。每份资料要说明它对理解事项有什么贡献。',
    'materials',
    20,
  ),
  context: scene(
    'context',
    '这些资料共同说明什么',
    '评估包需要讲清问题脉络、资料之间的联系、对象范围、原有认识和重要未知，而不是把独立摘要堆起来后直接下结论。',
    'materials',
    21,
  ),
  initial: scene(
    'initial',
    '形成有依据的初始综合评估',
    '连贯说明问题、措施针对性、适用前提和决定性条件。候选意见供工程师核对，并不自动成为实施决定。',
    'initial',
    20,
  ),
  review: scene(
    'review',
    '与工程师共同核对',
    '工程师可以追问、纠正前提或补充记录。共同理解是核对事实、范围和措施边界；有意义的分歧与证据需求继续保留。',
    'review',
    20,
  ),
  correction: scene(
    'correction',
    '标准 A 是否意味着改进完成',
    '记录能说明软件标准，不一定证明整项措施完成。修订新增的子集条件仍待核实；另一类现象继续作为独立问题分析。',
    'review',
    21,
  ),
  synthesis: scene(
    'synthesis',
    '重新综合本轮认识',
    '把已澄清内容吸收到更新意见中，说明哪些认识改变、哪些仍成立、哪些仍待核。普通术语解释只增加回答，关键新材料或前提纠正才需要更新有关分析。',
    'synthesis',
    20,
  ),
  library: scene(
    'library',
    '回到机队技术事项速览',
    '按事项快速比较问题、背景、措施与前提、当前认识、我方评估进展和后续关注。资料提出的措施、我方意见、实际实施情况分开呈现。',
    'library',
    18,
  ),
  classification: scene(
    'classification',
    '分类是一层骨架',
    'ATA 与其他分类帮助找到资料；技术对象、功能问题、文档事项和观察范围是不同锚点。同章同号不会自动产生实际关系或适用性。',
    'classification',
    17,
  ),
  domain: scene(
    'domain',
    '从技术对象理解共同背景',
    '可从计算机、显示等技术领域观察共同背景和跨专业联系。FMC 只是一个入口，不能固定成唯一入口。',
    'domain',
    17,
  ),
  panorama: scene(
    'panorama',
    '了解机队技术全貌',
    '图谱把各事项背景、措施、认识和进展联系起来。先建立资料支持的认识，随着构型、故障、执行和可靠性记录接入再丰富实际状态。',
    'panorama',
    19,
  ),
  matter: scene(
    'matter',
    '深入一项工程认识',
    '事项说明、资料库速览和详细评估应使用同一个已保存结果。打开页面不重新调用模型生成另一份摘要。',
    'matter',
    17,
  ),
  runtime: scene(
    'runtime',
    '从接收文件到更新认识',
    '接收文件、读懂原文、汇集资料、建立背景、形成初评、工程师核对、补充记录、重新综合，最后更新速览与整体联系。这里是只读示例，没有启动真实分析。',
    'runtime',
    16,
  ),
  finish: scene(
    'finish',
    '保持依据可追溯',
    '快速了解整体，也能随时深入依据。没有实施记录就保留未核实；没有取得故障记录不能解释成机队没有故障。',
    'library',
    17,
  ),
};
export const guideTracks: GuideTrack[] = [
  {
    id: 'overview',
    title: '从文件到机队技术全貌',
    scenes: [
      'start',
      'document',
      'gather',
      'context',
      'initial',
      'review',
      'synthesis',
      'library',
      'classification',
      'domain',
      'matter',
      'panorama',
      'finish',
    ].map((id) => scenes[id as keyof typeof scenes]),
  },
  {
    id: 'onboarding',
    title: '完成一次工程事项评估与复核',
    scenes: [
      'document',
      'exact',
      'source',
      'family',
      'gather',
      'context',
      'initial',
      'review',
      'correction',
      'synthesis',
      'matter',
      'library',
      'classification',
      'domain',
      'panorama',
      'finish',
    ].map((id) => scenes[id as keyof typeof scenes]),
  },
  {
    id: 'operation',
    title: '系统怎样形成并更新评估意见',
    scenes: [
      'document',
      'gather',
      'context',
      'initial',
      'review',
      'correction',
      'synthesis',
      'matter',
      'library',
      'classification',
      'runtime',
      'finish',
    ].map((id) => scenes[id as keyof typeof scenes]),
  },
];
// The user's revised timings are presentation dwell time, not model execution time.
[243, 297, 205].forEach((seconds, index) => {
  const track = guideTracks[index];
  const base = Math.floor(seconds / track.scenes.length);
  const rest = seconds % track.scenes.length;
  track.scenes = track.scenes.map((s, i) => ({
    ...s,
    seconds: base + (i < rest ? 1 : 0),
  }));
});
