import { useEffect, useRef, useState } from 'react';
import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalReviewOverallProjectionEligibility,
  RequestCanonicalReviewOverallProjectionRequest,
} from '@shared/api.interface';
import {
  getDocumentParsingPage,
  getReviewOverallProjectionEligibility,
  getReviewOverallProjectionStatus,
  requestReviewOverallProjection,
} from '@client/src/api/canonical-host';
import { createRequestCorrelationId } from '@client/src/utils/request-correlation-id';

export function useReviewOverallProjection(input: {
  workItemId: string;
  workItemRevision: number | null;
  sessionGeneration: number;
  reviewRefreshGeneration: number;
  onSucceeded: (fresh: CanonicalDocumentParsingPageResponse) => Promise<void>;
}) {
  const [eligibility, setEligibility] = useState<CanonicalReviewOverallProjectionEligibility | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef<RequestCanonicalReviewOverallProjectionRequest | null>(null);
  const epoch = useRef(0);

  useEffect(() => {
    const current = ++epoch.current;
    pending.current = null;
    setEligibility(null);
    setBusy(false);
    setMessage(null);
    if (!input.workItemId || input.workItemRevision === null) return;
    void getReviewOverallProjectionEligibility(input.workItemId).then((read) => {
      if (epoch.current === current) setEligibility(read);
    }).catch(() => {
      if (epoch.current === current)
        setMessage('暂时无法核对已保存评估，请刷新后重试。');
    });
    return () => { epoch.current += 1; };
  }, [input.workItemId, input.workItemRevision, input.sessionGeneration,
    input.reviewRefreshGeneration]);

  async function run(): Promise<void> {
    const binding = eligibility?.binding;
    if (!binding || busy) return;
    const current = epoch.current;
    const request = pending.current ?? {
      requestId: createRequestCorrelationId(),
      ...binding,
    };
    pending.current = request;
    setBusy(true);
    setMessage('正在从已保存的评估工作更新综合，不重新分析正文。');
    try {
      try {
        await requestReviewOverallProjection(input.workItemId, request);
      } catch (submissionError) {
        // A lost POST response can still be a committed projection.
        try {
          await getReviewOverallProjectionStatus(input.workItemId, request.requestId);
        } catch {
          throw submissionError;
        }
      }
      if (epoch.current !== current) return;
      const fresh = await getDocumentParsingPage(input.workItemId, '', {
        freshness: 'mutation',
      });
      if (epoch.current !== current) return;
      await input.onSucceeded(fresh);
      pending.current = null;
      setMessage('已从已保存评估更新候选综合。');
    } catch {
      if (epoch.current === current)
        setMessage('更新未确认；再次点击会沿用同一请求核对结果。');
    } finally {
      if (epoch.current === current) setBusy(false);
    }
  }

  return {
    visible: eligibility?.eligible === true && eligibility.binding !== null,
    busy,
    message,
    run,
  };
}
