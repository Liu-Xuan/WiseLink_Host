import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  CreateDerivedSummaryRequest, DerivedSummaryReadModel, DerivedSummaryRequestReceipt,
  DerivedSummaryRequestStatus, DerivedSummaryRevision, RequestDerivedSummaryUpdate,
} from '@shared/derived-summary.interface';
import { getCanonicalHostClientSessionGeneration, requireCanonicalHostClientAuthentication } from './canonical-host';

const base = '/api/canonical-host/derived-summaries';
const path = (id: string) => `${base}/${encodeURIComponent(id)}`;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function requestError(statusCode: number, payload: unknown, session: number): Error {
  if (statusCode === 401) requireCanonicalHostClientAuthentication(session);
  const detail = record(payload) && record(payload.error) ? payload.error : payload;
  const rawCode = record(detail) ? detail.code ?? detail.message : null;
  const code = typeof rawCode === 'string' && /^[A-Z][A-Z0-9_:]{0,120}$/u.test(rawCode) ? rawCode : 'DERIVED_SUMMARY_REQUEST_FAILED';
  const message = statusCode === 401 ? '请先登录，再读取派生概述。'
    : statusCode === 403 || statusCode === 404 ? '概述或其保留来源不存在、不可读取或已无权访问；已停止展示正文。'
    : statusCode === 409 ? '概述版本或请求内容已有变化，请核对原请求与确切版本。'
    : `派生概述操作未完成（${code}），请重新核对。`;
  return Object.assign(new Error(message), { statusCode, code });
}

async function request<T>(url: string, method: 'GET' | 'POST', signal?: AbortSignal,
  data?: CreateDerivedSummaryRequest | RequestDerivedSummaryUpdate): Promise<T> {
  const session = getCanonicalHostClientSessionGeneration();
  try {
    const response = await axiosForBackend<T>({ url, method, signal, data, headers: { 'Cache-Control': 'no-cache' } });
    if (response.status < 200 || response.status >= 300) throw requestError(response.status, response.data, session);
    if (session !== getCanonicalHostClientSessionGeneration()) throw new Error('登录状态已变化，本次概述读回已失效。');
    return response.data;
  } catch (reason) {
    if (record(reason) && record(reason.response)) throw requestError(Number(reason.response.status), reason.response.data, session);
    throw reason;
  }
}

export const listDerivedSummaries = (signal?: AbortSignal) => request<DerivedSummaryReadModel[]>(base, 'GET', signal);
export async function readDerivedSummary(id: string, signal?: AbortSignal): Promise<DerivedSummaryReadModel> {
  const value = await request<DerivedSummaryReadModel>(path(id), 'GET', signal);
  if (value.summaryId !== id || value.classificationStatus !== 'CANDIDATE' || (value.current && (value.current.summaryId !== id || value.current.summaryRef !== value.currentSummaryRef || value.current.revision !== value.currentRevision || value.current.candidateOnly !== true)))
    throw new Error('概述指针与保存版本不一致，已停止展示。');
  return value;
}
export async function readDerivedSummaryRevision(id: string, ref: string, signal?: AbortSignal): Promise<DerivedSummaryRevision> {
  const value = await request<DerivedSummaryRevision>(`${path(id)}/revisions/${encodeURIComponent(ref)}`, 'GET', signal);
  if (value.summaryId !== id || value.summaryRef !== ref || value.candidateOnly !== true || value.classificationStatus !== 'CANDIDATE')
    throw new Error('概述的确切保存身份不一致，已停止展示。');
  return value;
}
export const createDerivedSummary = (input: CreateDerivedSummaryRequest) => request<DerivedSummaryRequestReceipt>(base, 'POST', undefined, input);
export async function updateDerivedSummary(id: string, input: RequestDerivedSummaryUpdate): Promise<DerivedSummaryRequestReceipt> {
  const value = await request<DerivedSummaryRequestReceipt>(`${path(id)}/requests`, 'POST', undefined, input);
  if (value.summaryId !== id) throw new Error('概述请求回执身份不一致，请用原请求核对。');
  return value;
}
export async function readDerivedSummaryRequest(id: string, attemptRef: string, signal?: AbortSignal): Promise<DerivedSummaryRequestStatus> {
  const value = await request<DerivedSummaryRequestStatus>(`${path(id)}/requests/${encodeURIComponent(attemptRef)}`, 'GET', signal);
  if (value.summaryId !== id || value.attemptRef !== attemptRef) throw new Error('概述请求状态身份不一致。');
  return value;
}
