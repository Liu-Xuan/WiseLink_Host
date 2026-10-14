import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { LibrarySourceDirectory } from '@client/src/pages/WorkspaceHomePage/LibrarySourceDirectory';
import { getCanonicalLibraryDirectory } from '@client/src/api/canonical-host';
import { libraryCatalogueQuery, LIBRARY_CATALOG_PAGED_QUERY_BUDGET } from '@shared/library-aircraft-mentions';
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/api/canonical-host', () => ({ getCanonicalLibraryDirectory: jest.fn() }));

it.each(['[]', '{broken-json', JSON.stringify([''])])('renders a controlled directory error for %s without synchronously throwing or reading all documents', async (aircraftModels: string) => {
  const dom = new JSDOM('<div id="root"></div>');
  const properties = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'];
  const original = new Map(properties.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperties(globalThis, { window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document }, IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true } });
  const root = createRoot(dom.window.document.querySelector('#root')!);
  jest.mocked(getCanonicalLibraryDirectory).mockClear();
  try {
    await act(async () => root.render(createElement(LibrarySourceDirectory, { search: '', filters: { aircraftModels },
      sessionGeneration: 1, authenticationRequired: false, refreshRevision: 0, scheme: 'ispec', onFilterChange: jest.fn() })));
    expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toContain('机型筛选参数无效');
    expect(getCanonicalLibraryDirectory).not.toHaveBeenCalled();
    expect(dom.window.document.querySelector('.library-source-directory-node')).toBeNull();
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const key of properties) { const prior = original.get(key);
      if (prior) Object.defineProperty(globalThis, key, prior); else Reflect.deleteProperty(globalThis, key); }
  }
});

it('uses the same exact percent-encoded query budget for callers and Host rather than truncating source models', () => {
  const models = Array.from({ length: 16 }, (_, index: number) => `${index}型号\\"`);
  const first = libraryCatalogueQuery({ aircraftModels: models, search: 'document' });
  const next = libraryCatalogueQuery({ aircraftModels: models, search: 'document', cursor: 'c'.repeat(1800) });
  expect(new URLSearchParams(first).get('aircraftModels')).toBe(JSON.stringify([...models].sort()));
  expect(Buffer.byteLength(`/api/canonical-host/library/documents?${next}`, 'utf8')).toBeLessThan(LIBRARY_CATALOG_PAGED_QUERY_BUDGET);
  expect(() => libraryCatalogueQuery({ aircraftModels: Array.from({ length: 32 }, (_, index: number) => `${index}型`.padEnd(96, '号')) })).toThrow('LIBRARY_AIRCRAFT_MODELS_TOO_LONG');
  expect(() => libraryCatalogueQuery({ aircraftModels: models, search: '型'.repeat(400) })).toThrow('LIBRARY_CATALOG_QUERY_TOO_LONG');
  for (const aircraftModels of [null, '', []])
    expect(() => libraryCatalogueQuery({ aircraftModels })).toThrow('LIBRARY_AIRCRAFT_MODELS_INVALID');
});
