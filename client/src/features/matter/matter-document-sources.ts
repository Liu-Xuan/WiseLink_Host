import type { EngineeringMatterCatalogEntry } from '@shared/api.interface';

/** Exact registered identity, not a synthetic WorkItem or a permission grant. */
export interface MatterDocumentSource {
  document: {
    documentVersionId: string;
    documentCode?: string;
    businessRevision?: string;
  };
  familyId?: string;
  catalogEntry?: EngineeringMatterCatalogEntry;
}

export function matterDocumentSourceLabel(source: MatterDocumentSource): string {
  return [source.document.documentCode, source.document.businessRevision].filter(Boolean).join(' · ')
    || source.document.documentVersionId;
}
