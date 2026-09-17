import { z } from 'zod/v4';
import { DOCUMENT_READING_SCHEMA, type DocumentReadingDelivery,
  type DocumentReadingRevision } from '@shared/document-reading.interface';
import type { TranslationSourceAnchorV2 } from '@shared/canonical-translation-v2.interface';

const text = z.string().refine(value => value.trim().length > 0);
const quote = z.strictObject({ anchorId: text, start: z.number().int().nonnegative(),
  end: z.number().int().positive(), text });
const statement = z.strictObject({ text, quotes: z.array(quote).min(1) });
const proposal = z.strictObject({
  schemaVersion: z.literal(DOCUMENT_READING_SCHEMA), headline: text,
  brief: statement, explanation: z.array(statement).min(1),
  criticalConditions: z.array(statement), limitations: z.array(text),
});

export interface DocumentReadingValidationContext {
  sourceBinding: DocumentReadingRevision['sourceBinding'];
  /** Complete unit inventory from the exact immutable original, including unassigned units. */
  sourceUnitIds: string[];
  sourceCoverage: DocumentReadingRevision['readCoverage']['sourceCoverage'];
  delivered: DocumentReadingDelivery[];
  deliveredAnchors: TranslationSourceAnchorV2[];
}

/** Structural/source verification, not a claim that the interpretation is semantically correct. */
export function validateDocumentReading(raw: unknown, context: DocumentReadingValidationContext) {
  const parsed = proposal.safeParse(raw);
  if (!parsed.success) fail('SHAPE_INVALID');
  if (!Number.isSafeInteger(context.sourceBinding.semanticRevision) || context.sourceBinding.semanticRevision < 1)
    fail('SOURCE_BINDING_INVALID');
  const units = new Set(context.sourceUnitIds);
  if (!units.size || units.size !== context.sourceUnitIds.length || context.sourceUnitIds.some(id => !id.trim()))
    fail('SOURCE_UNITS_INVALID');
  const anchors = new Map(context.deliveredAnchors.map(anchor => [anchor.anchorId, anchor]));
  if (anchors.size !== context.deliveredAnchors.length) fail('ANCHOR_DUPLICATE');
  const deliveredUnits = new Set<string>();
  const deliveredAnchors = new Set<string>();
  const offsets = new Set<number>();
  for (const range of context.delivered) {
    if (!Number.isSafeInteger(range.offset) || range.offset < 0 || offsets.has(range.offset) ||
        !range.unitIds.length || new Set(range.unitIds).size !== range.unitIds.length ||
        (range.nextOffset !== null && (!Number.isSafeInteger(range.nextOffset) || range.nextOffset <= range.offset)))
      fail('DELIVERY_INVALID');
    offsets.add(range.offset);
    if (range.unitIds.some((id, index) => context.sourceUnitIds[range.offset + index] !== id) ||
        (range.nextOffset === null ? range.offset + range.unitIds.length !== units.size
          : range.nextOffset !== range.offset + range.unitIds.length)) fail('DELIVERY_INVALID');
    for (const id of range.unitIds) deliveredUnits.add(id);
    for (const id of range.anchorIds) {
      const anchor = anchors.get(id);
      if (!anchor || !range.unitIds.includes(anchor.sourceUnitId)) fail('DELIVERY_ANCHOR_INVALID');
      deliveredAnchors.add(id);
    }
  }
  if (!deliveredUnits.size || context.deliveredAnchors.some(anchor => !deliveredAnchors.has(anchor.anchorId) ||
      !anchor.sourceRefIds.length || anchor.sourceRefIds.some(ref => !anchor.sourceLocators.some(locator => locator.sourceRefId === ref))))
    fail('DELIVERY_ANCHOR_INVALID');
  const cited = new Set<string>();
  for (const item of [parsed.data.brief, ...parsed.data.explanation, ...parsed.data.criticalConditions]) {
    for (const reference of item.quotes) {
      const anchor = anchors.get(reference.anchorId);
      if (!anchor || !deliveredAnchors.has(reference.anchorId)) fail('QUOTE_NOT_DELIVERED');
      if (!Number.isSafeInteger(reference.start) || !Number.isSafeInteger(reference.end) ||
          reference.end <= reference.start || reference.end > anchor.sourceText.length ||
          anchor.sourceText.slice(reference.start, reference.end) !== reference.text) fail('QUOTE_MISMATCH');
      cited.add(reference.anchorId);
    }
  }
  return {
    ...structuredClone(parsed.data), candidateOnly: true as const,
    sourceBinding: structuredClone(context.sourceBinding),
    readCoverage: {
      status: deliveredUnits.size === units.size ? 'COMPLETE_DELIVERY' as const : 'PARTIAL_DELIVERY' as const,
      deliveredUnitIds: context.sourceUnitIds.filter(id => deliveredUnits.has(id)),
      totalUnitCount: units.size, sourceCoverage: structuredClone(context.sourceCoverage),
    },
    sourceAnchors: context.deliveredAnchors.filter(anchor => cited.has(anchor.anchorId)).map(anchor => structuredClone(anchor)),
  };
}

export function materializeDocumentReading(candidate: ReturnType<typeof validateDocumentReading>, host: {
  readingRunRef: string; readingRevision: number;
  producer: DocumentReadingRevision['producer']; savedAt: string;
}): DocumentReadingRevision {
  if (!host.readingRunRef.trim() || !Number.isSafeInteger(host.readingRevision) || host.readingRevision < 1 ||
      !host.producer.skillVersion.trim() || !host.producer.modelVersion.trim() || !Number.isFinite(Date.parse(host.savedAt)))
    fail('HOST_IDENTITY_INVALID');
  return { ...structuredClone(candidate), ...structuredClone(host) };
}

function fail(code: string): never { throw new Error(`DOCUMENT_READING_${code}`); }
