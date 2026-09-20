import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { useLibraryDefaultSelection } from '../../client/src/pages/WorkspaceHomePage/useLibraryDefaultSelection';

let dom: JSDOM;
const priorGlobals = new Map<string, PropertyDescriptor | undefined>();

beforeAll(() => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/' });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    priorGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
});

afterAll(() => {
  dom.window.close();
  for (const [key, descriptor] of priorGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

interface SelectionState {
  mode: 'matter' | 'document' | 'tasks';
  firstId?: string;
  loading?: boolean;
  hasError?: boolean;
  authenticationRequired?: boolean;
}

function SelectionPage(props: SelectionState) {
  useLibraryDefaultSelection(
    props.mode,
    props.firstId,
    props.loading ?? false,
    props.hasError ?? false,
    props.authenticationRequired ?? false,
  );
  const location = useLocation();
  return createElement('output', null, location.search);
}

function mount(initialUrl: string, state: SelectionState) {
  const host = document.createElement('div');
  const root: Root = createRoot(host);
  const render = (next: SelectionState) => {
    act(() => root.render(createElement(MemoryRouter, {
      initialEntries: [initialUrl],
      future: { v7_startTransition: true, v7_relativeSplatPath: true },
    },
      createElement(SelectionPage, next))));
    return new URLSearchParams(host.querySelector('output')?.textContent ?? '');
  };
  const params = render(state);
  return { params, render, unmount: () => act(() => root.unmount()) };
}

describe('authorized library default selection', () => {
  it('selects the first real matter only after its directory loads', () => {
    const page = mount('/library?search=valve', { mode: 'matter', firstId: 'MAT-1', loading: true });
    expect(page.params.has('selectedMatterId')).toBe(false);
    const selected = page.render({ mode: 'matter', firstId: 'MAT-1' });
    expect(selected.get('selectedMatterId')).toBe('MAT-1');
    expect(selected.get('search')).toBe('valve');
    expect(page.render({ mode: 'matter', firstId: 'MAT-2' }).get('selectedMatterId')).toBe('MAT-1');
    page.unmount();
  });

  it('keeps an explicit selection while later pages or filters load', () => {
    const page = mount('/library?mode=matter&selectedMatterId=MAT-LATER', {
      mode: 'matter', firstId: 'MAT-1',
    });
    expect(page.params.get('selectedMatterId')).toBe('MAT-LATER');
    page.unmount();
  });

  it('does not select from an error, an unauthenticated directory, or a version-only link', () => {
    const failed = mount('/library?mode=matter', { mode: 'matter', firstId: 'MAT-1', hasError: true });
    expect(failed.params.has('selectedMatterId')).toBe(false);
    failed.unmount();
    const unauthenticated = mount('/library?mode=matter', { mode: 'matter', firstId: 'MAT-1', authenticationRequired: true });
    expect(unauthenticated.params.has('selectedMatterId')).toBe(false);
    unauthenticated.unmount();
    const version = mount('/library?mode=document&selectedDocumentVersionId=DV-9', { mode: 'document', firstId: 'FAM-1' });
    expect(version.params.has('familyId')).toBe(false);
    version.unmount();
  });

  it('opens the first authorized document family without losing the reading context', () => {
    const page = mount('/library?mode=document&density=compact', { mode: 'document', firstId: 'FAM-1' });
    expect(page.params.get('familyId')).toBe('FAM-1');
    expect(page.params.get('density')).toBe('compact');
    page.unmount();
  });
});
