import type { EngineeringMatterDirectoryResponse } from '@shared/api.interface';
import type { EngineeringMatterWorkspaceRead } from '@client/src/api/engineering-matter';
import { matterWorkRoute } from '@client/src/features/matter/matter-navigation';
import { matterReadingReturnParams } from '@client/src/features/matter/reading-return';
import {
  TRINITY_SOURCE_CATEGORY_META,
  TRINITY_STAGE_META,
} from './trinity-model';
import type {
  TrinityAvailability,
  TrinityMatter,
  TrinityReviewConditionItem,
  TrinitySituationData,
} from './trinity-types';

export interface AuthorizedTrinityProjection {
  data: TrinitySituationData;
  knowledgeTargets: Record<string, string>;
  sourceTargets: Record<string, string>;
}

function directoryAttention(
  result: EngineeringMatterDirectoryResponse['items'][number]['result'],
): boolean | null {
  if (result?.roundCompletion === 'COMPLETE_WITH_OPEN_QUESTIONS') return true;
  if (result?.roundCompletion === 'COMPLETE') return false;
  return null;
}

/** Directory reads contain saved summaries, not fleet identity, events, or lifecycle status. */
export function projectAuthorizedSituation(
  items: EngineeringMatterDirectoryResponse['items'],
  availability: TrinityAvailability,
  focus: EngineeringMatterWorkspaceRead | null = null,
  directoryExhausted = false,
): AuthorizedTrinityProjection {
  const readable = availability === 'complete' || availability === 'partial';
  let reviewConditions: TrinityReviewConditionItem[] | null | undefined;
  const matters: TrinityMatter[] = readable ? [...new Map(items.map((row) => [row.matterId, row])).values()].map((row) => ({
    id: row.matterId,
    code: '',
    title: row.title,
    fleet: '机型范围未核实',
    ata: '未核实',
    tag: directoryAttention(row.result) === true ? '待核' : '已保存',
    status: row.result ? '已保存综合；最新工作覆盖需展开核对' : '尚未取得可读综合',
    brief: row.result?.listBrief || '请进入事项核对已保存工作和关联资料。',
    next: '展开已保存工作，核对条件、来源与综合覆盖。',
    attention: directoryAttention(row.result),
    synthesisPending: row.overallStatus === 'STALE' ? true
      : row.overallStatus === 'CURRENT' ? false : null,
    // A saved summary proves an association with synthesis, never completion.
    activeAssessmentStages: row.result ? ['synthesis'] : [],
  })) : [];
  const knowledgeTargets: Record<string, string> = {};
  const sourceTargets: Record<string, string> = {};
  const sources: TrinitySituationData['sources'] = [];
  const knowledge: TrinitySituationData['knowledge'] = [];
  if (readable && focus) {
    const { matter, working } = focus;
    const current = working.current;
    const work = current?.state.problemWork;
    const result = current?.state.substantiveResult;
    const hasAnalysis = Boolean(work || result);
    const conditions = current?.state.reviewConditions ?? [];
    const questions = current?.state.openQuestions ?? [];
    const coverage = !current ? '尚未取得已保存工作' : !work ? '综合覆盖尚未核实' :
      work.overviewStatus === 'STALE' ? '综合尚未纳入最新问题工作' :
      work.overviewStatus === 'NOT_AVAILABLE' ? '问题工作已保存，尚无综合' : '综合覆盖当前问题工作；不代表正式采用';
    const saved: TrinityMatter = {
      id: matter.matterId, code: '', title: matter.title,
      fleet: '机型范围未核实', ata: '未核实', tag: '待核', status: coverage,
      brief: work?.headline || result?.content.headline || matter.title,
      next: conditions[0]?.text || questions[0]?.text || (working.pendingInputs.length
        ? '有输入尚未纳入已保存工作，请核对其来源和范围。' : '未单独保存后续关注条件。'),
      attention: Boolean(conditions.length || questions.length || working.pendingInputs.length || work?.overviewStatus === 'STALE'),
      synthesisPending: !current ? null
        : work?.overviewStatus === 'STALE' || work?.overviewStatus === 'NOT_AVAILABLE'
          ? true
          : work?.overviewStatus === 'CURRENT' ? false : null,
      activeAssessmentStages: [
        ...(current?.state.focus.question ? ['question'] : []),
        ...(matter.catalog.entries.length || matter.materials?.length ? ['conditions'] : []),
        ...(hasAnalysis ? ['analysis'] : []),
        ...(result && work?.overviewStatus !== 'NOT_AVAILABLE' ? ['synthesis'] : []),
        ...(current?.source && 'reviewTurnId' in current.source &&
          current.source.reviewTurnId ? ['review'] : []),
        ...(current ? ['update'] : []),
      ],
    };
    const existing = matters.findIndex((row) => row.id === matter.matterId);
    if (existing < 0) matters.push(saved); else matters[existing] = saved;
    // Saved review conditions are candidate work content, projected only with
    // the exact work revision that owns them; never re-read per directory row.
    reviewConditions = current ? current.state.reviewConditions.map((item) => ({
      itemId: item.itemId,
      text: item.text,
      basisRefs: item.basisRefs,
      when: item.when,
      matterId: matter.matterId,
      matterWorkRevisionId: current.matterWorkRevisionId,
      workingRevision: current.workingRevision,
    })) : null;
    if (current && hasAnalysis) {
      const id = current.matterWorkRevisionId;
      knowledge.push({
        id, matter: matter.matterId, phase: 'assess', title: saved.brief,
        version: `工作修订 ${current.workingRevision}`, status: coverage,
        reuse: [], reuseCountKnown: false,
      });
      knowledgeTargets[id] = matterWorkRoute(matter.matterId, id);
      const sourceId: string = `work:${id}`;
      sources.push({
        id: sourceId,
        matter: matter.matterId,
        category: 'history',
        title: saved.brief,
        version: `工作修订 ${current.workingRevision}`,
        contribution: current.changeSummary || '保留当前已保存认识及其准确工作身份。',
      });
      sourceTargets[sourceId] = matterWorkRoute(matter.matterId, id);
    }
    const materialByVersion: Map<string, { contribution: string }> = new Map(
      (matter.materials ?? [])
        .filter((material) => material.kind !== 'EXPECTED' &&
          material.disposition === 'INCLUDED')
        .map((material) => [material.documentVersionId, {
          contribution: material.contribution,
        }]),
    );
    const excludedVersionIds: Set<string> = new Set(
      (matter.materials ?? [])
        .filter((material) => material.kind !== 'EXPECTED'
          && material.disposition === 'EXCLUDED')
        .map((material) => material.documentVersionId),
    );
    for (const entry of matter.catalog.entries) {
      const versionId: string = entry.document.documentVersionId;
      if (excludedVersionIds.has(versionId)) continue;
      const sourceId: string = `document:${versionId}`;
      if (sources.some((source) => source.id === sourceId)) continue;
      sources.push({
        id: sourceId,
        matter: matter.matterId,
        category: 'documents',
        title: entry.document.documentCode,
        version: entry.document.businessRevision,
        contribution: materialByVersion.get(versionId)?.contribution ??
          '已登记为事项资料；具体作用需进入原文和事项材料核对。',
      });
      const returnParams: URLSearchParams = matterReadingReturnParams(
        matter.matterId,
        versionId,
        'brief',
        current?.matterWorkRevisionId ?? '',
      );
      sourceTargets[sourceId] =
        `/document-versions/${encodeURIComponent(versionId)}?${returnParams}`;
    }
  }
  return {
    data: {
      meta: { name: '当前授权工程事项', asOf: '', origin: 'AUTHORIZED_SCOPE', currentHostVerified: false },
      // Current APIs do not provide complete lifecycle/knowledge/event coverage, even on the final directory page.
      availability: readable ? 'partial' : availability,
      coverage: {
        matterTotal: readable && directoryExhausted ? 'complete' : readable ? 'partial' : availability,
        matters: readable ? 'partial' : availability,
        assessment: 'partial',
        sources: 'partial',
        knowledge: 'partial',
        events: 'partial',
      },
      stages: TRINITY_STAGE_META,
      sourceCategories: TRINITY_SOURCE_CATEGORY_META,
      matters, sources, events: [], knowledge,
      reviewConditions,
    },
    knowledgeTargets,
    sourceTargets,
  };
}
