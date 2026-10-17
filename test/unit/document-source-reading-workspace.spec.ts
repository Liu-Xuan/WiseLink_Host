import { act, createElement, useState, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { DocumentSourceReadingWorkspace, type DocumentSourceReaderMode } from '../../client/src/pages/DocumentParsingPage/DocumentSourceReadingWorkspace';
import type { DocumentOriginalResult } from '../../shared/document-original.interface';
import RetainedWorkbenchPanel from '../../client/src/features/workbench/RetainedWorkbenchPanel';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';
import { DocumentReadingIdentity, DocumentReadingMore, DocumentReadingSavedLinks } from '../../client/src/pages/DocumentParsingPage/DocumentVersionReadingToolbar';

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
    default: ({ page, autoLoad, readingScope, targetSignal, onVisiblePageChange }: { page: number; autoLoad?: boolean; readingScope?: string; targetSignal?: string; onVisiblePageChange?: (page: number) => void }) => {
      React.useEffect(() => {
        mockPdfMounts += 1;
        return () => { mockPdfUnmounts += 1; };
      }, []);
      return React.createElement('div', { 'data-pdf-page': page, 'data-auto-load': String(autoLoad), 'data-reading-scope': readingScope, 'data-target-signal': targetSignal, onClick: () => onVisiblePageChange?.(3) }, 'PDF');
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

function markup(mode: 'dual' | 'bilingual' | 'translation' | 'original' | 'pdf' = 'dual', compact = false) {
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
        toolbar: compact ? {
          identity: createElement(DocumentReadingIdentity, { number: '737-SL-34-258',
            title: 'FLIGHT MANAGEMENT COMPUTER – UPDATE 14.1', version: 'ORIGINAL ISSUE', current: true }),
          links: createElement(DocumentReadingSavedLinks, { links: {
            assessmentRoute: '/work-items/exact/analysis?panel=assessment&documentVersionId=DV-TEST',
            wikiRoute: '/knowledge?subjectKind=WORK_ITEM&subjectId=exact&workRef=saved-work',
            assessmentNote: '同版本已保存评估', wikiNote: '同版本已保存工程知识', loading: false, error: null,
          } }),
          more: createElement(DocumentReadingMore, null,
            createElement('p', null, '阅读版本 7 · MinerU 3.0.9'),
            createElement('button', null, '重新解析')),
        } : undefined,
      }),
    ),
  );
}

describe('document source reading workspace', () => {
  it('keeps the compact toolbar inside the fullscreen surface and preserves directory control', async () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<div id="root"></div>');
    const previous = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    let fullscreenElement: HTMLElement | null = null;
    Object.defineProperty(dom.window.document, 'fullscreenElement', { get: () => fullscreenElement });
    dom.window.HTMLElement.prototype.requestFullscreen = async function(this: HTMLElement) {
      fullscreenElement = this;
      dom.window.document.dispatchEvent(new dom.window.Event('fullscreenchange'));
    };
    dom.window.document.exitFullscreen = async () => {
      fullscreenElement = null;
      dom.window.document.dispatchEvent(new dom.window.Event('fullscreenchange'));
    };
    const container: HTMLElement = dom.window.document.getElementById('root');
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(MemoryRouter, null,
        createElement(DocumentSourceReadingWorkspace, {
          original: originalFixture(), documentVersionId: 'DV-TEST', mode: 'dual',
          onModeChange: () => undefined, bilingualContent: null,
          returnRoute: '/library?mode=document', returnLabel: '返回文档库', title: 'Document',
          toolbar: { identity: createElement(DocumentReadingIdentity, {
            number: '737-SL-34-258', title: 'Long source title', version: 'R1', current: false,
          }), more: createElement(DocumentReadingMore, null, '文档处理') },
          renderPdfPreview: () => createElement('div', null, 'PDF fixture'),
        }))));
      const directory = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
      await act(async () => directory.click());
      expect(container.querySelector('.source-reader-toc')).toBeNull();
      await act(async () => directory.click());
      expect(container.querySelector('.source-reader-toc')).not.toBeNull();
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="全屏"]')!.click());
      expect(fullscreenElement).toBe(container.querySelector('.source-reader-workspace'));
      expect(container.querySelector('.source-reader-workspace h1')?.textContent).toBe('737-SL-34-258');
      expect(container.querySelector('button[aria-label="退出全屏"]')).not.toBeNull();
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="退出全屏"]')!.click());
      expect(fullscreenElement).toBeNull();
      expect(container.querySelectorAll('a[href="/library?mode=document"]')).toHaveLength(1);
    } finally {
      await act(async () => root.unmount()); dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });

  it('combines the document identity, exact saved entries and reader controls in one toolbar', () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM(markup('dual', true));
    try {
      const document = dom.window.document;
      const toolbar = document.querySelector('.source-reader-toolbar')!;
      expect(document.querySelectorAll('h1')).toHaveLength(1);
      expect(toolbar.querySelector('h1')?.textContent).toBe('737-SL-34-258');
      expect(toolbar.textContent).toContain('ORIGINAL ISSUE');
      expect(toolbar.querySelector('.document-reading-toolbar-identity p')?.getAttribute('title'))
        .toBe('FLIGHT MANAGEMENT COMPUTER – UPDATE 14.1');
      expect(toolbar.querySelector('.source-reader-identity')).toBeNull();
      expect(toolbar.querySelectorAll('.source-reader-mode-tabs button')).toHaveLength(5);
      expect(toolbar.querySelectorAll('a[href="/library?mode=document"]')).toHaveLength(1);
      expect(toolbar.querySelector('a[href*="documentVersionId=DV-TEST"]')).not.toBeNull();
      expect(toolbar.querySelector('a[href*="workRef=saved-work"]')).not.toBeNull();
      const more = toolbar.querySelector('details')!;
      expect(more.open).toBe(false);
      expect(more.textContent).toContain('MinerU 3.0.9');
      expect(toolbar.querySelector('.document-reading-more-panel button')?.textContent).toBe('重新解析');
    } finally { dom.window.close(); }
  });

  it('renders the exact source outline, fixed parse revision and accessible split control', () => {
    const html = markup();
    expect(html).toContain('1. Investigation scope');
    expect(html).toContain('阅读版本 7');
    expect(html).toContain('当前读取合同尚未提供业务主题目录');
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

it.each([375, 390, 760, 761, 899, 900, 1280])('keeps both dual surfaces in the CSS cascade at %ipx without a mobile reveal gate', width => {
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
    // JSDOM misserializes nested min()/calc(); inspect that declaration without claiming layout.
    const declaredValue = (selector: string, property: string): string | undefined => {
      const values: string[] = [];
      css.walkRules((rule: import('postcss').Rule) => {
        if (rule.selector.split(',').some((part: string) => part.trim() === selector)) rule.walkDecls(property, (declaration: import('postcss').Declaration) => {
          values.push(declaration.value);
        });
      });
      return values.pop();
    };
    if (width <= 760) expect(dom.window.getComputedStyle(columns).height).toBe('auto');
    else expect(declaredValue('.source-reader-workspace .source-reader-columns', 'height'))
      .toBe('min(660px, calc(100dvh - 210px))');
    expect(dom.window.getComputedStyle(columns).minHeight).toBe('0');
    expect(declaredValue('.source-reader-pdf-pane .parse-pdf-viewer', 'min-height')).toBe('0');
    expect(declaredValue('.source-reader-pdf-pane .parse-pdf-pages', 'min-height')).toBe('0');
    const toc = dom.window.document.querySelector('.source-reader-toc')!;
    if (width <= 760) {
      expect(dom.window.getComputedStyle(toc).display).toBe('none');
      dom.window.document.querySelector('.source-reader-workspace')!.classList.remove('no-toc');
      expect(dom.window.getComputedStyle(toc).maxHeight).toBe('48dvh');
    } else expect(declaredValue('.source-reader-workspace .source-reader-toc', 'max-height'))
      .toBe('min(660px, calc(100dvh - 210px))');
    if (width <= 760) expect(dom.window.getComputedStyle(columns).flexDirection).toBe('column');
  } finally { dom.window.close(); }
});

describe('bounded source chapter navigation', () => {
  const { JSDOM } = require('jsdom');
  let dom: InstanceType<typeof JSDOM>, container: HTMLElement, root: Root;
  let props: ComponentProps<typeof DocumentSourceReadingWorkspace>;
  let nextFrame: number;
  const frames = new Map<number, FrameRequestCallback>();
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const locations = jest.fn();
  const ancestorScroll = jest.fn();

  function chapterFixture(): DocumentOriginalResult {
    const original: DocumentOriginalResult = originalFixture();
    original.binding = { ...original.binding, parseRunId: 'PR-SYNTHETIC-8', parseRevision: 8 };
    original.coverage = { knownPageCount: 168, readPageIndexes: [56, 57, 167], unresolvedRanges: [] };
    const base: DocumentOriginalResult['source']['units'][number] = original.source.units[0];
    const chapters: Array<[string, string, string[]]> = [
      ['chapter-57', 'E. COMPLIANCE', ['ref-57']],
      ['chapter-168', 'FINAL CHAPTER', ['ref-168']],
      ['chapter-unknown', 'UNRESOLVED CHAPTER', ['ref-unknown']],
      ['chapter-multi', 'MULTI PAGE CHAPTER', ['ref-57', 'ref-58']],
    ];
    original.source.units = chapters.map(([unitId, label, refs]: [string, string, string[]], order: number) =>
      ({ ...base, unitId, order, kind: 'heading', payload: { text: label }, sourceRefIds: refs }));
    const pages: Array<[string, number | null]> = [
      ['ref-57', 56], ['ref-58', 57], ['ref-168', 167], ['ref-unknown', null],
    ];
    original.locations = pages.map(([sourceRefId, pageIndex]: [string, number | null]) =>
      ({ ...original.locations[0], sourceRefId, pageIndex }));
    original.source.sourceLocators = original.locations.map((location: DocumentOriginalResult['locations'][number]) =>
      ({ ...original.source.sourceLocators[0], sourceRefId: location.sourceRefId,
        pageStart: location.pageIndex, pageEnd: location.pageIndex }));
    return original;
  }
  function StatefulWorkspace() {
    const [mode, setMode] = useState<DocumentSourceReaderMode>(props.mode);
    return createElement(MemoryRouter, null, createElement(DocumentSourceReadingWorkspace,
      { ...props, key: `${props.original.binding.documentVersionId}:${props.original.binding.parseRunId}`,
        mode, onModeChange: setMode }));
  }
  async function paint(): Promise<void> {
    await act(async () => root.render(createElement(StatefulWorkspace)));
  }
  async function flushFrames(): Promise<void> {
    await act(async () => {
      const pending: FrameRequestCallback[] = [...frames.values()]; frames.clear();
      pending.forEach((callback: FrameRequestCallback) => callback(0));
    });
  }
  function geometry(): HTMLDivElement {
    const pane: HTMLDivElement = container.querySelector<HTMLDivElement>('.source-reader-pane-scroll')!;
    Object.defineProperty(pane, 'clientHeight', { configurable: true, get: () =>
      dom.window.innerWidth <= 760 && !container.querySelector('.source-reader-workspace.no-toc') ? 0 : 616 });
    Object.defineProperty(pane, 'scrollHeight', { configurable: true, value: 300000 });
    pane.getBoundingClientRect = () => new dom.window.DOMRect(0, 134 - container.scrollTop, 400, 616);
    pane.scrollTo = (options: ScrollToOptions | number) => {
      if (typeof options === 'number') throw new Error('Expected a bounded pane scroll request');
      pane.scrollTop = Math.max(0, Math.min(299384, options.top ?? 0));
    };
    for (const [unitId, offset] of Object.entries({ 'chapter-57': 120000, 'chapter-168': 259000,
      'chapter-unknown': 170000, 'chapter-multi': 180000 })) {
      container.querySelector<HTMLElement>(`[data-unit-id="${unitId}"]`)!.getBoundingClientRect =
        () => new dom.window.DOMRect(0, 134 + offset - pane.scrollTop - container.scrollTop, 400, 24);
    }
    return pane;
  }
  async function clickLabel(label: string): Promise<void> {
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button: HTMLButtonElement) => button.textContent === label)!.click());
  }
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://synthetic.example.test' });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    Object.defineProperty(dom.window, 'innerWidth', { configurable: true, writable: true, value: 1280 });
    dom.window.matchMedia = (query: string) => ({ matches: dom.window.innerWidth >= 761,
      media: query, addEventListener: () => undefined, removeEventListener: () => undefined });
    nextFrame = 0; frames.clear(); locations.mockReset(); ancestorScroll.mockReset();
    dom.window.requestAnimationFrame = (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; };
    dom.window.cancelAnimationFrame = (frame: number) => { frames.delete(frame); };
    container = dom.window.document.getElementById('root')!;
    // Model the real failure: scrollIntoView moves an ancestor while window.scrollY stays zero.
    dom.window.HTMLElement.prototype.scrollIntoView = ancestorScroll.mockImplementation(() => { container.scrollTop = 259000; });
    props = { original: chapterFixture(), documentVersionId: 'DV-TEST', mode: 'dual',
      onModeChange: () => undefined, onLocationSelect: locations, bilingualContent: null,
      returnRoute: '/library?mode=document', returnLabel: '返回文档库', title: 'Synthetic chapters' };
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    previous.clear();
  });
  it.each([[1280, 57], [1280, 168], [390, 57], [390, 168]])(
    'locates the registered chapter page at %ipx / P%i inside the text pane and the same PDF', async (width: number, page: number) => {
      dom.window.innerWidth = width;
      await paint(); const pane: HTMLDivElement = geometry();
      if (width <= 760) await clickLabel('目录');
      const heading: HTMLButtonElement = [...container.querySelectorAll<HTMLButtonElement>('nav[aria-label="作者章节目录"] button')]
        .find((button: HTMLButtonElement) => button.textContent?.endsWith(`P${page}`))!;
      await act(async () => heading.click()); await flushFrames();
      expect(pane.scrollTop).toBe(page === 57 ? 120000 : 259000);
      expect(container.scrollTop).toBe(0); expect(dom.window.scrollY).toBe(0);
      expect(ancestorScroll).not.toHaveBeenCalled();
      expect(locations).toHaveBeenLastCalledWith(page, `chapter-${page}`);
      expect(container.querySelector(`[data-pdf-page="${page}"]`)).not.toBeNull();
      expect(container.querySelector('.source-reader-toolbar button[aria-expanded]')).not.toBeNull();
      expect(container.querySelector('.source-reader-mode-tabs')?.querySelectorAll('button')).toHaveLength(5);
      if (width > 760) expect(container.querySelector('.source-reader-toc')).not.toBeNull();
    },
  );
  it.each(['unknown', 'multi'] as const)('does not command a PDF jump for a %s-page chapter and retains the existing locate action', async kind => {
    await paint(); geometry();
    const pdf: HTMLElement = container.querySelector<HTMLElement>('[data-pdf-page]')!;
    await act(async () => pdf.click()); // Manual observed page3 differs from the prior target page1.
    const signal: string | null = pdf.getAttribute('data-target-signal');
    await act(async () => container.querySelectorAll<HTMLButtonElement>('nav[aria-label="作者章节目录"] button')
      [kind === 'unknown' ? 2 : 3].click());
    await flushFrames();
    expect(locations).not.toHaveBeenCalled();
    expect(pdf.getAttribute('data-target-signal')).toBe(signal);
    expect(container.querySelector('.source-reader-pdf-pane .source-reader-pane-title')?.textContent).toContain('第 3 页');
    await act(async () => container.querySelector<HTMLElement>(`[data-unit-id="chapter-${kind}"]`)!.click());
    if (kind === 'unknown') {
      expect(container.textContent).toContain('没有可用的物理页定位');
      expect(locations).not.toHaveBeenCalled();
    } else {
      expect(container.querySelector('[aria-label="此段跨越多页，选择要定位的原件页"]')).not.toBeNull();
      expect(locations).not.toHaveBeenCalled();
      await clickLabel('第 58 页');
      expect(locations).toHaveBeenLastCalledWith(58, 'chapter-multi');
      expect(container.querySelector('[data-pdf-page="58"]')).not.toBeNull();
    }
    expect(ancestorScroll).not.toHaveBeenCalled();
  });
  it.each([
    ['pdf', 'unknown'], ['pdf', 'multi'], ['translation', 'unknown'], ['translation', 'multi'],
  ] as const)('keeps a %s-mode chapter selection with %s pages after leaving the initial URL source', async (mode, kind) => {
    props = { ...props, mode, initialPage: 57, initialUnitId: 'chapter-57', initialLocationRequest: 1 };
    await paint(); const pane: HTMLDivElement = geometry(); await flushFrames();
    const pdf: HTMLElement | null = container.querySelector<HTMLElement>('[data-pdf-page]');
    if (pdf) await act(async () => pdf.click());
    const signal: string | null | undefined = pdf?.getAttribute('data-target-signal');
    await act(async () => container.querySelectorAll<HTMLButtonElement>('nav[aria-label="作者章节目录"] button')
      [kind === 'unknown' ? 2 : 3].click());
    await flushFrames();
    expect(container.querySelector('nav[aria-label="作者章节目录"] .is-selected')?.textContent)
      .toBe(kind === 'unknown' ? 'UNRESOLVED CHAPTER' : 'MULTI PAGE CHAPTER');
    expect(pane.scrollTop).toBe(kind === 'unknown' ? 170000 : 180000);
    expect(locations).not.toHaveBeenCalled();
    if (pdf) expect(pdf.getAttribute('data-target-signal')).toBe(signal);
    await clickLabel('原文＋原件'); await flushFrames();
    expect(container.querySelector('nav[aria-label="作者章节目录"] .is-selected')?.textContent)
      .toBe(kind === 'unknown' ? 'UNRESOLVED CHAPTER' : 'MULTI PAGE CHAPTER');
    expect(pane.scrollTop).toBe(kind === 'unknown' ? 170000 : 180000);
    expect(ancestorScroll).not.toHaveBeenCalled(); expect(container.scrollTop).toBe(0);
  });
  it('keeps exact initial source pins, repeats the same explicit target and retains the PDF across modes', async () => {
    props = { ...props, initialPage: 57, initialUnitId: 'chapter-57', initialLocationRequest: 1 };
    await paint(); const pane: HTMLDivElement = geometry(); await flushFrames();
    expect(pane.scrollTop).toBe(119704);
    const pdf: HTMLElement = container.querySelector<HTMLElement>('[data-pdf-page="57"]')!;
    const signal: string | null = pdf.getAttribute('data-target-signal');
    expect(locations).not.toHaveBeenCalled();
    await act(async () => pdf.click());
    props = { ...props, initialLocationRequest: 2 };
    await paint(); await flushFrames();
    expect(pdf.getAttribute('data-target-signal')).not.toBe(signal);
    expect(container.querySelector('[data-pdf-page="57"]')).toBe(pdf);
    await clickLabel('仅原文'); await flushFrames();
    expect(pdf.closest('[hidden]')).not.toBeNull();
    await clickLabel('原文＋原件'); await flushFrames();
    expect(pdf.closest('[hidden]')).toBeNull();
    expect(container.querySelector('[data-pdf-page="57"]')).toBe(pdf);
    expect(pane.scrollTop).toBe(119704);
    expect(ancestorScroll).not.toHaveBeenCalled();
  });
  it.each(['unknown', 'multi'] as const)('retains the prior PDF target for an initial %s-page source without a page', async kind => {
    props = { ...props, initialPage: 57, initialUnitId: 'chapter-57', initialLocationRequest: 1 };
    await paint(); geometry(); await flushFrames();
    const pdf: HTMLElement = container.querySelector<HTMLElement>('[data-pdf-page="57"]')!;
    await act(async () => pdf.click());
    const signal: string | null = pdf.getAttribute('data-target-signal');
    props = { ...props, initialPage: undefined, initialUnitId: `chapter-${kind}`, initialLocationRequest: 2 };
    await paint(); await flushFrames();
    expect(pdf.getAttribute('data-target-signal')).toBe(signal);
    expect(container.querySelector('.source-reader-pdf-pane .source-reader-pane-title')?.textContent).toContain('第 3 页');
    expect(locations).not.toHaveBeenCalled();
    props = { ...props, initialLocationRequest: 3 };
    await paint(); await flushFrames();
    expect(pdf.getAttribute('data-target-signal')).toBe(signal);
    expect(locations).not.toHaveBeenCalled();
    expect(ancestorScroll).not.toHaveBeenCalled();
  });
  it('cancels prior binding focus and positions only the new parse source after a version change', async () => {
    props = { ...props, initialPage: 57, initialUnitId: 'chapter-57' };
    await paint(); geometry();
    const newer: DocumentOriginalResult = chapterFixture();
    newer.binding = { ...newer.binding, documentVersionId: 'DV-NEW', parseRunId: 'PR-SYNTHETIC-9', parseRevision: 9 };
    props = { ...props, original: newer, documentVersionId: 'DV-NEW', initialPage: 168, initialUnitId: 'chapter-168' };
    await paint(); const pane: HTMLDivElement = geometry(); await flushFrames();
    expect(pane.scrollTop).toBe(258704);
    const pdf: HTMLElement = container.querySelector<HTMLElement>('[data-pdf-page="168"]')!;
    expect(JSON.parse(pdf.getAttribute('data-reading-scope')!).slice(0, 3)).toEqual(['DV-NEW', 'PR-SYNTHETIC-9', 9]);
    expect(ancestorScroll).not.toHaveBeenCalled(); expect(container.scrollTop).toBe(0);
  });
});
