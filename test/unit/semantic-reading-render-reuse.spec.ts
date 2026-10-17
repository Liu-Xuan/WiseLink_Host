import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import type { TranslationWorkspaceReadingV2 } from '@shared/canonical-translation-v2.interface';
import { SemanticBilingualReader } from '@client/src/pages/DocumentParsingPage/SemanticBilingualReader';
import * as blockContent from '@client/src/pages/DocumentParsingPage/SemanticBlockContent';
import { semanticReadingFixture, sourceAnchor } from './semantic-reading-ui.fixtures';
import { indexSemanticReadingAnchors } from '@client/src/pages/DocumentParsingPage/semantic-reading-index';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/features/review/InitialAnalysisContinueButton', () => ({ __esModule: true, default: 'button' }));
jest.mock('@client/src/pages/DocumentParsingPage/TranslationRevisionEditor', () => ({ TranslationRevisionEditor: 'div' }));
jest.mock('@client/src/pages/DocumentParsingPage/semantic-bilingual-reader.css', () => ({}));

function readingFixture(): TranslationWorkspaceReadingV2 {
  const reading = semanticReadingFixture();
  const template = reading.blocks[0];
  reading.anchors = Array.from({ length: 4 }, (_, index: number) => sourceAnchor(`anchor-${index}`, `Source ${index}`));
  reading.blocks = reading.anchors.map((anchor, index: number) => ({
    ...template,
    source: { ...template.source, blockId: `block-${index}`, order: index,
      sourceUnitIds: [anchor.sourceUnitId], anchorIds: [anchor.anchorId] },
    selected: { ...template.selected!, blockId: `block-${index}`, blockRevisionId: `revision-${index}`,
      candidate: { blockId: `block-${index}`, elements: [{ elementId: `element-${index}`, kind: 'paragraph',
        translatedText: `译文 ${index}`, anchorIds: [anchor.anchorId] }] } },
  }));
  return reading;
}

describe('semantic reading render reuse', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLElement;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const sourceSelected = jest.fn();
  let contentRender: jest.SpyInstance<ReturnType<typeof blockContent.SemanticBlockContent>, Parameters<typeof blockContent.SemanticBlockContent>>;

  beforeEach(() => {
    dom = new JSDOM('<div id="root"></div>');
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      IS_REACT_ACT_ENVIRONMENT: true })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
    container = dom.window.document.getElementById('root')!;
    root = createRoot(container);
    sourceSelected.mockReset();
    contentRender = jest.spyOn(blockContent, 'SemanticBlockContent');
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    contentRender.mockRestore();
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });

  async function render(
    reading: TranslationWorkspaceReadingV2,
    mode: 'bilingual' | 'translation' | 'original' = 'bilingual',
    onSourceRefSelect: (unitId: string, sourceRef: string) => void = sourceSelected,
  ): Promise<void> {
    await act(async () => root.render(createElement(SemanticBilingualReader, {
      translation: { status: 'SEMANTIC_READING_AID_AVAILABLE', reading }, mode, onSourceRefSelect,
    })));
  }

  async function click(text: string, within: ParentNode = container): Promise<void> {
    const button = [...within.querySelectorAll<HTMLButtonElement>('button')].find((node: HTMLButtonElement) => node.textContent === text);
    expect(button).toBeDefined();
    await act(async () => button!.click());
  }

  it.each(['bilingual', 'translation'] as const)('updates focused blocks without redrawing unrelated source content in %s mode', async mode => {
    await render(readingFixture(), mode);
    contentRender.mockClear();
    await click('译文 0');
    expect(contentRender.mock.calls.some(([props]) => props.block.source.blockId === 'block-0')).toBe(true);
    expect(contentRender.mock.calls.some(([props]) => props.block.source.blockId === 'block-3')).toBe(false);
    const selected = container.querySelector('[data-semantic-block="block-0"]');
    expect(selected?.className).toContain('is-selected');
    contentRender.mockClear();
    await click('译文 1');
    expect(contentRender.mock.calls.some(([props]) => props.block.source.blockId === 'block-0')).toBe(true);
    expect(contentRender.mock.calls.some(([props]) => props.block.source.blockId === 'block-1')).toBe(true);
    expect(contentRender.mock.calls.some(([props]) => props.block.source.blockId === 'block-3')).toBe(false);
  });

  it.each(['source', 'translation'] as const)('updates a shared anchor highlight in an unfocused sibling %s block', async side => {
    const reading = readingFixture();
    if (side === 'source') reading.blocks[1].source.anchorIds.push('anchor-0');
    else reading.blocks[1].selected!.candidate.elements[0].anchorIds.push('anchor-0');
    await render(reading);
    contentRender.mockClear();
    await click('译文 0');
    const sibling = container.querySelector(`.is-${side === 'source' ? 'original' : 'translation'} [data-semantic-block="block-1"]`);
    expect(sibling?.querySelector('.is-highlighted')?.textContent).toContain(side === 'source' ? 'Source 0' : '译文 1');
    expect(contentRender.mock.calls.some(([props]) => props.block.source.blockId === 'block-1')).toBe(true);
    expect(contentRender.mock.calls.some(([props]) => props.block.source.blockId === 'block-3')).toBe(false);
  });

  it('keeps outline scrolling within its block when a shared anchor was registered by another focused block', async () => {
    const reading = readingFixture();
    reading.blocks[0].source.anchorIds.push('anchor-1');
    reading.blocks[0].source.sourceUnitIds.push(reading.anchors[1].sourceUnitId);
    reading.blocks[0].selected!.candidate.elements.push({
      elementId: 'element-0-shared', kind: 'paragraph',
      translatedText: '共享来源译文', anchorIds: ['anchor-1'],
    });
    reading.blocks[1].source.kind = 'heading';
    reading.blocks[1].selected!.candidate.elements[0] = {
      elementId: 'element-1', kind: 'heading', translatedText: '目录目标 B', anchorIds: ['anchor-1'],
    };
    const scrolls: HTMLElement[] = [];
    dom.window.HTMLElement.prototype.scrollIntoView = function () { scrolls.push(this); };
    await render(reading);
    await click('译文 0');
    contentRender.mockClear();
    await click('目录目标 B', container.querySelector('.wl-semantic-outline')!);
    expect(scrolls.at(-1)?.closest('[data-semantic-block]')?.getAttribute('data-semantic-block')).toBe('block-1');
    expect(scrolls.at(-1)?.textContent).toBe('Source 1');
    expect(container.querySelector('.is-original .is-selected')?.getAttribute('data-semantic-block')).toBe('block-1');
    expect([...container.querySelectorAll('.is-original button')].filter(node => node.textContent === 'Source 1')).toHaveLength(2);
    expect(contentRender.mock.calls.some(([props]) => props.block.source.blockId === 'block-3')).toBe(false);
  });

  it('keeps exact source callbacks and replaces a saved content revision in the same workspace', async () => {
    const reading = readingFixture();
    await render(reading, 'translation');
    await click('译文 0');
    const context = container.querySelector('.wl-semantic-context')!;
    await click('第 3 页', context);
    expect(sourceSelected).toHaveBeenCalledWith('unit-anchor-0', 'ref-anchor-0');
    const updated = structuredClone(reading);
    updated.rowVersion += 1;
    updated.blocks[0].selected!.contentRevision += 1;
    updated.blocks[0].selected!.candidate.elements[0].translatedText = '已保存新译文';
    await render(updated, 'translation');
    expect(container.textContent).toContain('已保存新译文');
    expect([...container.querySelectorAll('button')].some((node: HTMLButtonElement) => node.textContent === '译文 0')).toBe(false);
  });

  it('does not retain old source text or selected state across workspace identity changes', async () => {
    await render(readingFixture());
    await click('译文 0');
    const next = readingFixture();
    next.workspaceId = 'workspace-other';
    next.source.documentVersionId = 'document-other';
    next.anchors[0].sourceText = 'New scope source';
    await render(next);
    expect(container.querySelector('.wl-bilingual-block.is-selected')).toBeNull();
    expect(container.textContent).toContain('New scope source');
    expect(container.textContent).not.toContain('Source 0');
  });

  it('preserves single-pane highlights on collapse and updates mode and source callback props', async () => {
    const reading = readingFixture();
    await render(reading, 'translation');
    await click('译文 0');
    await click('查看来源与修订');
    expect(container.querySelector('.wl-bilingual-block.is-selected')).toBeNull();
    expect(container.querySelector('.is-highlighted')?.textContent).toBe('译文 0');
    const nextSourceSelected = jest.fn();
    await render(reading, 'original', nextSourceSelected);
    expect(container.querySelector('.is-highlighted')?.textContent).toBe('Source 0');
    await click('查看来源与修订');
    await click('第 3 页', container.querySelector('.wl-semantic-context')!);
    expect(nextSourceSelected).toHaveBeenCalledWith('unit-anchor-0', 'ref-anchor-0');
    expect(sourceSelected).not.toHaveBeenCalled();
  });

  it('clears the bilingual focus and highlights when its source context is collapsed', async () => {
    await render(readingFixture());
    await click('译文 0');
    await click('收起来源', container.querySelector('.is-translation')!);
    expect(container.querySelector('.wl-bilingual-block.is-selected')).toBeNull();
    expect(container.querySelector('.is-highlighted')).toBeNull();
  });
});

describe('semantic reading anchor index', () => {
  it('retains document source order and duplicate source entries while ignoring repeated or absent membership ids', () => {
    const reading = readingFixture();
    const duplicate = sourceAnchor('anchor-1', 'Duplicate source entry');
    reading.anchors.push(duplicate);
    reading.blocks[0].source.anchorIds = ['anchor-3', 'anchor-1', 'anchor-1', 'absent'];
    reading.blocks[1].source.blockId = reading.blocks[0].source.blockId;
    const before = structuredClone(reading);
    const index = indexSemanticReadingAnchors(reading.blocks, reading.anchors);
    for (const block of reading.blocks) {
      const expected = reading.anchors.filter(anchor => block.source.anchorIds.includes(anchor.anchorId));
      expect(index.get(block)).toEqual(expected);
      index.get(block)?.forEach((anchor, order: number) => expect(anchor).toBe(expected[order]));
    }
    expect(index.get(reading.blocks[0])).toHaveLength(3);
    expect(index.get(reading.blocks[1])).toHaveLength(2);
    expect(reading).toEqual(before);
  });
});
