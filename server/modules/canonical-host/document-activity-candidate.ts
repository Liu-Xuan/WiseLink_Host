import { z } from 'zod/v4';
import {
  DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,
  type DocumentActivityDeliveryRange,
  type DocumentActivityRevision,
  type DocumentActivitySelection,
  type DocumentActivitySourceBinding,
  type ValidatedDocumentActivityCandidate,
} from '@shared/document-activity.interface';
import type { DocumentOriginalCoverage } from '@shared/document-original.interface';
import type { TranslationSourceAnchorV2 } from '@shared/canonical-translation-v2.interface';

const nonempty = z.string().refine(value => value.trim().length > 0);
const proposalSchema = z.strictObject({
  schemaVersion: z.literal(DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA),
  statements: z.array(z.strictObject({
    statementKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u),
    label: nonempty,
    quotes: z.array(z.strictObject({ anchorId: nonempty, start: z.number().int().nonnegative(),
      end: z.number().int().positive(), text: nonempty })).min(1),
    time: z.strictObject({
      role: z.enum(['TARGET', 'OCCURRED', 'SOURCE_PUBLICATION', 'EFFECTIVE', 'CONDITION', 'UNKNOWN']),
      precision: z.enum(['YEAR', 'QUARTER', 'MONTH', 'DAY', 'UNKNOWN']),
      expression: z.enum(['CALENDAR', 'TBD', 'RELATIVE', 'UNKNOWN']),
      raw: nonempty, quoteIndex: z.number().int().nonnegative(),
    }).nullable(),
    statusRaw: nonempty.nullable(),
    limitations: z.array(nonempty),
  })),
});

export interface DocumentActivityValidationContext {
  sourceBinding: DocumentActivitySourceBinding;
  selection: DocumentActivitySelection;
  deliveredRanges: DocumentActivityDeliveryRange[];
  /** Host-generated plan anchors restricted to persisted actual READ receipts. */
  deliveredAnchors: TranslationSourceAnchorV2[];
  sourceCoverage: DocumentOriginalCoverage;
}

/** No I/O or model calls. The caller owns authorization, receipt origin and commit fences. */
export function validateDocumentActivityCandidate(raw: unknown, context: DocumentActivityValidationContext): ValidatedDocumentActivityCandidate {
  const parsed = proposalSchema.safeParse(raw);
  if (!parsed.success) fail('SHAPE_INVALID');
  const proposal = parsed.data;
  const { sourceBinding, selection, deliveredRanges, deliveredAnchors } = context;
  if (!Number.isSafeInteger(sourceBinding.semanticRevision) || sourceBinding.semanticRevision < 1 ||
      !selection.sectionIds.length || new Set(selection.sectionIds).size !== selection.sectionIds.length ||
      !deliveredRanges.length) fail('HOST_CONTEXT_INVALID');
  const anchors = new Map(deliveredAnchors.map(anchor => [anchor.anchorId, anchor]));
  if (anchors.size !== deliveredAnchors.length) fail('ANCHOR_DUPLICATE');
  const delivered = new Set<string>();
  for (const range of deliveredRanges) {
    if (!selection.sectionIds.includes(range.sectionId) || !Number.isSafeInteger(range.offset) || range.offset < 0 ||
        (range.nextOffset !== null && (!Number.isSafeInteger(range.nextOffset) || range.nextOffset <= range.offset)))
      fail('DELIVERY_RANGE_INVALID');
    for (const id of range.anchorIds) {
      const anchor = anchors.get(id);
      if (!anchor || !range.unitIds.includes(anchor.sourceUnitId)) fail('DELIVERY_ANCHOR_INVALID');
      delivered.add(id);
    }
  }
  if (deliveredAnchors.some(anchor => !delivered.has(anchor.anchorId) || !anchor.sourceRefIds.length ||
      anchor.sourceRefIds.some(ref => !anchor.sourceLocators.some(locator => locator.sourceRefId === ref))))
    fail('ANCHOR_SOURCE_INVALID');
  const keys = new Set<string>();
  for (const statement of proposal.statements) {
    if (keys.has(statement.statementKey)) fail('STATEMENT_KEY_DUPLICATE');
    keys.add(statement.statementKey);
    for (const quote of statement.quotes) {
      const anchor = anchors.get(quote.anchorId);
      if (!anchor || !delivered.has(quote.anchorId)) fail('QUOTE_NOT_DELIVERED');
      if (!Number.isSafeInteger(quote.start) || !Number.isSafeInteger(quote.end) || quote.end <= quote.start ||
          quote.end > anchor.sourceText.length || anchor.sourceText.slice(quote.start, quote.end) !== quote.text)
        fail('QUOTE_MISMATCH');
    }
    const time = statement.time;
    if (time) {
      if (!statement.quotes[time.quoteIndex]?.text.includes(time.raw)) fail('TIME_NOT_QUOTED');
      if (time.expression !== 'CALENDAR' && time.precision !== 'UNKNOWN') fail('TIME_PRECISION_INVALID');
    }
    if (statement.statusRaw !== null && !statement.quotes.some(quote => quote.text.includes(statement.statusRaw!)))
      fail('STATUS_NOT_QUOTED');
  }
  return {
    ...structuredClone(proposal), candidateOnly: true,
    // Explicit fields retain nullable contract under the repository's TS null settings.
    statements: proposal.statements.map(statement => ({ ...structuredClone(statement),
      time: statement.time ?? null, statusRaw: statement.statusRaw ?? null })),
    sourceBinding: structuredClone(sourceBinding),
    readCoverage: { status: 'DELIVERED_RANGES_ONLY', selection: structuredClone(selection),
      deliveredRanges: structuredClone(deliveredRanges), sourceCoverage: structuredClone(context.sourceCoverage) },
    sourceAnchors: structuredClone(deliveredAnchors),
  };
}

/** Host allocates IDs and the revision inside its existing source/CAS transaction. */
export function materializeDocumentActivityRevision(candidate: ValidatedDocumentActivityCandidate, host: {
  runRef: string; candidateRevision: number; statementIds: string[];
  producer: DocumentActivityRevision['producer']; savedAt: string;
}): DocumentActivityRevision {
  if (!host.runRef.trim() || !Number.isSafeInteger(host.candidateRevision) || host.candidateRevision < 1 ||
      host.statementIds.length !== candidate.statements.length || new Set(host.statementIds).size !== host.statementIds.length ||
      host.statementIds.some(id => !id.trim()) || !host.producer.skillVersion.trim() || !host.producer.modelVersion.trim() ||
      !Number.isFinite(Date.parse(host.savedAt))) fail('HOST_IDENTITY_INVALID');
  return { ...structuredClone(candidate), runRef: host.runRef, candidateRevision: host.candidateRevision,
    producer: structuredClone(host.producer), savedAt: host.savedAt,
    statements: candidate.statements.map((statement, index) => ({ ...structuredClone(statement), statementId: host.statementIds[index] })) };
}

function fail(code: string): never { throw new Error(`DOCUMENT_ACTIVITY_${code}`); }
