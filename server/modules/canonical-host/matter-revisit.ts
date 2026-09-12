import { z } from 'zod/v4';
import type { EngineeringMatterWorkingInputBinding, EngineeringMatterWorkingTextItem, EngineeringMatterOriginalInputBinding } from '@shared/matter-working.interface';

export const matterRevisitWhen = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('DUE_AT'), at: z.string().datetime({ offset: true }) }),
  z.strictObject({ kind: z.literal('ORIGINAL_CHANGED'), inputId: z.string().trim().min(1),
    afterParseRunId: z.string().regex(/^[A-Za-z0-9_-]{1,96}$/).nullable() }),
]);

export function validateMatterRevisitWhen(value: unknown): void {
  if (!matterRevisitWhen.safeParse(value).success) throw new Error('MATTER_REVISIT_WHEN_INVALID');
}

export const matterReviewConditionDelta = z.strictObject({
  upserts: z.array(z.strictObject({ itemId: z.string().trim().min(1), text: z.string().trim().min(1),
    basisRefs: z.array(z.string().trim().min(1)), when: matterRevisitWhen.optional() })),
  retirements: z.array(z.strictObject({ itemId: z.string().trim().min(1), reason: z.string().trim().min(1) })),
  explicitlyUnchangedItemIds: z.array(z.string().trim().min(1)),
});

/** Occurrences depend only on explicit saved conditions and Host-observed state. */
export function dueMatterRevisits(conditions: EngineeringMatterWorkingTextItem[], inputs: EngineeringMatterWorkingInputBinding[], now: Date) {
  return [...conditions].sort((a,b) => a.itemId.localeCompare(b.itemId)).flatMap<{
    conditionId: string; when: NonNullable<EngineeringMatterWorkingTextItem['when']>; observedOriginal: EngineeringMatterOriginalInputBinding | null;
  }>(condition => {
    const when = condition.when;
    if (!when) return [];
    validateMatterRevisitWhen(when);
    if (when.kind === 'DUE_AT') return Date.parse(when.at) <= now.getTime()
      ? [{ conditionId: condition.itemId, when: { kind: 'DUE_AT', at: new Date(when.at).toISOString() }, observedOriginal: null }] : [];
    const binding = inputs.find(input => input.inputId === when.inputId);
    if (!binding?.original || binding.original.parseRunId === when.afterParseRunId) return [];
    return [{ conditionId: condition.itemId, when, observedOriginal: binding.original }];
  });
}
