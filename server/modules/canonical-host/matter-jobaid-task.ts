import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { JobAidProblemWorkContent } from '@shared/jobaid-problem-assessment.interface';
import type { EngineeringMatterWorkingInputBinding, EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import type { EngineeringMatterAttemptTrigger } from '../action-attempt/action-attempt-envelope.types';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { JOBAID_CORE_METHOD_REFS, JOBAID_METHOD_BINDING, JOBAID_METHOD_EVIDENCE } from './jobaid-method-pack';
import { jobAidProblemModelWorkContent } from './jobaid-problem-task';
import { overallModelEvidenceRegistry } from './overall-assessment-reading';

export const MATTER_JOBAID_TASK_SCHEMA = 'wiselink.matter-jobaid-task.v2' as const;

/** Called under the reservation transaction after Host authorization and version CAS. */
export function buildMatterJobAidTask(input: {
  matterId: string;
  matterRevisionId: string;
  actorUserId: string;
  title: string;
  inputs: EngineeringMatterWorkingInputBinding[];
  trigger: EngineeringMatterAttemptTrigger;
  previous: EngineeringMatterWorkingRevisionReadModel | null;
}) {
  const prior = input.previous?.state.problemWork ?? null;
  const registry = new Map<string, AssessmentEvidence>();
  for (const evidence of [...JOBAID_METHOD_EVIDENCE, ...(prior?.evidence ?? [])]) {
    const existing = registry.get(evidence.evidenceRef);
    if (existing && canonicalJson(existing) !== canonicalJson(evidence))
      throw new Error('JOBAID_PRIOR_SOURCE_CHANGED');
    registry.set(evidence.evidenceRef, structuredClone(evidence));
  }
  const sourceCatalog = [...registry.values()];
  const initiallyDeliveredRefs = [...new Set([...JOBAID_CORE_METHOD_REFS, ...(prior?.readSourceRefs ?? [])])];
  if (initiallyDeliveredRefs.some((ref) => !registry.has(ref))) throw new Error('JOBAID_PRIOR_SOURCE_MISSING');
  const historyReview: JobAidProblemWorkContent['historyReview'] = {
    required: input.previous !== null,
    priorAssessmentRefs: input.previous ? [input.previous.matterWorkRevisionId] : [],
    engineeringDocumentRefs: prior?.historyReview.engineeringDocumentRefs ?? [],
    coverage: input.previous ? 'PARTIAL' : 'NOT_REQUIRED',
    limitation: input.previous ? '已取得精确前次工作；外部正式工程文件和更早历史未声明齐全。' : null,
  };
  return {
    schemaVersion: MATTER_JOBAID_TASK_SCHEMA,
    actorUserId: input.actorUserId,
    sourceCatalog,
    initiallyDeliveredRefs,
    modelInput: {
      schemaVersion: MATTER_JOBAID_TASK_SCHEMA,
      subject: { kind: 'ENGINEERING_MATTER' as const, matterId: input.matterId, matterRevisionId: input.matterRevisionId },
      methodBinding: structuredClone(JOBAID_METHOD_BINDING),
      title: input.title,
      focus: input.previous?.state.focus ?? null,
      trigger: structuredClone(input.trigger),
      availableDocuments: [...new Set(input.inputs.map((binding) => binding.documentVersionId))].map((documentVersionId) => ({
        documentVersionId,
        inputIds: input.inputs.filter((binding) => binding.documentVersionId === documentVersionId).map((binding) => binding.inputId),
        readingScope: 'NOT_READ_THIS_ATTEMPT' as const,
      })),
      availableSources: sourceCatalog.map((item) => ({ ref: item.evidenceRef, kind: item.kind,
        title: item.title, versionLabel: item.versionLabel, locator: 'locator' in item ? item.locator : null })),
      deliveredEvidence: overallModelEvidenceRegistry(sourceCatalog.filter((item) => initiallyDeliveredRefs.includes(item.evidenceRef))),
      previousWork: input.previous ? {
        workRevisionRef: input.previous.matterWorkRevisionId,
        workRevision: input.previous.workingRevision,
        content: prior ? jobAidProblemModelWorkContent(prior) : null,
        legacySummary: prior ? null : input.previous.state.substantiveResult,
        openQuestions: structuredClone(input.previous.state.openQuestions),
        reviewConditions: structuredClone(input.previous.state.reviewConditions),
      } : null,
      expectedWorkRevision: input.previous?.workingRevision ?? 0,
      historyReview,
      capabilities: [
        { capability: 'registered_source_reading', status: 'NOT_CONNECTED' as const,
          impact: '事项来源工具尚未接通；目录中的文档不等于已读正文。' },
        { capability: 'fleet_configuration', status: 'NOT_CONNECTED' as const,
          impact: '未取得当前对象的受控装机、执行或构型查询。' },
        { capability: 'reliability_history', status: 'NOT_CONNECTED' as const,
          impact: '未取得可靠性查询；不能由缺失数据推定零事件。' },
        { capability: 'knowledge_retrieval', status: 'NOT_CONNECTED' as const,
          impact: '未取得本次检索回执；历史候选不等于新增来源事实。' },
      ],
    },
  };
}
