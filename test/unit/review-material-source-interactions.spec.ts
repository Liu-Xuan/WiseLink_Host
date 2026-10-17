import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReviewConversationReadModel, ReviewTurnReadModel } from '@shared/api.interface';
import ContinuousReviewPanel from '../../client/src/features/review/ContinuousReviewPanel';
import { reviewUiTurn } from './fixtures/review-ui';

const { JSDOM } = require('jsdom');

jest.mock('@client/src/api', () => ({ canonicalHost: {
  reloadReviewConversation: jest.fn(), createOrResumeReviewConversation: jest.fn(),
  confirmReviewActionDraft: jest.fn(), closeReviewConversation: jest.fn(),
  appendReviewTextTurn: jest.fn(),
} }));
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
}));
jest.mock('@client/src/api/runtime-probe', () => ({ getHostedRuntimeFingerprint: jest.fn() }));
jest.mock('@client/src/config/runtime-build', () => ({ runtimeBuildFingerprint: {
  sourceCommit: 'unit-test', buildTime: 'unit-test', visualVersion: 'unit-test',
} }));
jest.mock('@client/src/features/dialogue/ContextualDialogue', () => ({
  __esModule: true, default: () => null,
}));
jest.mock('@client/src/components/OfficialOauthLink', () => ({ OfficialOauthLink: 'a' }));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/components/ui/textarea', () => ({ Textarea: 'textarea' }));
jest.mock('../../client/src/features/review/useReviewDraft', () => {
  const setMessage = jest.fn();
  return { __esModule: true, default: () => ['', setMessage] };
});
jest.mock('../../client/src/features/review/useReviewWorkingRefresh', () => ({
  __esModule: true, default: () => null,
}));
jest.mock('../../client/src/features/review/TaskModelPicker', () => ({
  __esModule: true, default: () => null,
  useTaskModelOptions: () => ({ ready: true, data: { options: [] } }),
}));
jest.mock('../../client/src/features/review/AssessmentUpdateControl', () => ({
  __esModule: true, default: () => null,
}));
jest.mock('../../client/src/features/review/ReviewConversationTurn', () => ({
  __esModule: true, default: () => null,
}));
jest.mock('../../client/src/features/review/continuous-review-panel.css', () => ({}));
jest.mock('../../client/src/features/review/review-materials.css', () => ({}));

const api = jest.requireMock('@client/src/api').canonicalHost;

describe('material citation source navigation through the Review consumer', () => {
  let dom: InstanceType<typeof JSDOM>;
  let root: Root;
  let container: HTMLElement;
  const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const locateBinding = jest.fn();
  const locateBareRef = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' });
    const values = [dom.window, dom.window.document, dom.window.navigator, true];
    globals.forEach((key: string, index: number) => {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { value: values[index], configurable: true, writable: true });
    });
    container = document.getElementById('root')!;
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    globals.forEach((key: string) => {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  });

  async function showMaterials(turns: ReviewTurnReadModel[], bindingCallback = true): Promise<void> {
    const conversation: ReviewConversationReadModel = {
      schemaVersion: 'wiselink.3_1.review_conversation.v1.c1',
      reviewConversationId: 'RC-1', workItemId: 'WI-1',
      startedAtRevision: 7, lastSyncedRevision: 7, currentWorkItemRevision: 7,
      currentRevisionSynced: true, status: 'ACTIVE',
      createdAt: '2026-10-15T00:00:00Z', lastActiveAt: '2026-10-15T00:00:00Z',
      closedAt: null, turns,
    };
    api.reloadReviewConversation.mockResolvedValue({ conversation, currentWorkItemRevision: 7 });
    await act(async () => root.render(createElement(ContinuousReviewPanel, {
      key: `${turns.map((turn: ReviewTurnReadModel) => turn.reviewTurnId).join(':')}:${bindingCallback}`,
      workItemId: 'WI-1', workItemRevision: 7, selectedEvaluationItemId: null,
      confirmationReceipt: null, onConfirmationReceipt: jest.fn(),
      onLocateSourceRef: locateBareRef,
      onLocateSourceBinding: bindingCallback ? locateBinding : undefined,
      onWorkItemRefresh: jest.fn(),
      materials: { primary: { title: 'Current document', documentVersionId: 'DV-1' },
        onOpenPrimary: jest.fn(), related: null },
    })));
    const details = container.querySelector<HTMLDetailsElement>('.review-materials')!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new dom.window.Event('toggle'));
    });
  }

  function boundTurn(no: number, workItemId: string, documentVersionId: string): ReviewTurnReadModel {
    const turn = reviewUiTurn(no, true);
    turn.assistantCandidate!.sourceBindings = [{
      sourceRefId: 'SRC-1', workItemId, documentVersionId, originalSourceRefId: `original-${no}`,
    }];
    return turn;
  }

  async function clickSource(index = 0): Promise<void> {
    const buttons = container.querySelectorAll<HTMLButtonElement>('.review-material-citations button');
    await act(async () => buttons[index].click());
  }

  it('keeps a reused task alias separate for two documents and locates each exact original version', async () => {
    const first = boundTurn(1, 'WI-A', 'DV-A');
    const second = boundTurn(2, 'WI-B', 'DV-B');
    await showMaterials([second, first]);
    expect(container.querySelectorAll('.review-material-citations button')).toHaveLength(2);
    await clickSource(0);
    await clickSource(1);
    expect(locateBinding.mock.calls).toEqual([
      [first.assistantCandidate!.sourceBindings![0]], [second.assistantCandidate!.sourceBindings![0]],
    ]);
    expect(locateBareRef).not.toHaveBeenCalled();
    expect(api.createOrResumeReviewConversation).not.toHaveBeenCalled();
    expect(api.appendReviewTextTurn).not.toHaveBeenCalled();
    expect(api.confirmReviewActionDraft).not.toHaveBeenCalled();
  });

  it.each(['missing', 'duplicate'] as const)('refuses a %s unique binding without guessing the main document', async (mode) => {
    const turn = boundTurn(1, 'WI-A', 'DV-A');
    const binding = turn.assistantCandidate!.sourceBindings![0];
    turn.assistantCandidate!.sourceBindings = mode === 'missing' ? [] : [binding, binding];
    await showMaterials([turn]);
    await clickSource();
    expect(locateBinding).not.toHaveBeenCalled();
    expect(locateBareRef).not.toHaveBeenCalled();
    expect(container.textContent).toContain('未读回这条引用的唯一文档与版本绑定');
  });

  it('does not send a legacy unbound material reference or drop a bound document version into a bare locator', async () => {
    const legacy = reviewUiTurn(1, true);
    await showMaterials([legacy]);
    await clickSource();
    expect(locateBareRef).not.toHaveBeenCalled();
    await showMaterials([boundTurn(2, 'WI-1', 'DV-exact-old')], false);
    await clickSource();
    expect(locateBareRef).not.toHaveBeenCalled();
    expect(container.textContent).toContain('REVIEW_SOURCE_BINDING_UNAVAILABLE');
  });
});
