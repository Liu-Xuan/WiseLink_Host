import { createHash } from 'node:crypto';

import type {
  CanonicalAeoEditingDraftFeedbackRequest,
  CanonicalAeoEditingDraftProjection,
  CanonicalAeoEditingInputProjection,
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';
import type {
  AeoDraftAssistanceCandidate,
  AeoDraftFeedbackInput,
} from '../aeo-authoring/aeo-editing-knowledge';
import type { CanonicalHostActor } from './canonical-host.types';

export function requiredHostInput(
  workItem: CanonicalWorkItemProjection,
): CanonicalAeoEditingInputProjection {
  const value = workItem.aeoEditingInput;
  const packageProjection = workItem.package;
  if (
    workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
    workItem.classification.status !== 'CONFIRMED' ||
    !packageProjection ||
    !value ||
    value.schemaVersion !== 'wiselink.3_1.aeo_editing_input.v0.candidate.1' ||
    value.status !== 'HOST_INPUT_READY' ||
    !['ACTION_UNITS', 'ROUTINE_SERIES_PATTERN'].includes(value.inputKind) ||
    value.authority !== 'HOST_OWNED_INPUT_ACTUAL_BYTES_REVALIDATED_ON_USE' ||
    value.workItemId !== workItem.workItemId ||
    value.documentVersionId !== workItem.source.documentVersionId ||
    value.sourcePackageId !== packageProjection.packageId ||
    value.sourcePackageArtifactSha256 !== packageProjection.artifact.sha256
  ) {
    throw new Error('AEO_EDITING_HOST_INPUT_NOT_READY');
  }
  if (
    !Number.isSafeInteger(value.inputRevision) ||
    value.inputRevision < 1 ||
    !value.draftTitle.trim() ||
    !uniqueNonEmpty(value.selectedUnitIds) ||
    (value.inputKind === 'ACTION_UNITS' &&
      value.selectedUnitIds.length === 0) ||
    (value.inputKind === 'ROUTINE_SERIES_PATTERN' &&
      value.selectedUnitIds.length !== 0) ||
    !uniqueRefs(value.currentSourceRefs) ||
    value.currentSourceRefs.length === 0 ||
    !uniqueNonEmpty(value.sourceArtifacts.map((item) => item.sourceId)) ||
    value.sourceArtifacts.length === 0 ||
    value.sourceArtifacts.some(
      (item) =>
        !item.documentVersionId.trim() ||
        !item.sourceArtifactId.trim() ||
        !/^[a-f0-9]{64}$/u.test(item.artifactSha256) ||
        !Number.isSafeInteger(item.byteLength) ||
        item.byteLength < 1 ||
        !item.mediaType.trim(),
    )
  ) {
    throw new Error('AEO_EDITING_HOST_INPUT_INVALID');
  }
  return value;
}

export function requiredPendingHostInput(
  workItem: CanonicalWorkItemProjection,
): CanonicalAeoEditingInputProjection {
  const active = workItem.aeoEditingInput;
  const pending = workItem.aeoEditingPendingInput;
  if (!pending) throw new Error('AEO_EDITING_HOST_CURRENT_INPUT_NOT_STAGED');
  const checked = requiredHostInput({
    ...workItem,
    aeoEditingInput: pending,
  });
  if ((active?.inputRevision ?? 0) > checked.inputRevision) {
    throw new Error('AEO_EDITING_HOST_CURRENT_INPUT_REVISION_REGRESSED');
  }
  return checked;
}

export function assertNoPendingHostInput(
  workItem: CanonicalWorkItemProjection,
): void {
  if (workItem.aeoEditingPendingInput) {
    throw new Error('AEO_EDITING_DRAFT_INPUT_STALE');
  }
}

export function currentDraftMatchesInput(
  workItem: CanonicalWorkItemProjection,
  input: CanonicalAeoEditingInputProjection,
): boolean {
  const draft = workItem.aeoEditingDraft;
  return Boolean(
    draft &&
    draft.status === 'CANDIDATE_ONLY' &&
    draft.basedOnInputRevision === input.inputRevision &&
    draft.currentProducerArtifactSha256 ===
      input.currentProducerArtifact.sha256 &&
    draft.sourceManifestArtifactSha256 === input.sourceManifestArtifact.sha256,
  );
}

export function requiredDraftProjection(
  workItem: CanonicalWorkItemProjection,
): CanonicalAeoEditingDraftProjection {
  const projection = workItem.aeoEditingDraft;
  if (!projection || projection.status !== 'CANDIDATE_ONLY') {
    throw new Error('AEO_EDITING_DRAFT_NOT_FOUND');
  }
  if (!currentDraftMatchesInput(workItem, requiredHostInput(workItem))) {
    throw new Error('AEO_EDITING_DRAFT_INPUT_STALE');
  }
  return projection;
}

export function draftProjection(input: {
  previousRevision: number;
  draft: AeoDraftAssistanceCandidate;
  blockingGapCount: number;
  hostInput: CanonicalAeoEditingInputProjection;
  artifact: UnifiedPackageArtifactDescriptor;
  actionAttemptId: string;
}): CanonicalAeoEditingDraftProjection {
  return {
    schemaVersion: 'wiselink.3_1.aeo_editing_draft_projection.v0.candidate.1',
    status: 'CANDIDATE_ONLY',
    revision: input.previousRevision + 1,
    generationRevision: input.draft.generationRevision,
    basedOnInputRevision: input.hostInput.inputRevision,
    currentProducerArtifactSha256:
      input.hostInput.currentProducerArtifact.sha256,
    sourceManifestArtifactSha256: input.hostInput.sourceManifestArtifact.sha256,
    suggestionCount: input.draft.suggestions.length,
    blockCount: input.draft.editorBlocks.length,
    blockingGapCount: input.blockingGapCount,
    feedbackCount: input.draft.feedback.length,
    doNotLearnFeedbackCount: input.draft.feedback.filter(
      (feedback) => feedback.learningDisposition === 'DO_NOT_LEARN',
    ).length,
    artifact: input.artifact,
    actionAttemptId: input.actionAttemptId,
    adoptionDecisions: [],
    automaticallyAdopted: false,
    engineeringApproved: false,
    productionPublished: false,
    currentChanged: false,
  };
}

export function feedbackInput(
  workItem: CanonicalWorkItemProjection,
  request: CanonicalAeoEditingDraftFeedbackRequest,
  actor: CanonicalHostActor,
  resolved: {
    feedbackId: string;
    suggestionId: string;
    revisionSourceRefs?: Array<{ sourceId: string; locator: string }>;
  },
): AeoDraftFeedbackInput {
  return {
    feedbackId: resolved.feedbackId,
    suggestionId: resolved.suggestionId,
    expectedGenerationRevision: request.expectedGenerationRevision,
    decision: request.decision,
    engineerDecisionRef: decisionRef(workItem, request, actor),
    note: request.note,
    ...(request.revisedBodyZh === undefined
      ? {}
      : { revisedBodyZh: request.revisedBodyZh }),
    ...(request.revisedBodyEn === undefined
      ? {}
      : { revisedBodyEn: request.revisedBodyEn }),
    ...(resolved.revisionSourceRefs === undefined
      ? {}
      : { revisionSourceRefs: resolved.revisionSourceRefs }),
    semanticField: request.semanticField,
    reasonCode: request.reasonCode,
    learningDisposition: request.learningDisposition,
  };
}

export function parseJson(bytes: Uint8Array, code: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error(code);
  }
}

export function assertActualBytes(
  bytes: Uint8Array,
  artifact: { sha256: string; byteLength: number },
  code: string,
): void {
  if (
    bytes.byteLength !== artifact.byteLength ||
    createHash('sha256').update(bytes).digest('hex') !== artifact.sha256
  ) {
    throw new Error(code);
  }
}

export function assertSameBytes(left: Uint8Array, right: Uint8Array): void {
  if (
    left.byteLength !== right.byteLength ||
    left.some((byte, index) => byte !== right[index])
  ) {
    throw new Error('AEO_EDITING_DRAFT_PERSISTED_READBACK_DRIFT');
  }
}

export function assertExpectedRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('AEO_EDITING_EXPECTED_REVISION_INVALID');
  }
}

export function assertExpectedWorkItemRevision(
  workItem: CanonicalWorkItemProjection,
  expectedRevision: number,
): void {
  if (workItem.revision !== expectedRevision) {
    throw new Error('WORK_ITEM_CAS_CONFLICT');
  }
}

export function withoutRevision(
  workItem: CanonicalWorkItemProjection,
): Omit<CanonicalWorkItemProjection, 'revision'> {
  const { revision: _revision, ...rest } = workItem;
  return rest;
}

export function errorCode(error: unknown): string {
  return error instanceof Error
    ? error.message.split(':', 1)[0]
    : 'AEO_EDITING_DRAFT_FAILED';
}

function decisionRef(
  workItem: CanonicalWorkItemProjection,
  request: CanonicalAeoEditingDraftFeedbackRequest,
  actor: CanonicalHostActor,
): string {
  const digest = createHash('sha256')
    .update(
      [
        workItem.workItemId,
        workItem.revision,
        actor.userId,
        request.feedbackRef,
        request.suggestionRef,
        request.expectedGenerationRevision,
      ].join('\u0000'),
    )
    .digest('hex');
  return `aeo-feedback://canonical-host/${digest}`;
}

function uniqueNonEmpty(values: string[]): boolean {
  return (
    values.every((value) => typeof value === 'string' && value.trim() !== '') &&
    new Set(values).size === values.length
  );
}

function uniqueRefs(
  refs: Array<{ sourceId: string; locator: string }>,
): boolean {
  return (
    refs.every((ref) => ref.sourceId.trim() && ref.locator.trim()) &&
    new Set(refs.map((ref) => `${ref.sourceId}#${ref.locator}`)).size ===
      refs.length
  );
}
