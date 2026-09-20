import { act, createElement, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { DocumentSourceReadingWorkspace } from '../../client/src/pages/DocumentParsingPage/DocumentSourceReadingWorkspace';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

jest.mock('@client/src/pages/WorkspaceHomePage/DocumentOriginalPreview', () => ({
  useDocumentOriginalUrl: () => ({ url: null, busy: false, error: null, prepare: () => Promise.resolve() }),
  DocumentOriginalPreview: ({ children }: { children: string }) => createElement('span', null, children),
}));
let mockPdfMounts = 0;
let mockPdfUnmounts = 0;
jest.mock('../../client/src/pages/DocumentParsingPage/DocumentOriginalCanvasPreview', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ page }: { page: number }) => {
      React.useEffect(() => {
        mockPdfMounts += 1;
        return () => { mockPdfUnmounts += 1; };
      }, []);
      return React.createElement('div', { 'data-pdf-page': page }, 'PDF');
    },
  };
});
jest.mock('../../client/src/utils/document-original-url', () => ({
  useDocumentOriginalUrl: () => ({ url: null, busy: false, error: null, prepare: () => Promise.resolve() }),
}));
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({ asChild, children, ...props }: { asChild?: boolean; children: ReactNode }) =>
    asChild ? children : createElement('button', props, children),
}));

function markup(mode: 'dual' | 'bilingual' | 'translation' | 'original' | 'pdf' = 'dual') {
  const original = originalFixture();
  original.binding.parseRevision = 7;
  original.source.units[0] = {
    ...original.source.units[0],
    kind: 'heading',
    payload: { text: '1. Investigation scope' },
  };
  original.source.units = [original.source.units[0]];
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(DocumentSourceReadingWorkspace, {
        original,
        documentVersionId: original.binding.documentVersionId,
        mode,
        onModeChange: () => undefined,
        bilingualContent: createElement('div', null, '已保存中英内容'),
        returnRoute: '/library?mode=document',
        returnLabel: '返回文档库',
        title: 'SB-A R02.pdf',
        initialPage: 3,
      }),
    ),
  );
}

describe('document source reading workspace', () => {
  it('renders the exact source outline, fixed parse revision and accessible split control', () => {
    const html = markup();
    expect(html).toContain('1. Investigation scope');
    expect(html).toContain('阅读版本 7');
    expect(html).toContain('业务主题目录暂不可用');
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('data-pdf-page="3"');
  });

  it('keeps the five reader modes while hiding inactive reading surfaces', () => {
    const dual = markup('dual');
    const bilingual = markup('bilingual');
    const translation = markup('translation');
    expect(dual).toContain('原文＋原件');
    expect(dual).toContain('中英对照');
    expect(dual).toContain('中文阅读');
    expect(dual).toContain('仅原文');
    expect(dual).toContain('仅原件');
    expect(dual).toContain('class="source-reader-translation" hidden=""');
    expect(bilingual).toContain('已保存中英内容');
    expect(translation).toContain('已保存中英内容');
    expect(bilingual).toContain('class="source-reader-columns is-single"');
    expect(bilingual).toContain('style="--reader-split:50%" hidden=""');
    expect(bilingual).not.toContain('data-pdf-page="3"');
    expect(bilingual).toContain('role="separator"');
    expect(bilingual).toContain('tabindex="-1" hidden=""');
  });

  it('keeps the same authorized PDF instance mounted across reading modes', async () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<div id="root"></div>');
    const previous = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const original = originalFixture();
    function StatefulWorkspace() {
      const [mode, setMode] = useState<'dual' | 'bilingual' | 'translation' | 'original' | 'pdf'>('dual');
      return createElement(MemoryRouter, null, createElement(DocumentSourceReadingWorkspace, {
        original,
        documentVersionId: original.binding.documentVersionId,
        mode,
        onModeChange: setMode,
        bilingualContent: createElement('div', null, '已保存中英内容'),
        returnRoute: '/library?mode=document',
        returnLabel: '返回文档库',
        title: 'SB-A R02.pdf',
        initialPage: 3,
      }));
    }
    const container = dom.window.document.getElementById('root')!;
    const root = createRoot(container);
    mockPdfMounts = 0;
    mockPdfUnmounts = 0;
    try {
      await act(async () => root.render(createElement(StatefulWorkspace)));
      expect(mockPdfMounts).toBe(1);
      const clickMode = async (label: string) => {
        const button = [...container.querySelectorAll('button')]
          .find((item) => item.textContent === label);
        await act(async () => button?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
      };
      await clickMode('中英对照');
      expect(container.querySelector('.wl-retained-panel')?.hasAttribute('hidden')).toBe(true);
      await clickMode('原文＋原件');
      expect(mockPdfMounts).toBe(1);
      expect(mockPdfUnmounts).toBe(0);
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
    expect(mockPdfUnmounts).toBe(1);
  });

  it('defers the PDF on compact screens until the engineer opens it', async () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<div id="root"></div>');
    Object.defineProperty(dom.window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: query === '(max-width: 760px)',
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
    const previous = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const original = originalFixture();
    function CompactWorkspace() {
      const [mode, setMode] = useState<'dual' | 'bilingual' | 'translation' | 'original' | 'pdf'>('dual');
      return createElement(MemoryRouter, null, createElement(DocumentSourceReadingWorkspace, {
        original,
        documentVersionId: original.binding.documentVersionId,
        mode,
        onModeChange: setMode,
        bilingualContent: createElement('div', null, '已保存中英内容'),
        returnRoute: '/library?mode=document',
        returnLabel: '返回文档库',
        title: 'SB-A R02.pdf',
        initialPage: 3,
      }));
    }
    const container = dom.window.document.getElementById('root')!;
    const root = createRoot(container);
    mockPdfMounts = 0;
    mockPdfUnmounts = 0;
    try {
      await act(async () => root.render(createElement(CompactWorkspace)));
      expect(mockPdfMounts).toBe(0);
      const switchButton = [...container.querySelectorAll('button')]
        .find((item) => item.textContent === '查看原件');
      await act(async () => switchButton?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true }),
      ));
      expect(mockPdfMounts).toBe(1);
      expect(mockPdfUnmounts).toBe(0);
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
    expect(mockPdfUnmounts).toBe(1);
  });
});
