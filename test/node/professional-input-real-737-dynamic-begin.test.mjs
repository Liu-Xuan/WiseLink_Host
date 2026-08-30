import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const root = process.cwd();
const fixturePath = process.env.WL31_REAL_737_SB_PDF_PATH?.trim();
const importBuilt = (relativePath) =>
  import(pathToFileURL(resolve(root, 'dist/server', relativePath)));

test(
  'actual 737 SB bytes produce whole-page context accepted by Dynamic begin',
  { skip: fixturePath ? false : 'WL31_REAL_737_SB_PDF_PATH is not set' },
  async () => {
    const [
      { runProfessionalInputPipeline },
      { PdfjsDistLayoutExtractor },
      { Frozen2CandidateReaderService },
      { PythonU0FullPackageValidatorAdapter },
      { U0FullValidationService },
      { UnifiedReaderService },
      { AssessmentHostConsumerService },
      { DynamicRulesEvaluationProcessor },
      { buildJobAidCriterionSetVersion },
      { CanonicalHostAssessmentService },
      { CanonicalHostOpenClawDynamicEvaluationService },
    ] = await Promise.all([
      importBuilt(
        'modules/professional-input/builders/professional-input-pipeline.js',
      ),
      importBuilt(
        'modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter.js',
      ),
      importBuilt('modules/unified-reader/frozen2-candidate-reader.service.js'),
      importBuilt(
        'modules/unified-reader/python-u0-full-package-validator.adapter.js',
      ),
      importBuilt('modules/unified-reader/u0-full-validation.service.js'),
      importBuilt('modules/unified-reader/unified-reader.service.js'),
      importBuilt(
        'modules/assessment-workbench/assessment-host-consumer.service.js',
      ),
      importBuilt(
        'modules/assessment-workbench/dynamic-rules-evaluation.processor.js',
      ),
      importBuilt('modules/assessment-workbench/job-aid-runtime/criterionSet.js'),
      importBuilt(
        'modules/canonical-host/canonical-host-assessment.service.js',
      ),
      importBuilt(
        'modules/canonical-host/canonical-host-openclaw-dynamic-evaluation.service.js',
      ),
    ]);

    const sourceBytes = new Uint8Array(await readFile(fixturePath));
    assert.equal(sourceBytes.byteLength, 1_060_204);
    assert.equal(
      sha256(sourceBytes),
      'add32c7d4192d35c59162f15eb57f08247427135d5912438501ec9267fa4d41a',
    );
    const pipeline = runProfessionalInputPipeline(
      {
        pdfBytes: sourceBytes,
        artifact: {
          artifactRef: 'artifact://CanonicalArtifactStore/real-737-sb-test.pdf',
          normalizedPath: '737-34-3830 Original.pdf',
        },
        document: {
          documentCode: '737-34-3830',
          documentType: 'service_bulletin',
          language: 'en-US',
        },
        lineage: {
          generatedAt: '2026-05-13T00:00:00.000Z',
          producerName: 'WiseLinkCanonicalHostProfessionalInput',
          producerVersion: 'professional-input-pure.v1.candidate.1',
        },
      },
      { extractor: new PdfjsDistLayoutExtractor() },
    );
    assert.equal(pipeline.pkg.contentUnits.length, 599);
    assert.equal(pipeline.pkg.sourceRefs.length, 600);
    const pageRefs = pipeline.pkg.sourceRefs.filter(isWholePageRef);
    assert.equal(pageRefs.length, 22);
    assert.deepEqual(
      pageRefs.map((ref) => ref.pageStart),
      Array.from({ length: 22 }, (_, index) => index + 1),
    );
    assert.equal(
      pageRefs.some((ref) => ref.quote === 'Untitled'),
      false,
    );

    const validator = new U0FullValidationService(
      new PythonU0FullPackageValidatorAdapter({
        pythonExecutable: process.env.WL31_U0_PYTHON?.trim() || 'python3',
        contractRoot: resolve(
          root,
          'dist/server/runtime-assets/technical-publication-parsed-package/v1-frozen-2',
        ),
        contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
        validatorRevision: 'professional-input-real-737-dynamic-begin-test',
      }),
    );
    await validator.validate(pipeline.u0Input);

    const artifactStore = new InMemoryArtifactStore();
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
    const workItemId = 'work-item-real-737-dynamic-begin-test';
    const requestId = 'request-real-737-dynamic-begin-test';
    const documentId = 'document-real-737-dynamic-begin-test';
    const documentVersionId = 'document-version-real-737-dynamic-begin-test';
    const readback = await reader.persistAndReadback(pipeline.u0Input.bytes, {
      workItemId,
      requestId,
      documentVersionId,
      permissionSnapshotVersion: 'permission-real-737-dynamic-begin-test',
      packageId: pipeline.pkg.packageId,
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      query: '737-34-3830',
    });
    assert.equal(readback.status, 'CANDIDATE_READBACK_VERIFIED');
    assert.equal(
      readback.fullValidatorProof.status,
      'FULL_STRICT_VALIDATOR_PASSED',
    );
    assert.equal(readback.package.contentUnitCount, 599);
    assert.equal(readback.package.sourceRefCount, 600);

    const workItem = workItemProjection({
      workItemId,
      requestId,
      documentId,
      documentVersionId,
      readback,
    });
    const registrar = {
      async getTenantScopedByWorkItemId(input) {
        assert.equal(input.workItemId, workItemId);
        assert.equal(input.tenantId, 'tenant-real-737-dynamic-begin-test');
        return structuredClone(workItem);
      },
    };
    const rulePackBytes = new Uint8Array(await readFile(resolve(
      root,
      'server/runtime-assets/assessment-host/job-aid/rule-pack-0.2.json',
    )));
    const rulePack = JSON.parse(new TextDecoder().decode(rulePackBytes));
    const rulePackHash = sha256(rulePackBytes);
    const criterionSet = buildJobAidCriterionSetVersion({
      rulePack,
      artifactRef: 'runtime-asset://assessment-host/job-aid/rule-pack-0.2.json',
      artifactDigest: `sha256:${rulePackHash}`,
      artifactVersion: '0.2',
      lifecycleStatus: 'ACTIVE',
    });
    const ruleSets = {
      async readActiveRuntime(tenantId) {
        assert.equal(tenantId, 'tenant-real-737-dynamic-begin-test');
        return {
          snapshotId: criterionSet.criterionSetId,
          headRevision: 1,
          rulePack,
          rulePackHash,
          criterionSet,
        };
      },
    };
    const assessment = new CanonicalHostAssessmentService(
      registrar,
      {},
      {},
      artifactStore,
      reader,
      {},
      new AssessmentHostConsumerService(),
      ruleSets,
    );
    let reserveReached = false;
    const attempts = {
      async reserveAndClaim(input) {
        const modelInput = await input.buildModelInput({
          attemptId: 'attempt-real-737-dynamic-begin-test',
          operationRef: 'attempt-ref-real-737-dynamic-begin-test',
          triggerRequestId: 'trigger-real-737-dynamic-begin-test',
          attemptNo: 1,
          createdAt: new Date('2026-08-28T00:00:00.000Z'),
        });
        reserveReached = true;
        return {
          attemptRef: 'attempt-ref-real-737-dynamic-begin-test',
          status: 'RUNNING',
          leaseToken: '00000000-0000-4000-8000-000000000737',
          leaseGeneration: 1,
          leaseExpiresAt: '2026-08-28T01:00:00.000Z',
          task: { modelInput },
        };
      },
    };
    const dynamic = new CanonicalHostOpenClawDynamicEvaluationService(
      registrar,
      artifactStore,
      assessment,
      new DynamicRulesEvaluationProcessor(),
      {},
      attempts,
      {
        async authorizeOpenClawWorkItem(input) {
          assert.equal(input.operation, 'BEGIN_DYNAMIC');
          assert.equal(input.workItemId, workItemId);
          return {
            principalId: 'service:openclaw-real-737-dynamic-begin-test',
            appId: 'app_17bzc551rsg',
            tenantId: 'tenant-real-737-dynamic-begin-test',
            workItemId,
            authorizationFingerprint: 'scope-real-737-dynamic-begin-test',
          };
        },
      },
    );
    const begun = await dynamic.begin(workItemId);

    assert.equal(reserveReached, true);
    assert.equal(begun.status, 'RUNNING');
    assert.equal(begun.modelInput.purpose, 'EVALUATE_DYNAMIC_RULES');
    assert.equal(begun.modelInput.expectedSelfCheck.criterionCount, 150);
    assert.equal(begun.modelInput.expectedSelfCheck.sourcePageCount, 22);
    assert.equal(begun.modelInput.jobAidContext.criterionTable.rowCount, 150);
  },
);

class InMemoryArtifactStore {
  values = new Map();

  async persistAndReadback(bytes) {
    const digest = sha256(bytes);
    const artifact = {
      storeRole: 'UnifiedArtifactStoreCandidate',
      ref:
        'artifact://UnifiedArtifactStoreCandidate/' +
        `unified-parsed-packages/sha256/${digest}`,
      sha256: digest,
      byteLength: bytes.byteLength,
      mediaType: 'application/json',
    };
    const reused = this.values.has(artifact.ref);
    this.values.set(artifact.ref, Uint8Array.from(bytes));
    return { artifact, bytes: Uint8Array.from(bytes), reused };
  }

  async readActualBytes(artifact) {
    const bytes = this.values.get(artifact.ref);
    if (!bytes) throw new Error('SOURCE_ARTIFACT_NOT_FOUND');
    if (
      bytes.byteLength !== artifact.byteLength ||
      sha256(bytes) !== artifact.sha256
    ) {
      throw new Error('ARTIFACT_READBACK_MISMATCH');
    }
    return Uint8Array.from(bytes);
  }
}

function workItemProjection({
  workItemId,
  requestId,
  documentId,
  documentVersionId,
  readback,
}) {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId,
    requestId,
    revision: 1,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'permission-real-737-dynamic-begin-test',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: 'actor-real-737-dynamic-begin-test',
      decisionId: 'decision-real-737-dynamic-begin-test',
      decisionHash: 'decision-hash-real-737-dynamic-begin-test',
      permissionSnapshotVersion: 'permission-real-737-dynamic-begin-test',
    },
    source: {
      documentId,
      documentVersionId,
      parserRequestId: 'parser-request-real-737-dynamic-begin-test',
      sourceArtifactId: 'source-artifact-real-737-dynamic-begin-test',
      sourceFileSha256:
        'add32c7d4192d35c59162f15eb57f08247427135d5912438501ec9267fa4d41a',
      sourceByteLength: 1_060_204,
      driveFileToken: 'drive-file-token-test-only',
      driveSourceVersion: 'drive-source-version-test-only',
    },
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
      classifierReleaseId:
        'intake-classifier-release:q1-native-migration@1.0.0',
      classifierReleaseHash:
        'sha256:d374483eaa1c209912bf8ed0f830b582f8f0578e3149899de24633ad8e10587c',
      parserProfileId: 'parser-profile:boeing.sb@1.0.0',
      parserProfileHash:
        'sha256:f87dbe8607c4958f253f980bc459cea062e7ebc1e7e8c65353549399cb07f3c0',
      fingerprint:
        'sha256:f87850cddc741f2969280db07d775125315d0f1b61ae2beb7bb14584176a2663',
    },
    package: {
      packageId: readback.package.packageId,
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      artifact: readback.artifact,
      contentHash: readback.package.contentHash,
      semanticHash: readback.package.semanticHash,
      provenanceHash: readback.package.provenanceHash,
      coverageHash: readback.package.coverageHash,
      resultStatus: readback.package.resultStatus,
      title: readback.package.title,
      documentIdentity: {
        documentCode: '737-34-3830',
        businessRevision: 'ORIGINAL ISSUE',
      },
      contentUnitCount: readback.package.contentUnitCount,
      sourceRefCount: readback.package.sourceRefCount,
      readerReceiptId: readback.receipt.receiptId,
      fullValidatorProof: {
        validatorId: readback.fullValidatorProof.validatorId,
        validatorRevision: readback.fullValidatorProof.validatorRevision,
        contractCommit: readback.fullValidatorProof.contractCommit,
        artifactSha256: readback.fullValidatorProof.artifactSha256,
      },
    },
    integratedAssessment: null,
    failure: null,
    recordingFailure: null,
  };
}

function isWholePageRef(ref) {
  return (
    ref.pageStart === ref.pageEnd &&
    ref.charStart === 0 &&
    ref.charOffsetUnit === 'unicode_scalar_value' &&
    Array.isArray(ref.bbox) &&
    ref.bbox.join(',') === '0,0,1000000,1000000' &&
    ref.anchorTextHash === `sha256:${sha256(ref.quote)}`
  );
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
