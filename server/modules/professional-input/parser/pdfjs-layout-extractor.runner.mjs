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
  const boldByName = new Map();

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    // Resolve font objects first so commonObjs lookups below succeed.
    await page.getOperatorList();
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
    for (const item of content.items) {
      if (typeof item.str !== 'string' || item.transform?.length !== 6) {
        continue;
      }
      if (item.str.length === 0) continue;
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
  };
  await new Promise((resolveExit) => {
    const payload = `<<<PDFJS-LAYOUT-JSON-BEGIN>>>${JSON.stringify(layout)}<<<PDFJS-LAYOUT-JSON-END>>>`;
    process.stdout.write(payload, () => resolveExit());
  });
  process.exit(0);
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
