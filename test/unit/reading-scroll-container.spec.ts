import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import useReadingLocation from '@client/src/features/matter/useReadingLocation';

const { JSDOM } = require('jsdom');
const mockRead = jest.fn();
const mockSave = jest.fn();
jest.mock('@client/src/features/matter/reading-location', () => ({
  readReadingLocation: (...args: unknown[]) => mockRead(...args),
  saveReadingLocation: (...args: unknown[]) => mockSave(...args),
}));

function Reader() {
  const save = useReadingLocation('matter:exact-work', 3, true, {
    claim: null,
    focusClaimId: null,
    discussionClaimId: null,
  });
  return createElement('button', { onClick: () => save() }, '进入原文');
}

let dom: InstanceType<typeof JSDOM>;
let root: Root;
const previous = new Map<string, PropertyDescriptor | undefined>();

beforeEach(() => {
  dom = new JSDOM(
    '<!doctype html><div id="main-content"><div id="reader"></div></div>',
  );
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  mockRead.mockReset().mockReturnValue({ scrollY: 420, claim: null });
  mockSave.mockReset();
  dom.window.scrollTo = jest.fn();
  root = createRoot(dom.window.document.getElementById('reader'));
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  previous.clear();
});

test('return restores the shell content position and leaving captures that same scroller', async () => {
  const scroller = document.getElementById('main-content')!;
  scroller.setAttribute('data-reading-scroll-container', '');
  scroller.scrollTo = jest.fn((options?: ScrollToOptions | number, y?: number) => {
    scroller.scrollTop = typeof options === 'number' ? y ?? 0 : options?.top ?? 0;
  });
  await act(async () => root.render(createElement(Reader)));
  expect(scroller.scrollTop).toBe(420);
  expect(window.scrollTo).not.toHaveBeenCalled();
  scroller.scrollTop = 780;
  await act(async () => document.querySelector('button')!.click());
  expect(mockSave).toHaveBeenLastCalledWith(
    'matter:exact-work',
    expect.objectContaining({ scrollY: 780 }),
    3,
  );
});

test('a standalone reader without the application shell retains window scrolling', async () => {
  await act(async () => root.render(createElement(Reader)));
  expect(window.scrollTo).toHaveBeenCalledWith({
    top: 420,
    behavior: 'instant',
  });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 650 });
  await act(async () => document.querySelector('button')!.click());
  expect(mockSave).toHaveBeenLastCalledWith(
    'matter:exact-work',
    expect.objectContaining({ scrollY: 650 }),
    3,
  );
});
