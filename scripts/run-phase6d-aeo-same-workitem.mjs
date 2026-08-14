import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { NestFactory } from '@nestjs/core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const importBuilt = (relativePath) =>
  import(pathToFileURL(resolve(root, 'dist/server', relativePath)));

const CANONICAL_ROLES = [
  'CanonicalMiaodaApp',
  'CanonicalAily',
  'CanonicalWorkItemStore',
  'CanonicalDocumentCatalog',
  'CanonicalArtifactStore',
  'CanonicalUnifiedReader',
];

class LocalAeoHostedBundle {
  constructor(workItem, seedBytes) {
    this.workItem = structuredClone(workItem);
    this.bytes = new Map([
      [workItem.authoringSeed.parsedPackage.artifactRef, Uint8Array.from(seedBytes)],
    ]);
    this.candidates = [];
    this.decisions = [];
    this.sequence = 0;
  }

  describe() {
    return {
      schemaVersion: 'wiselink.3_1.aeo_hosted_platform_binding.v0.candidate.5',
      bindingId: 'binding://canonical-host/phase6d-local-only',
      bindingRevision: 'phase6d-local-only',
      mode: 'ACTIVE',
      activationManifest: null,
      activationManifestSha256: null,
      authority: 'BINDING_DESCRIPTOR_NOT_WRITE_AUTHORIZATION',
    };
  }

  resolveAll() {
    const resolutionVersion = 'canonical-host.phase6d.local-only';
    return {
      resolutionVersion,
      roles: CANONICAL_ROLES.map((role) => ({
        role,
        status: 'VERIFIED_CANONICAL',
        resolutionVersion,
        exactIdentityRef: `local-only://${role}`,
        tenantRef: 'tenant://local-only',
        environmentRef: 'environment://local-only',
        accessBaseUrl:
          role === 'CanonicalMiaodaApp'
            ? 'https://local-only.invalid/app/app_17bzc551rsg'
            : null,
        verifiedAt: '2026-08-15T00:00:00.000Z',
      })),
    };
  }

  async read() {
    return structuredClone(this.workItem);
  }

  async search() {
    return structuredClone(this.candidates);
  }

  async persistImmutable(input) {
    const artifactSha256 = sha256(input.bytes);
    const artifactRef =
      `artifact://canonical-host/phase6d/${input.artifactKind.toLowerCase()}/` +
      `${++this.sequence}/${artifactSha256}`;
    this.bytes.set(artifactRef, Uint8Array.from(input.bytes));
    return {
      artifactRef,
      artifactSha256,
      byteLength: input.bytes.byteLength,
      mediaType: input.mediaType,
    };
  }

  async readActualBytes(artifactRef) {
    const bytes = this.bytes.get(artifactRef);
    if (!bytes) throw new Error('LOCAL_AEO_ARTIFACT_NOT_FOUND');
    return Uint8Array.from(bytes);
  }

  async commitArtifact(request) {
    assert.equal(request.workItemId, this.workItem.workItemId);
    assert.equal(request.expectedStateVersion, this.workItem.stateVersion);
    this.decisions.push(structuredClone(request));
    this.workItem.stateVersion += 1;
    this.workItem.aeo.stateVersion = `AEO-STATE-${this.workItem.stateVersion}`;
    this.workItem.aeo.state = request.nextAeoState;
    this.workItem.artifactIndex.push(structuredClone(request.artifact));
    return {
      decisionId: `DECISION-PHASE6D-${this.workItem.stateVersion}`,
      committedStateVersion: this.workItem.stateVersion,
      replayed: false,
    };
  }
}

export async function runPhase6dAeoSameWorkItemLoop(input) {
  const [publicApi, actionsApi, sessionsApi, integration] = await Promise.all([
    importBuilt('modules/aeo-authoring/public-api.js'),
    importBuilt('modules/aeo-authoring/aeo-artifact-action.service.js'),
    importBuilt('modules/aeo-authoring/aeo-authoring-session.service.js'),
    importBuilt('../shared/aeo-integration.js'),
  ]);
  const r09Bytes = await readFile(
    resolve(root, 'test/fixtures/aeo-r09-authoring-seed.json'),
  );
  const r09 = JSON.parse(r09Bytes.toString('utf8'));
  assert.equal(r09Bytes.byteLength, 78_811);
  assert.equal(
    sha256(r09Bytes),
    'f781b660dbc8457c800dae5e5d0d4cbef877f6d591985f4fe5f8f118dbbfa80d',
  );
  assert.equal(r09.parsePackageId, 'AEOPARSE-D39EB2E83C552549A9AA5784');

  const seed = makeR09SeedWorkItem(integration.AEO_ARTIFACT_INDEX_VERSION, r09, r09Bytes);
  const bundle = new LocalAeoHostedBundle(seed, r09Bytes);
  const defaultContext = await NestFactory.createApplicationContext(
    publicApi.AeoAuthoringModule.forRoot({
      hostedPlatformBundleProvider: {
        provide: publicApi.AEO_HOSTED_PLATFORM_PORT_BUNDLE,
        useValue: bundle,
      },
    }),
    { logger: false },
  );
  assert.throws(() =>
    defaultContext.get(publicApi.AEO_SAME_WORKITEM_ASSESSMENT_ADAPTER, {
      strict: false,
    }),
  );
  await defaultContext.close();

  const context = await NestFactory.createApplicationContext(
    publicApi.AeoAuthoringModule.forRoot({
      hostedPlatformBundleProvider: {
        provide: publicApi.AEO_HOSTED_PLATFORM_PORT_BUNDLE,
        useValue: bundle,
      },
      sameWorkItemAssessmentAdapterProvider:
        publicApi.provideAeoSameWorkItemAssessmentAdapter(),
    }),
    { logger: false },
  );
  try {
    const adapter = context.get(publicApi.AEO_SAME_WORKITEM_ASSESSMENT_ADAPTER);
    const assessment = JSON.parse(Buffer.from(input.assessmentActualBytes).toString('utf8'));
    const reviewed = assessment.overall.context.knowledgeContext.records[0];
    assert.equal(
      reviewed.externalDocumentVersionId,
      'document_version_c71fbc457cdc5e7a05725a4d',
    );
    const fast62 = JSON.parse(Buffer.from(input.fast62Bytes).toString('utf8'));
    const adapted = adapter.adapt({
      canonicalWorkItem: input.canonicalWorkItem,
      assessmentActualBytes: input.assessmentActualBytes,
      authoringSeed: bundle.workItem.authoringSeed,
      authoringSeedActualBytes: r09Bytes,
      aeoTargetIdentity: {
        value: 'AEO-B787-46-0015',
        confirmationStatus: 'HUMAN_CONFIRMED',
        authority: 'CANONICAL_WORKITEM_SERVER_FRESH_READ',
        confirmationRef:
          'artifact://canonical-workitem/phase6d/confirmed-aeo-target',
      },
      acceptedOemReferences: [
        {
          documentVersionId: reviewed.externalDocumentVersionId,
          parsedPackageId: fast62.packageId,
          artifactRef: reviewed.parsedPackageArtifactRef,
          artifactSha256: sha256(input.fast62Bytes),
          readerReceiptId: 'READER-FAST62-PHASE6D-LOCAL',
          readerRevision: 'canonical-host.phase6d.local',
          validationStatus: 'ACCEPTED',
          bytes: input.fast62Bytes,
        },
      ],
      observedAt: '2026-08-15T00:00:00.000Z',
    });
    assert.equal(adapted.workItem.workItemId, input.canonicalWorkItem.workItemId);
    assert.equal(adapted.workItem.sourceContext.document.documentVersionId,
      'document_version_f4813607b91ee1a20e754e2d');
    assert.equal(adapted.workItem.sourceContext.assessment.authorityLevel, 'candidate_only');
    assert.equal(adapted.authority,
      'SERVER_FRESH_READ_CANDIDATES_NOT_AUTOMATIC_ADOPTION_NOT_ENGINEERING_APPROVAL');
    Object.assign(bundle.workItem, structuredClone(adapted.workItem));
    bundle.candidates.push(...adapted.candidates);
    for (const artifact of adapted.referenceArtifacts) {
      bundle.bytes.set(artifact.artifactRef, Uint8Array.from(artifact.bytes));
    }

    const initialStateVersion = bundle.workItem.stateVersion;
    const actions = context.get(actionsApi.AeoArtifactActionService);
    const sessions = context.get(sessionsApi.AeoAuthoringSessionService);
    const common = {
      schemaVersion: integration.AEO_ARTIFACT_ACTION_VERSION,
      workItemId: bundle.workItem.workItemId,
      requestId: bundle.workItem.requestId,
      requesterRef: 'miaoda-user://local-assessment-engineer',
      permissionSnapshotVersion: bundle.workItem.permissionSnapshotVersion,
      runId: 'RUN-CANONICAL-HOST-PHASE6D-LOCAL',
    };
    const bootstrap = await actions.executeFromAuthenticatedHost({
      ...common,
      action: 'BOOTSTRAP_FROM_PARSED_PACKAGE',
      expectedStateVersion: initialStateVersion,
      idempotencyKey: 'phase6d:bootstrap',
    });
    assert.equal(
      bootstrap.status,
      'COMMITTED',
      JSON.stringify(bootstrap.blockers ?? [], null, 2),
    );
    const session = await sessions.open({
      workItemId: common.workItemId,
      requestId: common.requestId,
      requesterRef: common.requesterRef,
      permissionSnapshotVersion: common.permissionSnapshotVersion,
      expectedStateVersion: bundle.workItem.stateVersion,
    });
    assert.equal(
      session.status,
      'READY',
      JSON.stringify(session.blockers ?? [], null, 2),
    );
    const candidate = adapted.candidates[0];
    assert.ok(candidate);
    const working = await actions.executeFromAuthenticatedHost({
      ...common,
      action: 'PERSIST_WORKING_COPY',
      expectedStateVersion: initialStateVersion + 1,
      idempotencyKey: 'phase6d:working:adopt-fast62',
      expectedWorkingRevision: session.workingRevision,
      expectedContentHash: session.contentHash,
      projection: session.projection,
      transactions: session.transactions,
      candidateDisposition: {
        candidateId: candidate.candidateId,
        targetBlockId: session.projection.blockManifest[0].blockId,
        usage: 'ADOPT',
        decisionNote:
          'Phase 6D local-only explicit adoption candidate; not engineering approval.',
      },
    });
    const draft = await actions.executeFromAuthenticatedHost({
      ...common,
      action: 'FREEZE_DRAFT_PACKAGE',
      expectedStateVersion: initialStateVersion + 2,
      idempotencyKey: 'phase6d:draft',
      workingArtifactRef: working.artifact.artifactRef,
      workingArtifactSha256: working.artifact.artifactSha256,
      expectedWorkingRevision: working.artifact.workingRevision,
    });
    const word = await actions.executeFromAuthenticatedHost({
      ...common,
      action: 'EXPORT_WORD_CANDIDATE',
      expectedStateVersion: initialStateVersion + 3,
      idempotencyKey: 'phase6d:word',
      draftArtifactRef: draft.artifact.artifactRef,
      draftArtifactSha256: draft.artifact.artifactSha256,
    });
    const workingBytes = await bundle.readActualBytes(working.artifact.artifactRef);
    const workingArtifact = JSON.parse(Buffer.from(workingBytes).toString('utf8'));
    const wordBytes = await bundle.readActualBytes(word.artifact.artifactRef);
    assert.equal(Buffer.from(wordBytes).subarray(0, 2).toString('ascii'), 'PK');
    assert.equal(bundle.workItem.stateVersion, initialStateVersion + 4);
    assert.equal(bundle.workItem.workItemId, input.canonicalWorkItem.workItemId);
    assert.equal(
      workingArtifact.sourceManifest.adoptionDecisions.at(-1).usage,
      'ADOPT',
    );
    assert.equal(fast62.applicability.sourceExpressions.length, 0);
    assert.equal(fast62.applicability.normalizedCandidates.length, 0);
    assert.equal(fast62.applicability.assignments.length, 0);
    assert.equal(
      [bootstrap, working, draft, word].every(
        (result) => result.validationWriteAuthorization === null,
      ),
      true,
    );
    return {
      status: 'PHASE6D_AEO_SAME_WORKITEM_ADOPT_WORD_PASS',
      ownerCommit: '7a8403ef93b015d35f886eece4865f66741812dd',
      defaultAdapterConfigured: false,
      configuredOnlyInLocalContext: true,
      workItemId: bundle.workItem.workItemId,
      uniqueWorkItemCount: 1,
      stateVersionTransition: [initialStateVersion, bundle.workItem.stateVersion],
      assessmentAuthority: adapted.workItem.sourceContext.assessment.authorityLevel,
      reviewedOemDocumentVersionId: reviewed.externalDocumentVersionId,
      r09AuthoringSeed: {
        packageId: r09.parsePackageId,
        byteLength: r09Bytes.byteLength,
        sha256: sha256(r09Bytes),
      },
      explicitDisposition: 'ADOPT',
      artifactKinds: bundle.workItem.artifactIndex.map((entry) => entry.artifactKind),
      word: {
        artifactRef: word.artifact.artifactRef,
        byteLength: wordBytes.byteLength,
        sha256: sha256(wordBytes),
        ooxmlZipSignature: 'PK',
      },
      automaticallyAdopted: false,
      engineeringApproved: false,
      onlineWrites: 0,
      releaseCreated: false,
    };
  } finally {
    await context.close();
  }
}

function makeR09SeedWorkItem(schemaVersion, parsed, bytes) {
  const digest = sha256(bytes);
  const document = {
    documentId: 'DOC-AEO-001',
    documentVersionId: 'DOCV-AEO-001-R09',
    classificationStatus: 'CONFIRMED',
    catalogRole: 'CanonicalDocumentCatalog',
    classificationFingerprint: `sha256:${'d'.repeat(64)}`,
  };
  const parsedPackage = {
    packageId: parsed.parsePackageId,
    artifactRef: 'artifact://canonical-host/phase6d/r09-authoring-seed',
    artifactSha256: digest,
    contractId: 'aeo_structured_parse_v1',
    contractRevision: 'candidate.1',
    readerReceiptId: 'READER-AEO-PHASE6D-R09',
    readerRevision: 'aeo-structured-parse-reader.candidate.1',
    validationStatus: 'ACCEPTED',
  };
  return {
    schemaVersion,
    workItemId: 'WI-AEO-PHASE6D-SEED',
    requestId: 'REQ-AEO-PHASE6D-SEED',
    stateVersion: 1,
    permissionSnapshotVersion: 'PERM-AEO-PHASE6D-LOCAL',
    sourceDocumentFamily: 'AEO',
    authoringPurpose: 'AEO',
    aeoTargetIdentity: {
      value: 'AEO-B787-46-0015-R09',
      confirmationStatus: 'HUMAN_CONFIRMED',
      authority: 'CANONICAL_WORKITEM_SERVER_FRESH_READ',
      confirmationRef: 'artifact://phase6d/r09-target',
    },
    validationRun: null,
    sourceContext: {
      document,
      parsedPackage: {
        ...parsedPackage,
        fullValidatorRevision: parsedPackage.readerRevision,
      },
      assessment: null,
    },
    authoringSeed: {
      document: { ...document, family: 'AEO' },
      parsedPackage,
      aeoIdentity: 'AEO-B787-46-0015-R09',
    },
    aeo: {
      state: 'PARSE_READY',
      stateVersion: 'AEO-STATE-1',
      summary: 'Exact R09 authoring seed; local-only candidate.',
      blockers: [],
    },
    artifactIndex: [],
    todos: [],
    observedAt: '2026-08-15T00:00:00.000Z',
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
