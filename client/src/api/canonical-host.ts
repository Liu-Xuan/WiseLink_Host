import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalEntryQueryRequest,
  CanonicalEntryQueryResponse,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';

import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

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

export async function persistIntegratedBaseRules(
  workItemId: string,
): Promise<CanonicalWorkItemProjection> {
  return runIntegratedAssessmentAction(
    workItemId,
    'base-rules',
    'BASE_RULE_RESULT_ACCESS_DENIED',
    '读取并保存 Base 固定规则候选失败',
  );
}

export async function persistIntegratedOpenClawOverall(
  workItemId: string,
): Promise<CanonicalWorkItemProjection> {
  return runIntegratedAssessmentAction(
    workItemId,
    'overall-synthesis',
    'OPENCLAW_OVERALL_ACCESS_DENIED',
    '运行并保存 OpenClaw 整体候选失败',
  );
}

async function runIntegratedAssessmentAction(
  workItemId: string,
  action: 'base-rules' | 'overall-synthesis',
  deniedCode: string,
  logMessage: string,
): Promise<CanonicalWorkItemProjection> {
  try {
    const response = await axiosForBackend<CanonicalWorkItemProjection>({
      url: `/api/canonical-host/work-items/${encodeURIComponent(workItemId)}/integrated-assessment/${action}`,
      method: 'POST',
      data: {},
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error(deniedCode);
    }
    return response.data;
  } catch (error) {
    logger.error(logMessage, error);
    throw error;
  }
}
