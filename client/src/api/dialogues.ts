import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  AppendDialogueMessageRequest,
  CreateDialogueRequest,
  DialogueThreadReadModel,
  SaveDialogueContributionRequest,
  WithdrawDialogueContributionRequest,
  DialogueWorkingContext,
  RequestDialogueAssessment,
  DialogueAssessmentResponse,
} from '@shared/dialogue.interface';
import {
  getCanonicalHostClientSessionGeneration,
  requireCanonicalHostClientAuthentication,
} from './canonical-host';

export interface DialogueClientError extends Error {
  statusCode?: number;
}

const path = (ref: string): string =>
  `/api/dialogues/${encodeURIComponent(ref)}`;

export const resumeDialogueMessage = (
  ref: string,
  messageRef: string,
  signal?: AbortSignal,
) =>
  request(
    `${path(ref)}/messages/${encodeURIComponent(messageRef)}/resume`,
    'POST',
    undefined,
    signal,
    ref,
  );
export async function readDialogueContext(
  ref: string,
  workItemId: string,
  signal?: AbortSignal,
) {
  const contexts = await requestPayload<DialogueWorkingContext[]>(
    `${path(ref)}/context`,
    'GET',
    undefined,
    signal,
    { workItemId },
  );
  if (
    !Array.isArray(contexts) ||
    contexts.length !== 1 ||
    contexts[0].workItemId !== workItemId
  )
    throw failure(403, getCanonicalHostClientSessionGeneration());
  return contexts[0];
}
export async function requestDialogueAssessment(
  ref: string,
  data: RequestDialogueAssessment,
  signal?: AbortSignal,
) {
  const result = await requestPayload<DialogueAssessmentResponse>(
    `${path(ref)}/assessment-requests`,
    'POST',
    data,
    signal,
  );
  if (
    result.workItemId !== data.workItemId ||
    !result.reviewTurnId ||
    !result.reviewConversationId
  )
    throw failure(403, getCanonicalHostClientSessionGeneration());
  return result;
}

export const createDialogue = (
  data: CreateDialogueRequest,
  signal?: AbortSignal,
) => request('/api/dialogues', 'POST', data, signal);
export const readDialogue = (
  ref: string,
  signal?: AbortSignal,
  beforeMessageRef?: string,
) => request(path(ref), 'GET', undefined, signal, ref, beforeMessageRef);
export const appendDialogue = (
  ref: string,
  data: AppendDialogueMessageRequest,
  signal?: AbortSignal,
) => request(`${path(ref)}/messages`, 'POST', data, signal, ref);
export const saveDialogueContribution = (
  ref: string,
  data: SaveDialogueContributionRequest,
  signal?: AbortSignal,
) => request(`${path(ref)}/contributions`, 'POST', data, signal, ref);
export const withdrawDialogueContribution = (
  ref: string,
  contributionRef: string,
  data: WithdrawDialogueContributionRequest,
  signal?: AbortSignal,
) =>
  request(
    `${path(ref)}/contributions/${encodeURIComponent(contributionRef)}/withdraw`,
    'POST',
    data,
    signal,
    ref,
  );

async function request(
  url: string,
  method: 'GET' | 'POST',
  data?: unknown,
  signal?: AbortSignal,
  ref?: string,
  beforeMessageRef?: string,
): Promise<DialogueThreadReadModel> {
  const thread = await requestPayload<DialogueThreadReadModel>(
    url,
    method,
    data,
    signal,
    beforeMessageRef ? { beforeMessageRef } : undefined,
  );
  if (
    !thread ||
    thread.audience !== 'PRIVATE' ||
    (ref && thread.threadRef !== ref) ||
    !Array.isArray(thread.messages) ||
    !Array.isArray(thread.contributions) ||
    thread.messages.some((m) => m.threadRef !== thread.threadRef) ||
    thread.contributions.some(
      (c) => c.threadRef !== thread.threadRef || c.audience !== 'PRIVATE',
    )
  )
    throw failure(403, getCanonicalHostClientSessionGeneration());
  return thread;
}

async function requestPayload<T>(
  url: string,
  method: 'GET' | 'POST',
  data?: unknown,
  signal?: AbortSignal,
  params?: object,
): Promise<T> {
  const generation: number = getCanonicalHostClientSessionGeneration();
  try {
    const response = await axiosForBackend<T>({
      url,
      method,
      data,
      signal,
      params,
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (response.status < 200 || response.status >= 300)
      throw failure(response.status, generation);
    if (
      generation !== getCanonicalHostClientSessionGeneration() ||
      signal?.aborted
    )
      throw new Error('登录或页面状态已变化，本次读回已失效。');
    return response.data;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'response' in error) {
      const response: unknown = error.response;
      if (response && typeof response === 'object' && 'status' in response)
        throw failure(Number(response.status), generation);
    }
    throw error;
  }
}

function failure(statusCode: number, generation: number): DialogueClientError {
  if (statusCode === 401) requireCanonicalHostClientAuthentication(generation);
  const message: string =
    statusCode === 401
      ? '登录已失效，请重新登录。'
      : statusCode === 403 || statusCode === 404
        ? '对话不存在或访问权限已失效，已清除内容。'
        : statusCode === 409
          ? '对话已经变化，请刷新并核对后重新操作。'
          : `请求未完成（${statusCode}）。请保留当前操作并重试。`;
  return Object.assign(new Error(message), { statusCode });
}
