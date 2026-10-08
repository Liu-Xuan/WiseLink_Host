import { buildDocumentActivitySourceContext } from './document-activity-source-context';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import {
  DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,
  DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2,
  type DocumentActivitySourceContext,
  type DocumentActivityStatementV2,
  type DocumentActivityReadCoverage,
  type AnyDocumentActivityRevision,
  type DocumentActivitySourceBinding,
  type DocumentActivityStatement,
  type DocumentActivityStatementReference,
} from '@shared/document-activity.interface';
import type { DocumentOriginalResult } from '@shared/document-original.interface';
import type { DocumentSemanticMap } from '@shared/document-semantic-map.interface';
import type { TranslationSourceAnchorV2 } from '@shared/canonical-translation-v2.interface';
import {
  assertDocumentSemanticMap,
  selectDocumentSemanticSection,
  semanticTranslationSource,
} from '../document-management/src/hosted/nest/document-semantic-map';
import {
  documentOriginalReadingCoverage,
  documentOriginalStructuredSource,
} from '../document-management/src/hosted/nest/document-original-adapter';
import { buildTranslationSourcePlan } from './canonical-translation-source-plan';
import { materializeDocumentActivityRevision, validateDocumentActivityCandidate } from './document-activity-candidate';

export interface DocumentActivityAssessmentQuoteLocator {
  quoteIndex: number;
  anchorId: string;
  sourceUnitId: string;
  payloadPath: string;
  sourceRefIds: string[];
  rootRefs: string[];
}
export interface DocumentActivityAssessmentDirectoryEntry {
  ref: string;
  reference: DocumentActivityStatementReference;
  label: string;
  semanticFieldsAvailability: 'LEGACY_PARTIAL' | 'V2_CAPTURED_FIELDS_ONLY';
  scopeBasis: 'LEGACY_RUN_SCOPE' | 'ACTUAL_DELIVERED_RUN_SCOPE';
  sourceSchemaVersion?: typeof DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2;
}
interface DocumentActivityAssessmentRecordCommon {
  ref: string;
  reference: DocumentActivityStatementReference;
  sourceBinding: DocumentActivitySourceBinding;
  candidateOnly: true;
  rootRefs: string[];
  requiredContextRootRefs: string[];
  quoteLocators: DocumentActivityAssessmentQuoteLocator[];
}
export type DocumentActivityAssessmentRecord = DocumentActivityAssessmentRecordCommon & (
  | { sourceSchemaVersion: typeof DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA; statement: DocumentActivityStatement; semanticFieldsAvailability: 'LEGACY_PARTIAL'; scopeBasis: 'LEGACY_RUN_SCOPE' }
  | { sourceSchemaVersion: typeof DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2; statement: DocumentActivityStatementV2; semanticFieldsAvailability: 'V2_CAPTURED_FIELDS_ONLY'; scopeBasis: 'ACTUAL_DELIVERED_RUN_SCOPE' }
);
export interface DocumentActivityAssessmentProjection {
  schemaVersion: 'wiselink.document.activity-assessment-projection.v1';
  sourceBinding: DocumentActivitySourceBinding;
  availability: 'AVAILABLE' | 'NOT_SAVED';
  entries: DocumentActivityAssessmentDirectoryEntry[];
  records: DocumentActivityAssessmentRecord[];
  activityContexts: Array<{ runRef: string; candidateRevision: number; readCoverage: DocumentActivityReadCoverage; sourceContext?: DocumentActivitySourceContext }>;
  limitations: string[];
}
export interface SavedDocumentActivityAssessmentInput {
  /** Caller must freshly authorize this exact source and prove status=SAVED through
   * its SAVED reader contract. A v1 payload cannot itself establish ACL/DB status.
   * Null means no SAVED result for this exact source, not absence in the document. */
  savedRevision: AnyDocumentActivityRevision | null;
  original: DocumentOriginalResult;
  semanticMap: DocumentSemanticMap;
  /** Exact original carriers from the caller's authorized reader, never directory hints. */
  originalEvidence: AssessmentEvidence[];
}

/** Pure D0 projection: no DB, model, OCR, mutation, save, authorization or adoption.
 * Keeps the entire actual delivered run context because v1 has no statement scope.
 * Directory/roots are references, not new delivery receipts or proof of full reading.
 * Packet budgeting belongs to the eventual consumer; this function never truncates. */
export function projectSavedDocumentActivityForAssessment(
  input: SavedDocumentActivityAssessmentInput,
): DocumentActivityAssessmentProjection {
  const { savedRevision: saved, original, semanticMap } = input;
  if (!sameJson(semanticMap.binding, original.binding) ||
      (saved && !sameJson(saved.sourceBinding.original, original.binding))) fail('SOURCE_BINDING_MISMATCH');
  assertDocumentSemanticMap(semanticMap, original);
  const sourceBinding: DocumentActivitySourceBinding = {
    original: structuredClone(original.binding), semanticRevision: semanticMap.semanticRevision,
  };
  if (saved === null) return {
    schemaVersion: 'wiselink.document.activity-assessment-projection.v1', sourceBinding,
    availability: 'NOT_SAVED', entries: [], records: [], activityContexts: [],
    limitations: ['该准确来源尚无已保存声明；可继续读取原文。'],
  };
  if (saved.sourceBinding.semanticRevision !== semanticMap.semanticRevision) fail('SEMANTIC_REVISION_MISMATCH');
  if (![DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2].includes(saved.schemaVersion) || saved.candidateOnly !== true)
    fail('SAVED_REVISION_INVALID');
  assertReference({ runRef: saved.runRef, candidateRevision: saved.candidateRevision,
    statementId: 'identity-validation' });
  for (const sectionId of saved.readCoverage.selection.sectionIds) {
    selectDocumentSemanticSection(original, semanticMap, sectionId);
  }
  const source = documentOriginalStructuredSource(original, original.binding);
  const planInput: Omit<Parameters<typeof buildTranslationSourcePlan>[0], 'source'> = { documentVersionId: original.binding.documentVersionId, packageId: original.binding.parseRunId,
    title: '', parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate',
      ref: `document-original://${original.binding.documentVersionId}/${original.binding.parseRunId}`,
      // Descriptor metadata does not allocate anchors; source binding is checked above.
      sha256: original.binding.sourceSha256, byteLength: original.binding.sourceByteLength, mediaType: 'application/json' } };
  const plan = buildTranslationSourcePlan({ ...planInput, source });
  const receiptIds = new Set<string>();
  for (const range of saved.readCoverage.deliveredRanges) {
    const selection = selectDocumentSemanticSection(original, semanticMap, range.sectionId);
    const allowedIds = new Set([...selection.unitIds, ...selection.contextUnitIds]);
    const available = source.units.filter(unit => allowedIds.has(unit.unitId));
    const end = range.offset + range.unitIds.length;
    const expectedUnits = available.slice(range.offset, end).map(unit => unit.unitId);
    const expectedAnchors = plan.anchors.filter(anchor => range.unitIds.includes(anchor.sourceUnitId));
    if (!Number.isSafeInteger(range.offset) || range.offset < 0 || range.offset >= available.length ||
        !sameJson(range.unitIds, expectedUnits) ||
        !sameJson(range.anchorIds, expectedAnchors.map(anchor => anchor.anchorId)) ||
        range.nextOffset !== (end < available.length ? end : null)) fail('DELIVERY_RANGE_MISMATCH');
    range.anchorIds.forEach(id => receiptIds.add(id));
  }
  const anchors = plan.anchors.filter(anchor => receiptIds.has(anchor.anchorId));
  if (!sameJson(saved.sourceAnchors, anchors)) fail('DELIVERED_ANCHOR_MISMATCH');
  // Runtime stores reading coverage; constructed/legacy candidates may retain raw
  // original coverage. Both are exact deterministic views; neither is rewritten.
  if (!sameJson(saved.readCoverage.sourceCoverage, documentOriginalReadingCoverage(original)) &&
      !sameJson(saved.readCoverage.sourceCoverage, original.coverage)) fail('SOURCE_COVERAGE_MISMATCH');
  const sourceContext = saved.schemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2
    ? buildDocumentActivitySourceContext({ original, semanticMap, sourceBinding, selection: saved.readCoverage.selection, deliveredRanges: saved.readCoverage.deliveredRanges }) : undefined;
  // Earlier Host projectors omitted an existing semantic-map receipt. Honor that
  // exact saved NOT_RECORDED contract instead of retroactively enriching history.
  // The full equality below still rejects extra keys, invented identity and any
  // structural/binding drift; recorded receipts must match the bound map exactly.
  if (sourceContext && saved.schemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 &&
      saved.sourceContext?.profile?.selectionBasis === 'NOT_RECORDED') {
    sourceContext.profile = { profileRef: semanticMap.profileRef, selectionBasis: 'NOT_RECORDED', family: null, issuer: null };
  }
  if (sourceContext && (saved.schemaVersion !== DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 || !sameJson(sourceContext, saved.sourceContext))) fail('SOURCE_CONTEXT_MISMATCH');
  const proposal = { schemaVersion: saved.schemaVersion,
    statements: saved.statements.map(({ statementId: _statementId, ...statement }) => statement) };
  const candidate = validateDocumentActivityCandidate(proposal, {
    sourceBinding, selection: saved.readCoverage.selection, deliveredRanges: saved.readCoverage.deliveredRanges,
    deliveredAnchors: anchors, sourceCoverage: saved.readCoverage.sourceCoverage,
    ...(sourceContext ? { sourceContext } : {}),
  });
  const validated = materializeDocumentActivityRevision(candidate, {
    runRef: saved.runRef, candidateRevision: saved.candidateRevision,
    statementIds: saved.statements.map(statement => statement.statementId), producer: saved.producer, savedAt: saved.savedAt,
  });
  if (!sameJson(validated, saved)) fail('SAVED_REVISION_INVALID');
  saved.statements.forEach(statement => assertReference({ runRef: saved.runRef,
    candidateRevision: saved.candidateRevision, statementId: statement.statementId }));
  const requiredContextRootRefs = unique(anchors.flatMap(anchor => anchor.sourceRefIds.map(ref => rootRef(original, ref))));
  // Original readers can use the base plan or an exact semantic organizational
  // view. Accept their complete locator excerpts only, never partial substring hints.
  validateRoots(input, requiredContextRootRefs, plan.anchors, () =>
    buildTranslationSourcePlan({ ...planInput, source: semanticTranslationSource(original, semanticMap) }).anchors);
  const byId = new Map(anchors.map(anchor => [anchor.anchorId, anchor]));
  const records: DocumentActivityAssessmentRecord[] = saved.statements.map(statement => {
    const reference = { runRef: saved.runRef, candidateRevision: saved.candidateRevision, statementId: statement.statementId };
    const quoteLocators = statement.quotes.map((quote, quoteIndex): DocumentActivityAssessmentQuoteLocator => {
      const anchor = byId.get(quote.anchorId)!;
      return { quoteIndex, anchorId: anchor.anchorId, sourceUnitId: anchor.sourceUnitId,
        payloadPath: anchor.payloadPath, sourceRefIds: unique(anchor.sourceRefIds),
        rootRefs: unique(anchor.sourceRefIds.map(ref => rootRef(original, ref))) };
    });
    return { ref: statementRef(reference), reference, sourceBinding: structuredClone(sourceBinding), candidateOnly: true,
      sourceSchemaVersion: saved.schemaVersion, statement: structuredClone(statement),
      semanticFieldsAvailability: saved.schemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA ? 'LEGACY_PARTIAL' : 'V2_CAPTURED_FIELDS_ONLY',
      scopeBasis: saved.schemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA ? 'LEGACY_RUN_SCOPE' : 'ACTUAL_DELIVERED_RUN_SCOPE',
      rootRefs: unique(quoteLocators.flatMap(locator => locator.rootRefs)),
      requiredContextRootRefs: [...requiredContextRootRefs], quoteLocators } as DocumentActivityAssessmentRecord;
  });
  return {
    schemaVersion: 'wiselink.document.activity-assessment-projection.v1', sourceBinding, availability: 'AVAILABLE', records,
    entries: records.map(record => ({ ref: record.ref, reference: structuredClone(record.reference), label: record.statement.label,
      semanticFieldsAvailability: record.semanticFieldsAvailability, scopeBasis: record.scopeBasis,
      ...(record.sourceSchemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 ? { sourceSchemaVersion: record.sourceSchemaVersion } : {}) })),
    activityContexts: [{ runRef: saved.runRef, candidateRevision: saved.candidateRevision,
      readCoverage: structuredClone(saved.readCoverage), ...(sourceContext ? { sourceContext: structuredClone(sourceContext) } : {}) }],
    limitations: [
      saved.schemaVersion === DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA ? '既有 v1 仅记录部分语义字段；未记录项不能解释为原文不存在。' : 'v2 保留已捕获的来源语义字段；null 与空数组不代表原文不存在，分类仍为来源解释候选。',
      '必要语境保守保留该 run 全部实际已交付根来源；不保证已读完整文档或全部选中章节。',
      '来源声明是解释候选；不证明适用性、执行核验或正式采用。',
      ...(records.length ? [] : ['此次已交付范围未生成声明；不表示全文没有活动或要求。']),
    ],
  };
}

/** Exact getter for this already validated snapshot. No latest/current fallback,
 * no lookup by label and no delivery/authorization side effect. */
export function readProjectedDocumentActivityStatement(
  projection: DocumentActivityAssessmentProjection, reference: DocumentActivityStatementReference,
): DocumentActivityAssessmentRecord {
  assertReference(reference);
  const matches = projection.records.filter(record => sameJson(record.reference, reference));
  if (projection.availability !== 'AVAILABLE' || matches.length !== 1) fail('STATEMENT_REFERENCE_NOT_FOUND');
  const record = matches[0];
  if (record.ref !== statementRef(reference) || record.statement.statementId !== reference.statementId ||
      !sameJson(record.sourceBinding, projection.sourceBinding)) fail('STATEMENT_REFERENCE_MISMATCH');
  return structuredClone(record);
}

function validateRoots(input: SavedDocumentActivityAssessmentInput, required: string[],
  baseAnchors: TranslationSourceAnchorV2[], semanticFallback: () => TranslationSourceAnchorV2[]): void {
  let semanticAnchors: TranslationSourceAnchorV2[] | undefined;
  const evidenceByRef = new Map<string, AssessmentEvidence>();
  for (const evidence of input.originalEvidence) {
    if (evidence.kind !== 'DOCUMENT_PASSAGE' || evidence.workItemId !== null ||
        evidence.documentVersionId !== input.original.binding.documentVersionId ||
        evidence.versionLabel !== input.original.binding.parseRunId ||
        evidence.evidenceRef !== rootRef(input.original, evidence.sourceRefId)) fail('ROOT_EVIDENCE_INVALID');
    const previous = evidenceByRef.get(evidence.evidenceRef);
    if (previous && !sameJson(previous, evidence)) fail('ROOT_EVIDENCE_CONFLICT');
    evidenceByRef.set(evidence.evidenceRef, evidence);
    const location = input.original.source.sourceLocators.find(locator => locator.sourceRefId === evidence.sourceRefId);
    if (!location) fail('ROOT_EVIDENCE_INVALID');
    let locator: unknown;
    try { locator = JSON.parse(evidence.locator); } catch { fail('ROOT_LOCATOR_INVALID'); }
    const expected = { parseRunId: input.original.binding.parseRunId, sourceRefId: evidence.sourceRefId,
      pageStart: location.pageStart, normalizedPath: location.normalizedPath, xpath: location.xpath };
    if (!sameJson(locator, expected)) fail('ROOT_LOCATOR_MISMATCH');
    const excerpt = (anchors: TranslationSourceAnchorV2[]): string => anchors
      .filter(anchor => anchor.sourceRefIds.includes(evidence.sourceRefId)).map(anchor => anchor.sourceText).join('\n');
    const baseText = excerpt(baseAnchors);
    if (!baseText) fail('ROOT_EVIDENCE_TEXT_MISMATCH');
    if (evidence.excerpt !== baseText) {
      semanticAnchors ??= semanticFallback();
      if (evidence.excerpt !== excerpt(semanticAnchors)) fail('ROOT_EVIDENCE_TEXT_MISMATCH');
    }
  }
  if (required.some(ref => !evidenceByRef.has(ref))) fail('ROOT_EVIDENCE_MISSING');
}
function rootRef(original: DocumentOriginalResult, sourceRefId: string): string {
  return `DOCUMENT_ORIGINAL:${original.binding.documentVersionId}:${original.binding.parseRunId}:${sourceRefId}`;
}
function statementRef(reference: DocumentActivityStatementReference): string {
  return `DOCUMENT_ACTIVITY:${reference.runRef}:${reference.candidateRevision}:${reference.statementId}`;
}
function assertReference(reference: DocumentActivityStatementReference): void {
  if (![reference.runRef, reference.statementId].every(value => typeof value === 'string' && value.trim() && !value.includes(':')) ||
      !Number.isSafeInteger(reference.candidateRevision) || reference.candidateRevision < 1) fail('STATEMENT_REFERENCE_INVALID');
}
/** Compare DTO values without object-realm/prototype or Unicode normalization.
 * Legacy quote offsets are UTF-16 code units, including an exact partial pair. */
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value: unknown, index: number) => sameJson(value, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return keys.length === Object.keys(rightRecord).length && keys.every(key =>
    Object.prototype.hasOwnProperty.call(rightRecord, key) && sameJson(leftRecord[key], rightRecord[key]));
}
function unique(values: string[]): string[] { return [...new Set(values)]; }
function fail(code: string): never { throw new Error(`DOCUMENT_ACTIVITY_ASSESSMENT_${code}`); }
