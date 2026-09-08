import type {
  AppendMatterReviewScope,
  ReviewScopeSelection,
} from '@shared/api.interface';
import type { EngineeringMatterWorkingInputBinding } from '@shared/matter-working.interface';

/** Immutable Host-resolved business basis, independent of the transport WorkItem. */
export interface PersistedMatterReviewScope {
  schemaVersion: 'wiselink.3_1.matter_review_scope.v1';
  kind: 'ENGINEERING_MATTER';
  matterId: string;
  basedOnMatterRevisionId: string;
  expectedWorkingRevision: number;
  targetClaimId: string | null;
  inputs: EngineeringMatterWorkingInputBinding[];
}

export function reviewScopeSelection(
  scope: PersistedMatterReviewScope | null | undefined,
): ReviewScopeSelection {
  return scope
    ? { kind: 'ENGINEERING_MATTER', matterId: scope.matterId }
    : { kind: 'WORK_ITEM' };
}

export function sameReviewBusinessScope(
  scope: PersistedMatterReviewScope | null | undefined,
  selected: ReviewScopeSelection | null | undefined,
): boolean {
  return selected?.kind === 'ENGINEERING_MATTER'
    ? scope?.kind === 'ENGINEERING_MATTER' &&
        scope.matterId === selected.matterId
    : scope == null;
}

export function assertReviewScopeReplay(
  scope: PersistedMatterReviewScope | null | undefined,
  requested: AppendMatterReviewScope | undefined,
): void {
  if (
    !sameReviewBusinessScope(scope, requested) ||
    (scope &&
      (scope.expectedWorkingRevision !== requested?.expectedWorkingRevision ||
        scope.targetClaimId !== (requested?.targetClaimId ?? null)))
  ) {
    throw scopeError('REVIEW_TURN_IDEMPOTENCY_CONFLICT');
  }
}

export function parsePersistedMatterReviewScope(
  value: unknown,
): PersistedMatterReviewScope | null {
  if (value === null || value === undefined) return null;
  const item = object(value);
  if (
    item.schemaVersion !== 'wiselink.3_1.matter_review_scope.v1' ||
    item.kind !== 'ENGINEERING_MATTER' ||
    !Array.isArray(item.inputs) ||
    item.inputs.length === 0
  )
    throw scopeError();
  const inputs = item.inputs.map(
    (value): EngineeringMatterWorkingInputBinding => {
      const binding = object(value);
      const resultRef =
        binding.resultRef === null ? null : text(binding.resultRef);
      const resultRevision =
        binding.resultRevision === null
          ? null
          : revision(binding.resultRevision);
      if ((resultRef === null) !== (resultRevision === null))
        throw scopeError();
      return {
        inputId: text(binding.inputId),
        workItemId: text(binding.workItemId),
        workItemRevision: revision(binding.workItemRevision),
        documentVersionId: text(binding.documentVersionId),
        resultRef,
        resultRevision,
      };
    },
  );
  if (
    new Set(inputs.map((input) => input.inputId)).size !== inputs.length ||
    new Set(inputs.map((input) => input.workItemId)).size !== inputs.length
  )
    throw scopeError();
  return {
    schemaVersion: 'wiselink.3_1.matter_review_scope.v1',
    kind: 'ENGINEERING_MATTER',
    matterId: text(item.matterId),
    basedOnMatterRevisionId: text(item.basedOnMatterRevisionId),
    expectedWorkingRevision: revision(item.expectedWorkingRevision),
    targetClaimId:
      item.targetClaimId === null ? null : text(item.targetClaimId),
    inputs,
  };
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw scopeError();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value)
    throw scopeError();
  return value;
}

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw scopeError();
  return Number(value);
}

function scopeError(code = 'REVIEW_MATTER_SCOPE_INVALID') {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}
