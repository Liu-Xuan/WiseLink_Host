import type { EngineeringMatterDirectoryResponse } from '@shared/api.interface';
import type { EngineeringMatterWorkspaceRead } from '@client/src/api/engineering-matter';
import { matterWorkRoute } from '@client/src/features/matter/matter-navigation';
import { TRINITY_STAGE_META, TRINITY_KNOWLEDGE_STAGE_META } from './trinity-model';
import type { TrinityAvailability, TrinityMatter, TrinitySituationData } from './trinity-types';

export interface AuthorizedTrinityProjection {
  data: TrinitySituationData;
  knowledgeTargets: Record<string, string>;
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
    // A saved assessment is evidence of associated analysis, never a completion status.
    activeStages: row.result ? ['assess'] : [],
  })) : [];
  const knowledgeTargets: Record<string, string> = {};
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
      activeStages: hasAnalysis ? ['assess'] : [],
    };
    const existing = matters.findIndex((row) => row.id === matter.matterId);
    if (existing < 0) matters.push(saved); else matters[existing] = saved;
    if (current && hasAnalysis) {
      const id = current.matterWorkRevisionId;
      knowledge.push({
        id, matter: matter.matterId, phase: 'assess', title: saved.brief,
        version: `工作修订 ${current.workingRevision}`, status: coverage,
        reuse: [], reuseCountKnown: false,
      });
      knowledgeTargets[id] = matterWorkRoute(matter.matterId, id);
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
        lifecycle: 'partial',
        knowledge: 'partial',
        events: 'partial',
      },
      stages: TRINITY_STAGE_META, knowledgeStages: TRINITY_KNOWLEDGE_STAGE_META,
      matters, events: [], knowledge,
    },
    knowledgeTargets,
  };
}
