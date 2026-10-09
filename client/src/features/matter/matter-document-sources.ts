import type { EngineeringMatterCatalogEntry, EngineeringMatterReadModel } from '@shared/api.interface';

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

/**
 * Resolve current registered sources from an authorized matter response. Preserve
 * every exact version in stable registration order; never choose by timestamps or
 * replace a registered old version with the family's current version. Each source
 * still goes through the document endpoint's ACL before its content is read.
 * Saved work must use its saved input bindings, never this current resolver.
 */
export function selectMatterDocumentSources(
  matter: Pick<EngineeringMatterReadModel, 'materials' | 'catalog'>,
): MatterDocumentSource[] {
  const sources = new Map<string, MatterDocumentSource>();
  const materialVersions = new Set<string>();
  const catalog = new Map<string, EngineeringMatterCatalogEntry>();
  for (const entry of matter.catalog.entries) {
    const id = entry.document.documentVersionId;
    const previous = catalog.get(id);
    if (previous && previous.documentCurrentness.familyId !== entry.documentCurrentness.familyId) {
      throw new Error('同一准确版本的目录文档族身份冲突。');
    }
    if (!previous) catalog.set(id, entry);
  }
  const add = (documentVersionId: string, familyId: string) => {
    if (!documentVersionId) return;
    const existing = sources.get(documentVersionId);
    if (existing && existing.familyId !== familyId) throw new Error('同一准确版本的文档族身份冲突。');
    if (existing) return;
    const entry = catalog.get(documentVersionId);
    if (entry && entry.documentCurrentness.familyId !== familyId) {
      throw new Error('事项来源的文档族与准确版本不一致。');
    }
    sources.set(documentVersionId, {
      document: entry?.document ?? { documentVersionId },
      familyId,
      ...(entry ? { catalogEntry: entry } : {}),
    });
  };
  for (const material of matter.materials ?? []) {
    const identities = material.kind === 'EXPECTED' ? material.expected.fulfilledBy : [material];
    for (const source of identities) materialVersions.add(source.documentVersionId);
    if (material.disposition !== 'INCLUDED'
      || (material.kind === 'EXPECTED' && material.expected.acquisitionStatus === 'NOT_ACQUIRED')) continue;
    for (const source of identities) add(source.documentVersionId, source.familyId);
  }
  // An explicit material correction is not undone by an old WorkItem link.
  for (const entry of matter.catalog.entries) {
    if (materialVersions.has(entry.document.documentVersionId)) continue;
    add(entry.document.documentVersionId, entry.documentCurrentness.familyId);
  }
  return [...sources.values()];
}
