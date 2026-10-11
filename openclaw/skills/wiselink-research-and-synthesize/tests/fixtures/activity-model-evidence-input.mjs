import { activityV2ProductionContract, DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2,
  DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA } from '../../scripts/document-activity-model-contract.mjs';
import { DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA } from '../../scripts/resolve-document-activity-quote-selection.mjs';

// Public synthetic evidence only. No private document, native session or model
// result is reproduced here; equal text deliberately belongs to distinct IDs.
export function activityEvidenceInput(promptVersion) {
  const text = '前😀\r\nOperators should not replace P/N 560 before January 2027; target TBD. P/N 760 remains UNKNOWN.';
  const cell = 'Plan only: not a report of execution; completion is UNKNOWN.';
  const sourceBinding = { original: { documentVersionId: 'DV-synthetic', parseRunId: 'PR-synthetic', parseRevision: 2,
    sourceArtifactId: 'SRC-synthetic', sourceSha256: 'a'.repeat(64), sourceByteLength: 100 }, semanticRevision: 1 };
  const locators = ['ref-one', 'ref-two', 'ref-three'].map((sourceRefId, index) => ({ sourceRefId,
    physicalPage: index + 1, textIndexes: [index * 2, index * 2 + 1], box: [10, 20, 110, 40],
    authority: 'ORIGINAL_SOURCE', extension: { note: cell } }));
  const raw = { html: '<table><tr><td>Plan only: not a report of execution; completion is UNKNOWN.</td></tr></table>',
    metadata: { untouched: true, nullable: null, integer: 560, decimal: 7.6, values: [false, null, cell] } };
  const units = [
    { unitId: 'unit-one', text, sourceRefIds: ['ref-one'], raw: structuredClone(raw) },
    { unitId: 'unit-two', text, sourceRefIds: ['ref-two'], raw: structuredClone(raw) },
    { unitId: 'unit-three', table: { cells: [[{ text: cell }]], raw: structuredClone(raw) }, sourceRefIds: ['ref-three'] },
  ];
  const anchors = units.map((unit, index) => ({ anchorId: `anchor-${index + 1}`, sourceUnitId: unit.unitId,
    payloadPath: index === 2 ? '/table/cells/0/0/text' : '/text', sourceText: index === 2 ? cell : text,
    sourceRefIds: unit.sourceRefIds, sourceLocators: [locators[index]], extension: { note: cell } }));
  const sectionIds = ['section-one', 'section-two', 'section-three'];
  return { candidateSchemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2,
    quoteSelectionSchemaVersion: DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA,
    productionContract: activityV2ProductionContract(DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA, promptVersion),
    documentVersionId: 'DV-synthetic', runRef: 'DAR-synthetic', sectionIds, selection: { sectionIds }, sourceBinding,
    sourceContext: { schemaVersion: DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA, sourceBinding: structuredClone(sourceBinding),
      profile: { profileRef: 'generic.author-sections.v1', selectionBasis: 'NOT_RECORDED', family: null, issuer: null },
      sections: sectionIds.map((sectionId, index) => ({ sectionId, parentSectionId: null, titleRaw: null,
        roleKey: null, headingUnitId: null, deliveredUnitIds: [units[index].unitId], contextForSectionIds: [] })),
      organizationWarnings: [] }, units, anchors,
    deliveredRanges: sectionIds.map((sectionId, index) => ({ sectionId, offset: 0,
      unitIds: [units[index].unitId], anchorIds: [anchors[index].anchorId], nextOffset: null })),
    sourceCoverage: { complete: false, unresolvedRanges: [{ code: 'UNREAD', physicalPages: [9, 10], note: cell },
      { code: 'STRUCTURE_UNCERTAIN', note: cell }, { code: 'TEXT_CONFLICT', note: cell }] },
  };
}
