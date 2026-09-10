import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { DialogueThreadSummary } from '@shared/dialogue.interface';
import {
  getCanonicalHostClientSessionGeneration,
  requireCanonicalHostClientAuthentication,
} from './canonical-host';

export async function listDialogues(
  signal: AbortSignal,
  beforeThreadRef?: string,
  workItemId?: string,
): Promise<DialogueThreadSummary[]> {
  const generation = getCanonicalHostClientSessionGeneration();
  try {
    const result = await axiosForBackend<DialogueThreadSummary[]>({
      url: '/api/dialogues',
      method: 'GET',
      signal,
      params: { beforeThreadRef, workItemId },
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (
      signal.aborted ||
      generation !== getCanonicalHostClientSessionGeneration()
    )
      throw new Error('登录状态已变化');
    if (result.status !== 200 || !Array.isArray(result.data))
      throw new Error('会话列表读取失败');
    return result.data;
  } catch (reason: unknown) {
    const status = (reason as { response?: { status?: number } })?.response
      ?.status;
    if (status === 401) requireCanonicalHostClientAuthentication(generation);
    throw new Error(
      status === 401 ? '请重新登录后读取会话。' : '会话列表读取失败，请重试。',
    );
  }
}
