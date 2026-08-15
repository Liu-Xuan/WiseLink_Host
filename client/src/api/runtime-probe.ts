import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

import type { FileServiceP0ProbeResponse } from '@shared/api.interface';

export interface ReadOnlyProbeResult {
  path: string;
  status: number;
  body: unknown;
}

export interface FirstFtdVerticalResult {
  path: string;
  status: number;
  code: string | null;
  body: unknown;
  requestId: string | null;
  traceId: string | null;
  ok: boolean;
}

export interface FileServiceP0ProbeResult {
  path: string;
  status: number;
  code: string | null;
  body: FileServiceP0ProbeResponse | unknown;
  requestId: string | null;
  traceId: string | null;
  ok: boolean;
}

const FIRST_FTD_VERTICAL_PATH =
  '/api/canonical-host/work-items/parse-pdf';
const FIRST_FTD_VERTICAL_BODY = Object.freeze({
  selection: Object.freeze({
    bucketId: 'bucket_aadkprardjghu',
    filePath: '/1873430479421449.pdf',
  }),
  query: 'software',
});
const FILE_SERVICE_P0_PROBE_PATH =
  '/api/runtime-probe/file-service-upload';

export async function getReadOnlyRuntimeProbe(): Promise<ReadOnlyProbeResult[]> {
  const paths = [
    '/api/runtime-probe',
    '/api/unified-reader/readiness',
    '/api/sb-job-aid/registrar-activation/readiness',
  ];

  const results: ReadOnlyProbeResult[] = [];
  for (const path of paths) {
    const response = await axiosForBackend<unknown>({
      url: path,
      method: 'GET',
    });
    results.push({ path, status: response.status, body: response.data });
  }
  return results;
}

export async function runFirstFtdVertical(): Promise<FirstFtdVerticalResult> {
  try {
    const response = await axiosForBackend<unknown>({
      url: FIRST_FTD_VERTICAL_PATH,
      method: 'POST',
      data: FIRST_FTD_VERTICAL_BODY,
      meta: { autoJumpToLogin: false },
    });
    const code = responseCode(response.data);
    const ok = response.status >= 200 && response.status < 300;
    return {
      path: FIRST_FTD_VERTICAL_PATH,
      status: response.status,
      code,
      body: response.data,
      requestId: header(response.headers, 'x-request-id'),
      traceId: header(response.headers, 'x-log-trace-id'),
      ok,
    };
  } catch (cause: unknown) {
    const response = asBackendError(cause).response;
    return {
      path: FIRST_FTD_VERTICAL_PATH,
      status: response?.status ?? 0,
      code: responseCode(response?.data),
      body: response?.data ?? { message: errorMessage(cause) },
      requestId: header(response?.headers, 'x-request-id'),
      traceId: header(response?.headers, 'x-log-trace-id'),
      ok: false,
    };
  }
}

export async function runFileServiceP0Probe(): Promise<FileServiceP0ProbeResult> {
  try {
    const response = await axiosForBackend<FileServiceP0ProbeResponse>({
      url: FILE_SERVICE_P0_PROBE_PATH,
      method: 'POST',
      meta: { autoJumpToLogin: false },
    });
    return {
      path: FILE_SERVICE_P0_PROBE_PATH,
      status: response.status,
      code: responseCode(response.data),
      body: response.data,
      requestId: header(response.headers, 'x-request-id'),
      traceId: header(response.headers, 'x-log-trace-id'),
      ok: response.status >= 200 && response.status < 300,
    };
  } catch (cause: unknown) {
    const response = asBackendError(cause).response;
    return {
      path: FILE_SERVICE_P0_PROBE_PATH,
      status: response?.status ?? 0,
      code: responseCode(response?.data),
      body: response?.data ?? { message: errorMessage(cause) },
      requestId: header(response?.headers, 'x-request-id'),
      traceId: header(response?.headers, 'x-log-trace-id'),
      ok: false,
    };
  }
}

interface BackendErrorResponse {
  status?: number;
  data?: unknown;
  headers?: unknown;
}

function asBackendError(value: unknown): { response?: BackendErrorResponse } {
  return value && typeof value === 'object'
    ? (value as { response?: BackendErrorResponse })
    : {};
}

function responseCode(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0 ? code : null;
}

function header(value: unknown, name: string): string | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = (value as Record<string, unknown>)[name];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : 'FIRST_FTD_VERTICAL_REQUEST_FAILED';
}
