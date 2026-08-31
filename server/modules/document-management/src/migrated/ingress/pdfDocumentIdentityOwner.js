import { resolveDocumentFamilyAdapter } from '../adapters/documentFamilyAdapterRegistry.js';

const FIRST_PAGE_LIMIT = 1;
const INSPECTED_PAGE_LIMIT = 3;
const GENERIC_ADAPTER_ID = 'generic.general_document.v1';
const PDF_HEADER = Buffer.from('%PDF-', 'ascii');
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, details });
}

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizedPageText(layout, pageLimit) {
  return normalizeText(
    (Array.isArray(layout?.textRuns) ? layout.textRuns : [])
      .filter(
        (run) =>
          Number.isSafeInteger(Number(run?.page)) &&
          Number(run.page) >= 1 &&
          Number(run.page) <= pageLimit,
      )
      .map((run) => run.text)
      .join(' '),
  );
}

function validDate(yearValue, monthValue, dayValue) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return '';
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return '';
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const MONTHS = new Map(
  [
    'JANUARY',
    'FEBRUARY',
    'MARCH',
    'APRIL',
    'MAY',
    'JUNE',
    'JULY',
    'AUGUST',
    'SEPTEMBER',
    'OCTOBER',
    'NOVEMBER',
    'DECEMBER',
  ].flatMap((month, index) => [
    [month, index + 1],
    [month.slice(0, 3), index + 1],
  ]),
);

function monthNumber(value = '') {
  return MONTHS.get(String(value).trim().toUpperCase()) || 0;
}

function parseEnglishDate(value = '') {
  const source = normalizeText(value);
  let match = source.match(/^([A-Z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/iu);
  if (match) return validDate(match[3], monthNumber(match[1]), match[2]);
  match = source.match(/^(\d{1,2})\s+([A-Z]{3,9})\s+(\d{4})$/iu);
  if (match) return validDate(match[3], monthNumber(match[2]), match[1]);
  match = source.match(/^([A-Z]{3,9})\s+(\d{1,2})\/(\d{2}|\d{4})$/iu);
  if (match) {
    const year =
      match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return validDate(year, monthNumber(match[1]), match[2]);
  }
  match = source.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u);
  if (match) return validDate(match[3], match[1], match[2]);
  return '';
}

function requiredExtractedDate(value, adapterId, fieldName) {
  const date = parseEnglishDate(value);
  if (!date) {
    fail(
      'DM_PDF_VERSION_IDENTITY_UNRESOLVED',
      `Actual PDF text did not provide a valid ${fieldName} for ${adapterId}.`,
      { adapterId, fieldName },
    );
  }
  return date;
}

function singleIdentityCandidate(values, adapterId, fieldName) {
  const candidates = [...new Set(values.filter(Boolean))];
  if (candidates.length > 1) {
    fail(
      'DM_PDF_IDENTITY_CONFLICT',
      `Actual PDF text reports conflicting ${fieldName} candidates for ${adapterId}.`,
      { adapterId, fieldName, candidates },
    );
  }
  return candidates[0] || '';
}

function canonicalFtdCode(value = '') {
  const match = normalizeText(value).match(
    /\b(737MAX|737NG|737|747|757|767|777|787)\s*-\s*FTD\s*-\s*(\d{2})\s*-\s*(\d{5})\b/iu,
  );
  return match ? `${match[1].toUpperCase()}-FTD-${match[2]}-${match[3]}` : '';
}

function canonicalServiceLetterCode(value = '') {
  const match = normalizeText(value).match(
    /\b(737MAX|737NG|737|747|757|767|777|787)\s*-\s*SL\s*-\s*(\d{2})\s*-\s*([A-Z0-9]{3,6}(?:\s*-\s*[A-Z0-9]{1,4})?)\b/iu,
  );
  return match
    ? `${match[1].toUpperCase()}-SL-${match[2]}-${match[3]
        .replace(/\s*-\s*/gu, '-')
        .toUpperCase()}`
    : '';
}

function extractBoeingFtd({ firstPageText, inspectedText }) {
  if (
    !/\bFLEET\s+TEAM\s+DIGEST\b/iu.test(inspectedText) ||
    !/\bBOEING\s+PROPRIETARY\b/iu.test(inspectedText)
  ) {
    return null;
  }
  const adapterId = 'issuer.boeing.ftd.v1';
  const documentCode = singleIdentityCandidate(
    [
      ...firstPageText.matchAll(
        /((?:737MAX|737NG|737|747|757|767|777|787)\s*-\s*FTD\s*-\s*\d{2}\s*-\s*\d{5})\s*ISSUE\s+TITLE\b/giu,
      ),
    ].map((match) => canonicalFtdCode(match[1])),
    adapterId,
    'document code',
  );
  const sourceGeneratedDate = singleIdentityCandidate(
    [
      ...inspectedText.matchAll(
        /\b(?:THE\s+)?DOCUMENT\s+GENERATED\s+ON\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+BY\s+FLEET\s+TEAM\s+DIGEST\b/giu,
      ),
    ].map((match) =>
      requiredExtractedDate(match[1], adapterId, 'source generated date'),
    ),
    adapterId,
    'source generated date',
  );
  if (!documentCode || !sourceGeneratedDate) return null;
  return {
    documentCode,
    businessRevision: '',
    revisionDate: '',
    sourceGeneratedDate,
    sourceType: 'boeing_ftd',
  };
}

function extractFaaAd({ firstPageText }) {
  if (
    !/\bFEDERAL\s+AVIATION\s+ADMINISTRATION\b/iu.test(firstPageText) ||
    !/\bAIRWORTHINESS\s+DIRECTIVES?\b/iu.test(firstPageText)
  ) {
    return null;
  }
  const adapterId = 'issuer.faa.airworthiness_directive.v1';
  const documentCode = singleIdentityCandidate(
    [
      ...firstPageText.matchAll(
        /(?:AMENDMENT\s+\d+-\d+\s*;\s*)?AD\s+(\d{4}-\d{2}-\d{2})\b/giu,
      ),
    ].map((match) => `AD-${match[1]}`),
    adapterId,
    'document code',
  );
  const revisionDate = singleIdentityCandidate(
    [
      ...firstPageText.matchAll(
        /\bTHIS\s+AD\s+IS\s+EFFECTIVE\s+([A-Z]{3,9}\s+\d{1,2},\s+\d{4})\b/giu,
      ),
    ].map((match) =>
      requiredExtractedDate(match[1], adapterId, 'effective date'),
    ),
    adapterId,
    'effective date',
  );
  if (!documentCode || !revisionDate) return null;
  return {
    documentCode,
    businessRevision: 'ORIGINAL ISSUE',
    revisionDate,
    sourceGeneratedDate: '',
    sourceType: 'ad',
  };
}

function extractBoeingServiceLetter({ firstPageText }) {
  if (
    !/\bSERVICE\s+LETTER\b/iu.test(firstPageText) ||
    !/\bBOEING(?:\s+COMMERCIAL\s+AIRPLANES|\s+PROPRIETARY)?\b/iu.test(
      firstPageText,
    )
  ) {
    return null;
  }
  const adapterId = 'issuer.boeing.service_letter.v1';
  const headers = [
    ...firstPageText.matchAll(
      /(?:^\s*|\bSERVICE\s+LETTER\b[\s\S]{0,240}?)((?:737MAX|737NG|737|747|757|767|777|787)\s*-\s*SL\s*-\s*\d{2}\s*-\s*[A-Z0-9]{3,6}(?:\s*-\s*[A-Z0-9]{1,4})?)\s+ATA\s*:\s*\d[\d-]{1,10}\s+(\d{1,2}\s+[A-Z]{3,9}\s+\d{4})\b/giu,
    ),
  ];
  const documentCode = singleIdentityCandidate(
    headers.map((match) => canonicalServiceLetterCode(match[1])),
    adapterId,
    'document code',
  );
  const revisionDate = singleIdentityCandidate(
    headers.map((match) =>
      requiredExtractedDate(match[2], adapterId, 'publication date'),
    ),
    adapterId,
    'publication date',
  );
  if (!documentCode || !revisionDate) return null;
  return {
    documentCode,
    businessRevision: 'ORIGINAL ISSUE',
    revisionDate,
    sourceGeneratedDate: '',
    sourceType: 'boeing_sl',
  };
}

const BOEING_SB_CODE_PATTERN =
  '(?:737MAX|737NG|737|747|757|767|777|787)-\\d{2}(?:A?\\d{4}|-\\d{4})';

function extractBoeingServiceBulletin({ firstPageText, inspectedText }) {
  if (
    !/\bSERVICE\s+BULLETIN\b/iu.test(firstPageText) ||
    !/\bBOEING(?:\s+PROPRIETARY|\s+SERVICE\s+BULLETIN|\s+COMPANY)\b/iu.test(
      inspectedText,
    )
  ) {
    return null;
  }
  const adapterId = 'issuer.boeing.service_bulletin.v1';
  const documentCode = singleIdentityCandidate(
    [
      ...firstPageText.matchAll(
        new RegExp(
          `\\bSERVICE\\s+BULLETIN\\s+NUMBER\\s*:\\s*(${BOEING_SB_CODE_PATTERN})\\b`,
          'giu',
        ),
      ),
    ].map((match) => match[1].toUpperCase()),
    adapterId,
    'document code',
  );
  const revisions = [
    ...firstPageText.matchAll(
      /\bREVISION\s+(\d{1,4})\s*:\s*([A-Z]{3,9}\s+\d{1,2},\s+\d{4})\b/giu,
    ),
  ].map((match) => ({
    number: Number(match[1]),
    date: requiredExtractedDate(match[2], adapterId, 'publication date'),
  }));
  const currentRevisionNumber =
    revisions.length > 0
      ? Math.max(...revisions.map((value) => value.number))
      : null;
  const currentRevisionDate = singleIdentityCandidate(
    revisions
      .filter((value) => value.number === currentRevisionNumber)
      .map((value) => value.date),
    adapterId,
    'current revision date',
  );
  const originalIssueDate = singleIdentityCandidate(
    [
      ...firstPageText.matchAll(
        /\bORIGINAL\s+ISSUE\s*:\s*([A-Z]{3,9}\s+\d{1,2},\s+\d{4})\b/giu,
      ),
    ].map((match) =>
      requiredExtractedDate(match[1], adapterId, 'original issue date'),
    ),
    adapterId,
    'original issue date',
  );
  const publicationDate = currentRevisionDate || originalIssueDate;
  if (!documentCode || !publicationDate) return null;
  return {
    documentCode,
    businessRevision:
      currentRevisionNumber === null
        ? 'ORIGINAL ISSUE'
        : `R${currentRevisionNumber}`,
    revisionDate: publicationDate,
    sourceGeneratedDate: '',
    sourceType: 'boeing_sb',
  };
}

function extractAirbusServiceBulletin({ firstPageText }) {
  if (
    !/\bAIRBUS\b/iu.test(firstPageText) ||
    !/\bSERVICE\s+BULLETIN\b/iu.test(firstPageText) ||
    !/\bATA\s+SYSTEM\s*:\s*\d{2}\b/iu.test(firstPageText)
  ) {
    return null;
  }
  const adapterId = 'issuer.airbus.service_bulletin.v1';
  const documentCode = singleIdentityCandidate(
    [
      ...firstPageText.matchAll(
        /\b(A(?:318|319|320|321|330|340|350|380)-\d{2}-[A-Z0-9]{3,5})\b/giu,
      ),
    ].map((match) => match[1].toUpperCase()),
    adapterId,
    'document code',
  );
  const revisions = [
    ...firstPageText.matchAll(
      /\bREV\s+(\d{1,3})\s+([A-Z]{3,9}\s+\d{1,2}\/\d{2,4})\b/giu,
    ),
  ]
    .map((match) => ({
      number: Number(match[1]),
      date: parseEnglishDate(match[2]),
    }))
    .filter((value) => Number.isSafeInteger(value.number) && value.date)
    .sort(
      (left, right) =>
        right.number - left.number || right.date.localeCompare(left.date),
    );
  if (!documentCode || revisions.length === 0) return null;
  const currentRevision = revisions[0];
  const sameRevisionDates = new Set(
    revisions
      .filter((value) => value.number === currentRevision.number)
      .map((value) => value.date),
  );
  if (sameRevisionDates.size !== 1) {
    fail(
      'DM_PDF_VERSION_IDENTITY_CONFLICT',
      'Actual Airbus PDF text reports conflicting dates for the current revision.',
      { documentCode, revision: currentRevision.number },
    );
  }
  return {
    documentCode,
    businessRevision: `R${currentRevision.number}`,
    revisionDate: currentRevision.date,
    sourceGeneratedDate: '',
    sourceType: 'airbus_service_bulletin',
  };
}

const ACTIVATED_IDENTITY_OWNERS = new Map([
  ['issuer.boeing.ftd.v1', extractBoeingFtd],
  ['issuer.faa.airworthiness_directive.v1', extractFaaAd],
  ['issuer.boeing.service_letter.v1', extractBoeingServiceLetter],
  ['issuer.boeing.service_bulletin.v1', extractBoeingServiceBulletin],
  ['issuer.airbus.service_bulletin.v1', extractAirbusServiceBulletin],
]);

export function controlledPdfByteView(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength < 8) {
    fail(
      'INVALID_PDF_INPUT',
      'Selected FileService object is not a PDF byte stream.',
    );
  }
  if (bytes.subarray(0, PDF_HEADER.byteLength).equals(PDF_HEADER)) {
    return {
      bytes,
      offset: 0,
      normalization: 'NONE',
    };
  }
  const bomHeaderEnd = UTF8_BOM.byteLength + PDF_HEADER.byteLength;
  if (
    bytes.byteLength >= bomHeaderEnd &&
    bytes.subarray(0, UTF8_BOM.byteLength).equals(UTF8_BOM) &&
    bytes.subarray(UTF8_BOM.byteLength, bomHeaderEnd).equals(PDF_HEADER)
  ) {
    return {
      bytes: bytes.subarray(UTF8_BOM.byteLength),
      offset: UTF8_BOM.byteLength,
      normalization: 'UTF8_BOM_STRIPPED',
    };
  }
  fail(
    'INVALID_PDF_INPUT',
    'Selected FileService object is not a PDF byte stream.',
  );
}

export function readActualPdfPageCount({
  layout,
  actualSha256,
  actualByteLength,
  inspectionSha256 = actualSha256,
  inspectionByteLength = actualByteLength,
} = {}) {
  const pageCount = Number(layout?.pageCount);
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    fail(
      'DM_PDF_PAGE_COUNT_UNRESOLVED',
      'Actual PDF layout did not provide a positive page count.',
    );
  }
  if (
    String(layout?.sourceSha256 || '').toLowerCase() !==
      `sha256:${String(inspectionSha256 || '').toLowerCase()}` ||
    Number(layout?.sourceByteLength) !== Number(inspectionByteLength)
  ) {
    fail(
      'DM_PDF_LAYOUT_CONTENT_IDENTITY_MISMATCH',
      'PDF layout observation is not bound to the controlled view of the selected actual bytes.',
    );
  }
  return pageCount;
}

export function resolveActualPdfDocumentIdentity({
  layout,
  actualSha256,
  actualByteLength,
  inspectionSha256 = actualSha256,
  inspectionByteLength = actualByteLength,
  byteViewOffset = 0,
  byteViewNormalization = 'NONE',
  originalFilename,
} = {}) {
  const pageCount = readActualPdfPageCount({
    layout,
    actualSha256,
    actualByteLength,
    inspectionSha256,
    inspectionByteLength,
  });
  const firstPageText = normalizedPageText(layout, FIRST_PAGE_LIMIT);
  const inspectedText = normalizedPageText(layout, INSPECTED_PAGE_LIMIT);
  if (inspectedText.length < 40) {
    fail(
      'DM_PDF_TEXT_IDENTITY_UNAVAILABLE',
      'The first three actual PDF pages contain insufficient text for governed identity.',
      { pageCount },
    );
  }
  const extractedCandidates = [...ACTIVATED_IDENTITY_OWNERS.entries()]
    .map(([adapterId, owner]) => ({
      adapterId,
      identity: owner({ firstPageText, inspectedText }),
    }))
    .filter((candidate) => candidate.identity?.documentCode);
  if (extractedCandidates.length > 1) {
    fail(
      'DM_PDF_FAMILY_IDENTITY_CONFLICT',
      'The actual PDF pages do not prove one unambiguous adapter-owned publication identity.',
      {
        extractedCandidates: extractedCandidates.map((candidate) => ({
          adapterId: candidate.adapterId,
          documentCode: candidate.identity.documentCode,
        })),
      },
    );
  }
  const adapter = extractedCandidates.length === 1
    ? resolveDocumentFamilyAdapter({
        adapterId: extractedCandidates[0].adapterId,
      })
    : resolveDocumentFamilyAdapter({
        filename: String(originalFilename || '').trim(),
        title: layout?.metadata?.title || '',
        content: inspectedText,
      });
  if (!adapter?.adapterId || adapter.adapterId === GENERIC_ADAPTER_ID) {
    fail(
      'DM_PDF_FAMILY_UNRESOLVED',
      'The production DocumentFamilyAdapter registry could not resolve the actual PDF family.',
    );
  }
  const identityOwner = ACTIVATED_IDENTITY_OWNERS.get(adapter.adapterId);
  if (!identityOwner) {
    fail(
      'DM_PDF_FAMILY_IDENTITY_NOT_ACTIVATED',
      `No production DM identity owner is activated for ${adapter.adapterId}.`,
      { adapterId: adapter.adapterId, documentFamily: adapter.docFamily },
    );
  }
  const extracted = extractedCandidates[0]?.identity;
  if (!extracted?.documentCode) {
    fail(
      'DM_PDF_IDENTITY_UNRESOLVED',
      `Actual PDF text did not prove the primary publication identity for ${adapter.adapterId}.`,
      { adapterId: adapter.adapterId, pageCount },
    );
  }
  const issuer = String(adapter.issuerPolicy?.issuer || '')
    .trim()
    .toUpperCase();
  if (!issuer || !adapter.docFamily) {
    fail(
      'DM_PDF_FAMILY_ADAPTER_INVALID',
      `Resolved adapter ${adapter.adapterId} lacks issuer/family identity.`,
      { adapterId: adapter.adapterId },
    );
  }
  const provenance = {
    schemaVersion: 'wiselink.document_code_provenance.v1',
    source: 'pdf_text_first_three_pages',
    candidates: [extracted.documentCode],
    inspectedSha256: actualSha256,
    conflict: false,
  };
  return {
    pageCount,
    documentCode: extracted.documentCode,
    documentFamily: adapter.docFamily,
    sourceType: extracted.sourceType,
    issuer,
    businessRevision: extracted.businessRevision,
    revisionDate: extracted.revisionDate,
    sourceGeneratedDate: extracted.sourceGeneratedDate,
    documentCodeProvenance: provenance,
    ...(extracted.sourceGeneratedDate
      ? {
          sourceGeneratedDateProvenance: {
            schemaVersion: 'wiselink.source_generated_date_provenance.v1',
            source: 'pdf_text_first_three_pages',
            value: extracted.sourceGeneratedDate,
            inspectedSha256: actualSha256,
            conflict: false,
          },
        }
      : {}),
    documentFamilyAdapterId: adapter.adapterId,
    identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
    pdfByteView: {
      normalization: byteViewNormalization,
      offset: byteViewOffset,
      inspectionSha256,
      inspectionByteLength,
      actualSha256,
      actualByteLength,
    },
  };
}
