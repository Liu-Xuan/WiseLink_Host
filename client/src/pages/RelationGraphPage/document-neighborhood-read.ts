import {
  getCanonicalLibraryQuicklook, getCanonicalLibraryTasks, getRelatedContextPreview,
  readDocumentParsingStatus, isCanonicalObjectNotFound, summarizeCanonicalDocumentReadFailure,
} from '@client/src/api/canonical-host';
import { getEngineeringMatterDirectory } from '@client/src/api/engineering-matter';
import type {
  CanonicalLibraryQuicklookResponse, CanonicalLibraryTasksResponse,
  CanonicalReferenceMentionPreviewItem, CanonicalRelatedContextPreviewResponse,
  EngineeringMatterDirectoryResponse,
} from '@shared/api.interface';
import type { DocumentParsingStatus } from '@shared/document-parsing.interface';

export const DOCUMENT_NEIGHBORHOOD_LIMITS = { familyRows: 20, matterRows: 20, mentions: 40 } as const;
export interface DocumentReferenceRead {
  mentions: CanonicalReferenceMentionPreviewItem[];
  totalMentionCount: number;
  receipt: Pick<CanonicalRelatedContextPreviewResponse['snapshot'],
    'snapshotRef' | 'workItemRef' | 'inputRevision' | 'primaryDocumentVersionRef' | 'availability'>;
}
export interface DocumentNeighborhoodRead {
  document: DocumentParsingStatus;
  quicklook: CanonicalLibraryQuicklookResponse | null;
  references: DocumentReferenceRead | null;
  family: CanonicalLibraryTasksResponse | null;
  matters: EngineeringMatterDirectoryResponse | null;
  notices: string[];
}
export interface DocumentNeighborhoodRequest {
  documentVersionId: string;
  readerWorkItemId?: string;
  familyCursor?: string;
  matterCursor?: string;
}

export function documentNeighborhoodAccessRejected(reason: unknown): boolean {
  return isCanonicalObjectNotFound(reason)
    || [401, 403, 404].includes(summarizeCanonicalDocumentReadFailure(reason).statusCode ?? 0);
}

/** Do not confuse current-number resolution with a verified historical cited revision. */
export function bindDocumentReferenceRead(
  preview: CanonicalRelatedContextPreviewResponse,
  quicklook: CanonicalLibraryQuicklookResponse,
): DocumentReferenceRead {
  const document = quicklook.document;
  if (preview.documentVersionId !== document.documentVersionId
    || preview.revision !== document.revision
    || preview.snapshot.workItemRef !== document.workItemId
    || preview.snapshot.inputRevision !== document.revision
    || preview.snapshot.primaryDocumentVersionRef !== document.documentVersionId
    || preview.mentions.some(mention => mention.primaryDocumentVersionRef !== document.documentVersionId)
    || preview.authority?.readOnly !== true || preview.authority.candidateOnly !== true
    || preview.authority.includedInAssessmentInput !== false
    || new Set(preview.mentions.map(mention => mention.mentionId)).size !== preview.mentions.length
    || !Number.isSafeInteger(preview.totalMentionCount) || preview.totalMentionCount < preview.mentions.length) {
    throw new Error('文档引用读回与所选准确版本或保存身份不一致。');
  }
  const snapshot = preview.snapshot;
  return {
    mentions: preview.mentions.slice(0, DOCUMENT_NEIGHBORHOOD_LIMITS.mentions),
    totalMentionCount: preview.totalMentionCount,
    receipt: { snapshotRef: snapshot.snapshotRef, workItemRef: snapshot.workItemRef,
      inputRevision: snapshot.inputRevision, primaryDocumentVersionRef: snapshot.primaryDocumentVersionRef,
      availability: snapshot.availability },
  };
}

/** Five bounded endpoint reads at most; never scans the document library or starts work/models. */
export async function readDocumentNeighborhood(
  request: DocumentNeighborhoodRequest,
  signal: AbortSignal,
): Promise<DocumentNeighborhoodRead> {
  const document = await readDocumentParsingStatus(request.documentVersionId, signal);
  if (document.documentVersionId !== request.documentVersionId || !document.familyId)
    throw new Error('文档身份读回不一致，未改用其他版本。');
  const notices: string[] = [];
  const partial = async <T>(load: () => Promise<T>, notice: string): Promise<T | null> => {
    try { return await load(); } catch (reason) {
      if (signal.aborted || documentNeighborhoodAccessRejected(reason)) throw reason;
      notices.push(notice);
      return null;
    }
  };
  const quicklook = request.readerWorkItemId
    ? await getCanonicalLibraryQuicklook(request.readerWorkItemId, signal) : null;
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (quicklook && (quicklook.document.workItemId !== request.readerWorkItemId
    || quicklook.document.documentVersionId !== document.documentVersionId
    || quicklook.document.familyId !== document.familyId)) {
    throw new Error('工作与所选文档版本不一致，未替换所选版本。');
  }
  const [family, matters, preview] = await Promise.all([
    partial(() => getCanonicalLibraryTasks({ familyId: document.familyId,
      limit: DOCUMENT_NEIGHBORHOOD_LIMITS.familyRows, cursor: request.familyCursor }, signal),
    '同族版本页读取失败；不代表没有其他版本。'),
    quicklook ? partial(() => getEngineeringMatterDirectory({ workItemId: quicklook.document.workItemId,
      limit: DOCUMENT_NEIGHBORHOOD_LIMITS.matterRows, cursor: request.matterCursor }, signal),
    '此工作关联的事项页读取失败；不代表没有关联事项。') : null,
    quicklook ? partial(() => getRelatedContextPreview(quicklook.document.workItemId,
      quicklook.document.revision, signal), '引用预览读取失败；保留准确文档，不宣称无引用。') : null,
  ]);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (family && (family.scope !== 'CURRENT_USER_OWNED_WORK_ITEMS'
    || family.items.length > DOCUMENT_NEIGHBORHOOD_LIMITS.familyRows
    || family.items.some(item => item.familyId !== document.familyId))) {
    throw new Error('同族版本页范围不一致，已停止显示。');
  }
  if (matters && matters.items.length > DOCUMENT_NEIGHBORHOOD_LIMITS.matterRows)
    throw new Error('事项关联页超出请求范围，已停止显示。');
  const references = preview && quicklook ? bindDocumentReferenceRead(preview, quicklook) : null;
  if (!quicklook) notices.push('未提供已核对的阅读工作：文档时间可读，工作引用与工作所属事项未接通。');
  notices.push('同族版本仅覆盖本页本人已登记工作，按准确版本去重；不代表完整出版版本史。');
  if (quicklook) notices.push('所属事项仅覆盖此阅读工作的当前登记关系；其他工作或原生材料归属未查询。');
  notices.push('引用出现位置与 Host 按文号匹配的版本候选分开显示；被引版次尚未核实。反向引用与版本附件接口尚未接通。');
  if (references && references.totalMentionCount > references.mentions.length)
    notices.push(`本图仅保留前 ${references.mentions.length} 条引用出现位置；引用接口尚无分页，不继续扫描。`);
  if (references?.receipt.availability !== 'AVAILABLE' && references)
    notices.push('引用来源覆盖不完整；未返回的关系不能解释为不存在。');
  return { document, quicklook, references, family, matters, notices };
}
