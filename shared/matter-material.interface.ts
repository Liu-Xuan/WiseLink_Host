/** Material semantics are independent of the legacy WorkItem navigation roles. */
export interface MatterMaterialBasis {
  documentVersionId: string;
  sourceRefId: string;
}

export interface MatterMaterialContext {
  materialId: string;
  scope: string;
  contribution: string;
  basis: MatterMaterialBasis[];
  origin: 'DOCUMENT' | 'ENGINEER' | 'DEFAULT_INTAKE';
  /** Explicit corrections survive repeated discovery of the same source. */
  disposition: 'INCLUDED' | 'EXCLUDED';
}

export type MatterMaterialLink = MatterMaterialContext &
  (
    | {
        kind: 'MEMBER' | 'RELATED';
        familyId: string;
        documentVersionId: string;
      }
    | {
        kind: 'EXPECTED';
        familyId: null;
        documentVersionId: null;
        expected: {
          issuer: string | null;
          documentNumber: string | null;
          description: string;
          expectedContribution: string;
          expectedDate: string | null;
          sourceAsOf: string;
          publicationStatus:
            | 'PLANNED'
            | 'REPORTED_PUBLISHED'
            | 'CANCELLED'
            | 'UNKNOWN';
          acquisitionStatus: 'NOT_ACQUIRED' | 'PARTIALLY_ACQUIRED' | 'ACQUIRED';
          /** Matching is explicit and many-to-many; no synthetic source identity. */
          fulfilledBy: Array<{
            familyId: string;
            documentVersionId: string;
            scope: string;
          }>;
        };
      }
  );

export interface ReviseMatterMaterialsRequest {
  requestId: string;
  expectedMatterRevision: number;
  changeSummary: string;
  /** Full replacements by stable materialId; omitted links remain unchanged. */
  upserts: MatterMaterialLink[];
}

export interface MatterMaterialsReadModel {
  matterId: string;
  matterRevisionId: string;
  matterRevision: number;
  materials: MatterMaterialLink[];
}
