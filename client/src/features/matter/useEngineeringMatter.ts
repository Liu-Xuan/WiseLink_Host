import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getEngineeringMatterWorkspace,
  type EngineeringMatterClientError,
  type EngineeringMatterWorkspaceRead,
} from '@client/src/api/engineering-matter';
import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';
import { writeReviewDraft } from '@client/src/features/review/review-draft-store';
import { clearReadingLocation } from './reading-location';

interface MatterReadState {
  matterId: string;
  sessionGeneration: number;
  data: EngineeringMatterWorkspaceRead | null;
  loading: boolean;
  error: string | null;
}

export default function useEngineeringMatter(
  matterId: string,
  sessionGeneration: number,
  authenticationRequired: boolean,
) {
  const [state, setState] = useState<MatterReadState | null>(null);
  const epochRef = useRef<number>(0);
  const refresh = useCallback(async (): Promise<void> => {
    const epoch: number = ++epochRef.current;
    if (!matterId || authenticationRequired) {
      setState(null);
      return;
    }
    const current = (): boolean =>
      epochRef.current === epoch &&
      getCanonicalHostClientSessionGeneration() === sessionGeneration;
    const empty: MatterReadState = {
      matterId,
      sessionGeneration,
      data: null,
      loading: true,
      error: null,
    };
    setState((previous: MatterReadState | null) => ({
      ...(previous?.matterId === matterId &&
      previous.sessionGeneration === sessionGeneration
        ? previous
        : empty),
      loading: true,
      error: null,
    }));
    try {
      const data: EngineeringMatterWorkspaceRead =
        await getEngineeringMatterWorkspace(matterId);
      if (current()) setState({ ...empty, data, loading: false });
    } catch (cause: unknown) {
      if (!current()) return;
      const error: EngineeringMatterClientError | null =
        cause instanceof Error ? cause : null;
      const revoked: boolean =
        error?.statusCode === 401 ||
        error?.statusCode === 403 ||
        error?.statusCode === 404;
      if (revoked) {
        writeReviewDraft(`matter:${matterId}`, '', sessionGeneration);
        clearReadingLocation(`matter:${matterId}`);
      }
      setState((previous: MatterReadState | null) => ({
        ...(revoked ? empty : (previous ?? empty)),
        loading: false,
        error: error?.message ?? '读取事项失败，请稍后重试。',
      }));
      throw cause;
    }
  }, [matterId, sessionGeneration, authenticationRequired]);

  useEffect(() => {
    // The hook presents the error; callers may also await a refresh receipt.
    void refresh().catch(() => undefined);
    return () => {
      epochRef.current += 1;
    };
  }, [refresh]);

  const visible: MatterReadState | null =
    !authenticationRequired &&
    state?.matterId === matterId &&
    state.sessionGeneration === sessionGeneration
      ? state
      : null;
  return {
    data: visible?.data ?? null,
    loading:
      !authenticationRequired &&
      Boolean(matterId) &&
      (visible?.loading ?? true),
    error: authenticationRequired
      ? '请先登录，再读取当前事项。'
      : (visible?.error ?? null),
    refresh,
  };
}
