import type {
  AssessmentEvidence,
  AssessmentReadingContent,
  AssessmentReadingResult,
} from '@shared/assessment-reading.interface';
import type {
  EngineeringMatterWorkingClaimDelta,
  EngineeringMatterWorkingFocus,
  EngineeringMatterWorkingRevisionCommand,
  EngineeringMatterWorkingState,
  EngineeringMatterWorkingTextItemDelta,
  EngineeringMatterWorkingUpdateKind,
} from '@shared/matter-working.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { materializeJobAidWork } from './jobaid-problem-work';
import { isJobAidMethodBinding } from './jobaid-method-pack';
import type { JobAidMethodBinding } from '@shared/jobaid-problem-assessment.interface';
import { isReviewRuntimeActivity } from '../action-attempt/review-evidence-activity';
import {
  parsePersistedMatterReviewScope,
  type PersistedMatterReviewScope,
} from '../review-persistence/review-business-scope';
import {
  parseEngineeringMatterWorkingState,
  materializeEngineeringMatterWorkingState,
} from './engineering-matter-working-state';
import {
  readStoredOverallEvidence,
  validateOverallAssessmentReading,
} from './overall-assessment-reading';

/** Complete Host bindings are sealed with the task and never become model input. */
export interface FrozenMatterReviewContext {
  methodBinding: JobAidMethodBinding;
  scope: PersistedMatterReviewScope;
  title: string;
  workingState: EngineeringMatterWorkingState | null;
  readingEvidence: AssessmentEvidence[];
  evidenceSources: Array<{
    evidenceRef: string;
    sourceRefId: string;
    inputId: string;
  }>;
}

/** Model proposes content and checked ranges; Host supplies identities and CAS. */
export interface MatterWorkingDeltaProposal {
  /** JobAid v2 local issue update; Host supplies subject, receipts and previous work. */
  problemWork?: Record<string, unknown>;
  updateKind: EngineeringMatterWorkingUpdateKind;
  changeSummary: string;
  nextFocus: EngineeringMatterWorkingFocus | null;
  claimDelta: EngineeringMatterWorkingClaimDelta | null;
  readingPresentation: Omit<
    AssessmentReadingContent,
    'schemaVersion' | 'claims'
  > | null;
  openQuestionDelta: EngineeringMatterWorkingTextItemDelta | null;
  reviewConditionDelta: EngineeringMatterWorkingTextItemDelta | null;
  coverageUpdates: Array<{
    inputRef: string;
    checkedSourceRefIds: string[];
    checkedScope: string;
    contribution: 'SUBSTANTIVE' | 'NO_MATERIAL_CHANGE';
    reason: string;
  }>;
}

export function parseFrozenMatterReviewContext(
  value: unknown,
): FrozenMatterReviewContext {
  const context = object(value, 'REVIEW_MATTER_CONTEXT_INVALID');
  exact(context, [
    'scope',
    'methodBinding',
    'title',
    'workingState',
    'readingEvidence',
    'evidenceSources',
  ]);
  if (!isJobAidMethodBinding(context.methodBinding)) fail('REVIEW_MATTER_METHOD_BINDING_INVALID');
  const scope = parsePersistedMatterReviewScope(context.scope);
  if (!scope) fail('REVIEW_MATTER_SCOPE_REQUIRED');
  const readingEvidence = readStoredOverallEvidence(context.readingEvidence);
  unique(
    readingEvidence.map((item) => item.evidenceRef),
    'REVIEW_MATTER_EVIDENCE_DUPLICATE',
  );
  const evidenceRefs = new Set(readingEvidence.map((item) => item.evidenceRef));
  const inputs = new Set(scope.inputs.map((item) => item.inputId));
  const evidenceSources = array(context.evidenceSources).map((value) => {
    const item = object(value);
    exact(item, ['evidenceRef', 'sourceRefId', 'inputId']);
    const source = {
      evidenceRef: text(item.evidenceRef),
      sourceRefId: text(item.sourceRefId),
      inputId: text(item.inputId),
    };
    if (!evidenceRefs.has(source.evidenceRef) || !inputs.has(source.inputId))
      fail('REVIEW_MATTER_EVIDENCE_BINDING_INVALID');
    return source;
  });
  unique(
    evidenceSources.map((item) => item.evidenceRef),
    'REVIEW_MATTER_EVIDENCE_SOURCE_DUPLICATE',
  );
  return {
    scope,
    methodBinding: structuredClone(context.methodBinding),
    title: text(context.title),
    workingState:
      context.workingState === null
        ? null
        : parseEngineeringMatterWorkingState(
            canonicalJson(context.workingState),
            scope.matterId,
          ),
    readingEvidence,
    evidenceSources,
  };
}

export function parseMatterWorkingDeltaProposal(
  value: unknown,
): MatterWorkingDeltaProposal | null {
  if (value === null) return null;
  const item = object(value, 'REVIEW_MATTER_DELTA_INVALID');
  exact(item, [
    'updateKind',
    'changeSummary',
    'nextFocus',
    'claimDelta',
    'readingPresentation',
    'openQuestionDelta',
    'reviewConditionDelta',
    'coverageUpdates',
    ...('problemWork' in item ? ['problemWork'] : []),
  ]);
  if ('problemWork' in item)
    object(item.problemWork, 'REVIEW_MATTER_PROBLEM_WORK_INVALID');
  if (
    !['INITIAL_SYNTHESIS', 'CORRECTION', 'MATERIAL_INCORPORATION'].includes(
      String(item.updateKind),
    )
  )
    fail('REVIEW_MATTER_UPDATE_KIND_INVALID');
  text(item.changeSummary);
  for (const key of [
    'nextFocus',
    'claimDelta',
    'readingPresentation',
    'openQuestionDelta',
    'reviewConditionDelta',
  ]) {
    if (item[key] !== null) object(item[key]);
  }
  if ((item.claimDelta === null) !== (item.readingPresentation === null))
    fail('REVIEW_MATTER_PRESENTATION_DELTA_REQUIRED');
  const coverageUpdates = array(item.coverageUpdates).map((value) => {
    const coverage = object(value);
    exact(coverage, [
      'inputRef',
      'checkedSourceRefIds',
      'checkedScope',
      'contribution',
      'reason',
    ]);
    text(coverage.inputRef);
    text(coverage.checkedScope);
    text(coverage.reason);
    if (
      coverage.contribution !== 'SUBSTANTIVE' &&
      coverage.contribution !== 'NO_MATERIAL_CHANGE'
    )
      fail('REVIEW_MATTER_COVERAGE_INVALID');
    const ids = array(coverage.checkedSourceRefIds).map((value) => text(value));
    if (ids.length === 0) fail('REVIEW_MATTER_CHECKED_RANGE_REQUIRED');
    unique(ids, 'REVIEW_MATTER_CHECKED_RANGE_DUPLICATE');
    return {
      inputRef: text(coverage.inputRef),
      checkedSourceRefIds: ids,
      checkedScope: text(coverage.checkedScope),
      contribution: coverage.contribution,
      reason: text(coverage.reason),
    };
  });
  unique(
    coverageUpdates.map((item) => String(item.inputRef)),
    'REVIEW_MATTER_INPUT_COVERAGE_DUPLICATE',
  );
  // Detailed claim/delta validation occurs during Host materialization below.
  return structuredClone({
    ...item,
    coverageUpdates,
  }) as unknown as MatterWorkingDeltaProposal;
}

export function matterInputRef(
  scope: PersistedMatterReviewScope,
  inputId: string,
): string {
  const ordinal = scope.inputs.findIndex((input) => input.inputId === inputId);
  if (ordinal < 0) fail('REVIEW_MATTER_INPUT_NOT_ALLOWED');
  return `matter-input:${ordinal + 1}`;
}

/** Validate a proposal against this task and actual Host read receipts, then materialize a local patch. */
export function matterWorkingCommand(input: {
  context: FrozenMatterReviewContext;
  proposal: MatterWorkingDeltaProposal;
  requestId: string;
  attemptRef: string;
  resolvedSourceRefIds: ReadonlySet<string>;
}): EngineeringMatterWorkingRevisionCommand {
  const { context } = input;
  let proposal = input.proposal;
  const sources = new Map(
    context.evidenceSources.map((item) => [item.evidenceRef, item]),
  );
  const prior = context.workingState?.substantiveResult ?? null;
  const evidence = new Map(
    (context.workingState?.problemWork?.evidence ?? prior?.evidence ?? []).map(
      (item) => [item.evidenceRef, item],
    ),
  );
  for (const item of context.readingEvidence) {
    const existing = evidence.get(item.evidenceRef);
    if (existing && canonicalJson(existing) !== canonicalJson(item))
      fail('REVIEW_MATTER_EVIDENCE_IDENTITY_DRIFT');
    evidence.set(item.evidenceRef, item);
  }

  const nextProblemWork = proposal.problemWork
    ? materializeJobAidWork(proposal.problemWork, {
        matterId: context.scope.matterId,
        methodBinding: context.methodBinding,
        previous: context.workingState?.problemWork ?? null,
        evidence: [...evidence.values()],
        readSourceRefs: [
          ...new Set([
            ...(context.workingState?.problemWork?.readSourceRefs ?? []),
            ...context.readingEvidence
              .filter(
                (item) =>
                  item.kind !== 'DOCUMENT_PASSAGE' ||
                  input.resolvedSourceRefIds.has(
                    sources.get(item.evidenceRef)?.sourceRefId ?? '',
                  ),
              )
              .map((item) => item.evidenceRef),
          ]),
        ],
        capabilities: context.workingState?.problemWork?.capabilities ?? [],
        history: context.workingState?.problemWork?.historyReview ?? {
          required: false,
          priorAssessmentRefs: [],
          engineeringDocumentRefs: [],
          coverage: 'NOT_REQUIRED',
          limitation: null,
        },
      })
    : undefined;
  if (nextProblemWork) {
    if (proposal.claimDelta !== null || proposal.readingPresentation !== null)
      fail('REVIEW_MATTER_PROBLEM_DUPLICATE_READING');
    const priorClaims = new Map(
      (prior?.content.claims ?? []).map((claim) => [claim.claimId, claim]),
    );
    const claims = nextProblemWork.issues.flatMap((issue) => issue.statements);
    const nextIds = new Set(claims.map((claim) => claim.claimId));
    proposal = {
      ...proposal,
      claimDelta: {
        changedBecause: nextProblemWork.changeSummary,
        additions: claims.filter((claim) => !priorClaims.has(claim.claimId)),
        replacements: claims.filter(
          (claim) =>
            priorClaims.has(claim.claimId) &&
            canonicalJson(priorClaims.get(claim.claimId)) !==
              canonicalJson(claim),
        ),
        retirements: [...priorClaims.keys()]
          .filter((id) => !nextIds.has(id))
          .map((claimId) => ({
            claimId,
            reason: nextProblemWork.changeSummary,
          })),
        explicitlyUnchangedClaimIds: claims
          .filter(
            (claim) =>
              canonicalJson(priorClaims.get(claim.claimId) ?? null) ===
              canonicalJson(claim),
          )
          .map((claim) => claim.claimId),
      },
      readingPresentation: {
        headline: nextProblemWork.headline,
        listBrief: nextProblemWork.listBrief,
        lead: nextProblemWork.understanding,
        decisiveClaimIds: nextProblemWork.issues
          .filter((issue) =>
            nextProblemWork.decisiveIssueKeys.includes(issue.issueKey),
          )
          .flatMap((issue) => issue.statements.map((claim) => claim.claimId)),
      },
    };
  }

  let nextSubstantiveResult: AssessmentReadingResult | null = null;
  if (proposal.claimDelta) {
    const delta = object(proposal.claimDelta);
    exact(delta, [
      'changedBecause',
      'additions',
      'replacements',
      'retirements',
      'explicitlyUnchangedClaimIds',
    ]);
    const additions = array(delta.additions).map((value) => object(value));
    const replacements = array(delta.replacements).map((value) =>
      object(value),
    );
    const retirements = array(delta.retirements).map((value) => object(value));
    const replacementsById = new Map(
      replacements.map((claim) => [text(claim.claimId), claim]),
    );
    const retired = new Set(retirements.map((claim) => text(claim.claimId)));
    const claims = [
      ...(prior?.content.claims ?? [])
        .filter((claim) => !retired.has(claim.claimId))
        .map((claim) => replacementsById.get(claim.claimId) ?? claim),
      ...additions,
    ];
    const presentation = object(proposal.readingPresentation);
    exact(presentation, ['headline', 'listBrief', 'lead', 'decisiveClaimIds']);
    const content = validateOverallAssessmentReading(
      {
        schemaVersion: 'wiselink.3_1.overall_engineering_summary.v2',
        ...presentation,
        claims,
      },
      [...evidence.values()],
    );
    const changed = new Set(
      [...additions, ...replacements].map((claim) => text(claim.claimId)),
    );
    for (const claim of content.claims.filter((claim) =>
      changed.has(claim.claimId),
    )) {
      for (const premise of claim.premises) {
        const carrier = evidence.get(premise.evidenceRef)!;
        if (carrier.kind === 'DOCUMENT_PASSAGE') {
          const source = sources.get(carrier.evidenceRef);
          if (!source || !input.resolvedSourceRefIds.has(source.sourceRefId))
            fail('REVIEW_MATTER_CHANGED_CLAIM_SOURCE_NOT_READ');
        }
      }
    }
    const used = new Set(
      content.claims.flatMap((claim) =>
        claim.premises.map((premise) => premise.evidenceRef),
      ),
    );
    nextSubstantiveResult = {
      resultRef: `MRESULT-${input.attemptRef}`,
      resultRevision: (prior?.resultRevision ?? 0) + 1,
      scope: { kind: 'ENGINEERING_MATTER', matterId: context.scope.matterId },
      content,
      evidence: [...evidence.values()].filter((item) =>
        used.has(item.evidenceRef),
      ),
      candidateOnly: true,
    };
  }

  const bindings = new Map(
    context.scope.inputs.map((binding) => [
      matterInputRef(context.scope, binding.inputId),
      binding,
    ]),
  );
  const sourcesByRef = new Map(
    context.evidenceSources.map((source) => [source.sourceRefId, source]),
  );
  const coverageUpdates = proposal.coverageUpdates.map((coverage) => {
    const binding = bindings.get(coverage.inputRef);
    if (!binding) fail('REVIEW_MATTER_COVERAGE_INPUT_NOT_ALLOWED');
    for (const sourceRefId of coverage.checkedSourceRefIds) {
      const source = sourcesByRef.get(sourceRefId);
      if (
        !source ||
        source.inputId !== binding.inputId ||
        !input.resolvedSourceRefIds.has(sourceRefId)
      )
        fail('REVIEW_MATTER_COVERAGE_SOURCE_NOT_READ');
    }
    if (coverage.contribution === 'SUBSTANTIVE') {
      const result = nextSubstantiveResult ?? prior;
      if (
        !result?.evidence.some(
          (item) => sources.get(item.evidenceRef)?.inputId === binding.inputId,
        )
      )
        fail('REVIEW_MATTER_SUBSTANTIVE_INPUT_UNUSED');
    }
    return {
      binding: structuredClone(binding),
      checkedSourceRefIds: coverage.checkedSourceRefIds.map((sourceRefId) => {
        const source = sourcesByRef.get(sourceRefId)!;
        const carrier = evidence.get(source.evidenceRef)!;
        if (carrier.kind !== 'DOCUMENT_PASSAGE')
          fail('REVIEW_MATTER_COVERAGE_DOCUMENT_REQUIRED');
        return carrier.sourceRefId;
      }),
      checkedScope: coverage.checkedScope,
      contribution: coverage.contribution,
      reason: coverage.reason,
    };
  });
  const contributingIds = new Set(
    (nextSubstantiveResult?.evidence ?? []).flatMap((item) => {
      const source = sources.get(item.evidenceRef);
      return source ? [source.inputId] : [];
    }),
  );
  const command: EngineeringMatterWorkingRevisionCommand = {
    requestId: input.requestId,
    expectedWorkingRevision: context.scope.expectedWorkingRevision,
    basedOnMatterRevisionId: context.scope.basedOnMatterRevisionId,
    updateKind: proposal.updateKind,
    changeSummary: proposal.changeSummary,
    nextFocus: proposal.nextFocus,
    claimDelta: proposal.claimDelta,
    openQuestionDelta: proposal.openQuestionDelta,
    reviewConditionDelta: proposal.reviewConditionDelta,
    nextSubstantiveResult,
    substantiveInputs: nextSubstantiveResult
      ? context.scope.inputs.filter((item) => contributingIds.has(item.inputId))
      : [],
    coverageUpdates,
    ...(nextProblemWork ? { nextProblemWork } : {}),
  };
  materializeEngineeringMatterWorkingState({
    matterId: context.scope.matterId,
    current: context.workingState,
    command,
  });
  return command;
}

export function resolvedReviewSourceRefs(
  stored: string | null | undefined,
): Set<string> {
  if (stored == null) return new Set();
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    fail('REVIEW_ACTIVITY_UNREADABLE');
  }
  const refs: string[] = [];
  for (const valueItem of array(value)) {
    const item = object(valueItem);
    // Runtime observations share the append-only activity log but can never
    // satisfy a citation, even if they contain an unexpected sourceRefIds key.
    if (isReviewRuntimeActivity(item)) continue;
    if (
      item.kind !== 'CONTEXT_PREPARED' &&
      item.kind !== 'SOURCE_REFS_RESOLVED'
    )
      fail('REVIEW_ACTIVITY_UNREADABLE');
    const ids = array(item.sourceRefIds).map((ref) => text(ref));
    if (item.kind === 'SOURCE_REFS_RESOLVED') refs.push(...ids);
  }
  return new Set(refs);
}

function exact(value: Record<string, unknown>, keys: string[]): void {
  if (
    canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())
  )
    fail('REVIEW_MATTER_FIELDS_INVALID');
}
function object(
  value: unknown,
  code = 'REVIEW_MATTER_VALUE_INVALID',
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail('REVIEW_MATTER_ARRAY_INVALID');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value)
    fail('REVIEW_MATTER_TEXT_INVALID');
  return value;
}
function unique(values: string[], code: string): void {
  if (new Set(values).size !== values.length) fail(code);
}
function fail(code: string): never {
  throw Object.assign(new Error(code), { code, statusCode: 409 });
}
