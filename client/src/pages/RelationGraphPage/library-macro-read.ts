import type {
  CanonicalLibraryDocumentSummary,
  EngineeringMatterDirectoryResponse,
  EngineeringMatterReadModel,
} from '@shared/api.interface';
import type { CanonicalLibraryGraphRequest, LibraryGraphVersion } from '@shared/library-graph.interface';
import { getCanonicalLibraryDocuments, summarizeCanonicalDocumentReadFailure } from '@client/src/api/canonical-host';
import { getEngineeringMatter, getEngineeringMatterDirectory } from '@client/src/api/engineering-matter';
import { libraryGraphFilters } from './library-graph-route';
import { readLibraryGraphPage } from './library-graph-read';

// Bounded, transient reads of existing Host catalogs. No source extraction,
// explicit-preview (which persists a snapshot), model or business-write API.
export const LIBRARY_MACRO_BUDGET = { documentPages: 4, matterPages: 2, versions: 500, concurrency: 4 } as const;
export type MacroCoverage = 'COMPLETE' | 'PARTIAL' | 'READ_FAILED' | 'NOT_AUTHORIZED' | 'NOT_LOADED';
export interface LibraryMacroRead {
  documents: CanonicalLibraryDocumentSummary[];
  familyVersions?: { familyId: string; versions: LibraryGraphVersion[] };
  matters: EngineeringMatterReadModel[];
  coverage: { documents: MacroCoverage; matters: MacroCoverage; references: 'NOT_INDEXED' };
  issues: string[];
  matterFailures?: { unreadable: number; failed: number };
}
const invalid = () => new Error('图谱目录读回不一致，请重新读取。');
const aborted = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Aborted', 'AbortError'); };
const status = (reason: unknown) => summarizeCanonicalDocumentReadFailure(reason).statusCode;

export async function readLibraryMacro(request: CanonicalLibraryGraphRequest, signal: AbortSignal): Promise<LibraryMacroRead> {
  const read: LibraryMacroRead = { documents: [], matters: [], coverage: { documents: 'COMPLETE', matters: 'NOT_LOADED', references: 'NOT_INDEXED' }, issues: [] };
  // Old exact-family deep links remain valid. Their cursors belong to the old
  // endpoint, so start the same authorized scope afresh and load its levels together.
  if (request.level === 'versions') {
    const versions: LibraryGraphVersion[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < LIBRARY_MACRO_BUDGET.documentPages; page++) {
      aborted(signal);
      const response = await readLibraryGraphPage({ level: 'versions', familyId: request.familyId, limit: 50, cursor }, signal);
      if (response.level !== 'versions') throw invalid();
      if (response.items.some(item => versions.some(prior => prior.documentVersionId === item.documentVersionId))) throw invalid();
      versions.push(...response.items);
      cursor = response.nextCursor ?? undefined;
      if (!cursor) break;
      if (cursors.has(cursor)) throw invalid();
      cursors.add(cursor);
    }
    read.familyVersions = { familyId: request.familyId, versions };
    if (cursor) read.coverage.documents = 'PARTIAL';
  } else {
    const filters = libraryGraphFilters(request);
    if (request.level === 'families') {
      const key = request.groupBy === 'ata' ? 'ata' : 'normalizedFamily';
      if (!filters[key]) filters[key] = request.clusterValue ?? '__UNKNOWN__';
    }
    const ids = new Set<string>(), versionIds = new Set<string>(), cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < LIBRARY_MACRO_BUDGET.documentPages; page++) {
      aborted(signal);
      const response = await getCanonicalLibraryDocuments({ ...filters, cursor, limit: 50 }, signal);
      if (response.scope !== 'CURRENT_USER_DOCUMENT_CATALOG' || response.fileReadPerformed !== false || response.items.length > 50) throw invalid();
      for (const document of response.items) {
        if (!document.familyId || ids.has(document.familyId) || document.kind !== 'DOCUMENT' || !document.versions.length) throw invalid();
        const ownIds = document.versions.map(version => version.documentVersionId);
        if (ownIds.some(id => !id || versionIds.has(id)) || new Set(ownIds).size !== ownIds.length) throw invalid();
        if (versionIds.size + ownIds.length > LIBRARY_MACRO_BUDGET.versions) {
          read.coverage.documents = 'PARTIAL';
          read.issues.push('版本读取达到本次预算，文档族未拆分；显示已读取范围。');
          break;
        }
        ids.add(document.familyId);
        ownIds.forEach(id => versionIds.add(id));
        read.documents.push(document);
      }
      if (read.coverage.documents === 'PARTIAL') break;
      cursor = response.nextCursor ?? undefined;
      if (!cursor) break;
      if (cursors.has(cursor)) throw invalid();
      cursors.add(cursor);
    }
    if (cursor) read.coverage.documents = 'PARTIAL';
    // An empty raw classification cannot be expressed by the catalog's optional
    // filter. Keep the old explicit deep-link intent rather than treating it as all.
    if (request.level === 'families') {
      read.documents = read.documents.filter(document => {
        const values = request.groupBy === 'ata'
          ? document.versions.flatMap(version => version.extractedMetadata?.ata.observations.map(observation => observation.value) ?? [])
          : [document.normalizedFamily];
        return request.clusterValue === null ? !values.some(Boolean) : values.includes(request.clusterValue);
      });
    }
  }
  if (read.coverage.documents === 'PARTIAL') read.issues.push('资料目录部分读取；计数为当前画布对象数。');
  if (request.cursor) read.issues.push('旧分页入口已按相同范围重新读取；旧分页游标不用于宏观目录。');
  const directory: EngineeringMatterDirectoryResponse['items'] = [];
  try {
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < LIBRARY_MACRO_BUDGET.matterPages; page++) {
      aborted(signal);
      const response = await getEngineeringMatterDirectory({ limit: 50, cursor }, signal);
      if (response.fileReadPerformed !== false || response.items.length > 50 || new Set(response.items.map(item => item.matterId)).size !== response.items.length || response.items.some(item => !item.matterId || directory.some(prior => prior.matterId === item.matterId))) throw invalid();
      directory.push(...response.items);
      cursor = response.nextCursor ?? undefined;
      if (!cursor) break;
      if (cursors.has(cursor)) throw invalid();
      cursors.add(cursor);
    }
    read.coverage.matters = cursor ? 'PARTIAL' : 'COMPLETE';
  } catch (reason) {
    aborted(signal);
    if (status(reason) === 401) throw reason;
    read.coverage.matters = [403, 404].includes(status(reason) ?? 0) ? 'NOT_AUTHORIZED' : 'READ_FAILED';
    read.issues.push('事项目录未能读回。');
    return read;
  }
  for (let offset = 0; offset < directory.length; offset += LIBRARY_MACRO_BUDGET.concurrency) {
    aborted(signal);
    const results = await Promise.allSettled(directory.slice(offset, offset + LIBRARY_MACRO_BUDGET.concurrency).map(async item => {
      const matter = await getEngineeringMatter(item.matterId, signal);
      if (matter.matterId !== item.matterId || matter.currentRevision.matterRevisionId !== item.currentMatterRevisionId) throw invalid();
      return matter;
    }));
    for (const result of results) {
      if (result.status === 'fulfilled') read.matters.push(result.value);
      else {
        aborted(signal);
        if (status(result.reason) === 401) throw result.reason;
        const unavailable = [403, 404].includes(status(result.reason) ?? 0);
        read.matterFailures ??= { unreadable: 0, failed: 0 };
        read.matterFailures[unavailable ? 'unreadable' : 'failed']++;
        read.coverage.matters = unavailable ? 'NOT_AUTHORIZED' : 'READ_FAILED';
      }
    }
  }
  if (read.matterFailures?.unreadable) read.issues.push(`${read.matterFailures.unreadable} 项事项无权限或不可访问。`);
  if (read.matterFailures?.failed) read.issues.push(`${read.matterFailures.failed} 项事项读取失败或修订已变化。`);
  if (read.matterFailures?.unreadable && read.matterFailures.failed) read.coverage.matters = 'PARTIAL';
  if (read.coverage.matters !== 'COMPLETE') read.issues.push('部分事项未读回。');
  return read;
}
