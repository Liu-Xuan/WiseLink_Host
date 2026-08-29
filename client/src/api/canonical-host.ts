import type {
  AppendReviewTextTurnRequest,
  AppendReviewTextTurnResponse,
  CanonicalApplicabilitySelectionReadModel,
  CanonicalDocumentParsingPageResponse,
  CanonicalStructuredContentPageResponse,
  CanonicalAeoCandidateRunResponse,
  CanonicalEntryQueryRequest,
  CanonicalEntryQueryResponse,
  CanonicalWorkItemProjection,
  CanonicalEngineerReviewDecision,
  CanonicalLibraryIndexReadResponse,
  CanonicalDevelopmentWorkItemRunRequest,
  CanonicalOverallRegenerationReadModel,
  CanonicalOrdinaryWorkItemRunResponse,
  CloseReviewConversationResponse,
  ConfirmReviewActionDraftResponse,
  CreateOrResumeReviewConversationResponse,
  CurrentReviewConversationResponse,
  ConfigureCanonicalApplicabilitySelectionRequest,
  RequestCanonicalOverallRegenerationRequest,
  RequestCanonicalOverallRegenerationResponse,
} from '@shared/api.interface';

import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { resolveAppUrl } from '@lark-apaas/client-toolkit/utils/resolveAppUrl';

export interface CanonicalHostIdentityContext {
  userId: string;
  tenantId: string;
  developmentIntakeAvailable?: boolean;
}

interface OfficialOauthWhoamiResponse {
  authenticated?: boolean;
  verifiedIdentity?: unknown;
  session?: {
    provenance?: unknown;
  };
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

export async function requireOfficialOauthSession(): Promise<void> {
  const response = await axiosForBackend<OfficialOauthWhoamiResponse>({
    url: '/api/identity/whoami',
    method: 'GET',
  });
  if (
    response.status < 200 ||
    response.status >= 300 ||
    response.data.authenticated !== true ||
    !response.data.verifiedIdentity ||
    response.data.session?.provenance !== 'SERVER_OPAQUE_SESSION'
  ) {
    throw backendResponseError(
      response.data,
      'OFFICIAL_OAUTH_SESSION_REQUIRED',
    );
  }
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
    if (response.status < 200 || response.status >= 300) {
      throw backendResponseError(
        response.data,
        'CANONICAL_DEVELOPMENT_WORK_ITEM_CREATE_FAILED',
      );
    }
    return response.data;
  } catch (error) {
    logger.error('创建隔离 DEV WorkItem 失败', error);
    throw error;
  }
}

export async function retryDevelopmentWorkItem(
  workItemId: string,
): Promise<CanonicalOrdinaryWorkItemRunResponse> {
  try {
    const response =
      await axiosForBackend<CanonicalOrdinaryWorkItemRunResponse>({
        url: `/api/canonical-host/work-items/${encodeURIComponent(workItemId)}/retry-development-run`,
        method: 'POST',
      });
    if (response.status < 200 || response.status >= 300) {
      throw backendResponseError(
        response.data,
        'CANONICAL_DEVELOPMENT_WORK_ITEM_RETRY_FAILED',
      );
    }
    return response.data;
  } catch (error) {
    logger.error('重新解析既有 DEV WorkItem 失败', error);
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
  options: { freshness?: 'default' | 'mutation' } = {},
): Promise<CanonicalDocumentParsingPageResponse> {
  try {
    const normalizedQuery: string = query.trim();
    const mutationFreshRead: boolean = options.freshness === 'mutation';
    const params: Record<string, string> = {};
    if (normalizedQuery !== '') params.query = normalizedQuery;
    if (mutationFreshRead) params._fresh = crypto.randomUUID();
    const response =
      await axiosForBackend<CanonicalDocumentParsingPageResponse>({
        url: `/api/canonical-host/work-items/${encodeURIComponent(workItemId)}/document-parsing`,
        method: 'GET',
        ...(Object.keys(params).length === 0 ? {} : { params }),
        ...(mutationFreshRead
          ? {
              headers: {
                'Cache-Control': 'no-cache',
                Pragma: 'no-cache',
              },
            }
          : {}),
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

export async function requestOverallRegeneration(
  workItemId: string,
  input: RequestCanonicalOverallRegenerationRequest,
): Promise<RequestCanonicalOverallRegenerationResponse> {
  return overallRegenerationRequest<RequestCanonicalOverallRegenerationResponse>(
    {
      url: overallRegenerationUrl(workItemId),
      method: 'POST',
      data: input,
      operation: '请求重新生成工程摘要',
    },
  );
}

export async function getOverallRegenerationStatus(
  workItemId: string,
  requestId: string,
): Promise<CanonicalOverallRegenerationReadModel> {
  return overallRegenerationRequest<CanonicalOverallRegenerationReadModel>({
    url: `${overallRegenerationUrl(workItemId)}/${encodeURIComponent(
      requestId,
    )}`,
    method: 'GET',
    operation: '读取工程摘要生成进度',
  });
}

async function overallRegenerationRequest<T>(input: {
  url: string;
  method: 'GET' | 'POST';
  data?: RequestCanonicalOverallRegenerationRequest;
  operation: string;
}): Promise<T> {
  try {
    const response = await axiosForBackend<T>({
      url: input.url,
      method: input.method,
      ...(input.data === undefined ? {} : { data: input.data }),
    });
    if (response.status === 401) {
      throw new Error('OVERALL_REGENERATION_LOGIN_REQUIRED');
    }
    if (response.status === 403 || response.status === 404) {
      throw canonicalObjectNotFound();
    }
    if (response.status === 409) throw overallRegenerationConflict();
    if (response.status < 200 || response.status >= 300) {
      throw backendResponseError(
        response.data,
        'OVERALL_REGENERATION_UNAVAILABLE',
      );
    }
    return response.data;
  } catch (error) {
    logger.error(`${input.operation}失败`, error);
    throw normalizedOverallRegenerationError(error);
  }
}

function overallRegenerationUrl(workItemId: string): string {
  return `/api/canonical-host/work-items/${encodeURIComponent(
    workItemId,
  )}/integrated-assessment/overall-regeneration-requests`;
}

export async function getStructuredContentPage(
  workItemId: string,
  input: {
    cursor?: string;
    limit?: number;
    expectedRevision?: number;
  } = {},
): Promise<CanonicalStructuredContentPageResponse> {
  try {
    const params: Record<string, string | number> = {};
    if (input.cursor) params.cursor = input.cursor;
    if (input.limit !== undefined) params.limit = input.limit;
    if (input.expectedRevision !== undefined) {
      params.expectedRevision = input.expectedRevision;
    }
    const response =
      await axiosForBackend<CanonicalStructuredContentPageResponse>({
        url: `/api/canonical-host/work-items/${encodeURIComponent(workItemId)}/structured-content`,
        method: 'GET',
        ...(Object.keys(params).length === 0 ? {} : { params }),
      });
    if (response.status === 401) {
      throw new Error('STRUCTURED_CONTENT_LOGIN_REQUIRED');
    }
    if (response.status === 403 || response.status === 404) {
      throw canonicalObjectNotFound();
    }
    if (response.status < 200 || response.status >= 300) {
      throw backendResponseError(
        response.data,
        'STRUCTURED_CONTENT_UNAVAILABLE',
      );
    }
    return response.data;
  } catch (error) {
    logger.error('读取结构化内容分页失败', error);
    throw normalizedDirectObjectError(error);
  }
}

export function canonicalPdfPreviewUrl(
  workItemId: string,
  opaqueLocator: string,
): string {
  const normalizedWorkItemId: string = workItemId.trim();
  const normalizedLocator: string = opaqueLocator.trim();
  if (!normalizedWorkItemId || !normalizedLocator) {
    throw new Error('CANONICAL_PDF_PREVIEW_LOCATOR_INVALID');
  }
  return resolveAppUrl(
    `/api/canonical-host/work-items/${encodeURIComponent(
      normalizedWorkItemId,
    )}/pdf-preview/${encodeURIComponent(normalizedLocator)}`,
  );
}

export async function getApplicabilitySelection(
  workItemId: string,
): Promise<CanonicalApplicabilitySelectionReadModel> {
  return applicabilitySelectionRequest({
    workItemId,
    method: 'GET',
    operation: '读取当前飞机适用性选择',
  });
}

/**
 * The PUT response is deliberately followed by a fresh GET. The browser only
 * presents a saved selection after the authenticated Host readback succeeds.
 */
export async function configureApplicabilitySelection(
  workItemId: string,
  input: ConfigureCanonicalApplicabilitySelectionRequest,
): Promise<CanonicalApplicabilitySelectionReadModel> {
  await applicabilitySelectionRequest({
    workItemId,
    method: 'PUT',
    data: input,
    operation: '保存飞机适用性选择',
  });
  return getApplicabilitySelection(workItemId);
}

async function applicabilitySelectionRequest(input: {
  workItemId: string;
  method: 'GET' | 'PUT';
  data?: ConfigureCanonicalApplicabilitySelectionRequest;
  operation: string;
}): Promise<CanonicalApplicabilitySelectionReadModel> {
  try {
    const response =
      await axiosForBackend<CanonicalApplicabilitySelectionReadModel>({
        url: `/api/work-items/${encodeURIComponent(input.workItemId)}/applicability-selection`,
        method: input.method,
        ...(input.data === undefined ? {} : { data: input.data }),
      });
    if (response.status === 401) {
      throw new Error('APPLICABILITY_SELECTION_LOGIN_REQUIRED');
    }
    if (response.status === 403 || response.status === 404) {
      throw canonicalObjectNotFound();
    }
    if (response.status < 200 || response.status >= 300) {
      throw backendResponseError(
        response.data,
        'APPLICABILITY_SELECTION_UNAVAILABLE',
      );
    }
    return response.data;
  } catch (error) {
    logger.error(`${input.operation}失败`, error);
    throw normalizedApplicabilitySelectionError(error);
  }
}

export async function createOrResumeReviewConversation(
  workItemId: string,
): Promise<CreateOrResumeReviewConversationResponse> {
  return reviewConversationRequest<CreateOrResumeReviewConversationResponse>({
    url: reviewConversationCurrentUrl(workItemId),
    method: 'POST',
    data: {},
    operation: '开始或继续工程复核讨论',
  });
}

export async function getCurrentReviewConversation(
  workItemId: string,
): Promise<CurrentReviewConversationResponse> {
  return reviewConversationRequest<CurrentReviewConversationResponse>({
    url: reviewConversationCurrentUrl(workItemId),
    method: 'GET',
    operation: '读取当前工程复核讨论',
  });
}

/**
 * A named fresh read keeps UI reload actions explicit without introducing a
 * second client-side conversation store.
 */
export async function reloadReviewConversation(
  workItemId: string,
): Promise<CurrentReviewConversationResponse> {
  return getCurrentReviewConversation(workItemId);
}

export async function appendReviewTextTurn(
  workItemId: string,
  reviewConversationId: string,
  input: AppendReviewTextTurnRequest,
): Promise<AppendReviewTextTurnResponse> {
  return reviewConversationRequest<AppendReviewTextTurnResponse>({
    url: `${reviewConversationUrl(workItemId, reviewConversationId)}/turns`,
    method: 'POST',
    data: input,
    operation: '追加工程复核输入',
  });
}

export async function closeReviewConversation(
  workItemId: string,
  reviewConversationId: string,
): Promise<CloseReviewConversationResponse> {
  return reviewConversationRequest<CloseReviewConversationResponse>({
    url: `${reviewConversationUrl(workItemId, reviewConversationId)}/close`,
    method: 'POST',
    data: {},
    operation: '结束当前工程复核讨论',
  });
}

export async function confirmReviewActionDraft(
  workItemId: string,
  reviewConversationId: string,
  reviewTurnId: string,
): Promise<ConfirmReviewActionDraftResponse> {
  return reviewConversationRequest<ConfirmReviewActionDraftResponse>({
    url: `${reviewConversationUrl(workItemId, reviewConversationId)}/turns/${encodeURIComponent(reviewTurnId)}/confirm-draft`,
    method: 'POST',
    data: {},
    operation: '确认工程复核草稿',
  });
}

async function reviewConversationRequest<T>(input: {
  url: string;
  method: 'GET' | 'POST';
  data?: Record<string, never> | AppendReviewTextTurnRequest;
  operation: string;
}): Promise<T> {
  try {
    const response = await axiosForBackend<T>({
      url: input.url,
      method: input.method,
      ...(input.data === undefined ? {} : { data: input.data }),
    });
    if (response.status === 401) {
      throw new Error('REVIEW_CONVERSATION_LOGIN_REQUIRED');
    }
    if (response.status === 403 || response.status === 404) {
      throw canonicalObjectNotFound();
    }
    if (response.status < 200 || response.status >= 300) {
      throw backendResponseError(
        response.data,
        'REVIEW_CONVERSATION_UNAVAILABLE',
      );
    }
    return response.data;
  } catch (error) {
    logger.error(`${input.operation}失败`, error);
    throw normalizedDirectObjectError(error);
  }
}

function reviewConversationCurrentUrl(workItemId: string): string {
  return `/api/work-items/${encodeURIComponent(workItemId)}/review-conversations/current`;
}

function reviewConversationUrl(
  workItemId: string,
  reviewConversationId: string,
): string {
  return `/api/work-items/${encodeURIComponent(workItemId)}/review-conversations/${encodeURIComponent(reviewConversationId)}`;
}

function normalizedDirectObjectError(error: unknown): unknown {
  const status = responseStatus(error);
  if (status === 403 || status === 404) return canonicalObjectNotFound();
  return error;
}

function normalizedApplicabilitySelectionError(error: unknown): unknown {
  const normalized = normalizedDirectObjectError(error);
  if (normalized !== error || !isRecord(error)) return normalized;
  const response = error.response;
  if (!isRecord(response)) return error;
  return backendResponseError(
    response.data,
    'APPLICABILITY_SELECTION_UNAVAILABLE',
  );
}

function normalizedOverallRegenerationError(error: unknown): unknown {
  const normalized = normalizedDirectObjectError(error);
  if (normalized !== error) return normalized;
  if (responseStatus(error) === 409) return overallRegenerationConflict();
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

function overallRegenerationConflict(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error('OVERALL_REGENERATION_CONFLICT'), {
    code: 'OVERALL_REGENERATION_CONFLICT',
    statusCode: 409,
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
