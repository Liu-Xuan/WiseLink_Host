import { validateMatterRevisitWhen } from './matter-revisit';
import type {
  AssessmentEvidence,
  AssessmentReadingClaim,
  AssessmentReadingResult,
} from '@shared/assessment-reading.interface';
import type {
  EngineeringMatterPendingInput,
  EngineeringMatterPendingInputReason,
  EngineeringMatterWorkingClaimDelta,
  EngineeringMatterWorkingCoverage,
  EngineeringMatterWorkingFocus,
  EngineeringMatterWorkingInputBinding,
  EngineeringMatterWorkingRevisionChange,
  EngineeringMatterWorkingRevisionCommand,
  EngineeringMatterWorkingState,
  EngineeringMatterWorkingTextItem,
  EngineeringMatterWorkingTextItemDelta,
} from '@shared/matter-working.interface';

import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { validateMatterProblemWork } from './matter-problem-work';

export interface EngineeringMatterWorkingMaterialization {
  state: EngineeringMatterWorkingState;
  change: EngineeringMatterWorkingRevisionChange;
  resultChanged: boolean;
  coverageChanged: boolean;
}

export function materializeEngineeringMatterWorkingState(input: {
  matterId: string;
  current: EngineeringMatterWorkingState | null;
  command: EngineeringMatterWorkingRevisionCommand;
}): EngineeringMatterWorkingMaterialization {
  requiredText(input.matterId, 'MATTER_ID_REQUIRED');
  validateCommandEnvelope(input.command);
  if (input.current) validateState(input.current, input.matterId);

  if (input.current === null) {
    if (input.command.expectedWorkingRevision !== 0) {
      fail('ENGINEERING_MATTER_WORKING_CAS_CONFLICT');
    }
    if (
      input.command.updateKind !== 'INITIAL_SYNTHESIS' ||
      input.command.nextFocus === null ||
      input.command.nextSubstantiveResult === null
    ) {
      fail('ENGINEERING_MATTER_WORKING_INITIAL_SYNTHESIS_REQUIRED');
    }
  } else {
    if (input.command.updateKind === 'INITIAL_SYNTHESIS') {
      fail('ENGINEERING_MATTER_WORKING_UPDATE_KIND_INVALID');
    }
    if (
      input.command.expectedWorkingRevision < 1 ||
      (input.command.nextFocus === null &&
        input.command.nextSubstantiveResult === null &&
        input.command.openQuestionDelta === null &&
        input.command.reviewConditionDelta === null &&
        input.command.coverageUpdates.length === 0)
    ) {
      fail('ENGINEERING_MATTER_WORKING_COMMAND_NO_EFFECT');
    }
  }

  const focus: EngineeringMatterWorkingFocus = input.command.nextFocus
    ? validateFocus(input.command.nextFocus)
    : input.current!.focus;
  const currentResult: AssessmentReadingResult | null =
    input.current?.substantiveResult ?? null;
  const nextResult: AssessmentReadingResult | null = materializeResult({
    matterId: input.matterId,
    current: currentResult,
    command: input.command,
  });
  if (
    input.current?.problemWork &&
    input.command.nextSubstantiveResult &&
    !input.command.nextProblemWork
  )
    fail('ENGINEERING_MATTER_PROBLEM_WORK_UPDATE_REQUIRED');
  if (input.command.nextProblemWork && !input.command.nextSubstantiveResult)
    fail('ENGINEERING_MATTER_PROBLEM_WORK_READING_REQUIRED');
  const problemWork =
    input.command.nextProblemWork ?? input.current?.problemWork;
  const resultChanged: boolean =
    canonicalJson(currentResult) !== canonicalJson(nextResult);

  const openQuestions = applyTextItemDelta(
    input.current?.openQuestions ?? [],
    input.command.openQuestionDelta,
  );
  const reviewConditions = applyTextItemDelta(
    input.current?.reviewConditions ?? [],
    input.command.reviewConditionDelta,
  );
  const coverage: EngineeringMatterWorkingCoverage[] = mergeCoverage(
    input.current?.coverage ?? [],
    input.command.coverageUpdates,
  );
  const coverageChanged: boolean =
    canonicalJson(input.current?.coverage ?? []) !== canonicalJson(coverage);
  const substantiveInputs: EngineeringMatterWorkingInputBinding[] = input
    .command.nextSubstantiveResult
    ? validatedInputBindings(input.command.substantiveInputs)
    : (input.current?.substantiveInputs ?? []);

  const priorDocumentCovered = (evidence: AssessmentEvidence): boolean => {
    if (evidence.kind !== 'DOCUMENT_PASSAGE' || !input.current) return false;
    const priorEvidence = input.current.problemWork?.evidence ?? input.current.substantiveResult?.evidence ?? [];
    return priorEvidence.some(item => canonicalJson(item) === canonicalJson(evidence)) &&
      (input.current.problemWork?.readSourceRefs.includes(evidence.evidenceRef) ||
      input.current.coverage.some(item => item.binding.documentVersionId === evidence.documentVersionId &&
        (evidence.workItemId === null || item.binding.workItemId === evidence.workItemId) &&
        item.checkedSourceRefIds.includes(evidence.sourceRefId)));
  };

  if (input.command.nextSubstantiveResult) {
    const coverageByInputId = new Map(
      coverage.map((item: EngineeringMatterWorkingCoverage) => [
        item.binding.inputId,
        item,
      ]),
    );
    for (const binding of substantiveInputs) {
      const covered = coverageByInputId.get(binding.inputId);
      if (
        !covered ||
        covered.contribution !== 'SUBSTANTIVE' ||
        canonicalJson(covered.binding) !== canonicalJson(binding)
      ) {
        fail('ENGINEERING_MATTER_WORKING_SUBSTANTIVE_INPUT_NOT_COVERED');
      }
    }
    for (const evidence of input.command.nextSubstantiveResult.evidence) {
      if (evidence.kind !== 'DOCUMENT_PASSAGE') continue;
      const binding = substantiveInputs.find(
        (candidate) =>
          (evidence.workItemId === null || candidate.workItemId === evidence.workItemId) &&
          candidate.documentVersionId === evidence.documentVersionId,
      );
      if (!binding) {
        if (priorDocumentCovered(evidence)) continue;
        fail('ENGINEERING_MATTER_WORKING_DOCUMENT_EVIDENCE_INPUT_MISSING');
      }
      const checked = coverageByInputId.get(binding.inputId)!;
      if (!checked.checkedSourceRefIds.includes(evidence.sourceRefId)) {
        if (priorDocumentCovered(evidence)) continue;
        fail('ENGINEERING_MATTER_WORKING_DOCUMENT_EVIDENCE_NOT_CHECKED');
      }
    }
  }

  // Full work retains material beyond the short reader, including risk and measure evidence.
  for (const evidence of input.command.nextProblemWork?.evidence ?? []) {
    if (evidence.kind !== 'DOCUMENT_PASSAGE') continue;
    const covered = coverage.find(
      (item) =>
        (evidence.workItemId === null || item.binding.workItemId === evidence.workItemId) &&
        item.binding.documentVersionId === evidence.documentVersionId &&
        item.checkedSourceRefIds.includes(evidence.sourceRefId),
    );
    if (!covered && !priorDocumentCovered(evidence))
      fail('ENGINEERING_MATTER_WORKING_PROBLEM_EVIDENCE_NOT_COVERED');
  }

  const state: EngineeringMatterWorkingState = {
    schemaVersion: 'wiselink.3_1.engineering_matter_working_state.v1',
    focus,
    substantiveResult: nextResult,
    openQuestions: openQuestions.items,
    reviewConditions: reviewConditions.items,
    substantiveInputs,
    coverage,
    ...(problemWork ? { problemWork: structuredClone(problemWork) } : {}),
  };
  validateState(state, input.matterId);

  const focusChanged: boolean =
    canonicalJson(input.current?.focus ?? null) !== canonicalJson(focus);
  if (
    !resultChanged &&
    !focusChanged &&
    !openQuestions.changed &&
    !reviewConditions.changed &&
    !coverageChanged
  ) {
    fail('ENGINEERING_MATTER_WORKING_COMMAND_NO_EFFECT');
  }
  return {
    state,
    change: engineeringMatterWorkingChangeFromCommand(input.command),
    resultChanged,
    coverageChanged,
  };
}

export function parseEngineeringMatterWorkingState(
  value: string,
  matterId: string,
): EngineeringMatterWorkingState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    fail('ENGINEERING_MATTER_WORKING_STATE_JSON_INVALID');
  }
  validateState(parsed, matterId);
  return parsed;
}

export function parseEngineeringMatterWorkingCommand(
  value: string,
): EngineeringMatterWorkingRevisionCommand {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    fail('ENGINEERING_MATTER_WORKING_COMMAND_JSON_INVALID');
  }
  if (!isRecord(parsed)) fail('ENGINEERING_MATTER_WORKING_COMMAND_INVALID');
  validateCommandEnvelope(
    parsed as unknown as EngineeringMatterWorkingRevisionCommand,
  );
  return parsed as unknown as EngineeringMatterWorkingRevisionCommand;
}

export function engineeringMatterPendingInputs(
  current: EngineeringMatterWorkingState | null,
  currentInputs: EngineeringMatterWorkingInputBinding[],
): EngineeringMatterPendingInput[] {
  const validated = validatedInputBindings(currentInputs);
  const coveredByInputId = new Map(
    (current?.coverage ?? []).map(
      (coverage: EngineeringMatterWorkingCoverage) => [
        coverage.binding.inputId,
        coverage,
      ],
    ),
  );
  const pending: EngineeringMatterPendingInput[] = [];
  for (const binding of validated) {
    const checked = coveredByInputId.get(binding.inputId) ?? null;
    const covered = checked?.binding ?? null;
    const reasons: EngineeringMatterPendingInputReason[] = [];
    if (!covered) {
      reasons.push('NOT_COVERED');
    } else {
      if (checked?.contribution === 'READ_ONLY') reasons.push('READ_NOT_PROCESSED');
      if (covered.workItemRevision !== binding.workItemRevision) {
        reasons.push('WORK_ITEM_REVISION_CHANGED');
      }
      if (covered.documentVersionId !== binding.documentVersionId) {
        reasons.push('DOCUMENT_VERSION_CHANGED');
      }
      if (covered.original?.parseRunId !== binding.original?.parseRunId ||
          covered.original?.parseRevision !== binding.original?.parseRevision) reasons.push('DOCUMENT_ORIGINAL_CHANGED');
      else if (canonicalJson(covered.original?.semantic ?? null) !== canonicalJson(binding.original?.semantic ?? null))
        reasons.push('DOCUMENT_SEMANTIC_CHANGED');
      if (
        covered.resultRef !== binding.resultRef ||
        covered.resultRevision !== binding.resultRevision
      ) {
        reasons.push('RESULT_CHANGED');
      }
    }
    if (reasons.length > 0) {
      pending.push({
        inputId: binding.inputId,
        current: binding,
        covered,
        reasons,
      });
    }
  }
  return pending;
}

export function assertEngineeringMatterWorkingBindingsCurrent(input: {
  expected: EngineeringMatterWorkingInputBinding[];
  current: EngineeringMatterWorkingInputBinding[];
}): void {
  const expected = validatedInputBindings(input.expected);
  const current = validatedInputBindings(input.current);
  if (canonicalJson(expected) !== canonicalJson(current)) {
    fail('ENGINEERING_MATTER_WORKING_INPUT_CONFLICT');
  }
}

function materializeResult(input: {
  matterId: string;
  current: AssessmentReadingResult | null;
  command: EngineeringMatterWorkingRevisionCommand;
}): AssessmentReadingResult | null {
  const candidate = input.command.nextSubstantiveResult;
  const delta = input.command.claimDelta;
  if ((candidate === null) !== (delta === null)) {
    fail('ENGINEERING_MATTER_WORKING_RESULT_DELTA_REQUIRED');
  }
  if (!candidate) {
    if (input.command.substantiveInputs.length !== 0) {
      fail('ENGINEERING_MATTER_WORKING_SUBSTANTIVE_INPUTS_UNEXPECTED');
    }
    return input.current;
  }
  validateReadingResult(candidate, input.matterId);
  if (
    input.current &&
    candidate.resultRef === input.current.resultRef &&
    candidate.resultRevision <= input.current.resultRevision
  ) {
    fail('ENGINEERING_MATTER_WORKING_RESULT_REVISION_NOT_ADVANCED');
  }
  if (
    input.current &&
    canonicalJson(candidate) === canonicalJson(input.current)
  ) {
    fail('ENGINEERING_MATTER_WORKING_RESULT_UNCHANGED');
  }

  const materializedClaims = applyClaimDelta(
    input.current?.content.claims ?? [],
    delta!,
  );
  // Full JobAid work groups statements by issue. An addition within an older
  // issue may precede claims from later issues without changing those claims.
  const comparableClaims = (claims: AssessmentReadingClaim[]) => input.command.nextProblemWork
    ? [...claims].sort((left, right) => left.claimId.localeCompare(right.claimId)) : claims;
  if (
    canonicalJson(comparableClaims(materializedClaims)) !==
    canonicalJson(comparableClaims(candidate.content.claims))
  ) {
    fail('ENGINEERING_MATTER_WORKING_LOCAL_PATCH_MISMATCH');
  }
  preserveUnchangedEvidence(input.current, candidate, delta!);
  return candidate;
}

function applyClaimDelta(
  current: AssessmentReadingClaim[],
  delta: EngineeringMatterWorkingClaimDelta,
): AssessmentReadingClaim[] {
  requiredText(
    delta.changedBecause,
    'ENGINEERING_MATTER_WORKING_CHANGE_REASON_REQUIRED',
  );
  delta.additions.forEach(validateClaim);
  delta.replacements.forEach(validateClaim);
  const currentById = uniqueMap(
    current,
    'claimId',
    'CURRENT_CLAIM_ID_DUPLICATE',
  );
  const additions = uniqueMap(
    delta.additions,
    'claimId',
    'CLAIM_ADDITION_ID_DUPLICATE',
  );
  const replacements = uniqueMap(
    delta.replacements,
    'claimId',
    'CLAIM_REPLACEMENT_ID_DUPLICATE',
  );
  const retirements = uniqueMap(
    delta.retirements.map((retirement) => {
      requiredText(retirement.claimId, 'CLAIM_RETIREMENT_ID_REQUIRED');
      requiredText(retirement.reason, 'CLAIM_RETIREMENT_REASON_REQUIRED');
      return retirement;
    }),
    'claimId',
    'CLAIM_RETIREMENT_ID_DUPLICATE',
  );
  const unchanged = uniqueStrings(
    delta.explicitlyUnchangedClaimIds,
    'UNCHANGED_CLAIM_ID_DUPLICATE',
  );
  const unchangedIds = new Set(unchanged);
  assertDisjoint(
    [additions, replacements, retirements, unchangedIds],
    'ENGINEERING_MATTER_WORKING_CLAIM_DELTA_OVERLAP',
  );
  for (const id of additions.keys()) {
    if (currentById.has(id))
      fail('ENGINEERING_MATTER_WORKING_CLAIM_ADDITION_EXISTS');
  }
  for (const id of replacements.keys()) {
    if (!currentById.has(id))
      fail('ENGINEERING_MATTER_WORKING_CLAIM_REPLACEMENT_MISSING');
  }
  for (const id of retirements.keys()) {
    if (!currentById.has(id))
      fail('ENGINEERING_MATTER_WORKING_CLAIM_RETIREMENT_MISSING');
  }
  for (const id of unchangedIds) {
    if (!currentById.has(id))
      fail('ENGINEERING_MATTER_WORKING_UNCHANGED_CLAIM_MISSING');
  }
  for (const id of currentById.keys()) {
    if (
      !replacements.has(id) &&
      !retirements.has(id) &&
      !unchangedIds.has(id)
    ) {
      fail('ENGINEERING_MATTER_WORKING_CLAIM_CARRY_FORWARD_INCOMPLETE');
    }
  }
  const result: AssessmentReadingClaim[] = [];
  for (const claim of current) {
    if (retirements.has(claim.claimId)) continue;
    result.push(replacements.get(claim.claimId) ?? claim);
  }
  result.push(...delta.additions);
  return result;
}

function preserveUnchangedEvidence(
  current: AssessmentReadingResult | null,
  candidate: AssessmentReadingResult,
  delta: EngineeringMatterWorkingClaimDelta,
): void {
  if (!current) return;
  const currentEvidence = uniqueMap(
    current.evidence,
    'evidenceRef',
    'CURRENT_EVIDENCE_REF_DUPLICATE',
  );
  const nextEvidence = uniqueMap(
    candidate.evidence,
    'evidenceRef',
    'EVIDENCE_REF_DUPLICATE',
  );
  const currentClaims = uniqueMap(
    current.content.claims,
    'claimId',
    'CURRENT_CLAIM_ID_DUPLICATE',
  );
  for (const claimId of delta.explicitlyUnchangedClaimIds) {
    const claim = currentClaims.get(claimId)!;
    for (const premise of claim.premises) {
      const before = currentEvidence.get(premise.evidenceRef);
      const after = nextEvidence.get(premise.evidenceRef);
      if (!before || !after || canonicalJson(before) !== canonicalJson(after)) {
        fail('ENGINEERING_MATTER_WORKING_UNCHANGED_EVIDENCE_CHANGED');
      }
    }
  }
}

function applyTextItemDelta(
  current: EngineeringMatterWorkingTextItem[],
  delta: EngineeringMatterWorkingTextItemDelta | null,
): { items: EngineeringMatterWorkingTextItem[]; changed: boolean } {
  current.forEach(validateTextItem);
  if (!delta) return { items: current, changed: false };
  delta.upserts.forEach(validateTextItem);
  const currentById = uniqueMap(
    current,
    'itemId',
    'CURRENT_TEXT_ITEM_ID_DUPLICATE',
  );
  const upserts = uniqueMap(
    delta.upserts,
    'itemId',
    'TEXT_ITEM_UPSERT_ID_DUPLICATE',
  );
  const retirements = uniqueMap(
    delta.retirements.map((retirement) => {
      requiredText(retirement.itemId, 'TEXT_ITEM_RETIREMENT_ID_REQUIRED');
      requiredText(retirement.reason, 'TEXT_ITEM_RETIREMENT_REASON_REQUIRED');
      return retirement;
    }),
    'itemId',
    'TEXT_ITEM_RETIREMENT_ID_DUPLICATE',
  );
  const unchanged = new Set(
    uniqueStrings(
      delta.explicitlyUnchangedItemIds,
      'UNCHANGED_TEXT_ITEM_ID_DUPLICATE',
    ),
  );
  assertDisjoint(
    [upserts, retirements, unchanged],
    'ENGINEERING_MATTER_WORKING_TEXT_DELTA_OVERLAP',
  );
  for (const id of retirements.keys()) {
    if (!currentById.has(id))
      fail('ENGINEERING_MATTER_WORKING_TEXT_RETIREMENT_MISSING');
  }
  for (const id of unchanged) {
    if (!currentById.has(id))
      fail('ENGINEERING_MATTER_WORKING_UNCHANGED_TEXT_MISSING');
  }
  for (const id of currentById.keys()) {
    if (!upserts.has(id) && !retirements.has(id) && !unchanged.has(id)) {
      fail('ENGINEERING_MATTER_WORKING_TEXT_CARRY_FORWARD_INCOMPLETE');
    }
  }
  const result: EngineeringMatterWorkingTextItem[] = [];
  for (const item of current) {
    if (retirements.has(item.itemId)) continue;
    result.push(upserts.get(item.itemId) ?? item);
    upserts.delete(item.itemId);
  }
  result.push(...upserts.values());
  return {
    items: result,
    changed: canonicalJson(current) !== canonicalJson(result),
  };
}

function mergeCoverage(
  current: EngineeringMatterWorkingCoverage[],
  updates: EngineeringMatterWorkingCoverage[],
): EngineeringMatterWorkingCoverage[] {
  current.forEach(validateCoverage);
  updates.forEach(validateCoverage);
  const result = [...current];
  const positions = new Map(
    result.map((item: EngineeringMatterWorkingCoverage, index: number) => [
      item.binding.inputId,
      index,
    ]),
  );
  const seen = new Set<string>();
  for (const update of updates) {
    if (seen.has(update.binding.inputId)) {
      fail('ENGINEERING_MATTER_WORKING_COVERAGE_UPDATE_DUPLICATE');
    }
    seen.add(update.binding.inputId);
    const position = positions.get(update.binding.inputId);
    if (position === undefined) {
      positions.set(update.binding.inputId, result.length);
      result.push(update);
    } else {
      result[position] = update;
    }
  }
  return result;
}

export function engineeringMatterWorkingChangeFromCommand(
  command: EngineeringMatterWorkingRevisionCommand,
): EngineeringMatterWorkingRevisionChange {
  return {
    changedBecause: command.claimDelta?.changedBecause ?? null,
    addedClaimIds:
      command.claimDelta?.additions.map((claim) => claim.claimId) ?? [],
    replacedClaimIds:
      command.claimDelta?.replacements.map((claim) => claim.claimId) ?? [],
    retiredClaims: command.claimDelta?.retirements ?? [],
    explicitlyUnchangedClaimIds:
      command.claimDelta?.explicitlyUnchangedClaimIds ?? [],
    openQuestionDelta: command.openQuestionDelta,
    reviewConditionDelta: command.reviewConditionDelta,
    coverageUpdates: command.coverageUpdates,
  };
}

function validateCommandEnvelope(
  command: EngineeringMatterWorkingRevisionCommand,
): void {
  if (!isRecord(command)) {
    fail('ENGINEERING_MATTER_WORKING_COMMAND_INVALID');
  }
  requiredText(
    command.requestId,
    'ENGINEERING_MATTER_WORKING_REQUEST_ID_REQUIRED',
  );
  if (
    !Number.isSafeInteger(command.expectedWorkingRevision) ||
    command.expectedWorkingRevision < 0
  ) {
    fail('ENGINEERING_MATTER_WORKING_EXPECTED_REVISION_INVALID');
  }
  requiredText(
    command.basedOnMatterRevisionId,
    'ENGINEERING_MATTER_WORKING_MATTER_REVISION_REQUIRED',
  );
  if (
    command.updateKind !== 'INITIAL_SYNTHESIS' &&
    command.updateKind !== 'CORRECTION' &&
    command.updateKind !== 'MATERIAL_INCORPORATION'
  ) {
    fail('ENGINEERING_MATTER_WORKING_UPDATE_KIND_INVALID');
  }
  requiredText(
    command.changeSummary,
    'ENGINEERING_MATTER_WORKING_SUMMARY_REQUIRED',
  );
  if (command.nextFocus) validateFocus(command.nextFocus);
  validatedInputBindings(command.substantiveInputs);
  if (!Array.isArray(command.coverageUpdates)) {
    fail('ENGINEERING_MATTER_WORKING_COVERAGE_INVALID');
  }
}

function validateState(
  value: unknown,
  matterId: string,
): asserts value is EngineeringMatterWorkingState {
  if (!isRecord(value)) fail('ENGINEERING_MATTER_WORKING_STATE_INVALID');
  if (
    value.schemaVersion !== 'wiselink.3_1.engineering_matter_working_state.v1'
  ) {
    fail('ENGINEERING_MATTER_WORKING_STATE_VERSION_INVALID');
  }
  validateFocus(value.focus as EngineeringMatterWorkingFocus);
  if (value.substantiveResult !== null) {
    validateReadingResult(value.substantiveResult, matterId);
  }
  if (value.problemWork !== undefined)
    validateMatterProblemWork(
      value.problemWork as NonNullable<
        EngineeringMatterWorkingState['problemWork']
      >,
      matterId,
      value.substantiveResult as AssessmentReadingResult | null,
    );
  if (
    !Array.isArray(value.openQuestions) ||
    !Array.isArray(value.reviewConditions)
  ) {
    fail('ENGINEERING_MATTER_WORKING_TEXT_ITEMS_INVALID');
  }
  value.openQuestions.forEach(validateTextItem);
  value.reviewConditions.forEach(validateTextItem);
  uniqueMap(value.openQuestions, 'itemId', 'OPEN_QUESTION_ID_DUPLICATE');
  uniqueMap(value.reviewConditions, 'itemId', 'REVIEW_CONDITION_ID_DUPLICATE');
  validatedInputBindings(
    value.substantiveInputs as EngineeringMatterWorkingInputBinding[],
  );
  if (!Array.isArray(value.coverage))
    fail('ENGINEERING_MATTER_WORKING_COVERAGE_INVALID');
  value.coverage.forEach(validateCoverage);
  uniqueMap(
    value.coverage as EngineeringMatterWorkingCoverage[],
    (item) => item.binding.inputId,
    'COVERAGE_INPUT_ID_DUPLICATE',
  );
}

function validateReadingResult(
  value: unknown,
  matterId: string,
): asserts value is AssessmentReadingResult {
  if (!isRecord(value)) fail('ENGINEERING_MATTER_WORKING_RESULT_INVALID');
  requiredText(
    value.resultRef,
    'ENGINEERING_MATTER_WORKING_RESULT_REF_REQUIRED',
  );
  if (
    !Number.isSafeInteger(value.resultRevision) ||
    Number(value.resultRevision) < 1
  ) {
    fail('ENGINEERING_MATTER_WORKING_RESULT_REVISION_INVALID');
  }
  if (
    !isRecord(value.scope) ||
    value.scope.kind !== 'ENGINEERING_MATTER' ||
    value.scope.matterId !== matterId
  ) {
    fail('ENGINEERING_MATTER_WORKING_RESULT_SCOPE_INVALID');
  }
  if (value.candidateOnly !== true || !isRecord(value.content)) {
    fail('ENGINEERING_MATTER_WORKING_RESULT_INVALID');
  }
  if (value.content.schemaVersion !== 'wiselink.3_1.assessment_reading.v1') {
    fail('ENGINEERING_MATTER_WORKING_READING_VERSION_INVALID');
  }
  requiredText(
    value.content.headline,
    'ENGINEERING_MATTER_WORKING_HEADLINE_REQUIRED',
  );
  requiredText(
    value.content.listBrief,
    'ENGINEERING_MATTER_WORKING_LIST_BRIEF_REQUIRED',
  );
  requiredText(value.content.lead, 'ENGINEERING_MATTER_WORKING_LEAD_REQUIRED');
  if (
    !Array.isArray(value.content.claims) ||
    !Array.isArray(value.content.decisiveClaimIds)
  ) {
    fail('ENGINEERING_MATTER_WORKING_READING_CONTENT_INVALID');
  }
  value.content.claims.forEach(validateClaim);
  const claims = uniqueMap(
    value.content.claims as AssessmentReadingClaim[],
    'claimId',
    'CLAIM_ID_DUPLICATE',
  );
  for (const id of uniqueStrings(
    value.content.decisiveClaimIds,
    'DECISIVE_CLAIM_ID_DUPLICATE',
  )) {
    if (!claims.has(id))
      fail('ENGINEERING_MATTER_WORKING_DECISIVE_CLAIM_MISSING');
  }
  if (!Array.isArray(value.evidence))
    fail('ENGINEERING_MATTER_WORKING_EVIDENCE_INVALID');
  value.evidence.forEach(validateEvidence);
  const evidence = uniqueMap(
    value.evidence as AssessmentEvidence[],
    'evidenceRef',
    'EVIDENCE_REF_DUPLICATE',
  );
  for (const claim of claims.values()) {
    for (const premise of claim.premises) {
      if (!evidence.has(premise.evidenceRef)) {
        fail('ENGINEERING_MATTER_WORKING_PREMISE_EVIDENCE_MISSING');
      }
    }
  }
}

function validateClaim(
  value: unknown,
): asserts value is AssessmentReadingClaim {
  if (!isRecord(value)) fail('ENGINEERING_MATTER_WORKING_CLAIM_INVALID');
  requiredText(value.claimId, 'ENGINEERING_MATTER_WORKING_CLAIM_ID_REQUIRED');
  requiredText(value.text, 'ENGINEERING_MATTER_WORKING_CLAIM_TEXT_REQUIRED');
  if (
    value.basis !== 'SOURCE_FACT' &&
    value.basis !== 'CONDITIONAL_INFERENCE'
  ) {
    fail('ENGINEERING_MATTER_WORKING_CLAIM_BASIS_INVALID');
  }
  if (!Array.isArray(value.premises))
    fail('ENGINEERING_MATTER_WORKING_PREMISES_INVALID');
  if (value.premises.length === 0) {
    fail('ENGINEERING_MATTER_WORKING_PREMISES_REQUIRED');
  }
  for (const premise of value.premises) {
    if (!isRecord(premise)) fail('ENGINEERING_MATTER_WORKING_PREMISE_INVALID');
    requiredText(
      premise.evidenceRef,
      'ENGINEERING_MATTER_WORKING_EVIDENCE_REF_REQUIRED',
    );
    if (
      !['SUPPORTS', 'LIMITS', 'CONTEXT', 'CONFLICTS'].includes(
        String(premise.role),
      )
    ) {
      fail('ENGINEERING_MATTER_WORKING_PREMISE_ROLE_INVALID');
    }
    requiredText(
      premise.explanation,
      'ENGINEERING_MATTER_WORKING_PREMISE_EXPLANATION_REQUIRED',
    );
    if (premise.limitation !== null && typeof premise.limitation !== 'string') {
      fail('ENGINEERING_MATTER_WORKING_PREMISE_LIMITATION_INVALID');
    }
  }
}

function validateEvidence(value: unknown): asserts value is AssessmentEvidence {
  if (!isRecord(value)) fail('ENGINEERING_MATTER_WORKING_EVIDENCE_INVALID');
  requiredText(
    value.evidenceRef,
    'ENGINEERING_MATTER_WORKING_EVIDENCE_REF_REQUIRED',
  );
  requiredText(
    value.title,
    'ENGINEERING_MATTER_WORKING_EVIDENCE_TITLE_REQUIRED',
  );
  if (value.versionLabel !== null && typeof value.versionLabel !== 'string') {
    fail('ENGINEERING_MATTER_WORKING_EVIDENCE_VERSION_INVALID');
  }
  requiredText(
    value.excerpt,
    'ENGINEERING_MATTER_WORKING_EVIDENCE_EXCERPT_REQUIRED',
  );
  switch (value.kind) {
    case 'DOCUMENT_PASSAGE':
      if (value.workItemId !== null)
        requiredText(
          value.workItemId,
          'ENGINEERING_MATTER_WORKING_EVIDENCE_WORK_ITEM_REQUIRED',
        );
      requiredText(
        value.documentVersionId,
        'ENGINEERING_MATTER_WORKING_EVIDENCE_DOCUMENT_VERSION_REQUIRED',
      );
      requiredText(
        value.sourceRefId,
        'ENGINEERING_MATTER_WORKING_EVIDENCE_SOURCE_REF_REQUIRED',
      );
      requiredText(
        value.locator,
        'ENGINEERING_MATTER_WORKING_EVIDENCE_LOCATOR_REQUIRED',
      );
      break;
    case 'ENGINEER_STATEMENT':
      if (value.origin === 'REVIEW_CONVERSATION') {
        requiredText(
          value.reviewConversationId,
          'ENGINEERING_MATTER_WORKING_EVIDENCE_CONVERSATION_REQUIRED',
        );
        requiredText(
          value.reviewTurnId,
          'ENGINEERING_MATTER_WORKING_EVIDENCE_TURN_REQUIRED',
        );
        requiredText(
          value.engineerSuppliedInputId,
          'ENGINEERING_MATTER_WORKING_EVIDENCE_INPUT_REQUIRED',
        );
      } else if (value.origin === 'ENGINEER_REVIEW_LEDGER') {
        requiredText(
          value.workItemId,
          'ENGINEERING_MATTER_WORKING_EVIDENCE_WORK_ITEM_REQUIRED',
        );
        if (
          !Number.isSafeInteger(value.reviewRevision) ||
          Number(value.reviewRevision) < 1 ||
          !Number.isSafeInteger(value.sequence) ||
          Number(value.sequence) < 1
        ) {
          fail('ENGINEERING_MATTER_WORKING_EVIDENCE_LEDGER_REVISION_INVALID');
        }
        requiredText(
          value.sourceRefId,
          'ENGINEERING_MATTER_WORKING_EVIDENCE_SOURCE_REF_REQUIRED',
        );
        requiredText(
          value.locator,
          'ENGINEERING_MATTER_WORKING_EVIDENCE_LOCATOR_REQUIRED',
        );
      } else {
        fail('ENGINEERING_MATTER_WORKING_EVIDENCE_ORIGIN_INVALID');
      }
      requiredText(
        value.recordedAt,
        'ENGINEERING_MATTER_WORKING_EVIDENCE_RECORDED_AT_REQUIRED',
      );
      break;
    case 'HOST_FACT':
      requiredText(
        value.workItemId,
        'ENGINEERING_MATTER_WORKING_EVIDENCE_WORK_ITEM_REQUIRED',
      );
      if (
        !Number.isSafeInteger(value.workItemRevision) ||
        Number(value.workItemRevision) < 0
      ) {
        fail('ENGINEERING_MATTER_WORKING_EVIDENCE_WORK_ITEM_REVISION_INVALID');
      }
      requiredText(
        value.factRef,
        'ENGINEERING_MATTER_WORKING_EVIDENCE_FACT_REF_REQUIRED',
      );
      requiredText(
        value.recordedAt,
        'ENGINEERING_MATTER_WORKING_EVIDENCE_RECORDED_AT_REQUIRED',
      );
      break;
    case 'QUERY_RECEIPT':
      requiredText(
        value.receiptRef,
        'ENGINEERING_MATTER_WORKING_EVIDENCE_RECEIPT_REQUIRED',
      );
      requiredText(
        value.checkedScope,
        'ENGINEERING_MATTER_WORKING_EVIDENCE_CHECKED_SCOPE_REQUIRED',
      );
      requiredText(
        value.queriedAt,
        'ENGINEERING_MATTER_WORKING_EVIDENCE_QUERIED_AT_REQUIRED',
      );
      if (value.coverage !== 'COMPLETE' && value.coverage !== 'PARTIAL') {
        fail('ENGINEERING_MATTER_WORKING_EVIDENCE_COVERAGE_INVALID');
      }
      break;
    case 'METHOD_CLAUSE':
      requiredText(value.packRef, 'ENGINEERING_MATTER_WORKING_EVIDENCE_METHOD_PACK_REQUIRED');
      requiredText(value.methodRef, 'ENGINEERING_MATTER_WORKING_EVIDENCE_METHOD_REF_REQUIRED');
      requiredText(value.sourceIdentity, 'ENGINEERING_MATTER_WORKING_EVIDENCE_SOURCE_IDENTITY_REQUIRED');
      requiredText(value.locator, 'ENGINEERING_MATTER_WORKING_EVIDENCE_LOCATOR_REQUIRED');
      if (value.sourceVersionStatus !== 'CONFIRMED' && value.sourceVersionStatus !== 'VERSION_UNCONFIRMED') {
        fail('ENGINEERING_MATTER_WORKING_EVIDENCE_METHOD_VERSION_INVALID');
      }
      break;
    case 'PRIOR_RESULT':
      requiredText(
        value.resultRef,
        'ENGINEERING_MATTER_WORKING_EVIDENCE_RESULT_REF_REQUIRED',
      );
      if (
        !Number.isSafeInteger(value.resultRevision) ||
        Number(value.resultRevision) < 1
      ) {
        fail('ENGINEERING_MATTER_WORKING_EVIDENCE_RESULT_REVISION_INVALID');
      }
      uniqueStrings(
        value.originalEvidenceRefs,
        'ORIGINAL_EVIDENCE_REF_DUPLICATE',
      );
      break;
    default:
      fail('ENGINEERING_MATTER_WORKING_EVIDENCE_KIND_INVALID');
  }
}

function validateFocus(
  value: EngineeringMatterWorkingFocus,
): EngineeringMatterWorkingFocus {
  if (!isRecord(value)) fail('ENGINEERING_MATTER_WORKING_FOCUS_INVALID');
  requiredText(value.question, 'ENGINEERING_MATTER_WORKING_QUESTION_REQUIRED');
  uniqueStrings(
    value.targetRefs,
    'ENGINEERING_MATTER_WORKING_TARGET_REF_DUPLICATE',
  );
  return value;
}

function validateTextItem(
  value: unknown,
): asserts value is EngineeringMatterWorkingTextItem {
  if (!isRecord(value)) fail('ENGINEERING_MATTER_WORKING_TEXT_ITEM_INVALID');
  if (value.when !== undefined) validateMatterRevisitWhen(value.when);
  requiredText(
    value.itemId,
    'ENGINEERING_MATTER_WORKING_TEXT_ITEM_ID_REQUIRED',
  );
  requiredText(
    value.text,
    'ENGINEERING_MATTER_WORKING_TEXT_ITEM_TEXT_REQUIRED',
  );
  uniqueStrings(
    value.basisRefs,
    'ENGINEERING_MATTER_WORKING_BASIS_REF_DUPLICATE',
  );
}

function validateCoverage(
  value: unknown,
): asserts value is EngineeringMatterWorkingCoverage {
  if (!isRecord(value)) fail('ENGINEERING_MATTER_WORKING_COVERAGE_INVALID');
  validateBinding(value.binding as EngineeringMatterWorkingInputBinding);
  if (
    value.contribution !== 'SUBSTANTIVE' &&
    value.contribution !== 'NO_MATERIAL_CHANGE' &&
    value.contribution !== 'READ_ONLY'
  ) {
    fail('ENGINEERING_MATTER_WORKING_CONTRIBUTION_INVALID');
  }
  const checkedSourceRefIds = uniqueStrings(
    value.checkedSourceRefIds,
    'ENGINEERING_MATTER_WORKING_CHECKED_SOURCE_REF_DUPLICATE',
  );
  if (checkedSourceRefIds.length === 0) {
    fail('ENGINEERING_MATTER_WORKING_CHECKED_SOURCE_REFS_REQUIRED');
  }
  requiredText(
    value.checkedScope,
    'ENGINEERING_MATTER_WORKING_CHECKED_SCOPE_REQUIRED',
  );
  requiredText(
    value.reason,
    'ENGINEERING_MATTER_WORKING_COVERAGE_REASON_REQUIRED',
  );
}

function validatedInputBindings(
  value: EngineeringMatterWorkingInputBinding[],
): EngineeringMatterWorkingInputBinding[] {
  if (!Array.isArray(value)) fail('ENGINEERING_MATTER_WORKING_INPUTS_INVALID');
  value.forEach(validateBinding);
  uniqueMap(value, 'inputId', 'ENGINEERING_MATTER_WORKING_INPUT_ID_DUPLICATE');
  uniqueMap(
    value.filter((item) => item.workItemId !== null),
    'workItemId',
    'ENGINEERING_MATTER_WORKING_INPUT_WORK_ITEM_DUPLICATE',
  );
  return value;
}

function validateBinding(
  value: unknown,
): asserts value is EngineeringMatterWorkingInputBinding {
  if (!isRecord(value)) fail('ENGINEERING_MATTER_WORKING_INPUT_INVALID');
  requiredText(value.inputId, 'ENGINEERING_MATTER_WORKING_INPUT_ID_REQUIRED');
  if (value.original !== undefined && (!isRecord(value.original) ||
      typeof value.original.parseRunId !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(value.original.parseRunId) ||
      !Number.isSafeInteger(value.original.parseRevision) || Number(value.original.parseRevision) < 1 ||
      Object.keys(value.original).some(key => !['parseRunId','parseRevision','semantic'].includes(key))))
    fail('ENGINEERING_MATTER_ORIGINAL_BINDING_INVALID');
  if (isRecord(value.original) && value.original.semantic !== undefined && value.original.semantic !== null) {
    const semantic = value.original.semantic;
    if (!isRecord(semantic) || !Number.isSafeInteger(semantic.revision) || Number(semantic.revision) < 1 ||
      typeof semantic.profileRef !== 'string' || !semantic.profileRef.trim() || semantic.profileRef.length > 160 ||
      Object.keys(semantic).some(key => !['revision','profileRef'].includes(key)))
      fail('ENGINEERING_MATTER_SEMANTIC_BINDING_INVALID');
  }
  if (value.kind === 'DOCUMENT_VERSION') {
    requiredText(value.familyId, 'ENGINEERING_MATTER_WORKING_FAMILY_REQUIRED');
    requiredText(
      value.documentVersionId,
      'ENGINEERING_MATTER_WORKING_DOCUMENT_VERSION_REQUIRED',
    );
    if (
      value.workItemId !== null ||
      value.workItemRevision !== null ||
      value.resultRef !== null ||
      value.resultRevision !== null
    )
      fail('ENGINEERING_MATTER_WORKING_DIRECT_INPUT_INVALID');
    return;
  }
  requiredText(
    value.workItemId,
    'ENGINEERING_MATTER_WORKING_WORK_ITEM_ID_REQUIRED',
  );
  if (
    !Number.isSafeInteger(value.workItemRevision) ||
    Number(value.workItemRevision) < 0
  ) {
    fail('ENGINEERING_MATTER_WORKING_WORK_ITEM_REVISION_INVALID');
  }
  requiredText(
    value.documentVersionId,
    'ENGINEERING_MATTER_WORKING_DOCUMENT_VERSION_REQUIRED',
  );
  if ((value.resultRef === null) !== (value.resultRevision === null)) {
    fail('ENGINEERING_MATTER_WORKING_RESULT_BINDING_INVALID');
  }
  if (value.resultRef !== null) {
    requiredText(
      value.resultRef,
      'ENGINEERING_MATTER_WORKING_RESULT_REF_REQUIRED',
    );
    if (
      !Number.isSafeInteger(value.resultRevision) ||
      Number(value.resultRevision) < 1
    ) {
      fail('ENGINEERING_MATTER_WORKING_RESULT_REVISION_INVALID');
    }
  }
}

function uniqueStrings(value: unknown, code: string): string[] {
  if (!Array.isArray(value)) fail(code);
  const strings = value.map((item: unknown) => {
    requiredText(item, code);
    return item as string;
  });
  if (new Set(strings).size !== strings.length) fail(code);
  return strings;
}

function uniqueMap<T extends object>(
  values: T[],
  key: keyof T | ((value: T) => string),
  code: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = typeof key === 'function' ? key(value) : String(value[key]);
    if (result.has(id)) fail(code);
    result.set(id, value);
  }
  return result;
}

function assertDisjoint(
  sets: Array<Map<string, unknown> | Set<string>>,
  code: string,
): void {
  const seen = new Set<string>();
  for (const set of sets) {
    for (const id of set.keys()) {
      if (seen.has(id)) fail(code);
      seen.add(id);
    }
  }
}

function requiredText(value: unknown, code: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') fail(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(code: string): never {
  throw Object.assign(new Error(code), { code, statusCode: 409 });
}
