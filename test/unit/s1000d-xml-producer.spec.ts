import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import type {
  CanonicalS1000dVerticalRunRequest,
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';
import { CanonicalEntryFacadeService } from '../../server/modules/canonical-host/canonical-entry-facade.service';
import { CanonicalHostVerticalService } from '../../server/modules/canonical-host/canonical-host-vertical.service';
import { scopedProfessionalArtifactRef } from '../../server/modules/canonical-host/scoped-professional-artifact-correlation.port';
import type {
  ScopedProfessionalArtifactCorrelation,
  ScopedProfessionalArtifactCorrelationPort,
} from '../../server/modules/canonical-host/scoped-professional-artifact-correlation.port';
import type {
  CanonicalAuthorizationDecision,
  CanonicalWorkItemRegistrarPort,
} from '../../server/modules/canonical-host/canonical-host.types';
import {
  jcsCanonicalize,
  sha256Hex,
  techpubEntityId,
} from '../../server/modules/professional-input/pure/canonical-hash';
import { S1000dIngressService } from '../../server/modules/s1000d-ingress/s1000d-ingress.service';
import type {
  ResolvedS1000dDocumentSource,
  S1000dAuthorizedSourceArtifact,
  S1000dDocumentSourcePort,
  S1000dSourceUseAuthorization,
} from '../../server/modules/s1000d-ingress/s1000d-ingress.types';
import { S1000dXmlStructuredPackageProducerAdapter } from '../../server/modules/s1000d-ingress/s1000d-xml-structured-package-producer.adapter';
import { PythonU0FullPackageValidatorAdapter } from '../../server/modules/unified-reader/python-u0-full-package-validator.adapter';
import { Frozen2CandidateReaderService } from '../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { U0FullValidationService } from '../../server/modules/unified-reader/u0-full-validation.service';
import { UnifiedReaderService } from '../../server/modules/unified-reader/unified-reader.service';
import type {
  ImmutableArtifactPersistResult,
  UnifiedArtifactStorePort,
} from '../../server/modules/unified-reader/unified-reader.types';
import { sha256Raw } from '../../server/modules/unified-reader/unified-reader.utils';

const CONTRACT_ROOT = resolve(
  'server/runtime-assets/technical-publication-parsed-package/v1-frozen-2',
);
const SOURCE_ROOT = resolve(
  CONTRACT_ROOT,
  'fixtures/source/native-s1000d-issue-4-2',
);
const SOURCE_PATHS = [
  'DDN-FIXTURE.XML',
  'DMC-FIXTURE.XML',
  'DML-FIXTURE.XML',
  'ICN-FIXTURE-001.png',
  'PMC-FIXTURE.XML',
  'SCHEMA/ddn.xsd',
  'SCHEMA/descript.xsd',
  'SCHEMA/dml.xsd',
  'SCHEMA/pm.xsd',
] as const;

describe('real-byte S1000D XML producer', () => {
  jest.setTimeout(120_000);

  it('parses all nine repository-controlled source bytes into a fresh frozen.2 U0 candidate', async () => {
    const corpus = await loadCorpus();
    const fixture = fixtureComposition(corpus);
    const diagnosticCandidate =
      await new S1000dXmlStructuredPackageProducerAdapter().produce({
        source: fixture.resolved,
        artifacts: packageSources(fixture.authorization, corpus),
        authorization: fixture.authorization,
      });
    const diagnostic = validatePackageDiagnostic(diagnosticCandidate.bytes);
    expect(diagnostic).toMatchObject({ ok: true, errors: [] });
    const service = new S1000dIngressService(
      fixture.source,
      fixture.authorizer,
      new S1000dXmlStructuredPackageProducerAdapter(),
      fullValidator(),
    );

    const prepared = await service.prepare(
      {
        workItemId: 's1000d-xml-work-item',
        requestId: 's1000d-xml-request',
        documentVersionId: fixture.resolved.documentVersionId,
      },
      {
        userId: 'fixture-user',
        tenantId: 'fixture-tenant',
        appId: 'fixture-app',
        roles: ['fixture-role'],
        env: 'test',
      },
    );

    const pkg = JSON.parse(
      new TextDecoder().decode(prepared.produced.bytes),
    ) as Record<string, any>;
    expect(prepared.produced.producerId).toBe('WiseLinkS1000dXmlProducer');
    expect(prepared.summary).toEqual({
      resultStatus: 'complete',
      contentUnitCount: 13,
      sourceRefCount: 24,
      authorizedSourceArtifactCount: 9,
    });
    expect(pkg.source).toMatchObject({
      kind: 'native_s1000d',
      artifactIds: expect.arrayContaining(
        fixture.authorization.authorizedSourceManifest.map(
          (artifact) => artifact.packageArtifactId,
        ),
      ),
    });
    expect(pkg.lineage.producer).toMatchObject({
      name: 'WiseLinkS1000dXmlProducer',
      runtime: 'typescript',
    });
    expect(pkg.contentUnits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'step',
          payload: expect.objectContaining({
            instructionText: 'Disconnect the synthetic test power source.',
          }),
        }),
        expect.objectContaining({
          kind: 'advisory',
          payload: expect.objectContaining({ advisoryType: 'warning' }),
        }),
        expect.objectContaining({ kind: 'table' }),
        expect.objectContaining({ kind: 'figure' }),
        expect.objectContaining({ kind: 'reference' }),
      ]),
    );
    expect(pkg.applicability).toMatchObject({
      sourceExpressions: [
        expect.objectContaining({ text: 'TEST ASSET GROUP ALPHA ONLY' }),
      ],
      normalizedCandidates: [],
    });
  });

  it('derives package content from XML bytes instead of returning a prebuilt fixture package', async () => {
    const original = await loadCorpus();
    const changed = new Map(original);
    const dmc = new TextDecoder().decode(changed.get('DMC-FIXTURE.XML'));
    changed.set(
      'DMC-FIXTURE.XML',
      new TextEncoder().encode(
        dmc.replace(
          'Disconnect the synthetic test power source.',
          'Isolate the changed synthetic source.',
        ),
      ),
    );
    const before = fixtureComposition(original);
    const after = fixtureComposition(changed);
    const producer = new S1000dXmlStructuredPackageProducerAdapter();
    const beforeResult = await producer.produce({
      source: before.resolved,
      artifacts: packageSources(before.authorization, original),
      authorization: before.authorization,
    });
    const afterResult = await producer.produce({
      source: after.resolved,
      artifacts: packageSources(after.authorization, changed),
      authorization: after.authorization,
    });
    const afterPackage = JSON.parse(
      new TextDecoder().decode(afterResult.bytes),
    ) as Record<string, any>;

    expect(afterResult.packageId).not.toBe(beforeResult.packageId);
    expect(afterPackage.contentUnits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'step',
          payload: expect.objectContaining({
            instructionText: 'Isolate the changed synthetic source.',
          }),
        }),
      ]),
    );
  });
});

describe('canonical Host S1000D vertical', () => {
  jest.setTimeout(120_000);

  it('publishes once through correlation/CAS and serves existing Reader browse/query with a redacted response', async () => {
    const fixture = await verticalFixture();
    const response = await fixture.vertical.runS1000d(fixture.request, ACTOR);
    const current = await fixture.registrar.getExact({
      workItemId: fixture.request.workItemId,
      requestId: fixture.request.requestId,
      documentVersionId: fixture.request.source.documentVersionId,
    });
    const browse = await fixture.vertical.browseStructuredContent(
      { workItemId: fixture.request.workItemId },
      ACTOR,
    );
    const query = await fixture.vertical.query(
      {
        workItemId: fixture.request.workItemId,
        requestId: fixture.request.requestId,
        documentVersionId: fixture.request.source.documentVersionId,
        query: 'synthetic',
      },
      ACTOR,
    );

    expect(response).toMatchObject({
      status: 'CANDIDATE_VERTICAL_VERIFIED',
      sourceKind: 'native_s1000d',
      summary: {
        resultStatus: 'complete',
        contentUnitCount: 13,
        sourceRefCount: 24,
        authorizedSourceArtifactCount: 9,
      },
      boundary: {
        professionalArtifactCorrelated: true,
        workItemCurrentPublished: true,
        readerProjectionCreated: true,
        internalIdentityExposed: false,
      },
    });
    expectBrowserSafe(response);
    expect(current).toMatchObject({
      phase: 'CANDIDATE_READBACK_VERIFIED',
      revision: 3,
      package: {
        contentUnitCount: 13,
        sourceRefCount: 24,
        usagePolicy: {
          presentationMode: 'REFERENCE_ONLY',
          assessmentAutoAdoptionAllowed: false,
          aeoAutoAdoptionAllowed: false,
          applicability: {
            sourceExpressionCount: 1,
            normalizedCandidateCount: 0,
            assignmentCount: 1,
          },
        },
      },
    });
    expect(browse).toMatchObject({
      mode: 'BROWSE',
      totalSourceUnitCount: 13,
      sourceRefCount: 24,
    });
    expect(query.readback.queryResults.length).toBeGreaterThan(0);
    expect(fixture.events).toEqual([
      'correlation:persist',
      'correlation:actual-byte-readback',
      'reader:persist',
    ]);
  });

  it('rejects a producer-after WorkItem drift before correlation and never publishes current', async () => {
    const fixture = await verticalFixture();
    fixture.registrar.driftOnExactCall = 1;

    await expect(
      fixture.vertical.runS1000d(fixture.request, ACTOR),
    ).rejects.toMatchObject({
      code: 'S1000D_WORK_ITEM_DRIFT',
      statusCode: 409,
    });
    const current = fixture.registrar.snapshot(fixture.request.workItemId);
    expect(current).toMatchObject({ phase: 'PARSING', package: null });
    expect(current.revision).toBe(3);
    expect(fixture.events).toEqual([]);
  });

  it('rejects a producer result whose fresh source identity differs from the reserved request', async () => {
    const fixture = await verticalFixture();
    fixture.request.source.driveSourceVersion = 'stale-provider-version';

    await expect(
      fixture.vertical.runS1000d(fixture.request, ACTOR),
    ).rejects.toMatchObject({
      code: 'S1000D_REQUEST_SOURCE_DRIFT',
      statusCode: 409,
    });
    expect(
      fixture.registrar.snapshot(fixture.request.workItemId),
    ).toMatchObject({ phase: 'PARSING', revision: 2, package: null });
    expect(fixture.events).toEqual([]);
  });

  it('rejects WorkItem drift after actual-byte persistence without publishing current', async () => {
    const fixture = await verticalFixture();
    fixture.registrar.driftOnExactCall = 2;

    await expect(
      fixture.vertical.runS1000d(fixture.request, ACTOR),
    ).rejects.toMatchObject({
      code: 'S1000D_WORK_ITEM_DRIFT',
      statusCode: 409,
    });
    const current = fixture.registrar.snapshot(fixture.request.workItemId);
    expect(current).toMatchObject({ phase: 'PARSING', package: null });
    expect(current.revision).toBe(3);
    expect(fixture.events).toEqual([
      'correlation:persist',
      'correlation:actual-byte-readback',
      'reader:persist',
    ]);
  });

  it('keeps the attempt artifact private when final publication CAS loses', async () => {
    const fixture = await verticalFixture();
    fixture.registrar.rejectVerifiedCas = true;

    await expect(
      fixture.vertical.runS1000d(fixture.request, ACTOR),
    ).rejects.toThrow('WORK_ITEM_CAS_CONFLICT');
    const current = fixture.registrar.snapshot(fixture.request.workItemId);
    expect(current).toMatchObject({
      phase: 'PARSING',
      revision: 2,
      package: null,
    });
    expect(fixture.events).toEqual([
      'correlation:persist',
      'correlation:actual-byte-readback',
      'reader:persist',
    ]);
  });
});

const ACTOR = {
  userId: 'fixture-user',
  tenantId: 'fixture-tenant',
  appId: 'fixture-app',
  roles: ['fixture-role'],
  env: 'test',
};

async function verticalFixture() {
  const corpus = await loadCorpus();
  const fixture = fixtureComposition(corpus);
  const ingress = new S1000dIngressService(
    fixture.source,
    fixture.authorizer,
    new S1000dXmlStructuredPackageProducerAdapter(),
    fullValidator(),
  );
  const registrar = new BarrierRegistrar();
  const events: string[] = [];
  const store = new VerticalArtifactStore(events);
  const reader = new UnifiedReaderService(
    store,
    new Frozen2CandidateReaderService(),
    fullValidator(),
    {
      mode: 'HOST_CONFIGURED',
      artifactStoreConfigured: true,
      fullU0ValidatorConfigured: true,
      immutableAcceptanceReceiptOwnerConfigured: false,
      aeoSpecialistReaderConfigured: false,
      authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
    },
  );
  const correlation = new VerticalCorrelation(events);
  const vertical = new CanonicalHostVerticalService(
    registrar,
    {
      producePdf: async () => {
        throw new Error('PDF_NOT_IN_SCOPE');
      },
    },
    {
      authorize: async (input) => ({
        action: input.action,
        allowed: true,
        actorFingerprint: `sha256:${'a'.repeat(64)}`,
        decisionId: 'fixture-canonical-decision',
        decisionHash: `sha256:${'b'.repeat(64)}`,
        permissionSnapshotVersion: 'fixture-canonical-permission-snapshot',
      }),
    },
    {
      freshRead: async () => ({
        permissionSnapshotVersion: 'fixture-canonical-permission-snapshot',
      }),
    },
    store,
    reader,
    new CanonicalEntryFacadeService({
      deepLinkForWorkItem: (workItemId: string) => ({
        bindingStatus: 'VERIFIED_CANONICAL',
        appId: 'fixture-app',
        origin: 'https://fixture.invalid',
        deepLink: `https://fixture.invalid/work-items/${workItemId}/documents`,
      }),
    }),
    {} as never,
    null,
    undefined,
    ingress,
    correlation,
  );
  const request: CanonicalS1000dVerticalRunRequest = {
    schemaVersion: 'wiselink.3_1.canonical_s1000d_vertical_request.v1',
    workItemId: 's1000d-canonical-work-item',
    requestId: 's1000d-canonical-request',
    source: {
      documentId: fixture.resolved.documentId,
      documentVersionId: fixture.resolved.documentVersionId,
      parserRequestId: 's1000d-canonical-request',
      sourceArtifactId: fixture.resolved.sourceArtifactId,
      sourceFileSha256: `sha256:${fixture.resolved.sha256}`,
      sourceByteLength: fixture.resolved.byteLength,
      driveFileToken: fixture.resolved.providerObjectId,
      driveSourceVersion: fixture.resolved.providerVersionId,
    },
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'S1000D',
      classifierReleaseId: 'structured-source:s1000d-xml-v1.1',
      classifierReleaseHash: `sha256:${'c'.repeat(64)}`,
      parserProfileId: 'parser-profile:s1000d.native-xml.v1.1',
      parserProfileHash: `sha256:${'d'.repeat(64)}`,
      fingerprint: `sha256:${'e'.repeat(64)}`,
    },
    query: 'synthetic',
  };
  return { vertical, request, registrar, events };
}

class BarrierRegistrar implements CanonicalWorkItemRegistrarPort {
  private readonly values = new Map<string, CanonicalWorkItemProjection>();
  private exactCallCount = 0;
  driftOnExactCall: number | null = null;
  rejectVerifiedCas = false;

  async loadOrCreate(
    seed: Omit<CanonicalWorkItemProjection, 'revision'>,
  ): Promise<CanonicalWorkItemProjection> {
    const existing = this.values.get(seed.workItemId);
    if (existing) return structuredClone(existing);
    const created = { ...seed, revision: 1 };
    this.values.set(seed.workItemId, structuredClone(created));
    return structuredClone(created);
  }

  async compareAndSet(input: {
    workItemId: string;
    expectedRevision: number;
    next: Omit<CanonicalWorkItemProjection, 'revision'>;
  }): Promise<CanonicalWorkItemProjection> {
    const current = this.values.get(input.workItemId);
    if (
      !current ||
      current.revision !== input.expectedRevision ||
      (this.rejectVerifiedCas &&
        input.next.phase === 'CANDIDATE_READBACK_VERIFIED')
    ) {
      throw new Error('WORK_ITEM_CAS_CONFLICT');
    }
    const next = { ...input.next, revision: current.revision + 1 };
    this.values.set(input.workItemId, structuredClone(next));
    return structuredClone(next);
  }

  async getExact(input: {
    workItemId: string;
    requestId: string;
    documentVersionId: string;
  }): Promise<CanonicalWorkItemProjection> {
    this.exactCallCount += 1;
    let current = this.values.get(input.workItemId);
    if (
      !current ||
      current.requestId !== input.requestId ||
      current.source.documentVersionId !== input.documentVersionId
    ) {
      throw new Error('WORK_ITEM_NOT_FOUND');
    }
    if (this.driftOnExactCall === this.exactCallCount) {
      this.driftOnExactCall = null;
      current = { ...current, revision: current.revision + 1 };
      this.values.set(input.workItemId, structuredClone(current));
    }
    return structuredClone(current);
  }

  async getTenantScopedByWorkItemId(input: {
    workItemId: string;
    tenantId: string;
  }): Promise<CanonicalWorkItemProjection> {
    if (!input.tenantId) throw new Error('WORK_ITEM_NOT_FOUND');
    return this.snapshot(input.workItemId);
  }

  snapshot(workItemId: string): CanonicalWorkItemProjection {
    const value = this.values.get(workItemId);
    if (!value) throw new Error('WORK_ITEM_NOT_FOUND');
    return structuredClone(value);
  }
}

class VerticalArtifactStore implements UnifiedArtifactStorePort {
  private readonly values = new Map<string, Uint8Array>();

  constructor(private readonly events: string[]) {}

  async persistAndReadback(
    bytes: Uint8Array,
  ): Promise<ImmutableArtifactPersistResult> {
    this.events.push('reader:persist');
    const sha256 = sha256Raw(bytes);
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

  async readActualBytes(
    artifact: UnifiedPackageArtifactDescriptor,
  ): Promise<Uint8Array> {
    const bytes = this.values.get(artifact.ref);
    if (!bytes) throw new Error('ARTIFACT_NOT_FOUND');
    return Uint8Array.from(bytes);
  }
}

class VerticalCorrelation implements ScopedProfessionalArtifactCorrelationPort {
  readonly available = true;
  private readonly bytes = new Map<string, Uint8Array>();

  constructor(private readonly events: string[]) {}

  async persistAndCorrelate(
    request: Parameters<
      ScopedProfessionalArtifactCorrelationPort['persistAndCorrelate']
    >[0],
    produced: Parameters<
      ScopedProfessionalArtifactCorrelationPort['persistAndCorrelate']
    >[1],
  ): Promise<ScopedProfessionalArtifactCorrelation> {
    this.events.push('correlation:persist');
    const providerObjectId = `provider-professional:${produced.packageId}`;
    this.bytes.set(providerObjectId, Uint8Array.from(produced.bytes));
    return {
      schemaVersion: 'wiselink.3_1.scoped_professional_artifact_correlation.v1',
      status: 'HOST_SCOPE_BOUND_IMMUTABLE',
      scope: {
        workItemId: request.workItemId,
        documentVersionId: request.documentVersionId,
      },
      source: {
        documentId: request.documentId,
        sourceArtifactId: request.sourceArtifactId,
        sha256: request.sourceSha256,
        byteLength: request.sourceByteLength,
        providerObjectId: request.sourceProviderObjectId,
      },
      profile: { ...request.classification },
      professionalArtifact: {
        professionalArtifactId: produced.packageId,
        ownerWorkItemId: request.workItemId,
        ownerDocumentVersionId: request.documentVersionId,
        packageId: produced.packageId,
        artifact: {
          ...produced.artifact,
          ref: scopedProfessionalArtifactRef(request, produced.packageId),
        },
        fileServiceLocator: {
          bucketId: 'fixture-professional-bucket',
          filePath: `/professional/${produced.packageId}.json`,
          providerObjectId,
        },
      },
      lineage: { ...produced.lineage },
    };
  }

  async readActualBytes(correlation: ScopedProfessionalArtifactCorrelation) {
    this.events.push('correlation:actual-byte-readback');
    const providerObjectId =
      correlation.professionalArtifact.fileServiceLocator.providerObjectId;
    const bytes = this.bytes.get(providerObjectId);
    if (!bytes) throw new Error('PROFESSIONAL_ARTIFACT_NOT_FOUND');
    return {
      verified: true as const,
      bytes: Uint8Array.from(bytes),
      providerObjectId,
      sha256: sha256Raw(bytes),
      byteLength: bytes.byteLength,
    };
  }
}

function expectBrowserSafe(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toMatch(
    /"(?:decisionId|unitId|documentVersionId|packageId|sourceRefIds|sourceArtifactId|artifactId|artifactRef|requestId|workItemId|sha256|fileServiceLocator|xpath|elementId)"\s*:/u,
  );
}

async function loadCorpus(): Promise<Map<string, Uint8Array>> {
  return new Map(
    await Promise.all(
      SOURCE_PATHS.map(
        async (path) =>
          [
            path,
            Uint8Array.from(await readFile(resolve(SOURCE_ROOT, path))),
          ] as const,
      ),
    ),
  );
}

function fixtureComposition(corpus: Map<string, Uint8Array>) {
  const manifest = authorizedManifest(corpus);
  const primary = manifest.find(
    (artifact) => artifact.normalizedPath === 'DMC-FIXTURE.XML',
  );
  if (!primary) throw new Error('TEST_PRIMARY_MISSING');
  const resolved: ResolvedS1000dDocumentSource = {
    familyId: 'fixture-family',
    currentGeneration: 1,
    documentId: 'fixture-document',
    documentVersionId: 'fixture-document-version',
    revisionId: 'fixture-revision',
    canonicalRevisionIdentity: '001-00',
    committedAt: '2026-08-30T00:00:00.000Z',
    sourceArtifactId: primary.hostSourceArtifactId,
    originalFilename: primary.normalizedPath,
    mediaType: 'application/xml',
    sha256: primary.sha256,
    byteLength: primary.byteLength,
    providerObjectId: primary.providerObjectId,
    providerVersionId: primary.providerVersionId,
    fileServiceLocator: { ...primary.fileServiceLocator },
  };
  const authorization: S1000dSourceUseAuthorization = {
    status: 'AUTHORIZED',
    decisionId: 'repository-fixture-authorization',
    permissionSnapshotVersion: 'repository-fixture-permission-snapshot',
    sourceClass: 'REPOSITORY_CONTROLLED_SYNTHETIC_FIXTURE',
    sourceArtifactId: resolved.sourceArtifactId,
    documentVersionId: resolved.documentVersionId,
    processingAllowed: true,
    canonicalPackageStorageAllowed: true,
    browserProjectionAllowed: true,
    sourceRedistributionAllowed: false,
    processingAuthorizationRef: null,
    redistributionAuthorizationRef: null,
    authorizedSourceManifest: manifest,
  };
  const source: S1000dDocumentSourcePort = {
    available: true,
    resolveCurrent: async () => structuredClone(resolved),
    readActualBytes: async () =>
      Uint8Array.from(corpus.get('DMC-FIXTURE.XML') as Uint8Array),
    readAuthorizedActualBytes: async (artifact) =>
      Uint8Array.from(corpus.get(artifact.normalizedPath) as Uint8Array),
  };
  return {
    resolved,
    authorization,
    source,
    authorizer: {
      available: true,
      authorize: async () => structuredClone(authorization),
    },
  };
}

function authorizedManifest(
  corpus: Map<string, Uint8Array>,
): S1000dAuthorizedSourceArtifact[] {
  const provisional = SOURCE_PATHS.map((normalizedPath) => {
    const bytes = corpus.get(normalizedPath) as Uint8Array;
    const role = normalizedPath.endsWith('.png')
      ? 'information_entity'
      : normalizedPath.endsWith('.xsd')
        ? 'schema'
        : 'xml';
    const mediaType = normalizedPath.endsWith('.png')
      ? 'image/png'
      : 'application/xml';
    const sha256 = sha256Hex(bytes);
    const identity = {
      namespace: 'techpub-artifact-id-v1',
      origin: 'source',
      role,
      sha256: `sha256:${sha256}`,
      mediaType,
      byteLength: bytes.byteLength,
      normalizedPath,
    };
    return {
      packageArtifactId: techpubEntityId(
        'artifact',
        sha256Hex(jcsCanonicalize(identity)),
      ),
      hostSourceArtifactId: `host-source:${normalizedPath}`,
      packageRole: role,
      normalizedPath,
      mediaType,
      sha256,
      byteLength: bytes.byteLength,
      providerObjectId: `provider-object:${normalizedPath}`,
      providerVersionId: `provider-version:${normalizedPath}`,
      fileServiceLocator: {
        bucketId: 'fixture-bucket',
        filePath: `/document-management/source/${normalizedPath}`,
      },
      authorizationEvidenceRef: `repository://frozen.2/${normalizedPath}`,
    };
  });
  const primary = provisional.find(
    (artifact) => artifact.normalizedPath === 'DMC-FIXTURE.XML',
  );
  if (!primary) throw new Error('TEST_PRIMARY_MISSING');
  return provisional.map((artifact) => ({
    ...artifact,
    dependency:
      artifact === primary
        ? {
            kind: 'PRIMARY_DOCUMENT_VERSION' as const,
            documentVersionId: 'fixture-document-version',
          }
        : {
            kind: 'AUTHORIZED_DEPENDENCY' as const,
            parentPackageArtifactId: primary.packageArtifactId,
            relationship: relationshipFor(artifact.normalizedPath),
          },
  }));
}

function relationshipFor(
  path: string,
): Extract<
  S1000dAuthorizedSourceArtifact['dependency'],
  { kind: 'AUTHORIZED_DEPENDENCY' }
>['relationship'] {
  if (path.startsWith('SCHEMA/')) return 'SCHEMA_BINDING';
  if (path.endsWith('.png')) return 'INFORMATION_ENTITY_REFERENCE';
  if (path.startsWith('PMC-')) return 'PM_REFERENCE';
  return 'DELIVERY_MANIFEST';
}

function packageSources(
  authorization: S1000dSourceUseAuthorization,
  corpus: Map<string, Uint8Array>,
) {
  return authorization.authorizedSourceManifest.map((artifact) => ({
    authorization: artifact,
    actualBytes: Uint8Array.from(
      corpus.get(artifact.normalizedPath) as Uint8Array,
    ),
  }));
}

function fullValidator(): U0FullValidationService {
  return new U0FullValidationService(
    new PythonU0FullPackageValidatorAdapter({
      pythonExecutable: process.env.WL_TEST_U0_PYTHON?.trim() || 'python3',
      contractRoot: CONTRACT_ROOT,
      contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
      validatorRevision: 's1000d-xml-producer-test',
    }),
  );
}

function validatePackageDiagnostic(bytes: Uint8Array): Record<string, unknown> {
  const code = [
    'import json,sys',
    'from pathlib import Path',
    'root=Path(sys.argv[1])',
    'sys.path.insert(0,str(root))',
    'from scripts.contract_core import validate_package',
    'value=json.load(sys.stdin)',
    'print(json.dumps(validate_package(value,contract_root=root,artifact="stdin",mode="strict").as_dict()))',
  ].join(';');
  const result = spawnSync('python3', ['-c', code, CONTRACT_ROOT], {
    input: Buffer.from(bytes),
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}
