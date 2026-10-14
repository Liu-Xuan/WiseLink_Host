import { act, createElement, type AnchorHTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

const readOriginal = jest.fn();
jest.mock('@lark-apaas/client-toolkit/components/UniversalLink', () => ({
  UniversalLink: ({ to, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) =>
    createElement('a', { ...props, href: to }),
}));
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
  subscribeCanonicalHostClientSession: () => () => undefined,
  readDocumentVersionOriginal: (...args: unknown[]) => readOriginal(...args),
  readDocumentVersionOriginalIdentity: jest.fn(),
}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));

import { DocumentOriginalInlinePreview } from '@client/src/pages/WorkspaceHomePage/DocumentOriginalPreview';
import { clearDocumentOriginalMemory } from '@client/src/utils/document-original-memory';

describe('direct PDF is bound to the explicitly selected version', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const createUrl = jest.fn();
  const revokeUrl = jest.fn();

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><body></body>', { url: 'https://test.invalid/library' });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    originals.set('createObjectURL', Object.getOwnPropertyDescriptor(URL, 'createObjectURL'));
    originals.set('revokeObjectURL', Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL'));
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
    createUrl.mockReset().mockReturnValue('blob:selected-version-pdf');
    revokeUrl.mockReset();
    readOriginal.mockReset();
    clearDocumentOriginalMemory();
    container = dom.window.document.createElement('div');
    dom.window.document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    clearDocumentOriginalMemory();
    dom.window.close();
    for (const [key, descriptor] of originals) {
      const target = key === 'createObjectURL' || key === 'revokeObjectURL' ? URL : globalThis;
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else Reflect.deleteProperty(target, key);
    }
    originals.clear();
  });

  async function select(versionId: string): Promise<void> {
    await act(async () => root.render(createElement(DocumentOriginalInlinePreview, {
      key: versionId, documentVersionId: versionId, autoLoad: true,
    })));
  }

  it('keeps a late old-version response out of the new PDF pane', async () => {
    let resolveOld!: (value: Blob) => void;
    const old = new Promise<Blob>(resolve => { resolveOld = resolve; });
    readOriginal.mockImplementation((id: string) => id === 'DV-OLD' ? old
      : Promise.resolve(new Blob(['%PDF-selected-new'], { type: 'application/pdf' })));
    await select('DV-OLD');
    expect(container.querySelector('iframe')).toBeNull();
    await select('DV-NEW');
    expect(readOriginal.mock.calls.map(([id]) => id)).toEqual(['DV-OLD', 'DV-NEW']);
    expect(container.querySelector('iframe')?.getAttribute('src')).toContain('blob:selected-version-pdf');
    await act(async () => resolveOld(new Blob(['%PDF-stale-old'], { type: 'application/pdf' })));
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(container.querySelector('iframe')?.getAttribute('src')).toContain('blob:selected-version-pdf');
  });

  it('shows an exact-version failure and does not request a replacement PDF', async () => {
    readOriginal.mockRejectedValue(new Error('DOCUMENT_ORIGINAL_NOT_PDF'));
    await select('DV-NON-PDF');
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toContain('原件读取失败');
    expect(readOriginal).toHaveBeenCalledTimes(1);
    expect(readOriginal.mock.calls[0][0]).toBe('DV-NON-PDF');
    expect(createUrl).not.toHaveBeenCalled();
  });
});
