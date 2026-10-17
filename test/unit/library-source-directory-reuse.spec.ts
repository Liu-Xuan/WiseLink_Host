import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import type {
  CanonicalLibraryDirectoryNode,
  CanonicalLibraryDirectoryResponse,
} from '@shared/library-directory.interface';
import { getCanonicalLibraryDirectory } from '@client/src/api/canonical-host';
import { LibrarySourceDirectory } from '@client/src/pages/WorkspaceHomePage/LibrarySourceDirectory';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/api/canonical-host', () => ({ getCanonicalLibraryDirectory: jest.fn() }));

const readDirectory = jest.mocked(getCanonicalLibraryDirectory);

function catalog(level: CanonicalLibraryDirectoryNode['level'], values: string[]): CanonicalLibraryDirectoryResponse {
  return {
    scope: 'TENANT_DOCUMENT_CATALOG', level,
    documentCount: values.length, versionCount: values.length,
    directDocumentCount: 0, directVersionCount: 0,
    nodes: values.map((value: string): CanonicalLibraryDirectoryNode => ({
      level, value, documentCount: 1, versionCount: 1,
      directDocumentCount: 0, directVersionCount: 0,
      rawValues: [value], hasChildren: level === 'ATA2',
    })),
  };
}

describe('visited ATA directory reads', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLElement;
  let props: ComponentProps<typeof LibrarySourceDirectory>;
  const originals = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    dom = new JSDOM('<div id="root"></div>');
    for (const [key, value] of Object.entries({ window: dom.window,
      document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
    container = dom.window.document.getElementById('root')!;
    root = createRoot(container);
    props = { search: '', filters: {}, sessionGeneration: 1,
      authenticationRequired: false, refreshRevision: 0, scheme: 'ispec', onFilterChange: jest.fn() };
    readDirectory.mockReset().mockImplementation(async (input) => input.ata2
      ? catalog('ATA4', ['3139']) : catalog('ATA2', ['31', '34']));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });

  async function render(next: Partial<typeof props> = {}): Promise<void> {
    props = { ...props, ...next };
    await act(async () => root.render(createElement(LibrarySourceDirectory, props)));
  }

  async function toggle(ata = '31'): Promise<void> {
    const button = container.querySelector<HTMLButtonElement>(
      `.library-directory-expand[aria-label*="ATA${ata} "]`,
    );
    expect(button).not.toBeNull();
    await act(async () => button!.click());
  }

  it('loads only visited nodes and reopens the same authorized DOM without another GET', async () => {
    await render();
    expect(readDirectory).toHaveBeenCalledTimes(1);
    await toggle();
    expect(readDirectory).toHaveBeenCalledTimes(2);
    const child = container.querySelector('[data-directory-level="ATA4"]')!;
    expect(child).not.toBeNull();

    for (let index = 0; index < 10; index += 1) {
      await toggle();
      expect(child.closest<HTMLElement>('.library-source-directory-children')?.hidden).toBe(true);
      await toggle();
      expect(container.querySelector('[data-directory-level="ATA4"]')).toBe(child);
      expect(child.closest<HTMLElement>('.library-source-directory-children')?.hidden).toBe(false);
    }
    expect(readDirectory).toHaveBeenCalledTimes(2);
    expect(readDirectory.mock.calls.some(([input]) => input.ata2 === '34')).toBe(false);
  });

  it('retains an automatically opened path after selection moves elsewhere', async () => {
    await render({ filters: { ata2: '31' } });
    expect(readDirectory).toHaveBeenCalledTimes(2);
    const child = container.querySelector('[data-directory-level="ATA4"]');
    await render({ filters: {} });
    await toggle();
    expect(container.querySelector('[data-directory-level="ATA4"]')).toBe(child);
    expect(readDirectory).toHaveBeenCalledTimes(2);
  });

  it.each(['refresh', 'session', 'search', 'models'])(
    'discards prior nodes and reads the current scope after %s changes', async (change: string) => {
      await render();
      await toggle();
      await toggle();
      readDirectory.mockImplementation(async (input) => input.ata2
        ? catalog('ATA4', ['3199']) : catalog('ATA2', ['31', '34']));
      await render(change === 'refresh' ? { refreshRevision: 1 }
        : change === 'session' ? { sessionGeneration: 2 }
          : change === 'search' ? { search: 'new-scope' }
            : { filters: { aircraftModels: '["737-800"]' } });
      expect(container.querySelector('[data-directory-level="ATA4"]')).toBeNull();
      await toggle();
      expect(container.querySelector('[data-directory-level="ATA4"]')?.textContent).toContain('3199');
      expect(readDirectory).toHaveBeenCalledTimes(4);
    },
  );

  it('rejects a late response from a prior identity after a closed pending read', async () => {
    let resolveOld!: (value: CanonicalLibraryDirectoryResponse) => void;
    const pending = new Promise<CanonicalLibraryDirectoryResponse>((resolve) => { resolveOld = resolve; });
    readDirectory.mockImplementation(async (input) => input.ata2 ? pending : catalog('ATA2', ['31']));
    await render();
    await toggle();
    await toggle();
    readDirectory.mockImplementation(async (input) => input.ata2
      ? catalog('ATA4', ['3199']) : catalog('ATA2', ['31']));
    await render({ sessionGeneration: 2 });
    await toggle();
    await act(async () => resolveOld(catalog('ATA4', ['3139'])));
    expect(container.querySelector('[data-directory-level="ATA4"]')?.textContent).toContain('3199');
    expect(container.textContent).not.toContain('3139');
  });

  it.each([401, 403, 404])('clears the whole directory on a hidden pending read rejection (%s)', async (statusCode: number) => {
    let rejectRead!: (error: unknown) => void;
    const pending = new Promise<CanonicalLibraryDirectoryResponse>((_resolve, reject) => { rejectRead = reject; });
    readDirectory.mockImplementation(async (input) => input.ata2 ? pending : catalog('ATA2', ['31']));
    await render();
    await toggle();
    await toggle();
    await act(async () => rejectRead({ statusCode }));
    expect(container.querySelector('.library-source-directory-node')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('原目录已清除');
  });

  it('clears mounted directory state when authentication becomes required', async () => {
    await render();
    await toggle();
    await toggle();
    await render({ authenticationRequired: true });
    expect(container.querySelector('.library-source-directory-node')).toBeNull();
    expect(container.textContent).toContain('请先登录');
  });
});
