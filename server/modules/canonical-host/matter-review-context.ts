import type { JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import type { EngineeringMatterWorkingInputBinding } from '@shared/matter-working.interface';
import type {
  PersistedReviewTurn,
  PersistedReviewConversation,
} from '../review-persistence/review-conversation.repository';
import type { PersistedMatterReviewScope } from '../review-persistence/review-business-scope';
import type { FrozenReviewSourceRef } from './canonical-host-openclaw-review.contract';
import type { EngineeringMatterWorkingBasis } from './engineering-matter-working.service';
import {
  engineeringMatterPendingInputs,
  assertEngineeringMatterWorkingBindingsCurrent,
} from './engineering-matter-working-state';
import {
  matterInputRef,
  type FrozenMatterReviewContext,
} from './matter-review-candidate';

export function assertMatterReviewBasis(
  scope: PersistedMatterReviewScope,
  basis: EngineeringMatterWorkingBasis,
): void {
  if (
    basis.snapshot.currentMatterRevisionId !== scope.basedOnMatterRevisionId ||
    (basis.working?.workingRevision ?? 0) !== scope.expectedWorkingRevision
  )
    fail('REVIEW_MATTER_BASIS_CHANGED');
  assertEngineeringMatterWorkingBindingsCurrent({
    expected: scope.inputs,
    current: basis.currentInputs,
  });
}

/** Verified package passages are catalogued here; document text is delivered only by the read tool. */
export function buildMatterReviewContext(input: {
  scope: PersistedMatterReviewScope;
  basis: EngineeringMatterWorkingBasis;
  conversation: PersistedReviewConversation;
  turn: PersistedReviewTurn;
  discussionEvidence?: AssessmentEvidence[];
  documents: Array<{
    binding: EngineeringMatterWorkingInputBinding;
    workItem: CanonicalWorkItemProjection;
    packageValue: unknown;
    problemWork?: JobAidWorkRevision | null;
  }>;
}): {
  frozen: FrozenMatterReviewContext;
  model: Record<string, unknown>;
  resourceRefs: FrozenReviewSourceRef[];
} {
  assertMatterReviewBasis(input.scope, input.basis);
  const prior = input.basis.working?.state.substantiveResult ?? null;
  const evidence = new Map(
    (prior?.evidence ?? []).map((item) => [
      item.evidenceRef,
      structuredClone(item),
    ]),
  );
  const resourceRefs: FrozenReviewSourceRef[] = [];
  const evidenceSources: FrozenMatterReviewContext['evidenceSources'] = [];
  const pending = new Set(
    engineeringMatterPendingInputs(
      input.basis.working?.state ?? null,
      input.basis.currentInputs,
    ).map((item) => item.inputId),
  );
  const inputs = input.documents.map(
    ({ binding, workItem, packageValue, problemWork }, inputIndex) => {
      const pkg = record(packageValue);
      if (!Array.isArray(pkg.sourceRefs) || !workItem.package)
        fail('REVIEW_MATTER_PACKAGE_INVALID');
      const title = workItem.package.title || workItem.source.documentId;
      const versionLabel =
        workItem.package.documentIdentity?.businessRevision ?? null;
      const seen = new Set<string>();
      pkg.sourceRefs.forEach((value: unknown, index: number) => {
        const ref = record(value);
        const originalSourceRefId = text(ref.sourceRefId);
        if (seen.has(originalSourceRefId))
          fail('REVIEW_MATTER_SOURCE_DUPLICATE');
        seen.add(originalSourceRefId);
        if (typeof ref.quote !== 'string' || !ref.quote.trim()) return;
        if (
          !Number.isSafeInteger(ref.pageStart) ||
          !Number.isSafeInteger(ref.pageEnd) ||
          Number(ref.pageStart) < 1 ||
          Number(ref.pageEnd) < Number(ref.pageStart)
        )
          fail('REVIEW_MATTER_SOURCE_LOCATOR_INVALID');
        const stored = [...evidence.values()].find(
          (item) =>
            item.kind === 'DOCUMENT_PASSAGE' &&
            item.workItemId === binding.workItemId &&
            item.documentVersionId === binding.documentVersionId &&
            item.sourceRefId === originalSourceRefId,
        );
        const evidenceRef =
          stored?.evidenceRef ??
          `matter-evidence:revision:${input.scope.expectedWorkingRevision + 1}:document:${inputIndex + 1}:${index + 1}`;
        const sourceRefId = `matter-source:${inputIndex + 1}:${index + 1}`;
        const carrier: AssessmentEvidence = {
          evidenceRef,
          kind: 'DOCUMENT_PASSAGE',
          title,
          versionLabel,
          excerpt: ref.quote,
          workItemId: binding.workItemId,
          documentVersionId: binding.documentVersionId,
          sourceRefId: originalSourceRefId,
          locator: `page ${ref.pageStart}-${ref.pageEnd}`,
        };
        if (
          stored &&
          (stored.excerpt !== carrier.excerpt ||
            stored.title !== carrier.title ||
            stored.versionLabel !== carrier.versionLabel ||
            stored.kind !== 'DOCUMENT_PASSAGE' ||
            stored.locator !== carrier.locator)
        )
          fail('REVIEW_MATTER_EVIDENCE_IDENTITY_DRIFT');
        evidence.set(evidenceRef, carrier);
        evidenceSources.push({
          evidenceRef,
          sourceRefId,
          inputId: binding.inputId,
        });
        resourceRefs.push({
          sourceRefId,
          resourceArtifactRef: workItem.package!.artifact.ref,
          resourceArtifactSha256: workItem.package!.artifact.sha256,
          value: {
            sourceRefId,
            kind: 'DOCUMENT_PASSAGE',
            evidenceRef,
            inputRef: matterInputRef(input.scope, binding.inputId),
            documentVersionRef: binding.documentVersionId,
            title,
            versionLabel,
            locator: carrier.locator,
            pageStart: ref.pageStart,
            pageEnd: ref.pageEnd,
            quote: ref.quote,
          },
        });
      });
      return {
        inputRef: matterInputRef(input.scope, binding.inputId),
        ...(problemWork
          ? {
              previousProblemAssessment: {
                workRevisionRef: problemWork.workRevisionRef,
                roundCompletion: problemWork.content.roundCompletion,
                understanding: problemWork.content.understanding,
                issues: jobAidProblemModelWorkContent(problemWork.content)
                  .issues,
                methodBinding: problemWork.content.methodBinding,
                candidateOnly: true,
              },
            }
          : {}),
        documentVersionRef: binding.documentVersionId,
        title,
        versionLabel,
        pending: pending.has(binding.inputId),
      };
    },
  );
  const engineerEvidence: AssessmentEvidence = {
    evidenceRef: `matter-evidence:revision:${input.scope.expectedWorkingRevision + 1}:engineer`,
    kind: 'ENGINEER_STATEMENT',
    origin: 'REVIEW_CONVERSATION',
    title: `工程师陈述 · 第 ${input.turn.turnNo} 轮`,
    versionLabel: null,
    excerpt: input.turn.candidateText || input.turn.userMessage,
    reviewConversationId: input.conversation.reviewConversationId,
    reviewTurnId: input.turn.reviewTurnId,
    engineerSuppliedInputId: input.turn.engineerSuppliedInputId,
    recordedAt: input.turn.createdAt.toISOString(),
  };
  evidence.set(engineerEvidence.evidenceRef, engineerEvidence);
  for (const item of input.discussionEvidence ?? []) {
    const existing = evidence.get(item.evidenceRef);
    if (existing && JSON.stringify(existing) !== JSON.stringify(item))
      fail('REVIEW_MATTER_EVIDENCE_IDENTITY_DRIFT');
    evidence.set(item.evidenceRef, structuredClone(item));
  }
  const safeEvidence = (item: AssessmentEvidence) => ({
    evidenceRef: item.evidenceRef,
    kind: item.kind,
    title: item.title,
    versionLabel: item.versionLabel,
    locator: 'locator' in item ? item.locator : null,
    sourceRefId:
      evidenceSources.find((source) => source.evidenceRef === item.evidenceRef)
        ?.sourceRefId ?? null,
    providedText: item.kind === 'DOCUMENT_PASSAGE' ? null : item.excerpt,
  });
  return {
    frozen: {
      scope: structuredClone(input.scope),
      title: input.basis.snapshot.title,
      workingState: structuredClone(input.basis.working?.state ?? null),
      readingEvidence: [...evidence.values()],
      evidenceSources,
    },
    model: {
      title: input.basis.snapshot.title,
      workingRevision: input.scope.expectedWorkingRevision,
      targetClaimId: input.scope.targetClaimId,
      membershipRevisionRef: input.scope.basedOnMatterRevisionId,
      currentResult: prior
        ? {
            content: structuredClone(prior.content),
            evidence: prior.evidence.map(safeEvidence),
          }
        : null,
      focus: input.basis.working?.state.focus ?? null,
      openQuestions: structuredClone(
        input.basis.working?.state.openQuestions ?? [],
      ),
      reviewConditions: structuredClone(
        input.basis.working?.state.reviewConditions ?? [],
      ),
      inputs,
      evidenceCatalog: [...evidence.values()].map(safeEvidence),
    },
    resourceRefs,
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('REVIEW_MATTER_PACKAGE_INVALID');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    fail('REVIEW_MATTER_SOURCE_INVALID');
  return value;
}
function fail(code: string): never {
  throw Object.assign(new Error(code), { code, statusCode: 409 });
}
import { jobAidProblemModelWorkContent } from './jobaid-problem-task';
