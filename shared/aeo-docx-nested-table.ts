import type { AeoDocxSemanticallyEnrichedParsePackageCandidate } from './aeo-structured-parse';

export const AEO_DOCX_NESTED_TABLE_PATCH_VERSION =
  'aeo_docx_nested_table_patch_v1.candidate.1' as const;

export type AeoDocxNestedTableVerticalMerge =
  | 'NONE'
  | 'RESTART'
  | 'CONTINUE';

export interface AeoDocxNestedTableCellDeclaration {
  columnStart: number;
  columnSpan: number;
  verticalMerge: AeoDocxNestedTableVerticalMerge;
  textMixed: string;
}

export interface AeoDocxNestedTableRowDeclaration {
  rowIndex: number;
  cells: AeoDocxNestedTableCellDeclaration[];
}

export interface AeoDocxNestedTableDeclaration {
  parentNodeId: string;
  parentSourceLocator: string;
  nestedTableIndex: number;
  xmlTableSha256: string;
  pageNumbers: number[];
  rows: AeoDocxNestedTableRowDeclaration[];
}

export interface AeoDocxNestedTableCoverageAssertion {
  parentNodeId: string;
  expectedNestedTableCount: number;
  coverageAuthority: 'DEVELOPMENT_STRUCTURAL_QA_FULL_XML_AND_VISUAL';
}

export interface AeoDocxNestedTablePatch {
  patchVersion: typeof AEO_DOCX_NESTED_TABLE_PATCH_VERSION;
  xmlObserverVersion: 'aeo_docx_nested_table_xml_observer_v1.local.1';
  targetParsePackageId: string;
  targetPackageHash: string;
  originalSourceSha256: string;
  observationHash: string;
  reviewAuthority: 'DEVELOPMENT_STRUCTURAL_QA';
  declarations: AeoDocxNestedTableDeclaration[];
  coverageAssertions: AeoDocxNestedTableCoverageAssertion[];
}

export interface AeoDocxNestedTableEnrichedParsePackageCandidate
  extends AeoDocxSemanticallyEnrichedParsePackageCandidate {
  nestedTableParentParsePackageId: string;
  nestedTableParentPackageHash: string;
  nestedTablePatchVersion: typeof AEO_DOCX_NESTED_TABLE_PATCH_VERSION;
  nestedTablePatchHash: string;
  nestedTableStructureReview: {
    xmlObserverVersion: 'aeo_docx_nested_table_xml_observer_v1.local.1';
    reviewAuthority: 'DEVELOPMENT_STRUCTURAL_QA';
    coverageAssertionCount: number;
    embeddedTableCount: number;
    tableRowCount: number;
    tableCellCount: number;
    mergeCellCount: number;
  };
}
