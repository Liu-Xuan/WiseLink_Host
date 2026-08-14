import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const importBuilt = (relativePath) =>
  import(pathToFileURL(resolve(root, 'dist/server', relativePath)));

class LocalFileService {
  constructor(defaultBucketId) {
    this.defaultBucketId = defaultBucketId;
    this.values = new Map();
    this.uploadCalls = [];
  }

  async getDefaultBucket() {
    return this.defaultBucketId;
  }

  from(bucketId) {
    const self = this;
    const key = (filePath) => `${bucketId}:${canonicalPath(filePath)}`;
    return {
      async getFileMetadata(filePath) {
        const value = self.values.get(key(filePath));
        return value ? structuredClone(value.metadata) : null;
      },
      async upload(bytes, options) {
        const storageKey = key(options.filePath);
        if (self.values.has(storageKey) && options.upsert !== true) {
          throw new Error('LOCAL_FILESERVICE_OBJECT_EXISTS');
        }
        const value = {
          bytes: Uint8Array.from(bytes),
          metadata: metadataFor(
            bucketId,
            options.filePath,
            options.fileName,
            options.contentType,
            bytes.byteLength,
          ),
        };
        self.values.set(storageKey, value);
        self.uploadCalls.push({ bucketId, options: structuredClone(options) });
        return { filePath: options.filePath };
      },
      async download(filePath) {
        const value = self.values.get(key(filePath));
        if (!value) throw new Error('LOCAL_FILESERVICE_OBJECT_NOT_FOUND');
        return {
          content: Uint8Array.from(value.bytes),
          metadata: structuredClone(value.metadata),
        };
      },
    };
  }

  seed({ bucketId, filePath, bytes, fileName, contentType }) {
    this.values.set(`${bucketId}:${canonicalPath(filePath)}`, {
      bytes: Uint8Array.from(bytes),
      metadata: metadataFor(
        bucketId,
        filePath,
        fileName,
        contentType,
        bytes.byteLength,
      ),
    });
  }
}

class LocalRegistrar {
  projection = null;

  async loadOrCreate(seed) {
    if (!this.projection) this.projection = { ...structuredClone(seed), revision: 1 };
    return structuredClone(this.projection);
  }

  async compareAndSet({ workItemId, expectedRevision, next }) {
    assert.equal(this.projection?.workItemId, workItemId);
    assert.equal(this.projection?.revision, expectedRevision);
    this.projection = { ...structuredClone(next), revision: expectedRevision + 1 };
    return structuredClone(this.projection);
  }

  async getExact({ workItemId, requestId, documentVersionId }) {
    assert.equal(this.projection?.workItemId, workItemId);
    assert.equal(this.projection?.requestId, requestId);
    assert.equal(this.projection?.source.documentVersionId, documentVersionId);
    return structuredClone(this.projection);
  }

  async getByWorkItemId(workItemId) {
    assert.equal(this.projection?.workItemId, workItemId);
    return structuredClone(this.projection);
  }
}

class LocalWorkItemRepository {
  parseReservation = null;
  assessmentActions = new Map();

  async reserve(input) {
    if (!this.parseReservation) {
      this.parseReservation = {
        workItemId: 'WI-LOCAL-737-34-3830-ASSESSMENT',
        requestId: 'REQ-LOCAL-737-34-3830-ASSESSMENT',
        attemptId: 'ATT-LOCAL-737-34-3830-PARSE',
        identity: structuredClone(input),
      };
      return { ...this.parseReservation, created: true };
    }
    assert.deepEqual(input, this.parseReservation.identity);
    return { ...this.parseReservation, created: false };
  }

  async reserveAssessmentAction(input) {
    const key = `${input.actionType}:${input.attemptNo}`;
    const existing = this.assessmentActions.get(key);
    if (existing) return { attemptId: existing.attemptId, created: false };
    const value = {
      ...structuredClone(input),
      attemptId: `ATT-LOCAL-${input.actionType}-${input.attemptNo}`,
      status: 'RUNNING',
    };
    this.assessmentActions.set(key, value);
    return { attemptId: value.attemptId, created: true };
  }

  async completeAssessmentAction(attemptId) {
    const value = [...this.assessmentActions.values()].find(
      (candidate) => candidate.attemptId === attemptId,
    );
    assert.ok(value);
    assert.equal(value.status, 'RUNNING');
    value.status = 'SUCCEEDED';
  }

  async failAssessmentAction({ attemptId, errorCode, errorMessage }) {
    const value = [...this.assessmentActions.values()].find(
      (candidate) => candidate.attemptId === attemptId,
    );
    assert.ok(value);
    value.status = 'FAILED';
    value.errorCode = errorCode;
    value.errorMessage = errorMessage;
  }
}

const [
  { PHASE5_737_34_3830_HANDOFF },
  { ExactFtdFrozen2PdfProducerAdapter },
  { OrdinaryCanonicalAuthorizationAdapter, OrdinaryCanonicalPermissionSnapshotAdapter },
  { OrdinaryMiaodaAppBindingAdapter },
  { CanonicalEntryFacadeService },
  { CanonicalHostVerticalService },
  { CanonicalHostAssessmentService },
  { OrdinaryWorkItemService },
  { MiaodaOrdinaryArtifactStoreAdapter },
  { Frozen2CandidateReaderService },
  { PythonU0FullPackageValidatorAdapter },
  { U0FullValidationService },
  { UnifiedReaderService },
  { AssessmentHostConsumerService },
  { buildJobAidCriterionSetVersion },
] = await Promise.all([
  importBuilt('modules/document-management/src/hosted/phase5BoeingSbHandoff.js'),
  importBuilt('modules/canonical-host/exact-ftd-frozen2-pdf-producer.adapter.js'),
  importBuilt('modules/canonical-host/ordinary-canonical-authorization.adapter.js'),
  importBuilt('modules/canonical-host/ordinary-miaoda-app-binding.adapter.js'),
  importBuilt('modules/canonical-host/canonical-entry-facade.service.js'),
  importBuilt('modules/canonical-host/canonical-host-vertical.service.js'),
  importBuilt('modules/canonical-host/canonical-host-assessment.service.js'),
  importBuilt('modules/work-item/ordinary-work-item.service.js'),
  importBuilt('modules/unified-reader/miaoda-ordinary-artifact-store.adapter.js'),
  importBuilt('modules/unified-reader/frozen2-candidate-reader.service.js'),
  importBuilt('modules/unified-reader/python-u0-full-package-validator.adapter.js'),
  importBuilt('modules/unified-reader/u0-full-validation.service.js'),
  importBuilt('modules/unified-reader/unified-reader.service.js'),
  importBuilt('modules/assessment-workbench/assessment-host-consumer.service.js'),
  importBuilt('modules/assessment-workbench/job-aid-runtime/criterionSet.js'),
]);

const sourcePath = resolve(
  root,
  '../../../../Docs/uploads/SB/机身/BOEING/2026/202605/737-34-3830 Original.pdf',
);
const sourceBytes = await readFile(sourcePath);
assert.equal(sourceBytes.byteLength, PHASE5_737_34_3830_HANDOFF.source.byteLength);
assert.equal(sha256(sourceBytes), PHASE5_737_34_3830_HANDOFF.source.sha256);

const fileService = new LocalFileService('local-phase5-bucket');
const sourceSelection = {
  bucketId: 'local-phase5-bucket',
  filePath: '/selection/737-34-3830-original.pdf',
};
fileService.seed({
  ...sourceSelection,
  bytes: sourceBytes,
  fileName: '737-34-3830 Original.pdf',
  contentType: 'application/pdf',
});
const sourceMetadata = await fileService
  .from(sourceSelection.bucketId)
  .getFileMetadata(sourceSelection.filePath);
assert.ok(sourceMetadata?.id);

let ingestCalls = 0;
const documentManagement = {
  async ingestFileServiceSelection(request, context) {
    ingestCalls += 1;
    assert.equal(context.actorUserId, 'local-assessment-engineer');
    assert.equal(request.descriptor.documentCode, '737-34-3830');
    assert.equal(request.descriptor.documentFamily, 'SB');
    assert.equal(request.descriptor.revisionDate, '2026-05-13');
    assert.equal(request.sourceRef.endsWith(`:${sourceMetadata.id}`), true);
    assert.equal(request.sourceRef.includes('GbmQbpK83ohkMCxYWlccTPLOnxc'), false);
    return {
      documentVersionId:
        PHASE5_737_34_3830_HANDOFF.catalogIdentity.documentVersionId,
    };
  },
};
const resolved = {
  version: {
    documentId: PHASE5_737_34_3830_HANDOFF.catalogIdentity.documentId,
    documentVersionId:
      PHASE5_737_34_3830_HANDOFF.catalogIdentity.documentVersionId,
    sourceArtifactId: 'source_artifact_phase5_local_actual_bytes',
    pdfSha256: PHASE5_737_34_3830_HANDOFF.source.sha256,
    byteLength: PHASE5_737_34_3830_HANDOFF.source.byteLength,
  },
  family: {
    documentFamily: 'SB',
  },
  artifact: {
    bucketId: sourceSelection.bucketId,
    filePath: sourceSelection.filePath,
    providerObjectId: sourceMetadata.id,
    providerVersionId: sourceMetadata.id,
  },
};
const resolver = {
  async resolve(documentVersionId) {
    assert.equal(
      documentVersionId,
      PHASE5_737_34_3830_HANDOFF.catalogIdentity.documentVersionId,
    );
    return structuredClone(resolved);
  },
};

const validator = new U0FullValidationService(
  new PythonU0FullPackageValidatorAdapter({
    pythonExecutable: process.env.WL_LOCAL_U0_PYTHON || 'python3',
    contractRoot: resolve(
      root,
      'dist/server/runtime-assets/technical-publication-parsed-package/v1-frozen-2',
    ),
    contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
    validatorRevision: 'canonical-host-phase5-local-real',
  }),
);
const artifactStore = new MiaodaOrdinaryArtifactStoreAdapter(fileService);
const reader = new UnifiedReaderService(
  artifactStore,
  new Frozen2CandidateReaderService(),
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
const registrar = new LocalRegistrar();
const repository = new LocalWorkItemRepository();
const authorization = new OrdinaryCanonicalAuthorizationAdapter();
const permissionSnapshots = new OrdinaryCanonicalPermissionSnapshotAdapter();
const entry = new CanonicalEntryFacadeService(new OrdinaryMiaodaAppBindingAdapter());
const producer = new ExactFtdFrozen2PdfProducerAdapter(
  fileService,
  resolver,
  validator,
);
const vertical = new CanonicalHostVerticalService(
  registrar,
  producer,
  authorization,
  permissionSnapshots,
  artifactStore,
  reader,
  entry,
  {
    record: async ({ error }) => {
      process.stderr.write(
        `PHASE5_VERTICAL_CAUSE:${error instanceof Error ? error.stack : String(error)}\n`,
      );
      throw error;
    },
  },
);
const workItems = new OrdinaryWorkItemService(
  documentManagement,
  resolver,
  repository,
  vertical,
  fileService,
);
const actor = {
  userId: 'local-assessment-engineer',
  tenantId: 'local-assessment-tenant',
  appId: 'app_17bzc551rsg',
  roles: ['authenticated', 'DOCUMENT_INGEST', 'ASSESSMENT_CANDIDATE'],
  env: 'local',
};
const parsed = await workItems.parsePdf(
  { selection: sourceSelection, query: 'applicability' },
  actor,
);
assert.equal(parsed.result.status, 'CANDIDATE_VERTICAL_VERIFIED');
assert.equal(parsed.result.workItem.source.documentVersionId,
  'document_version_f4813607b91ee1a20e754e2d');
assert.equal(parsed.result.workItem.package.packageId,
  PHASE5_737_34_3830_HANDOFF.parsedPackageImport.packageId);
assert.equal(parsed.result.workItem.package.artifact.byteLength, 273349);
assert.equal(parsed.result.workItem.package.artifact.sha256,
  PHASE5_737_34_3830_HANDOFF.parsedPackageImport.artifactSha256.replace(/^sha256:/u, ''));

const assessmentConsumer = new AssessmentHostConsumerService();
const assessment = new CanonicalHostAssessmentService(
  registrar,
  authorization,
  permissionSnapshots,
  artifactStore,
  reader,
  repository,
  assessmentConsumer,
);
const packageBytes = await artifactStore.readActualBytes(
  parsed.result.workItem.package.artifact,
);
const ruleBytes = await readFile(resolve(
  root,
  'dist/server/runtime-assets/assessment-host/job-aid/rule-pack-0.2.json',
));
const rulePack = JSON.parse(ruleBytes.toString('utf8'));
const ruleDigest = `sha256:${sha256(ruleBytes)}`;
const criterionSet = buildJobAidCriterionSetVersion({
  rulePack,
  artifactRef: 'feishu-drive://file/Q3eVb8SGFovADCxSdH6cWDKCnme',
  artifactDigest: ruleDigest,
  artifactVersion: '7672126854932728804',
  canonicalCriteriaHash:
    'sha256:29a085166e2f08391b6f057a9e6dbb881800bd087cef9c359ea3a6f93ebc03cd',
  sourceJobAidDocumentVersionStatus: 'VERSION_UNCONFIRMED',
  lifecycleStatus: 'ACTIVE',
});
assert.equal(criterionSet.criterionSetId, 'JACS-72D0484B6F1C17A38F671F46');
assert.equal(criterionSet.criteriaCount, 150);

const preview = assessmentConsumer.runCandidate({
  assessment: assessmentOptions(
    parsed.result.workItem,
    packageBytes,
    rulePack,
    ruleDigest,
    criterionSet,
  ),
});
const fast61 = await readFastReceipt('61', reader, artifactStore);
const fast62 = await readFastReceipt('62', reader, artifactStore);
const fast61Manifest = reviewedFastManifest(preview, fast61);
const fast62Manifest = reviewedFastManifest(preview, fast62);
const zeroResultDiscovery = {
  runtime: 'FEISHU_HOSTED_OPENCLAW',
  runtimeAppId: 'app_17c3zn24kv2',
  provider: 'BOEING',
  query: '777 FTD 31-21002 software',
  resultStatus: 'ZERO_RESULTS_FOR_TARGET_IDENTIFIER',
  observedAt: '2026-08-14T00:00:00.000Z',
  candidates: [],
  accessRestricted: false,
  truncated: false,
  partialOnly: true,
  excludedNonOemCandidateCount: 2,
  error: null,
};

const evaluated = await assessment.evaluateCandidate(
  {
    workItemId: parsed.result.workItem.workItemId,
    assessmentAsOf: '2026-08-13T00:00:00.000Z',
    generatedAt: '2026-08-13T00:00:00.000Z',
    externalDiscovery: zeroResultDiscovery,
    reviewedExternalManifest: fast61Manifest,
  },
  actor,
);
assert.equal(evaluated.assessment.criterionCount, 150);
assert.equal(evaluated.assessment.evaluationItemCount, 150);
assert.equal(evaluated.assessment.authorityLevel, 'candidate_only');
assert.equal(evaluated.assessment.blocksEngineeringClosure, true);
assert.equal(evaluated.assessment.externalDiscoveryStatus,
  'ZERO_RESULTS_FOR_TARGET_IDENTIFIER');
assert.equal(evaluated.assessment.externalDiscoveryIsEvidence, false);
assert.equal(evaluated.package.packageId, parsed.result.workItem.package.packageId);

const initialAssessmentBytes = await artifactStore.readActualBytes(
  evaluated.assessment.artifact,
);
const initialAssessment = JSON.parse(new TextDecoder().decode(initialAssessmentBytes));
const externalRevisionResynthesis =
  assessmentConsumer.resynthesizeAfterReviewedExternalChange(
    initialAssessment,
    fast62Manifest,
    zeroResultDiscovery,
  );
assert.equal(externalRevisionResynthesis.staleState.previousOverallStale, true);
assert.equal(externalRevisionResynthesis.staleState.reason, 'EXTERNAL_CONTEXT_STALE');
assert.equal(
  JSON.stringify(externalRevisionResynthesis.overall.transport).includes(
    fast62.documentVersionId,
  ),
  true,
);
assert.equal(
  JSON.stringify(externalRevisionResynthesis.overall.transport).includes(
    fast61.documentVersionId,
  ),
  false,
);

const criterionId = initialAssessment.evaluation.snapshot.items[0].criterionId;
const resynthesized = await assessment.resynthesizeAfterEngineerChange(
  {
    workItemId: evaluated.workItemId,
    expectedRevision: evaluated.revision,
    criterionId,
    review: {
      baseRecordId: 'LOCAL-ENGINEER-REVIEW-001',
      decision: 'confirmed_pass',
      comment: 'Local acceptance only; no engineering closure authority.',
      reviewingEngineerUserIds: [actor.userId],
      status: 'ENGINEER_CONFIRMED',
      updatedAt: '2026-08-13T01:00:00.000Z',
    },
    externalDiscovery: zeroResultDiscovery,
    reviewedExternalManifest: fast62Manifest,
  },
  actor,
);
assert.equal(resynthesized.assessment.status, 'CANDIDATE_ONLY_RESYNTHESIZED');
assert.equal(resynthesized.assessment.previousOverallStale, true);
assert.equal(resynthesized.assessment.staleReason, 'ENGINEER_ITEM_SET_CHANGED');
assert.equal(resynthesized.package.packageId, parsed.result.workItem.package.packageId);
assert.equal(repository.assessmentActions.size, 2);
assert.equal(repository.assessmentActions.get('EVALUATE_JOB_AID:1').status, 'SUCCEEDED');
assert.equal(
  repository.assessmentActions.get(`RESYNTHESIZE_ASSESSMENT:${evaluated.revision}`).status,
  'SUCCEEDED',
);

const secondCriterionId = initialAssessment.evaluation.snapshot.items[1].criterionId;
const secondResynthesis = await assessment.resynthesizeAfterEngineerChange(
  {
    workItemId: resynthesized.workItemId,
    expectedRevision: resynthesized.revision,
    criterionId: secondCriterionId,
    review: {
      baseRecordId: 'LOCAL-ENGINEER-REVIEW-002',
      decision: 'deferred',
      comment: 'Second explicit edit proves revision-scoped resynthesis.',
      reviewingEngineerUserIds: [actor.userId],
      status: 'NEEDS_REVIEW',
      updatedAt: '2026-08-13T02:00:00.000Z',
    },
    externalDiscovery: zeroResultDiscovery,
    reviewedExternalManifest: fast62Manifest,
  },
  actor,
);
assert.equal(secondResynthesis.revision, resynthesized.revision + 1);
assert.equal(repository.assessmentActions.size, 3);
assert.equal(
  repository.assessmentActions.get(
    `RESYNTHESIZE_ASSESSMENT:${resynthesized.revision}`,
  ).status,
  'SUCCEEDED',
);

const page = await vertical.page(
  { workItemId: secondResynthesis.workItemId, query: 'applicability' },
  actor,
);
const openApi = await vertical.openApiStatus(secondResynthesis.workItemId);
const deepLink = await vertical.openApiDeepLink(secondResynthesis.workItemId);
assert.equal(page.workItem.assessment.criterionCount, 150);
assert.equal(openApi.assessmentSummary.criterionCount, 150);
assert.equal(openApi.assessmentSummary.artifact.sha256,
  secondResynthesis.assessment.artifact.sha256);
assert.equal(deepLink.deepLink, page.entry.deepLinkPath);
assert.equal(ingestCalls, 1);
assert.equal(repository.parseReservation.workItemId, secondResynthesis.workItemId);
assert.equal(fileService.uploadCalls.length, 6);

process.stdout.write(`${JSON.stringify({
  status: 'ORDINARY_737_ASSESSMENT_LOOP_PASS',
  source: {
    filePath: sourcePath,
    byteLength: sourceBytes.byteLength,
    sha256: sha256(sourceBytes),
    providerObjectId: sourceMetadata.id,
  },
  documentVersionId: parsed.result.workItem.source.documentVersionId,
  workItemId: secondResynthesis.workItemId,
  package: {
    packageId: secondResynthesis.package.packageId,
    artifact: secondResynthesis.package.artifact,
    fullValidator: secondResynthesis.package.fullValidatorProof.status
      ?? 'FULL_STRICT_VALIDATOR_PASSED',
    readerQueryResultCount: page.queryResults.length,
  },
  assessment: {
    criterionSetId: secondResynthesis.assessment.criterionSetId,
    criterionCount: secondResynthesis.assessment.criterionCount,
    evaluationItemCount: secondResynthesis.assessment.evaluationItemCount,
    packageStatus: secondResynthesis.assessment.packageStatus,
    applicabilityOverall: secondResynthesis.assessment.applicabilityOverall,
    authorityLevel: secondResynthesis.assessment.authorityLevel,
    artifact: secondResynthesis.assessment.artifact,
    evaluateAttemptId: secondResynthesis.assessment.evaluateAttemptId,
    resynthesisAttemptId: secondResynthesis.assessment.resynthesisAttemptId,
  },
  external: {
    discoveryStatus: secondResynthesis.assessment.externalDiscoveryStatus,
    discoveryIsEvidence: secondResynthesis.assessment.externalDiscoveryIsEvidence,
    initialReviewedDocumentVersionId: fast61.documentVersionId,
    currentReviewedDocumentVersionId: fast62.documentVersionId,
    externalStaleReason: externalRevisionResynthesis.staleState.reason,
    finalEngineerStaleReason: secondResynthesis.assessment.staleReason,
    oldRevisionAbsentFromCurrentTransport: true,
  },
  page: {
    status: page.status,
    deepLink: page.entry.deepLinkPath,
    assessmentFreshRead: openApi.assessmentSummary.status,
  },
  actionAttempts: [...repository.assessmentActions.values()].map((value) => ({
    actionType: value.actionType,
    attemptId: value.attemptId,
    status: value.status,
  })),
  parserPackageColumnsUnchanged: true,
  onlineWrites: 0,
  releaseCreated: false,
}, null, 2)}\n`);

function assessmentOptions(workItem, artifactBytes, rulePack, ruleDigest, criterionSet) {
  return {
    workItemId: workItem.workItemId,
    documentVersionBinding: {
      documentId: workItem.source.documentId,
      documentVersionId: workItem.source.documentVersionId,
      artifactRecord: {
        $schema: 'urn:techpub:schema:v1:artifact-record:frozen-2',
        schemaVersion: 'techpub.artifact-record.v1',
        contractRevision: 'frozen.2',
        artifactRef: workItem.package.artifact.ref,
        mediaType: 'application/json',
        byteLength: workItem.package.artifact.byteLength,
        artifactHash: `sha256:${workItem.package.artifact.sha256}`,
        packageId: workItem.package.packageId,
        contentHash: workItem.package.contentHash,
      },
      lifecycleStatus: 'FROZEN',
      selectionStatus: 'SELECTED',
      isCurrent: true,
      classification: structuredClone(PHASE5_737_34_3830_HANDOFF.classificationEnvelope),
    },
    artifactBytes,
    assessmentAsOf: '2026-08-13T00:00:00.000Z',
    rulePack,
    rulePackHash: ruleDigest.replace(/^sha256:/u, ''),
    criterionSet,
    jobAidSourceIdentity: {
      status: 'SOURCE_IDENTITY_MISMATCH',
      sourceManifestHash:
        'sha256:550473ef40f3f4347eeceb392c9fd4318566e1bb7b102c10b5ec014f1a102678',
      allowsCandidateOnlyAssessment: true,
      blocksEngineeringClosure: true,
      blocksRulePromotion: true,
    },
    generatedAt: '2026-08-13T00:00:00.000Z',
  };
}

async function readFastReceipt(issue, unifiedReader, store) {
  const fileName = `airbus-fast${issue}-oem-reference.frozen2.unified-package.json`;
  const bytes = await readFile(resolve(root, 'test/fixtures', fileName));
  const parsedPackage = JSON.parse(bytes.toString('utf8'));
  const documentVersionId = issue === '61'
    ? 'document_version_7d5aca8851db8ea41b89003d'
    : 'document_version_c71fbc457cdc5e7a05725a4d';
  const readback = await unifiedReader.persistAndReadback(bytes, {
    workItemId: `WI-LOCAL-AIRBUS-FAST-${issue}`,
    requestId: `REQ-LOCAL-AIRBUS-FAST-${issue}`,
    documentVersionId,
    permissionSnapshotVersion: 'local-reviewed-reference',
    packageId: parsedPackage.packageId,
    contractId: 'techpub.parsed-package.v1',
    contractRevision: 'frozen.2',
    query: 'Airbus',
  });
  const source = issue === '61'
    ? { sha256: '05cf88265253e63a16bb3d850c2bff5a6b620088a245b316fcdbddcc6a8c0dd8', byteLength: 10036964 }
    : { sha256: '7b793ed00e10ae8513de6972cce06128986c938b565986f49aa02405fab4f380', byteLength: 7179982 };
  const selectedPages = new Set([1, 23, 40]);
  const sourceRefById = new Map(parsedPackage.sourceRefs.map((value) => [value.sourceRefId, value]));
  const sourceUnitLocators = [];
  for (const unit of parsedPackage.contentUnits) {
    const sourceRef = unit.sourceRefIds
      .map((id) => sourceRefById.get(id))
      .find((value) => selectedPages.has(value?.pageStart));
    if (!sourceRef || sourceUnitLocators.some(
      (value) => value.locator.pageStart === sourceRef.pageStart,
    )) continue;
    sourceUnitLocators.push({
      sourceUnitId: unit.unitId,
      sourceUnitHash: unit.unitHash,
      locator: {
        sourceRefId: sourceRef.sourceRefId,
        pageStart: sourceRef.pageStart,
        pageEnd: sourceRef.pageEnd,
      },
      locatorHash: `sha256:${sha256(Buffer.from(JSON.stringify({
        sourceRefId: sourceRef.sourceRefId,
        pageStart: sourceRef.pageStart,
        pageEnd: sourceRef.pageEnd,
      })))}`,
    });
  }
  assert.deepEqual(sourceUnitLocators.map((value) => value.locator.pageStart), [1, 23, 40]);
  await store.readActualBytes(readback.artifact);
  return {
    issue,
    documentVersionId,
    revisionLabel: `ISSUE ${issue}`,
    source,
    packageId: readback.package.packageId,
    semanticHash: readback.package.semanticHash,
    artifact: readback.artifact,
    sourceUnitLocators,
    observedAt: issue === '61'
      ? '2026-08-14T11:50:00.000Z'
      : '2026-08-14T12:10:00.000Z',
  };
}

function reviewedFastManifest(candidate, fast) {
  const current = candidate.evaluation.context.manifest;
  const manifestHash = `sha256:${fast.issue === '61' ? '6'.repeat(64) : '7'.repeat(64)}`;
  const searchRunId = 'DM-HANDOFF-AIRBUS-FAST-CURRENT-REFERENCE';
  const fixedHash = `sha256:${'8'.repeat(64)}`;
  return {
    schemaVersion:
      'wiselink.v3_1.sb_job_aid.external_knowledge_evaluation_context_manifest.v1.candidate',
    status: 'FROZEN_FOR_ONE_OVERALL_ASSESSMENT',
    syntheticFixture: false,
    manifestId: `EKCM-${manifestHash.slice(7, 31).toUpperCase()}`,
    manifestHash,
    target: {
      workItemId: candidate.evaluation.workItemId,
      assessmentCaseId: candidate.evaluation.assessmentPackage.packageId,
      documentId: current.documentId,
      documentVersionId: current.documentVersionId,
      assessmentAsOf: current.assessmentAsOf,
      subjectAcceptedParsedPackage: {
        packageId: current.parsedPackage.packageId,
        contractId: 'techpub.parsed-package.v1',
        contractRevision: current.parsedPackage.contractRevision,
        artifactRef: current.parsedPackage.artifactRef,
        artifactArtifactSha256: current.parsedPackage.artifactHash.replace(/^sha256:/u, ''),
        semanticHash: current.parsedPackage.semanticHash,
        readerReceipt: {
          receiptId: 'LOCAL-SUBJECT-READER-RECEIPT',
          ownerRole: 'CanonicalUnifiedReader',
          readerRevision: 'frozen.2-reader-candidate',
          artifactRef: current.parsedPackage.artifactRef,
          artifactSha256: current.parsedPackage.artifactHash.replace(/^sha256:/u, ''),
          canonicalHash: current.parsedPackage.semanticHash,
          validationStatus: 'ACCEPTED',
        },
      },
      jobAid: {
        criterionSetId: current.jobAidRuleSet.criterionSetId,
        criterionSetHash: current.jobAidRuleSet.criterionSetHash,
        memberIdentityHash: current.jobAidRuleSet.criterionSetMemberIdentityHash,
        criterionCount: current.jobAidRuleSet.criteriaCount,
        ruleArtifactRef: current.jobAidRuleSet.ruleArtifactRef,
        ruleArtifactVersion: current.jobAidRuleSet.ruleArtifactVersion,
        ruleArtifactDigest: current.jobAidRuleSet.ruleArtifactDigest,
        sourceManifestHash: candidate.evaluation.jobAidSourceIdentity.sourceManifestHash,
      },
    },
    searchRuns: [{
      searchRunId,
      provider: 'AIRBUS',
      query: 'AIRBUS-FAST current reviewed reference',
      audit: { observedAt: fast.observedAt },
    }],
    adoptedExternalDocuments: [{
      adoptionId: `ADOPTION-AIRBUS-FAST-${fast.issue}`,
      searchRunId,
      provider: 'AIRBUS',
      externalDocumentId: 'document_ca48ac1dc4b0642ef85c97b6',
      externalDocumentVersionId: fast.documentVersionId,
      documentNumber: 'AIRBUS-FAST',
      revisionLabel: fast.revisionLabel,
      lifecycleStatus: 'ACTIVE',
      artifact: {
        artifactRef: `local-controlled-oem-reference:${fast.source.sha256}`,
        artifactSha256: fast.source.sha256,
        byteLength: fast.source.byteLength,
        mediaType: 'application/pdf',
      },
      parsedPackage: {
        packageId: fast.packageId,
        contractId: 'techpub.parsed-package.v1',
        contractRevision: 'frozen.2',
        artifactRef: fast.artifact.ref,
        artifactArtifactSha256: fast.artifact.sha256,
        semanticHash: fast.semanticHash,
      },
      sourceUnitLocators: fast.sourceUnitLocators,
      retention: {
        policyRef: 'local-assessment-acceptance://policy/no-live-retention-claim',
        policyHash: fixedHash,
        policyRevision: 'LOCAL_ACCEPTANCE_ONLY',
        retainUntil: '2027-08-14T00:00:00.000Z',
        legalHold: false,
      },
      adoptionReview: {
        status: 'HUMAN_REVIEWED',
        decisionRef: `local-assessment-acceptance://decision/adopt-airbus-fast-${fast.issue}`,
        decisionHash: fixedHash,
      },
    }],
    discoveryOnlyCandidates: [],
    gaps: [{
      code: 'PARTIAL',
      provider: 'AIRBUS',
      scope: 'AIRBUS_FAST_FROZEN2_REFERENCE_COVERAGE',
      detail: 'partial / NEEDS_REVIEW with zero applicability authority.',
    }],
    authorityBoundary: {
      snippetIsEvidence: false,
      ragHitIsEvidence: false,
      discoveryCandidateIsEvidence: false,
      adoptedDocumentIsFleetFact: false,
      createsApplicabilityConclusion: false,
      createsEngineerDecision: false,
      createsClosureDecision: false,
    },
  };
}

function metadataFor(bucketId, filePath, fileName, mediaType, byteLength) {
  return {
    id: `file-${sha256(Buffer.from(`${bucketId}:${canonicalPath(filePath)}`)).slice(0, 24)}`,
    bucketID: bucketId,
    filePath: canonicalPath(filePath),
    name: fileName,
    updatedAt: '2026-08-15T00:00:00.000Z',
    metadata: { mimeType: mediaType, contentLength: byteLength },
  };
}

function canonicalPath(value) {
  return String(value).replace(/^\/+/, '');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
