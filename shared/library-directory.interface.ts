export interface CanonicalLibraryDirectoryRequest {
  search?: string;
  normalizedFamily?: string;
  fleetFamily?: string;
  fleetModel?: string;
  aircraftModel?: string;
  ata2?: string;
}

export interface CanonicalLibraryDirectoryNode {
  level: 'AIRCRAFT_MODEL' | 'ATA2' | 'ATA4';
  /** __UNKNOWN__ retains missing classification; __RAW__ retains ambiguous raw values. */
  value: string;
  documentCount: number;
  versionCount: number;
  directDocumentCount: number;
  directVersionCount: number;
  rawValues: string[];
  hasChildren: boolean;
}

export interface CanonicalLibraryDirectoryResponse {
  scope: 'TENANT_DOCUMENT_CATALOG';
  level: CanonicalLibraryDirectoryNode['level'];
  /** Distinct formal families/versions in this selected scope, never child-count sums. */
  documentCount: number;
  versionCount: number;
  /** Documents held directly at ATA2 are included here without fabricated ATA4 nodes. */
  directDocumentCount: number;
  directVersionCount: number;
  nodes: CanonicalLibraryDirectoryNode[];
}
