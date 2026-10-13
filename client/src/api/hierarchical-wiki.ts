import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  HierarchicalWikiEnableRequest,
  HierarchicalWikiClassificationRequest,
  HierarchicalWikiList,
} from '@shared/hierarchical-wiki.interface';
import {
  getCanonicalHostClientSessionGeneration,
  requireCanonicalHostClientAuthentication,
} from './canonical-host';

const base = '/api/canonical-host/hierarchical-wiki';
type DelegationReceipt = {
  status: 'UPDATED';
  summaryId: string;
  matterId: string;
  enabled: boolean;
};
async function request<T = HierarchicalWikiList>(
  url: string,
  method: 'GET' | 'POST',
  signal?: AbortSignal,
  data?:
    | HierarchicalWikiEnableRequest
    | HierarchicalWikiClassificationRequest
    | { immediately?: boolean; enabled?: boolean }
    | { matterId: string; enabled: boolean },
  delegation = false,
): Promise<T> {
  const session = getCanonicalHostClientSessionGeneration();
  try {
    const response = await axiosForBackend<
      HierarchicalWikiList & DelegationReceipt
    >({ url, method, data, signal, headers: { 'Cache-Control': 'no-cache' } });
    if (session !== getCanonicalHostClientSessionGeneration())
      throw new Error('登录状态已变化，请重新读取Wiki。');
    const value = response.data;
    if (delegation) {
      if (
        value?.status !== 'UPDATED' ||
        typeof value.summaryId !== 'string' ||
        typeof value.matterId !== 'string' ||
        typeof value.enabled !== 'boolean'
      )
        throw new Error('WIKI_RESPONSE_INVALID');
      return value as T;
    }
    if (
      !value ||
      !Array.isArray(value.items) ||
      !Array.isArray(value.classifications) ||
      !Array.isArray(value.candidates) ||
      !(
        value.nextClassificationCursor === null ||
        typeof value.nextClassificationCursor === 'string'
      ) ||
      value.sourceCurrentness !== 'UNKNOWN'
    )
      throw new Error('WIKI_RESPONSE_INVALID');
    return value as T;
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
          ? '请先登录，再读取Wiki。'
          : response?.status === 403 || response?.status === 404
            ? 'Wiki或相关材料不可读取，已停止展示。'
            : 'Wiki操作未完成，请重新核对范围和材料。',
      ),
      { statusCode: response?.status },
    );
  }
}
export const listHierarchicalWiki = (signal?: AbortSignal, cursor?: string) =>
  request(
    cursor
      ? `${base}?${new URLSearchParams({ classificationCursor: cursor })}`
      : base,
    'GET',
    signal,
  );
export const enableHierarchicalWiki = (input: HierarchicalWikiEnableRequest) =>
  request(base, 'POST', undefined, input);
export const updateHierarchicalWiki = (
  id: string,
  input: { immediately?: boolean; enabled?: boolean },
) => request(`${base}/${encodeURIComponent(id)}`, 'POST', undefined, input);
export const classifyHierarchicalWiki = (
  id: string,
  input: HierarchicalWikiClassificationRequest,
) =>
  request(
    `${base}/${encodeURIComponent(id)}/classification`,
    'POST',
    undefined,
    input,
  );
export const delegateHierarchicalWikiMatter = (
  id: string,
  input: { matterId: string; enabled: boolean },
) =>
  request<DelegationReceipt>(
    `${base}/${encodeURIComponent(id)}/upstream-matter`,
    'POST',
    undefined,
    input,
    true,
  );
