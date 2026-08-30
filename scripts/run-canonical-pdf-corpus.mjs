#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), '..');
const DEFAULT_CORPUS_ROOT = '/Volumes/SSD/LLM/WiseLink/Docs/uploads';
const RECORD_SCHEMA = 'wiselink.canonical_pdf_corpus_observation.v1';
const MANIFEST_SCHEMA = 'wiselink.canonical_pdf_corpus_scan.v1';
const SUMMARY_SCHEMA = 'wiselink.canonical_pdf_corpus_summary.v1';
const WORKER_BEGIN = '<<<WISELINK-CORPUS-WORKER-JSON-BEGIN>>>';
const WORKER_END = '<<<WISELINK-CORPUS-WORKER-JSON-END>>>';

export async function scanPdfCorpus(corpusRoot) {
  const exactRoot = resolve(corpusRoot);
  const entries = [];
  const ignoredSymbolicLinks = [];

  async function visit(directory) {
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const absolutePath = resolve(directory, child.name);
      if (child.isSymbolicLink()) {
        if (child.name.toLowerCase().endsWith('.pdf')) {
          ignoredSymbolicLinks.push(
            relative(exactRoot, absolutePath).replaceAll('\\', '/'),
          );
        }
        continue;
      }
      if (child.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!child.isFile() || !child.name.toLowerCase().endsWith('.pdf')) {
        continue;
      }
      const input = await readStableInputIdentity(absolutePath);
      entries.push({
        relativePath: relative(exactRoot, absolutePath).replaceAll('\\', '/'),
        absolutePath,
        byteLength: input.byteLength,
        sha256: input.sha256,
        modifiedAt: input.modifiedAt,
      });
    }
  }

  await visit(exactRoot);
  entries.sort(compareEntries);
  return { root: exactRoot, entries, ignoredSymbolicLinks };
}

export function selectCorpusEntries(entries, options = {}) {
  const shardCount = integerOption(
    options.shardCount ?? 1,
    'shardCount',
    1,
    1024,
  );
  const shardIndex = integerOption(
    options.shardIndex ?? 0,
    'shardIndex',
    0,
    shardCount - 1,
  );
  const match = String(options.match ?? '').normalize('NFC');
  const limit =
    options.limit === undefined
      ? Number.POSITIVE_INFINITY
      : integerOption(options.limit, 'limit', 1, Number.MAX_SAFE_INTEGER);
  return entries
    .filter(
      (entry) => !match || entry.relativePath.normalize('NFC').includes(match),
    )
    .filter((_entry, index) => index % shardCount === shardIndex)
    .slice(0, limit);
}

export function recordIdentity(value) {
  return `${value.relativePath}\n${value.byteLength}\n${value.sha256}`;
}

export function productionFamilyRegistryInputFromDmSource(
  resolved,
  adapterIdFromPreflight,
) {
  if (!resolved?.family || !resolved?.preflight) {
    throw new Error('DM_FAMILY_OR_PREFLIGHT_NOT_RESOLVED');
  }
  const adapterId = adapterIdFromPreflight(resolved.preflight);
  return {
    input: {
      family: resolved.family.documentFamily,
      issuerAuthority: resolved.family.issuerAuthority,
      ...(adapterId ? { adapterId } : {}),
    },
    adapterId: adapterId || null,
  };
}

export function isReusableCorpusRecord(
  record,
  { entry, corpusRoot, baseCommit },
) {
  return (
    record?.schemaVersion === RECORD_SCHEMA &&
    record?.baseCommit === baseCommit &&
    record?.input?.corpusRoot === corpusRoot &&
    ['SUCCESS', 'FAILURE'].includes(record?.terminal?.status) &&
    recordIdentity(record.input) === recordIdentity(entry)
  );
}

export function classifyTerminalOutcome(observation) {
  if (observation.inputChanged) {
    return failure(
      'INPUT_CHANGED_DURING_RUN',
      'Input bytes changed after the fresh scan.',
    );
  }

  if (
    observation.documentManagement?.descriptorEvidence?.status ===
    'ACTUAL_SOURCE_MISMATCH'
  ) {
    return failure(
      'IDENTITY_OR_READBACK_FAILED',
      'The production normalized descriptor disagreed with the actual filename, SHA-256, or byte length.',
    );
  }

  if (observation.layout?.status === 'FAILED') {
    const diagnostic = `${observation.layout.code ?? ''}:${observation.layout.message ?? ''}`;
    if (/password|encrypted/iu.test(diagnostic)) {
      return failure(
        'ENCRYPTED_PDF',
        'The canonical layout owner rejected an encrypted PDF.',
      );
    }
    if (observation.layout.code === 'PDFJS_LAYOUT_PARSE_FAILED') {
      return failure(
        'DAMAGED_OR_UNREADABLE_PDF',
        'The canonical layout owner rejected the PDF bytes.',
      );
    }
    return failure(
      'LAYOUT_RUNTIME_FAILED',
      'The canonical layout owner could not complete.',
    );
  }

  if (observation.pageCoverage?.status === 'OCR_REQUIRED_FULL') {
    return failure(
      'OCR_NEEDED',
      'The production layout/OCR owner reports that every page requires OCR.',
    );
  }
  if (observation.pageCoverage?.status === 'OCR_REQUIRED_PARTIAL') {
    return failure(
      'PARTIAL_OCR_NEEDED',
      `${observation.pageCoverage.ocrRequiredPageCount} of ${observation.pageCoverage.pageCount} pages require OCR.`,
    );
  }
  if (observation.pageCoverage?.status === 'VISUAL_OCR_REQUIRED_FULL') {
    return failure(
      'VISUAL_TEXT_OCR_NEEDED',
      'The production layout owner reports that every page has visually unverified raster text requiring OCR.',
    );
  }
  if (observation.pageCoverage?.status === 'VISUAL_OCR_REQUIRED_PARTIAL') {
    return failure(
      'PARTIAL_VISUAL_OCR_NEEDED',
      `${observation.pageCoverage.visualTextUnverifiedPageCount} pages have visually unverified raster text requiring OCR.`,
    );
  }
  if (observation.pageCoverage?.status === 'VISUAL_COVERAGE_UNPROVEN') {
    return failure(
      'VISUAL_TEXT_COVERAGE_UNPROVEN',
      'The text layer is non-empty, but the production owner has not proved raster/operator visual-content coverage.',
    );
  }
  if (
    observation.pageCoverage?.status === 'OWNER_DIAGNOSTIC_UNAVAILABLE' ||
    observation.pageCoverage?.missingCoveragePageCount > 0
  ) {
    return failure(
      'PAGE_COVERAGE_DIAGNOSTIC_UNAVAILABLE',
      'The production layout/OCR owner did not account for every page.',
    );
  }
  if (observation.pageCoverage?.status !== 'CONTENT_COVERAGE_PROVEN') {
    return failure(
      'PAGE_COVERAGE_NOT_PROVEN',
      'The production layout/OCR owner did not prove text and visual coverage for every page.',
    );
  }

  if (observation.classification?.canonicalDocumentFamily === 'GENERIC') {
    return failure(
      'UNKNOWN_FAMILY',
      'The production classifier did not resolve a governed family.',
    );
  }

  if (
    observation.documentManagement?.status &&
    observation.documentManagement.status !== 'COMMITTED_AND_RESOLVED'
  ) {
    const code = String(
      observation.documentManagement.failureCode ??
        observation.documentManagement.decision ??
        'DOCUMENT_MANAGEMENT_FAILED',
    );
    if (/IDENTITY_NOT_COMMITTABLE|IDENTITY.*UNRESOLVED/iu.test(code)) {
      return failure(
        'DM_IDENTITY_NOT_COMMITTABLE',
        `Production Document Management did not create a DocumentVersion: ${code}.`,
      );
    }
    if (/REVIEW_REQUIRED/iu.test(code)) {
      return failure(
        'DM_REVIEW_REQUIRED',
        `Production Document Management requires review before a DocumentVersion can be used: ${code}.`,
      );
    }
    if (/SOURCE_BYTES_TOO_LARGE/iu.test(code)) {
      return failure(
        'SOURCE_BYTES_TOO_LARGE',
        'The production FileService artifact store rejected the actual PDF size.',
      );
    }
    if (
      /IDENTITY|READBACK|SOURCE_BINDING|ACTUAL_BYTE|VERSION_DRIFT/iu.test(code)
    ) {
      return failure('IDENTITY_OR_READBACK_FAILED', code);
    }
    return failure('DOCUMENT_MANAGEMENT_FAILED', code);
  }

  if (
    observation.profile?.failureCode === 'PDF_PRODUCER_PROFILE_NOT_AVAILABLE'
  ) {
    return failure(
      'UNSUPPORTED_PROFILE',
      'The production classification owner has no activated PDF producer profile for the resolved DM family/issuer.',
    );
  }

  if (observation.reader?.status === 'FAILED') {
    return failure(
      'READER_FAILED',
      observation.reader.message ?? 'Unified Reader failed.',
    );
  }

  if (observation.canonicalHost?.status === 'CANDIDATE_VERTICAL_VERIFIED') {
    const units = Number(observation.sourceUnits?.count ?? 0);
    const refs = Number(observation.sourceRefs?.count ?? 0);
    const queryResults = Number(observation.reader?.queryResultCount ?? 0);
    if (
      units > 0 &&
      refs > 0 &&
      queryResults > 0 &&
      observation.sourceUnits?.allHaveSourceRefs === true &&
      observation.u0?.status === 'FULL_STRICT_VALIDATOR_PASSED' &&
      observation.reader?.status === 'CANDIDATE_READBACK_VERIFIED'
    ) {
      return {
        status: 'SUCCESS',
        code: 'CANONICAL_READER_VERIFIED',
        message:
          'Canonical Host, frozen.2/U0, and Unified Reader all returned source-bound results.',
        silentFallback: false,
        silentEmpty: false,
      };
    }
    return failure(
      'SILENT_EMPTY_PREVENTED',
      'A Host success lacked non-empty source-bound Reader evidence.',
    );
  }

  const diagnostic = [
    observation.canonicalHost?.failureCode,
    observation.canonicalHost?.causeCode,
    observation.canonicalHost?.errorCode,
    observation.canonicalHost?.message,
  ]
    .filter(Boolean)
    .join(':');
  if (/PROFILE_NOT_AVAILABLE|PRODUCER_UNSUPPORTED/iu.test(diagnostic)) {
    return failure(
      'UNSUPPORTED_PROFILE',
      'No activated production parser profile accepted this input.',
    );
  }
  if (
    /IDENTITY|READBACK|SOURCE_BINDING|ACTUAL_BYTE|VERSION_DRIFT/iu.test(
      diagnostic,
    )
  ) {
    return failure('IDENTITY_OR_READBACK_FAILED', diagnostic);
  }
  if (/FULL_U0|U0_|STRICT_VALIDATION|VALIDATOR/iu.test(diagnostic)) {
    return failure('U0_REJECTED_OR_UNAVAILABLE', diagnostic);
  }
  if (/READER/iu.test(diagnostic)) {
    return failure('READER_FAILED', diagnostic);
  }
  if (observation.canonicalHost?.status === 'RECORDING_FAILED') {
    return failure(
      'FAILURE_RECORDING_FAILED',
      diagnostic || 'Host failure recording failed.',
    );
  }
  return failure(
    'CANONICAL_HOST_FAILED',
    diagnostic || 'Canonical Host failed without a mapped category.',
  );
}

export function summarizeRecords(records, context = {}) {
  const byTerminalCode = countBy(records, (record) => record.terminal.code);
  const byFamily = countBy(
    records,
    (record) =>
      record.classification?.canonicalDocumentFamily ?? 'NOT_OBSERVED',
  );
  const byProfileStatus = countBy(
    records,
    (record) =>
      record.profile?.selectionStatus ??
      record.profile?.status ??
      'NOT_OBSERVED',
  );
  const byDocumentManagementStatus = countBy(
    records,
    (record) => record.documentManagement?.status ?? 'NOT_OBSERVED',
  );
  const byDocumentManagementDecision = countBy(
    records,
    (record) => record.documentManagement?.decision ?? 'NOT_OBSERVED',
  );
  const byDocumentManagementFailureCode = countBy(
    records,
    (record) => record.documentManagement?.failureCode ?? 'NONE',
  );
  const byDocumentManagementDescriptorEvidenceStatus = countBy(
    records,
    (record) =>
      record.documentManagement?.descriptorEvidence?.status ?? 'NOT_OBSERVED',
  );
  const byPageCoverageStatus = countBy(
    records,
    (record) => record.pageCoverage?.status ?? 'NOT_OBSERVED',
  );
  const byPageCoverageFailureCode = countBy(
    records,
    (record) => record.pageCoverage?.authoritativeFailureCode ?? 'NONE',
  );
  const byOcrRequirementKind = countBy(
    records,
    (record) => record.pageCoverage?.ocrRequirementKind ?? 'NONE',
  );
  const byHostStatus = countBy(
    records,
    (record) => record.canonicalHost?.status ?? 'NOT_INVOKED',
  );
  const byHostProducerFailureCode = countBy(
    records,
    (record) => record.canonicalHost?.producerFailureCode ?? 'NONE',
  );
  const byHostRecordedFailureCode = countBy(
    records,
    (record) => record.canonicalHost?.failureCode ?? 'NONE',
  );
  const byHostCauseCode = countBy(
    records,
    (record) => record.canonicalHost?.causeCode ?? 'NONE',
  );
  const byDocumentCategory = countBy(
    records,
    (record) => record.contentRecognition?.documentCategory ?? 'NOT_OBSERVED',
  );
  const byContentRecognitionStatus = countBy(
    records,
    (record) => record.contentRecognition?.status ?? 'NOT_OBSERVED',
  );
  const byContentSourceType = countBy(
    records,
    (record) => record.contentRecognition?.sourceType ?? 'NOT_OBSERVED',
  );
  const byContentAdapter = countBy(
    records,
    (record) => record.contentRecognition?.adapterId ?? 'NOT_OBSERVED',
  );
  const byDocumentManagementAdapterRelease = countBy(
    records,
    (record) => record.profile?.dmAdapterId ?? 'NOT_COMMITTED',
  );
  const byContentProfile = countBy(
    records,
    (record) => record.contentRecognition?.parseProfileRef ?? 'NOT_OBSERVED',
  );
  const byRequestedParserProfile = countBy(
    records,
    (record) => record.profile?.parserProfileId ?? 'NOT_SELECTED',
  );
  const byRecognizedParserProfile = countBy(
    records,
    (record) => record.profile?.recognizedParseProfileRef ?? 'NOT_RECOGNIZED',
  );
  const byDocumentType = countBy(
    records,
    (record) =>
      record.profile?.documentType ??
      record.contentRecognition?.documentType ??
      'NOT_OBSERVED',
  );
  const byDocumentManagementIssuerAuthority = countBy(
    records,
    (record) => record.classification?.issuerAuthority || 'UNRESOLVED',
  );
  const byContentIssuer = countBy(
    records,
    (record) => record.contentRecognition?.issuer || 'NOT_OBSERVED',
  );
  const byRoutingSlice = countBy(records, routingSliceForRecord);
  const byFailureCode = countBy(
    records,
    (record) =>
      record.canonicalHost?.producerFailureCode ??
      record.canonicalHost?.causeCode ??
      record.canonicalHost?.failureCode ??
      record.profile?.failureCode ??
      record.documentManagement?.failureCode ??
      (record.terminal.status === 'SUCCESS' ? 'NONE' : record.terminal.code),
  );
  const totalPages = records.reduce(
    (sum, record) =>
      sum +
      Number(record.layout?.pageCount ?? record.pageCoverage?.pageCount ?? 0),
    0,
  );
  const totalBytes = records.reduce(
    (sum, record) => sum + Number(record.input?.byteLength ?? 0),
    0,
  );
  const totalTextPages = sumRecordNumber(records, 'textPageCount');
  const totalTextLayerPresentPages = sumRecordNumber(
    records,
    'textLayerPresentPageCount',
  );
  const totalNativeCoveredPages = sumRecordNumber(
    records,
    'nativeCoveredPageCount',
  );
  const totalOcrCoveredPages = sumRecordNumber(records, 'ocrCoveredPageCount');
  const totalOcrRequiredPages = sumRecordNumber(
    records,
    'ocrRequiredPageCount',
  );
  const totalMissingCoveragePages = sumRecordNumber(
    records,
    'missingCoveragePageCount',
  );
  const totalEmptyTextLayerPages = sumRecordNumber(
    records,
    'emptyTextLayerPageCount',
  );
  const totalVisualTextUnverifiedPages = sumRecordNumber(
    records,
    'visualTextUnverifiedPageCount',
  );
  const totalOwnerMaterialRasterPages = sumRecordNumber(
    records,
    'ownerMaterialRasterPageCount',
  );
  const identities = records.map((record) =>
    recordIdentity({
      relativePath: record.input.relativePath,
      byteLength: record.input.byteLength,
      sha256: record.input.sha256,
    }),
  );
  const freshScannedPdfCount = Number(
    context.selection?.totalFreshScannedPdfCount,
  );
  const fullFreshCorpusSelected =
    Number.isSafeInteger(freshScannedPdfCount) &&
    freshScannedPdfCount > 0 &&
    context.selectedCount === freshScannedPdfCount;
  const allSelectedInputsAccountedFor =
    context.selectedCount === undefined ||
    records.length === context.selectedCount;
  const duplicateInputIdentityCount =
    identities.length - new Set(identities).size;
  const silentFallbackCount = records.filter(
    (record) => record.terminal.silentFallback !== false,
  ).length;
  const silentEmptySuccessCount = records.filter(
    (record) =>
      record.terminal.status === 'SUCCESS' &&
      record.terminal.silentEmpty !== false,
  ).length;
  const everyRecordHasTerminalStatus = records.every((record) =>
    ['SUCCESS', 'FAILURE'].includes(record.terminal?.status),
  );
  const everySelectedRecordAccepted =
    records.length > 0 &&
    allSelectedInputsAccountedFor &&
    duplicateInputIdentityCount === 0 &&
    silentFallbackCount === 0 &&
    silentEmptySuccessCount === 0 &&
    everyRecordHasTerminalStatus &&
    records.every((record) => record.terminal.status === 'SUCCESS');
  return {
    schemaVersion: SUMMARY_SCHEMA,
    generatedAt: new Date().toISOString(),
    baseCommit: context.baseCommit ?? null,
    corpusRoot: context.corpusRoot ?? null,
    outputDirectory: context.outputDirectory ?? null,
    selection: context.selection ?? null,
    counts: {
      records: records.length,
      successes: records.filter(
        (record) => record.terminal.status === 'SUCCESS',
      ).length,
      failures: records.filter((record) => record.terminal.status === 'FAILURE')
        .length,
      totalBytes,
      totalPages,
      totalTextPages,
      totalTextLayerPresentPages,
      totalNativeCoveredPages,
      totalOcrCoveredPages,
      totalOcrRequiredPages,
      totalMissingCoveragePages,
      totalEmptyTextLayerPages,
      totalVisualTextUnverifiedPages,
      totalOwnerMaterialRasterPages,
      byTerminalCode,
      byFamily,
      byProfileStatus,
      byDocumentManagementStatus,
      byDocumentManagementDecision,
      byDocumentManagementFailureCode,
      byDocumentManagementDescriptorEvidenceStatus,
      byPageCoverageStatus,
      byPageCoverageFailureCode,
      byOcrRequirementKind,
      byHostStatus,
      byHostProducerFailureCode,
      byHostRecordedFailureCode,
      byHostCauseCode,
      byContentRecognitionStatus,
      byDocumentCategory,
      byContentSourceType,
      byContentAdapter,
      byDocumentManagementAdapterRelease,
      byContentProfile,
      byRequestedParserProfile,
      byRecognizedParserProfile,
      byDocumentType,
      byDocumentManagementIssuerAuthority,
      byContentIssuer,
      byRoutingSlice,
      byFailureCode,
    },
    acceptance: {
      scope: fullFreshCorpusSelected
        ? 'FULL_FRESH_CORPUS'
        : 'SELECTED_SCOPE_ONLY',
      status: fullFreshCorpusSelected
        ? everySelectedRecordAccepted
          ? 'FULL_CORPUS_ACCEPTED'
          : 'FULL_CORPUS_NOT_ACCEPTED'
        : everySelectedRecordAccepted
          ? 'SELECTED_SCOPE_ACCEPTED'
          : 'SELECTED_SCOPE_NOT_ACCEPTED',
      successfulRoutingSlices: countBy(
        records.filter((record) => record.terminal.status === 'SUCCESS'),
        routingSliceForRecord,
      ),
      failedRoutingSlices: countBy(
        records.filter((record) => record.terminal.status === 'FAILURE'),
        routingSliceForRecord,
      ),
    },
    invariants: {
      allSelectedInputsAccountedFor,
      allFreshCorpusInputsSelected: fullFreshCorpusSelected,
      duplicateInputIdentityCount,
      silentFallbackCount,
      silentEmptySuccessCount,
      everyRecordHasTerminalStatus,
    },
    nonClaims: [
      'Runtime path and SHA observations are fresh coverage evidence, not a frozen contract or committed baseline.',
      'DocumentManagementHostedCore creates and fresh-resolves real in-process SourceArtifact/DocumentVersion identities through canonical-owned test support; this is not a Postgres, Hosted DB, or real Hosted FileService claim.',
      'Catalog family, DocumentVersion, SourceArtifact, and preflight fresh readbacks are identity evidence. Legacy normalized-descriptor defaults are reported separately and are never used as corpus identity authority.',
      'The local FileService, Catalog, and WorkItem ports create no durable queue, database schema, cloud write, publication, or production currentness mutation.',
      'Direct layout coverage is an observation from the production PdfjsOcrCompositeLayoutExtractor and its native pdfjs diagnostics, not a substitute for Canonical Host/frozen.2/U0/Unified Reader success.',
      'Nonzero text-layer coverage is not visual completeness. Raster/operator status is consumed from the production owner; external raster census thresholds are not reimplemented here.',
      'Unsupported, unknown-family, OCR-needed, damaged, encrypted, identity/readback, U0, and Reader failures are not counted as success.',
    ],
  };
}

async function runWorker(input) {
  const startedAt = new Date().toISOString();
  const startedNs = process.hrtime.bigint();
  const freshBytes = await readFile(input.absolutePath);
  const freshSha256 = sha256Hex(freshBytes);
  const freshStat = await stat(input.absolutePath);
  const inputChanged =
    freshBytes.byteLength !== input.byteLength || freshSha256 !== input.sha256;
  const base = {
    schemaVersion: RECORD_SCHEMA,
    baseCommit: input.baseCommit,
    observedAt: startedAt,
    durationMs: 0,
    workerPid: process.pid,
    input: {
      corpusRoot: input.corpusRoot,
      relativePath: input.relativePath,
      byteLength: freshBytes.byteLength,
      sha256: freshSha256,
      scannedByteLength: input.byteLength,
      scannedSha256: input.sha256,
      modifiedAt: freshStat.mtime.toISOString(),
      regularFile: freshStat.isFile(),
    },
    inputChanged,
  };
  if (inputChanged || !freshStat.isFile()) {
    return finalizeRecord(
      {
        ...base,
        classification: notObserved(
          'Input identity changed before classification.',
        ),
        contentRecognition: notObserved(
          'Input identity changed before content recognition.',
        ),
        profile: notObserved(
          'Input identity changed before profile selection.',
        ),
        layout: notObserved('Input identity changed before layout extraction.'),
        pageCoverage: notObserved(
          'Input identity changed before page diagnostics.',
        ),
        canonicalHost: notInvoked(
          'Input identity changed after the fresh scan.',
        ),
        sourceUnits: notReached('Canonical Host was not invoked.'),
        sourceRefs: notReached('Canonical Host was not invoked.'),
        frozen2: notReached('Canonical Host was not invoked.'),
        u0: notReached('Canonical Host was not invoked.'),
        reader: notReached('Canonical Host was not invoked.'),
      },
      startedNs,
    );
  }

  const modules = await loadProductionModules();
  const fileName = basename(input.absolutePath);
  const identitySeed = sha256Hex(
    Buffer.from(
      `${input.relativePath}\n${freshBytes.byteLength}\n${freshSha256}`,
    ),
  );
  const dmRuntime = await runDocumentManagementRuntime({
    modules,
    bytes: freshBytes,
    sha256: freshSha256,
    fileName,
    relativePath: input.relativePath,
    identitySeed,
  });
  let layoutObservation;
  let pageCoverageObservation;
  let contentText = '';
  let layoutTitle = '';
  let readerQuery = 'PDF';
  let layoutForProfileRecognition = null;
  let ocrProviderPreflight = null;
  try {
    const compositeExtractor = new modules.PdfjsOcrCompositeLayoutExtractor();
    ocrProviderPreflight = compositeExtractor.preflight();
    let layout = compositeExtractor.extractLayout(freshBytes);
    const hasOcrCoverage = layout.pageTextLayerDiagnostics.some(
      (diagnostic) => diagnostic.ocrCoverage?.status === 'OCR_COVERED',
    );
    const nativeLayout = hasOcrCoverage
      ? new modules.PdfjsDistLayoutExtractor().extractLayoutWithDiagnostics(
          freshBytes,
        )
      : layout;
    layoutForProfileRecognition = layout;
    pageCoverageObservation = pageCoverageFromLayoutOwner(layout, nativeLayout);
    readerQuery = chooseReaderQuery(layout.textRuns);
    contentText = layout.textRuns.map((run) => run.text).join('\n');
    layoutTitle = layout.metadata?.title ?? '';
    layoutObservation = {
      status: 'EXTRACTED',
      owner: 'PdfjsOcrCompositeLayoutExtractor',
      extractorId: compositeExtractor.extractorId,
      executionRoute:
        'PdfjsOcrCompositeLayoutExtractor->PdfjsDistLayoutExtractor diagnostics->Host-owned targeted OCR when required',
      ocrProviderPreflight,
      pdfVersion: layout.pdfVersion,
      pageCount: layout.pageCount,
      sourceSha256: layout.sourceSha256,
      sourceByteLength: layout.sourceByteLength,
    };
  } catch (error) {
    const observedError = errorObservation(error);
    if (observedError.code === 'PDF_OCR_REQUIRED_UNSUPPORTED') {
      pageCoverageObservation = pageCoverageFromOcrOwnerError(error);
      layoutObservation = {
        status: 'OCR_REQUIRED',
        owner: 'PdfjsOcrCompositeLayoutExtractor',
        pageCount: pageCoverageObservation.pageCount,
        sourceSha256: `sha256:${freshSha256}`,
        sourceByteLength: freshBytes.byteLength,
        executionRoute:
          'PdfjsOcrCompositeLayoutExtractor->Host-owned targeted OCR->PDF_OCR_REQUIRED_UNSUPPORTED',
        ocrProviderPreflight,
        ...observedError,
      };
    } else {
      pageCoverageObservation = notObserved(
        'The production layout owner failed before page coverage was available.',
      );
      layoutObservation = {
        status: 'FAILED',
        owner: 'PdfjsOcrCompositeLayoutExtractor',
        sourceSha256: `sha256:${freshSha256}`,
        sourceByteLength: freshBytes.byteLength,
        executionRoute:
          'PdfjsOcrCompositeLayoutExtractor->PdfjsDistLayoutExtractor diagnostics->Host-owned targeted OCR when required',
        ocrProviderPreflight,
        ...observedError,
      };
    }
  }

  dmRuntime.observation.descriptorEvidence =
    assessDocumentManagementDescriptorEvidence({
      normalizedDescriptor: dmRuntime.normalizedDescriptor,
      preflightIncoming: dmRuntime.observation.preflightIncoming,
      familyReadback: dmRuntime.observation.familyReadback,
      actualInput: {
        fileName,
        sha256: freshSha256,
        byteLength: freshBytes.byteLength,
      },
      observedLayoutPageCount: layoutObservation?.pageCount ?? null,
    });

  const contentDimensions = modules.detectDocumentDimensions({
    filename: fileName,
    content: contentText,
  });
  const contentSourceType = modules.inferSourceType({
    filename: fileName,
    content: contentText,
  });
  const contentAdapter = modules.resolveDocumentFamilyAdapter({
    filename: fileName,
    sourceType: contentSourceType,
    title: layoutTitle,
    content: contentText,
  });
  const contentRecognitionObservation = {
    status: contentText
      ? 'CONTENT_RECOGNIZED'
      : String(pageCoverageObservation?.status ?? '').includes('OCR_REQUIRED')
        ? 'BLOCKED_BY_OCR_REQUIRED'
        : 'NO_RECOGNIZABLE_CONTENT',
    owner:
      'detectDocumentDimensions + inferSourceType + resolveDocumentFamilyAdapter',
    documentCategory: contentDimensions.documentCategory,
    parserFormat: contentDimensions.parserFormat,
    sourceType: contentSourceType,
    adapterId: contentAdapter?.adapterId ?? null,
    adapterFamily: contentAdapter?.docFamily ?? null,
    adapterSubtype: contentAdapter?.subtype ?? null,
    issuer: contentAdapter?.issuerPolicy?.issuer ?? null,
    documentType: contentAdapter?.documentTypeProfileRef ?? null,
    parseProfileRef: contentAdapter?.parseProfileRef ?? null,
    resolution: contentAdapter?.resolution ?? null,
    textLengthPresentedToOwner: contentText.length,
  };
  const classificationObservation =
    classificationFromDocumentManagement(dmRuntime);
  if (!dmRuntime.resolved) {
    layoutForProfileRecognition = null;
    return finalizeRecord(
      {
        ...base,
        classification: classificationObservation,
        contentRecognition: contentRecognitionObservation,
        documentManagement: dmRuntime.observation,
        profile: notReached(
          'Production profile selection requires a DM-created current DocumentVersion.',
        ),
        layout: layoutObservation,
        pageCoverage: pageCoverageObservation,
        canonicalHost: notInvoked(
          'Production Document Management did not return a current DocumentVersion.',
        ),
        sourceUnits: notReached('Canonical Host was not invoked.'),
        sourceRefs: notReached('Canonical Host was not invoked.'),
        frozen2: notReached('Canonical Host was not invoked.'),
        u0: notReached('Canonical Host was not invoked.'),
        reader: notReached('Canonical Host was not invoked.'),
        runtimeBoundary: runtimeBoundary(dmRuntime),
      },
      startedNs,
    );
  }

  const resolved = dmRuntime.resolved;
  const familyRegistrySource = productionFamilyRegistryInputFromDmSource(
    resolved,
    modules.hostNativePdfAdapterIdFromDmPreflight,
  );
  const dmAdapterId = familyRegistrySource.adapterId;
  let requestClassification = null;
  let classificationError = null;
  try {
    requestClassification = modules.hostNativePdfClassificationFor(
      familyRegistrySource.input,
    );
  } catch (error) {
    classificationError = error;
  }
  let recognizedProfile = null;
  if (layoutForProfileRecognition) {
    recognizedProfile = modules.recognizeHostNativePdfProfile(
      layoutForProfileRecognition,
      resolved.family.documentFamily,
    );
  }
  layoutForProfileRecognition = null;
  const profileObservation = {
    status: requestClassification
      ? 'PRODUCTION_REQUEST_CLASSIFICATION_SELECTED'
      : 'PRODUCTION_PROFILE_NOT_AVAILABLE',
    selectionOwner: 'hostNativePdfClassificationFor',
    recognitionOwner: 'recognizeHostNativePdfProfile',
    dmAdapterReleaseOwner: 'hostNativePdfAdapterIdFromDmPreflight',
    dmAdapterId: dmAdapterId || null,
    failureCode: requestClassification
      ? null
      : classificationError
        ? errorObservation(classificationError).code
        : 'PDF_PRODUCER_PROFILE_NOT_AVAILABLE',
    requestedClassification: requestClassification
      ? structuredClone(requestClassification)
      : null,
    parserProfileId: requestClassification?.parserProfileId ?? null,
    parserProfileHash: requestClassification?.parserProfileHash ?? null,
    recognizedAdapterId: recognizedProfile?.adapterId ?? null,
    recognizedFamily: recognizedProfile?.family ?? null,
    recognizedIssuerAuthority: recognizedProfile?.issuerAuthority ?? null,
    recognizedParseProfileRef: recognizedProfile?.parseProfileRef ?? null,
    documentType: recognizedProfile?.documentType ?? null,
    executionRoute: recognizedProfile?.executionRoute ?? null,
    evidence: recognizedProfile?.evidence ?? null,
  };
  if (!requestClassification) {
    return finalizeRecord(
      {
        ...base,
        classification: classificationObservation,
        contentRecognition: contentRecognitionObservation,
        documentManagement: dmRuntime.observation,
        profile: profileObservation,
        layout: layoutObservation,
        pageCoverage: pageCoverageObservation,
        canonicalHost: notInvoked(
          'Production family/profile owner returned no legal request classification.',
        ),
        sourceUnits: notReached('Canonical Host was not invoked.'),
        sourceRefs: notReached('Canonical Host was not invoked.'),
        frozen2: notReached('Canonical Host was not invoked.'),
        u0: notReached('Canonical Host was not invoked.'),
        reader: notReached('Canonical Host was not invoked.'),
        runtimeBoundary: runtimeBoundary(dmRuntime),
      },
      startedNs,
    );
  }

  const hostRuntime = await runCanonicalHostRuntime({
    modules,
    dmRuntime,
    classification: requestClassification,
    identitySeed,
    query: readerQuery,
  });
  return finalizeRecord(
    {
      ...base,
      classification: classificationObservation,
      contentRecognition: contentRecognitionObservation,
      documentManagement: dmRuntime.observation,
      profile: profileObservation,
      layout: layoutObservation,
      pageCoverage: pageCoverageObservation,
      canonicalHost: hostRuntime.canonicalHost,
      ...hostRuntime.stages,
      runtimeBoundary: runtimeBoundary(dmRuntime, hostRuntime),
    },
    startedNs,
  );
}

async function runDocumentManagementRuntime({
  modules,
  bytes,
  sha256,
  fileName,
  relativePath,
  identitySeed,
}) {
  const actorUserId = 'service:canonical-pdf-corpus-readonly';
  const tenantId = 'local-corpus-readonly';
  const fileService = new modules.LocalMiaodaFileServiceDouble({
    defaultBucketId: 'canonical-pdf-corpus-immutable',
    defaultCreatedBy: actorUserId,
  });
  const catalog = new modules.InMemoryHostedDocumentCatalog();
  const core = new modules.DocumentManagementHostedCore({
    artifactStore: new modules.MiaodaFileServiceArtifactStore(fileService),
    catalog,
    authorizer: {
      async assertCanIngest(context) {
        if (
          context.actorUserId !== actorUserId ||
          context.tenantId !== tenantId
        ) {
          throw new Error('CORPUS_DM_SERVER_CONTEXT_MISMATCH');
        }
      },
    },
  });
  const selection = {
    bucketId: 'canonical-pdf-corpus-selection',
    filePath: `/runtime/${identitySeed.slice(0, 2)}/${identitySeed}.pdf`,
  };
  const serverContext = {
    actorUserId,
    tenantId,
    roles: [],
    appId: 'app_17bzc551rsg',
    env: 'dev',
  };
  const input = {
    core,
    catalog,
    fileService,
    bytes,
    selection,
    fileName,
    sourceChannel: 'canonical_pdf_corpus_runtime_selection',
    sourceRef: `corpus-runtime:${identitySeed}`,
    idempotencyKey: `canonical-pdf-corpus:${identitySeed}`,
    descriptor: {},
    serverContext,
    requireCurrent: true,
  };
  let verified = null;
  let thrown = null;
  try {
    verified = await modules.ingestActualPdfThroughHostedCore(input);
  } catch (error) {
    thrown = error;
  }
  const snapshot = catalog.snapshot();
  const preflight = snapshot.preflights.at(-1) ?? null;
  const acquisition = snapshot.acquisitions.at(-1) ?? null;
  const sourceArtifact = snapshot.sourceArtifacts.at(-1) ?? null;
  const normalizedDescriptor = preflight?.normalizedDescriptor ?? null;
  const productionError = thrown ? errorObservation(thrown) : null;
  const decision = verified?.ingested?.decision ?? preflight?.decision ?? null;
  const failureCode = verified
    ? null
    : productionError?.code === 'LOCAL_HOSTED_DM_COMMIT_REQUIRED' && decision
      ? decision
      : (productionError?.code ?? decision ?? 'DOCUMENT_MANAGEMENT_NO_RESULT');
  const observation = {
    status: verified ? 'COMMITTED_AND_RESOLVED' : 'FAILED',
    owner: 'DocumentManagementHostedCore.ingestFileServiceSelection',
    support:
      'ingestActualPdfThroughHostedCore + InMemoryHostedDocumentCatalog + LocalMiaodaFileServiceDouble',
    selection: {
      ...selection,
      relativePath,
      fileName,
    },
    decision,
    failureCode,
    failure: productionError,
    acquisitionId:
      verified?.ingested?.acquisitionId ?? acquisition?.acquisitionId ?? null,
    sourceArtifactId:
      verified?.ingested?.sourceArtifactId ??
      sourceArtifact?.sourceArtifactId ??
      null,
    familyId: verified?.ingested?.familyId ?? null,
    documentId:
      verified?.ingested?.documentId ??
      verified?.resolved?.version?.documentId ??
      null,
    documentVersionId:
      verified?.ingested?.documentVersionId ??
      verified?.resolved?.version?.documentVersionId ??
      null,
    immutableReadbackVerified:
      verified?.ingested?.immutableReadbackVerified ??
      sourceArtifact?.readbackVerified ??
      false,
    catalogFreshReadVerified:
      verified?.ingested?.catalogFreshReadVerified ?? false,
    sourceArtifactReadback: verified
      ? {
          sourceArtifactId: verified.resolved.artifact.sourceArtifactId,
          sha256: verified.resolved.artifact.sha256,
          byteLength: Number(verified.resolved.artifact.byteLength),
          mediaType: verified.resolved.artifact.mediaType,
          bucketId: verified.resolved.artifact.bucketId,
          filePath: verified.resolved.artifact.filePath,
          providerObjectId: verified.resolved.artifact.providerObjectId,
          providerVersionId: verified.resolved.artifact.providerVersionId,
          readbackVerified:
            verified.resolved.artifact.readbackVerified === true,
        }
      : sourceArtifact
        ? structuredClone(sourceArtifact)
        : null,
    documentVersionReadback: verified
      ? {
          documentId: verified.resolved.version.documentId,
          documentVersionId: verified.resolved.version.documentVersionId,
          sourceArtifactId: verified.resolved.version.sourceArtifactId,
          pdfSha256: verified.resolved.version.pdfSha256,
          byteLength: Number(verified.resolved.version.byteLength),
          originalFilename: verified.resolved.version.originalFilename,
          businessRevision: verified.resolved.version.businessRevision ?? null,
          committedAt: verified.resolved.version.committedAt,
        }
      : null,
    familyReadback: verified
      ? {
          familyId: verified.resolved.family.familyId,
          documentFamily: verified.resolved.family.documentFamily,
          issuerAuthority: verified.resolved.family.issuerAuthority,
          canonicalDocumentNumber:
            verified.resolved.family.canonicalDocumentNumber,
          currentDocumentVersionId:
            verified.resolved.family.currentDocumentVersionId,
          currentGeneration: verified.resolved.family.currentGeneration,
        }
      : null,
    normalizedDescriptor: normalizedDescriptor
      ? structuredClone(normalizedDescriptor)
      : null,
    preflightIncoming: preflight?.decisionPayload?.incoming
      ? structuredClone(preflight.decisionPayload.incoming)
      : null,
    catalogCounts: {
      sourceArtifacts: snapshot.sourceArtifacts.length,
      acquisitions: snapshot.acquisitions.length,
      preflights: snapshot.preflights.length,
      publicationFamilies: snapshot.publicationFamilies.length,
      documents: snapshot.documents.length,
      documentVersions: snapshot.documentVersions.length,
    },
  };
  observation.descriptorEvidence = assessDocumentManagementDescriptorEvidence({
    normalizedDescriptor,
    preflightIncoming: observation.preflightIncoming,
    familyReadback: observation.familyReadback,
    actualInput: {
      fileName,
      sha256,
      byteLength: bytes.byteLength,
    },
    observedLayoutPageCount: null,
  });
  return {
    fileService,
    catalog,
    core,
    serverContext,
    selection,
    verified,
    resolved: verified?.resolved ?? null,
    snapshot,
    normalizedDescriptor,
    observation,
  };
}

export function assessDocumentManagementDescriptorEvidence({
  normalizedDescriptor,
  preflightIncoming,
  familyReadback,
  actualInput,
  observedLayoutPageCount,
}) {
  if (!normalizedDescriptor) {
    return {
      status: 'NOT_OBSERVED',
      normalizedDescriptorUsedAsIdentityAuthority: false,
      actualSourceMismatches: [],
      nonAuthoritativeDefaultMismatches: [],
    };
  }

  const actualSourceMismatches = [];
  const compareActual = (field, observed, expected) => {
    if (String(observed ?? '') !== String(expected ?? '')) {
      actualSourceMismatches.push({ field, observed, expected });
    }
  };
  compareActual(
    'originalFilename',
    normalizedDescriptor.originalFilename,
    actualInput.fileName,
  );
  compareActual('sha256', normalizedDescriptor.sha256, actualInput.sha256);
  compareActual(
    'sizeBytes',
    Number(normalizedDescriptor.sizeBytes),
    Number(actualInput.byteLength),
  );

  const nonAuthoritativeDefaultMismatches = [];
  const authoritativeDocumentCode =
    familyReadback?.canonicalDocumentNumber ??
    preflightIncoming?.documentCode ??
    null;
  if (
    authoritativeDocumentCode &&
    normalizedDescriptor.documentCode &&
    normalizedDescriptor.documentCode !== authoritativeDocumentCode
  ) {
    nonAuthoritativeDefaultMismatches.push({
      field: 'documentCode',
      observed: normalizedDescriptor.documentCode,
      authoritative: authoritativeDocumentCode,
    });
  }
  if (
    Number.isSafeInteger(observedLayoutPageCount) &&
    observedLayoutPageCount > 0 &&
    Number(normalizedDescriptor.pageCount) !== observedLayoutPageCount
  ) {
    nonAuthoritativeDefaultMismatches.push({
      field: 'pageCount',
      observed: Number(normalizedDescriptor.pageCount),
      authoritative: observedLayoutPageCount,
    });
  }

  return {
    status:
      actualSourceMismatches.length > 0
        ? 'ACTUAL_SOURCE_MISMATCH'
        : nonAuthoritativeDefaultMismatches.length > 0
          ? 'NON_AUTHORITATIVE_DEFAULT_MISMATCH_OBSERVED'
          : 'CONSISTENT_WITH_PROVEN_FIELDS',
    normalizedDescriptorUsedAsIdentityAuthority: false,
    identityAuthority:
      'Catalog family + DocumentVersion + SourceArtifact + preflight fresh readback',
    actualSourceMismatches,
    nonAuthoritativeDefaultMismatches,
  };
}

function classificationFromDocumentManagement(dmRuntime) {
  const normalized = dmRuntime.normalizedDescriptor;
  const family = dmRuntime.resolved?.family;
  if (!normalized && !family) {
    return {
      status: 'NOT_OBSERVED',
      owner: 'DocumentManagementHostedCore',
      canonicalDocumentFamily: null,
      issuerAuthority: null,
      unknownFamily: null,
      reason: 'DM failed before a normalized descriptor was recorded.',
    };
  }
  const canonicalDocumentFamily =
    family?.documentFamily ?? normalized?.canonicalDocumentFamily ?? null;
  return {
    status: family
      ? 'DM_COMMITTED_FAMILY_FRESH_READ'
      : 'DM_PREFLIGHT_CLASSIFICATION_ONLY',
    owner:
      'DocumentManagementHostedCore -> normalizeUploadDescriptor -> Catalog fresh read',
    displayDocumentFamily: normalized?.documentFamily ?? null,
    canonicalDocumentFamily,
    issuerAuthority: family?.issuerAuthority ?? normalized?.issuer ?? null,
    sourceType: normalized?.sourceType ?? null,
    documentCategory: normalized?.detectedDocumentCategory ?? null,
    parserFormat: normalized?.parserFormat ?? null,
    adapterRelease: normalized?.adapterRelease ?? null,
    canonicalDocumentNumber:
      family?.canonicalDocumentNumber ??
      dmRuntime.observation.preflightIncoming?.documentCode ??
      null,
    unknownFamily: canonicalDocumentFamily === 'GENERIC',
  };
}

async function runCanonicalHostRuntime({
  modules,
  dmRuntime,
  classification,
  identitySeed,
  query,
}) {
  const { resolved, fileService, catalog } = dmRuntime;
  const resolver = {
    resolve(documentVersionId, options = {}) {
      return catalog.resolveDocumentVersionSource(documentVersionId, options);
    },
  };
  const registrar = new LocalWorkItemProjectionRegistrar();
  const artifactStore = new modules.MiaodaOrdinaryArtifactStoreAdapter(
    fileService,
  );
  const validator = new modules.U0FullValidationService(
    new modules.PythonU0FullPackageValidatorAdapter({
      pythonExecutable: process.env.WL_LOCAL_U0_PYTHON || 'python3',
      contractRoot: resolve(
        REPOSITORY_ROOT,
        'dist/server/runtime-assets/technical-publication-parsed-package/v1-frozen-2',
      ),
      contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
      validatorRevision: 'canonical-pdf-corpus-readonly.v1',
    }),
  );
  const productionProducer =
    new modules.HostNativeDocumentFamilyPdfProducerAdapter(
      fileService,
      resolver,
      validator,
      new modules.MiaodaScopedProfessionalArtifactCorrelationAdapter(
        fileService,
      ),
    );
  let producerObservation = null;
  const observingProducer = {
    async producePdf(request) {
      const result = await productionProducer.producePdf(request);
      producerObservation = result;
      return result;
    },
  };
  const reader = new modules.UnifiedReaderService(
    artifactStore,
    new modules.Frozen2CandidateReaderService(),
    validator,
    {
      mode: 'HOST_CONFIGURED',
      artifactStoreConfigured: true,
      fullU0ValidatorConfigured: true,
      immutableAcceptanceReceiptOwnerConfigured: false,
      aeoSpecialistReaderConfigured: false,
      authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
    },
  );
  const entry = new modules.CanonicalEntryFacadeService(
    new modules.OrdinaryMiaodaAppBindingAdapter(),
  );
  const failureRecording = new modules.CanonicalFailureRecordingService(
    new modules.U0Frozen2FailureAdapterService(validator),
    new modules.OrdinaryFailureValidationWriteAuthorizationAdapter(),
    artifactStore,
    { nowIso: () => new Date().toISOString() },
  );
  const unusedAuthorization = {
    async authorize() {
      throw new Error('CORPUS_RUNNER_UNEXPECTED_AUTHORIZATION_PATH');
    },
  };
  const unusedPermissionSnapshot = {
    async freshRead() {
      throw new Error('CORPUS_RUNNER_UNEXPECTED_PERMISSION_PATH');
    },
  };
  const vertical = new modules.CanonicalHostVerticalService(
    registrar,
    observingProducer,
    unusedAuthorization,
    unusedPermissionSnapshot,
    artifactStore,
    reader,
    entry,
    failureRecording,
    null,
  );
  const workItemId = `WI-CORPUS-${identitySeed.slice(0, 24).toUpperCase()}`;
  const requestId = `REQ-CORPUS-${identitySeed.slice(0, 24).toUpperCase()}`;
  const request = {
    schemaVersion: 'wiselink.3_1.canonical_pdf_vertical_request.v0.candidate',
    workItemId,
    requestId,
    source: {
      documentId: resolved.version.documentId,
      documentVersionId: resolved.version.documentVersionId,
      parserRequestId: requestId,
      sourceArtifactId: resolved.artifact.sourceArtifactId,
      sourceFileSha256: `sha256:${resolved.artifact.sha256}`,
      sourceByteLength: Number(resolved.artifact.byteLength),
      driveFileToken: resolved.artifact.providerObjectId,
      driveSourceVersion: resolved.artifact.providerVersionId,
    },
    classification: structuredClone(classification),
    query,
  };
  const actor = {
    userId: dmRuntime.serverContext.actorUserId,
    tenantId: dmRuntime.serverContext.tenantId,
    appId: dmRuntime.serverContext.appId,
    roles: [],
    env: 'dev',
  };
  const scope = {
    principalId: actor.userId,
    tenantId: actor.tenantId,
    appId: actor.appId,
    environment: 'DEV',
    documentVersionId: resolved.version.documentVersionId,
    developmentRunToken: deterministicUuid(identitySeed),
    authorizationFingerprint: `sha256:${sha256Hex(
      Buffer.from(`canonical-pdf-corpus-readonly\n${identitySeed}`),
    )}`,
  };
  let hostResponse = null;
  let hostThrown = null;
  let allSourceUnits = null;
  let readerPostError = null;
  try {
    hostResponse = await vertical.runPdfWithDevelopmentScope(
      request,
      actor,
      scope,
    );
    if (hostResponse.status === 'CANDIDATE_VERTICAL_VERIFIED') {
      try {
        allSourceUnits = await reader.readAllSourceUnits({
          artifact: hostResponse.readback.artifact,
          packageId: hostResponse.readback.package.packageId,
        });
      } catch (error) {
        readerPostError = error;
      }
    }
  } catch (error) {
    hostThrown = error;
  }
  return {
    canonicalHost: observeHost(hostResponse, hostThrown, producerObservation),
    stages: observeCanonicalStages(
      hostResponse,
      allSourceUnits,
      readerPostError,
      query,
    ),
    request,
    registrar,
  };
}

function runtimeBoundary(dmRuntime, hostRuntime = null) {
  return {
    sourcePort:
      'canonical-owned LocalMiaodaFileServiceDouble carrying exact runtime bytes into production FileService adapters',
    documentManagementPort:
      'production DocumentManagementHostedCore.ingestFileServiceSelection with catalog fresh resolve',
    documentVersionPort:
      'InMemoryHostedDocumentCatalog actual core-created identities; no synthetic DocumentVersion/SourceArtifact',
    workItemPort: hostRuntime
      ? 'process-local compare-and-set WorkItem projection registrar'
      : 'not reached',
    durableQueueCreated: false,
    databaseSchemaCreated: false,
    hostedDatabaseClaimed: false,
    hostedFileServiceClaimed: false,
    cloudCallPerformed: false,
    modelCallPerformed: false,
    frontendMutationPerformed: false,
    publicationPerformed: false,
    sourceCorpusCopiedIntoRepository: false,
    fileServiceOperationCount: dmRuntime.fileService.operationCount,
    fileServiceObjectCount: dmRuntime.fileService.listFiles().length,
    fileServiceUploadedObjectCount: dmRuntime.fileService.uploadCalls.length,
  };
}

class LocalWorkItemProjectionRegistrar {
  constructor() {
    this.projection = null;
  }

  async loadOrCreate(seed) {
    if (!this.projection) {
      this.projection = { ...structuredClone(seed), revision: 1 };
    }
    return structuredClone(this.projection);
  }

  async compareAndSet({ workItemId, expectedRevision, next }) {
    if (
      !this.projection ||
      this.projection.workItemId !== workItemId ||
      this.projection.revision !== expectedRevision
    ) {
      throw new Error('LOCAL_WORKITEM_COMPARE_AND_SET_CONFLICT');
    }
    this.projection = {
      ...structuredClone(next),
      revision: expectedRevision + 1,
    };
    return structuredClone(this.projection);
  }

  async getExact({ workItemId, requestId, documentVersionId }) {
    if (
      !this.projection ||
      this.projection.workItemId !== workItemId ||
      this.projection.requestId !== requestId ||
      this.projection.source.documentVersionId !== documentVersionId
    ) {
      throw new Error('WORK_ITEM_NOT_FOUND');
    }
    return structuredClone(this.projection);
  }

  async getTenantScopedByWorkItemId({ workItemId }) {
    if (!this.projection || this.projection.workItemId !== workItemId) {
      throw new Error('WORK_ITEM_NOT_FOUND');
    }
    return structuredClone(this.projection);
  }
}

function observeHost(response, thrown, producerResult) {
  if (thrown) {
    return {
      invoked: true,
      owner: 'CanonicalHostVerticalService.runPdfWithDevelopmentScope',
      status: 'THREW',
      producerKind: producerResult?.kind ?? null,
      executionRoute: producerResult?.executionRoute ?? null,
      ...errorObservation(thrown),
      authority: null,
    };
  }
  const failure = response?.workItem?.failure;
  const recordingFailure = response?.workItem?.recordingFailure;
  return {
    invoked: true,
    owner: 'CanonicalHostVerticalService.runPdfWithDevelopmentScope',
    status: response?.status ?? 'NO_RESPONSE',
    phase: response?.workItem?.phase ?? null,
    workItemId: response?.workItem?.workItemId ?? null,
    requestId: response?.workItem?.requestId ?? null,
    revision: response?.workItem?.revision ?? null,
    producerKind: producerResult?.kind ?? null,
    producerFailureCode:
      producerResult?.kind === 'FAILURE_SIGNAL'
        ? producerResult.failureCode
        : null,
    producerFailureParameters:
      producerResult?.kind === 'FAILURE_SIGNAL'
        ? (producerResult.parameters ?? null)
        : null,
    executionRoute:
      producerResult?.executionRoute ??
      failure?.adapterReceipt?.producer?.executionRoute ??
      null,
    failureCode: failure?.failureCode ?? recordingFailure?.failureCode ?? null,
    causeCode:
      failure?.adapterReceipt?.taxonomy?.causeCode ??
      recordingFailure?.originalFailureCode ??
      null,
    message: failure?.message ?? recordingFailure?.message ?? null,
    failureArtifact: failure?.artifact ?? null,
    failureActualByteReadbackVerified:
      failure?.adapterReceipt?.actualByteReadbackVerified ?? null,
    failureStrictValidationStatus:
      failure?.adapterReceipt?.strictValidation?.status ?? null,
    authority: response?.authority ?? null,
  };
}

function observeCanonicalStages(
  response,
  allSourceUnits,
  readerPostError,
  query,
) {
  if (
    response?.status !== 'CANDIDATE_VERTICAL_VERIFIED' ||
    !response.readback
  ) {
    const reason = response
      ? `Canonical Host status was ${response.status}.`
      : 'Canonical Host did not return a response.';
    return {
      sourceUnits: notReached(reason),
      sourceRefs: notReached(reason),
      frozen2: notReached(reason),
      u0: notReached(reason),
      reader: notReached(reason),
    };
  }
  const readback = response.readback;
  const units = allSourceUnits ?? [];
  const allHaveSourceRefs =
    units.length > 0 && units.every((unit) => unit.sourceRefIds.length > 0);
  return {
    sourceUnits: {
      status: readerPostError ? 'READBACK_FAILED' : 'OBSERVED',
      count: readback.package.contentUnitCount,
      allUnitReadbackCount: allSourceUnits?.length ?? null,
      allHaveSourceRefs,
      sampleUnitIds: units.slice(0, 3).map((unit) => unit.unitId),
    },
    sourceRefs: {
      status: readerPostError ? 'READBACK_FAILED' : 'OBSERVED',
      count: readback.package.sourceRefCount,
      sampleSourceRefIds: units
        .flatMap((unit) => unit.sourceRefIds)
        .slice(0, 3),
    },
    frozen2: {
      status: 'ACTUAL_BYTES_READBACK_VERIFIED',
      contractId: readback.package.contractId,
      contractRevision: readback.package.contractRevision,
      packageId: readback.package.packageId,
      packageResultStatus: readback.package.resultStatus,
      artifact: readback.artifact,
      contentHash: readback.package.contentHash,
      semanticHash: readback.package.semanticHash,
      provenanceHash: readback.package.provenanceHash,
      coverageHash: readback.package.coverageHash,
    },
    u0: {
      status: readback.fullValidatorProof.status,
      validatorId: readback.fullValidatorProof.validatorId,
      validatorRevision: readback.fullValidatorProof.validatorRevision,
      contractCommit: readback.fullValidatorProof.contractCommit,
      artifactSha256: readback.fullValidatorProof.artifactSha256,
    },
    reader: readerPostError
      ? {
          status: 'FAILED',
          query,
          ...errorObservation(readerPostError),
        }
      : {
          status: readback.status,
          owner: 'UnifiedReaderService',
          query,
          queryResultCount: readback.queryResults.length,
          allQueryResultsHaveSourceRefs: readback.queryResults.every(
            (result) => result.sourceRefIds.length > 0,
          ),
          readerReceiptId: readback.receipt.readerReceiptId,
          receiptValidationStatus: readback.receipt.validationStatus,
          sourceBoundUnitCount: readback.receipt.sourceBoundUnitCount,
          allSourceUnitsReadBack:
            allSourceUnits?.length === readback.package.contentUnitCount,
          sampleResults: readback.queryResults.slice(0, 3).map((result) => ({
            unitId: result.unitId,
            kind: result.kind,
            textPreview: result.text.slice(0, 160),
            sourceRefIds: result.sourceRefIds.slice(0, 3),
            sourceLocators: result.sourceLocators?.slice(0, 3) ?? [],
          })),
        },
  };
}

async function loadProductionModules() {
  const importBuilt = (relativePath) =>
    import(
      pathToFileURL(resolve(REPOSITORY_ROOT, 'dist/server', relativePath)).href
    );
  const [
    { detectDocumentDimensions, inferSourceType },
    { resolveDocumentFamilyAdapter },
    { DocumentManagementHostedCore },
    { MiaodaFileServiceArtifactStore },
    { PdfjsDistLayoutExtractor },
    { PdfjsOcrCompositeLayoutExtractor },
    { HostNativeDocumentFamilyPdfProducerAdapter },
    {
      hostNativePdfAdapterIdFromDmPreflight,
      hostNativePdfClassificationFor,
      recognizeHostNativePdfProfile,
    },
    { MiaodaScopedProfessionalArtifactCorrelationAdapter },
    { MiaodaOrdinaryArtifactStoreAdapter },
    { Frozen2CandidateReaderService },
    { PythonU0FullPackageValidatorAdapter },
    { U0FullValidationService },
    { U0Frozen2FailureAdapterService },
    { UnifiedReaderService },
    { CanonicalEntryFacadeService },
    { OrdinaryMiaodaAppBindingAdapter },
    { CanonicalFailureRecordingService },
    { OrdinaryFailureValidationWriteAuthorizationAdapter },
    { CanonicalHostVerticalService },
  ] = await Promise.all([
    importBuilt(
      'modules/document-management/src/migrated/adapters/parserSourceTypeDetector.js',
    ),
    importBuilt(
      'modules/document-management/src/migrated/adapters/documentFamilyAdapterRegistry.js',
    ),
    importBuilt(
      'modules/document-management/src/hosted/documentManagementHostedCore.js',
    ),
    importBuilt(
      'modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js',
    ),
    importBuilt(
      'modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter.js',
    ),
    importBuilt(
      'modules/professional-input/parser/pdfjs-ocr-composite-layout-extractor.adapter.js',
    ),
    importBuilt(
      'modules/canonical-host/exact-ftd-frozen2-pdf-producer.adapter.js',
    ),
    importBuilt('modules/canonical-host/host-native-pdf-profile.registry.js'),
    importBuilt(
      'modules/canonical-host/scoped-professional-artifact-correlation.port.js',
    ),
    importBuilt(
      'modules/unified-reader/miaoda-ordinary-artifact-store.adapter.js',
    ),
    importBuilt('modules/unified-reader/frozen2-candidate-reader.service.js'),
    importBuilt(
      'modules/unified-reader/python-u0-full-package-validator.adapter.js',
    ),
    importBuilt('modules/unified-reader/u0-full-validation.service.js'),
    importBuilt('modules/unified-reader/u0-frozen2-failure-adapter.service.js'),
    importBuilt('modules/unified-reader/unified-reader.service.js'),
    importBuilt('modules/canonical-host/canonical-entry-facade.service.js'),
    importBuilt(
      'modules/canonical-host/ordinary-miaoda-app-binding.adapter.js',
    ),
    importBuilt(
      'modules/canonical-host/canonical-failure-recording.service.js',
    ),
    importBuilt(
      'modules/canonical-host/ordinary-failure-validation-write-authorization.adapter.js',
    ),
    importBuilt('modules/canonical-host/canonical-host-vertical.service.js'),
  ]);
  const {
    InMemoryHostedDocumentCatalog,
    LocalMiaodaFileServiceDouble,
    ingestActualPdfThroughHostedCore,
  } = await import(
    pathToFileURL(
      resolve(
        REPOSITORY_ROOT,
        'test/support/document-management-hosted-test-support.mjs',
      ),
    ).href
  );
  return {
    detectDocumentDimensions,
    inferSourceType,
    resolveDocumentFamilyAdapter,
    DocumentManagementHostedCore,
    MiaodaFileServiceArtifactStore,
    PdfjsDistLayoutExtractor,
    PdfjsOcrCompositeLayoutExtractor,
    HostNativeDocumentFamilyPdfProducerAdapter,
    hostNativePdfAdapterIdFromDmPreflight,
    hostNativePdfClassificationFor,
    recognizeHostNativePdfProfile,
    MiaodaScopedProfessionalArtifactCorrelationAdapter,
    MiaodaOrdinaryArtifactStoreAdapter,
    Frozen2CandidateReaderService,
    PythonU0FullPackageValidatorAdapter,
    U0FullValidationService,
    U0Frozen2FailureAdapterService,
    UnifiedReaderService,
    CanonicalEntryFacadeService,
    OrdinaryMiaodaAppBindingAdapter,
    CanonicalFailureRecordingService,
    OrdinaryFailureValidationWriteAuthorizationAdapter,
    CanonicalHostVerticalService,
    InMemoryHostedDocumentCatalog,
    LocalMiaodaFileServiceDouble,
    ingestActualPdfThroughHostedCore,
  };
}

async function runParent(options) {
  await assertBuiltRuntime();
  const baseCommit = await currentCommit();
  const scanStartedAt = new Date().toISOString();
  const scan = await scanPdfCorpus(options.corpusRoot);
  const selected = selectCorpusEntries(scan.entries, options);
  if (scan.entries.length === 0) {
    throw new Error('CORPUS_SCAN_EMPTY');
  }
  if (options.match && selected.length === 0) {
    throw new Error(`CORPUS_MATCH_EMPTY:${options.match}`);
  }
  const outputDirectory =
    options.outputDirectory ??
    resolve(
      '/private/tmp',
      `wiselink-canonical-pdf-corpus-${timestampForPath(new Date())}`,
    );
  await mkdir(outputDirectory, { recursive: true });
  const manifestPath = resolve(outputDirectory, 'scan-manifest.json');
  const recordsPath = resolve(outputDirectory, 'records.ndjson');
  const summaryPath = resolve(outputDirectory, 'summary.json');
  const summaryMarkdownPath = resolve(outputDirectory, 'summary.md');
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA,
    baseCommit,
    scannedAt: scanStartedAt,
    corpusRoot: scan.root,
    freshScan: true,
    inclusion: 'recursive regular files with case-insensitive .pdf extension',
    ignoredSymbolicLinks: scan.ignoredSymbolicLinks,
    totalPdfCount: scan.entries.length,
    totalPdfBytes: scan.entries.reduce(
      (sum, entry) => sum + entry.byteLength,
      0,
    ),
    selection: {
      match: options.match || null,
      limit: Number.isFinite(options.limit) ? options.limit : null,
      shardIndex: options.shardIndex,
      shardCount: options.shardCount,
      selectedCount: selected.length,
    },
    files: scan.entries.map(
      ({ absolutePath: _absolutePath, ...entry }) => entry,
    ),
  };
  await writeJson(manifestPath, manifest);
  if (!options.resume) {
    await writeFile(recordsPath, '', 'utf8');
  }

  const existingRecords = options.resume
    ? await readNdjsonIfPresent(recordsPath)
    : [];
  const selectedByIdentity = new Map(
    selected.map((entry) => [recordIdentity(entry), entry]),
  );
  const currentByIdentity = new Map(
    existingRecords
      .filter((record) => {
        if (record?.schemaVersion !== RECORD_SCHEMA || !record?.input) {
          return false;
        }
        const entry = selectedByIdentity.get(recordIdentity(record.input));
        return (
          entry &&
          isReusableCorpusRecord(record, {
            entry,
            corpusRoot: scan.root,
            baseCommit,
          })
        );
      })
      .map((record) => [recordIdentity(record.input), record]),
  );
  const pending = selected.filter(
    (entry) => !currentByIdentity.has(recordIdentity(entry)),
  );
  const resumedCount = currentByIdentity.size;
  let completedThisInvocation = 0;
  let writeChain = Promise.resolve();
  const worker = async () => {
    while (true) {
      const entry = pending.shift();
      if (!entry) return;
      let record;
      try {
        record = await executeWorker(entry, {
          corpusRoot: scan.root,
          baseCommit,
          timeoutMs: options.workerTimeoutMs,
          memoryMb: options.workerMemoryMb,
        });
      } catch (error) {
        record = workerFailureRecord(entry, scan.root, baseCommit, error);
      }
      currentByIdentity.set(recordIdentity(record.input), record);
      writeChain = writeChain.then(() =>
        appendFile(recordsPath, `${JSON.stringify(record)}\n`),
      );
      await writeChain;
      completedThisInvocation += 1;
      process.stderr.write(
        `[${resumedCount + completedThisInvocation}/${selected.length}] ${record.terminal.code} ${JSON.stringify(entry.relativePath)}\n`,
      );
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(options.concurrency, Math.max(pending.length, 1)) },
      () => worker(),
    ),
  );
  await writeChain;
  const records = selected
    .map((entry) => currentByIdentity.get(recordIdentity(entry)))
    .filter(Boolean)
    .sort((left, right) =>
      compareText(left.input.relativePath, right.input.relativePath),
    );
  await writeFile(
    recordsPath,
    records.length > 0
      ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
      : '',
    'utf8',
  );
  const summary = summarizeRecords(records, {
    baseCommit,
    corpusRoot: scan.root,
    outputDirectory,
    selectedCount: selected.length,
    selection: {
      totalFreshScannedPdfCount: scan.entries.length,
      selectedCount: selected.length,
      resumedCount,
      completedThisInvocation,
      match: options.match || null,
      shardIndex: options.shardIndex,
      shardCount: options.shardCount,
    },
  });
  await writeJson(summaryPath, summary);
  await writeFile(summaryMarkdownPath, renderSummaryMarkdown(summary), 'utf8');
  process.stdout.write(
    `${JSON.stringify({
      runStatus: summary.invariants.allSelectedInputsAccountedFor
        ? 'OBSERVATION_COMPLETE'
        : 'OBSERVATION_INCOMPLETE',
      corpusAcceptance: summary.acceptance.status,
      outputDirectory,
      manifestPath,
      recordsPath,
      summaryPath,
      summaryMarkdownPath,
      counts: summary.counts,
      invariants: summary.invariants,
    })}\n`,
  );
  if (
    !summary.invariants.allSelectedInputsAccountedFor ||
    summary.invariants.duplicateInputIdentityCount !== 0 ||
    summary.invariants.silentFallbackCount !== 0 ||
    summary.invariants.silentEmptySuccessCount !== 0 ||
    !summary.invariants.everyRecordHasTerminalStatus
  ) {
    process.exitCode = 2;
  }
}

async function executeWorker(entry, context) {
  const encoded = Buffer.from(
    JSON.stringify({ ...entry, ...context }),
  ).toString('base64url');
  const inheritedNodeOptions = String(process.env.NODE_OPTIONS ?? '')
    .replace(/(?:^|\s)--max-old-space-size(?:=|\s+)\d+/gu, ' ')
    .trim();
  const nodeOptions = [
    inheritedNodeOptions,
    `--max-old-space-size=${context.memoryMb}`,
  ]
    .filter(Boolean)
    .join(' ');
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [SCRIPT_PATH, '--worker-input', encoded],
    {
      cwd: REPOSITORY_ROOT,
      timeout: context.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, NODE_OPTIONS: nodeOptions },
      encoding: 'utf8',
    },
  );
  const record = parseWorkerPayload(stdout);
  if (stderr.trim()) {
    record.workerStderr = stderr.trim().slice(0, 4000);
  }
  return record;
}

function parseWorkerPayload(stdout) {
  const begin = stdout.indexOf(WORKER_BEGIN);
  const end = stdout.lastIndexOf(WORKER_END);
  if (begin < 0 || end <= begin) {
    throw new Error('WORKER_PAYLOAD_MISSING');
  }
  return JSON.parse(stdout.slice(begin + WORKER_BEGIN.length, end));
}

function workerFailureRecord(entry, corpusRoot, baseCommit, error) {
  const observed = errorObservation(error);
  const record = {
    schemaVersion: RECORD_SCHEMA,
    baseCommit,
    observedAt: new Date().toISOString(),
    durationMs: null,
    workerPid: null,
    input: {
      corpusRoot,
      relativePath: entry.relativePath,
      byteLength: entry.byteLength,
      sha256: entry.sha256,
      scannedByteLength: entry.byteLength,
      scannedSha256: entry.sha256,
      modifiedAt: entry.modifiedAt,
      regularFile: true,
    },
    inputChanged: false,
    classification: notObserved('Worker did not return a record.'),
    contentRecognition: notObserved('Worker did not return a record.'),
    profile: notObserved('Worker did not return a record.'),
    layout: notObserved('Worker did not return a record.'),
    pageCoverage: notObserved('Worker did not return a record.'),
    canonicalHost: {
      invoked: false,
      status: 'WORKER_FAILED',
      ...observed,
    },
    sourceUnits: notReached('Worker failed.'),
    sourceRefs: notReached('Worker failed.'),
    frozen2: notReached('Worker failed.'),
    u0: notReached('Worker failed.'),
    reader: notReached('Worker failed.'),
  };
  record.terminal = failure(
    'WORKER_FAILED',
    `${observed.code}: ${observed.message}`,
  );
  return record;
}

function finalizeRecord(record, startedNs) {
  record.durationMs = Number(process.hrtime.bigint() - startedNs) / 1_000_000;
  record.terminal = classifyTerminalOutcome(record);
  return record;
}

function chooseReaderQuery(textRuns) {
  for (const run of textRuns) {
    const text = String(run.text).normalize('NFC');
    const latin = text.match(/[A-Za-z0-9][A-Za-z0-9._/-]{1,19}/u)?.[0];
    if (latin) return latin;
    const han = text.match(/[\p{Script=Han}]{2,10}/u)?.[0];
    if (han) return han;
  }
  return 'PDF';
}

export function pageCoverageFromLayoutOwner(layout, nativeLayout = layout) {
  if (!Array.isArray(layout.pageTextLayerDiagnostics)) {
    return {
      status: 'OWNER_DIAGNOSTIC_UNAVAILABLE',
      owner: 'PdfjsDistLayoutExtractor',
      pageCount: layout.pageCount,
      textPageCount: null,
      textLayerPresentPageCount: null,
      nativeCoveredPageCount: null,
      ocrCoveredPageCount: null,
      ocrRequiredPageCount: null,
      missingCoveragePageCount: layout.pageCount,
      textPages: [],
      nativeCoveredPages: [],
      ocrCoveredPages: [],
      ocrRequiredPages: [],
      missingCoveragePages: Array.from(
        { length: layout.pageCount },
        (_value, index) => index + 1,
      ),
      diagnostics: [],
    };
  }
  const diagnostics = layout.pageTextLayerDiagnostics.map((diagnostic) => ({
    page: diagnostic.page,
    status: diagnostic.status,
    textRunCount: diagnostic.textRunCount,
    nonWhitespaceCharacterCount: diagnostic.nonWhitespaceCharacterCount,
    rasterVisualCoverage: diagnostic.rasterVisualCoverage
      ? structuredClone(diagnostic.rasterVisualCoverage)
      : null,
    ocrCoverage: diagnostic.ocrCoverage
      ? structuredClone(diagnostic.ocrCoverage)
      : null,
  }));
  const nativeDiagnostics = Array.isArray(
    nativeLayout?.pageTextLayerDiagnostics,
  )
    ? nativeLayout.pageTextLayerDiagnostics.map((diagnostic) => ({
        page: diagnostic.page,
        status: diagnostic.status,
        textRunCount: diagnostic.textRunCount,
        nonWhitespaceCharacterCount: diagnostic.nonWhitespaceCharacterCount,
        rasterVisualCoverage: diagnostic.rasterVisualCoverage
          ? structuredClone(diagnostic.rasterVisualCoverage)
          : null,
      }))
    : [];
  const nativeByPage = new Map(
    nativeDiagnostics.map((diagnostic) => [diagnostic.page, diagnostic]),
  );
  const observedPages = new Set(
    diagnostics.map((diagnostic) => diagnostic.page),
  );
  const textPages = diagnostics
    .filter((diagnostic) => diagnostic.status === 'PRESENT')
    .map((diagnostic) => diagnostic.page);
  const ocrCoveredPages = diagnostics
    .filter((diagnostic) => diagnostic.ocrCoverage?.status === 'OCR_COVERED')
    .map((diagnostic) => diagnostic.page);
  const ocrCoveredPageSet = new Set(ocrCoveredPages);
  const nativeCoveredPages = nativeDiagnostics
    .filter(
      (diagnostic) =>
        diagnostic.status === 'PRESENT' &&
        diagnostic.rasterVisualCoverage?.status !== 'UNVERIFIED' &&
        !ocrCoveredPageSet.has(diagnostic.page),
    )
    .map((diagnostic) => diagnostic.page);
  const nativeEmptyTextLayerPages = nativeDiagnostics
    .filter((diagnostic) => diagnostic.status === 'EMPTY')
    .map((diagnostic) => diagnostic.page);
  const nativeVisualTextUnverifiedPages = nativeDiagnostics
    .filter((diagnostic) => diagnostic.status === 'VISUAL_TEXT_UNVERIFIED')
    .map((diagnostic) => diagnostic.page);
  const emptyTextLayerPages = diagnostics
    .filter((diagnostic) => diagnostic.status === 'EMPTY')
    .map((diagnostic) => diagnostic.page);
  const visualTextUnverifiedPages = diagnostics
    .filter((diagnostic) => diagnostic.status === 'VISUAL_TEXT_UNVERIFIED')
    .map((diagnostic) => diagnostic.page);
  const textLayerPresentPages = nativeDiagnostics
    .filter((diagnostic) => diagnostic.status !== 'EMPTY')
    .map((diagnostic) => diagnostic.page);
  const ocrRequiredPages = [
    ...new Set([...emptyTextLayerPages, ...visualTextUnverifiedPages]),
  ].sort((left, right) => left - right);
  const ownerMaterialRasterPages = nativeDiagnostics
    .filter(
      (diagnostic) =>
        diagnostic.rasterVisualCoverage?.status ===
          'TEXT_LAYER_OVERLAP_PRESENT' ||
        diagnostic.rasterVisualCoverage?.status === 'UNVERIFIED',
    )
    .map((diagnostic) => diagnostic.page);
  const visualDiagnosticsAvailable =
    nativeDiagnostics.length === layout.pageCount &&
    nativeDiagnostics.every(
      (diagnostic) =>
        diagnostic.rasterVisualCoverage &&
        [
          'NO_MATERIAL_RASTER',
          'TEXT_LAYER_OVERLAP_PRESENT',
          'UNVERIFIED',
        ].includes(diagnostic.rasterVisualCoverage.status),
    );
  const missingCoveragePages = Array.from(
    { length: layout.pageCount },
    (_value, index) => index + 1,
  ).filter((page) => !observedPages.has(page));
  const pages = Array.from(
    { length: layout.pageCount },
    (_value, index) => index + 1,
  ).map((page) => {
    const materialized = diagnostics.find(
      (diagnostic) => diagnostic.page === page,
    );
    const native = nativeByPage.get(page);
    return {
      page,
      coverageMode: materialized?.ocrCoverage
        ? 'OCR_COVERED'
        : nativeCoveredPages.includes(page)
          ? 'NATIVE_TEXT'
          : materialized
            ? 'OCR_REQUIRED'
            : 'MISSING',
      nativeTextStatus: native?.status ?? 'MISSING',
      nativeVisualStatus: native?.rasterVisualCoverage?.status ?? 'MISSING',
      ocrCoverage: materialized?.ocrCoverage ?? null,
    };
  });
  return {
    status:
      missingCoveragePages.length > 0
        ? 'OWNER_DIAGNOSTIC_UNAVAILABLE'
        : !visualDiagnosticsAvailable
          ? 'VISUAL_COVERAGE_UNPROVEN'
          : visualTextUnverifiedPages.length === layout.pageCount
            ? 'VISUAL_OCR_REQUIRED_FULL'
            : visualTextUnverifiedPages.length > 0
              ? 'VISUAL_OCR_REQUIRED_PARTIAL'
              : emptyTextLayerPages.length === layout.pageCount
                ? 'OCR_REQUIRED_FULL'
                : emptyTextLayerPages.length > 0
                  ? 'OCR_REQUIRED_PARTIAL'
                  : 'CONTENT_COVERAGE_PROVEN',
    owner:
      'PdfjsOcrCompositeLayoutExtractor.pageTextLayerDiagnostics + PdfjsDistLayoutExtractor native diagnostics',
    diagnosticKind: 'PDF_PAGE_TEXT_LAYER_COVERAGE',
    pageCount: layout.pageCount,
    textPageCount: textPages.length,
    textLayerPresentPageCount: textLayerPresentPages.length,
    nativeCoveredPageCount: nativeCoveredPages.length,
    ocrCoveredPageCount: ocrCoveredPages.length,
    ocrRequiredPageCount: ocrRequiredPages.length,
    emptyTextLayerPageCount: emptyTextLayerPages.length,
    visualTextUnverifiedPageCount: visualTextUnverifiedPages.length,
    missingCoveragePageCount: missingCoveragePages.length,
    textPages,
    textLayerPresentPages,
    nativeCoveredPages,
    ocrCoveredPages,
    ocrRequiredPages,
    emptyTextLayerPages,
    visualTextUnverifiedPages,
    nativeEmptyTextLayerPages,
    nativeVisualTextUnverifiedPages,
    ownerMaterialRasterPages,
    ownerMaterialRasterPageCount: ownerMaterialRasterPages.length,
    missingCoveragePages,
    pages,
    diagnostics,
    visualCoverageStatus: visualDiagnosticsAvailable
      ? 'OWNER_DIAGNOSTIC_AVAILABLE'
      : 'OWNER_DIAGNOSTIC_REQUIRED',
  };
}

export function pageCoverageFromOcrOwnerError(error) {
  const diagnostic =
    error && typeof error === 'object' && error.diagnostic
      ? error.diagnostic
      : null;
  if (
    !diagnostic ||
    diagnostic.diagnosticKind !== 'PDF_PAGE_TEXT_LAYER_COVERAGE' ||
    !Number.isSafeInteger(diagnostic.pageCount) ||
    !Array.isArray(diagnostic.emptyTextLayerPages)
  ) {
    return {
      status: 'OWNER_DIAGNOSTIC_UNAVAILABLE',
      owner: 'PDF_OCR_REQUIRED_UNSUPPORTED',
      pageCount: null,
      textPageCount: null,
      textLayerPresentPageCount: null,
      nativeCoveredPageCount: null,
      ocrCoveredPageCount: null,
      ocrRequiredPageCount: null,
      missingCoveragePageCount: null,
      textPages: [],
      nativeCoveredPages: [],
      ocrCoveredPages: [],
      ocrRequiredPages: [],
      missingCoveragePages: [],
      diagnostics: diagnostic,
    };
  }
  const emptyTextLayerPages = [...diagnostic.emptyTextLayerPages];
  const visualTextUnverifiedPages = Array.isArray(
    diagnostic.visualTextUnverifiedPages,
  )
    ? [...diagnostic.visualTextUnverifiedPages]
    : [];
  const ocrRequiredPages = Array.isArray(diagnostic.ocrRequiredPages)
    ? [...diagnostic.ocrRequiredPages]
    : [...new Set([...emptyTextLayerPages, ...visualTextUnverifiedPages])].sort(
        (left, right) => left - right,
      );
  const ocrRequiredSet = new Set(ocrRequiredPages);
  const emptyTextLayerPageSet = new Set(emptyTextLayerPages);
  const textPages = Array.from(
    { length: diagnostic.pageCount },
    (_value, index) => index + 1,
  ).filter((page) => !ocrRequiredSet.has(page));
  const textLayerPresentPages = Array.from(
    { length: diagnostic.pageCount },
    (_value, index) => index + 1,
  ).filter((page) => !emptyTextLayerPageSet.has(page));
  const ownerMaterialRasterPages = [...visualTextUnverifiedPages];
  const nativeCoveredPages = [...textPages];
  const pages = Array.from(
    { length: diagnostic.pageCount },
    (_value, index) => index + 1,
  ).map((page) => ({
    page,
    coverageMode: ocrRequiredSet.has(page) ? 'OCR_REQUIRED' : 'NATIVE_TEXT',
    nativeTextStatus: emptyTextLayerPageSet.has(page)
      ? 'EMPTY'
      : visualTextUnverifiedPages.includes(page)
        ? 'VISUAL_TEXT_UNVERIFIED'
        : 'PRESENT',
    nativeVisualStatus: visualTextUnverifiedPages.includes(page)
      ? 'UNVERIFIED'
      : 'PROVEN',
    ocrCoverage: null,
  }));
  return {
    status:
      emptyTextLayerPages.length > 0
        ? emptyTextLayerPages.length === diagnostic.pageCount
          ? 'OCR_REQUIRED_FULL'
          : 'OCR_REQUIRED_PARTIAL'
        : visualTextUnverifiedPages.length === diagnostic.pageCount
          ? 'VISUAL_OCR_REQUIRED_FULL'
          : 'VISUAL_OCR_REQUIRED_PARTIAL',
    owner:
      'PdfjsOcrCompositeLayoutExtractor PDF_OCR_REQUIRED_UNSUPPORTED diagnostic',
    authoritativeFailureCode: 'PDF_OCR_REQUIRED_UNSUPPORTED',
    diagnosticKind: diagnostic.diagnosticKind,
    ocrRequirementKind: diagnostic.ocrRequirementKind ?? null,
    textLayerStatus: diagnostic.textLayerStatus ?? null,
    visualTextStatus: diagnostic.visualTextStatus ?? null,
    pageCount: diagnostic.pageCount,
    textPageCount: textPages.length,
    textLayerPresentPageCount: textLayerPresentPages.length,
    nativeCoveredPageCount: nativeCoveredPages.length,
    ocrCoveredPageCount: 0,
    ocrRequiredPageCount: ocrRequiredPages.length,
    emptyTextLayerPageCount: emptyTextLayerPages.length,
    visualTextUnverifiedPageCount: visualTextUnverifiedPages.length,
    missingCoveragePageCount: 0,
    textPages,
    textLayerPresentPages,
    nativeCoveredPages,
    ocrCoveredPages: [],
    ocrRequiredPages,
    emptyTextLayerPages,
    visualTextUnverifiedPages,
    ownerMaterialRasterPages,
    ownerMaterialRasterPageCount: ownerMaterialRasterPages.length,
    ownerMaterialRasterCoverage: 'UNVERIFIED_ONLY_FROM_OCR_FAILURE_DIAGNOSTIC',
    missingCoveragePages: [],
    pages,
    ocrProviderStatus: diagnostic.ocrProviderStatus,
    requiredProvider: diagnostic.requiredProvider,
    emptyTextLayerPageRanges: diagnostic.emptyTextLayerPageRanges,
    ocrRequiredPageRanges: diagnostic.ocrRequiredPageRanges ?? null,
    visualTextUnverifiedPageRanges:
      diagnostic.visualTextUnverifiedPageRanges ?? null,
    visualTextUnverifiedPageDetails:
      diagnostic.visualTextUnverifiedPageDetails ?? [],
    materialUnverifiedRasterPageFraction:
      diagnostic.materialUnverifiedRasterPageFraction ?? null,
    materialUnverifiedRasterPagePercent:
      diagnostic.materialUnverifiedRasterPagePercent ?? null,
    diagnostics: structuredClone(diagnostic),
  };
}

function routingSliceForRecord(record) {
  const category = record.contentRecognition?.documentCategory;
  if (category && category !== 'generic') return `CATEGORY:${category}`;
  const sourceType = record.contentRecognition?.sourceType;
  if (sourceType && !['generic', 'pdf'].includes(sourceType)) {
    return `SOURCE_TYPE:${sourceType}`;
  }
  const adapterId = record.contentRecognition?.adapterId;
  if (adapterId && adapterId !== 'generic.general_document.v1') {
    return `ADAPTER:${adapterId}`;
  }
  if (/^AEO(?:[-_\s]|$)/iu.test(basename(record.input.relativePath))) {
    return 'UNRESOLVED:AEO_FILENAME_PREFIX';
  }
  return `DM_FAMILY:${record.classification?.canonicalDocumentFamily ?? 'NOT_OBSERVED'}`;
}

function deterministicUuid(hexSeed) {
  const value = hexSeed.slice(0, 32).split('');
  value[12] = '4';
  value[16] = ['8', '9', 'a', 'b'][Number.parseInt(value[16], 16) % 4];
  const hex = value.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function readStableInputIdentity(filePath) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await stat(filePath);
    const hash = createHash('sha256');
    let byteLength = 0;
    for await (const chunk of createReadStream(filePath, {
      highWaterMark: 1024 * 1024,
    })) {
      hash.update(chunk);
      byteLength += chunk.byteLength;
    }
    const after = await stat(filePath);
    if (
      before.isFile() &&
      after.isFile() &&
      before.size === after.size &&
      before.mtimeMs === after.mtimeMs &&
      byteLength === after.size
    ) {
      return {
        byteLength,
        sha256: hash.digest('hex'),
        modifiedAt: after.mtime.toISOString(),
      };
    }
  }
  throw new Error(`INPUT_CHANGED_DURING_SCAN:${filePath}`);
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function failure(code, message) {
  return {
    status: 'FAILURE',
    code,
    message,
    silentFallback: false,
    silentEmpty: false,
  };
}

function errorObservation(error) {
  const message = error instanceof Error ? error.message : String(error);
  const explicitCode =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
  return {
    code: explicitCode || message.split(':', 1)[0] || 'UNKNOWN_ERROR',
    errorClass:
      error instanceof Error ? error.constructor.name : 'NonErrorThrown',
    message: message.slice(0, 4000),
  };
}

function notReached(reason) {
  return { status: 'NOT_REACHED', reason };
}

function notObserved(reason) {
  return { status: 'NOT_OBSERVED', reason };
}

function notInvoked(reason) {
  return { invoked: false, status: 'NOT_INVOKED', reason };
}

function countBy(values, keyFor) {
  const counts = {};
  for (const value of values) {
    const key = String(keyFor(value));
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => compareText(left, right)),
  );
}

function sumRecordNumber(records, field) {
  return records.reduce((sum, record) => {
    const value = Number(record.pageCoverage?.[field]);
    return sum + (Number.isFinite(value) && value >= 0 ? value : 0);
  }, 0);
}

function compareEntries(left, right) {
  return compareText(
    left.relativePath.normalize('NFC'),
    right.relativePath.normalize('NFC'),
  );
}

function compareText(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function integerOption(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`INVALID_OPTION:${name}`);
  }
  return parsed;
}

function parseArguments(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--'))
      throw new Error(`INVALID_ARGUMENT:${argument}`);
    const [name, inlineValue] = argument.slice(2).split('=', 2);
    if (inlineValue !== undefined) {
      values.set(name, inlineValue);
      continue;
    }
    if (['resume', 'help'].includes(name)) {
      flags.add(name);
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined) throw new Error(`MISSING_ARGUMENT_VALUE:${name}`);
    values.set(name, next);
    index += 1;
  }
  if (flags.has('help')) return { help: true };
  if (values.has('worker-input')) {
    return { workerInput: values.get('worker-input') };
  }
  const shardCount = integerOption(
    values.get('shard-count') ?? 1,
    'shard-count',
    1,
    1024,
  );
  return {
    help: false,
    corpusRoot: resolve(values.get('corpus-root') ?? DEFAULT_CORPUS_ROOT),
    outputDirectory: values.has('output-dir')
      ? resolve(values.get('output-dir'))
      : null,
    resume: flags.has('resume'),
    match: values.get('match') ?? '',
    limit: values.has('limit')
      ? integerOption(values.get('limit'), 'limit', 1, Number.MAX_SAFE_INTEGER)
      : undefined,
    shardCount,
    shardIndex: integerOption(
      values.get('shard-index') ?? 0,
      'shard-index',
      0,
      shardCount - 1,
    ),
    concurrency: integerOption(
      values.get('concurrency') ?? 2,
      'concurrency',
      1,
      4,
    ),
    workerMemoryMb: integerOption(
      values.get('worker-memory-mb') ?? 1536,
      'worker-memory-mb',
      512,
      4096,
    ),
    workerTimeoutMs: integerOption(
      values.get('worker-timeout-ms') ?? 900000,
      'worker-timeout-ms',
      30000,
      1800000,
    ),
  };
}

async function assertBuiltRuntime() {
  try {
    await stat(
      resolve(
        REPOSITORY_ROOT,
        'dist/server/modules/canonical-host/canonical-host-vertical.service.js',
      ),
    );
    await stat(
      resolve(
        REPOSITORY_ROOT,
        'dist/server/modules/professional-input/parser/pdfjs-layout-extractor.runner.mjs',
      ),
    );
  } catch {
    throw new Error('BUILT_RUNTIME_REQUIRED: run npm run build:server first');
  }
}

async function currentCommit() {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
    });
    return exactCommit(stdout.trim());
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return readGitHeadCommit(REPOSITORY_ROOT);
  }
}

export async function readGitHeadCommit(repositoryRoot) {
  const dotGit = resolve(repositoryRoot, '.git');
  const dotGitMetadata = await stat(dotGit);
  let gitDirectory = dotGit;
  if (!dotGitMetadata.isDirectory()) {
    const pointer = (await readFile(dotGit, 'utf8')).trim();
    const match = /^gitdir:\s*(.+)$/u.exec(pointer);
    if (!match) throw new Error('GIT_DIRECTORY_POINTER_INVALID');
    gitDirectory = resolve(repositoryRoot, match[1]);
  }
  const head = (await readFile(resolve(gitDirectory, 'HEAD'), 'utf8')).trim();
  if (/^[0-9a-f]{40}$/u.test(head)) return head;
  const symbolic = /^ref:\s*(refs\/[^\s]+)$/u.exec(head);
  if (!symbolic) throw new Error('GIT_HEAD_INVALID');
  let commonDirectory = gitDirectory;
  try {
    const commonPointer = (
      await readFile(resolve(gitDirectory, 'commondir'), 'utf8')
    ).trim();
    commonDirectory = resolve(gitDirectory, commonPointer);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  for (const root of [gitDirectory, commonDirectory]) {
    try {
      return exactCommit(
        (await readFile(resolve(root, symbolic[1]), 'utf8')).trim(),
      );
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  const packedRefs = await readFile(
    resolve(commonDirectory, 'packed-refs'),
    'utf8',
  );
  for (const line of packedRefs.split('\n')) {
    if (!line || line.startsWith('#') || line.startsWith('^')) continue;
    const [commit, refName] = line.trim().split(/\s+/u, 2);
    if (refName === symbolic[1]) return exactCommit(commit);
  }
  throw new Error(`GIT_HEAD_REF_NOT_FOUND:${symbolic[1]}`);
}

function exactCommit(value) {
  if (!/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error('GIT_COMMIT_INVALID');
  }
  return value;
}

async function readNdjsonIfPresent(filePath) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`RESUME_RECORD_INVALID:${index + 1}`);
      }
    });
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function renderSummaryMarkdown(summary) {
  return (
    `# Canonical PDF corpus observation\n\n` +
    `- Base commit: \`${summary.baseCommit}\`\n` +
    `- Corpus root: \`${summary.corpusRoot}\`\n` +
    `- Records: ${summary.counts.records}\n` +
    `- Successes: ${summary.counts.successes}\n` +
    `- Failures: ${summary.counts.failures}\n` +
    `- Acceptance scope: ${summary.acceptance.scope}\n` +
    `- Corpus acceptance: ${summary.acceptance.status}\n` +
    `- Bytes: ${summary.counts.totalBytes}\n` +
    `- Pages observed by the canonical layout owner: ${summary.counts.totalPages}\n` +
    `- Text-covered pages: ${summary.counts.totalTextPages}\n` +
    `- Pages with a native text layer: ${summary.counts.totalTextLayerPresentPages}\n` +
    `- Pages completely covered by native text: ${summary.counts.totalNativeCoveredPages}\n` +
    `- Pages covered by Host OCR: ${summary.counts.totalOcrCoveredPages}\n` +
    `- OCR-required pages: ${summary.counts.totalOcrRequiredPages}\n` +
    `- Pages missing authoritative coverage: ${summary.counts.totalMissingCoveragePages}\n` +
    `- Empty text-layer pages: ${summary.counts.totalEmptyTextLayerPages}\n` +
    `- Visual-text-unverified pages: ${summary.counts.totalVisualTextUnverifiedPages}\n` +
    `- Owner-observed material raster pages: ${summary.counts.totalOwnerMaterialRasterPages}\n\n` +
    renderCountTable(
      'Terminal outcomes',
      'Terminal code',
      summary.counts.byTerminalCode,
    ) +
    renderCountTable('DM families', 'Family', summary.counts.byFamily) +
    renderCountTable(
      'DM descriptor evidence',
      'Evidence status',
      summary.counts.byDocumentManagementDescriptorEvidenceStatus,
    ) +
    renderCountTable(
      'Content recognition results',
      'Recognition status',
      summary.counts.byContentRecognitionStatus,
    ) +
    renderCountTable(
      'Content-recognized profiles',
      'Content profile',
      summary.counts.byContentProfile,
    ) +
    renderCountTable(
      'Document Management adapter releases',
      'DM adapter release',
      summary.counts.byDocumentManagementAdapterRelease,
    ) +
    renderCountTable(
      'Production request profiles',
      'Requested profile',
      summary.counts.byRequestedParserProfile,
    ) +
    renderCountTable(
      'Production recognized profiles',
      'Recognized profile',
      summary.counts.byRecognizedParserProfile,
    ) +
    renderCountTable(
      'Document types',
      'Document type',
      summary.counts.byDocumentType,
    ) +
    renderCountTable(
      'Document Management issuers',
      'DM issuer authority',
      summary.counts.byDocumentManagementIssuerAuthority,
    ) +
    renderCountTable(
      'Content-recognized issuers',
      'Content issuer',
      summary.counts.byContentIssuer,
    ) +
    renderCountTable(
      'Routing slices',
      'Routing slice',
      summary.counts.byRoutingSlice,
    ) +
    renderCountTable(
      'Page coverage',
      'Coverage status',
      summary.counts.byPageCoverageStatus,
    ) +
    renderCountTable(
      'OCR requirement kinds',
      'Requirement kind',
      summary.counts.byOcrRequirementKind,
    ) +
    renderCountTable(
      'Page-coverage owner failure codes',
      'Coverage failure code',
      summary.counts.byPageCoverageFailureCode,
    ) +
    renderCountTable(
      'Document Management results',
      'DM status',
      summary.counts.byDocumentManagementStatus,
    ) +
    renderCountTable(
      'Document Management failure codes',
      'DM failure code',
      summary.counts.byDocumentManagementFailureCode,
    ) +
    renderCountTable(
      'Canonical Host results',
      'Host status',
      summary.counts.byHostStatus,
    ) +
    renderCountTable(
      'Host producer failure codes',
      'Producer failure code',
      summary.counts.byHostProducerFailureCode,
    ) +
    renderCountTable(
      'Host recorded failure codes',
      'Recorded failure code',
      summary.counts.byHostRecordedFailureCode,
    ) +
    renderCountTable(
      'Host cause codes',
      'Cause code',
      summary.counts.byHostCauseCode,
    ) +
    renderCountTable(
      'Observed failure codes',
      'Failure code',
      summary.counts.byFailureCode,
    ) +
    `## Integrity\n\n` +
    `\`\`\`json\n${JSON.stringify(summary.invariants, null, 2)}\n\`\`\`\n\n` +
    `## Nonclaims\n\n` +
    summary.nonClaims.map((claim) => `- ${claim}`).join('\n') +
    '\n'
  );
}

function renderCountTable(title, label, counts) {
  const rows = Object.entries(counts)
    .map(
      ([key, count]) => `| ${String(key).replaceAll('|', '\\|')} | ${count} |`,
    )
    .join('\n');
  return `## ${title}\n\n| ${label} | Count |\n| --- | ---: |\n${rows}\n\n`;
}

function timestampForPath(date) {
  return date.toISOString().replace(/[:.]/gu, '-');
}

function usage() {
  return (
    `Usage: npm run build:server && node scripts/run-canonical-pdf-corpus.mjs [options]\n\n` +
    `Options:\n` +
    `  --corpus-root PATH       External PDF corpus (default: ${DEFAULT_CORPUS_ROOT})\n` +
    `  --output-dir PATH        Output directory (default: timestamped /private/tmp path)\n` +
    `  --resume                 Reuse exact path+bytes+SHA records already in output dir\n` +
    `  --match TEXT             Select paths containing TEXT\n` +
    `  --limit N                Limit selected files\n` +
    `  --shard-index N          Zero-based stable shard index\n` +
    `  --shard-count N          Stable shard count\n` +
    `  --concurrency N          Worker processes, 1..4 (default: 2)\n` +
    `  --worker-memory-mb N     Per-worker old-space cap (default: 1536)\n` +
    `  --worker-timeout-ms N    Per-file process timeout (default: 900000)\n`
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (options.workerInput) {
    const input = JSON.parse(
      Buffer.from(options.workerInput, 'base64url').toString('utf8'),
    );
    const record = await runWorker(input);
    process.stdout.write(
      `${WORKER_BEGIN}${JSON.stringify(record)}${WORKER_END}`,
    );
    return;
  }
  await runParent(options);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH;
if (isMain) {
  main().catch((error) => {
    const observed = errorObservation(error);
    process.stderr.write(`${observed.code}: ${observed.message}\n`);
    process.exitCode = 1;
  });
}
