import type {
  DerivedSummaryMember,
  DerivedSummaryScopeSelection,
} from '@shared/derived-summary.interface';
import type { WikiVersions } from './hierarchical-wiki-demand';
import { summaryError } from './derived-summary.validation';

export type WikiLevel = DerivedSummaryScopeSelection['kind'];

/** Coarse classifications stay in the original membership directory. Only the
 * ATA4 layer consumes saved leaf work directly; parents consume saved children. */
export function wikiDirectVersions(
  level: WikiLevel,
  memberships: Array<{ key: string; member: DerivedSummaryMember }>,
): WikiVersions {
  return level === 'ATA4'
    ? Object.fromEntries(memberships.map((item) => [item.key, item.member]))
    : {};
}

export function assertWikiLayerMembers(
  level: WikiLevel,
  scope: DerivedSummaryScopeSelection,
  members: DerivedSummaryMember[],
): void {
  if (
    level !== scope.kind ||
    !['ATA4', 'ATA2', 'FLEET'].includes(level) ||
    members.some(
      (member) => (member.kind === 'DERIVED_SUMMARY') !== (level !== 'ATA4'),
    )
  )
    throw summaryError('WIKI_LAYER_MEMBERS_INVALID');
}

export function wikiLayerInstruction(level: WikiLevel): string {
  const basis =
    level === 'ATA4'
      ? '本层汇总对应工程文档解读和工程事项已保存的完整成果。'
      : level === 'ATA2'
        ? '本层只以所属四位ATA Wiki的精确已保存正文形成综合。'
        : '本层只以所属两位ATA Wiki的精确已保存正文形成机型综合。';
  // This instruction already travels in the sealed task; existing saved work is never rewritten for layout.
  const reading = [
    '以正式工程事项为基本条目，像资料库目录：同一事项的FTD、SL/SB、评估和历史意见收在一条，各自背景、分析和措施留在该事项内，不打散重组成一份按背景或措施分类的大报告，也不把每个文件或子Wiki各建一条。',
    'headline说明本层工程范围；listBrief简短概括已有条目与主要进展，不复述标题，不以层级来源、候选身份或综合过程开头。',
    'Host在instruction末尾的HOST_WIKI_MATTER_CATALOG区块封存正式事项归属，这是控制元数据，不是工程证据或改写成员正文。只按entries中matterId逐条输出，每个事项恰好一条，body用“## 事项：matterId | 事项名称”开始；事项名称取Host登记title，随后可保留准确引用，不用文件、ATA子层综合或处理身份代替事项。',
    '相同标题但matterId不同必须分开；同一matterId跨文件和子Wiki只出现一条。不得自行创建、分配、改绑或按标题相似度决定正式事项归属；bindings指明准确成员、叶子和sourceRefs，关联范围与contribution保留原义。',
    '每条只能引用该事项bindings中memberRef和sourceRefs；父层每条还必须引用至少一个对应sourceRefs，不能仅用跨多个事项的子Wiki引用证明归属。unbound中的资料统一放“## 未归属资料”，不假造事项或混入其他事项，保留准确引用与入口。',
    '子层旧正文尚未按事项组织或来源归属不明时，通过既有READ_SOURCES读取对应sourceRefs核对后再整理，不按标题或段落相似度分派；材料不足则保留具体待核事实，不重新选版本。',
    '每条下用“### 当前状态”“### FTD / SL / SB”陈述该条目已有进展、是否关闭及关联文件情况；再按实际内容使用“### 背景”“### 分析”“### 临时措施”“### 最终措施”“### 工程条件与待核事项”“### 依据与来源”。没有实质内容的栏目可省略。',
    '父层按Host事项身份聚合所属子层成果及各自状态；共享来源可支持多个正式事项，但不能因此合并事项或算作独立佐证。保留不同构型、版本和实际差异，不能把ATA章节或同源次数当作事项或佐证。',
    'REFERENCE_CONTEXT只表示该事项已授权保存工作引用的参考资料，不是正式成员归属，不能反推、创建或合并事项；其工程内容、准确版本和历史意见仍保留在对应事项中，共享参考来源始终只计同一根来源。',
    '当前状态和FTD/SL/SB情况只写资料明确记载的事实；未记载则简记“未记载”，不猜测已关闭、已发布或已实施。已有FTD不代表问题关闭，文件引用或计划发布不代表已有SL/SB；TBD、计划日期、否定与未核范围保留原义。',
    'Host的Matter ACTIVE、WorkItem FINISHED和文档COMMITTED、解析PUBLISHED只是技术生命周期，不代表厂家工程问题已关闭、FTD或SL/SB已正式发布；工程状态须由本条准确来源事实支持。',
    '当前状态和文件情况用于紧凑目录，简短直述该条工程进展；Reference Categories、文件生成时间、来源处理说明和出口声明放在“依据与来源”，不混进状态。原文对工程强制性、适用性和措施前提的实质限定仍紧邻相关判断保留，不能当作处理说明移走。',
    '不写“本层为候选综合”“保留子层身份及其全部继承限制”“本层为派生候选，非新增独立证据”“以ATA子层候选为唯一来源综合”等来源套话；这些身份和溯源由Host记录与入口表达，正文直接从工程条目开始。',
    '决定判断是否成立的构型、软件版本、数值、期限、否定、例外、未知与分歧紧邻相应结论或行动完整说明，不只放在文末或依据段；不得为简洁删掉。',
    '每条措施只写该条材料支持的行动、下一步与前提；材料不足时明确需要补核的具体事实，不编造结论或行动。',
    '未取得的数据写成工程师能理解的具体缺口，例如装机清单或软件版本未取得，不用工具或接口状态代替工程含义。',
    '依据段按需展开解释、准确引用和原文入口；生成记录由Host展示。正文不反复铺陈“仅供参考、非完整评估、不可代替”等通用防御性或流程说明。',
    '来源属性、范围、版本或尚未覆盖的变化确实影响本次判断时，在相关判断旁具体说明；保留既有引用和正式采用边界。',
  ].join('');
  return `${basis}${reading}逐条对照本次全部成员的共同条件、差异、反证、限制及未决事项；正文引用实际使用的精确成员，使子层和原证据能够逐级追溯。相同内容、重复引文及不同版本中的相同原文只表达一次，在该表述的既有引用中保留实际已读的各准确版本和出处集合；不合并来源身份或删除原件历史。上下层转述、历史意见和同源多次引用不算独立佐证，不因重复次数或版本数量抬高置信度或强化风险判断。实际版本差异、条件、例外、否定和冲突须分别说明，未比较的范围保留限制。文档版本选择由Host已有算法决定，不由模型按日期、措辞或相似度重新选择。这些规则内部执行，正文直接简洁陈述事实与必要出处，不另加去重、同源或自我强化的防御性说明；只比较实际内容差异，既有原件或授权缺口仍按需呈现。根来源只计一次；下层Wiki是派生成果，不是新增独立证据。必要时才按已登记引用回溯原证据，不把未细分的原资料混入父层正文。`;
}
