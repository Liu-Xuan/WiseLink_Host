import {
  getCanonicalLibraryDocuments,
  getCanonicalLibraryQuicklook,
  readEngineeringKnowledgeWork,
} from '@client/src/api/canonical-host';
import type { DocumentParsingStatus } from '@shared/document-parsing.interface';
import type { CanonicalLibraryDocumentSummary, CanonicalLibraryQuicklookResponse } from '@shared/api.interface';
import type { EngineeringKnowledgeRead } from '@shared/engineering-issue-search.interface';

export interface DocumentReadingLinks {
  assessmentRoute: string | null;
  wikiRoute: string | null;
  assessmentNote: string;
  wikiNote: string;
  error: string | null;
  wikiError?: string | null;
  wikiLoading?: boolean;
  assessment?: CanonicalLibraryQuicklookResponse;
  knowledge?: EngineeringKnowledgeRead;
}

export const EMPTY_DOCUMENT_READING_LINKS: DocumentReadingLinks = {
  assessmentRoute: null,
  wikiRoute: null,
  assessmentNote: '此版本尚未关联评估工作',
  wikiNote: '暂无同版本已保存工程知识',
  error: null,
  wikiError: null,
  wikiLoading: false,
};

const DOCUMENT_READING_LINK_PAGE_SIZE = 50;
const DOCUMENT_READING_LINK_MAX_PAGES = 4;

/** Resolve the existing version/task binding before opening either saved view. */
export async function readDocumentReadingLinks(
  status: DocumentParsingStatus,
  signal: AbortSignal,
  onAssociation?: (links: DocumentReadingLinks) => void,
): Promise<DocumentReadingLinks> {
  const document = await readExactLibraryFamily(status, signal);
  const version = document?.versions.find((item) =>
    item.documentVersionId === status.documentVersionId);
  if (!version) throw new Error('资料库未返回此文档版本的评估关联，请刷新重试。');
  if (!version.readerWorkItemId) return EMPTY_DOCUMENT_READING_LINKS;
  const workItemId = version.readerWorkItemId;
  const saved = await getCanonicalLibraryQuicklook(workItemId, signal);
  if (signal.aborted) throw new Error('评估关联读取已取消。');
  if (saved.document.workItemId !== workItemId ||
      saved.document.documentVersionId !== status.documentVersionId ||
      saved.document.familyId !== status.familyId)
    throw new Error('评估关联与当前文档版本不一致，请刷新重试。');
  const reading = saved.result?.readingResult;
  if (reading && (reading.scope.kind !== 'WORK_ITEM' ||
      reading.scope.workItemId !== workItemId ||
      reading.scope.documentVersionId !== status.documentVersionId ||
      reading.resultRef !== saved.result?.sourceResultId || reading.resultRevision !== saved.result?.revision))
    throw new Error('评估正文与当前文档版本不一致，请刷新重试。');
  const links: DocumentReadingLinks = {
    ...EMPTY_DOCUMENT_READING_LINKS,
    assessment: saved,
    assessmentRoute: `/work-items/${encodeURIComponent(workItemId)}/analysis?${
      new URLSearchParams({ panel: 'assessment', documentVersionId: status.documentVersionId })}`,
    assessmentNote: saved.result ? '查看同版本评估工作' : '查看此版本关联的评估工作与运行状态',
  };
  const canReadWiki: boolean = Boolean(saved.result?.jobAidRoundCompletion && saved.result.readingResult);
  // The authorized association is useful before a saved result or Wiki exists.
  onAssociation?.({ ...links, wikiLoading: canReadWiki });
  // Only JobAid quicklook results carry an actual saved work revision. A legacy
  // Overall result id is not a Wiki workRef and must never be repurposed as one.
  if (!saved.result?.jobAidRoundCompletion || !saved.result.readingResult) return links;
  const workRef = saved.result.sourceResultId;
  const identity = { subjectKind: 'WORK_ITEM' as const, subjectId: workItemId, workRef };
  try {
    const wiki = await readEngineeringKnowledgeWork(identity, signal);
    const scope = wiki.reading?.scope;
    if (wiki.entry.subjectKind !== identity.subjectKind ||
        wiki.entry.subjectId !== workItemId || wiki.entry.workRef !== workRef ||
        wiki.entry.workRevision !== saved.result.revision ||
        wiki.reading?.resultRef !== workRef || wiki.reading.resultRevision !== saved.result.revision ||
        scope?.kind !== 'WORK_ITEM' || scope.workItemId !== workItemId ||
        scope.documentVersionId !== status.documentVersionId)
      throw new Error('工程知识关联与当前文档版本不一致，请刷新重试。');
    return {
      ...links,
      knowledge: wiki,
      wikiRoute: `/knowledge?${new URLSearchParams({ ...identity, scope: 'ALL' })}`,
      wikiNote: '阅读此评估工作版本的工程知识',
    };
  } catch (reason: unknown) {
    if (signal.aborted) throw reason;
    const message = reason instanceof Error ? reason.message : '工程知识读取未完成，请刷新重试。';
    const code = reason && typeof reason === 'object' && 'statusCode' in reason ? Number(reason.statusCode) : null;
    if (code === 401) throw reason;
    return { ...links, wikiNote: message, wikiError: message };
  }
}

async function readExactLibraryFamily(status: DocumentParsingStatus, signal: AbortSignal):
  Promise<CanonicalLibraryDocumentSummary | null> {
  let cursor: string | undefined;
  const visited: Set<string> = new Set();
  for (let page = 0; page < DOCUMENT_READING_LINK_MAX_PAGES; page++) {
    const catalogue = await getCanonicalLibraryDocuments({
      search: status.documentCode, normalizedFamily: status.normalizedFamily,
      limit: DOCUMENT_READING_LINK_PAGE_SIZE, cursor,
    }, signal);
    if (signal.aborted) throw new Error('评估关联读取已取消。');
    const document = catalogue.items.find((item) => item.familyId === status.familyId);
    if (document) return document;
    cursor = catalogue.nextCursor ?? undefined;
    if (!cursor) return null;
    if (cursor && visited.has(cursor)) throw new Error('评估关联目录分页未能推进，请刷新重试。');
    visited.add(cursor);
  }
  throw new Error('同文号资料较多，请返回文档目录核对关联评估。');
}
