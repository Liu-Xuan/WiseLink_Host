import { z } from 'zod/v4';
import { isDeepStrictEqual } from 'node:util';
import { DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA, resolveSourceQuoteSelection, type QuoteSelectionHostContext } from '@shared/document-activity-quote-selection';
import type { AnyDocumentActivityCandidateProposal, AnyValidatedDocumentActivityCandidate, AnyDocumentActivityRevision, DocumentActivitySourceContext, DocumentActivityCandidateProposal, DocumentActivityCandidateProposalV2, ValidatedDocumentActivityCandidateV2, DocumentActivityRevisionV2 } from '@shared/document-activity.interface';
import {
  DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2, DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA,
  type DocumentActivityDeliveryRange,
  type DocumentActivityRevision,
  type DocumentActivitySelection,
  type DocumentActivitySourceBinding,
  type ValidatedDocumentActivityCandidate,
} from '@shared/document-activity.interface';
import type { DocumentOriginalCoverage } from '@shared/document-original.interface';
import type { TranslationSourceAnchorV2 } from '@shared/canonical-translation-v2.interface';

const nonempty = z.string().refine(value => value.trim().length > 0);
const proposalSchemaV1 = z.strictObject({
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

const quotedCueSchema = z.strictObject({ raw: nonempty, quoteIndex: z.number().int().nonnegative() });
const timeSchema = proposalSchemaV1.shape.statements.element.shape.time.unwrap();
const proposalSchemaV2 = z.strictObject({
  schemaVersion: z.literal(DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2),
  statements: z.array(z.strictObject({
    statementKey: proposalSchemaV1.shape.statements.element.shape.statementKey,
    label: nonempty, quotes: proposalSchemaV1.shape.statements.element.shape.quotes,
    subject: quotedCueSchema.nullable(), action: quotedCueSchema.nullable(),
    modality: quotedCueSchema.extend({ meaning: z.enum(['REQUIRED','RECOMMENDED','PLANNED','POSSIBLE','REPORTED','UNKNOWN']),
      negationQuoteIndexes: z.array(z.number().int().nonnegative()) }).nullable(),
    status: quotedCueSchema.extend({ meaning: z.enum(['PLANNED','IN_PROGRESS','SOURCE_REPORTED_COMPLETED','ON_HOLD','CANCELLED','UNKNOWN']) }).nullable(),
    times: z.array(timeSchema),
    technicalIds: z.array(quotedCueSchema.extend({ kind: z.enum(['AIRCRAFT_LINE_NUMBER','PART_NUMBER','SERIAL_NUMBER','PUBLICATION_ID','TECHNICAL_LABEL','UNKNOWN']) })),
    scope: z.strictObject({ sectionIds: z.array(nonempty), conditions: z.array(quotedCueSchema.extend({
      kind: z.enum(['CONDITION','EXCEPTION','PREREQUISITE','LIMITATION']),
      appliesTo: z.enum(['STATEMENT','SECTION','DOCUMENT','UNRESOLVED']), sectionIds: z.array(nonempty) })),
      completeness: z.enum(['DELIVERED_SCOPE_ONLY','PARTIAL','UNRESOLVED']) }),
    limitations: z.array(nonempty),
  })),
});
const proposalSchema = z.discriminatedUnion('schemaVersion', [proposalSchemaV1, proposalSchemaV2]);

/** Explicit transport shape. Existing canonical proposal schema is unchanged. */
const selectionQuotes = z.array(z.strictObject({ anchorId: nonempty, text: nonempty })).min(1);
const selectionSchema = z.discriminatedUnion('schemaVersion', [proposalSchemaV1.extend({
  quoteSelectionSchemaVersion: z.literal(DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA),
  statements: z.array(proposalSchemaV1.shape.statements.element.extend({ quotes: selectionQuotes })),
}), proposalSchemaV2.extend({
  quoteSelectionSchemaVersion: z.literal(DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA),
  statements: z.array(proposalSchemaV2.shape.statements.element.extend({ quotes: selectionQuotes })),
})]);

/** Executed by the runtime's existing transaction callback with trusted READ inventory. */
export function materializeDocumentActivityQuoteSelection(raw: unknown, host: QuoteSelectionHostContext): AnyDocumentActivityCandidateProposal {
  const parsed = selectionSchema.safeParse(raw);
  if (!parsed.success) fail('QUOTE_SELECTION_SHAPE_INVALID');
  const { quoteSelectionSchemaVersion: _transport, ...proposal } = parsed.data;
  return { ...proposal, statements: proposal.statements.map((statement, statementIndex) => ({ ...statement,
    quotes: statement.quotes.map((selection, quoteIndex) => {
      const result = resolveSourceQuoteSelection(selection, host);
      if (result.status === 'UNRESOLVED') {
        const error = new Error(`DOCUMENT_ACTIVITY_QUOTE_SELECTION_${result.reason}:STATEMENT_${statementIndex}:QUOTE_${quoteIndex}`);
        Object.assign(error, { statementIndex, quoteIndex, unresolvedReason: result.reason });
        throw error;
      }
      return result.quote;
    }),
  })) } as AnyDocumentActivityCandidateProposal;
}

export interface DocumentActivityValidationContext {
  sourceBinding: DocumentActivitySourceBinding;
  selection: DocumentActivitySelection;
  deliveredRanges: DocumentActivityDeliveryRange[];
  /** Host-generated plan anchors restricted to persisted actual READ receipts. */
  deliveredAnchors: TranslationSourceAnchorV2[];
  sourceCoverage: DocumentOriginalCoverage;
  /** Exact saved map metadata restricted to actual delivery. Mandatory for v2. */
  sourceContext?: DocumentActivitySourceContext;
}

/** No I/O or model calls. The caller owns authorization, receipt origin and commit fences. */
export function validateDocumentActivityCandidate(raw: DocumentActivityCandidateProposal, context: DocumentActivityValidationContext): ValidatedDocumentActivityCandidate;
export function validateDocumentActivityCandidate(raw: DocumentActivityCandidateProposalV2, context: DocumentActivityValidationContext): ValidatedDocumentActivityCandidateV2;
export function validateDocumentActivityCandidate(raw: unknown, context: DocumentActivityValidationContext): AnyValidatedDocumentActivityCandidate;
export function validateDocumentActivityCandidate(raw: unknown, context: DocumentActivityValidationContext): AnyValidatedDocumentActivityCandidate {
  const parsed = proposalSchema.safeParse(raw);
  if (!parsed.success) fail('SHAPE_INVALID');
  const proposal = parsed.data as AnyDocumentActivityCandidateProposal;
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
    const times = 'times' in statement ? statement.times : statement.time ? [statement.time] : [];
    for (const time of times) {
      if (!statement.quotes[time.quoteIndex]?.text.includes(time.raw)) fail('TIME_NOT_QUOTED');
      if (time.expression !== 'CALENDAR' && time.precision !== 'UNKNOWN') fail('TIME_PRECISION_INVALID');
    }
    if ('statusRaw' in statement) {
      if (statement.statusRaw !== null && !statement.quotes.some(quote => quote.text.includes(statement.statusRaw!)))
        fail('STATUS_NOT_QUOTED');
      continue;
    }
    const sourceContext = context.sourceContext;
    if (!sourceContext || sourceContext.schemaVersion !== DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA ||
      !isDeepStrictEqual(JSON.parse(JSON.stringify(sourceContext.sourceBinding)), JSON.parse(JSON.stringify(sourceBinding)))) fail('SOURCE_CONTEXT_REQUIRED');
    const sections = new Map(sourceContext.sections.map(section => [section.sectionId, section]));
    if (sections.size !== sourceContext.sections.length) fail('SOURCE_CONTEXT_INVALID');
    const checkCue = (cue: { raw: string; quoteIndex: number } | null, code: string) => {
      if (cue && !statement.quotes[cue.quoteIndex]?.text.includes(cue.raw)) fail(code);
    };
    checkCue(statement.subject, 'SUBJECT_NOT_QUOTED'); checkCue(statement.action, 'ACTION_NOT_QUOTED');
    checkCue(statement.modality, 'MODALITY_NOT_QUOTED'); checkCue(statement.status, 'STATUS_NOT_QUOTED');
    if (statement.modality && (new Set(statement.modality.negationQuoteIndexes).size !== statement.modality.negationQuoteIndexes.length ||
      statement.modality.negationQuoteIndexes.some(index => !statement.quotes[index]))) fail('NEGATION_INDEX_INVALID');
    for (const identifier of statement.technicalIds) checkCue(identifier, 'TECHNICAL_ID_NOT_QUOTED');
    if (new Set(statement.scope.sectionIds).size !== statement.scope.sectionIds.length ||
      statement.scope.sectionIds.some(sectionId => !sections.has(sectionId))) fail('SCOPE_NOT_DELIVERED');
    for (const condition of statement.scope.conditions) {
      checkCue(condition, 'CONDITION_NOT_QUOTED');
      if (new Set(condition.sectionIds).size !== condition.sectionIds.length ||
        (condition.appliesTo !== 'SECTION' && condition.sectionIds.length) ||
        (condition.appliesTo === 'SECTION' && !condition.sectionIds.length)) fail('CONDITION_SCOPE_INVALID');
      if (condition.appliesTo === 'SECTION') {
        const anchor = anchors.get(statement.quotes[condition.quoteIndex].anchorId)!;
        for (const target of condition.sectionIds) {
          if (!statement.scope.sectionIds.includes(target) || !sections.has(target) ||
            !sourceContext.sections.some(section => section.deliveredUnitIds.includes(anchor.sourceUnitId) &&
              (section.sectionId === target || section.contextForSectionIds.includes(target)))) fail('CONDITION_SCOPE_UNSUPPORTED');
        }
      }
    }
  }
  if (proposal.schemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2) {
    if (!context.sourceContext || context.sourceContext.schemaVersion !== DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA ||
      !isDeepStrictEqual(JSON.parse(JSON.stringify(context.sourceContext.sourceBinding)), JSON.parse(JSON.stringify(sourceBinding)))) fail('SOURCE_CONTEXT_REQUIRED');
    return { ...structuredClone(proposal), candidateOnly: true, sourceBinding: structuredClone(sourceBinding),
      readCoverage: { status: 'DELIVERED_RANGES_ONLY', selection: structuredClone(selection),
        deliveredRanges: structuredClone(deliveredRanges), sourceCoverage: structuredClone(context.sourceCoverage) },
      sourceAnchors: structuredClone(deliveredAnchors), sourceContext: structuredClone(context.sourceContext) } as ValidatedDocumentActivityCandidateV2;
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
type RevisionHost = {
  runRef: string; candidateRevision: number; statementIds: string[];
  producer: DocumentActivityRevision['producer']; savedAt: string;
};
export function materializeDocumentActivityRevision(candidate: ValidatedDocumentActivityCandidate, host: RevisionHost): DocumentActivityRevision;
export function materializeDocumentActivityRevision(candidate: ValidatedDocumentActivityCandidateV2, host: RevisionHost): DocumentActivityRevisionV2;
export function materializeDocumentActivityRevision(candidate: AnyValidatedDocumentActivityCandidate, host: RevisionHost): AnyDocumentActivityRevision;
export function materializeDocumentActivityRevision(candidate: AnyValidatedDocumentActivityCandidate, host: RevisionHost): AnyDocumentActivityRevision {
  if (!host.runRef.trim() || !Number.isSafeInteger(host.candidateRevision) || host.candidateRevision < 1 ||
      host.statementIds.length !== candidate.statements.length || new Set(host.statementIds).size !== host.statementIds.length ||
      host.statementIds.some(id => !id.trim()) || !host.producer.skillVersion.trim() || !host.producer.modelVersion.trim() ||
      !Number.isFinite(Date.parse(host.savedAt))) fail('HOST_IDENTITY_INVALID');
  return { ...structuredClone(candidate), runRef: host.runRef, candidateRevision: host.candidateRevision,
    producer: structuredClone(host.producer), savedAt: host.savedAt,
    statements: candidate.statements.map((statement, index) => ({ ...structuredClone(statement), statementId: host.statementIds[index] })) } as AnyDocumentActivityRevision;
}

function fail(code: string): never { throw new Error(`DOCUMENT_ACTIVITY_${code}`); }
