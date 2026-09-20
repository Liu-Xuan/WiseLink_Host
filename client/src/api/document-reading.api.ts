/**
 * Document Reading API - 文档解读 API 服务
 *
 * 提供文档解读相关的 API 调用
 */

import type { DocumentReadingBatchPreviewItem } from '../adapters/LibraryPageAdapter';

/**
 * 批量获取文档解读预览
 *
 * @param documentVersionIds - 文档版本ID列表
 * @returns 文档解读预览列表
 */
export async function fetchDocumentReadingsPreview(
  documentVersionIds: string[]
): Promise<DocumentReadingBatchPreviewItem[]> {
  if (!documentVersionIds || documentVersionIds.length === 0) {
    return [];
  }

  // 限制批量大小
  if (documentVersionIds.length > 100) {
    // Truncating to 100 document IDs
    documentVersionIds = documentVersionIds.slice(0, 100);
  }

  try {
    const ids = documentVersionIds.join(',');
    const response = await fetch(
      `/api/canonical-host/documents/readings/preview?documentVersionIds=${encodeURIComponent(ids)}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // 包含 Cookie
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('未授权，请先登录');
      }
      if (response.status === 400) {
        const error = await response.text();
        throw new Error(`请求参数错误: ${error}`);
      }
      throw new Error(`API 错误: ${response.status}`);
    }

    const data = await response.json();
    return data.readings || [];
  } catch (error) {
    console.error('Failed to fetch document readings:', error);
    // 返回空数组而不是抛出错误，保证页面可用
    return documentVersionIds.map(id => ({
      documentVersionId: id,
      parseRunId: null,
      semanticRevision: null,
      headline: null,
      briefSummary: null,
      status: 'NOT_GENERATED' as const,
    }));
  }
}

/**
 * 获取单个文档的完整解读
 *
 * @param documentVersionId - 文档版本ID
 * @param parseRunId - 解析运行ID
 * @param semanticRevision - 语义版本
 * @returns 完整的文档解读
 */
export async function fetchDocumentReading(
  documentVersionId: string,
  parseRunId: string,
  semanticRevision: number
): Promise<any> {
  const response = await fetch(
    `/api/document-management/document-versions/${encodeURIComponent(documentVersionId)}/document-reading?parseRunId=${encodeURIComponent(parseRunId)}&semanticRevision=${semanticRevision}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch document reading: ${response.status}`);
  }

  return response.json();
}
