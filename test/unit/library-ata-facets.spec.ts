import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { LibraryAtaFacetDirectory } from '@client/src/pages/WorkspaceHomePage/LibraryAtaFacetDirectory';
import { buildLibraryAtaFacets } from '@client/src/pages/WorkspaceHomePage/library-ata-directory';

const counts = { '23': 2, '2310': 3, '3141': 1, '3461': 2, '3462': 2, '24-41': 4, '31-39': 2, '4600-00': 1, '__UNKNOWN__': 3, '': 1 };
it('groups compact observations under named ATA2 while preserving every raw facet and its original distinct-family count', () => {
  const before = JSON.stringify(counts);
  const chapters = buildLibraryAtaFacets(counts);
  expect(chapters.find(chapter => chapter.key === '23')?.label).toBe('ATA23 通信');
  expect(chapters.find(chapter => chapter.key === '34')?.entries.map(entry => entry.value)).toEqual(['3461', '3462']);
  expect(chapters.find(chapter => chapter.key === '__RAW__')?.entries.map(entry => entry.value))
    .toEqual(['', '24-41', '31-39', '4600-00']);
  expect(chapters.flatMap(chapter => chapter.entries).map(entry => [entry.value, entry.count]).sort())
    .toEqual(Object.entries(counts).sort());
  expect(chapters.some(chapter => 'count' in chapter)).toBe(false);
  expect(JSON.stringify(counts)).toBe(before);
});

it('expands the selected chapter and filters by the exact original value without dropping special codes', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  const select = jest.fn();
  try {
    await act(async () => root.render(createElement(LibraryAtaFacetDirectory, { counts, selected: '3461', onSelect: select })));
    const selected = dom.window.document.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')!;
    expect(selected.closest('details')?.open).toBe(true);
    expect(selected.title).toContain('原始 ATA：3461');
    await act(async () => selected.click());
    expect(select).toHaveBeenLastCalledWith('3461');
    const raw = [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.title.startsWith('原始 ATA：4600-00'))!;
    await act(async () => raw.click());
    expect(select).toHaveBeenLastCalledWith('4600-00');
    expect(dom.window.document.body.textContent).toContain('未取得 ATA 标注');
    expect(dom.window.document.body.textContent).toContain('空 ATA 标注（保留）');
    const blank = [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.title.startsWith('原始 ATA：空值'))!;
    expect(blank.disabled).toBe(true);
    const before = select.mock.calls.length;
    await act(async () => root.render(createElement(LibraryAtaFacetDirectory, { counts, selected: '', disabled: true, onSelect: select })));
    await act(async () => dom.window.document.querySelector<HTMLButtonElement>('button')!.click());
    expect(select).toHaveBeenCalledTimes(before);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
