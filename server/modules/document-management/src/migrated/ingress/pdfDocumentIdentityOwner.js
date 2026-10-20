import { extractActualPdfMetadata } from './pdfDocumentMetadata.js';
import { resolveDocumentFamilyAdapter } from '../adapters/documentFamilyAdapterRegistry.js';
import {
  AIRBUS_TFU_ADAPTER_ID,
  AIRBUS_TFU_FOOTER_IDENTITY_AUTHORITY,
  airbusTfuIssueDateEvidence,
  airbusTfuPublisherEvidence,
  hasAirbusTfuPrimaryHeader,
  hasCaacCadPrimaryHeader,
  parseSourcePublicationDate,
} from './pdfPublicationEvidence.js';

const FIRST_PAGE_LIMIT = 1;
const INSPECTED_PAGE_LIMIT = 3;
const GENERIC_ADAPTER_ID = 'generic.general_document.v1';
const PDF_HEADER = Buffer.from('%PDF-', 'ascii');
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function fail(code, message, details = {}) {
  // Identity refusal is an actionable input/format failure, not an opaque 500.
  // Keep the stable code without exposing an internal stack to the browser.
  throw Object.assign(new Error(message), { code, details, statusCode: 422 });
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
  match = source.match(/^(\d{1,2})-([A-Z]{3,9})-(\d{4})$/iu);
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
  const date = parseSourcePublicationDate(value) || parseEnglishDate(value);
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

function overlapJoinedPdfLines(layout, pageLimit) {
  const grouped = new Map();
  for (const run of Array.isArray(layout?.textRuns) ? layout.textRuns : []) {
    const page = Number(run?.page);
    const x = Number(run?.x);
    const y = Number(run?.y);
    const text = String(run?.text || '').normalize('NFKC').replace(/\s+/gu, '');
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > pageLimit ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !text
    ) {
      continue;
    }
    const key = `${page}:${Math.round(y * 4)}`;
    const values = grouped.get(key) || [];
    values.push({ page, x, text });
    grouped.set(key, values);
  }
  return [...grouped.values()].map((values) => {
    const ordered = values.sort(
      (left, right) => left.x - right.x || left.text.localeCompare(right.text),
    );
    return {
      page: ordered[0].page,
      text: ordered.reduce((joined, value) => {
        if (!joined) return value.text;
        const limit = Math.min(joined.length, value.text.length);
        for (let overlap = limit; overlap >= 1; overlap -= 1) {
          if (joined.endsWith(value.text.slice(0, overlap))) {
            return `${joined}${value.text.slice(overlap)}`;
          }
        }
        return `${joined}${value.text}`;
      }, ''),
    };
  });
}

function extractAmecoEngineeringOrder({ firstPageText, inspectedText, layout }) {
  if (
    !/(?:工程指令|ENGINEERING\s+ORDER)\s*[（(]?\s*(?:第一部分|SECTION\s*1)\s*[）)]?/iu.test(
      firstPageText,
    ) ||
    !/\bCCA-ED-021\b/iu.test(firstPageText) ||
    !/\bAMECO\b/iu.test(inspectedText)
  ) {
    return null;
  }
  const adapterId = 'issuer.ameco.engineering_order.v1';
  const occurrences = overlapJoinedPdfLines(
    layout,
    INSPECTED_PAGE_LIMIT,
  ).flatMap((line) => {
    const matches = [
      ...line.text.matchAll(
        /\b(AEO-[A-Z0-9]+-\d{2}-\d{4})-R(\d{2,3})(?![A-Z0-9-])/giu,
      ),
    ];
    return matches.map((match) => ({
      page: line.page,
      documentCode: match[1].toUpperCase(),
      revision: `R${Number(match[2])}`,
    }));
  });
  const documentCode = singleIdentityCandidate(
    occurrences.map((occurrence) => occurrence.documentCode),
    adapterId,
    'document code',
  );
  const businessRevision = singleIdentityCandidate(
    occurrences.map((occurrence) => occurrence.revision),
    adapterId,
    'business revision',
  );
  const independentPages = new Set(
    occurrences
      .filter(
        (occurrence) =>
          occurrence.documentCode === documentCode &&
          occurrence.revision === businessRevision,
      )
      .map((occurrence) => occurrence.page),
  );
  if (!documentCode || !businessRevision || independentPages.size < 2) {
    return null;
  }
  return {
    documentCode,
    businessRevision,
    revisionDate: '',
    sourceGeneratedDate: '',
    sourceType: 'ameco_engineering_order',
  };
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
  // Federal Register's primary docket precedes the directive heading. Only
  // this bounded header admits the observed en dash; cited body ADs do not.
  const primaryHeaderText = firstPageText.slice(0,
    firstPageText.search(/\bAIRWORTHINESS\s+DIRECTIVES?\b/iu));
  const documentCode = singleIdentityCandidate(
    [
      ...[...firstPageText.matchAll(
        /(?:AMENDMENT\s+\d+-\d+\s*;\s*)?AD\s+(\d{4}-\d{2}-\d{2})\b/giu,
      )].map((match) => `AD-${match[1]}`),
      ...[...primaryHeaderText.matchAll(
        /\[\s*DOCKET\s+NO\.\s+FAA[-\u2013]\d{4}[-\u2013]\d+\s*;[^\[\]]*\bAMENDMENT\s+\d+[-\u2013]\d+\s*;\s*AD\s+(\d{4}[-\u2013]\d{2}[-\u2013]\d{2})\s*\]/giu,
      )].map((match) => `AD-${match[1].replace(/\u2013/gu, '-')}`),
    ],
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

function extractCaacCad({ firstPageText, inspectedText }) {
  if (!hasCaacCadPrimaryHeader(firstPageText)) return null;
  const adapterId = 'issuer.caac.cad.v1';
  const documentCode = singleIdentityCandidate(
    [...firstPageText.matchAll(/编\s*号\s*[:：]\s*(CAD\s*\d{4}\s*-\s*[A-Z0-9]+\s*-\s*\d{2,4})\b/giu)]
      .map((match) => match[1].replace(/\s+/gu, '').toUpperCase()),
    adapterId,
    'document code',
  );
  const readDate = (label, fieldName) => singleIdentityCandidate(
    [...inspectedText.matchAll(new RegExp(`${label}\\s*[:：]\\s*(\\d{4}(?:[-/.]|年)\\s*\\d{1,2}(?:[-/.]|月)\\s*\\d{1,2}日?)`, 'gu'))]
      .map((match) => requiredExtractedDate(match[1], adapterId, fieldName)),
    adapterId,
    fieldName,
  );
  const revisionDate = readDate('颁\\s*发\\s*日\\s*期', 'publication date');
  readDate('生\\s*效\\s*日\\s*期', 'effective date');
  if (!documentCode || !revisionDate) return null;
  return {
    documentCode,
    // The amendment is a source observation, not an ordered Rn revision.
    businessRevision: '',
    revisionDate,
    sourceGeneratedDate: '',
    sourceType: 'ad',
  };
}

function extractAirbusTechnicalFollowUp({ firstPageText, layout }) {
  if (!hasAirbusTfuPrimaryHeader(firstPageText)) return null;
  const publisher = airbusTfuPublisherEvidence(layout);
  if (!publisher) return null;
  const documentCode = singleIdentityCandidate(
    [...firstPageText.matchAll(/\bREFERENCE\s*:\s*(\d{2}\s*\.\s*\d{2}\s*\.\s*\d{5})\b/giu)]
      .map((match) => match[1].replace(/\s+/gu, '')),
    AIRBUS_TFU_ADAPTER_ID,
    'document code',
  );
  const dates = airbusTfuIssueDateEvidence(layout);
  const revisionDate = singleIdentityCandidate(
    dates
      .map((evidence) => requiredExtractedDate(evidence.value, AIRBUS_TFU_ADAPTER_ID, 'issue date')),
    AIRBUS_TFU_ADAPTER_ID,
    'issue date',
  );
  if (!revisionDate || !dates.some((evidence) => evidence.page === 1)) fail('DM_PDF_VERSION_IDENTITY_UNRESOLVED', 'Actual TFU primary header has no valid issue date.', { adapterId: AIRBUS_TFU_ADAPTER_ID });
  return {
    documentCode,
    businessRevision: '',
    revisionDate,
    sourceGeneratedDate: '',
    sourceType: 'airbus_tfu',
    publisherEvidence: publisher,
    ...(publisher.source === 'PUBLISHER_FOOTER' ? { identityAuthority: AIRBUS_TFU_FOOTER_IDENTITY_AUTHORITY } : {}),
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

function extractComacServiceLetter({ firstPageText, layout }) {
  const runs = (Array.isArray(layout?.textRuns) ? layout.textRuns : [])
    .filter((run) => Number(run.page) === 1 && Number.isFinite(run.x) && Number.isFinite(run.y))
    .sort((left, right) => right.y - left.y || left.x - right.x);
  const rows = [];
  for (const run of runs) {
    const row = rows.find((value) => Math.abs(value.y - run.y) <= 2);
    if (row) row.runs.push(run);
    else rows.push({ y: run.y, runs: [run] });
  }
  // COMAC draws the form labels first and the values at the end of the stream.
  // Rejoin actual visual rows; text-object order is not publication reading order.
  const visualText = rows.length ? rows.map((row) => row.runs
    .sort((left, right) => left.x - right.x).map((run) => run.text).join(' ')).join('\n')
    : firstPageText;
  const text = visualText.replace(/\s+/gu, '');
  if (!text.includes('上海飞机客户服务有限公司') ||
      !text.includes('服务信函') || !/(?:有效性|适用性)[:：]C919飞机/u.test(text)) return null;
  const adapterId = 'issuer.comac.service_letter.v1';
  const labelledCodes = [...visualText.matchAll(/编\s*号\s*[:：]\s*(\S+)/gu)];
  const headers = labelledCodes.map((match) => match[1].match(/^(SL-\d{2}-\d{4})-(R\d{2})$/u));
  if (headers.some((match) => !match)) {
    fail('DM_PDF_IDENTITY_UNRESOLVED', 'COMAC primary code is outside the supported publication format.', { adapterId });
  }
  const documentCode = singleIdentityCandidate(headers.map((m) => m[1]), adapterId, 'document code');
  const businessRevision = singleIdentityCandidate(headers.map((m) => m[2]), adapterId, 'business revision');
  if (!documentCode || !businessRevision) return null;
  const dateField = (label, allowNa) => {
    const values = [...visualText.matchAll(new RegExp(`${[...label].join('\\s*')}\\s*[:：]\\s*(\\S*)`, 'gu'))].map((m) => {
      if (allowNa && /^N\/?A$/iu.test(m[1])) return 'N/A';
      const parts = m[1].match(/^(\d{4})-(\d{2})-(\d{2})$/u);
      const value = parts ? validDate(parts[1], parts[2], parts[3]) : '';
      if (!value) fail('DM_PDF_IDENTITY_UNRESOLVED', 'COMAC publication has an invalid labelled date.', { adapterId, label });
      return value;
    });
    return singleIdentityCandidate(values, adapterId, label);
  };
  const originalDate = dateField('原版日期', false);
  const revisionValue = dateField('修订日期', true);
  const revisedDate = revisionValue === 'N/A' ? '' : revisionValue;
  if (!originalDate || (businessRevision !== 'R00' && !revisedDate)) return null;
  if (businessRevision === 'R00' && revisedDate && revisedDate !== originalDate) {
    fail('DM_PDF_IDENTITY_CONFLICT', 'COMAC original issue has a conflicting revision date.', { adapterId });
  }
  return {
    documentCode,
    businessRevision,
    revisionDate: businessRevision === 'R00' ? originalDate : revisedDate,
    sourceGeneratedDate: '',
    sourceType: 'comac_service_letter',
  };
}

const BOEING_SB_CODE_PATTERN =
  '(?:737MAX|737NG|737|747|757|767|777|787)-\\d{2}(?:A?\\d{4}|-\\d{4})';
const BOEING_787_PUBLICATION_CODE_PATTERN = 'B787-\\d{5}-SB\\d{6}-\\d{2}';

function extractBoeingServiceBulletin({ firstPageText, inspectedText, layout }) {
  if (
    !/\bSERVICE\s+BULLETIN\b/iu.test(firstPageText) ||
    !/\bBOEING(?:\s+PROPRIETARY|\s+SERVICE\s+BULLETIN|\s+COMPANY)\b/iu.test(
      inspectedText,
    )
  ) {
    return null;
  }
  const adapterId = 'issuer.boeing.service_bulletin.v1';
  // Boeing 787 publication-module PDFs have a title-page Publication row,
  // not the legacy "Service Bulletin Number / Original Issue" masthead.
  // Bind the code, issue and date from that same primary row; cited data
  // modules and a filename alone must never establish publication identity.
  const publicationRows = [firstPageText, ...boeingPublicationRowTexts(layout)]
    .flatMap((text) => [...text.matchAll(new RegExp(
      `\\bPUBLICATION\\s*:\\s*(${BOEING_787_PUBLICATION_CODE_PATTERN})\\s+ISSUE\\s+(\\d{1,4})\\s*,\\s*(\\d{1,2}\\s+[A-Z]{3,9}\\s+\\d{4})\\b`,
      'giu',
    ))]);
  const cover = boeingCoverNumberEvidence(layout);
  const legacyCodes = [...firstPageText.matchAll(new RegExp(
    `\\bSERVICE\\s+BULLETIN\\s+NUMBER\\s*:\\s*(${BOEING_SB_CODE_PATTERN})\\b`, 'giu',
  ))].map((match) => match[1].toUpperCase());
  const documentCode = singleIdentityCandidate(
    legacyCodes.concat(cover.codes,
      publicationRows.map((match) => match[1].toUpperCase()),
    ),
    adapterId,
    'document code',
  );
  if (publicationRows.length > 0) {
    const businessRevision = singleIdentityCandidate(
      publicationRows.map((match) => `ISSUE ${match[2]}`),
      adapterId,
      'publication issue',
    );
    const revisionDate = singleIdentityCandidate(
      publicationRows.map((match) => requiredExtractedDate(
        match[3], adapterId, 'publication date',
      )),
      adapterId,
      'publication issue date',
    );
    return {
      documentCode,
      businessRevision,
      revisionDate,
      sourceGeneratedDate: '',
      sourceType: 'boeing_sb',
    };
  }
  // The separated cover variant proves its date in the same primary header;
  // a revision cited below SUBJECT must not become the publication revision.
  const versionText = cover.codes.length ? cover.dateText : firstPageText;
  const revisions = [
    ...versionText.matchAll(
      /\bREVISION\s+(\d{1,4})\s*:\s*([A-Z]{3,9}\s+\d{1,2},\s+\d{4})\b/giu,
    ),
  ].map((match) => ({
    number: Number(match[1]),
    date: requiredExtractedDate(match[2], adapterId, 'publication date'),
  }));
  const currentRevisionNumber =
    revisions.length > 0
      ? cover.codes.length
        ? Number(singleIdentityCandidate(revisions.map((value) => String(value.number)), adapterId, 'current revision number'))
        : Math.max(...revisions.map((value) => value.number))
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
      ...versionText.matchAll(
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

/** SPECIAL ATTENTION may separate the masthead and Number field. Only an
 * independently positioned first-cover header can bridge that separation. */
function boeingCoverNumberEvidence(layout) {
  const runs = (Array.isArray(layout?.textRuns) ? layout.textRuns : []).filter((run) =>
    Number(run?.page) === 1 && Number.isFinite(run?.x) && Number.isFinite(run?.y) &&
    Number.isFinite(run?.fontSize) && run.fontSize > 0);
  const boundary = Math.max(...runs.filter((run) => /^(?:ATA\s+SYSTEM|SUBJECT)\s*:/iu.test(normalizeText(run.text)))
    .map((run) => run.y));
  if (!Number.isFinite(boundary)) return { codes: [], dateText: '' };
  const titles = runs.filter((run) => /^SERVICE\s+BULLETIN$/iu.test(normalizeText(run.text)) && run.y > boundary);
  const headers = [];
  const datePattern = /^(?:ORIGINAL\s+ISSUE|REVISION\s+\d{1,4})\s*:\s*[A-Z]{3,9}\s+\d{1,2},\s+\d{4}$/iu;
  const rowText = (label, reach) => runs.filter((run) => Math.abs(run.y - label.y) <= 1 &&
    run.x >= label.x && run.x - label.x <= label.fontSize * reach)
    .sort((left, right) => left.x - right.x).map((run) => normalizeText(run.text)).join(' ');
  for (const title of titles) {
    for (const label of runs.filter((run) => /^NUMBER\s*:/iu.test(normalizeText(run.text)) &&
      run.y < title.y && run.y > boundary && title.y - run.y <= title.fontSize * 4 &&
      title.fontSize >= run.fontSize * 1.2)) {
      const match = rowText(label, 12).match(new RegExp(`^NUMBER\\s*:\\s*(${BOEING_SB_CODE_PATTERN})$`, 'iu'));
      if (!match) continue;
      const dates = runs.filter((run) => /^(?:ORIGINAL\s+ISSUE|REVISION\s+\d{1,4})\s*:/iu.test(normalizeText(run.text)) &&
        Math.abs(run.x - label.x) <= 2 && run.y < title.y && run.y > boundary);
      const dateRows = dates.map((run) => rowText(run, 24));
      headers.push({ code: match[1].toUpperCase(), dates: dateRows,
        valid: dates.length > 0 && dates.every((run) => run.y < label.y) && dateRows.every((text) => datePattern.test(text)) });
    }
  }
  return { codes: headers.map((header) => header.code),
    dateText: headers.every((header) => header.valid) ? headers.flatMap((header) => header.dates).join(' ') : '' };
}

function boeingPublicationRowTexts(layout) {
  const firstPageRuns = (Array.isArray(layout?.textRuns) ? layout.textRuns : [])
    .filter((run) => Number(run?.page) === 1 && Number.isFinite(run?.x) && Number.isFinite(run?.y));
  return firstPageRuns
    .filter((run) => /^Publication\s*:$/iu.test(normalizeText(run.text)))
    .map((label) => firstPageRuns
      // PDF text-object order is not reading order. These three table cells
      // share a visual baseline (font baselines may differ by half a point).
      .filter((run) => Math.abs(run.y - label.y) <= 1 && run.x >= label.x)
      .sort((left, right) => left.x - right.x)
      .map((run) => normalizeText(run.text))
      .join(' '));
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

function extractHoneywellServiceInformationLetter({ firstPageText }) {
  if (
    !/\bHONEYWELL(?:\s+INTERNATIONAL\s+INC\.)?\b/iu.test(firstPageText) ||
    !/\bSERVICE\s+INFORMATION\s+LETTER\b/iu.test(firstPageText)
  ) {
    return null;
  }
  const adapterId = 'issuer.honeywell.sil.v1';
  const documentCode = singleIdentityCandidate(
    [...firstPageText.matchAll(/\bPUBLICATION\s+NUMBER\s+(D\d{12})\b/giu)].map(
      (match) => match[1].toUpperCase(),
    ),
    adapterId,
    'document code',
  );
  const revisions = [
    ...firstPageText.matchAll(
      /\bREVISION\s+(\d{1,4})\s*,\s*(\d{1,2}\s+[A-Z]{3,9}\s+\d{4})\b/giu,
    ),
  ].map((match) => ({
    number: Number(match[1]),
    date: requiredExtractedDate(match[2], adapterId, 'revision date'),
  }));
  if (!documentCode || revisions.length === 0) return null;
  const revisionNumber = Math.max(...revisions.map((value) => value.number));
  const revisionDate = singleIdentityCandidate(
    revisions
      .filter((value) => value.number === revisionNumber)
      .map((value) => value.date),
    adapterId,
    'current revision date',
  );
  return {
    documentCode,
    businessRevision: `R${revisionNumber}`,
    revisionDate,
    sourceGeneratedDate: '',
    sourceType: 'supplier_sil',
  };
}

function extractAirbusRetrofitInformationLetter({ firstPageText }) {
  if (
    !/\bAIRBUS\b/iu.test(firstPageText) ||
    !/\bRETROFIT\s+INFORMATION\s+LETTER\s*-\s*RIL\b/iu.test(firstPageText)
  ) {
    return null;
  }
  const adapterId = 'issuer.airbus.retrofit_information_letter.v1';
  const headers = [
    ...firstPageText.matchAll(
      /\bRIL\s+REFERENCE\s*:\s*(V[0-9A-Z]+)\s+R(\d{1,3})\s+DATED\s+(\d{1,2}-[A-Z]{3,9}-\d{4})\b/giu,
    ),
  ];
  const documentCode = singleIdentityCandidate(
    headers.map((match) => match[1].toUpperCase()),
    adapterId,
    'document code',
  );
  const revisionNumber = singleIdentityCandidate(
    headers.map((match) => String(Number(match[2]))),
    adapterId,
    'revision number',
  );
  const revisionDate = singleIdentityCandidate(
    headers.map((match) =>
      requiredExtractedDate(match[3], adapterId, 'revision date'),
    ),
    adapterId,
    'revision date',
  );
  if (!documentCode || !revisionNumber || !revisionDate) return null;
  return {
    documentCode,
    businessRevision: `R${revisionNumber}`,
    revisionDate,
    sourceGeneratedDate: '',
    sourceType: 'airbus_retrofit_information_letter',
  };
}

function extractAirbusOperatorTransmission({ firstPageText }) {
  if (
    !/\bAIRBUS\b/iu.test(firstPageText) ||
    !/\b(?:ALERT\s+OPERATORS|OPERATORS\s+INFORMATION|FLIGHT\s+OPERATIONS)\s+TRANSMISSION\s*-\s*(?:AOT|OIT|FOT)\b/iu.test(
      firstPageText,
    )
  ) {
    return null;
  }
  const adapterId = 'issuer.airbus.operator_transmission.v1';
  const headers = [
    ...firstPageText.matchAll(
      /\bOUR\s+REF\.\s*:\s*([A-Z0-9]+(?:[./-][A-Z0-9]+)+)\s+REV\s+(\d{1,3})\s+DATED\s+(\d{1,2}-[A-Z]{3,9}-\d{4})\b/giu,
    ),
  ];
  const documentCode = singleIdentityCandidate(
    headers.map((match) => match[1].toUpperCase()),
    adapterId,
    'document code',
  );
  const revisionNumber = singleIdentityCandidate(
    headers.map((match) => String(Number(match[2]))),
    adapterId,
    'revision number',
  );
  const revisionDate = singleIdentityCandidate(
    headers.map((match) =>
      requiredExtractedDate(match[3], adapterId, 'revision date'),
    ),
    adapterId,
    'revision date',
  );
  if (!documentCode || !revisionNumber || !revisionDate) return null;
  return {
    documentCode,
    businessRevision: `R${revisionNumber}`,
    revisionDate,
    sourceGeneratedDate: '',
    sourceType: 'airbus_operator_transmission',
  };
}

const ACTIVATED_IDENTITY_OWNERS = new Map([
  ['issuer.ameco.engineering_order.v1', extractAmecoEngineeringOrder],
  ['issuer.boeing.ftd.v1', extractBoeingFtd],
  ['issuer.faa.airworthiness_directive.v1', extractFaaAd],
  ['issuer.caac.cad.v1', extractCaacCad],
  [AIRBUS_TFU_ADAPTER_ID, extractAirbusTechnicalFollowUp],
  ['issuer.boeing.service_letter.v1', extractBoeingServiceLetter],
  ['issuer.comac.service_letter.v1', extractComacServiceLetter],
  ['issuer.boeing.service_bulletin.v1', extractBoeingServiceBulletin],
  ['issuer.airbus.service_bulletin.v1', extractAirbusServiceBulletin],
  ['issuer.honeywell.sil.v1', extractHoneywellServiceInformationLetter],
  [
    'issuer.airbus.retrofit_information_letter.v1',
    extractAirbusRetrofitInformationLetter,
  ],
  ['issuer.airbus.operator_transmission.v1', extractAirbusOperatorTransmission],
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

/** @param {{ layout: import('../../../../professional-input/pure/professional-input-pure.types').ParsedPdfLayout, actualSha256: string, actualByteLength: number, inspectionSha256?: string, inspectionByteLength?: number }} input */
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

/** @param {{ layout: import('../../../../professional-input/pure/professional-input-pure.types').ParsedPdfLayout, actualSha256: string, actualByteLength: number, inspectionSha256?: string, inspectionByteLength?: number, byteViewOffset?: number, byteViewNormalization?: string, originalFilename?: string }} input */
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
      identity: owner({ firstPageText, inspectedText, layout }),
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
  const adapter =
    extractedCandidates.length === 1
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
    extractedMetadata: extractActualPdfMetadata({ layout, actualSha256, actualByteLength, identity: { documentFamily: adapter.docFamily, issuer } }),
    ...(extracted.publisherEvidence ? {
      publicationIdentityEvidence: {
        schemaVersion: 'wiselink.pdf_publication_identity_evidence.v1',
        adapterId: adapter.adapterId,
        documentCode: extracted.documentCode,
        issueDate: extracted.revisionDate,
        sourceSha256: actualSha256,
        sourceByteLength: actualByteLength,
        primaryHeaderLocator: { kind: 'PDF_PAGE', pageIndex: 0 },
        publisher: {
          ...extracted.publisherEvidence,
          sourceLocator: { kind: 'PDF_PAGE', pageIndex: extracted.publisherEvidence.page - 1 },
        },
      },
    } : {}),
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
    identityAuthority: extracted.identityAuthority || 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
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
