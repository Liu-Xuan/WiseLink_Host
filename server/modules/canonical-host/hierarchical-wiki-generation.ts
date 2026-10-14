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
  return `${basis}逐一对照本次全部成员的共同条件、差异、反证、限制及未决事项；正文引用实际使用的精确成员，使子层和原证据能够逐级追溯。根来源只计一次；下层Wiki是派生成果，不是新增独立证据。必要时才按已登记引用回溯原证据，不把未细分的原资料混入父层正文。候选不是正式采用。`;
}
