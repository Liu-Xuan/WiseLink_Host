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

  async getTenantScopedByWorkItemId({ workItemId, tenantId }) {
    assert.equal(this.projection?.workItemId, workItemId);
    assert.equal(tenantId, 'local-assessment-tenant');
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
  { MiaodaScopedProfessionalArtifactCorrelationAdapter },
  { OrdinaryCanonicalAuthorizationAdapter, OrdinaryCanonicalPermissionSnapshotAdapter },
  { OrdinaryMiaodaAppBindingAdapter },
  { CanonicalEntryFacadeService },
  { CanonicalHostVerticalService },
  { CanonicalHostAssessmentService },
  { CanonicalHostAeoService },
  { OrdinaryWorkItemService },
  { MiaodaOrdinaryArtifactStoreAdapter },
  { Frozen2CandidateReaderService },
  { PythonU0FullPackageValidatorAdapter },
  { U0FullValidationService },
  { UnifiedReaderService },
  { AssessmentHostConsumerService },
  { AeoReviewedIntegratedAssessmentConsumer },
  { DynamicRulesEvaluationProcessor },
  { buildUnifiedSbJobAidAssessmentInput },
  { buildOpenClawOverallSynthesisInput, consumeOpenClawOverallSynthesisOutput },
  { buildJobAidCriterionSetVersion },
] = await Promise.all([
  importBuilt('modules/document-management/src/hosted/phase5BoeingSbHandoff.js'),
  importBuilt('modules/canonical-host/exact-ftd-frozen2-pdf-producer.adapter.js'),
  importBuilt('modules/canonical-host/scoped-professional-artifact-correlation.port.js'),
  importBuilt('modules/canonical-host/ordinary-canonical-authorization.adapter.js'),
  importBuilt('modules/canonical-host/ordinary-miaoda-app-binding.adapter.js'),
  importBuilt('modules/canonical-host/canonical-entry-facade.service.js'),
  importBuilt('modules/canonical-host/canonical-host-vertical.service.js'),
  importBuilt('modules/canonical-host/canonical-host-assessment.service.js'),
  importBuilt('modules/canonical-host/canonical-host-aeo.service.js'),
  importBuilt('modules/work-item/ordinary-work-item.service.js'),
  importBuilt('modules/unified-reader/miaoda-ordinary-artifact-store.adapter.js'),
  importBuilt('modules/unified-reader/frozen2-candidate-reader.service.js'),
  importBuilt('modules/unified-reader/python-u0-full-package-validator.adapter.js'),
  importBuilt('modules/unified-reader/u0-full-validation.service.js'),
  importBuilt('modules/unified-reader/unified-reader.service.js'),
  importBuilt('modules/assessment-workbench/assessment-host-consumer.service.js'),
  importBuilt('modules/aeo-authoring/aeo-reviewed-integrated-assessment.consumer.js'),
  importBuilt('modules/assessment-workbench/dynamic-rules-evaluation.processor.js'),
  importBuilt('modules/assessment-workbench/unified-assessment-input.js'),
  importBuilt('modules/canonical-host/openclaw-overall-synthesis.processor.js'),
  importBuilt('modules/assessment-workbench/job-aid-runtime/criterionSet.js'),
]);

const configuredSourcePath = process.env.WL31_REAL_737_SB_PDF_PATH?.trim();
if (!configuredSourcePath) {
  throw new Error(
    'WL31_REAL_737_SB_PDF_PATH_REQUIRED: set the absolute path of the controlled 737-34-3830 Original.pdf fixture',
  );
}
const sourcePath = resolve(configuredSourcePath);
const sourceBytes = await readFile(sourcePath);
assert.equal(sourceBytes.byteLength, PHASE5_737_34_3830_HANDOFF.source.byteLength);
assert.equal(sha256(sourceBytes), PHASE5_737_34_3830_HANDOFF.source.sha256);

const fileService = new LocalFileService('local-phase5-bucket');
const sourceSelection = {
  bucketId: 'local-phase5-bucket',
  filePath: `/drive/Canonical/${PHASE5_737_34_3830_HANDOFF.source.sha256}.pdf`,
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
    originalFilename: PHASE5_737_34_3830_HANDOFF.descriptor.originalFilename,
    businessRevision: PHASE5_737_34_3830_HANDOFF.descriptor.businessRevision,
    committedAt: '2026-08-13T03:00:00.000Z',
  },
  family: {
    documentFamily: 'SB',
    canonicalDocumentNumber: PHASE5_737_34_3830_HANDOFF.descriptor.documentCode,
  },
  artifact: {
    sourceArtifactId: 'source_artifact_phase5_local_actual_bytes',
    bucketId: sourceSelection.bucketId,
    filePath: sourceSelection.filePath,
    providerObjectId: sourceMetadata.id,
    providerVersionId: sourceMetadata.id,
    sha256: PHASE5_737_34_3830_HANDOFF.source.sha256,
    byteLength: PHASE5_737_34_3830_HANDOFF.source.byteLength,
    mediaType: PHASE5_737_34_3830_HANDOFF.source.mediaType,
    readbackVerified: true,
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
const localObjectAccess = {
  async freshRead({ action, accessRoot }) {
    const projection = registrar.projection;
    assert.ok(projection);
    assert.deepEqual(accessRoot, { kind: 'WORK_ITEM', id: projection.workItemId });
    return {
      allowed: true,
      action,
      accessRoot,
      workItemId: projection.workItemId,
      workItemRevision: projection.revision,
      requestId: projection.requestId,
      documentVersionId: projection.source.documentVersionId,
      actorFingerprint: `sha256:${sha256(Buffer.from(
        'app_17bzc551rsg\nservice:local-assessment-engineer\nlocal-assessment-tenant',
      ))}`,
      accessRevision: `work-item:${projection.revision}:creator-only.v1`,
      authorizationFingerprint: `sha256:${'c'.repeat(64)}`,
    };
  },
};
const authorization = new OrdinaryCanonicalAuthorizationAdapter(localObjectAccess);
const permissionSnapshots = new OrdinaryCanonicalPermissionSnapshotAdapter(localObjectAccess);
const entry = new CanonicalEntryFacadeService(new OrdinaryMiaodaAppBindingAdapter());
const producer = new ExactFtdFrozen2PdfProducerAdapter(
  fileService,
  resolver,
  validator,
  new MiaodaScopedProfessionalArtifactCorrelationAdapter(fileService),
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
const developmentRunToken = '73738300-0000-4000-8000-000000000001';
const actor = {
  userId: 'service:local-assessment-engineer',
  tenantId: 'local-assessment-tenant',
  appId: 'app_17bzc551rsg',
  roles: ['authenticated', 'DOCUMENT_INGEST', 'ASSESSMENT_CANDIDATE'],
  env: 'dev',
};
const parsed = await workItems.createDevelopmentAcceptanceRun(
  {
    documentVersionId: PHASE5_737_34_3830_HANDOFF.catalogIdentity.documentVersionId,
    developmentRunToken,
    query: 'applicability',
  },
  {
    principalId: actor.userId,
    appId: actor.appId,
    tenantId: actor.tenantId,
    environment: 'DEV',
    documentVersionId: PHASE5_737_34_3830_HANDOFF.catalogIdentity.documentVersionId,
    developmentRunToken,
    authorizationFingerprint: `sha256:${'c'.repeat(64)}`,
  },
);
assert.equal(parsed.result.status, 'CANDIDATE_VERTICAL_VERIFIED');
assert.equal(parsed.result.workItem.source.documentVersionId,
  'document_version_f4813607b91ee1a20e754e2d');
assert.equal(parsed.result.workItem.package.contractRevision, 'frozen.2');
assert.match(parsed.result.workItem.package.packageId,
  /^urn:techpub:package:v1:sha256:[0-9a-f]{64}$/u);
assert.equal(parsed.result.workItem.package.artifact.byteLength > 0, true);
assert.match(parsed.result.workItem.package.artifact.sha256, /^[0-9a-f]{64}$/u);

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
const actualPackage = JSON.parse(new TextDecoder().decode(packageBytes));
assert.equal(actualPackage.packageId, parsed.result.workItem.package.packageId);
assert.equal(actualPackage.contractRevision, 'frozen.2');
assert.equal(actualPackage.source.sourcePackageHash,
  `sha256:${PHASE5_737_34_3830_HANDOFF.source.sha256}`);
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
const dynamicProcessor = new DynamicRulesEvaluationProcessor();
const dynamicRulesInput = buildUnifiedSbJobAidAssessmentInput({
  documentVersionBinding: assessmentOptions(
    parsed.result.workItem,
    packageBytes,
    rulePack,
    ruleDigest,
    criterionSet,
  ).documentVersionBinding,
  artifactBytes: packageBytes,
  assessmentAsOf: '2026-08-13T00:00:00.000Z',
});
const dynamicRequest = dynamicProcessor.buildRequest(
  dynamicRulesInput,
  preview.overall.transport,
  {
    transportId: 'OPENCLAW-DYNAMIC:ATT-INTERNAL-LOCAL-737',
    workItemId: parsed.result.workItem.workItemId,
    actionAttemptId: 'ATT-INTERNAL-LOCAL-737',
    expectedRevision: parsed.result.workItem.revision,
    documentVersionId: parsed.result.workItem.source.documentVersionId,
  },
  'DYN-LOCAL-737-OPAQUE',
);
const dynamicModelInputText = JSON.stringify(dynamicRequest.modelInput);
assert.equal(dynamicRequest.modelInput.purpose, 'EVALUATE_DYNAMIC_RULES');
assert.equal(dynamicRequest.modelInput.jobAidContext.criterionTable.rowCount, 150);
assert.equal(dynamicModelInputText.includes(parsed.result.workItem.workItemId), false);
assert.equal(dynamicModelInputText.includes('ATT-INTERNAL-LOCAL-737'), false);
assert.equal(dynamicModelInputText.includes('workItemId'), false);
assert.equal(dynamicModelInputText.includes('actionAttemptId'), false);
assert.equal(dynamicModelInputText.includes('expectedRevision'), false);
assert.equal(Buffer.byteLength(dynamicModelInputText, 'utf8') <= 45_000, true);
const criterionTable = dynamicRequest.modelInput.jobAidContext.criterionTable;
const criterionIdIndex = criterionTable.columns.indexOf('criterionId');
const sourceCandidateIndex = criterionTable.columns.indexOf(
  'sourceEvidenceCandidateIds',
);
const sourceCandidateDictionary = criterionTable.valueDictionaries
  .sourceEvidenceCandidateIds;
const sourceCandidateIdsFor = (row) => {
  const encoded = row[sourceCandidateIndex];
  const decoded = Number.isInteger(encoded)
    ? sourceCandidateDictionary[encoded]
    : encoded;
  assert.equal(Array.isArray(decoded), true);
  return decoded;
};
const dynamicOutputBytes = Buffer.from(JSON.stringify({
  callerCorrelationRef: dynamicRequest.modelInput.callerCorrelationRef,
  authorityLevel: 'candidate_only',
  engineeringConclusion: null,
  applicabilityOverall:
    dynamicRequest.modelInput.jobAidContext.currentAssessment.applicabilityOverall,
  ruleResults: {
    columns: [
      'ruleId', 'result', 'factsConsidered', 'ruleApplication',
      'analysisSummary', 'conclusion', 'sourceRefs', 'missingInputs',
      'humanReviewRequired',
    ],
    rows: criterionTable.rows.map((row) => [
      row[criterionIdIndex], 'UNKNOWN', [], 'controlled facts unavailable',
      'requires engineer review', 'WAITING_INPUT', sourceCandidateIdsFor(row),
      ['controlled_input'], true,
    ]),
  },
  overallSelfCheck: {
    ruleResultCount: 150,
    rulesWithMissingInputs: 150,
    humanReviewRequiredCount: 150,
    overallOpinionProduced: false,
    holisticSynthesisDeferredToOpenClaw: true,
  },
  nextRoundChecklist: [],
  completionSelfCheck: {
    expectedRuleCount: 150,
    sourcePageCount:
      dynamicRequest.modelInput.responseInstruction.completionSelfCheck.sourcePageCount,
    allInputRulesReturned: true,
    returnedRuleIdsMatchInputOrder: true,
    returnedRuleIdsUnique: true,
  },
}));
const dynamicPersisted = await artifactStore.persistAndReadback(
  dynamicOutputBytes,
);
const localBaseRules = {
  status: 'CANDIDATE_ONLY', revision: 1,
  sourceResultId:
    `openclaw-dynamic://${dynamicRequest.modelInput.callerCorrelationRef}`,
  criterionSetId: criterionSet.criterionSetId, criterionCount: 150,
  evaluationItemCount: 150, unresolvedCount: 150,
  sourceBoundCandidateCount: criterionTable.rows.filter(
    (row) => sourceCandidateIdsFor(row).length > 0,
  ).length,
  artifact: dynamicPersisted.artifact,
  actionAttemptId: 'ATT-INTERNAL-LOCAL-DYNAMIC',
};
const workItemWithBase = {
  ...parsed.result.workItem,
  integratedAssessment: {
    status: 'BASE_RULE_CANDIDATE_READY', baseRules: localBaseRules,
    overallSynthesis: null, overallForAeoConfirmation: null,
  },
};
const discoveryRuns = [
  {
    searchRunRef: 'search:boeing:local-denied', sourceSystem: 'FEISHU_HOSTED_OPENCLAW',
    query: '737-34-3830', resultStatus: 'ACCESS_DENIED',
    observedAt: '2026-08-16T01:00:00.000Z', accessRestricted: true,
    truncated: false, partialOnly: false, failureCode: 'UPSTREAM_CONNECT_TIMEOUT', candidates: [],
  },
  {
    searchRunRef: 'search:airbus:local-complete', sourceSystem: 'FEISHU_HOSTED_OPENCLAW',
    query: 'FAST 62', resultStatus: 'CANDIDATES_FOUND',
    observedAt: '2026-08-16T01:01:00.000Z', accessRestricted: false,
    truncated: false, partialOnly: false, failureCode: null,
    candidates: [{ candidateRef: 'airbus-fast62', publisher: 'AIRBUS', title: 'FAST 62', url: 'https://www.airbus.com/en/newsroom/stories/fast-62', disposition: 'DIRECT_OFFICIAL_SOURCE_MATCH' }],
  },
  {
    searchRunRef: 'search:comac:local-partial', sourceSystem: 'FEISHU_HOSTED_OPENCLAW',
    query: 'COMAC publication', resultStatus: 'PARTIAL_RESULTS',
    observedAt: '2026-08-16T01:02:00.000Z', accessRestricted: false,
    truncated: true, partialOnly: true, failureCode: 'OFFICIAL_LIST_PARTIAL',
    candidates: [{ candidateRef: 'comac-partial', publisher: 'COMAC', title: 'COMAC list', url: 'https://www.comac.cc/publication', disposition: 'TANGENTIAL_NO_DIRECT_MATCH' }],
  },
];
const overallAInput = buildOpenClawOverallSynthesisInput({
  workItem: workItemWithBase, baseRules: localBaseRules,
  baseArtifactBytes: dynamicOutputBytes, packageBytes, discoveries: [],
  sourceEvidenceCandidates: preview.overall.context.criterionCards.flatMap(
    (criterion) => criterion.sourceEvidenceCandidates,
  ),
  engineerReviewContext: { revision: null, artifactSha256: null, reviewCount: 0, history: [], effective: [] },
  outputCorrelationRef: 'OVR-LOCAL-A',
});
const overallBInput = buildOpenClawOverallSynthesisInput({
  workItem: workItemWithBase, baseRules: localBaseRules,
  baseArtifactBytes: dynamicOutputBytes, packageBytes,
  discoveries: discoveryRuns, outputCorrelationRef: 'OVR-LOCAL-B',
  sourceEvidenceCandidates: preview.overall.context.criterionCards.flatMap(
    (criterion) => criterion.sourceEvidenceCandidates,
  ),
  engineerReviewContext: { revision: null, artifactSha256: null, reviewCount: 0, history: [], effective: [] },
});
const mappedOverallItems = overallAInput.baseRuleResult.items;
const mappedOverallSourceRefs = mappedOverallItems.flatMap(
  (item) => item.sourceRefIds,
);
assert.equal(
  mappedOverallItems.filter((item) => item.sourceRefIds.length > 0).length,
  localBaseRules.sourceBoundCandidateCount,
);
assert.equal(mappedOverallSourceRefs.length > 0, true);
assert.equal(
  mappedOverallSourceRefs.every((sourceRefId) =>
    sourceRefId.startsWith('urn:techpub:source-ref:v1:sha256:'),
  ),
  true,
);
assert.equal(mappedOverallSourceRefs.some((sourceRefId) =>
  sourceRefId.startsWith('SEC-'),
), false);
const overallA = localOverallOutput(overallAInput, 'NO_DISCOVERY', {}, 0);
const overallB = localOverallOutput(overallBInput,
  'AIRBUS:COMPLETE;BOEING:ACCESS_DENIED;COMAC:PARTIAL_RESULTS',
  {
    airbus: providerSummary('COMPLETE', true, false, 1, null),
    boeing: providerSummary('ACCESS_DENIED', false, true, 0, 'UPSTREAM_CONNECT_TIMEOUT'),
    comac: providerSummary('PARTIAL_RESULTS', false, false, 1, 'OFFICIAL_LIST_PARTIAL'),
  }, 2);
consumeOpenClawOverallSynthesisOutput(overallAInput, JSON.stringify(overallA));
consumeOpenClawOverallSynthesisOutput(overallBInput, JSON.stringify(overallB));
const overallABytes = Buffer.from(JSON.stringify(overallA));
const overallAPersisted = await artifactStore.persistAndReadback(overallABytes);
const overallAReadback = JSON.parse(new TextDecoder().decode(
  await artifactStore.readActualBytes(overallAPersisted.artifact)));
assert.deepEqual(overallAReadback.engineeringSummary, overallA.engineeringSummary);
assert.equal(/AIMS[ -]?2/iu.test(JSON.stringify(overallAReadback)), false);
const fast61 = await readFastReceipt('61', reader, artifactStore);
const fast62 = await readFastReceipt('62', reader, artifactStore);
const fast61Manifest = reviewedFastManifest(preview, fast61);
const fast62Manifest = reviewedFastManifest(preview, fast62);
const accessDeniedDiscovery = {
  runtime: 'FEISHU_HOSTED_OPENCLAW',
  runtimeAppId: 'app_17c3zn24kv2',
  provider: 'BOEING',
  query: '777 FTD 31-21002 software',
  resultStatus: 'ACCESS_DENIED',
  observedAt: '2026-08-14T00:00:00.000Z',
  candidates: [],
  accessRestricted: true,
  truncated: false,
  partialOnly: true,
  excludedNonOemCandidateCount: 0,
  error: {
    code: 'UPSTREAM_CONNECT_TIMEOUT',
    message: 'Boeing official upstream connection timed out.',
  },
};

const evaluated = await assessment.evaluateCandidate(
  {
    workItemId: parsed.result.workItem.workItemId,
    assessmentAsOf: '2026-08-13T00:00:00.000Z',
    generatedAt: '2026-08-13T00:00:00.000Z',
    externalDiscovery: accessDeniedDiscovery,
    reviewedExternalManifest: fast61Manifest,
  },
  actor,
);
assert.equal(evaluated.assessment.criterionCount, 150);
assert.equal(evaluated.assessment.evaluationItemCount, 150);
assert.equal(evaluated.assessment.authorityLevel, 'candidate_only');
assert.equal(evaluated.assessment.blocksEngineeringClosure, true);
assert.equal(evaluated.assessment.externalDiscoveryStatus,
  'ACCESS_DENIED');
assert.equal(evaluated.assessment.externalDiscoveryIsEvidence, false);
assert.equal(evaluated.package.packageId, parsed.result.workItem.package.packageId);

const initialAssessmentBytes = await artifactStore.readActualBytes(
  evaluated.assessment.artifact,
);
const initialAssessment = JSON.parse(new TextDecoder().decode(initialAssessmentBytes));
const initialCandidatePage = await vertical.page(
  { workItemId: evaluated.workItemId, query: 'applicability' },
  actor,
);
assert.equal(initialCandidatePage.workItem.assessment.status, 'CANDIDATE_ONLY');
const externalRevisionResynthesis =
  assessmentConsumer.resynthesizeAfterReviewedExternalChange(
    initialAssessment,
    fast62Manifest,
    accessDeniedDiscovery,
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
const firstEngineerComment =
  'Local acceptance only; no engineering closure authority.';
const resynthesized = await assessment.resynthesizeAfterEngineerChange(
  {
    workItemId: evaluated.workItemId,
    expectedRevision: evaluated.revision,
    criterionId,
    review: {
      baseRecordId: 'LOCAL-ENGINEER-REVIEW-001',
      decision: 'confirmed_pass',
      comment: firstEngineerComment,
      reviewingEngineerUserIds: [actor.userId],
      status: 'ENGINEER_CONFIRMED',
      updatedAt: '2026-08-13T01:00:00.000Z',
    },
    externalDiscovery: accessDeniedDiscovery,
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
const previousResynthesisBytes = await artifactStore.readActualBytes(
  resynthesized.assessment.artifact,
);
const previousResynthesisPage = await vertical.page(
  { workItemId: resynthesized.workItemId, query: 'applicability' },
  actor,
);
assert.equal(
  previousResynthesisPage.workItem.assessment.resynthesisAttemptId,
  resynthesized.assessment.resynthesisAttemptId,
);

const secondCriterionId = initialAssessment.evaluation.snapshot.items[1].criterionId;
const secondEngineerComment =
  'Second explicit edit proves revision-scoped resynthesis.';
const secondResynthesis = await assessment.resynthesizeAfterEngineerChange(
  {
    workItemId: resynthesized.workItemId,
    expectedRevision: resynthesized.revision,
    criterionId: secondCriterionId,
    review: {
      baseRecordId: 'LOCAL-ENGINEER-REVIEW-002',
      decision: 'deferred',
      comment: secondEngineerComment,
      reviewingEngineerUserIds: [actor.userId],
      status: 'NEEDS_REVIEW',
      updatedAt: '2026-08-13T02:00:00.000Z',
    },
    externalDiscovery: accessDeniedDiscovery,
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
assert.deepEqual(
  [...repository.assessmentActions.values()]
    .filter((value) => value.actionType === 'RESYNTHESIZE_ASSESSMENT')
    .map((value) => value.attemptNo),
  [evaluated.revision, resynthesized.revision],
);
const secondAssessmentBytes = await artifactStore.readActualBytes(
  secondResynthesis.assessment.artifact,
);
const secondAssessment = JSON.parse(
  new TextDecoder().decode(secondAssessmentBytes),
);
assert.equal(
  secondAssessment.evaluation.snapshot.items.find(
    (item) => item.criterionId === criterionId,
  ).engineerReview.comment,
  firstEngineerComment,
);
assert.equal(
  secondAssessment.evaluation.snapshot.items.find(
    (item) => item.criterionId === secondCriterionId,
  ).engineerReview.comment,
  secondEngineerComment,
);
const secondTransportText = JSON.stringify(secondAssessment.overall.transport);
assert.equal(secondTransportText.includes(firstEngineerComment), true);
assert.equal(secondTransportText.includes(secondEngineerComment), true);

const beforeIntegrated = await registrar.getByWorkItemId(
  secondResynthesis.workItemId,
);
const integratedRevision = beforeIntegrated.revision + 1;
const withIntegrated = await registrar.compareAndSet({
  workItemId: beforeIntegrated.workItemId,
  expectedRevision: beforeIntegrated.revision,
  syncPrimaryAttempt: false,
  next: {
    ...withoutRevision(beforeIntegrated),
    integratedAssessment: {
      status: 'OVERALL_CANDIDATE_READY',
      baseRules: localBaseRules,
      overallSynthesis: {
        status: 'CANDIDATE_ONLY',
        revision: 1,
        sourceResultId: overallA.sourceResultId,
        basedOnBaseRuleRevision: localBaseRules.revision,
        basedOnBaseRuleArtifactSha256: localBaseRules.artifact.sha256,
        basedOnEngineerReviewRevision: null,
        basedOnEngineerReviewArtifactSha256: null,
        discoveryStatus: overallA.discoveryStatus,
        gap: overallA.gap,
        candidateRefCount: overallA.candidateRefCount,
        findingCount: overallA.findingCount,
        unresolvedCount: overallA.unresolvedCount,
        authorityLevel: 'candidate_only',
        externalDiscoveryIsEvidence: false,
        artifact: overallAPersisted.artifact,
        actionAttemptId: 'ATT-LOCAL-OPENCLAW-OVERALL-A',
        staleReason: null,
        overallCandidate: overallA.overallCandidate,
        engineeringSummary: structuredClone(overallA.engineeringSummary),
        findings: structuredClone(overallA.findings),
        missingInputs: [...overallA.missingInputs],
        applicabilityStatus: overallA.applicabilityStatus,
        engineeringReviewRequired: overallA.engineeringReviewRequired,
        providers: structuredClone(overallA.providers),
      },
      overallForAeoConfirmation: {
        status: 'HUMAN_CONFIRMED',
        authority: 'CANONICAL_WORKITEM_SERVER_FRESH_READ',
        workItemRevision: integratedRevision,
        overallRevision: 1,
        overallArtifactRef: overallAPersisted.artifact.ref,
        overallArtifactSha256: overallAPersisted.artifact.sha256,
        actionAttemptId: 'ATT-LOCAL-CONFIRM-OVERALL-FOR-AEO',
        confirmingActorUserId: actor.userId,
        confirmedAt: '2026-08-17T00:00:00.000Z',
      },
    },
  },
});
assert.equal(withIntegrated.revision, integratedRevision);

const baseAiCallCount = 0;
const aeo = new CanonicalHostAeoService(
  registrar,
  authorization,
  permissionSnapshots,
  artifactStore,
  repository,
  fileService,
  new AeoReviewedIntegratedAssessmentConsumer(),
);
const uploadsBeforeAeo = fileService.uploadCalls.length;
const aeoRun = await aeo.generateCandidate(withIntegrated.workItemId, actor);
assert.equal(aeoRun.status, 'CANDIDATE_WORD_EXPORTED');
assert.equal(aeoRun.replayed, false);
assert.equal(aeoRun.baseAiCallCount, 0);
assert.equal(aeoRun.aeo.artifacts.length, 4);
assert.equal(aeoRun.aeo.targetIdentity.startsWith(
  'AEO-CANDIDATE-737-34-3830-',
), true);
assert.notEqual(
  aeoRun.aeo.targetIdentity,
  aeoRun.aeo.authoringTemplate.identity,
);
assert.equal(aeoRun.aeo.authoringTemplate.role, 'CONTROLLED_TEMPLATE_SOURCE');
assert.equal(fileService.uploadCalls.length, uploadsBeforeAeo + 4);
const uploadsAfterAeo = fileService.uploadCalls.length;
const aeoReplay = await aeo.generateCandidate(withIntegrated.workItemId, actor);
assert.equal(aeoReplay.replayed, true);
assert.deepEqual(aeoReplay.aeo, aeoRun.aeo);
assert.equal(fileService.uploadCalls.length, uploadsAfterAeo);

const page = await vertical.page(
  { workItemId: secondResynthesis.workItemId, query: 'applicability' },
  actor,
);
const openApiScope = {
  principalId: actor.userId,
  appId: actor.appId,
  tenantId: actor.tenantId,
  workItemId: secondResynthesis.workItemId,
  authorizationFingerprint: `sha256:${'c'.repeat(64)}`,
};
const openApi = await vertical.openApiStatus(secondResynthesis.workItemId, openApiScope);
const deepLink = await vertical.openApiDeepLink(secondResynthesis.workItemId, openApiScope);
assert.equal(page.workItem.assessment.criterionCount, 150);
assert.equal(openApi.assessmentSummary.criterionCount, 150);
assert.equal(openApi.assessmentSummary.artifact.sha256,
  secondResynthesis.assessment.artifact.sha256);
assert.equal(page.workItem.integratedAssessment.baseRules.criterionCount, 150);
assert.equal(openApi.integratedAssessmentSummary.overallSynthesis.status,
  'CANDIDATE_ONLY');
assert.equal(page.workItem.aeo.status, 'CANDIDATE_WORD_EXPORTED');
assert.equal(deepLink.deepLink, page.entry.deepLinkPath);
assert.equal(ingestCalls, 0);
assert.equal(repository.parseReservation.workItemId, secondResynthesis.workItemId);
assert.equal(baseAiCallCount, 0);

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
  dynamicEvaluationInput: {
    purpose: dynamicRequest.modelInput.purpose,
    criterionCount:
      dynamicRequest.modelInput.jobAidContext.criterionTable.rowCount,
    byteLength: Buffer.byteLength(dynamicModelInputText, 'utf8'),
    authorityFree: true,
    callerCorrelationRef: dynamicRequest.modelInput.callerCorrelationRef,
  },
  overallSynthesisAB: {
    noDiscoveryStatus: overallA.discoveryStatus,
    optionalDiscoveryResynthesisStatus: overallB.discoveryStatus,
    dynamicCriterionCount: overallAInput.baseRuleResult.items.length,
    sourceBoundCriterionCount: localBaseRules.sourceBoundCandidateCount,
    secCandidatesMappedToUnifiedSourceRefs: true,
    candidateRefCount: overallB.candidateRefCount,
    candidateOnly: true,
    engineeringSummary: overallAReadback.engineeringSummary,
    aims2AbsentFrom737InputAndReadback:
      !/AIMS[ -]?2/iu.test(JSON.stringify(overallAInput))
      && !/AIMS[ -]?2/iu.test(JSON.stringify(overallAReadback)),
  },
  aeo: {
    status: aeoRun.aeo.status,
    targetIdentity: aeoRun.aeo.targetIdentity,
    authoringTemplate: aeoRun.aeo.authoringTemplate,
    artifacts: aeoRun.aeo.artifacts,
    replayedWithoutIo: aeoReplay.replayed,
    baseAiCallCount,
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
    integratedAssessmentSummary: openApi.integratedAssessmentSummary,
    aeoStatus: page.workItem.aeo.status,
  },
  actionAttempts: [...repository.assessmentActions.values()].map((value) => ({
    actionType: value.actionType,
    attemptId: value.attemptId,
    attemptNo: value.attemptNo,
    status: value.status,
  })),
  parserPackageColumnsUnchanged: true,
  onlineWrites: 0,
  releaseCreated: false,
}, null, 2)}\n`);

function providerSummary(status, direct, accessRestricted, candidateCount, failureCode) {
  return {
    status,
    match: direct ? 'DIRECT_OFFICIAL_SOURCE_MATCH' : 'NO_DIRECT_OFFICIAL_SOURCE_MATCH',
    accessRestricted, candidateCount, failureCode,
    source: 'OFFICIAL_OEM_PUBLIC_SOURCE', baiduAcceptedAsOfficial: false,
  };
}

function localOverallOutput(input, discoveryStatus, providers, candidateRefCount) {
  const backgroundRef = currentSourceRefByExcerpt(input, '0x1009 fault code');
  const effectivityRef = currentSourceRefByExcerpt(
    input, '737-8200 without Extended Range Twin Engine Operations');
  const detailedEffectivityRef = currentSourceRefByExcerpt(input, 'line number(s) 5602');
  const softwareRef = currentSourceRefByExcerpt(
    input, 'Installation of the FMC OPS will erase all existing');
  const sourceFact = (text, ...sourceRefIds) => ({
    text, basis: 'SOURCE_FACT', sourceRefIds: [...new Set(sourceRefIds)],
  });
  const inference = (text, ...sourceRefIds) => ({
    text, basis: 'CONDITIONAL_INFERENCE', sourceRefIds: [...new Set(sourceRefIds)],
  });
  const conclusion = sourceFact(
    '737-34-3830 针对 GE FMC 易受大气辐射影响的旧 SRAM 引发空中重启问题，当前建议对适用飞机更换两台旧 FMC 为新构型并完成 FMC operational test。',
    backgroundRef, effectivityRef, softwareRef,
  );
  const engineeringSummary = {
    schemaVersion: 'wiselink.3_1.overall_engineering_summary.v1',
    conclusion,
    whyItMatters: [sourceFact(
      '旧 SRAM 的多位错误会触发 0x1009 cold restart，清空 SRAM、丢失 flight plan data，并使重启时间长于 warm restart，影响运行可靠性。',
      backgroundRef,
    )],
    applicability: {
      sourceScope: sourceFact(
        '源文件适用于 effectivity 清单内的 737-8、737-8200 non-ETOPS 和 737-9，并针对装有旧 GE FMC 构型的飞机。',
        effectivityRef, detailedEffectivityRef, softwareRef,
      ),
      fleetMatch: inference(
        '当前输入没有本机队 Variable/Line Number 与现装 FMC P/N，不能判定具体飞机适用或不适用。',
        detailedEffectivityRef, softwareRef,
      ),
      requiredFacts: [
        inference(
          '取得每架候选飞机的 Variable/Line Number，并与源文件 effectivity 清单核对。',
          detailedEffectivityRef,
        ),
        inference(
          '核实现装 FMC 是否为 10-62225-004 / GE 2907C1 / 176200-01-01。',
          softwareRef,
        ),
      ],
    },
    implementationImpact: [
      sourceFact(
        '实施前飞机必须已安装 ONS OS 9.1；新 FMC 仅允许 FMC OPS U14 或 U14.1。',
        backgroundRef, softwareRef,
      ),
      sourceFact(
        'OPS 安装会擦除现有 OFP，之后需恢复 OPC、MEDB、NDB、LDDB、ATN 与 ACARS ADDB；装有 HUD 的飞机需向 STC holder 确认兼容。',
        softwareRef,
      ),
      sourceFact(
        '每架需运营人提供两台新 FMC，无 kit、无特殊工具、无重量或电气负载变化，但 publications 与 flight operations 受影响。',
        backgroundRef, effectivityRef, softwareRef,
      ),
    ],
    dispositionPriority: [
      sourceFact(
        '源文件未给强制 compliance time，且明确为非 AD related；Boeing 建议实施以引入可靠性改进。',
        backgroundRef, effectivityRef,
      ),
      inference(
        '完成机队适用性和软件/HUD 前置条件核对后，可按可靠性改进纳入计划维修，无需按法规时限立即执行。',
        backgroundRef, effectivityRef, softwareRef,
      ),
    ],
    nextActions: [
      inference(
        '批量核对候选飞机的 Variable/Line Number 与现装 FMC P/N，形成适用飞机清单和异常项。',
        detailedEffectivityRef, softwareRef,
      ),
      inference(
        '对适用飞机确认 ONS OS 9.1，并准备 U14/U14.1 与 OFP 数据恢复包。',
        backgroundRef, softwareRef,
      ),
      inference(
        '仅对装有 HUD 的适用飞机取得 STC holder 兼容性确认。',
        softwareRef,
      ),
    ],
  };
  return {
    sourceResultId: input.outputCorrelationRef,
    documentVersionId: input.baseRuleResult.documentVersionId,
    packageId: input.baseRuleResult.packageId,
    baseRuleRevision: input.baseRuleResult.revision,
    baseRuleArtifactSha256: input.baseRuleResult.artifactSha256,
    engineerReviewRevision: input.engineerReviewContext.revision,
    engineerReviewArtifactSha256: input.engineerReviewContext.artifactSha256,
    discoveryStatus, gap: discoveryStatus === 'NO_DISCOVERY' ? null : 'Discovery remains non-evidence.',
    candidateRefCount, findingCount: 1,
    unresolvedCount: input.baseRuleResult.unresolvedCount,
    authorityLevel: 'candidate_only', externalDiscoveryIsEvidence: false,
    overallCandidate: conclusion.text,
    engineeringSummary,
    findings: [{
      finding: conclusion.text,
      basis: '当前 DocumentVersion 的 SB 原文',
      sourceRefIds: conclusion.sourceRefIds,
      assumptions: [],
      uncertainty: '具体机队适用性仍受 Variable/Line Number 与现装 FMC P/N 约束',
    }],
    missingInputs: ['候选飞机 Variable/Line Number', '候选飞机现装 FMC P/N'],
    applicabilityStatus: 'UNKNOWN/WAITING_INPUT', engineeringReviewRequired: true,
    adopted: false, usableAsEvidence: false, providers,
  };
}

function currentSourceRefByExcerpt(input, fragment) {
  const normalizedFragment = normalizeWhitespace(fragment).toLowerCase();
  const sourceRef = input.unifiedSourceContext.sourceRefs.find((candidate) =>
    typeof candidate.excerpt === 'string'
    && normalizeWhitespace(candidate.excerpt).toLowerCase().includes(normalizedFragment));
  if (!sourceRef) {
    throw new Error(`REAL_737_OVERALL_SOURCE_REF_NOT_EXPOSED:${fragment}`);
  }
  assert.equal(input.unifiedSourceContext.currentDocumentSourceRefIds.includes(
    sourceRef.sourceRefId), true);
  return sourceRef.sourceRefId;
}

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}

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

function withoutRevision(workItem) {
  const { revision: _revision, ...rest } = workItem;
  return rest;
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
