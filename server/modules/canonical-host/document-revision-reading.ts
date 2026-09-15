import type { DocumentOriginalResult } from '@shared/document-original.interface';
import type { DocumentSemanticMap } from '@shared/document-semantic-map.interface';
import type { DocumentRevisionReadingResponse, DocumentRevisionReadingSide, DocumentRevisionSectionReading } from '@shared/document-revision-reading.interface';
import { documentOriginalReadingCoverage } from '../document-management/src/hosted/nest/document-original-adapter';
import { assertDocumentSemanticMap, selectDocumentSemanticSection } from '../document-management/src/hosted/nest/document-semantic-map';

function side(original: DocumentOriginalResult, map: DocumentSemanticMap, roleKey: string): DocumentRevisionReadingSide {
  assertDocumentSemanticMap(map, original);
  const read = (sectionId: string): DocumentRevisionSectionReading => {
    const selection = selectDocumentSemanticSection(original, map, sectionId);
    const ids = new Set([...selection.unitIds, ...selection.contextUnitIds]);
    const units = original.source.units.filter(unit => ids.has(unit.unitId)).sort((a, b) => a.order - b.order);
    const refs = new Set(selection.sourceRefIds);
    return { selection, units, sourceLocators: original.source.sourceLocators.filter(locator => refs.has(locator.sourceRefId)) };
  };
  const selectedSections = map.sections.filter(section => section.roleKey === roleKey).map(section => read(section.sectionId));
  const selectedIds = new Set(selectedSections.flatMap(section => section.units.map(unit => unit.unitId)));
  return { binding: original.binding, semanticRevision: map.semanticRevision, profileRef: map.profileRef,
    sections: map.sections,
    publisherRevisionDescriptions: map.sections.filter(section => ['ftd.revision_description', 'sb.revision'].includes(section.roleKey ?? ''))
      .map(section => read(section.sectionId)),
    selectedSections, coverage: original.coverage,
    unselectedUnitIds: original.source.units.filter(unit => !selectedIds.has(unit.unitId)).map(unit => unit.unitId) };
}

/** Read-only text comparison. Never aligns activities, adopts a version, or records assessment coverage. */
export function buildDocumentRevisionReading(familyId: string, beforeOriginal: DocumentOriginalResult,
  beforeMap: DocumentSemanticMap, afterOriginal: DocumentOriginalResult, afterMap: DocumentSemanticMap,
  roleKey: string): DocumentRevisionReadingResponse {
  if (beforeOriginal.binding.documentVersionId === afterOriginal.binding.documentVersionId)
    throw new Error('DOCUMENT_REVISION_DISTINCT_VERSIONS_REQUIRED');
  const before = side(beforeOriginal, beforeMap, roleKey);
  const after = side(afterOriginal, afterMap, roleKey);
  const reasons: string[] = [];
  if (before.profileRef !== after.profileRef) reasons.push('SEMANTIC_PROFILES_DIFFER');
  if (before.selectedSections.length !== 1 || after.selectedSections.length !== 1) reasons.push('ROLE_MISSING_OR_REPEATED');
  const text = (value: DocumentRevisionReadingSide): string | null => {
    const selected = value.selectedSections[0];
    if (!selected) return null;
    const selectedIds = new Set(selected.units.map(unit => unit.unitId));
    const relevantIds = new Set(value.sections.filter(section => selectedIds.has(section.headingUnitId)).map(section => section.sectionId));
    if (selected.selection.organizationWarnings.some(warning => warning.sectionIds.some(id => relevantIds.has(id))))
      reasons.push('SECTION_ORGANIZATION_UNCERTAIN');
    const section = value.sections.find(item => item.sectionId === selected.selection.sectionId)!;
    if (['EMPTY', 'UNREAD'].includes(section.contentState)) reasons.push('SECTION_EMPTY_OR_UNREAD');
    // Tables/native selectors must retain their structure. No JSON stringify or flattening as text equality.
    if (selected.units.some(unit => !['heading', 'paragraph'].includes(unit.kind) || typeof unit.payload.text !== 'string')) {
      reasons.push('NON_PLAIN_TEXT_CONTENT');
      return null;
    }
    const ids = new Set(selected.units.map(unit => unit.unitId));
    const refs = new Set(selected.selection.sourceRefIds);
    const original = value === before ? beforeOriginal : afterOriginal;
    const pages = new Set(original.locations.filter(location => refs.has(location.sourceRefId))
      .map(location => location.pageIndex).filter(page => page !== null));
    // The result describes text only. Figure limitations remain in coverage, and a selected figure
    // already prevents plain-text comparison above. Unread/uncertain text can invalidate this range.
    if (documentOriginalReadingCoverage(original).unresolvedRanges.some(range => range.readingImpact !== 'DIAGNOSTIC' &&
      range.reason !== 'FIGURE_UNINTERPRETED' && (range.unitIds.length
        ? range.unitIds.some(id => ids.has(id))
        : !range.pageIndexes.length || !pages.size || range.pageIndexes.some(page => pages.has(page)))))
      reasons.push('SOURCE_READING_LIMITATIONS');
    return selected.units.map(unit => String(unit.payload.text)).join(' ').replace(/\s+/g, ' ').trim();
  };
  const beforeText = text(before), afterText = text(after);
  return { familyId, before, after,
    systemComparison: { roleKey, method: 'PLAIN_TEXT_WITH_PARENT_CONTEXT',
      status: reasons.length || beforeText === null || afterText === null ? 'NOT_COMPARED'
        : beforeText === afterText ? 'TEXT_EQUAL' : 'TEXT_DIFFERENT', reasons: [...new Set(reasons)] },
    publicationRelationship: 'NOT_VERIFIED', assessmentCoverage: 'NOT_RECORDED_BY_THIS_READ' };
}
