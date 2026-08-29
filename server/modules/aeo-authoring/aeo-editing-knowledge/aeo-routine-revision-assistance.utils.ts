import type {
  AeoEditingSourceIdentity,
  AeoEditingSourceRef,
  AeoRoutineRevisionSlot,
  AeoRoutineRevisionSlotEdit,
} from './aeo-editing-knowledge.types';

export const AEO_ROUTINE_REVISION_SLOTS: AeoRoutineRevisionSlot[] = [
  'headerRevision',
  'step2Msp',
  'step2NewLsp',
  'step3NewLsp',
  'step4OldLsp',
];

export function normalizeSlotEdits(
  transition: Record<string, unknown>,
  semanticLocators: Map<string, Record<string, unknown>>,
  parameterSourceId: string,
  targetSourceId: string,
): AeoRoutineRevisionSlotEdit[] {
  return records(transition.semanticChanges).map(
    (change: Record<string, unknown>) => {
      const slot: AeoRoutineRevisionSlot = routineSlot(change.slot);
      const semantic: Record<string, unknown> | undefined =
        semanticLocators.get(slot);
      if (!semantic) {
        throw new Error(`AEO_ROUTINE_REVISION_LOCATOR_MISSING: ${slot}`);
      }
      return {
        slot,
        oldValue: requiredText(change.old, `${slot}.old`),
        sourceSuggestedValue: requiredText(change.new, `${slot}.new`),
        editableValue: requiredText(change.new, `${slot}.new`),
        semanticLocator: requiredText(
          semantic.locatorStrategy,
          `${slot}.locatorStrategy`,
        ),
        runEvidenceLocator: requiredText(
          change.ooxmlEvidence,
          `${slot}.ooxmlEvidence`,
        ),
        sourceRefs: slotSourceRefs(slot, parameterSourceId, targetSourceId),
        reviewStatus: 'PENDING_ENGINEER_REVIEW',
        engineerFeedbackId: null,
        engineerRationale: null,
      };
    },
  );
}

export function assertFiveSlotReplay(
  edits: AeoRoutineRevisionSlotEdit[],
  parameterMap: Record<string, unknown>,
  targetSource: Record<string, unknown>,
): void {
  if (
    edits.length !== AEO_ROUTINE_REVISION_SLOTS.length ||
    AEO_ROUTINE_REVISION_SLOTS.some(
      (slot: AeoRoutineRevisionSlot) =>
        edits.filter((edit: AeoRoutineRevisionSlotEdit) => edit.slot === slot)
          .length !== 1,
    )
  ) {
    throw new Error('AEO_ROUTINE_REVISION_EXACT_FIVE_SLOTS_REQUIRED');
  }
  const values: Map<AeoRoutineRevisionSlot, string> = new Map(
    edits.map((edit: AeoRoutineRevisionSlotEdit) => [
      edit.slot,
      edit.sourceSuggestedValue,
    ]),
  );
  const expectedRevision: string = revisionFromIdentity(
    targetSource.observedIdentity,
  );
  if (
    values.get('headerRevision') !== expectedRevision ||
    values.get('step2Msp') !== text(parameterMap.msp) ||
    values.get('step2NewLsp') !== text(parameterMap.lsp) ||
    values.get('step3NewLsp') !== text(parameterMap.lsp) ||
    values.get('step4OldLsp') !== text(parameterMap.previousEcl)
  ) {
    throw new Error('AEO_ROUTINE_REVISION_SLOT_SOURCE_MISMATCH');
  }
}

export function assertProjectionIdentity(
  projection: Record<string, unknown>,
  pattern: Record<string, unknown>,
  provenance: Record<string, unknown>,
): void {
  if (
    projection.recordType !== 'aeo-editing-v0-local-consumer-projection' ||
    projection.status !== 'CANDIDATE_ONLY' ||
    pattern.recordType !== 'aeo-editing-v0-category-knowledge-candidate' ||
    pattern.status !== 'CANDIDATE_ONLY' ||
    pattern.category !== 'ROUTINE_PARAMETER_REVISION_UPDATE' ||
    provenance.recordType !== 'local-aeo-routine-revision-sample-provenance' ||
    provenance.status !== 'CANDIDATE_ONLY'
  ) {
    throw new Error('AEO_ROUTINE_REVISION_INPUT_PROJECTION_UNSUPPORTED');
  }
}

export function findCategoryPattern(
  projection: Record<string, unknown>,
): Record<string, unknown> {
  return findBy(
    records(projection.categoryPatterns),
    'category',
    'ROUTINE_PARAMETER_REVISION_UPDATE',
  );
}

export function findBy(
  values: Record<string, unknown>[],
  field: string,
  expected: string,
): Record<string, unknown> {
  const matches: Record<string, unknown>[] = values.filter(
    (value: Record<string, unknown>) => value[field] === expected,
  );
  if (matches.length !== 1) {
    throw new Error(`AEO_ROUTINE_REVISION_EXACT_MATCH_REQUIRED: ${field}`);
  }
  const match: Record<string, unknown> | undefined = matches[0];
  if (!match) {
    throw new Error(`AEO_ROUTINE_REVISION_EXACT_MATCH_REQUIRED: ${field}`);
  }
  return match;
}

export function requiredSource(
  sourceMap: Map<string, Record<string, unknown>>,
  sourceId: string,
): Record<string, unknown> {
  const source: Record<string, unknown> | undefined = sourceMap.get(sourceId);
  if (!source) {
    throw new Error(`AEO_ROUTINE_REVISION_SOURCE_MISSING: ${sourceId}`);
  }
  return source;
}

export function normalizeSource(
  source: Record<string, unknown>,
): AeoEditingSourceIdentity {
  return {
    sourceId: requiredText(source.sourceId, 'source.sourceId'),
    role: requiredText(source.role, 'source.role'),
    artifactRef: requiredText(source.path, 'source.path'),
    actualBytes: positiveInteger(source.bytes, 'source.bytes'),
    sha256: optionalText(source.sha256),
    observedIdentity: optionalText(source.observedIdentity),
    identityLocator: null,
  };
}

function slotSourceRefs(
  slot: AeoRoutineRevisionSlot,
  parameterSourceId: string,
  targetSourceId: string,
): AeoEditingSourceRef[] {
  if (slot === 'headerRevision') {
    return [
      {
        sourceId: targetSourceId,
        locator: 'active section header identity, revision suffix',
      },
    ];
  }
  const row: string =
    slot === 'step2Msp'
      ? 'MSP row'
      : slot === 'step4OldLsp'
        ? 'Previous ECL row'
        : 'LSP row';
  return [{ sourceId: parameterSourceId, locator: `page 1, ${row}` }];
}

export function feedbackSlot(value: unknown): AeoRoutineRevisionSlot {
  const target: Record<string, unknown> = record(
    value,
    'feedback.targetLocator',
  );
  const field: string = requiredText(
    target.field,
    'feedback.targetLocator.field',
  );
  const sequence: number = Number(target.actionSequence);
  if (field === 'oldLspToDelete') {
    return 'step4OldLsp';
  }
  if (field === 'msp') {
    return 'step2Msp';
  }
  if (field === 'newLsp' && sequence === 2) {
    return 'step2NewLsp';
  }
  if (field === 'newLsp' && sequence === 3) {
    return 'step3NewLsp';
  }
  if (field === 'headerRevision') {
    return 'headerRevision';
  }
  throw new Error(`AEO_FEEDBACK_TARGET_LOCATOR_UNSUPPORTED: ${field}`);
}

export function feedbackReviewStatus(
  value: unknown,
): AeoRoutineRevisionSlotEdit['reviewStatus'] {
  if (value === 'ADOPT') {
    return 'ACCEPTED_CANDIDATE';
  }
  if (value === 'IGNORE' || value === 'DELETE') {
    return 'REJECTED_CANDIDATE';
  }
  return 'MODIFIED_CANDIDATE';
}

function routineSlot(value: unknown): AeoRoutineRevisionSlot {
  const slot: string = requiredText(value, 'semanticChange.slot');
  if (!AEO_ROUTINE_REVISION_SLOTS.includes(slot as AeoRoutineRevisionSlot)) {
    throw new Error(`AEO_ROUTINE_REVISION_SLOT_UNSUPPORTED: ${slot}`);
  }
  return slot as AeoRoutineRevisionSlot;
}

export function revisionFromIdentity(value: unknown): string {
  const identity: string = requiredText(value, 'source.observedIdentity');
  const match: RegExpMatchArray | null = identity.match(/-(R\d+)$/u);
  if (!match?.[1]) {
    throw new Error('AEO_ROUTINE_REVISION_TARGET_IDENTITY_INVALID');
  }
  return match[1];
}

export function aeoNumberFromIdentity(value: unknown): string {
  const identity: string = requiredText(value, 'source.observedIdentity');
  const match: RegExpMatchArray | null = identity.match(/^(AEO-.+)-R\d+$/u);
  if (!match?.[1]) {
    throw new Error('AEO_ROUTINE_REVISION_AEO_IDENTITY_INVALID');
  }
  return match[1];
}

export function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`AEO_ROUTINE_REVISION_OBJECT_REQUIRED: ${path}`);
  }
  return value as Record<string, unknown>;
}

export function records(value: unknown): Record<string, unknown>[] {
  return array(value).map((entry: unknown, index: number) =>
    record(entry, `array[${index}]`),
  );
}

export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error('AEO_ROUTINE_REVISION_ARRAY_REQUIRED');
  }
  return value;
}

export function texts(value: unknown): string[] {
  return array(value).map((entry: unknown, index: number) =>
    requiredText(entry, `stringArray[${index}]`),
  );
}

export function requiredText(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`AEO_ROUTINE_REVISION_TEXT_REQUIRED: ${path}`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

export function text(value: unknown): string {
  return optionalText(value) ?? '';
}

export function integer(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`AEO_ROUTINE_REVISION_INTEGER_REQUIRED: ${path}`);
  }
  return Number(value);
}

function positiveInteger(value: unknown, path: string): number {
  const parsed: number = integer(value, path);
  if (parsed === 0) {
    throw new Error(`AEO_ROUTINE_REVISION_POSITIVE_INTEGER_REQUIRED: ${path}`);
  }
  return parsed;
}

export function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
