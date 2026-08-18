import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalAeoCandidateRunResponse,
  CanonicalEntryQueryRequest,
  CanonicalEntryQueryResponse,
  CanonicalWorkItemProjection,
  CanonicalEngineerReviewDecision,
} from '@shared/api.interface';

import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

const DEFAULT_DOCUMENT_PARSING_QUERY = 'applicability';

export async function getDocumentParsingPage(
  workItemId: string,
  query: string,
): Promise<CanonicalDocumentParsingPageResponse> {
  try {
    const normalizedQuery =
      query.trim() || DEFAULT_DOCUMENT_PARSING_QUERY;
    const response =
      await axiosForBackend<CanonicalDocumentParsingPageResponse>({
        url: `/api/canonical-host/work-items/${encodeURIComponent(workItemId)}/document-parsing`,
        method: 'GET',
        params: { query: normalizedQuery },
      });
    if (response.status === 401 || response.status === 403) {
      throw new Error('CANONICAL_PAGE_ACCESS_DENIED');
    }
    return response.data;
  } catch (error) {
    logger.error('读取文档与解析 fresh projection 失败', error);
    throw error;
  }
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
    if (response.status === 401 || response.status === 403) {
      throw new Error('ENGINEER_REVIEW_ACCESS_DENIED');
    }
    return response.data;
  } catch (error) {
    logger.error('记录工程师逐项意见失败', error);
    throw error;
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
    if (response.status === 401 || response.status === 403) {
      throw new Error('CANONICAL_QUERY_ACCESS_DENIED');
    }
    return response.data;
  } catch (error) {
    logger.error('查询解析单元失败', error);
    throw error;
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
    if (response.status === 401 || response.status === 403) {
      throw new Error('OPENCLAW_OVERALL_CONFIRMATION_ACCESS_DENIED');
    }
    return response.data;
  } catch (error) {
    logger.error('确认当前整体综合用于 AEO 失败', error);
    throw error;
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
    if (response.status === 401 || response.status === 403) {
      throw new Error('AEO_CANDIDATE_ACCESS_DENIED');
    }
    return response.data;
  } catch (error) {
    logger.error('生成同一 WorkItem 的 AEO 候选失败', error);
    throw error;
  }
}
