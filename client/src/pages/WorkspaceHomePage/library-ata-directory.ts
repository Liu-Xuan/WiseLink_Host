import type { CanonicalLibraryDocumentSummary, CanonicalLibraryDocumentVersionSummary } from '@shared/api.interface';
import type { CanonicalLibraryFleetCatalog } from '@shared/library-fleet.interface';
import catalog from '@client/src/features/atlas/data/ata-catalog.json';
import { documentClassificationValues, type LibraryCatalogFilters } from './library-classification';
import { matchesLibraryFleet } from './library-fleet-classification';

export type AtaTitleScheme = keyof typeof catalog.schemes;
export interface AtaDirectoryItem {
  document: CanonicalLibraryDocumentSummary;
  version: CanonicalLibraryDocumentVersionSummary;
}
export interface AtaDirectoryNode {
  key: string;
  label: string;
  level: 'fleet' | 'model' | 'ata2' | 'ata4';
  items: AtaDirectoryItem[];
  children: AtaDirectoryNode[];
}

/** Only explicit ATA observations: never infer classification from a document number. */
export function ataDirectoryCode(value: string): { ata2: string; ata4: string | null } | null {
  const match = /^(\d{2})(?:-?(\d{2}))?(?:-?(\d{2}))?$/u.exec(value.trim());
  return match ? { ata2: match[1], ata4: match[2] ? `${match[1]}-${match[2]}` : null } : null;
}

/** Attachment namespaces remain separate; duplicate source rows retain their locators. */
export function ataDirectoryTitles(code: string, scheme: AtaTitleScheme) {
  const source = catalog.schemes[scheme];
  const rows = (code.length === 2 ? source.chapters : source.expanded).filter(row => row.code === code);
  const titles = new Map<string, { titleZH: string; titleEN: string; sources: string[] }>();
  for (const row of rows) {
    if (!row.titleZH && !row.titleEN) continue;
    const key = JSON.stringify([row.titleZH, row.titleEN]);
    const title = titles.get(key) ?? { titleZH: row.titleZH, titleEN: row.titleEN, sources: [] };
    const locator = `${row.file} · ${row.locator}`;
    if (!title.sources.includes(locator)) title.sources.push(locator);
    titles.set(key, title);
  }
  return [...titles.values()];
}

const unitDocument = (item: AtaDirectoryItem): CanonicalLibraryDocumentSummary => ({ ...item.document, versions: [item.version] });
const uniqueItems = (items: AtaDirectoryItem[]) => [...new Map(items.map(item => [JSON.stringify([item.document.familyId, item.version.documentVersionId]), item])).values()];
const node = (key: string, label: string, level: AtaDirectoryNode['level'], items: AtaDirectoryItem[], children: AtaDirectoryNode[] = []): AtaDirectoryNode => ({ key, label, level, items: uniqueItems(items), children });

function ataBranches(items: AtaDirectoryItem[]): AtaDirectoryNode[] {
  const chapters = new Map<string, Map<string, AtaDirectoryItem[]>>();
  for (const item of items) {
    const values = documentClassificationValues(unitDocument(item), 'ata');
    for (const value of values) {
      const code = ataDirectoryCode(value);
      const chapter = code?.ata2 ?? '__UNKNOWN__';
      const section = code?.ata4 ?? '__UNKNOWN__';
      const sections = chapters.get(chapter) ?? new Map<string, AtaDirectoryItem[]>();
      sections.set(section, uniqueItems([...(sections.get(section) ?? []), item]));
      chapters.set(chapter, sections);
    }
  }
  const sorted = <T,>(map: Map<string, T>) => [...map].sort(([a], [b]) => a === '__UNKNOWN__' ? 1 : b === '__UNKNOWN__' ? -1 : a.localeCompare(b));
  return sorted(chapters).map(([chapter, sections]) => node(chapter, chapter === '__UNKNOWN__' ? 'ATA 未分类' : `ATA2 ${chapter}`, 'ata2', [...sections.values()].flat(),
    sorted(sections).map(([section, members]) => node(section, section === '__UNKNOWN__' ? 'ATA4 未细分 / 待核' : `ATA4 ${section}`, 'ata4', members))));
}

/** Actor-authorized visible versions are the only membership input. Aircraft and ATA
 * must co-occur in that version; attachment titles do not add document memberships. */
export function buildLibraryAtaDirectory(documents: CanonicalLibraryDocumentSummary[], fleet: CanonicalLibraryFleetCatalog | null, filters: LibraryCatalogFilters = {}): AtaDirectoryNode[] {
  const items = uniqueItems(documents.flatMap(document => document.versions.map(version => ({ document, version }))))
    .filter(item => {
      const document = unitDocument(item);
      return matchesLibraryFleet(document, fleet, filters) && (['normalizedFamily', 'ata', 'aircraftModel'] as const).every(facet => {
        const selected = filters[facet];
        const grouping = facet === 'normalizedFamily' ? 'category' : facet === 'ata' ? 'ata' : 'aircraft';
        return !selected || documentClassificationValues(document, grouping).includes(selected);
      });
    });
  const roots: AtaDirectoryNode[] = [];
  const assigned = new Set<AtaDirectoryItem>();
  for (const family of fleet?.status === 'AVAILABLE' ? fleet.families : []) {
    if (filters.fleetFamily && filters.fleetFamily.trim().toUpperCase() !== family.fleetFamily.trim().toUpperCase()) continue;
    const familyPath = { fleetFamily: family.fleetFamily };
    const members = items.filter(item => matchesLibraryFleet(unitDocument(item), fleet, familyPath));
    if (!members.length) continue;
    members.forEach(item => assigned.add(item));
    const modelAssigned = new Set<AtaDirectoryItem>();
    const children: AtaDirectoryNode[] = [];
    for (const model of family.models) {
      if (filters.fleetModel && filters.fleetModel.trim().toUpperCase() !== model.trim().toUpperCase()) continue;
      const modelItems = members.filter(item => matchesLibraryFleet(unitDocument(item), fleet, { ...familyPath, fleetModel: model }));
      modelItems.forEach(item => modelAssigned.add(item));
      if (modelItems.length) children.push(node(model, model, 'model', modelItems, ataBranches(modelItems)));
    }
    const broad = members.filter(item => !modelAssigned.has(item));
    if (broad.length && !filters.fleetModel) children.push(node('__FAMILY_MENTION__', '仅提及父机型（未细分）', 'model', broad, ataBranches(broad)));
    roots.push(node(family.fleetFamily, family.fleetFamily, 'fleet', members, children));
  }
  const outside = items.filter(item => !assigned.has(item));
  if (outside.length && !filters.fleetFamily && !filters.fleetModel) roots.push(node('__OUTSIDE_FLEET__', '未归入当前机队（资料保留）', 'fleet', outside, ataBranches(outside)));
  return roots;
}
