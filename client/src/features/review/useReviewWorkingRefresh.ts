import { useEffect, useRef, useState } from 'react';

import type {
  ReviewConversationReadModel,
  ReviewTurnReadModel,
} from '@shared/api.interface';

export default function useReviewWorkingRefresh(
  conversation: ReviewConversationReadModel | null,
  onWorkingRefresh?: () => Promise<void>,
): string | null {
  const observedRef = useRef<string>('');
  const [error, setError] = useState<string | null>(null);
  const completed: ReviewTurnReadModel | undefined = [
    ...(conversation?.turns ?? []),
  ]
    .reverse()
    .find((turn: ReviewTurnReadModel) => Boolean(turn.assistantCandidate));
  const completedKey: string = completed?.assistantCandidate
    ? JSON.stringify([
        completed.reviewTurnId,
        completed.assistantCandidate.completedAt,
        completed.assistantCandidate.matterWorkingUpdate ?? null,
      ])
    : '';
  useEffect(() => {
    if (
      !onWorkingRefresh ||
      !completedKey ||
      observedRef.current === completedKey
    )
      return;
    observedRef.current = completedKey;
    let active: boolean = true;
    setError(null);
    void onWorkingRefresh().catch(() => {
      if (active)
        setError(
          '本轮回复已保存，但事项工作认识未能刷新；请使用页面“重新读取”。',
        );
    });
    return () => {
      active = false;
    };
  }, [completedKey, onWorkingRefresh]);
  return error;
}
