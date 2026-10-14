import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import type { CanonicalLibraryDirectoryRequest, CanonicalLibraryDirectoryResponse } from '@shared/library-directory.interface';
import { LibrarySourceDirectory } from '@client/src/pages/WorkspaceHomePage/LibrarySourceDirectory';
import type { LibraryCatalogFilters } from '@client/src/pages/WorkspaceHomePage/library-classification';

const readDirectory = jest.fn();
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalLibraryDirectory: (...args: unknown[]) => readDirectory(...args),
}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));

function directory(input: CanonicalLibraryDirectoryRequest): CanonicalLibraryDirectoryResponse {
  if (input.ata2) return { scope: 'TENANT_DOCUMENT_CATALOG', level: 'ATA4', documentCount: 2,
    versionCount: 4, directDocumentCount: 1, directVersionCount: 2, nodes: [{ level: 'ATA4', value: '27-11',
      documentCount: 1, versionCount: 2, directDocumentCount: 0, directVersionCount: 0,
      rawValues: ['27-11', '2711'], hasChildren: false }] };
  if (input.aircraftModel) return { scope: 'TENANT_DOCUMENT_CATALOG', level: 'ATA2', documentCount: 2,
    versionCount: 4, directDocumentCount: 0, directVersionCount: 0, nodes: [
      { level: 'ATA2', value: '27', documentCount: 2, versionCount: 4, directDocumentCount: 1,
        directVersionCount: 2, rawValues: ['27', '27-11'], hasChildren: true },
      { level: 'ATA2', value: '28', documentCount: 1, versionCount: 2, directDocumentCount: 1,
        directVersionCount: 2, rawValues: ['28'], hasChildren: false },
    ] };
  return { scope: 'TENANT_DOCUMENT_CATALOG', level: 'AIRCRAFT_MODEL', documentCount: 2, versionCount: 4,
    directDocumentCount: 0, directVersionCount: 0, nodes: [
      { level: 'AIRCRAFT_MODEL', value: '787-9', documentCount: 2, versionCount: 4,
        directDocumentCount: 0, directVersionCount: 0, rawValues: ['787-9'], hasChildren: true },
      { level: 'AIRCRAFT_MODEL', value: '__UNKNOWN__', documentCount: 1, versionCount: 2,
        directDocumentCount: 0, directVersionCount: 0, rawValues: [], hasChildren: false },
    ] };
}

describe('authoritative current-version library directory', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const onFilterChange = jest.fn();

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><body></body>');
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    container = dom.window.document.createElement('div');
    dom.window.document.body.append(container);
    root = createRoot(container);
    readDirectory.mockReset().mockImplementation(async (input: CanonicalLibraryDirectoryRequest) => directory(input));
    onFilterChange.mockReset();
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

  async function mount(filters: LibraryCatalogFilters = {}, sessionGeneration = 1): Promise<void> {
    await act(async () => root.render(createElement(LibrarySourceDirectory, { search: 'engine', filters,
      sessionGeneration, authenticationRequired: false, refreshRevision: 0, scheme: 'ispec', onFilterChange })));
  }
  async function clickLabel(label: string): Promise<void> {
    const button = container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
    expect(button).not.toBeNull();
    await act(async () => button.click());
  }

  it('loads one node at a time and keeps independent de-duplicated counts and genuine ATA2-only rows', async () => {
    await mount({ fleetFamily: '787' });
    expect(readDirectory).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('全部机型资料2 份 · 4 版');
    expect(container.textContent).toContain('机型未分类');
    await clickLabel('展开787-9');
    expect(readDirectory).toHaveBeenCalledTimes(2);
    expect(readDirectory.mock.calls[1][0]).toEqual({ search: 'engine', fleetFamily: '787', aircraftModel: '787-9' });
    expect(container.textContent).toContain('ATA27');
    expect(container.textContent).toContain('本级资料（仅有 ATA2）');
    expect(container.textContent).not.toContain('ATA4 未细分 / 待核');
    const expansion = [...container.querySelectorAll('button[aria-label]')]
      .find(button => button.getAttribute('aria-label')?.startsWith('展开ATA27')) as HTMLButtonElement;
    await act(async () => expansion.click());
    expect(readDirectory).toHaveBeenCalledTimes(3);
    expect(readDirectory.mock.calls[2][0]).toMatchObject({ aircraftModel: '787-9', ata2: '27', fleetFamily: '787' });
    const leaf = [...container.querySelectorAll('button.suite-folder-row')]
      .find(button => button.textContent?.startsWith('ATA27-11')) as HTMLButtonElement;
    await act(async () => leaf.click());
    expect(onFilterChange).toHaveBeenLastCalledWith({ fleetFamily: '787', ata: '', aircraftModel: '787-9', ata2: '27', ata4: '27-11' });
    const direct = container.querySelector('button.library-directory-direct') as HTMLButtonElement;
    await act(async () => direct.click());
    expect(onFilterChange).toHaveBeenLastCalledWith({ fleetFamily: '787', ata: '', aircraftModel: '787-9', ata2: '27', ata4: '__DIRECT__' });
    // Child document counts overlap; parent count remains the Host's two, not 2 + 1.
    expect(container.textContent).toContain('全部机型资料2 份 · 4 版');
  });

  it('shows directory request failure and does not replace it with an empty or loaded-page catalog', async () => {
    readDirectory.mockRejectedValue({ statusCode: 503, code: 'CANONICAL_DIRECTORY_UNAVAILABLE' });
    await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('目录读取失败');
    expect(container.textContent).not.toContain('当前目录范围没有正式文档');
    expect(container.textContent).not.toContain('全部机型资料');
  });
});
