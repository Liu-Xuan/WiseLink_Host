import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  DocumentReadingRequest,
  DocumentReadingResponse,
} from '@shared/document-reading.interface';
import {
  getCanonicalHostClientSessionGeneration,
  requireCanonicalHostClientAuthentication,
} from './canonical-host';

export async function readDocumentWiki(
  input: DocumentReadingRequest,
  signal: AbortSignal,
): Promise<DocumentReadingResponse> {
  const session = getCanonicalHostClientSessionGeneration();
  try {
    const response = await axiosForBackend<DocumentReadingResponse>({
      url: `/api/document-management/document-versions/${encodeURIComponent(input.documentVersionId)}/document-reading`,
      params: {
        parseRunId: input.parseRunId,
        semanticRevision: input.semanticRevision,
        readingRevision: input.readingRevision,
      },
      signal,
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (session !== getCanonicalHostClientSessionGeneration())
      throw new Error('DOCUMENT_WIKI_SESSION_CHANGED');
    const value = response.data;
    if (
      !value ||
      !['AVAILABLE', 'RETRACTED', 'NOT_GENERATED'].includes(value.status) ||
      value.sourceBinding?.original.documentVersionId !==
        input.documentVersionId ||
      value.sourceBinding.original.parseRunId !== input.parseRunId ||
      value.sourceBinding.semanticRevision !== input.semanticRevision ||
      (value.status === 'AVAILABLE') !== !!value.reading ||
      (value.reading &&
        input.readingRevision !== undefined &&
        value.reading.readingRevision !== input.readingRevision)
    )
      throw new Error('DOCUMENT_WIKI_BINDING_INVALID');
    return value;
  } catch (reason) {
    const response =
      typeof reason === 'object' && reason !== null && 'response' in reason
        ? (reason.response as { status?: number } | undefined)
        : undefined;
    if (response?.status === 401)
      requireCanonicalHostClientAuthentication(session);
    throw Object.assign(
      new Error(
        response?.status === 401
          ? '请先登录，再读取文档 Wiki。'
          : response?.status === 403 || response?.status === 404
            ? '该确切文档 Wiki 不可读取，已停止展示。'
            : '文档 Wiki 未能按确切版本读回，请重新核对。',
      ),
      { statusCode: response?.status },
    );
  }
}
