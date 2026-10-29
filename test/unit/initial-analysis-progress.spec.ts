import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
jest.mock('../../client/src/api/canonical-host', () => ({ getInitialAnalysisStatus: jest.fn(), requestInitialAnalysisContinuation: jest.fn(), getCanonicalHostClientSessionGeneration: () => 1 }));
jest.mock('../../client/src/features/review/TaskModelPicker', () => ({ __esModule: true,
  default: () => null, useTaskModelOptions: () => ({ data: null, ready: false, loading: false, error: '', refresh: jest.fn() }),
}));
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
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

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
  it('keeps a readable stage separate from final task and automatic completion',()=>{
    const working=jobAidReadingFixture();
    working.stageOverall={status:'CURRENT',readingResult:{} as never,receipt:{schemaVersion:'wiselink.aily-stage-overall.v1',
      workRevisionRef:working.current!.workRevisionRef,workRevision:working.current!.workRevision,sourceAssessment:{} as never,
      artifact:{} as never,observedAt:'2026-10-29T00:00:00.000Z'}};
    const html=renderToStaticMarkup(createElement(InitialAnalysisProgress,{workItemId:'WI-test',sessionGeneration:1,
      initial:initial(),working,timeline,onRevisionChanged:()=>undefined,onAccessLost:()=>undefined}));
    expect(html).toContain('阶段综合可读');expect(html).toContain('任务收尾另列');
    expect(working.autoProcessingAcknowledgement).toBeFalsy();
  });
  describe('enterprise recovery after refresh', () => {
    const {JSDOM} = require('jsdom');
    let dom: InstanceType<typeof JSDOM>;
    let root: Root;
    let container: HTMLDivElement;
    const prior = new Map<string, PropertyDescriptor | undefined>();
    const api = jest.requireMock('../../client/src/api/canonical-host') as {
      requestInitialAnalysisContinuation: jest.Mock; getInitialAnalysisStatus: jest.Mock;
    };
    const recovery: NonNullable<CanonicalInitialAnalysisReadModel['ailyRecoveryRequest']> = {
      requestId: '00000000-0000-4000-8000-000000000101', operation: 'EVALUATE_JOBAID', executionMode: 'AILY_AGENT_V1',
      modelRef: 'aily/deepseek-v4-pro', modelName: 'DeepSeek V4 Pro'};
    beforeEach(() => {
      dom = new JSDOM('<!doctype html><body></body>');
      for (const [key, value] of Object.entries({window: dom.window, document: dom.window.document,
        HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true})) {
        prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, {value, configurable: true, writable: true});
      }
      container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
      api.requestInitialAnalysisContinuation.mockReset(); api.getInitialAnalysisStatus.mockReset();
    });
    afterEach(async () => {
      await act(async () => root.unmount()); dom.window.close();
      for (const [key, descriptor] of prior) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
      }
      prior.clear();
    });

    it('remounts with the persisted original UUID/model and preserves it even when Host is terminal but dispatch is UNKNOWN', async () => {
      const value: CanonicalInitialAnalysisReadModel = {...initial(), ailyRecoveryRequest: recovery, continuationOperations: [],
        ailyTaskAdmission: {executionMode: 'AILY_AGENT_V1', modelRef: 'aily/glm-5.3', modelName: 'GLM-5.3', available: true}};
      api.getInitialAnalysisStatus.mockResolvedValue(value);
      api.requestInitialAnalysisContinuation.mockResolvedValue({requestId: recovery.requestId, operation: 'EVALUATE_JOBAID',
        status: 'TIMED_OUT', replayed: true, candidateOnly: true,
        ailyDispatch: {attemptRef: 'AQ-original', dispatchStatus: 'UNKNOWN', chatId: null, remoteSessionId: null}});
      const render = async () => act(async () => root.render(createElement(InitialAnalysisProgress,
        {workItemId: 'WI-test', sessionGeneration: 1, initial: value, timeline, onRevisionChanged: jest.fn(), onAccessLost: jest.fn()})));
      await render();
      expect(container.textContent).toContain('DeepSeek V4 Pro');
      expect(api.requestInitialAnalysisContinuation).not.toHaveBeenCalled();
      await act(async () => {container.querySelector('button')!.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true}));});
      expect(container.textContent).toContain('投递结果待核');
      expect(container.textContent).not.toContain('可发起新一轮请求');
      await act(async () => root.unmount()); root = createRoot(container); await render();
      await act(async () => {container.querySelector('button')!.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true}));});
      expect(api.requestInitialAnalysisContinuation).toHaveBeenCalledTimes(2);
      for (const call of api.requestInitialAnalysisContinuation.mock.calls)
        expect(call).toEqual(['WI-test', {requestId: recovery.requestId, expectedRevision: value.workItemRevision,
          operation: 'EVALUATE_JOBAID', executionMode: 'AILY_AGENT_V1', modelRef: 'aily/deepseek-v4-pro'}]);
    });
  });

  it('renders the explicit enterprise choice without waiting for the unrelated tenant model picker', () => {
    const value: CanonicalInitialAnalysisReadModel = {...initial(), continuationOperations: ['EVALUATE_JOBAID'],
      ailyTaskAdmission: {executionMode: 'AILY_AGENT_V1', modelRef: 'aily/deepseek-v4-pro', modelName: 'DeepSeek V4 Pro', available: true}};
    const html = renderToStaticMarkup(createElement(InitialAnalysisProgress, {workItemId: 'WI-test', sessionGeneration: 1,
      initial: value, timeline, onRevisionChanged: jest.fn(), onAccessLost: jest.fn()}));
    expect(html).toContain('本次由企业智能体评估，所选模型：DeepSeek V4 Pro');
    expect(html).toContain('开始评估');
    expect(html).not.toContain('开始程序评估');
    expect(html).not.toContain('disabled=""');
  });

  it('keeps previous work visible and offers no legacy model fallback for an unavailable exact enterprise scope', () => {
    const value: CanonicalInitialAnalysisReadModel = {...initial(), continuationOperations: [],
      ailyTaskAdmission: {executionMode: 'AILY_AGENT_V1', modelRef: '', modelName: '', available: false}};
    const html = renderToStaticMarkup(createElement(InitialAnalysisProgress, {workItemId: 'WI-test', sessionGeneration: 1,
      initial: value, timeline, onRevisionChanged: jest.fn(), onAccessLost: jest.fn()}));
    expect(html).toContain('当前企业评估入口暂不可用；已有工作继续可读');
    expect(html).toContain('全文翻译未完成');
    expect(html).not.toContain('继续问题评估');
  });

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
    expect(html).not.toContain('续办身份尚未验证');
  });

  it('shows the separate continuation identity note while preserving the actual failed progress', () => {
    const value: CanonicalInitialAnalysisReadModel = { ...initial(),
      continuationDiagnosticCode: 'OFFICIAL_OAUTH_SESSION_REQUIRED', continuationOperations: [],
      stages: { ...initial().stages, jobAid: { status: 'FAILED', terminalCode: 'INITIAL_GATEWAY_HTTP_502' } },
    };
    const html = renderToStaticMarkup(createElement(InitialAnalysisProgress, {
      workItemId: 'WI-test', sessionGeneration: 1, initial: value, timeline,
      onRevisionChanged: jest.fn(), onAccessLost: jest.fn(),
    }));
    expect(html).toContain('续办身份尚未验证，请先完成工作台身份验证。');
    expect(html).toContain('全文翻译未完成');
    expect(html).toContain('模型未返回可用结果');
    expect(html).not.toContain('继续问题评估');
    expect(html).not.toContain('OFFICIAL_OAUTH_SESSION_REQUIRED');
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
