import type { CanonicalLibraryDocumentSummary } from '@shared/api.interface';
import type { CanonicalLibraryFleetCatalog } from '@shared/library-fleet.interface';
import {
  documentClassificationValues,
  type LibraryCatalogFilters,
  type LibraryHierarchyGroup,
} from './library-classification';

const normalized = (value: string): string => value.trim().toUpperCase();

export function matchesLibraryFleet(
  document: CanonicalLibraryDocumentSummary,
  catalog: CanonicalLibraryFleetCatalog | null,
  filters: LibraryCatalogFilters,
): boolean {
  if (!filters.fleetFamily && !filters.fleetModel) return true;
  const family =
    catalog?.status === 'AVAILABLE'
      ? catalog.families.find(
          (item) =>
            normalized(item.fleetFamily) ===
            normalized(filters.fleetFamily ?? ''),
        )
      : undefined;
  if (!family) return false;
  const values = documentClassificationValues(document, 'aircraft').map(
    normalized,
  );
  if (filters.fleetModel)
    return (
      family.models.some(
        (model) => normalized(model) === normalized(filters.fleetModel ?? ''),
      ) && values.includes(normalized(filters.fleetModel))
    );
  return [family.fleetFamily, ...family.models].some((value) =>
    values.includes(normalized(value)),
  );
}

export function libraryFleetBranches(
  documents: CanonicalLibraryDocumentSummary[],
  catalog: CanonicalLibraryFleetCatalog | null,
  filters: LibraryCatalogFilters,
  path: LibraryCatalogFilters,
  next: (
    items: CanonicalLibraryDocumentSummary[],
    path: LibraryCatalogFilters,
  ) => LibraryHierarchyGroup[],
): LibraryHierarchyGroup[] {
  const groups: LibraryHierarchyGroup[] = [];
  const assigned = new Set<string>();
  for (const family of catalog?.status === 'AVAILABLE'
    ? catalog.families
    : []) {
    if (
      filters.fleetFamily &&
      normalized(filters.fleetFamily) !== normalized(family.fleetFamily)
    )
      continue;
    const familyPath = {
      ...path,
      aircraftModel: '',
      fleetFamily: family.fleetFamily,
      fleetModel: '',
    };
    const members = documents.filter((document) =>
      matchesLibraryFleet(document, catalog, familyPath),
    );
    if (!members.length) continue;
    members.forEach((document) => assigned.add(document.familyId));
    const children: LibraryHierarchyGroup[] = [];
    const modelAssigned = new Set<string>();
    for (const model of family.models) {
      if (
        filters.fleetModel &&
        normalized(filters.fleetModel) !== normalized(model)
      )
        continue;
      const modelPath = { ...familyPath, fleetModel: model };
      const items = members.filter((document) =>
        matchesLibraryFleet(document, catalog, modelPath),
      );
      items.forEach((document) => modelAssigned.add(document.familyId));
      if (items.length)
        children.push({
          key: model,
          label: model,
          documents: items,
          dimension: 'aircraft',
          pathFilters: modelPath,
          children: next(items, modelPath),
        });
    }
    const broad = members.filter(
      (document) => !modelAssigned.has(document.familyId),
    );
    if (broad.length && !filters.fleetModel)
      children.push({
        key: '__FAMILY_MENTION__',
        label: '仅提及父机型（未细分）',
        documents: broad,
        dimension: 'aircraft',
        pathFilters: familyPath,
        children: next(broad, familyPath),
      });
    groups.push({
      key: family.fleetFamily,
      label: family.fleetFamily,
      documents: members,
      dimension: 'aircraft',
      pathFilters: familyPath,
      children,
    });
  }
  const unassigned = documents.filter(
    (document) => !assigned.has(document.familyId),
  );
  if (unassigned.length && !filters.fleetFamily && !filters.fleetModel)
    groups.push({
      key: '__OUTSIDE_FLEET__',
      label: '未归入当前机队（资料保留）',
      documents: unassigned,
      dimension: 'aircraft',
      pathFilters: path,
      children: next(unassigned, path),
    });
  return groups;
}
