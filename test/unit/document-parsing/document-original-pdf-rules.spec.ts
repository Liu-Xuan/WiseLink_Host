import { documentPdfRuledLines } from '../../../server/modules/document-management/src/hosted/nest/document-original-pdf-rules';

const operators = { save: 1, restore: 2, transform: 3, constructPath: 4, clip: 5, endPath: 6, stroke: 7,
  setStrokeRGBColor: 8, setDash: 9, setGState: 10, moveTo: 13, lineTo: 14, rectangle: 19, closePath: 18,
  beginText: 20, endText: 21, setTextRenderingMode: 22, showText: 23 };
function extract(entries: Array<[number, unknown]>) {
  return documentPdfRuledLines({ operators, viewportTransform: [1, 0, 0, -1, 0, 100],
    fnArray: entries.map((entry) => entry[0]), argsArray: entries.map((entry) => entry[1]) });
}
const line: [number, unknown] = [4, [[13, 14], [0, 5, 30, 5]]];

it('retains transformed, actually clipped stroke coordinates and their operator source', () => {
  expect(extract([[1, null], [3, [1, 0, 0, 1, 10, 20]], [4, [[19], [5, 0, 15, 10]]],
    [5, null], [6, null], [8, new Uint8ClampedArray([0, 0, 0])], line, [7, null], [2, null]]))
    .toEqual([{ from: [15, 75], to: [30, 75], operatorIndex: 7 }]);
});

it('excludes dashed, transparent and white strokes while restoring a visible saved state', () => {
  expect(extract([[1, null], [9, [[3, 2], 0]], line, [7, null], [2, null],
    [1, null], [10, [[['CA', 0]]]], line, [7, null], [2, null],
    [1, null], [8, new Uint8ClampedArray([255, 255, 255])], line, [7, null], [2, null], line, [7, null]]))
    .toEqual([{ from: [0, 95], to: [30, 95], operatorIndex: 16 }]);
});

it('does not treat an unknown curved clip or a malformed graphics stack as geometric proof', () => {
  expect(extract([[4, [[13, 15], [0, 0, 5, 5, 10, 10, 20, 20]]], [5, null], [6, null], line, [7, null]]))
    .toEqual([]);
  expect(extract([[2, null], line, [7, null]])).toBeNull();
});

it.each([4, 5, 6, 7])('excludes strokes after text clipping mode %i until graphics restore', (mode: number) => {
  expect(extract([[1, null], [20, null], [22, [mode]], [23, [['A']]], [21, null],
    line, [7, null], [2, null], line, [7, null]]))
    .toEqual([{ from: [0, 95], to: [30, 95], operatorIndex: 9 }]);
});

it.each([0, 1, 2, 3])('keeps strokes after non-clipping text mode %i', (mode: number) => {
  expect(extract([[20, null], [22, [mode]], [23, [['A']]], [21, null], line, [7, null]]))
    .toEqual([{ from: [0, 95], to: [30, 95], operatorIndex: 5 }]);
});

it('applies accumulated glyph clipping at ET even after the text mode changes back', () => {
  expect(extract([line, [7, null], [20, null], [22, [7]], [23, [['A']]],
    [22, [0]], [21, null], line, [7, null]]))
    .toEqual([{ from: [0, 95], to: [30, 95], operatorIndex: 1 }]);
});
