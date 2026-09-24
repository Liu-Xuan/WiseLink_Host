import { createElement } from 'react';
import type { Root } from 'react-dom/client';

const availability = jest.fn();
const preview = jest.fn();
const confirmSelection = jest.fn();
const readSelection = jest.fn();
const readStatus = jest.fn();

jest.mock('@client/src/api', () => ({ canonicalHost: {
  getApplicabilitySelectionReviewAvailability: availability,
  previewApplicabilitySelectionReviewAction: preview,
  confirmApplicabilitySelectionReviewAction: confirmSelection,
  getApplicabilitySelection: readSelection,
  getInitialAnalysisStatus: readStatus,
} }));
jest.mock('@client/src/components/ui/button', () => ({ Button: (
  props: React.ButtonHTMLAttributes<HTMLButtonElement>,
) => jest.requireActual<typeof import('react')>('react').createElement('button', props) }));
jest.mock('@client/src/components/ui/input', () => ({ Input: (
  props: React.InputHTMLAttributes<HTMLInputElement>,
) => jest.requireActual<typeof import('react')>('react').createElement('input', props) }));
jest.mock('@client/src/components/ui/label', () => ({ Label: (
  props: React.LabelHTMLAttributes<HTMLLabelElement>,
) => jest.requireActual<typeof import('react')>('react').createElement('label', props) }));
jest.mock('@client/src/components/ui/dialog', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  return {
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
      open ? react.createElement(react.Fragment, null, children) : null,
    DialogContent: ({ children }: { children: React.ReactNode }) =>
      react.createElement('div', null, children),
    DialogHeader: ({ children }: { children: React.ReactNode }) =>
      react.createElement('div', null, children),
    DialogTitle: ({ children }: { children: React.ReactNode }) =>
      react.createElement('h2', null, children),
    DialogDescription: ({ children }: { children: React.ReactNode }) =>
      react.createElement('p', null, children),
  };
});

import ApplicabilitySelectionReviewAction from
  '../../client/src/pages/DocumentParsingPage/ApplicabilitySelectionReviewAction';

const draft = {
  schemaVersion: 'wiselink.3_1.applicability_selection_review_draft.v1',
  workItemId: 'WI-1', documentVersionId: 'DV-1',
  expectedWorkItemRevision: 7, aircraftIdentifier: 'B-1234',
  asOf: '2026-08-27', fleetSource: { snapshotId: 'snap-1',
    sourceRevisionKey: 'fleet-r1', authorityRevision: 'auth-r1',
    sourceAsOf: '2026-08-26' }, expiresAt: '2099-08-27T01:00:00.000Z',
  confirmationToken: 'a'.repeat(64),
};

describe('applicability selection ReviewAction unknown result', () => {
  let root: Root;
  let container: HTMLDivElement;
  let act: typeof import('react')['act'];

  beforeEach(async () => {
    // jsdom is a test-only DOM; no Hosted request is made.
    const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => {
      window: Window & typeof globalThis;
    } };
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
    Object.defineProperty(globalThis, 'HTMLElement', { configurable: true,
      value: dom.window.HTMLElement });
    Object.defineProperty(globalThis, 'Event', { configurable: true, value: dom.window.Event });
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      configurable: true, value: true,
    });
    const reactDom = require('react-dom/client') as typeof import('react-dom/client');
    act = (require('react') as typeof import('react')).act;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = reactDom.createRoot(container);
    jest.clearAllMocks();
    availability.mockResolvedValue({ enabled: true });
    preview.mockResolvedValue(draft);
    await act(async () => {
      root.render(createElement(ApplicabilitySelectionReviewAction, {
        workItemId: 'WI-1', workItemRevision: 7,
        onConfirmed: async () => undefined,
      }));
    });
    await click('确认受控评估目标');
    await setInput('applicability-aircraft', 'B-1234');
    await setInput('applicability-as-of', '2026-08-27');
    await click('核对目标与来源');
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it('locks the same draft after POST and readback fail, including a repeat click', async () => {
    confirmSelection.mockRejectedValue(new Error('TRANSPORT_RESPONSE_LOST'));
    readSelection.mockRejectedValue(new Error('READ_UNAVAILABLE'));
    readStatus.mockRejectedValue(new Error('STATUS_UNAVAILABLE'));
    await click('确认并保存该评估目标');
    expect(confirmSelection).toHaveBeenCalledTimes(1);
    expect(button('确认并保存该评估目标').disabled).toBe(true);
    await click('确认并保存该评估目标');
    expect(confirmSelection).toHaveBeenCalledTimes(1);
    await click('只读核对当前保存状态');
    expect(confirmSelection).toHaveBeenCalledTimes(1);
    expect(button('确认并保存该评估目标').disabled).toBe(true);
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it('locks a mismatched readback until read-only recovery and a new preview', async () => {
    confirmSelection.mockRejectedValue(new Error('TRANSPORT_RESPONSE_LOST'));
    readSelection.mockResolvedValue({ ...draft, workItemRevision: 7,
      fleetSource: draft.fleetSource });
    readStatus.mockResolvedValue({ workItemId: 'WI-1', documentVersionId: 'DV-1',
      workItemRevision: 7 });
    await click('确认并保存该评估目标');
    expect(button('确认并保存该评估目标').disabled).toBe(true);
    expect(confirmSelection).toHaveBeenCalledTimes(1);
    await click('只读核对当前保存状态');
    expect(document.body.textContent).not.toContain('确认并保存该评估目标');
    expect(preview).toHaveBeenCalledTimes(1);
    await click('核对目标与来源');
    expect(preview).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain('确认并保存该评估目标');
    preview.mockResolvedValue({ ...draft, confirmationToken: 'b'.repeat(64) });
    await click('核对目标与来源');
    expect(preview).toHaveBeenCalledTimes(3);
    confirmSelection.mockResolvedValue({ ...draft, workItemRevision: 8 });
    await click('确认并保存该评估目标');
    expect(confirmSelection).toHaveBeenCalledTimes(2);
    expect(confirmSelection.mock.calls[1][1].draft.confirmationToken)
      .toBe('b'.repeat(64));
  });

  async function click(label: string): Promise<void> {
    await act(async () => { button(label).click(); });
  }

  function button(label: string): HTMLButtonElement {
    const found = [...document.querySelectorAll('button')].find(
      candidate => candidate.textContent?.includes(label),
    );
    if (!found) throw new Error(`BUTTON_NOT_FOUND:${label}`);
    return found;
  }

  async function setInput(id: string, value: string): Promise<void> {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (!input) throw new Error(`INPUT_NOT_FOUND:${id}`);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value',
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
});
