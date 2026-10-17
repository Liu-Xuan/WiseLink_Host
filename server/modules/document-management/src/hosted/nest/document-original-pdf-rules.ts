type Point = [number, number];
type Matrix = [number, number, number, number, number, number];
export interface DocumentPdfRuledLine {
  from: Point;
  to: Point;
  operatorIndex: number;
}
interface GraphicsState {
  matrix: Matrix;
  clips: Point[][];
  clipKnown: boolean;
  blackStroke: boolean;
  solidStroke: boolean;
  opaqueStroke: boolean;
  lineWidth: number;
  textRenderingMode: number;
}

/** Only actual, solid black strokes with known linear clipping are evidence.
 * Unsupported vector constructs leave the ordinary text/preproc path intact. */
export function documentPdfRuledLines(input: {
  fnArray: readonly number[]; argsArray: readonly unknown[];
  operators: Readonly<Record<string, number>>; viewportTransform: number[];
}): DocumentPdfRuledLine[] | null {
  const matrix: Matrix | null = affine(input.viewportTransform);
  if (!matrix || input.fnArray.length !== input.argsArray.length) return null;
  const ops = input.operators;
  let state: GraphicsState = { matrix, clips: [], clipKnown: true,
    blackStroke: true, solidStroke: true, opaqueStroke: true, lineWidth: 1,
    textRenderingMode: 0 };
  const stack: GraphicsState[] = [];
  const result: DocumentPdfRuledLine[] = [];
  let path: Point[][] | null = [];
  let pendingClip: boolean = false;
  let pendingTextClip: boolean = false;
  for (const [index, operation] of input.fnArray.entries()) {
    const value: unknown = input.argsArray[index];
    const args: unknown[] = Array.isArray(value) ? value : numbers(value) ?? [];
    if (operation === ops.save) stack.push(structuredClone(state));
    else if (operation === ops.restore) {
      const previous = stack.pop();
      if (!previous) return null;
      state = previous;
    } else if (operation === ops.transform) {
      const transform: Matrix | null = affine(args);
      if (!transform) return null;
      state.matrix = multiply(state.matrix, transform);
    } else if (operation === ops.constructPath) {
      const next: Point[][] | null = linearPath(args, ops, state.matrix);
      path = path && next ? [...path, ...next] : null;
    } else if (operation === ops.clip || operation === ops.eoClip) pendingClip = true;
    else if (operation === ops.setTextRenderingMode) {
      const mode: number = Number(args[0]);
      if (!Number.isInteger(mode) || mode < 0 || mode > 7) return null;
      state.textRenderingMode = mode;
    } else if ([ops.showText, ops.showSpacedText, ops.nextLineShowText,
      ops.nextLineSetSpacingShowText].includes(operation) && state.textRenderingMode >= 4) {
      pendingTextClip = true;
    } else if (operation === ops.endText) {
      // Glyph outlines become a clip at ET. Their shape is not established by
      // this linear-path reader; Q can restore the previous known clip state.
      if (pendingTextClip) state.clipKnown = false;
      pendingTextClip = false;
    } else if (operation === ops.setLineWidth) state.lineWidth = Number(args[0]);
    else if (operation === ops.setDash) state.solidStroke = numbers(args[0])?.length === 0;
    else if (operation === ops.setStrokeRGBColor) state.blackStroke = args.slice(0, 3).length === 3 &&
      args.slice(0, 3).every((value: unknown) => value === 0);
    else if ([ops.setStrokeColor, ops.setStrokeColorN, ops.setStrokeGray, ops.setStrokeCMYKColor].includes(operation))
      state.blackStroke = false;
    else if (operation === ops.setGState) {
      const entries: unknown = args[0];
      if (!Array.isArray(entries)) state.opaqueStroke = false;
      else for (const entry of entries) {
        if (!Array.isArray(entry) || !['CA', 'ca', 'BM'].includes(String(entry[0])) ||
            (entry[0] === 'CA' && entry[1] !== 1) || (entry[0] === 'BM' && entry[1] !== 'Normal'))
          state.opaqueStroke = false;
      }
    } else if (operation === ops.paintFormXObjectBegin || operation === ops.paintFormXObjectEnd) return null;
    if ([ops.stroke, ops.closeStroke, ops.fillStroke, ops.eoFillStroke,
      ops.closeFillStroke, ops.closeEOFillStroke].includes(operation) && path && state.clipKnown &&
      state.blackStroke && state.solidStroke && state.opaqueStroke && Number.isFinite(state.lineWidth) &&
      state.lineWidth >= 0 && state.lineWidth * Math.max(Math.hypot(...state.matrix.slice(0, 2)),
        Math.hypot(...state.matrix.slice(2, 4))) <= 2) {
      for (const polygon of path) for (let point = 1; point < polygon.length; point++) {
        let segment: [Point, Point] | null = [polygon[point - 1], polygon[point]];
        for (const clip of state.clips) if (segment) segment = clipSegment(segment, clip);
        if (segment && (Math.abs(segment[0][0] - segment[1][0]) <= 0.01 ||
            Math.abs(segment[0][1] - segment[1][1]) <= 0.01) &&
            Math.hypot(segment[0][0] - segment[1][0], segment[0][1] - segment[1][1]) > 1)
          result.push({ from: segment[0], to: segment[1], operatorIndex: index });
      }
    }
    if ([ops.stroke, ops.closeStroke, ops.fill, ops.eoFill, ops.fillStroke,
      ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke, ops.endPath].includes(operation)) {
      if (pendingClip) {
        if (!path || path.length !== 1 || !convex(path[0])) state.clipKnown = false;
        else state.clips.push(path[0]);
      }
      path = []; pendingClip = false;
    }
  }
  return stack.length ? null : result;
}

function numbers(value: unknown): number[] | null {
  const values: unknown[] | null = Array.isArray(value) ? value : ArrayBuffer.isView(value)
    ? Array.from(value as unknown as ArrayLike<number>) : null;
  return values?.every((item: unknown) => typeof item === 'number' && Number.isFinite(item)) ? values as number[] : null;
}
function affine(value: unknown): Matrix | null {
  const values: number[] | null = numbers(value);
  return values?.length === 6 ? values as Matrix : null;
}
function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
function linearPath(args: unknown[], ops: Readonly<Record<string, number>>, matrix: Matrix): Point[][] | null {
  const operations: number[] | null = numbers(args[0]), coordinates: number[] | null = numbers(args[1]);
  if (!operations || !coordinates) return null;
  const paths: Point[][] = [];
  let offset: number = 0;
  const transform = (x: number, y: number): Point =>
    [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
  for (const operation of operations) {
    if (operation === ops.rectangle) {
      if (offset + 4 > coordinates.length) return null;
      const [x, y, width, height] = coordinates.slice(offset, offset + 4); offset += 4;
      paths.push([[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]]
        .map((point: number[]) => transform(point[0], point[1])));
    } else if (operation === ops.closePath) {
      const current = paths.at(-1);
      if (!current?.length) return null;
      current.push(current[0]);
    } else if (operation === ops.moveTo || operation === ops.lineTo) {
      if (offset + 2 > coordinates.length) return null;
      const point: Point = transform(coordinates[offset], coordinates[offset + 1]); offset += 2;
      if (operation === ops.moveTo) paths.push([point]);
      else if (paths.length) paths[paths.length - 1].push(point);
      else return null;
    } else return null;
  }
  return offset === coordinates.length ? paths : null;
}
function cross(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function convex(points: Point[]): boolean {
  if (points.length < 4) return false;
  const polygon: Point[] = points.slice(0, -1);
  if (Math.hypot(points[0][0] - points.at(-1)![0], points[0][1] - points.at(-1)![1]) > 0.01) return false;
  const signs: number[] = polygon.map((point: Point, index: number) =>
    Math.sign(cross(point, polygon[(index + 1) % polygon.length], polygon[(index + 2) % polygon.length])))
    .filter((sign: number) => sign !== 0);
  return signs.length > 0 && signs.every((sign: number) => sign === signs[0]);
}
function clipSegment(segment: [Point, Point], polygon: Point[]): [Point, Point] | null {
  const points: Point[] = polygon.slice(0, -1);
  const area: number = points.reduce((sum: number, point: Point, index: number) => {
    const next: Point = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - point[1] * next[0];
  }, 0);
  const direction: number = Math.sign(area);
  let start: number = 0, end: number = 1;
  for (const [index, point] of points.entries()) {
    const next: Point = points[(index + 1) % points.length];
    const a: number = direction * cross(point, next, segment[0]);
    const b: number = direction * cross(point, next, segment[1]);
    if (a < -0.001 && b < -0.001) return null;
    if (a < -0.001) start = Math.max(start, a / (a - b));
    if (b < -0.001) end = Math.min(end, a / (a - b));
  }
  if (start > end) return null;
  const at = (t: number): Point => [segment[0][0] + t * (segment[1][0] - segment[0][0]),
    segment[0][1] + t * (segment[1][1] - segment[0][1])];
  return [at(start), at(end)];
}
