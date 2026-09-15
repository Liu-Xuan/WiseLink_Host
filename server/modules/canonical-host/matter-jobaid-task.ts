import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { JobAidProblemWorkContent } from '@shared/jobaid-problem-assessment.interface';
import type { EngineeringMatterWorkingInputBinding, EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import type { EngineeringMatterAttemptTrigger } from '../action-attempt/action-attempt-envelope.types';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { JOBAID_CORE_METHOD_REFS, JOBAID_METHOD_BINDING, JOBAID_METHOD_EVIDENCE } from './jobaid-method-pack';
import { jobAidProblemModelWorkContent } from './jobaid-problem-task';
import { overallModelEvidenceRegistry } from './overall-assessment-reading';
import { engineeringMatterPendingInputs } from './engineering-matter-working-state';
import type { MatterWorkReferenceRequest } from './matter-work-reference';

export const MATTER_JOBAID_TASK_SCHEMA = 'wiselink.matter-jobaid-task.v2' as const;

export interface MatterIssueCorrectionPurpose {
  kind: 'ENGINEERING_ISSUE_CORRECTION';
  expectedWorkRef: string;
  issueKey: string;
  correctionReason: string;
  evidenceRefs: string[];
}

export interface MatterOverviewCorrectionPurpose {
  kind: 'ENGINEERING_OVERVIEW_CORRECTION';
  expectedWorkRef: string;
  correctionReason: string;
  evidenceRefs: string[];
}

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
  if (input.previous && !prior)
    throw new Error('JOBAID_PREVIOUS_WORK_INCOMPLETE');
  const methodBinding = prior?.methodBinding ?? JOBAID_METHOD_BINDING;
  const registry = new Map<string, AssessmentEvidence>();
  for (const evidence of [...JOBAID_METHOD_EVIDENCE, ...(prior?.evidence ?? [])]) {
    const existing = registry.get(evidence.evidenceRef);
    if (existing && canonicalJson(existing) !== canonicalJson(evidence))
      throw new Error('JOBAID_PRIOR_SOURCE_CHANGED');
    registry.set(evidence.evidenceRef, structuredClone(evidence));
  }
  const sourceCatalog = [...registry.values()];
  const initiallyDeliveredRefs = [...new Set([...JOBAID_CORE_METHOD_REFS, ...(prior?.readSourceRefs ?? []),
  ])];
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
    correction: null as MatterIssueCorrectionPurpose | MatterOverviewCorrectionPurpose | null,
    overviewCorrection: null as MatterOverviewCorrectionPurpose | null,
    referenceWorks: [] as MatterWorkReferenceRequest[],
    recovery: null as { attemptRef: string; inputHash: string } | null,
    actorUserId: input.actorUserId,
    sourceCatalog,
    initiallyDeliveredRefs,
    modelInput: {
      schemaVersion: MATTER_JOBAID_TASK_SCHEMA,
      subject: { kind: 'ENGINEERING_MATTER' as const, matterId: input.matterId, matterRevisionId: input.matterRevisionId },
      methodBinding: structuredClone(methodBinding),
      title: input.title,
      knownCorrections: (input.previous?.correctionNotices ?? []).map(notice => ({
        issueKey: notice.issueKey, reason: notice.reason, correctedWorkRef: notice.correctedWorkRef,
        attemptStatus: notice.attemptStatus, unchanged: notice.unchanged === true,
      })),
      knownOverviewCorrections: structuredClone(input.previous?.overviewCorrectionNotices ?? []),
      overviewSourceWork: structuredClone(input.previous?.overviewSourceWork ?? null),
      overviewCorrection: null as MatterOverviewCorrectionPurpose | null,
      focus: input.previous?.state.focus ?? null,
      trigger: structuredClone(input.trigger),
      sourceChanges: engineeringMatterPendingInputs(input.previous?.state ?? null, input.inputs),
      availableDocuments: [...new Set([...input.inputs.map((binding) => binding.documentVersionId),
        ...(prior?.evidence ?? []).flatMap(item => item.kind === 'DOCUMENT_PASSAGE' ? [item.documentVersionId] : []),
      ])].map((documentVersionId) => ({
        documentVersionId,
        originalReadRef: `DOCUMENT_VERSION:${documentVersionId}:original:0`,
        boundOriginal: input.inputs.find(binding => binding.documentVersionId === documentVersionId)?.original ?? null,
        inputIds: input.inputs.filter((binding) => binding.documentVersionId === documentVersionId).map((binding) => binding.inputId),
        readingScope: 'NOT_READ_THIS_ATTEMPT' as const,
      })),
      availableSources: sourceCatalog.map((item) => ({ ref: item.evidenceRef, kind: item.kind,
        title: item.title, versionLabel: item.versionLabel, locator: 'locator' in item ? item.locator : null })),
      deliveredEvidence: overallModelEvidenceRegistry(sourceCatalog.filter((item) => initiallyDeliveredRefs.includes(item.evidenceRef))),
      previousWork: input.previous ? {
        workRevisionRef: input.previous.matterWorkRevisionId,
        workRevision: input.previous.workingRevision,
        overviewStatus: prior?.overviewStatus ?? 'NOT_AVAILABLE',
        content: prior ? jobAidProblemModelWorkContent(prior) : null,
        openQuestions: structuredClone(input.previous.state.openQuestions),
        reviewConditions: structuredClone(input.previous.state.reviewConditions),
      } : null,
      expectedWorkRevision: input.previous?.workingRevision ?? 0,
      historyReview,
      referenceWorks: (input.previous?.referenceWorkNotices ?? []).map(notice => ({
        matterId: notice.sourceWork.subjectId, workRef: notice.sourceWork.workRef, issueKey: notice.sourceWork.issueKey,
        purpose: '本事项既有工作实际引用的候选参考；本轮仍需按当前用途核对。', evidenceRef: notice.evidenceRef,
        overviewStatus: notice.overviewStatus, correctionNotices: structuredClone(notice.correctionNotices),
        overviewCorrectionNotices: structuredClone(notice.overviewCorrectionNotices ?? []),
      })) as Array<MatterWorkReferenceRequest & { evidenceRef: string; overviewStatus: JobAidProblemWorkContent['overviewStatus']; correctionNotices: NonNullable<EngineeringMatterWorkingRevisionReadModel['correctionNotices']>; overviewCorrectionNotices: NonNullable<EngineeringMatterWorkingRevisionReadModel['overviewCorrectionNotices']> }>,
      capabilities: [
        { capability: 'registered_source_reading', status: 'AVAILABLE' as const,
          impact: '本轮触发原因以trigger和sourceChanges为准，previousWork是历史认识，不是重复执行旧指令。来源或语义变化需核对所列新范围及条件，保留不受影响的既有问题。优先用originalReadRef读取boundOriginal绑定的已发布修订及其固定semantic revision；历史任务未捕获绑定时Host在首次读取确定版本。按返回nextOffset继续，原文修订变化只表示需要核查影响，不预设工程结论变化。PDF页文本层仍可独立读取；目录不代表已读，coverage限制须保留。' +
            '来源变化先比较sourceChanges中的covered与current，再用实际读取返回的documentIdentity核对具体family、正式版次与目录选择；documentVersionId变化本身不证明厂家正式换版，parseRun或semantic revision变化也不是正式换版。确认同family正式换版后，依次读取本版Revision Description/Transmittal等发布方修订说明及其准确SourceRef、新版正文和完整条件，再对照previousWork中的历史评估与工程文件关联；系统文本diff不能冒充发布方说明。没有说明、现行性未核实或关键正文不可读时明确缺口，不能默认不变。普通参考更新只按实际内容调整事项认识，不能改写另一文件条款。即使工程结论不变，也须记录新版实际读取范围、比较和覆盖；不得把旧SourceRef直接替换为新版引用。未影响内容保留，综合须说明所依据准确工作和未覆盖变化。以上说明处理方法，不代表已取得两份正式版本或已完成比较。' },
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

/** Reuse only Host-persisted reads of the same authorized versions. */
export function addMatterDeliveredEvidence(task: ReturnType<typeof buildMatterJobAidTask>, evidence: AssessmentEvidence[]) {
  const registry = new Map(task.sourceCatalog.map(item => [item.evidenceRef, item]));
  for (const item of evidence) {
    const prior = registry.get(item.evidenceRef);
    if (prior && canonicalJson(prior) !== canonicalJson(item)) throw new Error('MATTER_SOURCE_READ_IDENTITY_CHANGED');
    registry.set(item.evidenceRef, structuredClone(item));
  }
  task.sourceCatalog = [...registry.values()];
  task.initiallyDeliveredRefs = [...new Set([...task.initiallyDeliveredRefs, ...evidence.map(item => item.evidenceRef)])];
  task.modelInput.availableSources = task.sourceCatalog.map(item => ({ ref: item.evidenceRef, kind: item.kind,
    title: item.title, versionLabel: item.versionLabel, locator: 'locator' in item ? item.locator : null }));
  task.modelInput.deliveredEvidence = overallModelEvidenceRegistry(task.sourceCatalog.filter(item => task.initiallyDeliveredRefs.includes(item.evidenceRef)));
}
