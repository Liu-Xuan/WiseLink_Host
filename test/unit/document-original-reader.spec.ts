import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';
import { originalReadingGroups } from '../../client/src/pages/DocumentParsingPage/original-reading';
import { DocumentOriginalReader } from '../../client/src/pages/DocumentParsingPage/DocumentOriginalReader';

jest.mock('@client/src/pages/WorkspaceHomePage/DocumentOriginalPreview', () => ({
  DocumentOriginalPreview: ({ page, children }: { page: number; children: string }) => createElement('a', { href: `original#page=${page}` }, children),
}));

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

it('renders an evidenced cross-page sentence as one paragraph while preserving unit targets and both page links', () => {
  const original = fixture(), before = structuredClone(original);
  const html = renderToStaticMarkup(createElement(DocumentOriginalReader, { original }));
  expect(html.match(/<article\b/g)).toHaveLength(1);
  expect(html.match(/<p\b/g)).toHaveLength(2); // status plus one source paragraph
  expect(html).toMatch(/Contact<\/span><span id="u2"> Information listed below\)/);
  expect(html).toContain('id="u1"');
  expect(html).toContain('id="u2"');
  expect(html).toContain('href="original#page=3"');
  expect(html).toContain('href="original#page=4"');
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
