/** Metadata classification/containment only; these are not document citations. */
export type LibraryGraphGroupBy = 'normalizedFamily' | 'ata';
export interface LibraryGraphFilters {
  search?: string;
  normalizedFamily?: string;
  ata?: string;
  aircraftModel?: string;
  fleetFamily?: string;
  fleetModel?: string;
}
interface LibraryGraphPageRequest {
  cursor?: string;
  limit?: number;
}
export type CanonicalLibraryGraphRequest = LibraryGraphPageRequest &
  (
    | (LibraryGraphFilters & {
        level: 'clusters';
        groupBy: LibraryGraphGroupBy;
      })
    | (LibraryGraphFilters & {
        level: 'families';
        groupBy: LibraryGraphGroupBy;
        clusterValue: string | null;
      })
    | { level: 'versions'; familyId: string }
  );
export interface LibraryGraphCounts {
  uniqueFamilyCount: number;
  readableVersionCountInMatchingFamilies: number;
}
export interface LibraryGraphCluster extends LibraryGraphCounts {
  kind: 'CLASSIFICATION';
  /** null means missing classification; empty strings remain exact values. */
  value: string | null;
}
export interface LibraryGraphFamily {
  kind: 'FAMILY';
  familyId: string;
  documentId: string;
  documentCode: string;
  normalizedFamily: string;
  readableVersionCount: number;
}
export interface LibraryGraphVersion {
  kind: 'VERSION';
  documentVersionId: string;
  businessRevision: string;
  committedAt: string;
  isCurrent: boolean;
}
interface LibraryGraphResponseBase {
  scope: 'CURRENT_USER_DOCUMENT_CATALOG';
  versionMeaning: 'ALL_READABLE_VERSIONS';
  consistency: 'LIVE_READ';
  relationMeaning: 'CLASSIFICATION_AND_CONTAINMENT_ONLY';
  coverage: {
    documentReferences: 'NOT_INDEXED';
    matterMemberships: 'NOT_LOADED';
  };
  counts: LibraryGraphCounts;
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  fileReadPerformed: false;
  modelRunPerformed: false;
}
export type CanonicalLibraryGraphResponse = LibraryGraphResponseBase &
  (
    | {
        level: 'clusters';
        groupBy: LibraryGraphGroupBy;
        filters: LibraryGraphFilters;
        countScope: 'FILTERED_FAMILIES';
        clusterCountsOverlap: boolean;
        items: LibraryGraphCluster[];
      }
    | {
        level: 'families';
        groupBy: LibraryGraphGroupBy;
        clusterValue: string | null;
        filters: LibraryGraphFilters;
        countScope: 'FILTERED_CLUSTER_FAMILIES';
        items: LibraryGraphFamily[];
      }
    | {
        level: 'versions';
        familyId: string;
        countScope: 'SELECTED_FAMILY_FRESH_READ';
        items: LibraryGraphVersion[];
      }
  );
export type LibraryGraphErrorCode =
  | 'LIBRARY_GRAPH_REQUEST_INVALID'
  | 'LIBRARY_GRAPH_CURSOR_INVALID'
  | 'LIBRARY_GRAPH_DATA_LIMIT_EXCEEDED';
