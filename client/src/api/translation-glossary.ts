import type {
  TranslationGlossarySnapshot,
  UpdateTranslationGlossaryRequest,
} from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import {
  getCanonicalHostClientSessionGeneration,
  requireCanonicalHostClientAuthentication,
} from './canonical-host';

export interface TranslationGlossaryApiError extends Error {
  code?: string;
  statusCode?: number;
}

const GLOSSARY_URL = '/api/canonical-host/translation-glossary';

export async function readTranslationGlossary(): Promise<TranslationGlossarySnapshot> {
  return requestGlossary('GET');
}

export async function updateTranslationGlossary(
  input: UpdateTranslationGlossaryRequest,
): Promise<TranslationGlossarySnapshot> {
  return requestGlossary('PUT', input);
}

async function requestGlossary(
  method: 'GET' | 'PUT',
  data?: UpdateTranslationGlossaryRequest,
): Promise<TranslationGlossarySnapshot> {
  const generation: number = getCanonicalHostClientSessionGeneration();
  try {
    const response = await axiosForBackend<TranslationGlossarySnapshot>({
      url: GLOSSARY_URL,
      method,
      data,
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (response.status < 200 || response.status >= 300) {
      throw glossaryError(response.data, response.status);
    }
    return response.data;
  } catch (reason) {
    const status: number | undefined = statusOf(reason);
    if (status === 401) requireCanonicalHostClientAuthentication(generation);
    const responseData: unknown =
      isRecord(reason) && isRecord(reason.response)
        ? reason.response.data
        : reason;
    const error: TranslationGlossaryApiError = glossaryError(
      responseData,
      status,
    );
    logger.error('翻译术语表读取或保存失败', {
      method,
      code: error.code,
      statusCode: error.statusCode,
    });
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function statusOf(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.statusCode === 'number') return value.statusCode;
  if (isRecord(value.response) && typeof value.response.status === 'number') {
    return value.response.status;
  }
  return undefined;
}

function glossaryError(
  data: unknown,
  statusCode?: number,
): TranslationGlossaryApiError {
  const envelope: unknown =
    isRecord(data) && isRecord(data.error) ? data.error : data;
  const payload: Record<string, unknown> = isRecord(envelope) ? envelope : {};
  const code: string | undefined =
    typeof payload.code === 'string' ? payload.code : undefined;
  const message: string =
    typeof payload.message === 'string'
      ? payload.message
      : data instanceof Error
        ? data.message
        : '术语表请求失败，请重试。';
  const error: TranslationGlossaryApiError = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}
