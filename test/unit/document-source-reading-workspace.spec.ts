import { act, createElement, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { DocumentSourceReadingWorkspace } from '../../client/src/pages/DocumentParsingPage/DocumentSourceReadingWorkspace';
import RetainedWorkbenchPanel from '../../client/src/features/workbench/RetainedWorkbenchPanel';
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
    default: ({ page, autoLoad, readingScope, onVisiblePageChange }: { page: number; autoLoad?: boolean; readingScope?: string; onVisiblePageChange?: (page: number) => void }) => {
      React.useEffect(() => {
        mockPdfMounts += 1;
        return () => { mockPdfUnmounts += 1; };
      }, []);
      return React.createElement('div', { 'data-pdf-page': page, 'data-auto-load': String(autoLoad), 'data-reading-scope': readingScope, onClick: () => onVisiblePageChange?.(3) }, 'PDF');
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
    const selectedLocations = jest.fn();
    function StatefulWorkspace() {
      const [mode, setMode] = useState<'dual' | 'bilingual' | 'translation' | 'original' | 'pdf'>('dual');
      return createElement(MemoryRouter, null, createElement(DocumentSourceReadingWorkspace, {
        original,
        documentVersionId: original.binding.documentVersionId,
        mode,
        onModeChange: setMode,
        onLocationSelect: selectedLocations,
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
      await act(async () => container.querySelector('[data-unit-id="u2"]')!.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true }),
      ));
      expect(selectedLocations).toHaveBeenCalledWith(2, 'u2');
      expect(container.querySelector('[data-pdf-page="2"]')).not.toBeNull();
      const pdf = container.querySelector('[data-pdf-page="2"]')!;
      expect(JSON.parse(pdf.getAttribute('data-reading-scope')!)).toEqual([
        original.binding.documentVersionId, original.binding.parseRunId, original.binding.parseRevision,
        original.binding.sourceArtifactId, original.binding.sourceSha256,
      ]);
      await act(async () => pdf.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
      expect(container.textContent).toContain('第 3 页');
      // An observed manual page updates the label, not the source target command.
      expect(container.querySelector('[data-pdf-page="2"]')).not.toBeNull();
      expect(selectedLocations).toHaveBeenCalledTimes(1);
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

  it.each([
    ...([375, 760, 761, 899, 900] as const).flatMap(width =>
      (['dual', 'pdf', 'original', 'bilingual', 'translation'] as const).flatMap(mode =>
        ([true, false] as const).map(active => [width, mode, active] as const))),
  ] as const)('mounts PDF on ordinary %ipx entry only when mode %s and workspace active %s allow it', async (width, initialMode, initialActive) => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<div id="root"></div>');
    Object.defineProperty(dom.window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: query === '(max-width: 760px)' ? width <= 760 : width >= 761,
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
      const [mode, setMode] = useState<'dual' | 'bilingual' | 'translation' | 'original' | 'pdf'>(initialMode);
      const [active, setActive] = useState(initialActive);
      return createElement(MemoryRouter, null,
        createElement('button', { onClick: () => setActive(true) }, '显示工作区'),
        createElement(RetainedWorkbenchPanel, { active, children:
          createElement(DocumentSourceReadingWorkspace, {
            original,
            documentVersionId: original.binding.documentVersionId,
            mode,
            onModeChange: setMode,
            bilingualContent: createElement('div', null, '已保存中英内容'),
            returnRoute: '/library?mode=document',
            returnLabel: '返回文档库',
            title: 'SB-A R02.pdf',
          }),
        }));
    }
    const container = dom.window.document.getElementById('root')!;
    const root = createRoot(container);
    mockPdfMounts = 0;
    mockPdfUnmounts = 0;
    try {
      await act(async () => root.render(createElement(CompactWorkspace)));
      const initiallyShowsPdf = initialMode === 'dual' || initialMode === 'pdf';
      expect(mockPdfMounts).toBe(initialActive && initiallyShowsPdf ? 1 : 0);
      expect(container.textContent).not.toContain('查看原件');
      if (!initialActive) {
        await act(async () => [...container.querySelectorAll('button')]
          .find((item) => item.textContent === '显示工作区')!.click());
      }
      expect(mockPdfMounts).toBe(initiallyShowsPdf ? 1 : 0);
      if (!initiallyShowsPdf) {
        expect(container.querySelector('[data-pdf-page]')).toBeNull();
        await act(async () => [...container.querySelectorAll('button')]
          .find((item) => item.textContent === '仅原件')!.click());
      }
      expect(mockPdfMounts).toBe(1);
      const pdf = container.querySelector('[data-pdf-page="1"]')!;
      expect(pdf.getAttribute('data-auto-load')).toBe('true');
      expect(pdf.closest('[hidden]')).toBeNull();
      if (initialMode === 'dual') {
        expect(container.querySelector('.source-reader-primary')?.closest('[hidden]')).toBeNull();
      }
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

it.each([375, 760, 761, 899, 900])('keeps both dual surfaces in the CSS cascade at %ipx without a mobile reveal gate', width => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const postcss = require('postcss');
  const { JSDOM } = require('jsdom');
  const css = postcss.parse(readFileSync(join(__dirname,
    '../../client/src/pages/DocumentParsingPage/document-version-reading.css'), 'utf8'));
  // JSDOM does not evaluate media widths or layout. Resolve the declared width
  // branches only, then check display/visibility; this is not visual QA.
  css.walkAtRules((rule: import('postcss').AtRule) => {
    if (rule.name === 'import') { rule.remove(); return; }
    if (rule.name !== 'media') return;
    const match = /^\((max|min)-width: (\d+)px\)$/.exec(rule.params);
    if (!match || (match[1] === 'max' ? width > Number(match[2]) : width < Number(match[2]))) {
      rule.remove(); return;
    }
    rule.replaceWith(...(rule.nodes ?? []));
  });
  const dom = new JSDOM(markup().replace('source-reader-workspace', 'source-reader-workspace no-toc'));
  const style = dom.window.document.createElement('style');
  style.textContent = css.toString();
  dom.window.document.head.appendChild(style);
  try {
    for (const selector of ['.source-reader-primary', '.source-reader-pdf-pane']) {
      const element = dom.window.document.querySelector(selector)!;
      expect(dom.window.getComputedStyle(element).display).toBe('flex');
      expect(dom.window.getComputedStyle(element).visibility).not.toBe('hidden');
    }
    const stage = dom.window.document.querySelector('.source-reader-stage')!;
    expect(dom.window.getComputedStyle(stage).display).not.toBe('none');
    const columns = dom.window.document.querySelector('.source-reader-columns')!;
    expect(dom.window.getComputedStyle(columns).display).toBe(width <= 760 ? 'flex' : 'grid');
    if (width <= 760) expect(dom.window.getComputedStyle(columns).flexDirection).toBe('column');
  } finally { dom.window.close(); }
});
