import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  assessDocumentManagementDescriptorEvidence,
  classifyTerminalOutcome,
  isReusableCorpusRecord,
  pageCoverageFromLayoutOwner,
  pageCoverageFromOcrOwnerError,
  productionFamilyRegistryInputFromDmSource,
  readGitHeadCommit,
  recordIdentity,
  scanPdfCorpus,
  selectCorpusEntries,
  summarizeRecords,
} from '../../scripts/run-canonical-pdf-corpus.mjs';

test('gitless Linux runners fresh-read the exact worktree HEAD', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'wiselink-corpus-git-head-'));
  const common = resolve(root, 'common.git');
  const worktreeGit = resolve(common, 'worktrees', 'corpus');
  const commit = 'c717bed2aa52a68675c8b8193fa003663e21ad85';
  try {
    await mkdir(resolve(common, 'refs', 'heads', 'codex'), {
      recursive: true,
    });
    await mkdir(worktreeGit, { recursive: true });
    await writeFile(resolve(root, '.git'), `gitdir: ${worktreeGit}\n`);
    await writeFile(resolve(worktreeGit, 'commondir'), '../..\n');
    await writeFile(
      resolve(worktreeGit, 'HEAD'),
      'ref: refs/heads/codex/corpus\n',
    );
    await writeFile(
      resolve(common, 'refs', 'heads', 'codex', 'corpus'),
      `${commit}\n`,
    );

    assert.equal(await readGitHeadCommit(root), commit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('composite owner reports native, OCR-covered, and missing pages separately', () => {
  const nativeDiagnostics = [
    pageDiagnostic(1, 'PRESENT', 'NO_MATERIAL_RASTER'),
    pageDiagnostic(2, 'EMPTY', 'NO_MATERIAL_RASTER'),
    pageDiagnostic(3, 'VISUAL_TEXT_UNVERIFIED', 'UNVERIFIED'),
  ];
  const materializedDiagnostics = [
    nativeDiagnostics[0],
    {
      ...pageDiagnostic(2, 'PRESENT', 'NO_MATERIAL_RASTER'),
      ocrCoverage: ocrCoverage('provider', 4),
    },
    {
      ...pageDiagnostic(3, 'PRESENT', 'TEXT_LAYER_OVERLAP_PRESENT'),
      ocrCoverage: ocrCoverage('provider', 7),
    },
  ];

  const result = pageCoverageFromLayoutOwner(
    { pageCount: 3, pageTextLayerDiagnostics: materializedDiagnostics },
    { pageCount: 3, pageTextLayerDiagnostics: nativeDiagnostics },
  );

  assert.equal(result.status, 'CONTENT_COVERAGE_PROVEN');
  assert.deepEqual(result.nativeCoveredPages, [1]);
  assert.deepEqual(result.ocrCoveredPages, [2, 3]);
  assert.deepEqual(
    result.pages.map((page) => page.coverageMode),
    ['NATIVE_TEXT', 'OCR_COVERED', 'OCR_COVERED'],
  );
  assert.equal(result.missingCoveragePageCount, 0);
});

function pageDiagnostic(page, status, visualStatus) {
  return {
    page,
    status,
    textRunCount: status === 'EMPTY' ? 0 : 1,
    nonWhitespaceCharacterCount: status === 'EMPTY' ? 0 : 10,
    rasterVisualCoverage: {
      status: visualStatus,
      materialUnverifiedRasterPageFraction: 0.25,
      rasterRegionCount: visualStatus === 'NO_MATERIAL_RASTER' ? 0 : 1,
      rasterPageAreaRatio: visualStatus === 'NO_MATERIAL_RASTER' ? 0 : 0.5,
      unverifiedRasterRegionCount: visualStatus === 'UNVERIFIED' ? 1 : 0,
      unverifiedRasterPageAreaRatio: visualStatus === 'UNVERIFIED' ? 0.5 : 0,
      unverifiedRasterRegions: [],
    },
  };
}

function ocrCoverage(providerId, acceptedLineCount) {
  return {
    status: 'OCR_COVERED',
    providerId,
    requiredLanguages: ['eng', 'chi_sim'],
    targetCount: 1,
    acceptedLineCount,
    characterWeightedMeanConfidence: 95,
    wordsBelow60Ratio: 0,
  };
}

test('production family registry input consumes the committed DM preflight release', () => {
  const committedPreflight = {
    preflightId: 'preflight-actual',
    status: 'COMMITTED',
    normalizedDescriptorJson: JSON.stringify({
      adapterRelease: {
        adapterId: 'issuer.honeywell.sil.v1',
        adapterVersion: 'v8.4-document-family-adapter.v1',
      },
    }),
  };
  let observedPreflight = null;

  const result = productionFamilyRegistryInputFromDmSource(
    {
      family: {
        documentFamily: 'SIL',
        issuerAuthority: 'HONEYWELL',
      },
      preflight: committedPreflight,
    },
    (preflight) => {
      observedPreflight = preflight;
      return 'issuer.honeywell.sil.v1';
    },
  );

  assert.equal(observedPreflight, committedPreflight);
  assert.deepEqual(result, {
    input: {
      family: 'SIL',
      issuerAuthority: 'HONEYWELL',
      adapterId: 'issuer.honeywell.sil.v1',
    },
    adapterId: 'issuer.honeywell.sil.v1',
  });
});

test('fresh scan finds only regular PDFs and records runtime identity', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'wiselink-corpus-scan-'));
  try {
    await mkdir(resolve(root, 'nested'));
    await writeFile(resolve(root, 'a.pdf'), 'first-real-input-identity');
    await writeFile(
      resolve(root, 'nested', 'B.PDF'),
      'second-real-input-identity',
    );
    await writeFile(resolve(root, 'nested', 'ignored.txt'), 'not-a-pdf');

    const scan = await scanPdfCorpus(root);

    assert.deepEqual(
      scan.entries.map((entry) => entry.relativePath),
      ['a.pdf', 'nested/B.PDF'],
    );
    assert.equal(scan.entries[0].byteLength, 25);
    assert.match(scan.entries[0].sha256, /^[0-9a-f]{64}$/u);
    assert.notEqual(scan.entries[0].sha256, scan.entries[1].sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stable shards and exact identity support bounded resumable runs', () => {
  const entries = Array.from({ length: 7 }, (_value, index) => ({
    relativePath: `${index}.pdf`,
    byteLength: index + 1,
    sha256: String(index).padStart(64, '0'),
  }));
  const selected = selectCorpusEntries(entries, {
    shardCount: 3,
    shardIndex: 1,
  });

  assert.deepEqual(
    selected.map((entry) => entry.relativePath),
    ['1.pdf', '4.pdf'],
  );
  assert.equal(
    recordIdentity(selected[0]),
    `1.pdf\n2\n${'1'.padStart(64, '0')}`,
  );

  const record = {
    schemaVersion: 'wiselink.canonical_pdf_corpus_observation.v1',
    baseCommit: 'commit-a',
    input: { ...selected[0], corpusRoot: '/corpus' },
    terminal: { status: 'FAILURE' },
  };
  assert.equal(
    isReusableCorpusRecord(record, {
      entry: selected[0],
      corpusRoot: '/corpus',
      baseCommit: 'commit-a',
    }),
    true,
  );
  assert.equal(
    isReusableCorpusRecord(record, {
      entry: selected[0],
      corpusRoot: '/corpus',
      baseCommit: 'commit-b',
    }),
    false,
  );
  assert.equal(
    isReusableCorpusRecord(record, {
      entry: selected[0],
      corpusRoot: '/other-corpus',
      baseCommit: 'commit-a',
    }),
    false,
  );
});

test('legacy normalized descriptor defaults are observable but never identity authority', () => {
  const evidence = assessDocumentManagementDescriptorEvidence({
    normalizedDescriptor: {
      originalFilename: '777-FTD-31-21002_Doc_09262025.pdf',
      sha256: 'a'.repeat(64),
      sizeBytes: 122102,
      documentCode: '787-FTD-34-19008',
      pageCount: 6,
    },
    preflightIncoming: { documentCode: '777-FTD-31-21002' },
    familyReadback: { canonicalDocumentNumber: '777-FTD-31-21002' },
    actualInput: {
      fileName: '777-FTD-31-21002_Doc_09262025.pdf',
      sha256: 'a'.repeat(64),
      byteLength: 122102,
    },
    observedLayoutPageCount: 5,
  });

  assert.equal(evidence.status, 'NON_AUTHORITATIVE_DEFAULT_MISMATCH_OBSERVED');
  assert.equal(evidence.normalizedDescriptorUsedAsIdentityAuthority, false);
  assert.deepEqual(
    evidence.nonAuthoritativeDefaultMismatches.map((value) => value.field),
    ['documentCode', 'pageCount'],
  );
  assert.deepEqual(evidence.actualSourceMismatches, []);
});

test('actual filename, SHA, or byte mismatch is an identity failure', () => {
  const descriptorEvidence = assessDocumentManagementDescriptorEvidence({
    normalizedDescriptor: {
      originalFilename: 'actual.pdf',
      sha256: 'b'.repeat(64),
      sizeBytes: 10,
      documentCode: 'ACTUAL',
      pageCount: 1,
    },
    preflightIncoming: { documentCode: 'ACTUAL' },
    familyReadback: { canonicalDocumentNumber: 'ACTUAL' },
    actualInput: {
      fileName: 'actual.pdf',
      sha256: 'a'.repeat(64),
      byteLength: 10,
    },
    observedLayoutPageCount: 1,
  });
  const terminal = classifyTerminalOutcome({
    inputChanged: false,
    documentManagement: { descriptorEvidence },
  });

  assert.equal(descriptorEvidence.status, 'ACTUAL_SOURCE_MISMATCH');
  assert.equal(terminal.code, 'IDENTITY_OR_READBACK_FAILED');
});

test('authoritative full-page OCR diagnostic prevents apparent Host success', () => {
  const terminal = classifyTerminalOutcome({
    inputChanged: false,
    layout: { status: 'OCR_REQUIRED' },
    pageCoverage: {
      status: 'OCR_REQUIRED_FULL',
      pageCount: 2,
      ocrRequiredPageCount: 2,
      missingCoveragePageCount: 0,
    },
    classification: { canonicalDocumentFamily: 'FTD' },
    canonicalHost: { status: 'CANDIDATE_VERTICAL_VERIFIED' },
    sourceUnits: { count: 10, allHaveSourceRefs: true },
    sourceRefs: { count: 10 },
    u0: { status: 'FULL_STRICT_VALIDATOR_PASSED' },
    reader: {
      status: 'CANDIDATE_READBACK_VERIFIED',
      queryResultCount: 2,
    },
  });

  assert.equal(terminal.status, 'FAILURE');
  assert.equal(terminal.code, 'OCR_NEEDED');
  assert.equal(terminal.silentEmpty, false);
});

test('empty text-layer requirement remains OCR even when raster pages are also unverified', () => {
  const error = Object.assign(new Error('OCR required'), {
    code: 'PDF_OCR_REQUIRED_UNSUPPORTED',
    diagnostic: {
      diagnosticKind: 'PDF_PAGE_TEXT_LAYER_COVERAGE',
      ocrRequirementKind: 'TEXT_LAYER_EMPTY',
      textLayerStatus: 'EMPTY',
      visualTextStatus: 'UNVERIFIED',
      pageCount: 2,
      ocrRequiredPages: [1, 2],
      emptyTextLayerPages: [1, 2],
      visualTextUnverifiedPages: [1, 2],
    },
  });

  const coverage = pageCoverageFromOcrOwnerError(error);
  const terminal = classifyTerminalOutcome({
    inputChanged: false,
    layout: { status: 'OCR_REQUIRED' },
    pageCoverage: coverage,
  });

  assert.equal(coverage.status, 'OCR_REQUIRED_FULL');
  assert.equal(coverage.ocrRequirementKind, 'TEXT_LAYER_EMPTY');
  assert.equal(coverage.textLayerPresentPageCount, 0);
  assert.equal(coverage.ownerMaterialRasterPageCount, 2);
  assert.equal(terminal.code, 'OCR_NEEDED');
});

test('authoritative mixed-page OCR diagnostic is not document-level success', () => {
  const terminal = classifyTerminalOutcome({
    inputChanged: false,
    layout: { status: 'OCR_REQUIRED' },
    pageCoverage: {
      status: 'OCR_REQUIRED_PARTIAL',
      pageCount: 97,
      ocrRequiredPageCount: 13,
      missingCoveragePageCount: 0,
    },
    classification: { canonicalDocumentFamily: 'AD' },
    canonicalHost: {
      status: 'FAILED',
      failureCode: 'PRODUCER_UNSUPPORTED',
      causeCode: 'PDF_PRODUCER_PROFILE_NOT_AVAILABLE',
    },
  });

  assert.equal(terminal.code, 'PARTIAL_OCR_NEEDED');
});

test('nonzero text without owner visual coverage cannot be canonical success', () => {
  const terminal = classifyTerminalOutcome({
    inputChanged: false,
    layout: { status: 'EXTRACTED' },
    pageCoverage: {
      status: 'VISUAL_COVERAGE_UNPROVEN',
      pageCount: 55,
      textPageCount: 55,
      ocrRequiredPageCount: 0,
      missingCoveragePageCount: 0,
    },
    classification: { canonicalDocumentFamily: 'AD' },
    canonicalHost: { status: 'CANDIDATE_VERTICAL_VERIFIED' },
    sourceUnits: { count: 55, allHaveSourceRefs: true },
    sourceRefs: { count: 55 },
    u0: { status: 'FULL_STRICT_VALIDATOR_PASSED' },
    reader: {
      status: 'CANDIDATE_READBACK_VERIFIED',
      queryResultCount: 1,
    },
  });

  assert.equal(terminal.status, 'FAILURE');
  assert.equal(terminal.code, 'VISUAL_TEXT_COVERAGE_UNPROVEN');
});

test('owner visual-text OCR diagnostic classifies the page-48 counterexample', () => {
  const error = Object.assign(new Error('OCR required'), {
    code: 'PDF_OCR_REQUIRED_UNSUPPORTED',
    diagnostic: {
      diagnosticKind: 'PDF_PAGE_TEXT_LAYER_COVERAGE',
      ocrRequirementKind: 'VISUAL_TEXT_UNVERIFIED',
      textLayerStatus: 'PRESENT',
      visualTextStatus: 'UNVERIFIED',
      pageCount: 55,
      ocrRequiredPages: [47, 48, 49, 50, 51, 52, 53],
      emptyTextLayerPages: [],
      visualTextUnverifiedPages: [47, 48, 49, 50, 51, 52, 53],
      visualTextUnverifiedPageDetails: [
        '48:textChars=2;unverifiedRasterPageAreaRatio=0.490128;regions=1',
      ],
      materialUnverifiedRasterPageFraction: 0.25,
    },
  });

  const coverage = pageCoverageFromOcrOwnerError(error);
  const terminal = classifyTerminalOutcome({
    inputChanged: false,
    layout: { status: 'OCR_REQUIRED' },
    pageCoverage: coverage,
    classification: { canonicalDocumentFamily: 'AD' },
    canonicalHost: { status: 'FAILED' },
  });

  assert.equal(coverage.status, 'VISUAL_OCR_REQUIRED_PARTIAL');
  assert.equal(coverage.textLayerPresentPageCount, 55);
  assert.equal(coverage.visualTextUnverifiedPageCount, 7);
  assert.equal(coverage.ownerMaterialRasterPageCount, 7);
  assert.match(coverage.visualTextUnverifiedPageDetails[0], /^48:textChars=2/u);
  assert.equal(terminal.code, 'PARTIAL_VISUAL_OCR_NEEDED');
});

test('all pages having text does not hide the SL page-9 screenshot OCR requirement', () => {
  const error = Object.assign(new Error('OCR required'), {
    code: 'PDF_OCR_REQUIRED_UNSUPPORTED',
    diagnostic: {
      diagnosticKind: 'PDF_PAGE_TEXT_LAYER_COVERAGE',
      ocrRequirementKind: 'VISUAL_TEXT_UNVERIFIED',
      textLayerStatus: 'PRESENT',
      visualTextStatus: 'UNVERIFIED',
      pageCount: 11,
      ocrRequiredPages: [9],
      emptyTextLayerPages: [],
      visualTextUnverifiedPages: [9],
      visualTextUnverifiedPageDetails: [
        '9:textChars=554;unverifiedRasterPageAreaRatio=0.282093;regions=2',
      ],
    },
  });

  const coverage = pageCoverageFromOcrOwnerError(error);
  const terminal = classifyTerminalOutcome({
    inputChanged: false,
    layout: { status: 'OCR_REQUIRED' },
    pageCoverage: coverage,
  });

  assert.equal(coverage.status, 'VISUAL_OCR_REQUIRED_PARTIAL');
  assert.equal(coverage.textLayerPresentPageCount, 11);
  assert.deepEqual(coverage.visualTextUnverifiedPages, [9]);
  assert.deepEqual(coverage.ownerMaterialRasterPages, [9]);
  assert.match(coverage.visualTextUnverifiedPageDetails[0], /textChars=554/u);
  assert.equal(terminal.code, 'PARTIAL_VISUAL_OCR_NEEDED');
});

test('success requires non-empty source-bound U0 and Reader observations', () => {
  const terminal = classifyTerminalOutcome({
    inputChanged: false,
    layout: { status: 'EXTRACTED' },
    pageCoverage: {
      status: 'CONTENT_COVERAGE_PROVEN',
      pageCount: 4,
      ocrRequiredPageCount: 0,
      missingCoveragePageCount: 0,
    },
    classification: { canonicalDocumentFamily: 'FTD' },
    canonicalHost: { status: 'CANDIDATE_VERTICAL_VERIFIED' },
    sourceUnits: { count: 12, allHaveSourceRefs: true },
    sourceRefs: { count: 9 },
    u0: { status: 'FULL_STRICT_VALIDATOR_PASSED' },
    reader: {
      status: 'CANDIDATE_READBACK_VERIFIED',
      queryResultCount: 3,
    },
  });

  assert.equal(terminal.code, 'CANONICAL_READER_VERIFIED');
  assert.equal(terminal.status, 'SUCCESS');
});

test('successful subset is never labeled as full-corpus acceptance', () => {
  const records = [
    observation('one.pdf', {
      terminalCode: 'CANONICAL_READER_VERIFIED',
      terminalStatus: 'SUCCESS',
      category: 'boeing_ftd',
      sourceType: 'boeing_ftd',
      adapterId: 'issuer.boeing.ftd.v1',
      profile: 'boeing.ftd.v1',
      failureCode: null,
    }),
  ];

  const summary = summarizeRecords(records, {
    selectedCount: 1,
    selection: { totalFreshScannedPdfCount: 401, selectedCount: 1 },
  });

  assert.equal(summary.acceptance.scope, 'SELECTED_SCOPE_ONLY');
  assert.equal(summary.acceptance.status, 'SELECTED_SCOPE_ACCEPTED');
  assert.equal(summary.invariants.allFreshCorpusInputsSelected, false);
});

test('missing full-corpus records can never produce acceptance', () => {
  const records = [
    observation('one.pdf', {
      terminalCode: 'CANONICAL_READER_VERIFIED',
      terminalStatus: 'SUCCESS',
      category: 'boeing_ftd',
      sourceType: 'boeing_ftd',
      adapterId: 'issuer.boeing.ftd.v1',
      profile: 'boeing.ftd.v1',
      failureCode: null,
    }),
  ];

  const summary = summarizeRecords(records, {
    selectedCount: 2,
    selection: { totalFreshScannedPdfCount: 2, selectedCount: 2 },
  });

  assert.equal(summary.acceptance.scope, 'FULL_FRESH_CORPUS');
  assert.equal(summary.acceptance.status, 'FULL_CORPUS_NOT_ACCEPTED');
  assert.equal(summary.invariants.allSelectedInputsAccountedFor, false);
});

test('summary keeps content routing slices and failure codes separate', () => {
  const records = [
    observation('a.pdf', {
      terminalCode: 'UNSUPPORTED_PROFILE',
      category: 'airbus_ril',
      sourceType: 'airbus_retrofit_information_letter',
      adapterId: 'issuer.airbus.retrofit_information_letter.v1',
      profile: 'airbus.ril',
      failureCode: 'PDF_PRODUCER_PROFILE_NOT_AVAILABLE',
    }),
    observation('b.pdf', {
      terminalCode: 'CANONICAL_READER_VERIFIED',
      terminalStatus: 'SUCCESS',
      category: 'boeing_ftd',
      sourceType: 'boeing_ftd',
      adapterId: 'issuer.boeing.ftd.v1',
      profile: 'boeing.ftd.v1',
      failureCode: null,
    }),
  ];

  const summary = summarizeRecords(records, {
    selectedCount: 2,
    selection: { totalFreshScannedPdfCount: 2, selectedCount: 2 },
  });

  assert.equal(summary.acceptance.scope, 'FULL_FRESH_CORPUS');
  assert.equal(summary.acceptance.status, 'FULL_CORPUS_NOT_ACCEPTED');
  assert.equal(summary.invariants.allFreshCorpusInputsSelected, true);
  assert.equal(summary.counts.byDocumentCategory.airbus_ril, 1);
  assert.equal(summary.counts.byContentProfile['airbus.ril'], 1);
  assert.equal(
    summary.counts.byFailureCode.PDF_PRODUCER_PROFILE_NOT_AVAILABLE,
    1,
  );
  assert.equal(summary.counts.byRoutingSlice['CATEGORY:airbus_ril'], 1);
  assert.equal(summary.invariants.silentFallbackCount, 0);
});

function observation(relativePath, options) {
  return {
    schemaVersion: 'wiselink.canonical_pdf_corpus_observation.v1',
    input: {
      relativePath,
      byteLength: 10,
      sha256: relativePath.padEnd(64, '0').slice(0, 64),
    },
    classification: { canonicalDocumentFamily: 'SB' },
    contentRecognition: {
      documentCategory: options.category,
      sourceType: options.sourceType,
      adapterId: options.adapterId,
      parseProfileRef: options.profile,
    },
    profile: { selectionStatus: 'UNAVAILABLE' },
    layout: { pageCount: 1 },
    canonicalHost: {
      status:
        options.terminalStatus === 'SUCCESS'
          ? 'CANDIDATE_VERTICAL_VERIFIED'
          : 'FAILED',
      causeCode: options.failureCode,
      failureCode: options.failureCode,
    },
    terminal: {
      status: options.terminalStatus ?? 'FAILURE',
      code: options.terminalCode,
      silentFallback: false,
      silentEmpty: false,
    },
  };
}
