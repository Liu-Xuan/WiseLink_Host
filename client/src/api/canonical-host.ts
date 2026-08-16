import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalEntryQueryRequest,
  CanonicalEntryQueryResponse,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';

import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

export interface Phase10AeoCandidateLoopResult {
  schemaVersion: 'wiselink.3_1.phase10_aeo_candidate_loop.v1';
  status: 'CANDIDATE_WORD_EXPORTED';
  workItem: CanonicalWorkItemProjection;
  transition: [5, 9];
  targetIdentity: 'AEO-B787-46-0015-R09';
  disposition: 'ADOPT';
  sourceCandidateCount: number;
  word: {
    artifactRef: string;
    artifactSha256: string;
    byteLength: number;
    mediaType: string;
    ooxmlZipSignature: 'PK';
  };
}

export async function getDocumentParsingPage(
  workItemId: string,
  query: string,
): Promise<CanonicalDocumentParsingPageResponse> {
  try {
    const response = await axiosForBackend<CanonicalDocumentParsingPageResponse>(
      {
        url: `/api/canonical-host/work-items/${encodeURIComponent(workItemId)}/document-parsing`,
        method: 'GET',
        params: { query },
      },
    );
    if (response.status === 401 || response.status === 403) {
      throw new Error('CANONICAL_PAGE_ACCESS_DENIED');
    }
    return response.data;
  } catch (error) {
    logger.error('读取文档与解析 fresh projection 失败', error);
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

export async function evaluateAssessment(
  workItemId: string,
): Promise<CanonicalWorkItemProjection> {
  try {
    const response = await axiosForBackend<CanonicalWorkItemProjection>({
      url: `/api/canonical-host/work-items/${encodeURIComponent(workItemId)}/assessment/evaluate`,
      method: 'POST',
      data: {},
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error('ASSESSMENT_EVALUATE_ACCESS_DENIED');
    }
    return response.data;
  } catch (error) {
    logger.error('生成 Job Aid 候选评估失败', error);
    throw error;
  }
}

export async function resynthesizeAssessment(
  workItemId: string,
  input: {
    expectedRevision: number;
    criterionId: string;
    decision: 'confirmed_pass' | 'confirmed_fail' | 'returned_for_rework' | 'deferred';
    comment: string;
  },
): Promise<CanonicalWorkItemProjection> {
  try {
    const response = await axiosForBackend<CanonicalWorkItemProjection>({
      url: `/api/canonical-host/work-items/${encodeURIComponent(workItemId)}/assessment/resynthesize`,
      method: 'POST',
      data: input,
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error('ASSESSMENT_RESYNTHESIS_ACCESS_DENIED');
    }
    return response.data;
  } catch (error) {
    logger.error('按工程师修改重综合失败', error);
    throw error;
  }
}

export async function runPhase10AeoCandidateLoop(): Promise<Phase10AeoCandidateLoopResult> {
  try {
    const response = await axiosForBackend<Phase10AeoCandidateLoopResult>({
      url: '/api/canonical-host/validation/phase10-aeo-candidate-loop',
      method: 'POST',
      data: {},
      meta: { autoJumpToLogin: false },
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error('AEO_PHASE10_ACTION_ACCESS_DENIED');
    }
    return response.data;
  } catch (error) {
    logger.error('执行 Phase10 AEO 候选循环失败', error);
    throw error;
  }
}
