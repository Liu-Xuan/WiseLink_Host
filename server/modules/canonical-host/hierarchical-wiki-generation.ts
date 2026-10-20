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
  return `${basis}逐一对照本次全部成员的共同条件、差异、反证、限制及未决事项；正文引用实际使用的精确成员，使子层和原证据能够逐级追溯。标题直接写工程问题与对象，不冠以“候选综合”“未完成分类”或层级继承说明；listBrief与正文直接呈现已有工程认识。相同内容、重复引文及不同版本中的相同原文只表达一次，在该表述的既有引用中保留实际已读的各准确版本和出处集合；不合并来源身份或删除原件历史。上下层转述、历史意见和同源多次引用不算独立佐证，不因重复次数或版本数量抬高置信度或强化风险判断。实际版本差异、条件、例外、否定和冲突须分别说明，未比较的范围保留限制。这些规则内部执行，正文直接简洁陈述事实与必要出处，不另加去重、同源或自我强化的防御性说明；只比较实际内容差异，既有原件或授权缺口仍按需呈现。根来源只计一次；下层Wiki是派生成果，不是新增独立证据。必要时才按已登记引用回溯原证据，不把未细分的原资料混入父层正文。候选/正式采用边界由Host控制字段保留，不作为工程标题或正文中的重复声明。已保存来源版本、成员数量、partial状态、解析offset、权限或capability状态是内部记录，不逐层复制进正文或limitations；若确实缺少装机、可靠性、原文段落或措施验证资料，只说明缺少什么、对工程判断有什么影响。参考属性、TBD、日期、机型差异、否定、适用条件和workaround实际缺口必须保留；继承的工程限制沿用已给原句，只保留一次，不另写同义改述；仅追加本层新发现的实质条件，不能为了简洁隐去。`;
}
