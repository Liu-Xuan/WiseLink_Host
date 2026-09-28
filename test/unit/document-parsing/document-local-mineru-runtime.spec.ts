import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readLocalMineruCandidate } from '../../../server/modules/document-management/src/hosted/nest/document-mineru-local-candidate';
import { UnifiedReaderService } from '../../../server/modules/unified-reader/unified-reader.service';
import { buildDocumentSemanticMap, assertDocumentSemanticMap, semanticTranslationSource } from '../../../server/modules/document-management/src/hosted/nest/document-semantic-map';
import { documentOriginalReadingCoverage, documentOriginalRangeReadingImpact } from '../../../server/modules/document-management/src/hosted/nest/document-original-adapter';
import { BOEING_FTD_SEMANTIC_PROFILE } from '../../../server/modules/document-management/src/hosted/nest/document-semantic-profile';
import { openDocumentPdfSession } from '../../../server/modules/document-management/src/hosted/nest/document-original-pdf';
jest.mock('../../../server/modules/document-management/src/hosted/nest/document-original-pdf', () => ({ openDocumentPdfSession: jest.fn() }));
import { DocumentParsingHostedService } from '../../../server/modules/document-management/src/hosted/nest/document-parsing-hosted.service';
import { OrdinaryDocumentManagementAuthorizer } from '../../../server/modules/document-management-runtime/ordinary-document-management-authorizer';
import { DocumentWorkRuntimeService } from '../../../server/modules/canonical-host/document-work-runtime.service';
import type { DocumentParseRow, DocumentParseScope } from '../../../server/modules/document-management/src/hosted/nest/document-parsing.repository';
import type { DocumentParseSourceBinding } from '../../../server/database/document-parsing.schema';
import type { DocumentOriginalArtifact } from '../../../shared/document-original.interface';

const browser = { actorUserId: 'runtime-owner', tenantId: 'runtime-tenant', roles: [], appId: 'app_17bzc551rsg', env: 'runtime' };
const candidatePath = '1876604059672731.json';
const request = { requestId: 'local-runtime-admission', expectedPublishedRevision: 0, mode: 'LOCAL_MINERU_IMPORT',
  selection: { bucketId: 'bucket', filePath: `/${candidatePath}` } };
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const priorEnv = { SANDBOX_ID: process.env.SANDBOX_ID, MIAODA_LOCAL_DEV: process.env.MIAODA_LOCAL_DEV };
beforeEach(() => { process.env.SANDBOX_ID = 'isolated-document-local-runtime-test'; delete process.env.MIAODA_LOCAL_DEV; });
afterEach(() => {
  jest.restoreAllMocks();
  for (const [key, value] of Object.entries(priorEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function fixture(sample?: { pdf: Buffer; candidate: Buffer }) {
  const pdf = sample?.pdf ?? Buffer.from('%PDF-isolated-25-page-fixture');
  const binding = { documentVersionId: 'DV', documentId: 'DOC', familyId: 'FAM', sourceArtifactId: 'ART', pdfSha256: digest(pdf), byteLength: pdf.length };
  const pageText = (index: number) => `Exact original text for page ${index + 1}.`;
  const pageIndexes = Array.from({ length: 25 }, (_, index) => index);
  const candidate = sample?.candidate ?? Buffer.from(JSON.stringify({ schemaVersion: 'wiselink.mineru.local-candidate.v1',
    source: { sha256: binding.pdfSha256, byteLength: pdf.length }, parser: { version: '3.4.5', backend: 'pipeline' },
    raw: { markdown: pageIndexes.map(pageText).join('\n\n'),
      middle: { _version_name: '3.4.5', _backend: 'pipeline', pdf_info: pageIndexes.map(page_idx => ({ page_idx, page_size: [600, 800] })) },
      contentListV2: pageIndexes.map(index => [{ type: 'paragraph', bbox: [0, 0, 200, 100],
        content: { paragraph_content: [{ type: 'text', content: pageText(index) }] } }]) }, assets: [] }));
  const content = new Map<string, { bytes: Uint8Array; mediaType: string; owner: string }>([
    [candidatePath, { bytes: candidate, mediaType: 'application/json', owner: browser.actorUserId }],
    ['source.pdf', { bytes: pdf, mediaType: 'application/pdf', owner: browser.actorUserId }],
  ]);
  const normalize = (path: string) => path.replace(/^\/+/, '');
  const metadata = (path: string) => {
    const normalized = normalize(path); const entry = content.get(normalized)!;
    return { id: `object:${normalized}`, name: normalized.split('/').at(-1)!, bucketID: 'bucket', filePath: `/${normalized}`,
      createdBy: { userID: entry.owner }, metadata: { contentLength: entry.bytes.length, mimeType: entry.mediaType } };
  };
  const scoped = {
    getFileMetadata: jest.fn(async (path: string) => content.has(normalize(path)) ? metadata(path) : null),
    download: jest.fn(async (path: string) => ({ metadata: metadata(path), content: new Blob([Buffer.from(content.get(normalize(path))!.bytes)]) })),
    upload: jest.fn(async (bytes: Uint8Array, options: { filePath: string; contentType: string }) => {
      const path = normalize(options.filePath); if (content.has(path)) throw new Error('UNEXPECTED_OVERWRITE');
      content.set(path, { bytes: new Uint8Array(bytes), mediaType: options.contentType, owner: browser.actorUserId }); return metadata(path);
    }),
  };
  const files = { getDefaultBucket: jest.fn(async () => 'bucket'), from: jest.fn(() => scoped) };
  const run: DocumentParseRow = { id: '00000000-0000-4000-8000-000000000001', parseRunId: 'PRUN-00000000-0000-4000-8000-000000000002',
    documentVersionId: 'DV', tenantId: browser.tenantId, actorUserId: browser.actorUserId, requestId: request.requestId,
    parseRevision: 1, expectedPublishedRevision: 0, status: 'RUNNING', bucketId: 'bucket', sourceBinding: binding,
    artifactProgress: [], pendingObject: null, manifestArtifact: null, errorCode: null, errorMessage: null,
    startedAt: new Date(), deadlineAt: new Date(Date.now() + 40 * 60_000), completedAt: null,
    leaseOwner: null, leaseToken: null, leaseGeneration: 0, leaseExpiresAt: null, cancelRequestedAt: null };
  let admitted = false;
  const repository = {
    read: jest.fn(async (_scope: DocumentParseScope, id: string) => admitted && id === run.parseRunId ? structuredClone(run) : null),
    readRequest: jest.fn(async (_scope: DocumentParseScope, id: string) => admitted && id === run.requestId ? structuredClone(run) : null),
    current: jest.fn(async () => ({ latest: admitted ? structuredClone(run) : null, published: run.status === 'PUBLISHED' ? structuredClone(run) : null })),
    reserve: jest.fn(async (_scope: DocumentParseScope, input: { sourceBinding: DocumentParseSourceBinding }) => {
      admitted = true; run.sourceBinding = structuredClone(input.sourceBinding); return { row: structuredClone(run), created: true };
    }),
    stage: jest.fn(async () => { run.status = 'STAGING'; }),
    progress: jest.fn(async (_scope: DocumentParseScope, _id: string, artifacts: DocumentOriginalArtifact[]) => { run.artifactProgress = structuredClone(artifacts); }),
    publish: jest.fn(async (_scope: DocumentParseScope, _id: string, artifact: DocumentOriginalArtifact) => {
      run.status = 'PUBLISHED'; run.manifestArtifact = structuredClone(artifact); run.completedAt = new Date();
    }),
    recordStepFailure: jest.fn(async (_scope: unknown, _fence: unknown, code: string) => { run.errorCode = code; }),
    assertLocalWorkerScope: jest.fn(async () => undefined),
    recordLocalWorkerCandidate: jest.fn(async () => undefined),
    fail: jest.fn(async (_scope: unknown, _id: string, input: { errorCode: string }) => {
      run.status = 'FAILED'; run.errorCode = input.errorCode; run.completedAt = new Date();
    }),
  };
  const workItems = { loadTenantDocumentAuthorizationBinding: jest.fn(async () => ({ documentVersionId: 'DV' })) };
  const source = { version: { ...binding, originalFilename: 'source.pdf', businessRevision: '1', revisionDate: '2026-09-26', sourceGeneratedDate: '2026-09-26' },
    family: { familyId: 'FAM', canonicalDocumentNumber: 'TEST', documentFamily: 'AMM', issuerAuthority: 'TEST', currentDocumentVersionId: 'DV' },
    source: { sourceArtifactId: 'ART', bucketId: 'bucket', filePath: '/source.pdf', sha256: binding.pdfSha256, byteLength: pdf.length,
      providerObjectId: 'object:source.pdf', providerVersionId: 'object:source.pdf' } };
  const catalog = { readMetadataSource: jest.fn(async () => source), readOwnedAcquisitionVersionBinding: jest.fn(async () => null) };
  const authorizer = new OrdinaryDocumentManagementAuthorizer(workItems as never, files as never, catalog as never, repository as never);
  const plugins = { configured: jest.fn(() => false), parseOriginal: jest.fn() };
  const leases = { claim: jest.fn(async () => ({ parseRunId: run.parseRunId, leaseOwner: 'worker', leaseToken: 'token', leaseGeneration: 1 })),
    check: jest.fn(async () => undefined), renew: jest.fn(async () => true), release: jest.fn(async () => undefined) };
  const extract = jest.fn(async ({ pageStart, pageCount }: { pageStart: number; pageCount: number }) => ({ pageCount: 25,
    pages: pageIndexes.slice(pageStart, pageStart + pageCount).map(pageIndex => ({ pageIndex, text: pageText(pageIndex), width: 600, height: 800,
      rotation: 0, imagePaintOperations: 0, items: [{ text: pageText(pageIndex), transform: [10, 0, 0, 10, 10, 770], width: 180, height: 10, hasEOL: true }] })) }));
  jest.mocked(openDocumentPdfSession).mockImplementation(async ({ assertActive }) => { await assertActive(); return { extract, destroy: jest.fn(async () => undefined) }; });
  if (sample) {
    const actualPdf = jest.requireActual<typeof import('../../../server/modules/document-management/src/hosted/nest/document-original-pdf')>(
      '../../../server/modules/document-management/src/hosted/nest/document-original-pdf');
    jest.mocked(openDocumentPdfSession).mockImplementation(actualPdf.openDocumentPdfSession);
  }
  const settings = { capture: jest.fn(async () => ({ revision: 1, localMineruFallbackEnabled: true, titleEnhancementEnabled: false })) };
  const service = new DocumentParsingHostedService(files as never, catalog as never, repository as never, plugins as never, leases as never, authorizer, settings as never);
  const authorizeDocumentWork = jest.fn(async () => ({ tenantId: browser.tenantId, actorUserId: browser.actorUserId, documentVersionId: 'DV' }));
  const authorization = { authorizeDocumentWork, authorizeOpenClawWorkItem: jest.fn(async () => ({ workItemId: 'WI', appId: browser.appId,
    tenantId: browser.tenantId, principalId: 'worker', automaticWorkItemLease: { actorUserId: browser.actorUserId, documentVersionId: 'DV', requestId: 'AUTO',
      documentId: 'DOC', sourceArtifactId: 'ART', sourceFileSha256: binding.pdfSha256, sourceByteLength: pdf.length, leaseGeneration: 1 } })) };
  const runtime = new DocumentWorkRuntimeService(authorization as never,
    { withActorScope: async (_actor: string, callback: () => Promise<unknown>) => callback() } as never,
    service, leases as never, {} as never, {} as never, {} as never, {} as never,
    { readDocumentDeliveryIntents: async () => [] } as never,
    { readDocumentUploadDeliveryIntents: async () => [] } as never,
    { run: async () => null } as never, { run: async () => null } as never);
  return { service, runtime, run, repository, content, scoped, extract, plugins, leases, workItems, authorizeDocumentWork };
}

it.each(['STEP', 'AUTOMATIC'])('publishes 25 pages from numeric JSON through real browser admission and backend %s', async action => {
  const f = fixture();
  expect(await f.service.start('DV', request, browser)).toMatchObject({ status: 'STAGING' });
  expect(f.extract.mock.calls.map(([input]) => input.pageStart)).toEqual([0, 8]);
  const result = action === 'STEP' ? await f.runtime.run({ action: 'STEP', documentVersionId: 'DV', parseRunId: f.run.parseRunId })
    : await f.runtime.prepareAutomaticOriginal('WI');
  expect(result).toMatchObject({ status: action === 'STEP' ? 'PUBLISHED' : 'ORIGINAL_READY', parseRunId: f.run.parseRunId });
  expect(f.extract.mock.calls.map(([input]) => input.pageStart)).toEqual([0, 8, 16, 24]);
  expect(f.repository.publish).toHaveBeenCalledTimes(1);
  expect(f.plugins.parseOriginal).not.toHaveBeenCalled();
  const backgroundScope = f.repository.publish.mock.calls[0][0];
  expect(backgroundScope).not.toHaveProperty('appId'); expect(backgroundScope).not.toHaveProperty('env');
  const reading = await f.service.read('DV', f.run.parseRunId, { actorUserId: browser.actorUserId, tenantId: browser.tenantId, roles: [] });
  expect(reading.original?.producer.kind).toBe('MINERU_LOCAL_PDFJS');
  expect(reading.original?.coverage.knownPageCount).toBe(25);
  expect(new Set(reading.original?.coverage.readPageIndexes).size).toBe(25);
});

it('ends a local worker run after the one bounded retry also loses its storage upload', async () => {
  const f = fixture();
  await f.service.start('DV', request, browser);
  f.run.sourceBinding.parserInput = { mode: 'LOCAL_MINERU_WORKER',
    settings: { revision: 1, localMineruFallbackEnabled: true, titleEnhancementEnabled: false } };
  f.run.errorCode = 'DOCUMENT_PARSE_FAILED';
  f.content.set(`wiselink/parsed/DV/${f.run.parseRunId}/raw/mineru-candidate.json`,
    { ...f.content.get(candidatePath)! });
  for (const path of f.content.keys()) if (/\/original\/pages-[0-9]+[.]json$/u.test(path)) f.content.delete(path);
  f.run.artifactProgress = f.run.artifactProgress.filter(item => !/^original\/pages-[0-9]+[.]json$/u.test(item.relativePath));
  const upload = f.scoped.upload.getMockImplementation()!;
  f.scoped.upload.mockImplementation(async (bytes, options) => {
    if (options.filePath.endsWith('/original/pages-0.json')) throw new Error('fetch failed');
    return upload(bytes, options);
  });
  await expect(f.service.executeStep(f.run.parseRunId, {
    tenantId: browser.tenantId, actorUserId: browser.actorUserId, documentVersionId: 'DV', roles: [],
  }, { parseRunId: f.run.parseRunId, leaseOwner: 'worker', leaseToken: 'token', leaseGeneration: 1 }))
    .rejects.toThrow('fetch failed');
  expect(f.repository.fail).toHaveBeenCalledWith(expect.any(Object), f.run.parseRunId,
    { errorCode: 'DOCUMENT_PARSE_FAILED' }, expect.any(Object));
  expect(f.run.status).toBe('FAILED');
  expect(f.repository.publish).not.toHaveBeenCalled();
});

it.each(['owner', 'hash', 'actor', 'source', 'lease'])('refuses backend continuation after %s changes', async boundary => {
  const f = fixture(); await f.service.start('DV', request, browser);
  const priorUploads = f.scoped.upload.mock.calls.length;
  if (boundary === 'owner') f.content.get(candidatePath)!.owner = 'another-owner';
  if (boundary === 'hash') {
    const changed = Buffer.from(f.content.get(candidatePath)!.bytes);
    changed[changed.indexOf('Exact')] = 'Z'.charCodeAt(0);
    f.content.get(candidatePath)!.bytes = changed;
  }
  if (boundary === 'actor') f.authorizeDocumentWork.mockResolvedValue({ tenantId: browser.tenantId, actorUserId: 'another-owner', documentVersionId: 'DV' });
  if (boundary === 'source') f.workItems.loadTenantDocumentAuthorizationBinding.mockResolvedValue(null as never);
  if (boundary === 'lease') f.leases.check.mockRejectedValue(new Error('DOCUMENT_STEP_LEASE_REJECTED'));
  const rejected = expect(f.runtime.run({ action: 'STEP', documentVersionId: 'DV', parseRunId: f.run.parseRunId })).rejects;
  if (boundary === 'lease') await rejected.toThrow('DOCUMENT_STEP_LEASE_REJECTED');
  else await rejected.toMatchObject({ code: boundary === 'hash' ? 'DOCUMENT_MINERU_CANDIDATE_CHANGED'
    : boundary === 'source' ? 'DOCUMENT_VERSION_NOT_FOUND'
      : boundary === 'actor' ? 'DOCUMENT_PARSE_NOT_FOUND' : 'DOCUMENT_ACTION_FORBIDDEN' });
  expect(f.repository.publish).not.toHaveBeenCalled();
  expect(f.scoped.upload).toHaveBeenCalledTimes(priorUploads);
  expect(f.extract.mock.calls.map(([input]) => input.pageStart)).toEqual([0, 8]);
});

it('requires real browser provenance for a new local admission', async () => {
  const f = fixture();
  await expect(f.service.start('DV', request, { actorUserId: browser.actorUserId, tenantId: browser.tenantId, roles: [] }))
    .rejects.toMatchObject({ code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE' });
  expect(f.repository.reserve).not.toHaveBeenCalled(); expect(f.scoped.download).not.toHaveBeenCalled();
});


// Opt-in local compatibility evidence only. Paths and business bytes stay outside the repository.
const realPdfPath = process.env.WL_LOCAL_MINERU_TEST_PDF;
const realCandidatePath = process.env.WL_LOCAL_MINERU_TEST_CANDIDATE;
(realPdfPath || realCandidatePath ? it : it.skip)('reads an existing Boeing FTD sample through PDF.js, Host storage and semantic translation input', async () => {
  if (!realPdfPath || !realCandidatePath) throw new Error('REAL_LOCAL_MINERU_REQUIRES_PDF_AND_CANDIDATE');
  const [pdf, candidate] = await Promise.all([readFile(realPdfPath), readFile(realCandidatePath)]);
  const parsed = readLocalMineruCandidate(candidate);
  expect(parsed.sourceSha256).toBe(digest(pdf));
  expect(parsed.sourceByteLength).toBe(pdf.length);
  const f = fixture({ pdf, candidate });
  let state = await f.service.start('DV', request, browser);
  // Each tick remains bounded; a real document need not have the synthetic fixture's 25 pages.
  for (let tick = 0; state.status !== 'PUBLISHED' && tick < 100; tick++) {
    await f.runtime.run({ action: 'STEP', documentVersionId: 'DV', parseRunId: f.run.parseRunId });
    state = (await f.service.status('DV', browser)).latestRun!;
  }
  expect(state.status).toBe('PUBLISHED');
  expect(f.extract).not.toHaveBeenCalled();
  expect(f.plugins.parseOriginal).not.toHaveBeenCalled();
  const context = { actorUserId: browser.actorUserId, tenantId: browser.tenantId, roles: [] };
  const reading = await f.service.read('DV', f.run.parseRunId, context);
  const reader = new UnifiedReaderService({} as never, {} as never, {} as never, {} as never, f.service);
  const loaded = await reader.readDocumentOriginal('DV', f.run.parseRunId, context);
  expect(loaded.original.binding.sourceSha256).toBe(digest(pdf));
  expect(loaded.original.producer.kind).toBe('MINERU_LOCAL_PDFJS');
  const rawSaved = f.content.get(`wiselink/parsed/DV/${f.run.parseRunId}/raw/mineru-candidate.json`)!;
  expect(Buffer.from(rawSaved.bytes)).toEqual(candidate);
  const pages = [...f.content].filter(([path]) => /original\/pages-[0-9]+[.]json$/u.test(path))
    .flatMap(([, item]) => (JSON.parse(Buffer.from(item.bytes).toString('utf8')) as { pages: Array<{ pageIndex: number }> }).pages);
  expect(pages.length).toBeGreaterThan(0);
  expect(new Set(pages.map(page => page.pageIndex)).size).toBe(pages.length);
  expect(reading.original?.coverage.knownPageCount).toBe(pages.length);
  expect(reading.original?.coverage.readPageIndexes).toEqual(pages.map(page => page.pageIndex));
  const map = buildDocumentSemanticMap({ original: loaded.original, semanticRevision: 1, profile: BOEING_FTD_SEMANTIC_PROFILE });
  expect(() => assertDocumentSemanticMap(map, loaded.original)).not.toThrow();
  const translation = semanticTranslationSource(loaded.original, map);
  expect(translation.units.length).toBeGreaterThan(0);
  expect(translation.units.map(unit => unit.unitId)).toEqual(loaded.structuredSource.units.map(unit => unit.unitId));
  expect(translation.sourceLocators).toEqual(loaded.structuredSource.sourceLocators);
  expect(translation.dateOrder).toBe('MDY');
  expect(map.sections.length).toBeGreaterThan(0);
  const engineeringCoverage = documentOriginalReadingCoverage(loaded.original);
  expect(reading.original!.coverage).toEqual(engineeringCoverage);
  expect(engineeringCoverage.unresolvedRanges.every(range => documentOriginalRangeReadingImpact(loaded.original, range) === 'LIMITATION')).toBe(true);
  const engineeringLimitationCounts: Record<string, number> = {};
  const rawRangeImpactCounts: Record<string, number> = {};
  for (const range of engineeringCoverage.unresolvedRanges) engineeringLimitationCounts[range.reason] = (engineeringLimitationCounts[range.reason] ?? 0) + 1;
  for (const range of loaded.original.coverage.unresolvedRanges) {
    const key = `${range.reason}:${documentOriginalRangeReadingImpact(loaded.original, range)}`;
    rawRangeImpactCounts[key] = (rawRangeImpactCounts[key] ?? 0) + 1;
  }
  const engineeringRangeMetadata = engineeringCoverage.unresolvedRanges.map(range => ({ reason: range.reason,
    impact: documentOriginalRangeReadingImpact(loaded.original, range), pageIndexes: range.pageIndexes,
    unitKinds: range.unitIds.map(id => loaded.original.source.units.find(unit => unit.unitId === id)?.kind ?? 'missing'),
    origin: range.message.startsWith('PDF 文本层') ? 'PDF_GEOMETRY_UNCERTAIN'
      : range.message.startsWith('MinerU 范围外') ? 'OUTSIDE_MINERU_REGION'
        : range.reason === 'TEXT_CONFLICT' ? 'TEXT_CONFLICT' : 'OTHER_STRUCTURE' }));
  process.stdout.write(JSON.stringify({ evidence: 'LOCAL_BOEING_FTD_COMPATIBILITY_NOT_PRODUCTION',
    producer: loaded.original.producer.kind, parser: reading.parser, pageCount: pages.length,
    sourceUnitCount: loaded.structuredSource.units.length, semanticSectionCount: map.sections.length,
    semanticRoles: map.sections.map(section => section.roleKey), translationUnitCount: translation.units.length,
    rawRangeImpactCounts, engineeringLimitationCounts, engineeringRangeMetadata, assetCount: parsed.assets.length }) + '\n');
}, 60_000);
