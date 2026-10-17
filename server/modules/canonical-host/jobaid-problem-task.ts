import type { JobAidPreparationScope, JobAidPreparationView } from './jobaid-preparation-view';
import { automaticWorkItemTaskLease, type AutomaticWorkItemTaskLease } from '../action-attempt/automatic-work-item-attempt-lease';
import { assertTdmsRuntimeTaskContext, type TdmsRuntimeTaskContext } from '../tdms-source/tdms-runtime-reader.port';
import { tdmsJobAidDirectory } from './jobaid-tdms-context';
import type { DocumentActivityAssessmentProjection } from './document-activity-assessment-projection';
import { sourceStatementEvidence, sourceStatementDirectory } from './document-activity-assessment-consumer';
import { canonicalHostBareSha256 } from './canonical-host-sha256';
import type {
  AssessmentEvidence,
  AssessmentReadingClaim,
} from '@shared/assessment-reading.interface';
import type {
  CanonicalCommonAssessmentContext,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import {
  JOBAID_PROBLEM_TASK_SCHEMA,
  JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA,
  type JobAidAssessmentContextPackage,
  type JobAidProblemIssue,
  type JobAidProblemWorkContent,
  type JobAidWorkRevision,
} from '@shared/jobaid-problem-assessment.interface';
import type { OpenClawTaskEnvelope } from '../action-attempt/action-attempt-envelope.types';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import {
  JOBAID_CORE_METHOD_REFS,
  JOBAID_METHOD_BINDING,
  JOBAID_METHOD_EVIDENCE,
  isJobAidMethodBinding,
} from './jobaid-method-pack';
import { overallModelEvidenceRegistry, OVERALL_EVIDENCE_SOURCE_CONTEXT_VERSION,
  OVERALL_EVIDENCE_SOURCE_STATEMENT_VERSION, type OverallEvidenceProjectionVersion } from './overall-assessment-reading';
import { buildJobAidContextPackage } from './jobaid-context-package';

export interface JobAidSourceBinding {
  kind?: 'SOURCE_FILE';
  workItemId: string;
  documentVersionId: string;
  artifactSha256: string;
  artifactRef: string;
}

// A short, verified primary original is cheaper and safer to deliver as one
// complete reading scope than to make the model choose a few catalog entries.
// Large originals keep the existing on-demand source reader.
const INLINE_PRIMARY_ORIGINAL_MAX_REFS = 64;
const INLINE_PRIMARY_ORIGINAL_MAX_BYTES = 64 * 1024;

function inlinePrimaryOriginalRefs(
  sourceCatalog: AssessmentEvidence[],
  documentVersionId: string,
  parseRunId: string | undefined,
): string[] {
  if (!parseRunId) return [];
  const primary = sourceCatalog.filter(item => item.kind === 'DOCUMENT_PASSAGE' &&
    item.documentVersionId === documentVersionId &&
    item.versionLabel === parseRunId &&
    item.evidenceRef.startsWith(`DOCUMENT_ORIGINAL:${documentVersionId}:${parseRunId}:`));
  if (!primary.length || primary.length > INLINE_PRIMARY_ORIGINAL_MAX_REFS ||
    Buffer.byteLength(JSON.stringify(overallModelEvidenceRegistry(primary))) > INLINE_PRIMARY_ORIGINAL_MAX_BYTES)
    return [];
  return primary.map(item => item.evidenceRef);
}

export function jobAidSourceFileReference(item: CanonicalWorkItemProjection) {
  const sha256 = canonicalHostBareSha256(item.source.sourceFileSha256);
  if (!item.source.sourceArtifactId || !sha256)
    throw new Error('JOBAID_SOURCE_FILE_BINDING_INVALID');
  return {ref:item.source.sourceArtifactId,sha256};
}

export interface JobAidProblemModelInput extends Record<string, unknown> {
  /** Metadata only. A directory and approval provenance are not a body READ. */
  tdmsContext?: Pick<TdmsRuntimeTaskContext, 'schemaVersion' | 'projection'>;
  schemaVersion: typeof JOBAID_PROBLEM_TASK_SCHEMA | typeof JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA;
  /** Absent on sealed historical tasks: retain their original exact projection. */
  evidenceProjectionVersion?: OverallEvidenceProjectionVersion;
  purpose:
    | 'INITIAL_PROBLEM_ASSESSMENT'
    | 'OVERALL_CONSISTENCY'
    | 'PROBLEM_REVIEW';
  preparation?: JobAidPreparationView;
  methodBinding: typeof JOBAID_METHOD_BINDING;
  documentOverview: CanonicalCommonAssessmentContext['primaryDocument'] & {
    sections: Array<{ title: string; sourceRefs: string[] }>;
    original?: { binding: import('@shared/document-original.interface').DocumentOriginalBinding;
      semanticMap?: import('@shared/document-semantic-map.interface').DocumentSemanticMap | null;
      coverage: import('@shared/document-original.interface').DocumentOriginalCoverage;
      findings: import('@shared/canonical-translation-v2.interface').TranslationStructuredSource['findings'] };
  };
  hostApplicability: Pick<
    NonNullable<CanonicalWorkItemProjection['applicability']>,
    | 'decision'
    | 'currentness'
    | 'aircraftNumber'
    | 'assessmentAsOf'
    | 'blockingUnknownCount'
    | 'sourceExpressionCount'
    | 'pass'
  > | null;
  availableSources: Array<{
    ref: string;
    kind: AssessmentEvidence['kind'];
    title: string;
    versionLabel: string | null;
    locator: string | null;
    documentVersionId?: string;
    sourceRefId?: string;
    parseRunId?: string;
    carrierRangeRef?: string;
    sourceStatement?: Pick<DocumentActivityAssessmentProjection['entries'][number], 'reference'|'label'|'semanticFieldsAvailability'|'scopeBasis'|'sourceSchemaVersion'>;
  }>;
  /** New mixed Review alone inlines exact records once; initial/Overall read on demand. */
  sourceStatements?: DocumentActivityAssessmentProjection['records'];
  activityContexts?: DocumentActivityAssessmentProjection['activityContexts'];
  sourceStatementAvailability?: {status:'AVAILABLE'|'NOT_SAVED'|'NOT_INDEXED'; semanticFieldsAvailability:'LEGACY_PARTIAL'|'CAPTURED_FIELDS_ONLY'; limitations:string[]};
  deliveredEvidence: ReturnType<typeof overallModelEvidenceRegistry>;
  previousWork: {
    workRevisionRef: string;
    workRevision: number;
    overviewStatus?: JobAidProblemWorkContent['overviewStatus'];
    content: JobAidProblemModelWorkContent;
  } | null;
  expectedWorkRevision: number;
  capabilities: JobAidProblemWorkContent['capabilities'];
  historyReview: JobAidProblemWorkContent['historyReview'];
  /** Actual earlier user wording remains discussion, never controlled facts. */
  discussion: CanonicalCommonAssessmentContext['discussion'];
  /** Absent only on tasks persisted before source provenance was projected. */
  contextPackage?: JobAidAssessmentContextPackage;
  knowledgeAccess?: import("@shared/jobaid-problem-assessment.interface").JobAidKnowledgeAccess;
}

export type JobAidProblemModelWorkContent = Pick<JobAidProblemWorkContent,
  'schemaVersion' | 'headline' | 'listBrief' | 'roundCompletion' | 'completionReason' | 'changeSummary' | 'unchangedExplanation'> & {
  overview: string;
  issues: Array<Omit<JobAidProblemIssue, 'issueRef' | 'sourceDependencies' | 'premiseRefs' | 'legacyCriterionRefs' | 'riskScenarios'> & { riskScenarios: Array<Omit<JobAidProblemIssue['riskScenarios'][number], 'gradeMeaning'>> }>;
};

export function jobAidProblemModelWorkContent(content: JobAidProblemWorkContent): JobAidProblemModelWorkContent {
  return {
    schemaVersion: content.schemaVersion, headline: content.headline,
    listBrief: content.listBrief, overview: content.understanding,
    roundCompletion: content.roundCompletion, completionReason: content.completionReason,
    changeSummary: content.changeSummary, unchangedExplanation: content.unchangedExplanation,
    issues: content.issues.map(({ issueRef: _ref, sourceDependencies: _deps, premiseRefs: _premises, legacyCriterionRefs: _legacy, ...issue }) => ({ ...structuredClone(issue), riskScenarios: issue.riskScenarios.map(({ gradeMeaning: _meaning, ...risk }) => structuredClone(risk)) })),
  };
}

export interface JobAidProblemTaskInput extends Record<string, unknown> {
  /** Exact existing Review input selection, retained only in the trusted wrapper. */
  preparationScope?: JobAidPreparationScope;
  /** Sealed by Host for new automatic work only; absent on manual/historical tasks. */
  automaticWorkItemLease?: AutomaticWorkItemTaskLease;
  /** Exact saved candidate recovery; never a new model analysis. */
  savedWorkReconciliation?: {
    executionKind: 'HOST_SAVED_WORK_RECONCILIATION';
    modelRequests: 0;
    workRevisionRef: string;
    workRevision: number;
    sourceActionAttemptId: string;
  };
  /** Optional only on newly sealed tasks; never backfilled into old checkpoints. */
  tdmsContext?: TdmsRuntimeTaskContext;
  schemaVersion: typeof JOBAID_PROBLEM_TASK_SCHEMA | typeof JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA;
  knowledgeBinding?: import("./initial-assessment-knowledge.service").InitialKnowledgeBinding;
  actorUserId: string;
  permissionSnapshotVersion: string;
  sourceBindings: JobAidSourceBinding[];
  sourceCatalog: AssessmentEvidence[];
  /** Host-only exact snapshots, never an extra model directory or input body. */
  sourceActivityProjections?: DocumentActivityAssessmentProjection[];
  initiallyDeliveredRefs: string[];
  previousWork: JobAidWorkRevision | null;
  modelInput: JobAidProblemModelInput;
}

export function isJobAidProblemTask(
  value: unknown,
): value is JobAidProblemTaskInput {
  return (
    !!value &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    [JOBAID_PROBLEM_TASK_SCHEMA, JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA].includes(value.schemaVersion as never)
  );
}

export function parseJobAidProblemTask(
  task: OpenClawTaskEnvelope,
): JobAidProblemTaskInput {
  const input = assertJobAidProblemTaskBinding(task.modelInput);
  if (input.tdmsContext && (input.tdmsContext.binding.taskContextRef !== task.operationRef ||
      input.tdmsContext.binding.tenantId !== task.tenantId || input.tdmsContext.binding.workItemId !== task.workItemId ||
      input.tdmsContext.binding.documentVersionId !== task.documentVersionId)) throw new Error('JOBAID_TDMS_TASK_BINDING_INVALID');
  return input;
}

export function assertJobAidProblemTaskBinding(
  input: unknown,
): JobAidProblemTaskInput {
  if (
    !isJobAidProblemTask(input) ||
    !Array.isArray(input.sourceCatalog) ||
    !Array.isArray(input.sourceBindings) ||
    !Array.isArray(input.initiallyDeliveredRefs) ||
    typeof input.actorUserId !== 'string' ||
    !input.actorUserId ||
    !input.modelInput ||
    input.modelInput.schemaVersion !== input.schemaVersion ||
    !isJobAidMethodBinding(input.modelInput.methodBinding)
  )
    throw new Error('JOBAID_TASK_BINDING_INVALID');
  if (Object.hasOwn(input, 'automaticWorkItemLease') && input.automaticWorkItemLease === undefined)
    throw new Error('AUTO_WORK_ITEM_TASK_LEASE_BINDING_INVALID');
  automaticWorkItemTaskLease(input.automaticWorkItemLease);
  const recovery = input.savedWorkReconciliation;
  if (Object.hasOwn(input, 'savedWorkReconciliation') && (!recovery ||
      recovery.executionKind !== 'HOST_SAVED_WORK_RECONCILIATION' || recovery.modelRequests !== 0 ||
      input.modelInput.purpose !== 'INITIAL_PROBLEM_ASSESSMENT' ||
      input.previousWork?.content.roundCompletion !== 'COMPLETE' ||
      recovery.workRevisionRef !== input.previousWork.workRevisionRef ||
      recovery.workRevision !== input.previousWork.workRevision ||
      recovery.sourceActionAttemptId !== input.previousWork.actionAttemptId))
    throw new Error('JOBAID_SAVED_WORK_RECONCILIATION_INVALID');
  const nativeContext = input.tdmsContext === undefined ? undefined : assertTdmsRuntimeTaskContext(input.tdmsContext);
  if (nativeContext && (nativeContext.binding.actorUserId !== input.actorUserId ||
      nativeContext.binding.documentVersionId !== input.modelInput.documentOverview.documentVersionRef ||
      input.modelInput.purpose === 'PROBLEM_REVIEW')) throw new Error('JOBAID_TDMS_TASK_BINDING_INVALID');
  if (canonicalJson(input.modelInput.tdmsContext ?? null) !== canonicalJson(nativeContext ?
      {schemaVersion:nativeContext.schemaVersion,projection:nativeContext.projection} : null))
    throw new Error('JOBAID_TDMS_TASK_BINDING_INVALID');
  if (!nativeContext && input.sourceCatalog.some(e => e.kind === 'TDMS_NATIVE_RECORD'))
    throw new Error('JOBAID_TDMS_TASK_BINDING_REQUIRED');
  if (input.initiallyDeliveredRefs.some(ref => input.sourceCatalog.some(e => e.kind === 'TDMS_NATIVE_RECORD' && e.evidenceRef === ref)))
    throw new Error('JOBAID_TDMS_DIRECTORY_ONLY_REQUIRED');
  const projections = input.sourceActivityProjections ?? [];
  const v3 = input.schemaVersion === JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA;
  if (v3 && (input.modelInput.purpose === 'PROBLEM_REVIEW' || !Array.isArray(input.sourceActivityProjections) ||
      !input.modelInput.sourceStatementAvailability || input.modelInput.evidenceProjectionVersion !== OVERALL_EVIDENCE_SOURCE_STATEMENT_VERSION))
    throw new Error('JOBAID_TASK_SOURCE_STATEMENT_BINDING_INVALID');
  const mixedReview = !v3 && input.modelInput.purpose==='PROBLEM_REVIEW' && projections.length>0;
  if (!v3 && !mixedReview && (input.sourceActivityProjections !== undefined || input.sourceCatalog.some(e=>e.kind==='PRIOR_RESULT'&&e.sourceStatement)))
    throw new Error('JOBAID_TASK_SOURCE_STATEMENT_BINDING_INVALID');
  for (const item of input.sourceCatalog) if(item.kind==='PRIOR_RESULT'&&item.sourceStatement) {
    const records=projections.flatMap(p=>p.records).filter(r=>r.ref===item.evidenceRef);
    if(records.length!==1||item.sourceWork||canonicalJson(sourceStatementEvidence(records[0]))!==canonicalJson(item)||
      (!mixedReview && input.initiallyDeliveredRefs.includes(item.evidenceRef))) throw new Error('JOBAID_TASK_SOURCE_STATEMENT_BINDING_INVALID');
  }
  if(mixedReview && (input.modelInput.evidenceProjectionVersion!==OVERALL_EVIDENCE_SOURCE_STATEMENT_VERSION ||
    canonicalJson(input.modelInput.sourceStatements)!==canonicalJson(projections.flatMap(p=>p.records)) ||
    canonicalJson(input.modelInput.activityContexts)!==canonicalJson(projections.flatMap(p=>p.activityContexts)) ||
    projections.flatMap(p=>p.records).some(r=>[r.ref,...r.requiredContextRootRefs,...r.rootRefs].some(ref=>!input.initiallyDeliveredRefs.includes(ref)))))
    throw new Error('JOBAID_TASK_SOURCE_STATEMENT_BINDING_INVALID');
  const registeredStatementRefs = new Set(input.sourceCatalog.filter(e=>e.kind==='PRIOR_RESULT'&&e.sourceStatement).map(e=>e.evidenceRef));
  if(projections.flatMap(p=>p.records).some(r=>!registeredStatementRefs.has(r.ref))) throw new Error('JOBAID_TASK_SOURCE_STATEMENT_BINDING_INVALID');
  const refs = new Set(input.sourceCatalog.map((item) => item.evidenceRef));
  // The envelope already seals this snapshot. Replays must validate that exact
  // binding, not today's process constant; otherwise a release changes a task.
  const boundMethods = input.sourceCatalog.filter(item => item.kind === 'METHOD_CLAUSE' &&
    item.packRef === input.modelInput.methodBinding.packRef);
  if (!boundMethods.length || !boundMethods.some(item => input.initiallyDeliveredRefs.includes(item.evidenceRef)))
    throw new Error('JOBAID_TASK_METHOD_BINDING_INVALID');
  const identityDirectory = Array.isArray(input.modelInput.availableSources) &&
    input.modelInput.availableSources.some(item => ['documentVersionId','sourceRefId','parseRunId','carrierRangeRef']
      .some(key => Object.hasOwn(item,key)));
  const expectedSources = [...input.sourceCatalog.filter(item => item.kind !== 'TDMS_NATIVE_RECORD').map((item) => ({
    ref: item.evidenceRef,
    kind: item.kind,
    title: item.title,
    versionLabel: item.versionLabel,
    locator: 'locator' in item ? item.locator : null,
    ...(identityDirectory ? jobAidSourceDirectoryIdentity(item) : {}),
    ...sourceStatementDirectory(item, projections),
  })), ...tdmsJobAidDirectory(nativeContext, input.sourceCatalog)];
  if (
    refs.size !== input.sourceCatalog.length ||
    input.initiallyDeliveredRefs.some((ref) => !refs.has(ref)) ||
    !Array.isArray(input.modelInput.availableSources) ||
    !Array.isArray(input.modelInput.deliveredEvidence) ||
    canonicalJson(expectedSources) !==
      canonicalJson(input.modelInput.availableSources) ||
    canonicalJson(
      overallModelEvidenceRegistry(
        input.sourceCatalog.filter((item) =>
          input.initiallyDeliveredRefs.includes(item.evidenceRef),
        ),
        input.modelInput.evidenceProjectionVersion,
      ),
    ) !== canonicalJson(input.modelInput.deliveredEvidence) ||
    input.modelInput.expectedWorkRevision !==
      (input.previousWork?.workRevision ?? 0)
  )
    throw new Error('JOBAID_TASK_SOURCE_BINDING_INVALID');
  return input;
}

export function buildJobAidProblemTask(input: {
  workItem: CanonicalWorkItemProjection;
  actorUserId: string;
  permissionSnapshotVersion: string;
  purpose: JobAidProblemModelInput['purpose'];
  sourceCatalog: AssessmentEvidence[];
  originalParseRunId?: string;
  sourceBindings: JobAidSourceBinding[];
  common: CanonicalCommonAssessmentContext;
  previousWork: JobAidWorkRevision | null;
  expectedWorkRevision: number;
  priorAssessmentRefs: string[];
  sourceActivityProjections?: DocumentActivityAssessmentProjection[];
  sourceStatementAvailability?: JobAidProblemModelInput['sourceStatementAvailability'];
  tdmsContext?: TdmsRuntimeTaskContext;
  automaticWorkItemLease?: AutomaticWorkItemTaskLease;
}): JobAidProblemTaskInput {
  const nativeContext = input.tdmsContext === undefined ? undefined : assertTdmsRuntimeTaskContext(input.tdmsContext);
  if (nativeContext && (nativeContext.binding.actorUserId !== input.actorUserId ||
      nativeContext.binding.workItemId !== input.workItem.workItemId ||
      nativeContext.binding.documentVersionId !== input.workItem.source.documentVersionId ||
      input.purpose === 'PROBLEM_REVIEW')) throw new Error('JOBAID_TDMS_TASK_BINDING_INVALID');
  if (!nativeContext && [...input.sourceCatalog, ...(input.previousWork?.content.evidence ?? [])].some(e => e.kind === 'TDMS_NATIVE_RECORD'))
    throw new Error('JOBAID_TDMS_TASK_BINDING_REQUIRED');
  // Interactive review still uses its existing legacy source-resource contract.
  const statementContract = input.sourceActivityProjections !== undefined;
  const mixedReview = input.purpose === 'PROBLEM_REVIEW' && (input.sourceActivityProjections?.length??0)>0;
  const v3 = input.purpose !== 'PROBLEM_REVIEW' && statementContract;
  const schemaVersion = v3 ? JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA : JOBAID_PROBLEM_TASK_SCHEMA;
  const projections = input.sourceActivityProjections ?? [];
  const projectionVersion = v3 || mixedReview ? OVERALL_EVIDENCE_SOURCE_STATEMENT_VERSION : nativeContext ? OVERALL_EVIDENCE_SOURCE_CONTEXT_VERSION : undefined;
  const byRef = new Map<string, AssessmentEvidence>();
  for (const item of [
    ...input.sourceCatalog.map(stableJobAidEvidence),
    ...projections.flatMap(p=>p.records.map(sourceStatementEvidence)),
    ...structuredClone(JOBAID_METHOD_EVIDENCE),
  ]) {
    const prior = byRef.get(item.evidenceRef);
    if (prior && canonicalJson(prior) !== canonicalJson(item))
      throw new Error('JOBAID_SOURCE_CATALOG_CONFLICT');
    byRef.set(item.evidenceRef, item);
  }
  const previousWork = input.previousWork;
  for (const item of previousWork?.content.evidence ?? []) {
    const current = byRef.get(item.evidenceRef);
    if (current && canonicalJson(current) !== canonicalJson(item))
      throw new Error('JOBAID_PRIOR_SOURCE_CHANGED');
    byRef.set(item.evidenceRef, structuredClone(item));
  }
  const catalog = [...byRef.values()];
  const sourceStatementRefs = new Set(catalog.filter(e=>e.kind==='PRIOR_RESULT'&&e.sourceStatement).map(e=>e.evidenceRef));
  const initiallyDeliveredRefs = [
    ...new Set([
      ...JOBAID_CORE_METHOD_REFS,
      ...(mixedReview ? projections.flatMap(p=>p.records.flatMap(r=>[r.ref,...r.rootRefs,...r.requiredContextRootRefs])) : []),
      ...inlinePrimaryOriginalRefs(input.sourceCatalog, input.workItem.source.documentVersionId,
        input.originalParseRunId),
      ...catalog
        .filter(
          (item) =>
            (item.kind === 'ENGINEER_STATEMENT' && !item.dialogueSource) ||
            item.kind === 'HOST_FACT',
        )
        .map((item) => item.evidenceRef),
      ...(previousWork?.content.readSourceRefs ?? []),
      ...catalog.flatMap((item) =>
        item.kind === 'DOCUMENT_PASSAGE' && input.common.relatedMaterials.items.some(
          (related) => related.documentVersionRef === item.documentVersionId &&
            related.readFragments.some((fragment) => fragment.sourceRefId === item.sourceRefId),
        ) ? [item.evidenceRef] : [],
      ),
    ]),
  ].filter(ref=>(mixedReview||!sourceStatementRefs.has(ref)) && !catalog.some(e=>e.kind==='TDMS_NATIVE_RECORD'&&e.evidenceRef===ref));
  const capabilities: JobAidProblemWorkContent['capabilities'] = [
    {
      capability: 'registered_source_reading',
      status: 'AVAILABLE',
      impact: '可读取目录内精确版本正文，并展开同页条件与脚注。',
    },
    {
      capability: 'fleet_configuration',
      status: 'NOT_CONNECTED',
      impact: '不能由此证明当前对象装机、执行或构型；受控 Host 匹配单独保留。',
    },
    {
      capability: 'reliability_history',
      status: 'NOT_CONNECTED',
      impact: '没有取得可靠性查询结果；不能据此填发生率或零事件。',
    },
    {
      capability: 'knowledge_retrieval',
      status: 'NOT_CONNECTED',
      impact: '不妨碍分析已授权正文；被引用但未取得的资料保持线索。',
    },
    ...input.common.relatedMaterials.items
      .filter((item) => item.availability !== 'AVAILABLE')
      .map((item) => ({
        capability: `related:${item.documentCode}`,
        status: 'PARTIAL' as const,
        impact: `${item.documentCode}：${item.reasonCodes.join('；') || item.availability}；仅分析实际已读内容。`,
      })),
  ];
  const sourceVersionChanged =
    previousWork !== null &&
    previousWork.documentVersionId !== input.workItem.source.documentVersionId;
  const historyReview: JobAidProblemWorkContent['historyReview'] = {
    required: sourceVersionChanged,
    priorAssessmentRefs: [...input.priorAssessmentRefs],
    engineeringDocumentRefs: input.workItem.aeo
      ? input.workItem.aeo.artifacts.map((item) => item.artifactRef)
      : [],
    coverage: sourceVersionChanged ? 'PARTIAL' : 'NOT_REQUIRED',
    limitation: sourceVersionChanged
      ? '已列出 Host 可读历史；外部正式工程文件与旧版评估未声明齐全，须按 DS §5.3.1(9)补核。'
      : null,
  };
  const sectionRefs = new Map(
    // Prior work may retain the same locator in an older parsing revision.
    // The current overview must point to this task's current source catalog.
    input.sourceCatalog.map(stableJobAidEvidence)
      .filter(
        (
          item,
        ): item is Extract<AssessmentEvidence, { kind: 'DOCUMENT_PASSAGE' }> =>
          item.kind === 'DOCUMENT_PASSAGE' &&
          item.documentVersionId === input.workItem.source.documentVersionId,
      )
      .map((item) => [item.sourceRefId, item.evidenceRef]),
  );
  const applicability = input.workItem.applicability;
  return {
    schemaVersion,
    actorUserId: input.actorUserId,
    permissionSnapshotVersion: input.permissionSnapshotVersion,
    ...(input.automaticWorkItemLease ? { automaticWorkItemLease: automaticWorkItemTaskLease(input.automaticWorkItemLease) } : {}),
    sourceCatalog: catalog,
    ...(nativeContext ? {tdmsContext:structuredClone(nativeContext)} : {}),
    ...(statementContract ? {sourceActivityProjections:structuredClone(projections)} : {}),
    sourceBindings: structuredClone(input.sourceBindings),
    initiallyDeliveredRefs,
    previousWork: structuredClone(previousWork),
    modelInput: {
      schemaVersion,
      ...(nativeContext ? {tdmsContext:{schemaVersion:nativeContext.schemaVersion,projection:structuredClone(nativeContext.projection)}} : {}),
      ...(projectionVersion ? { evidenceProjectionVersion: projectionVersion } : {}),
      purpose: input.purpose,
      methodBinding: structuredClone(JOBAID_METHOD_BINDING),
      documentOverview: {
        ...input.common.primaryDocument,
        sections: input.common.documentReading.sections.map((section) => ({
          title: section.title,
          sourceRefs: section.sourceRefIds.flatMap(
            (ref) => sectionRefs.get(ref) ?? [],
          ),
        })),
      },
      hostApplicability: applicability
        ? {
            decision: applicability.decision,
            currentness: applicability.currentness,
            aircraftNumber: applicability.aircraftNumber,
            assessmentAsOf: applicability.assessmentAsOf,
            blockingUnknownCount: applicability.blockingUnknownCount,
            sourceExpressionCount: applicability.sourceExpressionCount,
            pass: applicability.pass,
          }
        : null,
      ...(mixedReview ? {sourceStatements:structuredClone(projections.flatMap(p=>p.records)),activityContexts:structuredClone(projections.flatMap(p=>p.activityContexts))} : {}),
      ...(v3 || mixedReview ? {sourceStatementAvailability: structuredClone(input.sourceStatementAvailability ?? {status:'AVAILABLE',semanticFieldsAvailability:'LEGACY_PARTIAL',limitations:[]})} : {}),
      availableSources: [...catalog.filter(item=>item.kind!=='TDMS_NATIVE_RECORD').map((item) => ({
        ref: item.evidenceRef,
        kind: item.kind,
        title: item.title,
        versionLabel: item.versionLabel,
        locator: 'locator' in item ? item.locator : null,
        ...jobAidSourceDirectoryIdentity(item),
        ...sourceStatementDirectory(item, projections),
      })), ...tdmsJobAidDirectory(nativeContext, catalog)],
      deliveredEvidence: overallModelEvidenceRegistry(
        catalog.filter((item) =>
          initiallyDeliveredRefs.includes(item.evidenceRef),
        ),
        projectionVersion,
      ),
      previousWork: previousWork
        ? {
            workRevisionRef: previousWork.workRevisionRef,
            workRevision: previousWork.workRevision,
            overviewStatus: previousWork.content.overviewStatus,
            content: jobAidProblemModelWorkContent(previousWork.content),
          }
        : null,
      expectedWorkRevision: input.expectedWorkRevision,
      contextPackage: buildJobAidContextPackage({
        workItem: input.workItem,
        common: input.common,
        catalog,
        initiallyDeliveredRefs,
        previousWorkRevision: previousWork?.workRevision ?? null,
        ...(nativeContext ? {nativeEvidenceRefs:tdmsJobAidDirectory(nativeContext,catalog).map(item=>item.ref)} : {}),
      }),
      capabilities,
      historyReview,
      discussion: structuredClone(input.common.discussion),
    },
  };
}

function jobAidSourceDirectoryIdentity(item: AssessmentEvidence): {
  documentVersionId?: string; sourceRefId?: string; parseRunId?: string; carrierRangeRef?: string;
} {
  if (item.kind !== 'DOCUMENT_PASSAGE') return {};
  const prefix = `DOCUMENT_ORIGINAL:${item.documentVersionId}:`;
  const parseRunId = item.evidenceRef.startsWith(prefix)
    ? item.evidenceRef.slice(prefix.length).split(':')[0] : undefined;
  return {documentVersionId:item.documentVersionId,sourceRefId:item.sourceRefId,
    ...(parseRunId && /^[A-Za-z0-9._-]{1,96}$/u.test(parseRunId) && item.versionLabel === parseRunId
      ? {parseRunId,carrierRangeRef:item.evidenceRef} : {})};
}

export function stableJobAidEvidence(
  item: AssessmentEvidence,
): AssessmentEvidence {
  if (item.kind === 'DOCUMENT_PASSAGE' && item.evidenceRef.startsWith('DOCUMENT_ORIGINAL:')) {
    const prefix = `DOCUMENT_ORIGINAL:${item.documentVersionId}:`;
    const suffix = `:${item.sourceRefId}`;
    if (!item.evidenceRef.startsWith(prefix) || !item.evidenceRef.endsWith(suffix) ||
      !/^[A-Za-z0-9_-]{1,96}$/u.test(item.evidenceRef.slice(prefix.length, -suffix.length)))
      throw new Error('JOBAID_ORIGINAL_SOURCE_BINDING_INVALID');
    return structuredClone(item);
  }
  return {
    ...structuredClone(item),
    evidenceRef:
      item.kind === 'DOCUMENT_PASSAGE'
        ? `source:${item.documentVersionId}:${item.sourceRefId}`
        : item.evidenceRef,
  };
}

export function expandJobAidSourceSelection(
  catalog: AssessmentEvidence[],
  requested: string[],
  context: 'EXACT' | 'PAGE',
): AssessmentEvidence[] {
  if (
    requested.length === 0 ||
    requested.length > 96 ||
    new Set(requested).size !== requested.length
  )
    throw new Error('JOBAID_SOURCE_SELECTION_INVALID');
  const byRef = new Map(catalog.map((item) => [item.evidenceRef, item]));
  const selected = requested.map((ref) => {
    const item = byRef.get(ref);
    if (!item) throw new Error('JOBAID_SOURCE_NOT_REGISTERED');
    return item;
  });
  if (context === 'EXACT') return structuredClone(selected);
  const pageKey = (item: Extract<AssessmentEvidence, { kind: 'DOCUMENT_PASSAGE' }>) => {
    const original = stableJobAidEvidence(item);
    const revision = original.evidenceRef.startsWith('DOCUMENT_ORIGINAL:')
      ? original.evidenceRef.slice(0, -(item.sourceRefId.length + 1)) : 'legacy';
    return `${item.documentVersionId}\0${revision}\0${item.locator}`;
  };
  const pageKeys = new Set(
    selected
      .filter((item) => item.kind === 'DOCUMENT_PASSAGE')
      .map(pageKey),
  );
  const refs = new Set(requested);
  return structuredClone(
    catalog.filter(
      (item) =>
        refs.has(item.evidenceRef) ||
        (item.kind === 'DOCUMENT_PASSAGE' &&
          pageKeys.has(pageKey(item))),
    ),
  );
}

export function resolvedAssessmentSources(
  value: string | null | undefined,
): string[] {
  if (!value) return [];
  const entries: unknown = JSON.parse(value);
  if (!Array.isArray(entries))
    throw new Error('JOBAID_SOURCE_ACTIVITY_INVALID');
  return [
    ...new Set(
      entries.flatMap((entry) =>
        entry &&
        typeof entry === 'object' &&
        entry.kind === 'ASSESSMENT_SOURCES_READ' &&
        Array.isArray(entry.sourceRefs)
          ? entry.sourceRefs.filter(
              (ref: unknown): ref is string => typeof ref === 'string',
            )
          : [],
      ),
    ),
  ];
}
