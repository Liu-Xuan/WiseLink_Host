import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
jest.mock('../../client/src/api/canonical-host', () => ({ getInitialAnalysisStatus: jest.fn() }));
jest.mock('../../client/src/features/review/review-loop.css', () => ({}));
jest.mock('../../client/src/components/ui/button', () => ({
  Button: ({ variant: _variant, size: _size, ...props }: Record<string, unknown>) => createElement('button', props),
}));
import type {
  CanonicalInitialAnalysisReadModel,
  CanonicalTimelineProjection,
} from '@shared/api.interface';
import InitialAnalysisProgress, {
  shouldPollInitialAnalysis,
} from '../../client/src/features/review/InitialAnalysisProgress';

const timeline: CanonicalTimelineProjection = {
  schemaVersion: 'wiselink.3_1.timeline_projection.v0.candidate',
  workItemId: 'WI-test',
  events: [],
  boundary: { onlyServerObservedEvents: true, note: 'Host observations' },
};

function initial(): CanonicalInitialAnalysisReadModel {
  return {
    workItemId: 'WI-test',
    workItemRevision: 3,
    documentVersionId: 'DV-test',
    status: 'FAILED',
    nextOperation: null,
    candidateOnly: true,
    stages: {
      translation: {
        status: 'FAILED',
        terminalCode: 'INITIAL_GATEWAY_HTTP_400',
      },
      applicability: {
        status: 'WAITING_INPUT',
        terminalCode: 'APPLICABILITY_SELECTION_REQUIRED',
      },
      jobAid: { status: 'PENDING', terminalCode: null },
      overall: { status: 'PENDING', terminalCode: null },
    },
  };
}

describe('Initial analysis progress', () => {
  it('shows the real initial failure even when no candidate timeline event exists', () => {
    const html = renderToStaticMarkup(
      createElement(InitialAnalysisProgress, {
        workItemId: 'WI-test',
        sessionGeneration: 1,
        initial: initial(),
        timeline,
        onRevisionChanged: jest.fn(),
        onAccessLost: jest.fn(),
      }),
    );
    expect(html).toContain('全文翻译未完成');
    expect(html).toContain('模型未返回可用结果');
    expect(html).toContain('尚未选择目标飞机');
    expect(html).not.toContain('当前暂无分析进度记录');
    expect(html).not.toContain('候选待复核');
    expect(html).not.toContain('INITIAL_GATEWAY');
  });

  it('polls only pending/running work and stops on failure, conflict or completed waiting-input', () => {
    expect(shouldPollInitialAnalysis(initial())).toBe(false);
    expect(shouldPollInitialAnalysis({ ...initial(), status: 'BUSY' })).toBe(
      true,
    );
    expect(
      shouldPollInitialAnalysis({
        ...initial(),
        status: 'REQUIRED',
        nextOperation: 'TRANSLATE',
      }),
    ).toBe(true);
    expect(
      shouldPollInitialAnalysis({
        ...initial(),
        status: 'WAITING_INPUT',
        nextOperation: 'EVALUATE_JOBAID',
      }),
    ).toBe(true);
    for (const status of [
      'WAITING_INPUT',
      'CONFLICT',
      'SUCCEEDED',
      'NOT_READY',
    ] as const) {
      expect(
        shouldPollInitialAnalysis({
          ...initial(),
          status,
          nextOperation: null,
        }),
      ).toBe(false);
    }
  });
});
