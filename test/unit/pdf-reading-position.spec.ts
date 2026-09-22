let mockSession = 1;
let mockSessionChanged: () => void;
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
  subscribeCanonicalHostClientSession: (listener: () => void) => { mockSessionChanged = listener; return () => undefined; },
}));
import { readPdfPosition, savePdfPosition } from '../../client/src/pages/DocumentParsingPage/pdf-reading-position';
const location = { page: 2, offsetRatio: .25, zoom: 1.25 };
beforeEach(() => { mockSession++; mockSessionChanged(); });

test('keeps exact entry scopes separate and clears on session change, rejecting late writes', () => {
  const old = mockSession;
  savePdfPosition('DV-A:parse-1:source-1', location, old);
  expect(readPdfPosition('DV-A:parse-2:source-1', old)).toBeNull();
  expect(readPdfPosition('DV-B:parse-1:source-1', old)).toBeNull();
  expect(readPdfPosition('DV-A:parse-1:source-2', old)).toBeNull();
  expect(readPdfPosition('DV-A:parse-1:source-1', old)).toEqual(location);
  mockSession++; mockSessionChanged();
  savePdfPosition('DV-A:parse-1:source-1', location, old);
  expect(readPdfPosition('DV-A:parse-1:source-1', mockSession)).toBeNull();
});

test('bounds retention, expires unused entries, and does not share mutable values', () => {
  jest.useFakeTimers();
  try {
    for (let i = 0; i < 33; i++) savePdfPosition(`entry-${i}`, location, mockSession);
    expect(readPdfPosition('entry-0', mockSession)).toBeNull();
    const copy = readPdfPosition('entry-32', mockSession)!; copy.page = 999;
    expect(readPdfPosition('entry-32', mockSession)?.page).toBe(2);
    jest.advanceTimersByTime(30 * 60 * 1000);
    expect(readPdfPosition('entry-32', mockSession)).toBeNull();
  } finally { jest.useRealTimers(); }
});

test('rejects invalid page, offset and zoom metadata', () => {
  for (const value of [{ ...location, page: 0 }, { ...location, page: 1.5 },
    { ...location, offsetRatio: NaN }, { ...location, zoom: Infinity }]) {
    savePdfPosition('invalid', value, mockSession);
    expect(readPdfPosition('invalid', mockSession)).toBeNull();
  }
});
