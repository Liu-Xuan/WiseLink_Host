import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  TdmsNativeReceiverBinding,
  TdmsUploadSelectionAssociationReceipt,
  TdmsUploadSelectionAssociationRequest,
  TdmsUploadSelectionPreflight,
} from '@shared/tdms-receiver.interface';

export function tdmsExpectedReceiverHeader(value: TdmsNativeReceiverBinding): string {
  const bytes: Uint8Array = new TextEncoder().encode(JSON.stringify(value));
  const encoded: string = btoa(Array.from(bytes, (byte: number) => String.fromCharCode(byte)).join(''))
    .replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
  if (encoded.length > 8192) throw tdmsNativeError('TDMS_NATIVE_RECEIVER_HEADER_TOO_LARGE', 400);
  return encoded;
}

export function tdmsNativeError(code: string, statusCode = 503): Error & {
  code: string; statusCode: number;
} {
  return Object.assign(new Error(code), { code, statusCode });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The native caller cannot use this bridge as an arbitrary authenticated proxy. */
export function assertTdmsNativeRoute(route: string, method: 'GET' | 'POST'): void {
  const parsed: URL = new URL(route, 'https://wiselink.invalid');
  if (parsed.origin !== 'https://wiselink.invalid' || parsed.hash ||
      parsed.username || parsed.password || !route.startsWith('/api/'))
    throw tdmsNativeError('TDMS_NATIVE_ROUTE_FORBIDDEN', 400);
  const path: string = parsed.pathname;
  if (method === 'POST' && path === '/api/tdms-source-imports' && !parsed.search) return;
  if (method === 'GET' && path === '/api/tdms-source-imports/receiver/binding' &&
      [...parsed.searchParams.keys()].every((key: string) => key === 'receiverId') &&
      parsed.searchParams.getAll('receiverId').length <= 1) return;
  if (method === 'GET' && path === '/api/tdms-source-refs' &&
      [...parsed.searchParams.keys()].join() === 'sourceRef' &&
      parsed.searchParams.getAll('sourceRef').length === 1 &&
      /^TDMS:(SNAPSHOT|FIELD|RELATION|ARTIFACT):/u.test(parsed.searchParams.get('sourceRef') ?? '')) return;
  if (!parsed.search && (method === 'GET' || method === 'POST') &&
      /^\/api\/tdms-source-imports\/[A-Za-z0-9_-]{1,160}\/artifacts\/[A-Za-z0-9_-]{1,160}\/selection$/u.test(path)) return;
  if (method === 'POST' && !parsed.search &&
      /^\/api\/tdms-source-imports\/[A-Za-z0-9_-]{1,160}\/artifacts\/[A-Za-z0-9_-]{1,160}\/selection\/preflight$/u.test(path)) return;
  if (method === 'GET' && !parsed.search &&
      /^\/api\/tdms-source-imports\/[A-Za-z0-9_-]{1,160}$/u.test(path)) return;
  throw tdmsNativeError('TDMS_NATIVE_ROUTE_FORBIDDEN', 400);
}

export async function tdmsNativeRequest<T = unknown>(
  route: string, method: 'GET' | 'POST', body?: unknown, expectedReceiver?: TdmsNativeReceiverBinding,
): Promise<T> {
  assertTdmsNativeRoute(route, method);
  if (method === 'GET' && body !== undefined)
    throw tdmsNativeError('TDMS_NATIVE_GET_BODY_FORBIDDEN', 400);
  try {
    // Existing native gateway/CSRF handling stays inside the official client.
    const response = await axiosForBackend<T>({ url: route, method, data: body,
      timeout: 30_000, headers: { 'Cache-Control': 'no-cache',
        ...(expectedReceiver ? { 'X-WiseLink-TDMS-Expected-Receiver': tdmsExpectedReceiverHeader(expectedReceiver) } : {}) },
      meta: { autoJumpToLogin: false } });
    return response.data;
  } catch (reason: unknown) {
    const response: unknown = record(reason) ? reason.response : undefined;
    const data: unknown = record(response) ? response.data : undefined;
    const status: number = record(response) && typeof response.status === 'number'
      ? response.status : 503;
    const error: unknown = record(data) && record(data.error) ? data.error : data;
    const code: string = record(error) && typeof error.code === 'string' &&
      /^[A-Z0-9_]{1,160}$/u.test(error.code) ? error.code : 'TDMS_HOST_RECEIPT_UNKNOWN';
    throw tdmsNativeError(code, status);
  }
}

export function tdmsSelectionRoute(requestId: string, bindingId: string): string {
  const route: string = `/api/tdms-source-imports/${encodeURIComponent(requestId)}` +
    `/artifacts/${encodeURIComponent(bindingId)}/selection`;
  assertTdmsNativeRoute(route, 'GET');
  return route;
}

export function readTdmsNativeReceiver(receiverId?: string, expectedReceiver?: TdmsNativeReceiverBinding): Promise<TdmsNativeReceiverBinding> {
  return tdmsNativeRequest('/api/tdms-source-imports/receiver/binding' +
    (receiverId ? `?receiverId=${encodeURIComponent(receiverId)}` : ''), 'GET', undefined, expectedReceiver);
}

export function readTdmsUploadAssociation(
  requestId: string, bindingId: string, expectedReceiver?: TdmsNativeReceiverBinding,
): Promise<TdmsUploadSelectionAssociationReceipt> {
  return tdmsNativeRequest(tdmsSelectionRoute(requestId, bindingId), 'GET', undefined, expectedReceiver);
}

export function stageTdmsUploadAssociation(
  requestId: string, bindingId: string, input: TdmsUploadSelectionAssociationRequest, expectedReceiver?: TdmsNativeReceiverBinding,
): Promise<TdmsUploadSelectionAssociationReceipt> {
  return tdmsNativeRequest(tdmsSelectionRoute(requestId, bindingId), 'POST', input, expectedReceiver);
}

export function preflightTdmsUpload(
  requestId: string, bindingId: string, pkg: unknown, expectedReceiver?: TdmsNativeReceiverBinding,
): Promise<TdmsUploadSelectionPreflight> {
  return tdmsNativeRequest(tdmsSelectionRoute(requestId, bindingId) + '/preflight', 'POST', { package: pkg }, expectedReceiver);
}
