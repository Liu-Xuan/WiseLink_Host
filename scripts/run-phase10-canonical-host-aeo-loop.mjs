import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const [{ CanonicalHostAeoService }] = await Promise.all([
  import(
    pathToFileURL(
      resolve(
        root,
        'dist/server/modules/canonical-host/canonical-host-aeo.service.js',
      ),
    )
  ),
]);

const [workItemRows, assessmentBytes, packageBytes] = await Promise.all([
  readFile('/private/tmp/wiselink-phase10-work-item-export.json', 'utf8').then(JSON.parse),
  readFile('/private/tmp/wiselink-phase10-hosted-assessment.json'),
  readFile('/private/tmp/wiselink-phase10-hosted-frozen2.json'),
]);
const row = workItemRows.find(
  (value) => value.work_item_id === 'WI-9fd1dd58-c7ed-4889-bc67-9a5d3bfbd52e',
);
assert.ok(row);
let projection = JSON.parse(row.projection_json);
const files = new Map();
const registrar = {
  async getByWorkItemId(workItemId) {
    assert.equal(workItemId, projection.workItemId);
    return structuredClone(projection);
  },
  async compareAndSet(input) {
    assert.equal(input.workItemId, projection.workItemId);
    assert.equal(input.expectedRevision, projection.revision);
    projection = {
      ...structuredClone(input.next),
      revision: input.expectedRevision + 1,
    };
    return structuredClone(projection);
  },
};
const authorization = {
  async authorize(input) {
    return {
      action: input.action,
      allowed: true,
      actorFingerprint: `sha256:${'a'.repeat(64)}`,
      decisionId: 'decision-phase10-local',
      decisionHash: `sha256:${'b'.repeat(64)}`,
      permissionSnapshotVersion: projection.permissionSnapshotVersion,
    };
  },
};
const permissionSnapshots = {
  async freshRead() {
    return { permissionSnapshotVersion: projection.permissionSnapshotVersion };
  },
};
const artifactStore = {
  async readActualBytes(artifact) {
    if (artifact.sha256 === projection.package.artifact.sha256) {
      return Uint8Array.from(packageBytes);
    }
    if (artifact.sha256 === projection.assessment.artifact.sha256) {
      return Uint8Array.from(assessmentBytes);
    }
    throw new Error(`LOCAL_ARTIFACT_NOT_FOUND:${artifact.sha256}`);
  },
};
const attempts = [];
const repository = {
  async reserveAssessmentAction(input) {
    attempts.push({ ...input, status: 'RUNNING' });
    return { attemptId: 'ATT-PHASE10-AEO-LOCAL', created: true };
  },
  async completeAssessmentAction(attemptId) {
    assert.equal(attemptId, 'ATT-PHASE10-AEO-LOCAL');
    attempts[0].status = 'SUCCEEDED';
  },
  async failAssessmentAction(input) {
    attempts[0].status = 'FAILED';
    attempts[0].error = input;
  },
};
const fileService = {
  async getDefaultBucket() {
    return 'bucket-phase10-local';
  },
  from(bucketId) {
    return {
      async getFileMetadata(filePath) {
        const file = files.get(filePath);
        if (!file) return null;
        return {
          id: file.id,
          bucketID: bucketId,
          filePath,
          metadata: {
            contentLength: file.bytes.byteLength,
            mimeType: file.mediaType,
          },
        };
      },
      async upload(bytes, options) {
        assert.equal(options.upsert, false);
        assert.equal(files.has(options.filePath), false);
        files.set(options.filePath, {
          id: `file-${files.size + 1}`,
          bytes: Uint8Array.from(bytes),
          mediaType: options.contentType,
        });
        return { filePath: options.filePath };
      },
      async download(filePath) {
        const file = files.get(filePath);
        assert.ok(file);
        return {
          content: Uint8Array.from(file.bytes),
          metadata: { id: file.id },
        };
      },
    };
  },
};

process.env.WL_PHASE10_AEO_VALIDATION_ENABLED = 'true';
process.env.WL_PHASE10_AEO_VALIDATION_RUN_ID = 'phase10-local-production-nest';
const service = new CanonicalHostAeoService(
  registrar,
  authorization,
  permissionSnapshots,
  artifactStore,
  repository,
  fileService,
);
const result = await service.runPhase10CandidateLoop({
  userId: 'local-assessment-engineer',
  tenantId: '63849986',
  appId: 'app_17bzc551rsg',
  roles: ['engineering_assessment'],
  env: 'local',
});

assert.equal(result.status, 'CANDIDATE_WORD_EXPORTED');
assert.deepEqual(result.transition, [5, 9]);
assert.equal(result.workItem.revision, 9);
assert.equal(result.workItem.workItemId, row.work_item_id);
assert.equal(result.workItem.source.documentVersionId, row.document_version_id);
assert.equal(result.workItem.aeo.targetIdentity, 'AEO-B787-46-0015-R09');
assert.equal(result.workItem.aeo.disposition, 'ADOPT');
assert.equal(result.workItem.aeo.artifacts.length, 4);
assert.deepEqual(
  result.workItem.aeo.artifacts.map((artifact) => artifact.artifactKind),
  ['AUTHORING_BOOTSTRAP', 'WORKING_COPY', 'DRAFT_PACKAGE', 'WORD_EXPORT'],
);
assert.equal(result.sourceCandidateCount, 75);
assert.equal(result.word.ooxmlZipSignature, 'PK');
assert.equal(attempts.length, 1);
assert.equal(attempts[0].status, 'SUCCEEDED');
assert.equal(files.size, 4);
assert.equal(result.authority.automaticallyAdopted, false);
assert.equal(result.authority.engineeringApproved, false);

process.stdout.write(`${JSON.stringify({
  status: 'PHASE10_CANONICAL_HOST_AEO_LOCAL_PASS',
  workItemId: result.workItem.workItemId,
  documentVersionId: result.workItem.source.documentVersionId,
  assessmentArtifactSha256: result.workItem.assessment.artifact.sha256,
  packageArtifactSha256: result.workItem.package.artifact.sha256,
  transition: result.transition,
  disposition: result.disposition,
  sourceCandidateCount: result.sourceCandidateCount,
  artifactKinds: result.workItem.aeo.artifacts.map((item) => item.artifactKind),
  word: result.word,
  actionAttempt: attempts[0],
  fileServiceObjectCount: files.size,
  automaticallyAdopted: false,
  engineeringApproved: false,
  onlineWrites: 0,
  releaseCreated: false,
}, null, 2)}\n`);
