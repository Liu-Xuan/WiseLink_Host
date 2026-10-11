export const AIRBUS_TFU_ADAPTER_ID = 'issuer.airbus.technical_follow_up.v1';
export const AIRBUS_TFU_FOOTER_IDENTITY_AUTHORITY =
  'DM_ACTUAL_PDF_HEADER_AND_PUBLISHER_FOOTER';

export function publicationText(value = '') {
  return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

/** Only source-labelled dates; no file timestamps or inferred revisions. */
export function parseSourcePublicationDate(value = '') {
  const text = publicationText(value);
  let match = text.match(/^(\d{4})(?:[-/.]|年)\s*(\d{1,2})(?:[-/.]|月)\s*(\d{1,2})日?$/u);
  if (!match) {
    const english = text.match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/iu);
    if (!english) return '';
    const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
      .indexOf(english[2].toUpperCase()) + 1;
    match = [english[0], english[3], String(month), english[1]];
  }
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function hasCaacCadPrimaryHeader(text = '') {
  return /(?:中\s*国\s*民\s*用\s*航\s*空\s*局|\bC\s*A\s*A\s*C\b)/iu.test(text)
    && /(?:适\s*航\s*指\s*令|\bAIRWORTHINESS\s+DIRECTIVE\b)/iu.test(text)
    && /编\s*号\s*[:：]\s*CAD\s*\d{4}\s*-\s*[A-Z0-9]+\s*-\s*\d{2,4}\b/iu.test(text);
}

export function hasAirbusTfuPrimaryHeader(text = '') {
  return /\bREFERENCE\s*:\s*\d{2}\s*\.\s*\d{2}\s*\.\s*\d{5}\b/iu.test(text)
    && /\bISSUE\s+DATE\s*:/iu.test(text)
    && /\b(?:TECHNICAL\s+FOLLOW[-\s]*UP|ENGINEERING\s+SUPPORT)\b/iu.test(text);
}

/** The known TFU export has an image masthead. Its tail copyright, rather
 * than a supplier name or an Airbus reference in the body, proves publisher. */
export function airbusTfuPublisherEvidence(layout) {
  const runs = Array.isArray(layout?.textRuns) ? layout.textRuns : [];
  const firstPageRuns = runs.filter((run) => Number(run.page) === 1);
  const referenceIndex = firstPageRuns.findIndex((run) => /\bREFERENCE\s*:/iu.test(run.text));
  const masthead = firstPageRuns.slice(0, Math.max(0, referenceIndex))
    .map((run) => publicationText(run.text))
    .find((text) => /^AIRBUS(?:\s+S\.?A\.?S\.?)?$/iu.test(text));
  if (masthead) return { page: 1, text: masthead, source: 'PRIMARY_HEADER' };
  for (const run of runs) {
    const page = Number(run.page);
    if (page < Math.max(1, Number(layout.pageCount) - 1) || page > Number(layout.pageCount)) continue;
    const declaration = publicationText(run.text).match(/(?:©|COPYRIGHT)\s*AIRBUS\s+S\.?A\.?S\.?(?:\s*,?\s*\d{4})?/iu);
    if (declaration) return { page, text: declaration[0], source: 'PUBLISHER_FOOTER' };
  }
  return null;
}

export function airbusTfuIssueDateEvidence(layout) {
  const pages = new Map();
  for (const run of Array.isArray(layout?.textRuns) ? layout.textRuns : []) {
    const page = Number(run.page);
    if (page !== 1 && (page < Math.max(1, Number(layout.pageCount) - 1) || page > Number(layout.pageCount))) continue;
    const text = pages.get(page) || [];
    text.push(run.text);
    pages.set(page, text);
  }
  return [...pages.entries()].flatMap(([page, texts]) => [...publicationText(texts.join(' ')).matchAll(
    /\b(FIRST\s+)?ISSUE\s+DATE\s*:\s*(\d{1,2}-[A-Z]{3}-\d{4})\b/giu,
  )].filter((match) => !match[1]).map((match) => ({ page, value: match[2], text: match[0] })));
}

/** This additional authority is valid only for the dedicated TFU lane. */
export function isAirbusTfuFooterDescriptor(descriptor = {}) {
  const evidence = descriptor.publicationIdentityEvidence;
  const pageCount = Number(descriptor.pageCount);
  const page = Number(evidence?.publisher?.page);
  return descriptor.identityAuthority === AIRBUS_TFU_FOOTER_IDENTITY_AUTHORITY
    && (descriptor.canonicalDocumentFamily || descriptor.documentFamily) === 'TFU'
    && descriptor.issuer === 'AIRBUS'
    && (descriptor.documentFamilyAdapterId || descriptor.adapterRelease?.adapterId) === AIRBUS_TFU_ADAPTER_ID
    && evidence?.schemaVersion === 'wiselink.pdf_publication_identity_evidence.v1'
    && evidence.adapterId === AIRBUS_TFU_ADAPTER_ID
    && evidence.sourceSha256 === descriptor.sha256
    && Number(evidence.sourceByteLength) === Number(descriptor.sizeBytes)
    && evidence.documentCode === descriptor.documentCode
    && evidence.issueDate === descriptor.revisionDate
    && evidence.primaryHeaderLocator?.kind === 'PDF_PAGE'
    && evidence.primaryHeaderLocator.pageIndex === 0
    && evidence.publisher?.source === 'PUBLISHER_FOOTER'
    && Number.isSafeInteger(pageCount) && pageCount > 0
    && Number.isSafeInteger(page) && page >= Math.max(1, pageCount - 1) && page <= pageCount
    && evidence.publisher.sourceLocator?.kind === 'PDF_PAGE'
    && evidence.publisher.sourceLocator.pageIndex === page - 1
    && /^(?:©|COPYRIGHT)\s*AIRBUS\s+S\.?A\.?S\.?(?:\s*,?\s*\d{4})?$/iu.test(String(evidence.publisher.text || ''));
}
