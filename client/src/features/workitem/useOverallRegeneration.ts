import { useEffect, useRef, useState } from 'react';

import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalOverallRegenerationReadModel,
  RequestCanonicalOverallRegenerationRequest,
} from '@shared/api.interface';
import {
  getDocumentParsingPage,
  getOverallRegenerationStatus,
  requestOverallRegeneration,
} from '@client/src/api/canonical-host';

import {
  isOverallRegenerationActive,
  OVERALL_REGENERATION_IDLE,
  overallRegenerationClientFailure,
  overallRegenerationInput,
  overallRegenerationPresentation,
  resetOverallRegenerationForWorkItem,
  reusableOverallRegenerationRequest,
  type OverallRegenerationPresentation,
  type StableOverallRegenerationRequest,
} from './overall-regeneration-state';

const POLL_INTERVAL_MS = 1_500;
const POLL_LIMIT = 80;

interface UseOverallRegenerationInput {
  workItemId: string;
  onSucceeded: (
    fresh: CanonicalDocumentParsingPageResponse,
  ) => void | Promise<void>;
}

export interface OverallRegenerationControl extends OverallRegenerationPresentation {
  run: () => void;
}

export function useOverallRegeneration({
  workItemId,
  onSucceeded,
}: UseOverallRegenerationInput): OverallRegenerationControl {
  const [view, setView] = useState<OverallRegenerationPresentation>(
    OVERALL_REGENERATION_IDLE,
  );
  const requestRef = useRef<StableOverallRegenerationRequest | null>(null);
  const epochRef = useRef<number>(0);

  useEffect(
    () => () => {
      epochRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    const reset = resetOverallRegenerationForWorkItem();
    epochRef.current += 1;
    requestRef.current = reset.request;
    setView(reset.view);
  }, [workItemId]);

  async function finish(
    model: CanonicalOverallRegenerationReadModel,
    epoch: number,
  ): Promise<void> {
    if (epochRef.current !== epoch) return;
    setView(overallRegenerationPresentation(model));
    if (model.status !== 'SUCCEEDED') {
      if (!isOverallRegenerationActive(model.status)) requestRef.current = null;
      return;
    }
    requestRef.current = null;
    try {
      const fresh = await getDocumentParsingPage(workItemId, '', {
        freshness: 'mutation',
      });
      if (epochRef.current !== epoch) return;
      const summary =
        fresh.workItem.integratedAssessment?.overallSynthesis
          ?.engineeringSummary;
      if (!summary) {
        setView({
          label: '刷新查看新摘要',
          message: '任务已结束，但新的工程摘要尚未读回，请刷新后查看。',
          tone: 'warning',
          busy: false,
          disabled: false,
          retryMode: 'new',
        });
        return;
      }
      await onSucceeded(fresh);
    } catch {
      if (epochRef.current !== epoch) return;
      setView({
        label: '刷新查看新摘要',
        message: '摘要已经形成，但最新页面暂未读回，请刷新后查看。',
        tone: 'warning',
        busy: false,
        disabled: false,
        retryMode: 'new',
      });
    }
  }

  async function poll(requestId: string, epoch: number): Promise<void> {
    requestRef.current = requestRef.current
      ? { ...requestRef.current, polling: true }
      : null;
    for (let index = 0; index < POLL_LIMIT; index += 1) {
      await wait(POLL_INTERVAL_MS);
      if (epochRef.current !== epoch) return;
      try {
        const model = await getOverallRegenerationStatus(workItemId, requestId);
        if (epochRef.current !== epoch) return;
        setView(overallRegenerationPresentation(model));
        if (!isOverallRegenerationActive(model.status)) {
          await finish(model, epoch);
          return;
        }
      } catch (reason) {
        if (epochRef.current !== epoch) return;
        setView(clientFailure(reason, requestRef.current, true));
        return;
      }
    }
    if (epochRef.current === epoch) {
      setView(
        overallRegenerationClientFailure({
          hasStableRequest: requestRef.current !== null,
          polling: true,
          conflict: false,
          sourceUnavailable: false,
        }),
      );
    }
  }

  async function submit(
    stable: StableOverallRegenerationRequest,
    epoch: number,
  ): Promise<void> {
    requestRef.current = { ...stable, polling: false };
    setView({
      ...OVERALL_REGENERATION_IDLE,
      label: '正在提交…',
      message: '正在提交受控的工程摘要生成请求。',
      tone: 'progress',
      busy: true,
      disabled: true,
    });
    try {
      const response = await requestOverallRegeneration(
        workItemId,
        stable.input,
      );
      if (epochRef.current !== epoch) return;
      setView(overallRegenerationPresentation(response.regeneration));
      if (isOverallRegenerationActive(response.regeneration.status)) {
        await poll(stable.input.requestId, epoch);
      } else {
        await finish(response.regeneration, epoch);
      }
    } catch (reason) {
      if (epochRef.current !== epoch) return;
      setView(clientFailure(reason, requestRef.current, false));
    }
  }

  async function start(): Promise<void> {
    if (view.busy || view.disabled) return;
    const epoch = epochRef.current + 1;
    epochRef.current = epoch;
    const stable = reusableOverallRegenerationRequest(
      requestRef.current,
      workItemId,
      view.retryMode,
    );
    if (!stable) requestRef.current = null;
    if (stable && view.retryMode === 'post') {
      await submit(stable, epoch);
      return;
    }
    if (stable && view.retryMode === 'poll') {
      setView({
        ...view,
        label: '正在读取进度…',
        busy: true,
        disabled: true,
      });
      await poll(stable.input.requestId, epoch);
      return;
    }
    requestRef.current = null;
    setView({
      ...OVERALL_REGENERATION_IDLE,
      label: '读取最新资料…',
      message: '正在核对当前文件版本与解析结果。',
      tone: 'progress',
      busy: true,
      disabled: true,
    });
    try {
      const fresh = await getDocumentParsingPage(workItemId, '', {
        freshness: 'mutation',
      });
      if (epochRef.current !== epoch) return;
      const next: StableOverallRegenerationRequest = {
        workItemId,
        input: overallRegenerationInput(fresh, randomUuid(), workItemId),
        polling: false,
      };
      await submit(next, epoch);
    } catch (reason) {
      if (epochRef.current !== epoch) return;
      setView(clientFailure(reason, requestRef.current, false));
    }
  }

  return { ...view, run: () => void start() };
}

function clientFailure(
  reason: unknown,
  stable: StableOverallRegenerationRequest | null,
  polling: boolean,
): OverallRegenerationPresentation {
  const message = reason instanceof Error ? reason.message : String(reason);
  return overallRegenerationClientFailure({
    hasStableRequest: stable !== null,
    polling,
    conflict: /CONFLICT|OBSOLETE|REVISION|STALE|CONTEXT_CHANGED|409/iu.test(
      message,
    ),
    sourceUnavailable: /SOURCE_NOT_READY|PACKAGE|PARSE/iu.test(message),
  });
}

function randomUuid(): string {
  if (typeof crypto.randomUUID !== 'function') {
    throw new Error('BROWSER_RANDOM_UUID_UNAVAILABLE');
  }
  return crypto.randomUUID().toLowerCase();
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, durationMs));
}
