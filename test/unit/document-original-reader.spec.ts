import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';
import { originalReadingGroups, originalUnitPage, originalUnitPages } from '../../client/src/pages/DocumentParsingPage/original-reading';
import { DocumentOriginalReader } from '../../client/src/pages/DocumentParsingPage/DocumentOriginalReader';

function fixture() {
  const original = originalFixture();
  original.coverage = { knownPageCount: 4, readPageIndexes: [0, 1, 2, 3], unresolvedRanges: [] };
  original.source.units = original.source.units.map((unit, index) => ({ ...unit, kind: 'paragraph',
    payload: { text: index ? 'Information listed below). Keep the condition with this procedure.' : 'If an operator prepares a database, use the approved tool (Support/ Contact' } }));
  original.locations = original.locations.map((location, index) => ({ ...location, pageIndex: index + 2,
    precision: 'TEXT_ITEM', coordinateSpace: 'PDF_VIEWPORT_TOP_LEFT', viewportWidth: 600, viewportHeight: 800,
    boxes: [[54, index ? 95 : 710, 480, 9]] }));
  return original;
}

it('renders an evidenced cross-page sentence as one continuous paragraph without page-level buttons or coverage header', () => {
  const original = fixture(), before = structuredClone(original);
  const html = renderToStaticMarkup(createElement(DocumentOriginalReader, { original }));
  expect(html.match(/<article\b/g)).toHaveLength(1);
  expect(html.match(/<p\b/g)).toHaveLength(1); // the source paragraph only; no coverage status line
  expect(html).toMatch(/Contact<\/span>(?:<!-- -->)? ?<span[^>]*id="u2"[^>]*>/);
  expect(html).toContain('id="u1"');
  expect(html).toContain('id="u2"');
  expect(html).not.toContain('页级定位');
  expect(html).not.toContain('原件第');
  expect(html).not.toContain('已读取');
  expect(html).not.toContain('已保存原文文本范围'); // no formal-adoption disclaimer
  expect(original).toEqual(before);
});

it.each([
  ['new condition', 'If a second condition applies (Information listed below).'],
  ['warning', 'WARNING: Information listed below).'],
  ['note', 'NOTE: Information listed below).'],
  ['numbered step', '2. Information listed below).'],
  ['closure in a later sentence', 'Another complete sentence. Information listed below).'],
])('keeps a %s separate even when page and column geometry match', (_label, text) => {
  const original = fixture(); original.source.units[1].payload.text = text;
  const html = renderToStaticMarkup(createElement(DocumentOriginalReader, { original }));
  expect(html.match(/<article\b/g)).toHaveLength(2);
});

it.each(['same page', 'different column', 'different height', 'different section', 'page-only location', 'closed sentence', 'not last body', 'not first body'])(
  'does not merge when evidence fails: %s', change => {
    const original = fixture();
    if (change === 'same page') original.locations[1].pageIndex = 2;
    if (change === 'different column') original.locations[1].boxes[0][0] += 20;
    if (change === 'different height') original.locations[1].boxes[0][3] = 12;
    if (change === 'different section') original.source.units[1].parentUnitId = 'another-heading';
    if (change === 'page-only location') original.locations[1].precision = 'PAGE';
    if (change === 'closed sentence') original.source.units[0].payload.text = 'This is a complete condition.';
    if (change === 'not last body') original.source.units.push({ ...original.source.units[0], unitId: 'later-body' });
    if (change === 'not first body') original.source.units.unshift({ ...original.source.units[1], unitId: 'earlier-body' });
    expect(originalReadingGroups(original).every(group => group.length === 1)).toBe(true);
  },
);

it('keeps merged paragraph members on inline locatable spans while the table container stays a block', () => {
  const merged = fixture();
  const mergedHtml = renderToStaticMarkup(createElement(DocumentOriginalReader, { original: merged }));
  expect(mergedHtml.match(/class="original-locatable"/g)).toHaveLength(2);
  expect(mergedHtml).toContain('id="u1"');
  expect(mergedHtml).toContain('id="u2"');
  expect(mergedHtml).not.toContain('original-locatable-block');
  const tableHtml = renderToStaticMarkup(createElement(DocumentOriginalReader, { original: originalFixture() }));
  expect(tableHtml).toMatch(/<div[^>]*id="u2"[^>]*class="original-locatable original-locatable-block"/);
});

it('declares inline member spans before the block table override and styles the multi-page chooser', () => {
  const css = readFileSync(join(__dirname, '../../client/src/pages/DocumentParsingPage/document-version-reading.css'), 'utf8');
  expect(css).toContain('.original-locatable { display: inline');
  expect(css).toContain('.original-locatable-block { display: block');
  expect(css.indexOf('.original-locatable {')).toBeLessThan(css.indexOf('.original-locatable-block'));
  expect(css).toContain('.document-original-page-choice');
});

it('hides page furniture in the reading projection but keeps it in the saved source', () => {
  const original = fixture();
  original.source.units.push({ ...original.source.units[0], unitId: 'furniture-unit',
    mapping: { pageFurniture: true }, payload: { text: 'AMM 24-11-11 Page 3/4' } });
  const before = structuredClone(original);
  const html = renderToStaticMarkup(createElement(DocumentOriginalReader, { original }));
  expect(html).not.toContain('furniture-unit');
  expect(html).not.toContain('AMM 24-11-11 Page 3/4');
  expect(originalReadingGroups(original)).toHaveLength(1); // furniture never becomes a group
  expect(original).toEqual(before);
});

it('keeps unresolved coverage visible as a concise local list', () => {
  const original = originalFixture(); // fixture default has unresolved ranges
  const html = renderToStaticMarkup(createElement(DocumentOriginalReader, { original }));
  expect(html).toContain('原文覆盖与定位限制');
  expect(html).toContain('Constructed unread page.');
});

describe('originalUnitPage', () => {
  it('resolves the exact one-based page of a unit from its saved locations', () => {
    const original = fixture();
    expect(originalUnitPage(original, 'u1')).toBe(3);
    expect(originalUnitPage(original, 'u2')).toBe(4);
  });

  it('returns null when the unit or its physical location does not exist', () => {
    const original = fixture();
    expect(originalUnitPage(original, 'missing-unit')).toBeNull();
    original.locations = original.locations.map(location => ({ ...location, pageIndex: null }));
    expect(originalUnitPage(original, 'u1')).toBeNull();
  });
});

describe('originalUnitPages', () => {
  it('returns every distinct saved page of a multi-page unit in source order', () => {
    const original = originalFixture();
    original.source.units[0].sourceRefIds = ['SR-TEST-P1', 'SR-TEST-P2'];
    original.locations[0] = { ...original.locations[0], pageIndex: 1 };
    original.locations[1] = { ...original.locations[1], pageIndex: 3 };
    expect(originalUnitPages(original, 'u1')).toEqual([2, 4]);
    expect(originalUnitPages(original, 'u2')).toEqual([4]);
  });

  it('returns an empty list when the unit or its physical location does not exist', () => {
    const original = originalFixture();
    expect(originalUnitPages(original, 'missing-unit')).toEqual([]);
    original.locations = original.locations.map(location => ({ ...location, pageIndex: null }));
    expect(originalUnitPages(original, 'u1')).toEqual([]);
  });
});
