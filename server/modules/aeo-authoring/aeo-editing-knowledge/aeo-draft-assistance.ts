import type {
  AeoContentBlock,
  AeoParagraphBlock,
  AeoSourceBinding,
} from '../../../../shared/aeo-editor';

import {
  AEO_DRAFT_ASSISTANCE_VERSION,
  type AeoDraftAssistanceCandidate,
  type AeoDraftAssistanceRequest,
  type AeoDraftFeedback,
  type AeoDraftFeedbackInput,
  type AeoDraftRegenerationRequest,
  type AeoDraftSuggestion,
  type AeoEditingActionUnit,
  type AeoEditingKnowledgeCandidate,
  type AeoEditingSourceIdentity,
  type AeoEditingSourceRef,
  type AeoSupersededDraftFeedback,
} from './aeo-editing-knowledge.types';
import { buildAeoDraftFeedbackEvent } from './aeo-draft-feedback-learning';
import {
  assertAeoDraftRegenerationContext,
  resolveAeoDraftRegenerationSources,
} from './aeo-draft-regeneration-sources';
import { assertAeoEditingKnowledgeCandidate } from './aeo-editing-knowledge.validator';

const DRAFT_NON_CLAIMS: string[] = [
  'Generated and regenerated content remains editable candidate material until an engineer decides each suggestion.',
  'Replay and version diff do not establish approval, signature, publication, release, airworthiness truth, or aircraft work authorization.',
  'Missing inputs remain explicit; this adapter does not guess absent engineering requirements.',
];

export function createAeoDraftAssistanceCandidate(
  request: AeoDraftAssistanceRequest,
): AeoDraftAssistanceCandidate {
  assertAeoEditingKnowledgeCandidate(request.knowledge);
  assertRequest(request);
  const selected: Set<string> = new Set<string>(request.selectedUnitIds);
  const suggestions: AeoDraftSuggestion[] = request.knowledge.actionUnits
    .filter((unit: AeoEditingActionUnit) => selected.has(unit.unitId))
    .sort(
      (left: AeoEditingActionUnit, right: AeoEditingActionUnit) =>
        left.sequence - right.sequence,
    )
    .map((unit: AeoEditingActionUnit) =>
      suggestionFromUnit(unit, request.knowledge),
    );
  return {
    schemaVersion: AEO_DRAFT_ASSISTANCE_VERSION,
    lifecycleStatus: 'CANDIDATE_ONLY',
    authority: 'EDITABLE_DRAFT_NOT_APPROVAL_NOT_RELEASE',
    draftKey: request.draftKey,
    title: request.title,
    generationRevision: 1,
    knowledgeDocumentIdentity: request.knowledge.documentIdentity,
    knowledgeDocumentState: request.knowledge.documentState,
    sources: request.knowledge.sources,
    currentSourceRefs: uniqueRefs(request.currentSourceRefs),
    suggestions,
    editorBlocks: suggestions.map(
      (suggestion: AeoDraftSuggestion, index: number) =>
        editorBlock(suggestion, request.knowledge.sources, index),
    ),
    missingInputs: request.knowledge.missingInputs,
    conflicts: request.knowledge.conflicts,
    feedback: [],
    supersededFeedback: [],
    regenerationHistory: [],
    nonClaims: unique([...request.knowledge.nonClaims, ...DRAFT_NON_CLAIMS]),
  };
}

export function regenerateAeoDraftSelection(
  current: AeoDraftAssistanceCandidate,
  request: AeoDraftRegenerationRequest,
  reason: string,
): AeoDraftAssistanceCandidate {
  assertAeoDraftRegenerationContext(current, request, reason);
  const replacement: AeoDraftAssistanceCandidate =
    createAeoDraftAssistanceCandidate(request);
  const replacedUnitIds: Set<string> = new Set<string>(request.selectedUnitIds);
  const unselectedSuggestions: AeoDraftSuggestion[] =
    current.suggestions.filter(
      (suggestion: AeoDraftSuggestion) =>
        !replacedUnitIds.has(suggestion.sourceUnitId),
    );
  const sources: AeoEditingSourceIdentity[] =
    resolveAeoDraftRegenerationSources(
      current.sources,
      request.knowledge.sources,
      unselectedSuggestions,
    );
  const suggestions: AeoDraftSuggestion[] = [
    ...unselectedSuggestions,
    ...replacement.suggestions,
  ];
  const ordered: AeoDraftSuggestion[] = orderSuggestions(
    suggestions,
    request.knowledge,
  );
  const generationRevision: number = current.generationRevision + 1;
  const replacedSuggestionUnits: Map<string, string> = new Map(
    current.suggestions
      .filter((suggestion: AeoDraftSuggestion) =>
        replacedUnitIds.has(suggestion.sourceUnitId),
      )
      .map((suggestion: AeoDraftSuggestion) => [
        suggestion.suggestionId,
        suggestion.sourceUnitId,
      ]),
  );
  const replacedSuggestionIds: Set<string> = new Set(
    replacedSuggestionUnits.keys(),
  );
  const supersededFeedback: AeoSupersededDraftFeedback[] = current.feedback
    .filter((feedback: AeoDraftFeedback) =>
      replacedSuggestionIds.has(feedback.suggestionId),
    )
    .map((feedback: AeoDraftFeedback) => {
      const sourceUnitId: string | undefined = replacedSuggestionUnits.get(
        feedback.suggestionId,
      );
      if (!sourceUnitId) {
        throw new Error(
          `AEO_DRAFT_REGENERATION_FEEDBACK_SUGGESTION_MISSING: ${feedback.suggestionId}`,
        );
      }
      return {
        feedback,
        sourceUnitId,
        activeThroughGenerationRevision: current.generationRevision,
        supersededAtGenerationRevision: generationRevision,
        reason: 'SELECTED_UNIT_REGENERATED',
      };
    });
  return {
    ...current,
    schemaVersion: AEO_DRAFT_ASSISTANCE_VERSION,
    title: request.title,
    generationRevision,
    knowledgeDocumentIdentity: request.knowledge.documentIdentity,
    knowledgeDocumentState: request.knowledge.documentState,
    sources,
    currentSourceRefs: uniqueRefs(request.currentSourceRefs),
    suggestions: ordered,
    editorBlocks: ordered
      .filter(
        (suggestion: AeoDraftSuggestion) =>
          suggestion.reviewStatus !== 'REJECTED_CANDIDATE',
      )
      .map((suggestion: AeoDraftSuggestion, index: number) =>
        editorBlock(suggestion, sources, index),
      ),
    missingInputs: request.knowledge.missingInputs,
    conflicts: request.knowledge.conflicts,
    feedback: current.feedback.filter(
      (feedback: AeoDraftFeedback) =>
        !replacedSuggestionIds.has(feedback.suggestionId),
    ),
    supersededFeedback: [
      ...(current.supersededFeedback ?? []),
      ...supersededFeedback,
    ],
    regenerationHistory: [
      ...current.regenerationHistory,
      {
        generationRevision,
        regeneratedUnitIds: [...request.selectedUnitIds],
        reason: reason.trim(),
      },
    ],
  };
}

export function recordAeoDraftFeedback(
  current: AeoDraftAssistanceCandidate,
  input: AeoDraftFeedbackInput,
): AeoDraftAssistanceCandidate {
  if (current.generationRevision !== input.expectedGenerationRevision) {
    throw new Error(
      `AEO_DRAFT_FEEDBACK_GENERATION_CONFLICT: expected ${String(
        input.expectedGenerationRevision,
      )}, current ${String(current.generationRevision)}`,
    );
  }
  if (
    current.feedback.some(
      (feedback: AeoDraftFeedback) => feedback.feedbackId === input.feedbackId,
    )
  ) {
    throw new Error(`AEO_DRAFT_FEEDBACK_ID_DUPLICATE: ${input.feedbackId}`);
  }
  const suggestion: AeoDraftSuggestion | undefined = current.suggestions.find(
    (item: AeoDraftSuggestion) => item.suggestionId === input.suggestionId,
  );
  if (!suggestion) {
    throw new Error(`AEO_DRAFT_SUGGESTION_NOT_FOUND: ${input.suggestionId}`);
  }
  const revisionSourceRefs: AeoEditingSourceRef[] = uniqueRefs(
    input.revisionSourceRefs ?? [],
  );
  if (input.decision === 'MODIFY') {
    if (!input.revisedBodyZh && !input.revisedBodyEn) {
      throw new Error('AEO_DRAFT_MODIFIED_BODY_REQUIRED');
    }
    if (revisionSourceRefs.length === 0) {
      throw new Error('AEO_DRAFT_MODIFICATION_SOURCE_REF_REQUIRED');
    }
    assertRefsDeclared(revisionSourceRefs, current.sources);
  }
  if (!input.engineerDecisionRef.trim() || !input.note.trim()) {
    throw new Error('AEO_DRAFT_ENGINEER_DECISION_AND_REASON_REQUIRED');
  }
  const updatedSuggestion: AeoDraftSuggestion = applyFeedbackToSuggestion(
    suggestion,
    input,
    revisionSourceRefs,
  );
  const feedback: AeoDraftFeedback = buildAeoDraftFeedbackEvent(
    suggestion,
    updatedSuggestion,
    input,
    revisionSourceRefs,
  );
  const nextSuggestions: AeoDraftSuggestion[] = current.suggestions.map(
    (item: AeoDraftSuggestion) =>
      item.suggestionId === input.suggestionId ? updatedSuggestion : item,
  );
  return {
    ...current,
    suggestions: nextSuggestions,
    editorBlocks: applyFeedbackToBlocks(
      current.editorBlocks,
      updatedSuggestion,
      current.sources,
      feedback,
    ),
    feedback: [...current.feedback, feedback],
  };
}

export function replayAeoDraftFeedback(
  base: AeoDraftAssistanceCandidate,
  feedback: AeoDraftFeedbackInput[],
): AeoDraftAssistanceCandidate {
  return feedback.reduce(
    (current: AeoDraftAssistanceCandidate, input: AeoDraftFeedbackInput) =>
      recordAeoDraftFeedback(current, input),
    base,
  );
}

function suggestionFromUnit(
  unit: AeoEditingActionUnit,
  knowledge: AeoEditingKnowledgeCandidate,
): AeoDraftSuggestion {
  const company: boolean = knowledge.companyStepCandidateUnitIds.includes(
    unit.unitId,
  );
  return {
    suggestionId: `${knowledge.knowledgeVersion}:${unit.unitId}`,
    sourceUnitId: unit.unitId,
    section: unit.phase,
    kind: company ? 'COMPANY_STEP_CANDIDATE' : 'APPLICABLE_TEMPLATE_CANDIDATE',
    bodyZh: unit.bodyZh,
    bodyEn: unit.bodyEn,
    parameters: unit.parameters,
    conditions: unit.conditions,
    dependencies: unit.dependencies,
    branches: unit.branches,
    performerRoles: unit.performerRoles,
    inspectorRoles: unit.inspectorRoles,
    signatureGranularity: unit.signatureGranularity,
    verifications: unit.verifications,
    closeout: unit.closeout,
    safetyNotes: unit.safetyNotes,
    inspectionDetail: unit.inspectionDetail,
    sourceRefs: unit.sourceRefs,
    editable: true,
    reviewStatus: 'PENDING_ENGINEER_REVIEW',
    engineerDecisionRef: null,
  };
}

function editorBlock(
  suggestion: AeoDraftSuggestion,
  sources: AeoEditingSourceIdentity[],
  index: number,
): AeoParagraphBlock {
  const sourceMap: Map<string, AeoEditingSourceIdentity> = new Map(
    sources.map((source: AeoEditingSourceIdentity) => [
      source.sourceId,
      source,
    ]),
  );
  const adapted: boolean = suggestion.reviewStatus === 'MODIFIED_CANDIDATE';
  const adopted: boolean = suggestion.reviewStatus === 'ACCEPTED_CANDIDATE';
  const originType: AeoSourceBinding['originType'] = adapted
    ? 'SOURCE_ADAPTED'
    : adopted
      ? 'SOURCE_ADOPTED'
      : 'HISTORICAL_OCCURRENCE_COPIED';
  const bindings: AeoSourceBinding[] = suggestion.sourceRefs.map(
    (ref: AeoEditingSourceRef, refIndex: number) => {
      const source: AeoEditingSourceIdentity | undefined = sourceMap.get(
        ref.sourceId,
      );
      if (!source || !source.sha256) {
        throw new Error(
          `AEO_DRAFT_SOURCE_BINDING_INCOMPLETE: ${ref.sourceId}#${ref.locator}`,
        );
      }
      return {
        bindingId: `${suggestion.suggestionId}:SRC:${refIndex + 1}`,
        originType,
        usage: adapted ? 'ADAPTED' : adopted ? 'ADOPTED' : 'REFERENCE_ONLY',
        sourceArtifactRef: source.artifactRef,
        sourceNodeRef: suggestion.sourceUnitId,
        sourceVersion:
          source.observedIdentity ?? 'CANDIDATE_SOURCE_VERSION_UNKNOWN',
        sourceSha256: source.sha256,
        locator: ref.locator,
        language:
          suggestion.bodyZh && suggestion.bodyEn
            ? 'BILINGUAL'
            : suggestion.bodyZh
              ? 'ZH'
              : 'EN',
      };
    },
  );
  return {
    blockId: suggestion.suggestionId,
    orderKey: String((index + 1) * 10).padStart(6, '0'),
    blockType: 'PARAGRAPH',
    originType,
    sourceBindings: bindings,
    engineerDecisionRef: suggestion.engineerDecisionRef,
    unresolved:
      suggestion.reviewStatus === 'PENDING_ENGINEER_REVIEW'
        ? [
            {
              unresolvedId: `${suggestion.suggestionId}:ENGINEER_REVIEW`,
              code: 'AEO_EDITING_SUGGESTION_REQUIRES_ENGINEER_DECISION',
              message:
                '候选段落必须由工程师接受、修改或拒绝；来源频次不形成工程要求。',
              severity: 'BLOCKING',
              blocksCheckpoint: true,
            },
          ]
        : [],
    bodyZh: suggestion.bodyZh,
    bodyEn: suggestion.bodyEn,
  };
}

function applyFeedbackToSuggestion(
  suggestion: AeoDraftSuggestion,
  feedback: AeoDraftFeedbackInput,
  revisionSourceRefs: AeoEditingSourceRef[],
): AeoDraftSuggestion {
  return {
    ...suggestion,
    bodyZh:
      feedback.decision === 'MODIFY'
        ? feedback.revisedBodyZh
        : suggestion.bodyZh,
    bodyEn:
      feedback.decision === 'MODIFY'
        ? feedback.revisedBodyEn
        : suggestion.bodyEn,
    sourceRefs:
      feedback.decision === 'MODIFY'
        ? uniqueRefs([...suggestion.sourceRefs, ...revisionSourceRefs])
        : suggestion.sourceRefs,
    reviewStatus:
      feedback.decision === 'ACCEPT'
        ? 'ACCEPTED_CANDIDATE'
        : feedback.decision === 'MODIFY'
          ? 'MODIFIED_CANDIDATE'
          : 'REJECTED_CANDIDATE',
    engineerDecisionRef: feedback.engineerDecisionRef,
  };
}

function applyFeedbackToBlocks(
  blocks: AeoContentBlock[],
  updatedSuggestion: AeoDraftSuggestion,
  sources: AeoEditingSourceIdentity[],
  feedback: AeoDraftFeedback,
): AeoContentBlock[] {
  if (feedback.decision === 'REJECT') {
    return blocks.filter(
      (block: AeoContentBlock) =>
        block.blockId !== updatedSuggestion.suggestionId,
    );
  }
  return blocks.map((block: AeoContentBlock, index: number) =>
    block.blockId === updatedSuggestion.suggestionId
      ? editorBlock(updatedSuggestion, sources, index)
      : block,
  );
}

function assertRequest(request: AeoDraftAssistanceRequest): void {
  if (!request.draftKey.trim() || !request.title.trim()) {
    throw new Error('AEO_DRAFT_KEY_AND_TITLE_REQUIRED');
  }
  if (request.selectedUnitIds.length === 0) {
    throw new Error('AEO_DRAFT_SELECTED_UNIT_REQUIRED');
  }
  if (request.currentSourceRefs.length === 0) {
    throw new Error('AEO_DRAFT_CURRENT_SOURCE_REF_REQUIRED');
  }
  const known: Set<string> = new Set(
    request.knowledge.actionUnits.map(
      (unit: AeoEditingActionUnit) => unit.unitId,
    ),
  );
  request.selectedUnitIds.forEach((unitId: string) => {
    if (!known.has(unitId)) {
      throw new Error(`AEO_DRAFT_SELECTED_UNIT_UNKNOWN: ${unitId}`);
    }
  });
  assertRefsDeclared(request.currentSourceRefs, request.knowledge.sources);
}

function assertRefsDeclared(
  refs: AeoEditingSourceRef[],
  sources: AeoEditingSourceIdentity[],
): void {
  const sourceIds: Set<string> = new Set(
    sources.map((source: AeoEditingSourceIdentity) => source.sourceId),
  );
  refs.forEach((ref: AeoEditingSourceRef) => {
    if (!sourceIds.has(ref.sourceId)) {
      throw new Error(`AEO_DRAFT_SOURCE_REF_UNKNOWN: ${ref.sourceId}`);
    }
  });
}

function orderSuggestions(
  suggestions: AeoDraftSuggestion[],
  knowledge: AeoEditingKnowledgeCandidate,
): AeoDraftSuggestion[] {
  const sequence: Map<string, number> = new Map(
    knowledge.actionUnits.map((unit: AeoEditingActionUnit) => [
      unit.unitId,
      unit.sequence,
    ]),
  );
  return [...suggestions].sort(
    (left: AeoDraftSuggestion, right: AeoDraftSuggestion) =>
      (sequence.get(left.sourceUnitId) ?? Number.MAX_SAFE_INTEGER) -
      (sequence.get(right.sourceUnitId) ?? Number.MAX_SAFE_INTEGER),
  );
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function uniqueRefs(values: AeoEditingSourceRef[]): AeoEditingSourceRef[] {
  const seen: Set<string> = new Set<string>();
  return values.filter((ref: AeoEditingSourceRef) => {
    const key: string = `${ref.sourceId}#${ref.locator}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
