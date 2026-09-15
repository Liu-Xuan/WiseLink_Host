import type { DocumentOriginalBinding, DocumentOriginalResult } from '@shared/document-original.interface';
import type { TranslationStructuredSource } from '@shared/canonical-translation-v2.interface';

/** Adapt one persisted, exactly bound original. No latest lookup and no translated evidence. */
export function documentOriginalStructuredSource(
  result: DocumentOriginalResult,
  expected: DocumentOriginalBinding,
): TranslationStructuredSource {
  for (const key of Object.keys(expected) as Array<keyof DocumentOriginalBinding>) {
    if (result.binding[key] !== expected[key]) throw new Error('DOCUMENT_ORIGINAL_BINDING_MISMATCH');
  }
  if (result.schemaVersion !== 'wiselink.document.original.v1') throw new Error('DOCUMENT_ORIGINAL_SCHEMA_INVALID');
  const source = structuredClone(result.source);
  const refs = new Set(source.sourceLocators.map(locator => locator.sourceRefId));
  const locations = new Map(result.locations.map(location => [location.sourceRefId, location]));
  if (refs.size !== source.sourceLocators.length || locations.size !== result.locations.length)
    throw new Error('DOCUMENT_ORIGINAL_DUPLICATE_SOURCE_REF');
  const validPage = (page: number) => Number.isSafeInteger(page) && page >= 0 &&
    (result.coverage.knownPageCount === null || page < result.coverage.knownPageCount);
  if (result.coverage.knownPageCount !== null &&
      (!Number.isSafeInteger(result.coverage.knownPageCount) || result.coverage.knownPageCount < 1))
    throw new Error('DOCUMENT_ORIGINAL_COVERAGE_INVALID');
  if (result.coverage.readPageIndexes.some(page => !validPage(page)) ||
      result.coverage.unresolvedRanges.some(range => range.pageIndexes.some(page => !validPage(page))))
    throw new Error('DOCUMENT_ORIGINAL_COVERAGE_INVALID');
  if (result.coverage.knownPageCount !== null) {
    for (let page = 0; page < result.coverage.knownPageCount; page++) {
      if (!result.coverage.readPageIndexes.includes(page) &&
          !result.coverage.unresolvedRanges.some(range => range.pageIndexes.includes(page)))
        throw new Error('DOCUMENT_ORIGINAL_COVERAGE_UNACCOUNTED');
    }
  }
  for (const unit of source.units) {
    if (!unit.sourceRefIds.length || unit.sourceRefIds.some(ref => !refs.has(ref)))
      throw new Error('DOCUMENT_ORIGINAL_SOURCE_REF_MISSING');
  }
  for (const locator of source.sourceLocators) {
    const location = locations.get(locator.sourceRefId);
    if (!location || (location.pageIndex !== null && !validPage(location.pageIndex)))
      throw new Error('DOCUMENT_ORIGINAL_LOCATION_INVALID');
    if (location.precision !== 'TEXT_ITEM' && location.boxes.length)
      throw new Error('DOCUMENT_ORIGINAL_LOCATION_PRECISION_INVALID');
    if (location.precision === 'TEXT_ITEM' && (!location.boxes.length ||
        location.coordinateSpace !== 'PDF_VIEWPORT_TOP_LEFT' ||
        !location.viewportWidth || !location.viewportHeight || location.pageIndex === null))
      throw new Error('DOCUMENT_ORIGINAL_LOCATION_PRECISION_INVALID');
    // UnifiedReader's legacy locator cannot declare coordinate space. Keep navigation
    // page-level; the document Reader uses the explicit geometry sidecar above.
    locator.bbox = null;
  }
  source.findings.push(...result.coverage.unresolvedRanges.map((range, index) => ({
    findingId: `${result.binding.parseRunId}:coverage:${index}`,
    code: range.reason, severity: range.reason === 'UNREAD' ? 'error' : 'warning', message: range.message,
    // Candidate alignment and image-paint observations do not establish unreadable text.
    readingImpact: documentOriginalRangeReadingImpact(result, range),
    blocking: range.reason === 'UNREAD',
    affectedUnitIds: [...range.unitIds], sourceRefIds: [], pageIndexes: [...range.pageIndexes],
  })));
  return source;
}

/** Normal reading carries actual limitations; immutable coverage retains diagnostics for authorized inspection. */
export function documentOriginalReadingCoverage(result: DocumentOriginalResult) {
  const projected = documentOriginalStructuredSource(result, result.binding);
  const limitationIds = new Set(projected.findings.filter(finding => finding.readingImpact === 'LIMITATION')
    .map(finding => String(finding.findingId)));
  return { ...structuredClone(result.coverage), unresolvedRanges: result.coverage.unresolvedRanges.filter((_range, index) =>
    limitationIds.has(`${result.binding.parseRunId}:coverage:${index}`)).map(range => ({ ...structuredClone(range),
      message: range.reason === 'UNREAD' ? '本页尚无可读文字，请查看原页。' : '此处表格关系尚未可靠重建，请查看原页。',
    })) };
}

/** Shared meaning of a saved range; diagnostics remain available in the saved artifact. */
export function documentOriginalRangeReadingImpact(result: DocumentOriginalResult,
  range: DocumentOriginalResult['coverage']['unresolvedRanges'][number]): 'LIMITATION' | 'DIAGNOSTIC' {
  return range.readingImpact ?? (range.reason === 'UNREAD' || (range.reason === 'STRUCTURE_UNCERTAIN' &&
    range.unitIds.some(id => result.source.units.some(unit => unit.unitId === id &&
      ['table', 'preserved_source'].includes(unit.kind)))) ? 'LIMITATION' : 'DIAGNOSTIC');
}
