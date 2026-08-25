import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalAeoCandidateRunResponse,
  CanonicalEntryQueryRequest,
  CanonicalEntryQueryResponse,
  CanonicalWorkItemProjection,
  CanonicalEngineerReviewDecision,
  CanonicalLibraryIndexReadResponse,
  CanonicalDevelopmentWorkItemRunRequest,
  CanonicalOrdinaryWorkItemRunResponse,
} from '@shared/api.interface';

import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

const DEFAULT_DOCUMENT_PARSING_QUERY = 'applicability';

export interface CanonicalHostIdentityContext {
  userId: string;
  tenantId: string;
  developmentIntakeAvailable?: boolean;
}

export async function getCanonicalHostIdentityContext(): Promise<CanonicalHostIdentityContext> {
  const response = await axiosForBackend<CanonicalHostIdentityContext>({
    url: '/api/canonical-host/identity-context',
    method: 'GET',
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('CANONICAL_HOST_IDENTITY_REQUIRED');
  }
  if (response.status < 200 || response.status >= 300) {
    throw backendResponseError(
      response.data,
      'CANONICAL_HOST_IDENTITY_UNAVAILABLE',
    );
  }
  return response.data;
}

export async function createDevelopmentWorkItem(
  input: CanonicalDevelopmentWorkItemRunRequest,
): Promise<CanonicalOrdinaryWorkItemRunResponse> {
  try {
    const response =
      await axiosForBackend<CanonicalOrdinaryWorkItemRunResponse>({
        url: '/api/canonical-host/work-items/development-runs',
        method: 'POST',
        data: input,
      });
    return response.data;
  } catch (error) {
    logger.error('创建隔离 DEV WorkItem 失败', error);
    throw error;
  }
}

export async function getLibraryIndex(
  workItemId: string,
): Promise<CanonicalLibraryIndexReadResponse> {
  try {
    const response = await axiosForBackend<CanonicalLibraryIndexReadResponse>({
      url: `/api/canonical-host/work-items/${encodeURIComponent(workItemId)}/library-index`,
      method: 'GET',
    });
    if (response.status === 401)
      throw new Error('CANONICAL_LIBRARY_LOGIN_REQUIRED');
    if (response.status === 403 || response.status === 404) {
      throw canonicalObjectNotFound();
    }
    if (response.status < 200 || response.status >= 300) {
      throw backendResponseError(
        response.data,
        'CANONICAL_LIBRARY_UNAVAILABLE',
      );
    }
    return response.data;
  } catch (error) {
    logger.error('读取 WorkItem LibraryIndex fresh projection 失败', error);
    throw normalizedDirectObjectError(error);
  }
}

export async function getDocumentParsingPage(
  workItemId: string,
  query: string,
): Promise<CanonicalDocumentParsingPageResponse> {
  try {
    const normalizedQuery = query.trim() || DEFAULT_DOCUMENT_PARSING_QUERY;
    const response =
      await axiosForBackend<CanonicalDocumentParsingPageResponse>({
        url: `/api/canonical-host/work-items/${encodeURIComponent(workItemId)}/document-parsing`,
        method: 'GET',
        params: { query: normalizedQuery },
      });
    if (response.status === 401) {
      throw new Error('CANONICAL_PAGE_LOGIN_REQUIRED');
    }
    if (response.status === 403 || response.status === 404) {
      throw canonicalObjectNotFound();
    }
    if (response.status < 200 || response.status >= 300) {
      throw backendResponseError(
        response.data,
        'CANONICAL_DOCUMENT_VIEW_UNAVAILABLE',
      );
    }
    return response.data;
  } catch (error) {
    logger.error('读取文档与解析 fresh projection 失败', error);
    throw normalizedDirectObjectError(error);
  }
}

function normalizedDirectObjectError(error: unknown): unknown {
  const status = responseStatus(error);
  if (status === 403 || status === 404) return canonicalObjectNotFound();
  return error;
}

export function isCanonicalObjectNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === 'CANONICAL_WORK_ITEM_NOT_FOUND';
}

function responseStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  const response = error.response;
  if (!isRecord(response)) return null;
  return typeof response.status === 'number' ? response.status : null;
}

function canonicalObjectNotFound(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function backendResponseError(data: unknown, fallback: string): Error {
  if (
    isRecord(data) &&
    typeof data.message === 'string' &&
    data.message.trim()
  ) {
    return new Error(data.message);
  }
  return new Error(fallback);
}

export async function recordEngineerReview(
  workItemId: string,
  input: {
    expectedRevision: number;
    criterionId: string;
    decision: CanonicalEngineerReviewDecision;
    comment: string;
  },
): Promise<CanonicalWorkItemProjection> {
  try {
    const response = await axiosForBackend<CanonicalWorkItemProjection>({
      url: `/api/canonical-host/work-items/${encodeURIComponent(workItemId)}/integrated-assessment/engineer-reviews`,
      method: 'POST',
      data: input,
    });
    if (response.status === 401) {
      throw new Error('ENGINEER_REVIEW_ACCESS_DENIED');
    }
    if (response.status === 403 || response.status === 404) {
      throw canonicalObjectNotFound();
    }
    return response.data;
  } catch (error) {
    logger.error('记录工程师逐项意见失败', error);
    throw normalizedDirectObjectError(error);
  }
}

export async function queryParsedUnits(
  request: CanonicalEntryQueryRequest,
): Promise<CanonicalEntryQueryResponse> {
  try {
    const response = await axiosForBackend<CanonicalEntryQueryResponse>({
      url: '/api/canonical-host/work-items/query-parsed-units',
      method: 'POST',
      data: request,
    });
    if (response.status === 401) {
      throw new Error('CANONICAL_QUERY_ACCESS_DENIED');
    }
    if (response.status === 403 || response.status === 404) {
      throw canonicalObjectNotFound();
    }
    return response.data;
  } catch (error) {
    logger.error('查询解析单元失败', error);
    throw normalizedDirectObjectError(error);
  }
}

export async function confirmIntegratedOverallForAeo(
  workItemId: string,
): Promise<CanonicalWorkItemProjection> {
  try {
    const response = await axiosForBackend<CanonicalWorkItemProjection>({
      url: `/api/canonical-host/work-items/${encodeURIComponent(workItemId)}/integrated-assessment/confirm-for-aeo`,
      method: 'POST',
      data: {},
    });
    if (response.status === 401) {
      throw new Error('OPENCLAW_OVERALL_CONFIRMATION_ACCESS_DENIED');
    }
    if (response.status === 403 || response.status === 404) {
      throw canonicalObjectNotFound();
    }
    return response.data;
  } catch (error) {
    logger.error('确认当前整体综合用于 AEO 失败', error);
    throw normalizedDirectObjectError(error);
  }
}

export async function generateAeoCandidate(
  workItemId: string,
): Promise<CanonicalAeoCandidateRunResponse> {
  try {
    const response = await axiosForBackend<CanonicalAeoCandidateRunResponse>({
      url: `/api/canonical-host/work-items/${encodeURIComponent(workItemId)}/aeo/candidate`,
      method: 'POST',
      data: {},
    });
    if (response.status === 401) {
      throw new Error('AEO_CANDIDATE_ACCESS_DENIED');
    }
    if (response.status === 403 || response.status === 404) {
      throw canonicalObjectNotFound();
    }
    return response.data;
  } catch (error) {
    logger.error('生成同一 WorkItem 的 AEO 候选失败', error);
    throw normalizedDirectObjectError(error);
  }
}
