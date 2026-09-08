import { useEffect, useRef, useState } from 'react';

import {
  getCanonicalHostClientSessionGeneration,
  subscribeCanonicalHostClientSession,
} from '@client/src/api/canonical-host';
import type { AssessmentClaimEvidenceReadModel } from '@shared/assessment-reading.interface';

import {
  validateAssessmentClaimReadback,
  type AssessmentClaimSelection,
  type ReadAssessmentClaim,
} from './assessment-reading';

interface AssessmentClaimState {
  data: AssessmentClaimEvidenceReadModel | null;
  error: string | null;
  loading: boolean;
}

export default function useAssessmentClaim(
  selection: AssessmentClaimSelection | null,
  readClaim: ReadAssessmentClaim,
  retry: number,
): AssessmentClaimState {
  const [state, setState] = useState<AssessmentClaimState>({
    data: null,
    error: null,
    loading: Boolean(selection),
  });
  const epochRef = useRef<number>(0);
  const resultRef: string | undefined = selection?.resultRef;
  const resultRevision: number | undefined = selection?.resultRevision;
  const claimId: string | undefined = selection?.claimId;

  useEffect(() => {
    const epoch: number = ++epochRef.current;
    const session: number = getCanonicalHostClientSessionGeneration();
    setState({ data: null, error: null, loading: Boolean(resultRef) });
    if (!resultRef || resultRevision === undefined || !claimId) return;
    const selected: AssessmentClaimSelection = {
      resultRef,
      resultRevision,
      claimId,
    };
    const unsubscribe: () => void = subscribeCanonicalHostClientSession(() => {
      epochRef.current += 1;
      setState({
        data: null,
        error: '登录或权限状态已变化，请返回后重新读取。',
        loading: false,
      });
    });
    void readClaim(selected)
      .then((data: AssessmentClaimEvidenceReadModel): void => {
        if (
          epoch !== epochRef.current ||
          session !== getCanonicalHostClientSessionGeneration()
        )
          return;
        validateAssessmentClaimReadback(selected, data);
        setState({ data, error: null, loading: false });
      })
      .catch((reason: unknown): void => {
        if (
          epoch !== epochRef.current ||
          session !== getCanonicalHostClientSessionGeneration()
        )
          return;
        setState({
          data: null,
          error:
            reason instanceof Error
              ? reason.message
              : '读取判断依据失败，请重试。',
          loading: false,
        });
      });
    return () => {
      epochRef.current += 1;
      unsubscribe();
    };
  }, [resultRef, resultRevision, claimId, readClaim, retry]);

  // Do not briefly display a previous selection while the new request effect starts.
  if (
    state.data &&
    (state.data.resultRef !== resultRef ||
      state.data.resultRevision !== resultRevision ||
      state.data.claim.claimId !== claimId)
  )
    return { data: null, error: null, loading: true };
  return state;
}
