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
import { overallModelEvidenceRegistry } from './overall-assessment-reading';
import { buildJobAidContextPackage } from './jobaid-context-package';

export interface JobAidSourceBinding {
  kind?: 'SOURCE_FILE';
  workItemId: string;
  documentVersionId: string;
  artifactSha256: string;
  artifactRef: string;
}

export function jobAidSourceFileReference(item: CanonicalWorkItemProjection) {
  if (!item.source.sourceArtifactId || !/^[a-f0-9]{64}$/u.test(item.source.sourceFileSha256 ?? ''))
    throw new Error('JOBAID_SOURCE_FILE_BINDING_INVALID');
  return {ref:item.source.sourceArtifactId,sha256:item.source.sourceFileSha256};
}

export interface JobAidProblemModelInput extends Record<string, unknown> {
  schemaVersion: typeof JOBAID_PROBLEM_TASK_SCHEMA;
  purpose:
    | 'INITIAL_PROBLEM_ASSESSMENT'
    | 'OVERALL_CONSISTENCY'
    | 'PROBLEM_REVIEW';
  methodBinding: typeof JOBAID_METHOD_BINDING;
  documentOverview: CanonicalCommonAssessmentContext['primaryDocument'] & {
    sections: Array<{ title: string; sourceRefs: string[] }>;
    original?: { binding: import('@shared/document-original.interface').DocumentOriginalBinding;
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
  }>;
  deliveredEvidence: ReturnType<typeof overallModelEvidenceRegistry>;
  previousWork: {
    workRevisionRef: string;
    workRevision: number;
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

export type JobAidProblemModelWorkContent = Omit<
  JobAidProblemWorkContent,
  'evidence' | 'issues'
> & {
  issues: Array<
    Omit<JobAidProblemIssue, 'issueRef' | 'statements'> & {
      statements: Array<
        Omit<AssessmentReadingClaim, 'claimId'> & { claimKey: string }
      >;
    }
  >;
};

/** Business keys preserve continuity without exposing Host WorkItem/claim IDs. */
export function jobAidProblemModelWorkContent(
  content: JobAidProblemWorkContent,
): JobAidProblemModelWorkContent {
  const { evidence: _evidence, issues, ...rest } = structuredClone(content);
  return {
    ...rest,
    issues: issues.map(({ issueRef: _issueRef, statements, ...issue }) => ({
      ...issue,
      statements: statements.map(({ claimId, ...claim }) => ({
        ...claim,
        claimKey: claimId.slice(claimId.lastIndexOf(':claim:') + 7),
      })),
    })),
  };
}

export interface JobAidProblemTaskInput extends Record<string, unknown> {
  schemaVersion: typeof JOBAID_PROBLEM_TASK_SCHEMA;
  knowledgeBinding?: import("./initial-assessment-knowledge.service").InitialKnowledgeBinding;
  actorUserId: string;
  permissionSnapshotVersion: string;
  sourceBindings: JobAidSourceBinding[];
  sourceCatalog: AssessmentEvidence[];
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
    value.schemaVersion === JOBAID_PROBLEM_TASK_SCHEMA
  );
}

export function parseJobAidProblemTask(
  task: OpenClawTaskEnvelope,
): JobAidProblemTaskInput {
  return assertJobAidProblemTaskBinding(task.modelInput);
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
    input.modelInput.schemaVersion !== JOBAID_PROBLEM_TASK_SCHEMA ||
    !isJobAidMethodBinding(input.modelInput.methodBinding)
  )
    throw new Error('JOBAID_TASK_BINDING_INVALID');
  const refs = new Set(input.sourceCatalog.map((item) => item.evidenceRef));
  // The envelope already seals this snapshot. Replays must validate that exact
  // binding, not today's process constant; otherwise a release changes a task.
  const boundMethods = input.sourceCatalog.filter(item => item.kind === 'METHOD_CLAUSE' &&
    item.packRef === input.modelInput.methodBinding.packRef);
  if (!boundMethods.length || !boundMethods.some(item => input.initiallyDeliveredRefs.includes(item.evidenceRef)))
    throw new Error('JOBAID_TASK_METHOD_BINDING_INVALID');
  const expectedSources = input.sourceCatalog.map((item) => ({
    ref: item.evidenceRef,
    kind: item.kind,
    title: item.title,
    versionLabel: item.versionLabel,
    locator: 'locator' in item ? item.locator : null,
  }));
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
  sourceBindings: JobAidSourceBinding[];
  common: CanonicalCommonAssessmentContext;
  previousWork: JobAidWorkRevision | null;
  expectedWorkRevision: number;
  priorAssessmentRefs: string[];
}): JobAidProblemTaskInput {
  const byRef = new Map<string, AssessmentEvidence>();
  for (const item of [
    ...input.sourceCatalog.map(stableJobAidEvidence),
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
  const initiallyDeliveredRefs = [
    ...new Set([
      ...JOBAID_CORE_METHOD_REFS,
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
  ];
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
    schemaVersion: JOBAID_PROBLEM_TASK_SCHEMA,
    actorUserId: input.actorUserId,
    permissionSnapshotVersion: input.permissionSnapshotVersion,
    sourceCatalog: catalog,
    sourceBindings: structuredClone(input.sourceBindings),
    initiallyDeliveredRefs,
    previousWork: structuredClone(previousWork),
    modelInput: {
      schemaVersion: JOBAID_PROBLEM_TASK_SCHEMA,
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
      availableSources: catalog.map((item) => ({
        ref: item.evidenceRef,
        kind: item.kind,
        title: item.title,
        versionLabel: item.versionLabel,
        locator: 'locator' in item ? item.locator : null,
      })),
      deliveredEvidence: overallModelEvidenceRegistry(
        catalog.filter((item) =>
          initiallyDeliveredRefs.includes(item.evidenceRef),
        ),
      ),
      previousWork: previousWork
        ? {
            workRevisionRef: previousWork.workRevisionRef,
            workRevision: previousWork.workRevision,
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
      }),
      capabilities,
      historyReview,
      discussion: structuredClone(input.common.discussion),
    },
  };
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
