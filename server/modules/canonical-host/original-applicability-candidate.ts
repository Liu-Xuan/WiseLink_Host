import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { z } from 'zod/v4';
import type {
  ApplicabilityCandidateContract,
  ApplicabilityTaskContract,
  ApplicabilityTaskSourceExpression,
} from './canonical-host-openclaw-applicability.contract';
import type { BlockingUnknown } from '../assessment-workbench/applicability-fleet/applicabilityKleeneEngine';

const id = z.string().min(1).max(200);
export const originalConditionSchema = z.strictObject({
  quote: z.strictObject({ unitId: id, text: z.string().min(1).max(20000) }),
  scope: z.strictObject({
    kind: z.enum(['document', 'unit', 'unresolved']),
    headingUnitId: id.nullable(),
    targetUnitIds: z.array(id).max(200),
  }),
});
export const originalDispositionSchema = z.strictObject({
  unitId: id,
  disposition: z.enum(['CONDITIONS', 'NO_CONDITION', 'UNRESOLVED']),
  conditionIds: z.array(id).max(200),
});
export type OriginalConditionEvidence = z.infer<typeof originalConditionSchema>;
export type OriginalUnitDisposition = z.infer<typeof originalDispositionSchema>;
export const originalBindingSchema = z.strictObject({
  documentVersionId: id,
  parseRunId: id,
  parseRevision: z.number().int().positive(),
  sourceArtifactId: id,
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  sourceByteLength: z.number().int().positive(),
});

/** These are source payload text leaves, not JSON keys, IDs, or a generated summary. */
function sourceText(value: unknown): string {
  if (Array.isArray(value))
    return value.map(sourceText).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value)
    .flatMap(([key, item]) =>
      typeof item === 'string'
        ? ['text', 'caption'].includes(key)
          ? [item]
          : []
        : [sourceText(item)],
    )
    .filter(Boolean)
    .join('\n');
}
const normalized = (text: string) => text.replace(/\s+/gu, ' ').trim();
const effectivityHeading = (text: string) =>
  /^(?:(?:\d+(?:\.\d+)*|[A-Z])[.)]?\s+)?(?:effectivity|applicability)$/iu.test(
    normalized(text),
  );

/** Resolve model-proposed scope only through verified physical source structure.
 * A condition ID is local candidate identity; source/target IDs always pre-exist. */
export function bindOriginalApplicabilityCandidate(
  candidate: ApplicabilityCandidateContract,
  task: ApplicabilityTaskContract,
) {
  const original = task.originalInput;
  if (
    !original ||
    !candidate.originalBinding ||
    canonicalJson(candidate.originalBinding) !== canonicalJson(original.binding)
  )
    throw new Error('APPLICABILITY_ORIGINAL_CANDIDATE_BINDING_MISMATCH');
  const units = original.source.units;
  const byId = new Map(
    units.map((unit, index) => [unit.unitId, { unit, index }]),
  );
  if (byId.size !== units.length)
    throw new Error('APPLICABILITY_ORIGINAL_CATALOG_NOT_UNIQUE');
  const expressions = new Map(
    candidate.expressions.map((expression) => [
      expression.expressionId,
      expression,
    ]),
  );
  if (expressions.size !== candidate.expressions.length)
    throw new Error('APPLICABILITY_ORIGINAL_CONDITION_NOT_UNIQUE');
  const unknowns: BlockingUnknown[] = [];
  const unknown = (reason: string, fragmentId: string | null = null) =>
    unknowns.push({
      kind: 'original_scope_unknown',
      reason,
      fragmentId,
      strategy: 'READ_ORIGINAL_SOURCE',
    });
  const dispositions = candidate.unitDispositions ?? [];
  if (
    dispositions.length !== units.length ||
    new Set(dispositions.map((item) => item.unitId)).size !== units.length
  )
    throw new Error('APPLICABILITY_ORIGINAL_DISPOSITION_COVERAGE_INVALID');
  const accounted = new Set<string>();
  for (const item of dispositions) {
    if (
      !byId.has(item.unitId) ||
      new Set(item.conditionIds).size !== item.conditionIds.length ||
      (item.disposition === 'CONDITIONS') !== item.conditionIds.length > 0
    )
      throw new Error('APPLICABILITY_ORIGINAL_DISPOSITION_INVALID');
    if (item.disposition === 'UNRESOLVED')
      unknown('UNRESOLVED_SOURCE_UNIT', item.unitId);
    for (const conditionId of item.conditionIds) {
      const expression = expressions.get(conditionId);
      if (
        !expression ||
        expression.original?.quote.unitId !== item.unitId ||
        accounted.has(conditionId)
      )
        throw new Error('APPLICABILITY_ORIGINAL_DISPOSITION_BINDING_INVALID');
      accounted.add(conditionId);
    }
  }
  if (accounted.size !== expressions.size)
    throw new Error('APPLICABILITY_ORIGINAL_CONDITION_OMITTED');
  const bindings = new Map<string, ApplicabilityTaskSourceExpression>();
  const targetBindings = new Map<string, ApplicabilityTaskSourceExpression[]>();
  for (const expression of candidate.expressions) {
    const evidence = expression.original;
    const quoted = evidence && byId.get(evidence.quote.unitId);
    if (
      !evidence ||
      !quoted ||
      !normalized(evidence.quote.text) ||
      !normalized(sourceText(quoted.unit.payload)).includes(
        normalized(evidence.quote.text),
      ) ||
      JSON.stringify(expression.sourceRefIds) !==
        JSON.stringify(quoted.unit.sourceRefIds)
    )
      throw new Error('APPLICABILITY_ORIGINAL_QUOTE_BINDING_INVALID');
    const scope = evidence.scope;
    if (
      scope.targetUnitIds.some((target) => !byId.has(target)) ||
      new Set(scope.targetUnitIds).size !== scope.targetUnitIds.length
    )
      throw new Error('APPLICABILITY_ORIGINAL_TARGET_NOT_FOUND');
    if (scope.kind === 'unresolved') {
      unknown('UNRESOLVED_SCOPE', expression.expressionId);
      continue;
    }
    const heading = scope.headingUnitId ? byId.get(scope.headingUnitId) : null;
    // A heading covers only its actual following section, ending at the next
    // heading of the same or higher level. Flat physical order is not a claim
    // that an arbitrary later paragraph inherits a condition.
    let sectionEnd = quoted.index + 1;
    let sectionValid = false;
    if (heading?.unit.kind === 'heading' && heading.index <= quoted.index) {
      const level = Number(heading.unit.payload.level);
      if (Number.isInteger(level) && level >= 1 && level <= 6) {
        sectionEnd = units.findIndex(
          (unit, index) =>
            index > heading.index &&
            unit.kind === 'heading' &&
            Number(unit.payload.level) <= level,
        );
        if (sectionEnd < 0) sectionEnd = units.length;
        sectionValid = quoted.index < sectionEnd;
      }
    }
    if (scope.kind === 'document') {
      // An explicit document-effectivity heading at the top structural level
      // grounds document scope. A component/subsection or an unstructured title
      // does not silently become whole-document effectivity.
      const headingLevels = units
        .filter((unit) => unit.kind === 'heading')
        .map((unit) => Number(unit.payload.level))
        .filter(Number.isInteger);
      if (
        !sectionValid ||
        !heading ||
        !effectivityHeading(sourceText(heading.unit.payload)) ||
        Number(heading.unit.payload.level) !== Math.min(...headingLevels) ||
        scope.targetUnitIds.length
      ) {
        unknown('UNRESOLVED_DOCUMENT_SCOPE', expression.expressionId);
        continue;
      }
    } else {
      const self =
        scope.targetUnitIds.length === 1 &&
        scope.targetUnitIds[0] === quoted.unit.unitId;
      if (
        !self &&
        (!sectionValid ||
          !heading ||
          !scope.targetUnitIds.length ||
          scope.targetUnitIds.some(
            (target) =>
              byId.get(target)!.index <= heading.index ||
              byId.get(target)!.index >= sectionEnd,
          ))
      ) {
        unknown('UNRESOLVED_INLINE_SCOPE', expression.expressionId);
        continue;
      }
    }
    const resolvedTargets: Array<string | null> =
      scope.kind === 'document' ? [null] : scope.targetUnitIds;
    const resolved = resolvedTargets.map((target) => ({
      expressionId: expression.expressionId,
      text: evidence.quote.text,
      sourceRefIds: [...expression.sourceRefIds],
      assignmentId: expression.expressionId,
      targetKind:
        scope.kind === 'document'
          ? ('module' as const)
          : ('content_unit' as const),
      targetId: target,
      targetSourceRefIds:
        target === null ? [] : [...byId.get(target)!.unit.sourceRefIds],
      applicabilityLevel:
        scope.kind === 'document'
          ? ('document_effectivity' as const)
          : ('inline' as const),
      contentRef: target,
    }));
    bindings.set(expression.expressionId, resolved[0]);
    targetBindings.set(expression.expressionId, resolved);
  }
  if (
    ![...bindings.values()].some(
      (binding) => binding.applicabilityLevel === 'document_effectivity',
    )
  )
    unknown('MISSING_DOCUMENT_EFFECTIVITY');
  if (
    original.coverage.unresolvedRanges.some(
      (range) => range.reason === 'UNREAD',
    )
  )
    unknown('UNREAD_SOURCE_RANGE');
  return { bindings, targetBindings, unknowns };
}
