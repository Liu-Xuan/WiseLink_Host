#!/usr/bin/env node
/**
 * Standalone runner for the declared Mozilla pdfjs-dist 4.10.38 legacy
 * build. Executed as a child process by the synchronous
 * PdfjsDistLayoutExtractor adapter; this is the only place where PDF
 * parsing happens (no hand-written PDF internals parsing anywhere).
 *
 * Protocol:
 *   argv[2]: absolute path to a file holding the exact PDF source bytes
 *   stdout : sentinel-wrapped single JSON payload
 *            <<<PDFJS-LAYOUT-JSON-BEGIN>>>{...}<<<PDFJS-LAYOUT-JSON-END>>>
 *            (engine warnings may interleave outside the sentinels; the
 *            adapter extracts only the wrapped payload)
 *   exit 0 : layout extracted
 *   exit 3 : PDFJS_LAYOUT_PARSE_FAILED (message on stderr)
 *   exit 4 : PDFJS_LAYOUT_TRANSPORT_FAILED (unexpected runner failure)
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Product safety policy, not a corpus fingerprint: a quarter-page of rendered
// raster content is materially capable of carrying engineering instructions.
// When that area has no geometrically overlapping text-layer run, pdfjs alone
// cannot establish content completeness and the Host must require OCR.
const MATERIAL_UNVERIFIED_RASTER_PAGE_FRACTION = 1 / 4;

// pdfjs-dist emits load-time polyfill warnings via console.log; keep stdout
// reserved exclusively for the JSON payload by redirecting console to stderr.
for (const method of ['log', 'info', 'warn']) {
  console[method] = (...args) => {
    process.stderr.write(`${args.map(String).join(' ')}\n`);
  };
}

async function main() {
  const sourcePath = process.argv[2];
  const pdfjsEntrypoint = process.argv[3];
  if (!sourcePath || !pdfjsEntrypoint) {
    process.stderr.write(
      'PDFJS_LAYOUT_TRANSPORT_FAILED: missing source path or pdfjs entrypoint argv',
    );
    process.exit(4);
  }
  const pdfjs = await import(pathToFileURL(pdfjsEntrypoint).href);
  let data;
  try {
    data = readFileSync(sourcePath);
  } catch (error) {
    process.stderr.write(`PDFJS_LAYOUT_TRANSPORT_FAILED: ${error.message}`);
    process.exit(4);
  }
  if (data.byteLength === 0) {
    process.stderr.write('PDFJS_LAYOUT_PARSE_FAILED: empty source bytes');
    process.exit(3);
  }

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    isEvalSupported: false,
    enableScripting: false,
    useSystemFonts: false,
    verbosity: pdfjs.VerbosityLevel ? pdfjs.VerbosityLevel.ERRORS : 0,
  }).promise;

  const metadata = await doc.getMetadata();
  const info = metadata?.info ?? {};
  const textRuns = [];
  const pageBoxes = [];
  const pageTextLayerDiagnostics = [];
  const boldByName = new Map();

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    // Resolve font objects first so commonObjs lookups below succeed.
    const operatorList = await page.getOperatorList();
    const content = await page.getTextContent();
    const view = page.view;
    pageBoxes.push({
      page: pageNumber,
      mediaBox: [
        Number(view[0]),
        Number(view[1]),
        Number(view[2]),
        Number(view[3]),
      ],
    });
    let pageTextRunCount = 0;
    let pageNonWhitespaceCharacterCount = 0;
    const pageTextBounds = [];
    for (const item of content.items) {
      if (typeof item.str !== 'string' || item.transform?.length !== 6) {
        continue;
      }
      if (item.str.length === 0) continue;
      const nonWhitespaceCharacterCount = Array.from(item.str).filter(
        (character) => !/\s/u.test(character),
      ).length;
      pageTextRunCount += 1;
      pageNonWhitespaceCharacterCount += nonWhitespaceCharacterCount;
      if (nonWhitespaceCharacterCount > 0) {
        const bounds = textItemBounds(item);
        if (bounds) {
          pageTextBounds.push({
            bounds,
            nonWhitespaceCharacterCount,
          });
        }
      }
      const fontName = String(item.fontName ?? '');
      if (!boldByName.has(fontName)) {
        boldByName.set(fontName, resolveBoldFlag(page, fontName));
      }
      textRuns.push({
        page: pageNumber,
        fontName,
        bold: boldByName.get(fontName),
        fontSize: Number(item.transform[0]),
        x: Number(item.transform[4]),
        y: Number(item.transform[5]),
        text: item.str,
      });
    }
    const rasterVisualCoverage = analyzeRasterVisualCoverage({
      operatorList,
      ops: pdfjs.OPS,
      pageView: view,
      textBounds: pageTextBounds,
    });
    const status =
      pageNonWhitespaceCharacterCount === 0
        ? 'EMPTY'
        : rasterVisualCoverage.status === 'UNVERIFIED'
          ? 'VISUAL_TEXT_UNVERIFIED'
          : 'PRESENT';
    pageTextLayerDiagnostics.push({
      page: pageNumber,
      status,
      textRunCount: pageTextRunCount,
      nonWhitespaceCharacterCount: pageNonWhitespaceCharacterCount,
      rasterVisualCoverage,
    });
    page.cleanup();
  }

  const layout = {
    pdfVersion: String(info.PDFFormatVersion ?? ''),
    pageCount: doc.numPages,
    pageBoxes,
    metadata: {
      title:
        typeof info.Title === 'string' && info.Title.length > 0
          ? info.Title
          : null,
    },
    textRuns,
    pageTextLayerDiagnostics,
  };
  await new Promise((resolveExit) => {
    const payload = `<<<PDFJS-LAYOUT-JSON-BEGIN>>>${JSON.stringify(layout)}<<<PDFJS-LAYOUT-JSON-END>>>`;
    process.stdout.write(payload, () => resolveExit());
  });
  process.exit(0);
}

function analyzeRasterVisualCoverage({
  operatorList,
  ops,
  pageView,
  textBounds,
}) {
  const pageBounds = normalizedBounds(pageView);
  const pageArea = rectangleArea(pageBounds);
  if (!(pageArea > 0)) {
    throw new Error('PDFJS_LAYOUT_PAGE_BOUNDS_INVALID');
  }

  const rasterRegions = collectDisplayedRasterRegions(
    operatorList,
    ops,
    pageBounds,
  );
  const annotatedRegions = rasterRegions.map((region) => {
    const overlaps = textBounds.filter((text) =>
      rectanglesOverlap(region.bounds, text.bounds),
    );
    return {
      bbox: region.bounds.map(roundGeometry),
      displayedPageAreaRatio: roundRatio(
        rectangleArea(region.bounds) / pageArea,
      ),
      sourcePixelWidth: region.sourcePixelWidth,
      sourcePixelHeight: region.sourcePixelHeight,
      textLayerOverlapRunCount: overlaps.length,
      textLayerOverlapNonWhitespaceCharacterCount: overlaps.reduce(
        (count, overlap) => count + overlap.nonWhitespaceCharacterCount,
        0,
      ),
    };
  });
  const unverifiedRegions = annotatedRegions.filter(
    (region) => region.textLayerOverlapNonWhitespaceCharacterCount === 0,
  );
  const rasterPageAreaRatio = roundRatio(
    rectangleUnionArea(rasterRegions.map((region) => region.bounds)) / pageArea,
  );
  const unverifiedRasterPageAreaRatio = roundRatio(
    rectangleUnionArea(unverifiedRegions.map((region) => region.bbox)) /
      pageArea,
  );
  const hasMaterialRaster =
    rasterPageAreaRatio >= MATERIAL_UNVERIFIED_RASTER_PAGE_FRACTION;
  const hasMaterialUnverifiedRaster =
    unverifiedRasterPageAreaRatio >=
    MATERIAL_UNVERIFIED_RASTER_PAGE_FRACTION;

  return {
    status: hasMaterialUnverifiedRaster
      ? 'UNVERIFIED'
      : hasMaterialRaster
        ? 'TEXT_LAYER_OVERLAP_PRESENT'
        : 'NO_MATERIAL_RASTER',
    materialUnverifiedRasterPageFraction:
      MATERIAL_UNVERIFIED_RASTER_PAGE_FRACTION,
    rasterRegionCount: annotatedRegions.length,
    rasterPageAreaRatio,
    unverifiedRasterRegionCount: unverifiedRegions.length,
    unverifiedRasterPageAreaRatio,
    unverifiedRasterRegions: unverifiedRegions,
  };
}

function collectDisplayedRasterRegions(operatorList, ops, pageBounds) {
  const regions = [];
  const stack = [];
  let ctm = [1, 0, 0, 1, 0, 0];

  const addRegion = (transform, source) => {
    const bounds = clipBounds(transformedUnitSquareBounds(transform), pageBounds);
    if (!bounds || rectangleArea(bounds) <= 0) return;
    regions.push({
      bounds,
      sourcePixelWidth: positiveIntegerOrNull(source?.width),
      sourcePixelHeight: positiveIntegerOrNull(source?.height),
    });
  };

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const operation = operatorList.fnArray[index];
    const args = operatorList.argsArray[index] ?? [];
    if (
      operation === ops.save ||
      operation === ops.paintFormXObjectBegin ||
      operation === ops.beginGroup
    ) {
      stack.push([...ctm]);
      const nestedTransform =
        operation === ops.paintFormXObjectBegin
          ? finiteTransform(args[0])
          : operation === ops.beginGroup
            ? finiteTransform(args[0]?.matrix)
            : null;
      if (nestedTransform) {
        ctm = multiplyTransforms(ctm, nestedTransform);
      }
      continue;
    }
    if (
      operation === ops.restore ||
      operation === ops.paintFormXObjectEnd ||
      operation === ops.endGroup
    ) {
      ctm = stack.pop() ?? ctm;
      continue;
    }
    if (operation === ops.transform) {
      const transform = finiteTransform(args);
      if (transform) ctm = multiplyTransforms(ctm, transform);
      continue;
    }
    if (
      operation === ops.paintImageXObject ||
      operation === ops.paintInlineImageXObject ||
      operation === ops.paintImageMaskXObject
    ) {
      const source =
        operation === ops.paintImageXObject
          ? { width: args[1], height: args[2] }
          : args[0];
      addRegion(ctm, source);
      continue;
    }
    if (operation === ops.paintImageXObjectRepeat) {
      const scaleX = Number(args[1]);
      const scaleY = Number(args[2]);
      const positions = numericSequence(args[3]);
      if (
        Number.isFinite(scaleX) &&
        Number.isFinite(scaleY) &&
        positions
      ) {
        for (let offset = 0; offset + 1 < positions.length; offset += 2) {
          const repeated = [
            scaleX,
            0,
            0,
            scaleY,
            Number(positions[offset]),
            Number(positions[offset + 1]),
          ];
          if (repeated.every(Number.isFinite)) {
            addRegion(multiplyTransforms(ctm, repeated), null);
          }
        }
      }
      continue;
    }
    if (operation === ops.paintImageMaskXObjectRepeat) {
      const scaleX = Number(args[1]);
      const skewX = Number(args[2]);
      const skewY = Number(args[3]);
      const scaleY = Number(args[4]);
      const positions = numericSequence(args[5]);
      if (
        [scaleX, skewX, skewY, scaleY].every(Number.isFinite) &&
        positions
      ) {
        for (let offset = 0; offset + 1 < positions.length; offset += 2) {
          const repeated = [
            scaleX,
            skewX,
            skewY,
            scaleY,
            Number(positions[offset]),
            Number(positions[offset + 1]),
          ];
          if (repeated.every(Number.isFinite)) {
            addRegion(multiplyTransforms(ctm, repeated), args[0]);
          }
        }
      }
      continue;
    }
    if (operation === ops.paintInlineImageXObjectGroup) {
      const source = args[0];
      const entries = Array.isArray(args[1]) ? args[1] : [];
      for (const entry of entries) {
        const transform = finiteTransform(entry?.transform);
        if (transform) {
          addRegion(multiplyTransforms(ctm, transform), source);
        }
      }
      continue;
    }
    if (operation === ops.paintImageMaskXObjectGroup) {
      const entries = Array.isArray(args[0]) ? args[0] : [];
      for (const entry of entries) {
        const transform = finiteTransform(entry?.transform);
        if (transform) {
          addRegion(multiplyTransforms(ctm, transform), entry);
        }
      }
    }
  }

  const unique = new Map();
  for (const region of regions) {
    const key = region.bounds.map(roundGeometry).join(':');
    if (!unique.has(key)) unique.set(key, region);
  }
  return [...unique.values()];
}

function textItemBounds(item) {
  const transform = finiteTransform(item.transform);
  const width = Math.abs(Number(item.width));
  const height = Math.abs(Number(item.height));
  if (!transform || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  const [a, b, c, d, x, y] = transform;
  const advanceLength = Math.hypot(a, b);
  const heightLength = Math.hypot(c, d);
  const advance =
    advanceLength > 0
      ? [(a / advanceLength) * width, (b / advanceLength) * width]
      : [width, 0];
  const rise =
    heightLength > 0
      ? [(c / heightLength) * height, (d / heightLength) * height]
      : [0, height];
  return pointsBounds([
    [x, y],
    [x + advance[0], y + advance[1]],
    [x + rise[0], y + rise[1]],
    [x + advance[0] + rise[0], y + advance[1] + rise[1]],
  ]);
}

function finiteTransform(value) {
  const sequence = numericSequence(value);
  if (!sequence || sequence.length !== 6) return null;
  const transform = sequence.map(Number);
  return transform.every(Number.isFinite) ? transform : null;
}

function numericSequence(value) {
  if (Array.isArray(value)) return value;
  if (ArrayBuffer.isView(value) && typeof value.length === 'number') {
    return Array.from(value);
  }
  return null;
}

function multiplyTransforms(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function transformedUnitSquareBounds(transform) {
  return pointsBounds(
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].map(([x, y]) => [
      transform[0] * x + transform[2] * y + transform[4],
      transform[1] * x + transform[3] * y + transform[5],
    ]),
  );
}

function pointsBounds(points) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function normalizedBounds(value) {
  const [x1, y1, x2, y2] = value.map(Number);
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

function clipBounds(bounds, clip) {
  const clipped = [
    Math.max(bounds[0], clip[0]),
    Math.max(bounds[1], clip[1]),
    Math.min(bounds[2], clip[2]),
    Math.min(bounds[3], clip[3]),
  ];
  return rectangleArea(clipped) > 0 ? clipped : null;
}

function rectanglesOverlap(left, right) {
  return (
    Math.min(left[2], right[2]) > Math.max(left[0], right[0]) &&
    Math.min(left[3], right[3]) > Math.max(left[1], right[1])
  );
}

function rectangleArea(bounds) {
  return Math.max(0, bounds[2] - bounds[0]) * Math.max(0, bounds[3] - bounds[1]);
}

function rectangleUnionArea(rectangles) {
  if (rectangles.length === 0) return 0;
  const xCoordinates = [
    ...new Set(rectangles.flatMap((bounds) => [bounds[0], bounds[2]])),
  ].sort((left, right) => left - right);
  let area = 0;
  for (let index = 0; index + 1 < xCoordinates.length; index += 1) {
    const x1 = xCoordinates[index];
    const x2 = xCoordinates[index + 1];
    if (!(x2 > x1)) continue;
    const intervals = rectangles
      .filter((bounds) => bounds[0] < x2 && bounds[2] > x1)
      .map((bounds) => [bounds[1], bounds[3]])
      .sort((left, right) => left[0] - right[0]);
    let coveredY = 0;
    let current = null;
    for (const interval of intervals) {
      if (!current || interval[0] > current[1]) {
        if (current) coveredY += current[1] - current[0];
        current = [...interval];
      } else {
        current[1] = Math.max(current[1], interval[1]);
      }
    }
    if (current) coveredY += current[1] - current[0];
    area += (x2 - x1) * coveredY;
  }
  return area;
}

function positiveIntegerOrNull(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function roundGeometry(value) {
  return Number(Number(value).toFixed(3));
}

function roundRatio(value) {
  return Number(Number(value).toFixed(6));
}

/**
 * Bold determination from the resolved pdfjs font object. Deterministic:
 * same font resource name on the same page always maps to the same flag.
 * Weight families (bold/black/heavy/semibold/demibold) count as bold.
 */
function resolveBoldFlag(page, fontName) {
  try {
    const font = page.commonObjs.get(fontName);
    if (font && typeof font === 'object') {
      if (font.bold === true || font.black === true) return true;
      const base = String(font.name ?? '').replace(/^[A-Z]{6}\+/, '');
      return /bold|black|heavy/i.test(base);
    }
  } catch {
    /* fall through to name-based heuristic on the loadedName */
  }
  return /bold|black|heavy/i.test(fontName);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (/password|encrypted/i.test(message)) {
    process.stderr.write(`PDFJS_LAYOUT_PARSE_FAILED: ${message}`);
    process.exit(3);
  }
  process.stderr.write(`PDFJS_LAYOUT_TRANSPORT_FAILED: ${message}`);
  process.exit(4);
});
