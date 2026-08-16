import { createHash } from 'node:crypto';

import type {
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';
import { CanonicalHostIntegratedAssessmentService } from '../../server/modules/canonical-host/canonical-host-integrated-assessment.service';
import type {
  CanonicalAuthorizationDecision,
  CanonicalBaseRuleResultProviderPort,
  CanonicalHostActor,
  CanonicalOpenClawOverallProviderPort,
  CanonicalWorkItemRegistrarPort,
} from '../../server/modules/canonical-host/canonical-host.types';
import { UnconfiguredCanonicalBaseRuleResultProvider } from '../../server/modules/canonical-host/unconfigured-integrated-assessment.adapters';
import type { UnifiedArtifactStorePort } from '../../server/modules/unified-reader/unified-reader.types';

const ACTOR: CanonicalHostActor = {
  userId: 'engineer-test',
  tenantId: 'tenant-test',
  appId: 'app_17bzc551rsg',
  roles: ['authenticated'],
  env: 'test',
};
const PACKAGE_SHA = 'a'.repeat(64);

class MemoryRegistrar implements CanonicalWorkItemRegistrarPort {
  constructor(private value: CanonicalWorkItemProjection) {}

  async loadOrCreate() {
    return structuredClone(this.value);
  }

  async compareAndSet(input: {
    expectedRevision: number;
    next: Omit<CanonicalWorkItemProjection, 'revision'>;
  }) {
    if (input.expectedRevision !== this.value.revision) {
      throw new Error('WORK_ITEM_CAS_CONFLICT');
    }
    this.value = {
      ...structuredClone(input.next),
      revision: input.expectedRevision + 1,
    };
    return structuredClone(this.value);
  }

  async getExact() {
    return structuredClone(this.value);
  }

  async getByWorkItemId() {
    return structuredClone(this.value);
  }
}

class MemoryArtifactStore implements UnifiedArtifactStorePort {
  readonly values = new Map<string, Uint8Array>();

  async persistAndReadback(bytes: Uint8Array) {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const artifact: UnifiedPackageArtifactDescriptor = {
      storeRole: 'UnifiedArtifactStoreCandidate',
      ref: `artifact://UnifiedArtifactStoreCandidate/unified-parsed-packages/sha256/${sha256}`,
      sha256,
      byteLength: bytes.byteLength,
      mediaType: 'application/json',
    };
    const reused = this.values.has(artifact.ref);
    this.values.set(artifact.ref, Uint8Array.from(bytes));
    return { artifact, bytes: Uint8Array.from(bytes), reused };
  }

  async readActualBytes(artifact: UnifiedPackageArtifactDescriptor) {
    const bytes = this.values.get(artifact.ref);
    if (!bytes) throw new Error('ARTIFACT_NOT_FOUND');
    return Uint8Array.from(bytes);
  }
}

describe('CanonicalHostIntegratedAssessmentService', () => {
  it('fails before any mutation when the real Base provider is unconfigured', async () => {
    const registrar = { getByWorkItemId: jest.fn() };
    const repository = {
      reserveAssessmentAction: jest.fn(),
      completeAssessmentAction: jest.fn(),
      failAssessmentAction: jest.fn(),
    };
    const store = new MemoryArtifactStore();
    const service = new CanonicalHostIntegratedAssessmentService(
      registrar as never,
      authorization(),
      permissionSnapshots(),
      new UnconfiguredCanonicalBaseRuleResultProvider(),
      { configured: false, synthesize: jest.fn() } as never,
      store,
      repository as never,
    );

    await expect(
      service.persistBaseRuleCandidate('WI-TEST', ACTOR),
    ).rejects.toMatchObject({
      message: 'BASE_RULE_RESULT_PROVIDER_NOT_CONFIGURED',
      statusCode: 503,
    });
    expect(registrar.getByWorkItemId).not.toHaveBeenCalled();
    expect(repository.reserveAssessmentAction).not.toHaveBeenCalled();
    expect(store.values.size).toBe(0);
  });

  it('keeps A/B overall history on one Base revision and stales only when Base changes', async () => {
    const registrar = new MemoryRegistrar(workItem());
    const store = new MemoryArtifactStore();
    const repository = actionAttempts();
    const basePort = mutableBasePort();
    const openClawPort = mutableOverallPort();
    const service = new CanonicalHostIntegratedAssessmentService(
      registrar,
      authorization(),
      permissionSnapshots(),
      basePort,
      openClawPort,
      store,
      repository as never,
    );

    const base = await service.persistBaseRuleCandidate('WI-TEST', ACTOR);
    expect(base).toMatchObject({
      revision: 4,
      integratedAssessment: {
        status: 'BASE_RULE_CANDIDATE_READY',
        baseRules: {
          revision: 1,
          sourceResultId: 'BASE-RESULT-1',
          criterionCount: 2,
          evaluationItemCount: 2,
          unresolvedCount: 1,
        },
        overallSynthesis: null,
      },
    });

    const overallA = await service.persistOpenClawOverall('WI-TEST', ACTOR);
    expect(overallA).toMatchObject({
      revision: 5,
      integratedAssessment: {
        status: 'OVERALL_CANDIDATE_READY',
        overallSynthesis: {
          status: 'CANDIDATE_ONLY',
          revision: 1,
          basedOnBaseRuleRevision: 1,
          discoveryStatus: 'NO_DISCOVERY',
          candidateRefCount: 0,
          authorityLevel: 'candidate_only',
          staleReason: null,
        },
      },
    });

    openClawPort.sourceResultId = 'OPENCLAW-RESULT-B';
    openClawPort.discoveryStatus = 'MULTI_PROVIDER_CANDIDATE';
    openClawPort.gap =
      'BOEING:ACCESS_DENIED/UPSTREAM_CONNECT_TIMEOUT;COMAC:PARTIAL_OR_TRUNCATED';
    openClawPort.candidateRefCount = 1;
    openClawPort.artifactBytes = bytes({
      source: 'TEST_ONLY_OPENCLAW_B',
      providers: {
        airbus: { status: 'COMPLETE', match: 'DIRECT_OFFICIAL_SOURCE_MATCH' },
        boeing: {
          status: 'ACCESS_DENIED',
          accessRestricted: true,
          error: 'UPSTREAM_CONNECT_TIMEOUT',
          candidateCount: 0,
        },
        comac: {
          status: 'PARTIAL_RESULTS',
          source: 'OFFICIAL_TECHNICAL_LIST_OR_RSS',
          baiduAcceptedAsOfficial: false,
        },
      },
      adopted: false,
      usableAsEvidence: false,
    });
    const overallB = await service.persistOpenClawOverall('WI-TEST', ACTOR);
    expect(overallB).toMatchObject({
      revision: 6,
      integratedAssessment: {
        status: 'OVERALL_CANDIDATE_READY',
        baseRules: { revision: 1, sourceResultId: 'BASE-RESULT-1' },
        overallSynthesis: {
          status: 'CANDIDATE_ONLY',
          revision: 2,
          sourceResultId: 'OPENCLAW-RESULT-B',
          basedOnBaseRuleRevision: 1,
          candidateRefCount: 1,
          externalDiscoveryIsEvidence: false,
        },
      },
    });
    expect(overallB.integratedAssessment?.overallSynthesis?.artifact.ref).not.toBe(
      overallA.integratedAssessment?.overallSynthesis?.artifact.ref,
    );

    basePort.sourceResultId = 'BASE-RESULT-2';
    basePort.artifactBytes = bytes({ source: 'TEST_ONLY_BASE_RESULT_2' });
    const refreshedBase = await service.persistBaseRuleCandidate(
      'WI-TEST',
      ACTOR,
    );
    expect(refreshedBase).toMatchObject({
      revision: 7,
      integratedAssessment: {
        status: 'OVERALL_CANDIDATE_STALE',
        baseRules: { revision: 2, sourceResultId: 'BASE-RESULT-2' },
        overallSynthesis: {
          status: 'STALE',
          staleReason: 'BASE_RULE_RESULT_CHANGED',
          basedOnBaseRuleRevision: 1,
          revision: 2,
        },
      },
    });
    expect(store.values.size).toBe(4);
    expect(repository.completeAssessmentAction).toHaveBeenCalledTimes(4);
    expect(repository.failAssessmentAction).not.toHaveBeenCalled();
  });
});

function workItem(): CanonicalWorkItemProjection {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-TEST',
    requestId: 'REQ-TEST',
    revision: 3,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'permission-test',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: 'actor-test',
      decisionId: 'decision-parse',
      decisionHash: 'decision-hash',
      permissionSnapshotVersion: 'permission-test',
    },
    source: {
      documentId: 'DOC-TEST',
      documentVersionId: 'DV-TEST',
      parserRequestId: 'REQ-TEST',
      sourceArtifactId: 'SOURCE-TEST',
      sourceFileSha256: `sha256:${'b'.repeat(64)}`,
      sourceByteLength: 10,
      driveFileToken: 'file-test',
      driveSourceVersion: 'version-test',
    },
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
      classifierReleaseId: 'classifier-test',
      classifierReleaseHash: `sha256:${'c'.repeat(64)}`,
      parserProfileId: 'parser-profile:boeing.sb@1.0.0',
      parserProfileHash: `sha256:${'d'.repeat(64)}`,
      fingerprint: `sha256:${'e'.repeat(64)}`,
    },
    package: {
      packageId: 'PACKAGE-TEST',
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      artifact: {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: `artifact://package/${PACKAGE_SHA}`,
        sha256: PACKAGE_SHA,
        byteLength: 10,
        mediaType: 'application/json',
      },
      contentHash: `sha256:${'f'.repeat(64)}`,
      semanticHash: `sha256:${'1'.repeat(64)}`,
      provenanceHash: `sha256:${'2'.repeat(64)}`,
      coverageHash: `sha256:${'3'.repeat(64)}`,
      resultStatus: 'partial',
      title: 'Test only package',
      contentUnitCount: 2,
      sourceRefCount: 2,
      readerReceiptId: 'READER-TEST',
      fullValidatorProof: {
        validatorId: 'U0Frozen2SchemaSemanticValidator',
        validatorRevision: 'test',
        contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
        artifactSha256: PACKAGE_SHA,
      },
    },
    integratedAssessment: null,
    failure: null,
    recordingFailure: null,
  };
}

function mutableBasePort(): CanonicalBaseRuleResultProviderPort & {
  sourceResultId: string;
  artifactBytes: Uint8Array;
} {
  return {
    configured: true,
    sourceResultId: 'BASE-RESULT-1',
    artifactBytes: bytes({ source: 'TEST_ONLY_BASE_RESULT_1' }),
    async readResult({ workItem }) {
      return {
        sourceResultId: this.sourceResultId,
        workItemId: workItem.workItemId,
        documentVersionId: workItem.source.documentVersionId,
        packageId: workItem.package!.packageId,
        packageArtifactSha256: workItem.package!.artifact.sha256,
        criterionSetId: 'CRITERION-SET-TEST',
        criterionCount: 2,
        evaluationItemCount: 2,
        unresolvedCount: 1,
        sourceBoundCandidateCount: 1,
        artifactBytes: this.artifactBytes,
      };
    },
  };
}

function mutableOverallPort(): CanonicalOpenClawOverallProviderPort & {
  sourceResultId: string;
  discoveryStatus: string;
  gap: string | null;
  candidateRefCount: number;
  artifactBytes: Uint8Array;
} {
  return {
    configured: true,
    sourceResultId: 'OPENCLAW-RESULT-A',
    discoveryStatus: 'NO_DISCOVERY',
    gap: null,
    candidateRefCount: 0,
    artifactBytes: bytes({
      source: 'TEST_ONLY_OPENCLAW_A',
      discovery: null,
      adopted: false,
      usableAsEvidence: false,
    }),
    async synthesize({ workItem, baseRules }) {
      return {
        sourceResultId: this.sourceResultId,
        workItemId: workItem.workItemId,
        documentVersionId: workItem.source.documentVersionId,
        packageId: workItem.package!.packageId,
        baseRuleRevision: baseRules.revision,
        baseRuleArtifactSha256: baseRules.artifact.sha256,
        discoveryStatus: this.discoveryStatus,
        gap: this.gap,
        candidateRefCount: this.candidateRefCount,
        findingCount: 1,
        unresolvedCount: 1,
        authorityLevel: 'candidate_only',
        externalDiscoveryIsEvidence: false,
        artifactBytes: this.artifactBytes,
      };
    },
  };
}

function authorization() {
  return {
    async authorize(input: { action: CanonicalAuthorizationDecision['action'] }) {
      return {
        action: input.action,
        allowed: true,
        actorFingerprint: 'actor-test',
        decisionId: `decision-${input.action}`,
        decisionHash: 'decision-hash',
        permissionSnapshotVersion: 'permission-test',
      };
    },
  };
}

function permissionSnapshots() {
  return {
    async freshRead() {
      return { permissionSnapshotVersion: 'permission-test' };
    },
  };
}

function actionAttempts() {
  let count = 0;
  return {
    reserveAssessmentAction: jest.fn(async () => ({
      attemptId: `ATT-TEST-${++count}`,
      created: true,
    })),
    completeAssessmentAction: jest.fn(async () => undefined),
    failAssessmentAction: jest.fn(async () => undefined),
  };
}

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}
