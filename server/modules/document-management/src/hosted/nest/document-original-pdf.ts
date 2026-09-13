import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The actual PDF.js text layer, retained independently of plugin organization. */
export interface DocumentPdfPage {
  pageIndex: number;
  text: string;
  width: number;
  height: number;
  rotation: number;
  /** Count of image painting operations, not a claim to have interpreted images. Null means inspection failed. */
  imagePaintOperations?: number | null;
  items: Array<{ text: string; transform: number[]; width: number; height: number; hasEOL: boolean }>;
}
export interface DocumentPdfExtraction { pageCount: number; pages: DocumentPdfPage[] }

// Preserve native ESM loading in the Host's CommonJS build; no subprocess/Worker runtime.
const importPdfjs = new Function('url', 'return import(url)') as
  (url: string) => Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>;

async function loadPdfjs() {
  try {
    // sync-document-management-assets packages this pinned engine for Hosted,
    // whose dependency pruning does not retain the dynamic npm import.
    const hosted = resolve(__dirname, '../../../../../runtime-assets/professional-input/pdfjs-dist/legacy/build/pdf.mjs');
    const entrypoint = existsSync(hosted) ? hosted : createRequire(__filename).resolve('pdfjs-dist/legacy/build/pdf.mjs');
    return await importPdfjs(pathToFileURL(entrypoint).href);
  } catch (cause) {
    throw new Error('DOCUMENT_PDF_ENGINE_LOAD_FAILED', { cause });
  }
}

/** One page at a time, with an explicit bounded page range for the durable consumer. */
export async function extractDocumentPdfPages(input: {
  bytes: Uint8Array;
  pageStart: number;
  pageCount: number;
  assertActive: () => Promise<void>;
}): Promise<DocumentPdfExtraction> {
  if (!input.bytes.length || !Number.isSafeInteger(input.pageStart) || input.pageStart < 0 ||
      !Number.isSafeInteger(input.pageCount) || input.pageCount < 1)
    throw new Error('DOCUMENT_PDF_INPUT_INVALID');
  await input.assertActive();
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(input.bytes), isEvalSupported: false, useSystemFonts: true });
  try {
    const document = await task.promise;
    if (input.pageStart >= document.numPages) throw new Error('DOCUMENT_PDF_PAGE_RANGE_INVALID');
    const pages: DocumentPdfPage[] = [];
    const end = Math.min(document.numPages, input.pageStart + input.pageCount);
    for (let index = input.pageStart; index < end; index++) {
      await input.assertActive();
      const page = await document.getPage(index + 1);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items = content.items.flatMap(item => 'str' in item ? [{
          text: item.str, transform: [...item.transform], width: item.width,
          height: item.height, hasEOL: item.hasEOL,
        }] : []);
        let imagePaintOperations: number | null = null;
        try {
          const operations = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE });
          const imageOperators = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject,
            pdfjs.OPS.paintImageMaskXObject, pdfjs.OPS.paintImageMaskXObjectGroup, pdfjs.OPS.paintInlineImageXObjectGroup,
            pdfjs.OPS.paintImageXObjectRepeat, pdfjs.OPS.paintImageMaskXObjectRepeat, pdfjs.OPS.paintSolidColorImageMask]);
          imagePaintOperations = operations.fnArray.filter(operation => imageOperators.has(operation)).length;
        } catch {
          // Text stays available, with an explicit incomplete-visual-inspection
          // marker in the persisted page. Do not describe a failed scan as zero images.
        }
        await input.assertActive();
        pages.push({ pageIndex: index, width: viewport.width, height: viewport.height,
          rotation: viewport.rotation, imagePaintOperations, items,
          text: items.map(item => item.text + (item.hasEOL ? '\n' : ' ')).join('').trim() });
      } finally { page.cleanup(); }
    }
    await input.assertActive();
    return { pageCount: document.numPages, pages };
  } finally { await task.destroy(); }
}
