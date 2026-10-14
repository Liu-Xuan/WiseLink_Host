import type { CanonicalLibraryDocumentSummary } from '@shared/api.interface';
import type { CanonicalLibraryFleetCatalog } from '@shared/library-fleet.interface';
import { libraryAircraftMentionAliases } from '@shared/library-aircraft-mentions';
import {
  documentClassificationValues,
  type LibraryCatalogFilters,
  type LibraryHierarchyGroup,
} from './library-classification';

const normalized = (value: string): string => value.trim().toUpperCase();

export interface LibraryAircraftBusinessGroup { key: string; label: string; models: string[] }
export const LIBRARY_PRIMARY_AIRCRAFT_GROUPS = ['737NG', '737MAX', '747-8', '747-400', '777-300ER', '787-9'];

/** Navigation over explicit source mentions; broad 737 is never guessed into NG/MAX. */
export function libraryAircraftBusinessGroup(value: string): string {
  const raw = normalized(value);
  const model = /^B7[0-8]7(?:[-\s]|MAX|NG|$)/u.test(raw) ? raw.slice(1) : raw;
  if (/^737-(?:600|700|800|900)(?:ER)?(?:\s*\/\s*(?:737-)?(?:600|700|800|900)(?:ER)?)*$/u.test(model) ||
      model === '737NG' || model === '737 NG') return '737NG';
  const max = model.replace(/[\s-]/gu, '');
  if (/^(?:737MAX(?:7|8|9|10)?|737(?:7|8|9|10)MAX)$/u.test(max)) return '737MAX';
  if (/^747-8(?:I|F)?$/u.test(model)) return '747-8';
  if (/^747-400(?:ER|ERF|F|BCF|D)?$/u.test(model)) return '747-400';
  const airbus = /^(A(?:318|319|320|321))-[0-9]{3}[A-Z]?(?:\s*\/\s*(?:\1-)?[0-9]{3}[A-Z]?)*$/u.exec(model);
  if (airbus) return airbus[1];
  return model;
}

export function libraryAircraftBusinessGroups(values: string[]): LibraryAircraftBusinessGroup[] {
  const groups = new Map<string, LibraryAircraftBusinessGroup>(LIBRARY_PRIMARY_AIRCRAFT_GROUPS
    .map((key: string) => [key, { key, label: key, models: [] }]));
  for (const raw of values) {
    if (!raw.trim()) continue;
    const key = libraryAircraftBusinessGroup(raw);
    const tokens = raw.split(/[\/;,、]/u).map((value: string) => value.trim());
    const keys = key === '737NG' || tokens.some((value: string) => !/^(?:B?7[0-8]7(?:[-\s][A-Z0-9-]+|MAX|NG)?|A[0-9]{3}(?:-[A-Z0-9]+)?)$/iu.test(value))
      ? [key] : [...new Set(tokens.map(libraryAircraftBusinessGroup))];
    for (const groupKey of keys) {
      const group = groups.get(groupKey) ?? { key: groupKey, label: groupKey === '__UNKNOWN__' ? '未取得机型' : groupKey === '737' ? '737（未细分）' : groupKey, models: [] };
      if (!group.models.includes(raw.trim())) group.models.push(raw.trim());
      groups.set(groupKey, group);
    }
  }
  return [...groups.values()].map((group: LibraryAircraftBusinessGroup) => ({ ...group, models: group.models.sort() }))
    .sort((a: LibraryAircraftBusinessGroup, b: LibraryAircraftBusinessGroup) => {
      const rank = (key: string): number => LIBRARY_PRIMARY_AIRCRAFT_GROUPS.includes(key) ? LIBRARY_PRIMARY_AIRCRAFT_GROUPS.indexOf(key) : 100;
      return rank(a.key) - rank(b.key) || a.key.localeCompare(b.key, 'zh-CN', { numeric: true });
    });
}

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
      ) &&
      libraryAircraftMentionAliases(filters.fleetModel).some((alias) =>
        values.includes(alias),
      )
    );
  return [family.fleetFamily, ...family.models].some((value) =>
    libraryAircraftMentionAliases(value).some((alias) =>
      values.includes(alias),
    ),
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
