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
    this.artifactIo = { persist: 0, read: 0 };
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
    this.artifactIo.persist += 1;
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
    this.artifactIo.read += 1;
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
    const reviewed = assessment.overall.context.knowledgeContext.records[0] ?? null;
    if (!input.phase10Hosted) {
      assert.equal(
        reviewed?.externalDocumentVersionId,
        'document_version_c71fbc457cdc5e7a05725a4d',
      );
    }
    const fast62 = input.fast62Bytes
      ? JSON.parse(Buffer.from(input.fast62Bytes).toString('utf8'))
      : null;
    const adapterInput = (canonicalWorkItem, assessmentActualBytes) => ({
      canonicalWorkItem,
      assessmentActualBytes,
      sourceParsedPackageActualBytes: input.sourceParsedPackageActualBytes,
      authoringSeed: bundle.workItem.authoringSeed,
      authoringSeedActualBytes: r09Bytes,
      aeoTargetIdentity: {
        value: 'AEO-B787-46-0015',
        confirmationStatus: 'HUMAN_CONFIRMED',
        authority: 'CANONICAL_WORKITEM_SERVER_FRESH_READ',
        confirmationRef:
          'artifact://canonical-workitem/phase6d/confirmed-aeo-target',
      },
      acceptedOemReferences:
        reviewed && fast62 && input.fast62Bytes
          ? [
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
            ]
          : [],
      observedAt: '2026-08-15T00:00:00.000Z',
    });
    if (input.phase10Hosted) {
      assert.equal(input.canonicalWorkItem.revision, 5);
      assert.equal(
        input.canonicalWorkItem.assessment.resynthesisAttemptId,
        'ATT-607f98a9-a2d0-401b-9515-9bd5e6059654',
      );
      assert.equal(
        input.canonicalWorkItem.assessment.artifact.sha256,
        '33fa0888b8b1756b4fdfdfbd849dddc97edc93e938e558cbb53015f16481df22',
      );
    } else {
      assert.equal(input.canonicalWorkItem.revision, 6);
      assert.equal(
        input.canonicalWorkItem.assessment.resynthesisAttemptId,
        'ATT-LOCAL-RESYNTHESIZE_ASSESSMENT-5',
      );
      assert.equal(
        input.canonicalWorkItem.assessment.artifact.sha256,
        '2113ab042ede84105f5dd976aef5ec54cb9bf794edfec79ac75844f676fa1da0',
      );
    }
    if (input.initialCandidateWorkItem && input.initialCandidateAssessmentBytes) {
      assert.throws(
        () => adapter.adapt(adapterInput(
          input.initialCandidateWorkItem,
          input.initialCandidateAssessmentBytes,
        )),
        /ASSESSMENT_EXPLICIT_RESYNTHESIS_REQUIRED/u,
      );
    }
    if (input.previousResynthesisAssessmentBytes) {
      assert.throws(
        () => adapter.adapt(adapterInput(
          input.canonicalWorkItem,
          input.previousResynthesisAssessmentBytes,
        )),
        /ASSESSMENT_ACTUAL_BYTES_MISMATCH/u,
      );
    }
    assert.deepEqual(bundle.artifactIo, { persist: 0, read: 0 });
    const adapted = adapter.adapt(adapterInput(
      input.canonicalWorkItem,
      input.assessmentActualBytes,
    ));
    assert.equal(adapted.workItem.workItemId, input.canonicalWorkItem.workItemId);
    assert.equal(adapted.workItem.sourceContext.document.documentVersionId,
      'document_version_f4813607b91ee1a20e754e2d');
    assert.equal(adapted.workItem.sourceContext.assessment.authorityLevel, 'candidate_only');
    assert.equal(adapted.authority,
      'SERVER_FRESH_READ_CANDIDATES_NOT_AUTOMATIC_ADOPTION_NOT_ENGINEERING_APPROVAL');
    assert.equal(
      adapted.candidates.some((candidate) => candidate.sourceKind === 'SB_SOURCE'),
      true,
    );
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
    let session = await sessions.open({
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
    const dispositionUsages = input.phase10Hosted
      ? ['ADOPT']
      : ['ADOPT', 'ADAPT', 'REFERENCE_ONLY', 'IGNORE'];
    const workingResults = [];
    const dispositionReadback = [];
    for (const [index, usage] of dispositionUsages.entries()) {
      const candidate = adapted.candidates[index % adapted.candidates.length];
      const targetBlock = session.projection.blockManifest[index];
      assert.ok(candidate);
      assert.ok(targetBlock);
      const workingResult = await actions.executeFromAuthenticatedHost({
        ...common,
        action: 'PERSIST_WORKING_COPY',
        expectedStateVersion: bundle.workItem.stateVersion,
        idempotencyKey:
          `${input.phase10Hosted ? 'phase10' : 'phase8'}:` +
          `working:${usage.toLowerCase()}`,
        expectedWorkingRevision: session.workingRevision,
        expectedContentHash: session.contentHash,
        projection: session.projection,
        transactions: session.transactions,
        candidateDisposition: {
          candidateId: candidate.candidateId,
          targetBlockId: targetBlock.blockId,
          usage,
          decisionNote:
            `${input.phase10Hosted ? 'Phase 10' : 'Phase 8'} ` +
            `local-only explicit ${usage}; not engineering approval.`,
        },
      });
      const workingBytes = await bundle.readActualBytes(
        workingResult.artifact.artifactRef,
      );
      const workingArtifact = JSON.parse(Buffer.from(workingBytes).toString('utf8'));
      const latestDecision = workingArtifact.sourceManifest.adoptionDecisions.at(-1);
      assert.equal(latestDecision.usage, usage);
      dispositionReadback.push({
        usage,
        candidateId: candidate.candidateId,
        decisionRef: latestDecision.decisionRef,
        workingRevision: workingResult.artifact.workingRevision,
      });
      workingResults.push(workingResult);
      session = await sessions.open({
        workItemId: common.workItemId,
        requestId: common.requestId,
        requesterRef: common.requesterRef,
        permissionSnapshotVersion: common.permissionSnapshotVersion,
        expectedStateVersion: bundle.workItem.stateVersion,
      });
      assert.equal(session.status, 'READY');
    }
    const working = workingResults.at(-1);
    assert.ok(working);
    const draft = await actions.executeFromAuthenticatedHost({
      ...common,
      action: 'FREEZE_DRAFT_PACKAGE',
      expectedStateVersion: bundle.workItem.stateVersion,
      idempotencyKey: 'phase8:draft',
      workingArtifactRef: working.artifact.artifactRef,
      workingArtifactSha256: working.artifact.artifactSha256,
      expectedWorkingRevision: working.artifact.workingRevision,
    });
    const word = await actions.executeFromAuthenticatedHost({
      ...common,
      action: 'EXPORT_WORD_CANDIDATE',
      expectedStateVersion: bundle.workItem.stateVersion,
      idempotencyKey: 'phase8:word',
      draftArtifactRef: draft.artifact.artifactRef,
      draftArtifactSha256: draft.artifact.artifactSha256,
    });
    const wordBytes = await bundle.readActualBytes(word.artifact.artifactRef);
    assert.equal(Buffer.from(wordBytes).subarray(0, 2).toString('ascii'), 'PK');
    assert.equal(
      bundle.workItem.stateVersion,
      initialStateVersion + dispositionUsages.length + 3,
    );
    assert.equal(bundle.workItem.workItemId, input.canonicalWorkItem.workItemId);
    assert.deepEqual(dispositionReadback.map((value) => value.usage), dispositionUsages);
    if (fast62) {
      assert.equal(fast62.applicability.sourceExpressions.length, 0);
      assert.equal(fast62.applicability.normalizedCandidates.length, 0);
      assert.equal(fast62.applicability.assignments.length, 0);
    }
    const sourcePackage = JSON.parse(
      Buffer.from(input.sourceParsedPackageActualBytes).toString('utf8'),
    );
    assert.equal(sourcePackage.applicability.sourceExpressions.length, 0);
    assert.equal(sourcePackage.applicability.normalizedCandidates.length, 0);
    assert.equal(sourcePackage.applicability.assignments.length, 0);
    assert.equal(
      [bootstrap, ...workingResults, draft, word].every(
        (result) => result.validationWriteAuthorization === null,
      ),
      true,
    );
    return {
      status: input.phase10Hosted
        ? 'PHASE10_AEO_HOSTED_INPUT_LOCAL_REPLAY_PASS'
        : 'PHASE8_AEO_CURRENT_RESYNTHESIS_TO_WORD_PASS',
      ownerCommit: '8a2ea67aea5d60c0c72750a9e539404214296aeb',
      defaultAdapterConfigured: false,
      configuredOnlyInLocalContext: true,
      workItemId: bundle.workItem.workItemId,
      uniqueWorkItemCount: 1,
      stateVersionTransition: [initialStateVersion, bundle.workItem.stateVersion],
      assessmentAuthority: adapted.workItem.sourceContext.assessment.authorityLevel,
      currentAssessment: {
        workItemRevision: input.canonicalWorkItem.revision,
        resynthesisAttemptId:
          input.canonicalWorkItem.assessment.resynthesisAttemptId,
        artifactSha256: input.canonicalWorkItem.assessment.artifact.sha256,
      },
      rejectedBeforeAeoArtifactIo: {
        initialCandidate: 'ASSESSMENT_EXPLICIT_RESYNTHESIS_REQUIRED',
        previousResynthesis: 'ASSESSMENT_ACTUAL_BYTES_MISMATCH',
        observedIo: { persist: 0, read: 0 },
      },
      reviewedOemDocumentVersionId:
        reviewed?.externalDocumentVersionId ?? null,
      sourceCandidateCount: adapted.candidates.filter(
        (candidate) => candidate.sourceKind === 'SB_SOURCE',
      ).length,
      r09AuthoringSeed: {
        packageId: r09.parsePackageId,
        byteLength: r09Bytes.byteLength,
        sha256: sha256(r09Bytes),
      },
      explicitDispositions: dispositionReadback,
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
