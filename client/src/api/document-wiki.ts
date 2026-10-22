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
    if (response.status < 200 || response.status >= 300)
      throw Object.assign(new Error('DOCUMENT_WIKI_READ_FAILED'), { statusCode: response.status });
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
        (value.reading.sourceBinding?.original.documentVersionId !== input.documentVersionId ||
          value.reading.sourceBinding.original.parseRunId !== input.parseRunId ||
          value.reading.sourceBinding.semanticRevision !== input.semanticRevision ||
          (input.readingRevision !== undefined && value.reading.readingRevision !== input.readingRevision)))
    )
      throw new Error('DOCUMENT_WIKI_BINDING_INVALID');
    return value;
  } catch (reason) {
    const response =
      typeof reason === 'object' && reason !== null && 'response' in reason
        ? (reason.response as { status?: number } | undefined)
        : undefined;
    const statusCode = response?.status ??
      (typeof reason === 'object' && reason !== null && 'statusCode' in reason &&
        typeof reason.statusCode === 'number' ? reason.statusCode : undefined);
    const code = typeof reason === 'object' && reason !== null && 'code' in reason &&
      typeof reason.code === 'string' ? reason.code : undefined;
    if (statusCode === 401)
      requireCanonicalHostClientAuthentication(session);
    throw Object.assign(
      new Error(
        statusCode === 401
          ? '请先登录，再读取文档 Wiki。'
          : statusCode === 403 || statusCode === 404
            ? '该确切文档 Wiki 不可读取，已停止展示。'
            : '文档 Wiki 未能按确切版本读回，请重新核对。',
      ),
      { statusCode, code },
    );
  }
}
