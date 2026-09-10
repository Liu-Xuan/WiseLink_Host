import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

import type {
  CreateEngineeringMatterRequest,
  CreateEngineeringMatterResponse,
  EngineeringMatterReadModel,
  EngineeringMatterDirectoryRequest,
  EngineeringMatterDirectoryResponse,
  LinkEngineeringMatterWorkItemRequest,
  LinkEngineeringMatterWorkItemResponse,
} from '@shared/api.interface';
import type { EngineeringMatterWorkingReadModel } from '@shared/matter-working.interface';
import type {
  MatterMaterialsReadModel,
  ReviseMatterMaterialsRequest,
} from '@shared/matter-material.interface';

import {
  getCanonicalHostClientSessionGeneration,
  requireCanonicalHostClientAuthentication,
} from './canonical-host';

export interface EngineeringMatterClientError extends Error {
  statusCode?: number;
  code?: string;
}

export interface EngineeringMatterWorkspaceRead {
  matter: EngineeringMatterReadModel;
  working: EngineeringMatterWorkingReadModel;
}

export async function getEngineeringMatterWorkspace(
  matterId: string,
  signal?: AbortSignal,
): Promise<EngineeringMatterWorkspaceRead> {
  const [matter, working]: [
    EngineeringMatterReadModel,
    EngineeringMatterWorkingReadModel,
  ] = await Promise.all([
    getEngineeringMatter(matterId, signal),
    getEngineeringMatterWorking(matterId, signal),
  ]);
  if (matter.matterId !== matterId || working.matterId !== matterId) {
    throw Object.assign(new Error('事项读回的范围不一致，请重新进入。'), {
      statusCode: 403,
    });
  }
  if (
    matter.currentRevision.matterRevisionId !== working.currentMatterRevisionId
  ) {
    throw Object.assign(new Error('关联资料在读取期间发生变化，请重新读取。'), {
      statusCode: 409,
    });
  }
  const result = working.current?.state.substantiveResult;
  if (
    result &&
    (result.scope.kind !== 'ENGINEERING_MATTER' ||
      result.scope.matterId !== matterId ||
      result.resultRef !== working.current?.substantiveResultRef ||
      result.resultRevision !== working.current?.substantiveResultRevision)
  )
    throw Object.assign(
      new Error('事项结果身份与工作记录不一致，已停止展示。'),
      { statusCode: 403 },
    );
  return { matter, working };
}

function matterPath(matterId: string): string {
  return `/api/canonical-host/engineering-matters/${encodeURIComponent(matterId)}`;
}

export function getEngineeringMatterDirectory(
  input: EngineeringMatterDirectoryRequest = {},
  signal?: AbortSignal,
): Promise<EngineeringMatterDirectoryResponse> {
  return requestEngineeringMatter(
    '/api/canonical-host/engineering-matters',
    'GET',
    undefined,
    signal,
    input,
  );
}

export async function getEngineeringMatter(
  matterId: string,
  signal?: AbortSignal,
): Promise<EngineeringMatterReadModel> {
  const matter: EngineeringMatterReadModel = await requestEngineeringMatter(
    matterPath(matterId),
    'GET',
    undefined,
    signal,
  );
  if (matter.matterId !== matterId) throw invalidMatterReadback();
  return matter;
}

export function getEngineeringMatterWorking(
  matterId: string,
  signal?: AbortSignal,
): Promise<EngineeringMatterWorkingReadModel> {
  return requestEngineeringMatter(
    `${matterPath(matterId)}/working`,
    'GET',
    undefined,
    signal,
  );
}

export async function createEngineeringMatter(
  input: CreateEngineeringMatterRequest,
): Promise<CreateEngineeringMatterResponse> {
  const response: CreateEngineeringMatterResponse =
    await requestEngineeringMatter(
      '/api/canonical-host/engineering-matters',
      'POST',
      input,
    );
  const primary = response.matter.catalog.entries.filter(
    (entry) => entry.relationRole === 'PRIMARY',
  );
  if (primary.length !== 1 || primary[0].workItemId !== input.primaryWorkItemId)
    throw invalidMatterReadback();
  return response;
}

export async function linkEngineeringMatterWorkItem(
  matterId: string,
  input: LinkEngineeringMatterWorkItemRequest,
): Promise<LinkEngineeringMatterWorkItemResponse> {
  const response: LinkEngineeringMatterWorkItemResponse =
    await requestEngineeringMatter(
      `${matterPath(matterId)}/work-items`,
      'POST',
      input,
    );
  if (
    response.matter.matterId !== matterId ||
    !response.matter.catalog.entries.some(
      (entry) => entry.workItemId === input.workItemId,
    )
  )
    throw invalidMatterReadback();
  return response;
}

function invalidMatterReadback(): EngineeringMatterClientError {
  return Object.assign(new Error('事项读回的范围不一致，请重新进入。'), {
    statusCode: 403,
  });
}

export async function reviseEngineeringMatterMaterials(
  matterId: string,
  input: ReviseMatterMaterialsRequest,
): Promise<MatterMaterialsReadModel> {
  const response: { materials: MatterMaterialsReadModel; replayed: boolean } =
    await requestEngineeringMatter(
      `${matterPath(matterId)}/materials`,
      'POST',
      input,
    );
  if (
    response.materials.matterId !== matterId ||
    response.materials.matterRevision !== input.expectedMatterRevision + 1 ||
    input.upserts.some(
      (expected) =>
        !response.materials.materials.some(
          (actual) =>
            actual.materialId === expected.materialId &&
            actual.kind === expected.kind &&
            actual.disposition === expected.disposition &&
            actual.scope === expected.scope &&
            actual.contribution === expected.contribution &&
            actual.origin === 'ENGINEER',
        ),
    )
  )
    throw invalidMatterReadback();
  return response.materials;
}

async function requestEngineeringMatter<T>(
  url: string,
  method: 'GET' | 'POST',
  data?:
    | CreateEngineeringMatterRequest
    | LinkEngineeringMatterWorkItemRequest
    | ReviseMatterMaterialsRequest,
  signal?: AbortSignal,
  params?: EngineeringMatterDirectoryRequest,
): Promise<T> {
  const session: number = getCanonicalHostClientSessionGeneration();
  try {
    const response = await axiosForBackend<T>({
      url,
      method,
      data,
      signal,
      params,
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (response.status < 200 || response.status >= 300) {
      throw matterRequestError(response.status, response.data, session);
    }
    if (session !== getCanonicalHostClientSessionGeneration())
      throw new Error('登录状态已变化，事项读回已失效。');
    return response.data;
  } catch (reason: unknown) {
    if (isMatterErrorRecord(reason) && isMatterErrorRecord(reason.response)) {
      const response: Record<string, unknown> = reason.response;
      throw matterRequestError(Number(response.status), response.data, session);
    }
    throw reason;
  }
}

function matterRequestError(
  statusCode: number,
  payload: unknown,
  session: number,
): EngineeringMatterClientError {
  if (statusCode === 401) requireCanonicalHostClientAuthentication(session);
  const body: Record<string, unknown> | null = isMatterErrorRecord(payload)
    ? payload
    : null;
  const detail: Record<string, unknown> | null = isMatterErrorRecord(
    body?.error,
  )
    ? body.error
    : body;
  const code: string =
    typeof detail?.code === 'string'
      ? detail.code
      : 'ENGINEERING_MATTER_REQUEST_FAILED';
  const message: string =
    statusCode === 401
      ? '请先登录，再读取当前事项。'
      : statusCode === 403 || statusCode === 404
        ? '当前事项不存在或已无权访问，请返回资料库。'
        : statusCode === 409
          ? '事项已更新，请重新读取后再操作。'
          : `事项操作未完成（${code}），请重试。`;
  return Object.assign(new Error(message), { statusCode, code });
}

function isMatterErrorRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
