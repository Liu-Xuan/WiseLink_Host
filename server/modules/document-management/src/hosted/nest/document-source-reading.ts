import type { DocumentSourceReading } from '@shared/document-source-reading.interface';
import type { ParsedPdfLayout } from '../../../../professional-input/pure/professional-input-pure.types';

export function documentSourcePageRange(request: unknown): { pageStart: number; pageEnd: number } {
  if (!request || typeof request !== 'object' || Array.isArray(request)) invalid();
  const value = request as Record<string, unknown>;
  if (Object.keys(value).some((key) => !['pageStart', 'pageEnd'].includes(key))) invalid();
  const page = (input: unknown): number => {
    if (typeof input !== 'string' && typeof input !== 'number') invalid();
    if (!/^[1-9]\d*$/.test(String(input))) invalid();
    const number = Number(input);
    if (!Number.isSafeInteger(number)) invalid();
    return number;
  };
  const pageStart = page(value.pageStart);
  const pageEnd = value.pageEnd === undefined ? pageStart : page(value.pageEnd);
  if (pageEnd < pageStart || pageEnd - pageStart >= 8) invalid();
  return { pageStart, pageEnd };
}

/** Registered bytes have already been checked by the Hosted source owner. */
export function documentSourceReading(input: {
  documentVersionId: string;
  filename: string;
  sha256: string;
  byteLength: number;
  layout: ParsedPdfLayout;
  pageStart: number;
  pageEnd: number;
}): DocumentSourceReading {
  const { layout } = input;
  if (input.pageEnd > layout.pageCount) invalid();
  const pages: DocumentSourceReading['pages'] = [];
  for (let page = input.pageStart; page <= input.pageEnd; page += 1) {
    const sourceRefId = `DOCUMENT_VERSION:${input.documentVersionId}:page:${page}`;
    const text = layout.textRuns.filter((run) => run.page === page)
      .map((run) => run.text).join('\n').trim();
    const diagnostics = layout.pageTextLayerDiagnostics.filter((item) => item.page === page);
    const textLayerStatus = diagnostics.length === 1
      ? diagnostics[0]!.status : 'VISUAL_TEXT_UNVERIFIED';
    pages.push({
      page, sourceRefId, text, textLayerStatus, visualContentVerified: false,
      evidence: text ? {
        kind: 'DOCUMENT_PASSAGE', evidenceRef: sourceRefId, sourceRefId,
        workItemId: null, documentVersionId: input.documentVersionId,
        title: input.filename, versionLabel: null, locator: `PDF 第 ${page} 页（文本层）`,
        excerpt: text,
      } : null,
    });
  }
  return {
    documentVersionId: input.documentVersionId, sourceSha256: input.sha256,
    sourceByteLength: input.byteLength, pageCount: layout.pageCount,
    extractionScope: 'NATIVE_TEXT_LAYER', pages,
  };
}

function invalid(): never {
  throw Object.assign(new Error('Select one to eight valid physical PDF pages.'), {
    code: 'DOCUMENT_SOURCE_PAGE_RANGE_INVALID', statusCode: 400,
  });
}
