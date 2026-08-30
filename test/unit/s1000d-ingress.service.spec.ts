import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';

import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import { S1000dIngressService } from '../../server/modules/s1000d-ingress/s1000d-ingress.service';
import type {
  ResolvedS1000dDocumentSource,
  S1000dAuthorizedSourceArtifact,
  S1000dDocumentSourcePort,
  S1000dSourceUseAuthorization,
  S1000dSourceUseAuthorizerPort,
  S1000dStructuredPackageProducerPort,
} from '../../server/modules/s1000d-ingress/s1000d-ingress.types';
import { UnconfiguredS1000dSourceUseAuthorizerAdapter } from '../../server/modules/s1000d-ingress/unconfigured-s1000d-source-use-authorizer.adapter';
import { UnconfiguredS1000dStructuredPackageProducerAdapter } from '../../server/modules/s1000d-ingress/unconfigured-s1000d-structured-package-producer.adapter';
import { Frozen2CandidateReaderService } from '../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { PythonU0FullPackageValidatorAdapter } from '../../server/modules/unified-reader/python-u0-full-package-validator.adapter';
import { U0FullValidationService } from '../../server/modules/unified-reader/u0-full-validation.service';
import { sha256Raw } from '../../server/modules/unified-reader/unified-reader.utils';

const CONTRACT_ROOT = resolve(
  'server/runtime-assets/technical-publication-parsed-package/v1-frozen-2',
);
const SOURCE_PATH = resolve(
  CONTRACT_ROOT,
  'fixtures/source/minimal-s1000d.xml',
);
const PACKAGE_PATH = resolve(
  CONTRACT_ROOT,
  'fixtures/positive/minimal-native-s1000d-complete.json',
);
const RICH_PACKAGE_PATH = resolve(
  CONTRACT_ROOT,
  'fixtures/positive/rich-native-s1000d-issue-4-2.json',
);
const RICH_SOURCE_ROOT = resolve(
  CONTRACT_ROOT,
  'fixtures/source/native-s1000d-issue-4-2',
);
const SERVICE_PATH = resolve(
  'server/modules/s1000d-ingress/s1000d-ingress.service.ts',
);
const MINIMAL_PACKAGE_ARTIFACT_ID =
  'urn:techpub:artifact:v1:sha256:a71f4ec46d19500a6f1d745420e1d679c3a7737f398512579d22a221e5f780e9';

interface FixturePackageArtifact {
  artifactId: string;
  origin: string;
  role: string;
  normalizedPath: string;
  mediaType: string;
  sha256: string;
  byteLength: number;
}

interface FixtureSourceRef {
  sourceRefId: string;
  artifactId: string;
}

interface FixturePackage {
  packageId: string;
  artifacts: FixturePackageArtifact[];
  source: { artifactIds: string[] };
  sourceRefs: FixtureSourceRef[];
}

const ACTOR: CanonicalHostActor = {
  userId: 'fixture-user',
  tenantId: 'fixture-tenant',
  appId: 'fixture-app',
  roles: ['fixture-role'],
  env: 'test',
};

describe('S1000D V1.1 ingress adapter seam', () => {
  it('returns only a U0-validated, non-persisted candidate status for repository-controlled SYNTHETIC bytes', async () => {
    const sourceBytes = Uint8Array.from(await readFile(SOURCE_PATH));
    const packageBytes = Uint8Array.from(await readFile(PACKAGE_PATH));
    const parsed = fixturePackage(packageBytes);
    const events: string[] = [];
    const service = new S1000dIngressService(
      fixtureSource(sourceBytes, events),
      fixtureAuthorization(events),
      fixtureProducer(packageBytes, parsed.packageId, events),
      fullValidator(),
    );

    const response = await service.ingest(
      candidateRequest('fixture'),
      ACTOR,
    );

    expect(events).toEqual([
      'resolve',
      'authorize',
      'read-bytes',
      'produce',
      'resolve',
    ]);
    expect(response).toEqual({
      schemaVersion: 'wiselink.3_1.s1000d_ingress_candidate_status.v1',
      status: 'CANDIDATE_U0_VALIDATED',
      sourceKind: 'native_s1000d',
      contract: {
        id: 'techpub.parsed-package.v1',
        revision: 'frozen.2',
        validatorStatus: 'FULL_STRICT_VALIDATOR_PASSED',
      },
      summary: {
        resultStatus: 'complete',
        contentUnitCount: 2,
        sourceRefCount: 1,
        authorizedSourceArtifactCount: 1,
      },
      boundary: {
        currentDocumentVersionRechecked: true,
        canonicalArtifactPersisted: false,
        professionalArtifactCorrelated: false,
        workItemStateChanged: false,
        readerProjectionCreated: false,
        actualSourceBytesExposed: false,
        internalIdentityExposed: false,
        applicabilityIsInstallationFact: false,
        publicationAuthorized: false,
        currentSelectionChanged: false,
      },
    });
    expectBrowserSafeSerialization(response);
  });

  it('accepts the rich SYNTHETIC package only with exact Host authorization and dependency closure for all nine source artifacts', async () => {
    const sourceBytes = await richPrimaryBytes();
    const packageBytes = Uint8Array.from(await readFile(RICH_PACKAGE_PATH));
    const parsed = fixturePackage(packageBytes);
    const events: string[] = [];
    const source = fixtureSource(sourceBytes, events, richSourceOptions());
    const service = new S1000dIngressService(
      source,
      fixtureAuthorization(events, (resolved) =>
        richAuthorizedManifest(parsed, resolved),
      ),
      fixtureProducer(packageBytes, parsed.packageId, events),
      fullValidator(),
    );

    const response = await service.ingest(candidateRequest('rich'), ACTOR);

    expect(response.summary).toEqual({
      resultStatus: 'complete',
      contentUnitCount: 13,
      sourceRefCount: 24,
      authorizedSourceArtifactCount: 9,
    });
    expect(response.boundary).toMatchObject({
      canonicalArtifactPersisted: false,
      professionalArtifactCorrelated: false,
      workItemStateChanged: false,
      readerProjectionCreated: false,
    });
    expectBrowserSafeSerialization(response);
  });

  it('proves the rich fixture passes frozen.2 U0/read-only Reader inspection but rejects entry-DMC-only authorization before U0', async () => {
    const sourceBytes = await richPrimaryBytes();
    const packageBytes = Uint8Array.from(await readFile(RICH_PACKAGE_PATH));
    const parsed = fixturePackage(packageBytes);
    await proveFrozen2ReaderAccepts(packageBytes, parsed.packageId);
    const events: string[] = [];
    const validator = fullValidator();
    const validate = jest.spyOn(validator, 'validate');
    const service = new S1000dIngressService(
      fixtureSource(sourceBytes, events, richSourceOptions()),
      fixtureAuthorization(events, (resolved) =>
        richAuthorizedManifest(parsed, resolved).filter(
          (entry) => entry.dependency.kind === 'PRIMARY_DOCUMENT_VERSION',
        ),
      ),
      fixtureProducer(packageBytes, parsed.packageId, events),
      validator,
    );

    await expect(
      service.ingest(candidateRequest('rich-primary-only'), ACTOR),
    ).rejects.toMatchObject({
      code: 'S1000D_SOURCE_MANIFEST_PACKAGE_MISMATCH',
      statusCode: 409,
    });
    expect(events).toEqual(['resolve', 'authorize', 'read-bytes', 'produce']);
    expect(validate).not.toHaveBeenCalled();
  });

  it('fails closed when one rich package dependency is absent from the authorized manifest', async () => {
    const sourceBytes = await richPrimaryBytes();
    const packageBytes = Uint8Array.from(await readFile(RICH_PACKAGE_PATH));
    const parsed = fixturePackage(packageBytes);
    const events: string[] = [];
    const validator = fullValidator();
    const validate = jest.spyOn(validator, 'validate');
    const service = new S1000dIngressService(
      fixtureSource(sourceBytes, events, richSourceOptions()),
      fixtureAuthorization(events, (resolved) =>
        richAuthorizedManifest(parsed, resolved).filter(
          (entry) => entry.normalizedPath !== 'ICN-FIXTURE-001.png',
        ),
      ),
      fixtureProducer(packageBytes, parsed.packageId, events),
      validator,
    );

    await expect(
      service.ingest(candidateRequest('unknown-dependency'), ACTOR),
    ).rejects.toMatchObject({
      code: 'S1000D_SOURCE_MANIFEST_PACKAGE_MISMATCH',
      statusCode: 409,
    });
    expect(validate).not.toHaveBeenCalled();
  });

  it('rejects a SourceRef that targets an artifact outside the authorized source manifest', async () => {
    const sourceBytes = await richPrimaryBytes();
    const packageBytes = Uint8Array.from(await readFile(RICH_PACKAGE_PATH));
    const parsed = fixturePackage(packageBytes);
    const sourceIds = new Set(parsed.source.artifactIds);
    const unauthorized = parsed.artifacts.find(
      (artifact) => !sourceIds.has(artifact.artifactId),
    );
    if (!unauthorized) throw new Error('TEST_UNAUTHORIZED_ARTIFACT_NOT_FOUND');
    const mutated = structuredClone(parsed);
    mutated.sourceRefs[0].artifactId = unauthorized.artifactId;
    const mutatedBytes = new TextEncoder().encode(JSON.stringify(mutated));
    const events: string[] = [];
    const validator = fullValidator();
    const validate = jest.spyOn(validator, 'validate');
    const service = new S1000dIngressService(
      fixtureSource(sourceBytes, events, richSourceOptions()),
      fixtureAuthorization(events, (resolved) =>
        richAuthorizedManifest(parsed, resolved),
      ),
      fixtureProducer(mutatedBytes, parsed.packageId, events),
      validator,
    );

    await expect(
      service.ingest(candidateRequest('unauthorized-source-ref'), ACTOR),
    ).rejects.toMatchObject({
      code: 'S1000D_SOURCE_MANIFEST_PACKAGE_MISMATCH',
      statusCode: 409,
      message: expect.stringContaining('SOURCE_REF_ARTIFACT'),
    });
    expect(validate).not.toHaveBeenCalled();
  });

  it('uses a producer barrier to reject current DocumentVersion drift before U0 with no write-capable dependency', async () => {
    const sourceBytes = Uint8Array.from(await readFile(SOURCE_PATH));
    const packageBytes = Uint8Array.from(await readFile(PACKAGE_PATH));
    const parsed = fixturePackage(packageBytes);
    const producerEntered = deferred<void>();
    const releaseProducer = deferred<void>();
    const events: string[] = [];
    const initial = resolvedFixtureSource(sourceBytes);
    let current = structuredClone(initial);
    const source: S1000dDocumentSourcePort = {
      resolveCurrent: async () => {
        events.push('resolve');
        return structuredClone(current);
      },
      readActualBytes: async () => {
        events.push('read-bytes');
        return Uint8Array.from(sourceBytes);
      },
    };
    const validator = fullValidator();
    const validate = jest.spyOn(validator, 'validate');
    const service = new S1000dIngressService(
      source,
      fixtureAuthorization(events),
      {
        produce: async () => {
          events.push('producer-entered');
          producerEntered.resolve(undefined);
          await releaseProducer.promise;
          events.push('producer-released');
          return producedFixture(packageBytes, parsed.packageId);
        },
      },
      validator,
    );

    const result = service.ingest(candidateRequest('drift'), ACTOR);
    await producerEntered.promise;
    current = {
      ...current,
      currentGeneration: current.currentGeneration + 1,
      revisionId: 'fixture-revision-successor',
      canonicalRevisionIdentity: '002-00',
      sourceArtifactId: 'fixture-source-artifact-successor',
      sha256: '0'.repeat(64),
      providerObjectId: 'fixture-provider-object-successor',
      providerVersionId: 'fixture-provider-version-successor',
      fileServiceLocator: {
        ...current.fileServiceLocator,
        filePath: '/document-management/source/minimal-s1000d-v2.xml',
      },
    };
    releaseProducer.resolve(undefined);

    await expect(result).rejects.toMatchObject({
      code: 'S1000D_DOCUMENT_VERSION_DRIFT',
      statusCode: 409,
    });
    expect(events).toEqual([
      'resolve',
      'authorize',
      'read-bytes',
      'producer-entered',
      'producer-released',
      'resolve',
    ]);
    expect(validate).not.toHaveBeenCalled();
  });

  it('contains no direct Reader persistence, correlation or WorkItem mutation orchestration', async () => {
    const source = await readFile(SERVICE_PATH, 'utf8');
    expect(source).not.toMatch(
      /unified-reader\.service|\.persistAndReadback\s*\(|ScopedProfessionalArtifactCorrelation|WorkItem.*(?:CAS|write|update)|projectCanonicalStructuredContentUnit/u,
    );
    expect(source).toContain('U0FullValidationService');
    expect(source).toContain('canonicalArtifactPersisted: false');
  });

  it('blocks OEM bytes before FileService read when redistribution evidence is absent', async () => {
    const sourceBytes = Uint8Array.from(await readFile(SOURCE_PATH));
    const events: string[] = [];
    const service = new S1000dIngressService(
      fixtureSource(sourceBytes, events),
      {
        authorize: async ({ source }) => {
          events.push('authorize');
          return {
            ...authorizedFixture(source),
            sourceClass: 'OEM_CONTROLLED',
            sourceRedistributionAllowed: false,
            processingAuthorizationRef: 'license://server/oem-processing',
            redistributionAuthorizationRef: null,
          };
        },
      },
      { produce: jest.fn() } as unknown as S1000dStructuredPackageProducerPort,
      fullValidator(),
    );

    await expect(
      service.ingest(candidateRequest('oem'), ACTOR),
    ).rejects.toMatchObject({
      code: 'S1000D_OEM_AUTHORIZATION_AND_REDISTRIBUTION_REQUIRED',
      statusCode: 403,
    });
    expect(events).toEqual(['resolve', 'authorize']);
  });

  it('keeps an unconfigured authorization deployment explicitly blocked instead of using a fixture parser fallback', async () => {
    const sourceBytes = Uint8Array.from(await readFile(SOURCE_PATH));
    const events: string[] = [];
    const service = new S1000dIngressService(
      fixtureSource(sourceBytes, events),
      new UnconfiguredS1000dSourceUseAuthorizerAdapter(),
      { produce: jest.fn() } as unknown as S1000dStructuredPackageProducerPort,
      fullValidator(),
    );

    await expect(
      service.ingest(candidateRequest('blocked'), ACTOR),
    ).rejects.toMatchObject({
      code: 'S1000D_SOURCE_USE_AUTHORIZATION_UNCONFIGURED',
      statusCode: 503,
    });
    expect(events).toEqual(['resolve']);
  });

  it('reports the production producer blocker without falling back to fixture output', async () => {
    const sourceBytes = Uint8Array.from(await readFile(SOURCE_PATH));
    const events: string[] = [];
    const service = new S1000dIngressService(
      fixtureSource(sourceBytes, events),
      fixtureAuthorization(events),
      new UnconfiguredS1000dStructuredPackageProducerAdapter(),
      fullValidator(),
    );

    await expect(
      service.ingest(candidateRequest('producer-blocked'), ACTOR),
    ).rejects.toMatchObject({
      code: 'S1000D_PRODUCER_UNCONFIGURED',
      statusCode: 503,
    });
    expect(events).toEqual(['resolve', 'authorize', 'read-bytes']);
  });
});

function candidateRequest(prefix: string) {
  return {
    workItemId: `${prefix}-work-item`,
    requestId: `${prefix}-request`,
    documentVersionId: 'fixture-document-version',
  };
}

function expectBrowserSafeSerialization(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toMatch(
    /"(?:decisionId|unitId|documentVersionId|packageId|sourceRefIds|sourceArtifactId|artifactId|artifactRef|requestId|workItemId|sha256|fileServiceLocator|xpath|elementId)"\s*:/u,
  );
  expect(serialized).not.toMatch(
    /fixture-bucket|document-management\/source|artifact:\/\/|authorizationEvidenceRef|actualBytes/iu,
  );
}

function fixtureSource(
  bytes: Uint8Array,
  events: string[],
  options: Partial<
    Pick<
      ResolvedS1000dDocumentSource,
      'originalFilename' | 'sourceArtifactId'
    > & { filePath: string }
  > = {},
): S1000dDocumentSourcePort {
  const resolved = resolvedFixtureSource(bytes, options);
  return {
    resolveCurrent: async () => {
      events.push('resolve');
      return structuredClone(resolved);
    },
    readActualBytes: async () => {
      events.push('read-bytes');
      return Uint8Array.from(bytes);
    },
  };
}

function resolvedFixtureSource(
  bytes: Uint8Array,
  options: Partial<
    Pick<
      ResolvedS1000dDocumentSource,
      'originalFilename' | 'sourceArtifactId'
    > & { filePath: string }
  > = {},
): ResolvedS1000dDocumentSource {
  return {
    familyId: 'fixture-family',
    currentGeneration: 1,
    documentId: 'fixture-document',
    documentVersionId: 'fixture-document-version',
    revisionId: 'fixture-revision',
    canonicalRevisionIdentity: '001-00',
    committedAt: '2026-08-30T00:00:00.000Z',
    sourceArtifactId: options.sourceArtifactId ?? 'fixture-source-artifact',
    originalFilename: options.originalFilename ?? 'minimal-s1000d.xml',
    mediaType: 'application/xml',
    sha256: sha256Raw(bytes),
    byteLength: bytes.byteLength,
    providerObjectId: 'fixture-provider-object',
    providerVersionId: 'fixture-provider-version',
    fileServiceLocator: {
      bucketId: 'fixture-bucket',
      filePath:
        options.filePath ??
        '/document-management/source/minimal-s1000d.xml',
    },
  };
}

function fixtureAuthorization(
  events: string[],
  manifest: (
    source: ResolvedS1000dDocumentSource,
  ) => S1000dAuthorizedSourceArtifact[] = minimalAuthorizedManifest,
): S1000dSourceUseAuthorizerPort {
  return {
    authorize: async ({ source }) => {
      events.push('authorize');
      return authorizedFixture(source, manifest(source));
    },
  };
}

function authorizedFixture(
  source: ResolvedS1000dDocumentSource,
  authorizedSourceManifest: S1000dAuthorizedSourceArtifact[] =
    minimalAuthorizedManifest(source),
): S1000dSourceUseAuthorization {
  return {
    status: 'AUTHORIZED',
    decisionId: 'fixture-authorization-decision',
    permissionSnapshotVersion: 'fixture-permission-snapshot',
    sourceClass: 'REPOSITORY_CONTROLLED_SYNTHETIC_FIXTURE',
    sourceArtifactId: source.sourceArtifactId,
    documentVersionId: source.documentVersionId,
    processingAllowed: true,
    canonicalPackageStorageAllowed: true,
    browserProjectionAllowed: true,
    sourceRedistributionAllowed: false,
    processingAuthorizationRef: null,
    redistributionAuthorizationRef: null,
    authorizedSourceManifest,
  };
}

function minimalAuthorizedManifest(
  source: ResolvedS1000dDocumentSource,
): S1000dAuthorizedSourceArtifact[] {
  return [
    {
      packageArtifactId: MINIMAL_PACKAGE_ARTIFACT_ID,
      hostSourceArtifactId: source.sourceArtifactId,
      packageRole: 'xml',
      normalizedPath: source.originalFilename,
      mediaType: source.mediaType,
      sha256: source.sha256,
      byteLength: source.byteLength,
      authorizationEvidenceRef:
        'repository://frozen.2/fixtures/source/minimal-s1000d.xml',
      dependency: {
        kind: 'PRIMARY_DOCUMENT_VERSION',
        documentVersionId: source.documentVersionId,
      },
    },
  ];
}

function richAuthorizedManifest(
  pkg: FixturePackage,
  source: ResolvedS1000dDocumentSource,
): S1000dAuthorizedSourceArtifact[] {
  const sourceIds = new Set(pkg.source.artifactIds);
  const sourceArtifacts = pkg.artifacts.filter((artifact) =>
    sourceIds.has(artifact.artifactId),
  );
  const primary = sourceArtifacts.find(
    (artifact) => artifact.normalizedPath === source.originalFilename,
  );
  if (!primary) throw new Error('TEST_RICH_PRIMARY_ARTIFACT_NOT_FOUND');
  return sourceArtifacts.map((artifact) => ({
    packageArtifactId: artifact.artifactId,
    hostSourceArtifactId:
      artifact.artifactId === primary.artifactId
        ? source.sourceArtifactId
        : `host-source-dependency:${artifact.normalizedPath}`,
    packageRole: artifact.role,
    normalizedPath: artifact.normalizedPath,
    mediaType: artifact.mediaType,
    sha256: artifact.sha256.replace(/^sha256:/u, ''),
    byteLength: artifact.byteLength,
    authorizationEvidenceRef:
      `repository://frozen.2/fixtures/source/native-s1000d-issue-4-2/${artifact.normalizedPath}`,
    dependency:
      artifact.artifactId === primary.artifactId
        ? {
            kind: 'PRIMARY_DOCUMENT_VERSION' as const,
            documentVersionId: source.documentVersionId,
          }
        : {
            kind: 'AUTHORIZED_DEPENDENCY' as const,
            parentPackageArtifactId: primary.artifactId,
            relationship: relationshipFor(artifact.normalizedPath),
          },
  }));
}

function relationshipFor(
  normalizedPath: string,
): Extract<
  S1000dAuthorizedSourceArtifact['dependency'],
  { kind: 'AUTHORIZED_DEPENDENCY' }
>['relationship'] {
  if (normalizedPath.startsWith('SCHEMA/')) return 'SCHEMA_BINDING';
  if (normalizedPath.startsWith('ICN-')) {
    return 'INFORMATION_ENTITY_REFERENCE';
  }
  if (normalizedPath.startsWith('PMC-')) return 'PM_REFERENCE';
  return 'DELIVERY_MANIFEST';
}

function fixtureProducer(
  bytes: Uint8Array,
  packageId: string,
  events: string[],
): S1000dStructuredPackageProducerPort {
  return {
    produce: async () => {
      events.push('produce');
      return producedFixture(bytes, packageId);
    },
  };
}

function producedFixture(bytes: Uint8Array, packageId: string) {
  return {
    packageId,
    contractId: 'techpub.parsed-package.v1' as const,
    contractRevision: 'frozen.2' as const,
    bytes: Uint8Array.from(bytes),
    producerId: 'techpub-contract-fixture-builder',
    producerRevision: 'frozen.2-synthetic-fixture-only',
  };
}

function fixturePackage(bytes: Uint8Array): FixturePackage {
  return JSON.parse(new TextDecoder().decode(bytes)) as FixturePackage;
}

async function richPrimaryBytes(): Promise<Uint8Array> {
  return Uint8Array.from(
    await readFile(resolve(RICH_SOURCE_ROOT, 'DMC-FIXTURE.XML')),
  );
}

function richSourceOptions() {
  return {
    originalFilename: 'DMC-FIXTURE.XML',
    sourceArtifactId: 'host-source-rich-dmc',
    filePath: '/document-management/source/DMC-FIXTURE.XML',
  };
}

async function proveFrozen2ReaderAccepts(
  bytes: Uint8Array,
  packageId: string,
): Promise<void> {
  const artifact = artifactDescriptor(bytes);
  await fullValidator().validate({ artifact, bytes, packageId });
  expect(
    new Frozen2CandidateReaderService().inspect(artifact, bytes),
  ).toMatchObject({ packageId, sourceKind: 'native_s1000d' });
}

function artifactDescriptor(
  bytes: Uint8Array,
): UnifiedPackageArtifactDescriptor {
  const sha256 = sha256Raw(bytes);
  return {
    storeRole: 'UnifiedArtifactStoreCandidate',
    ref: `artifact://test/sha256/${sha256}`,
    sha256,
    byteLength: bytes.byteLength,
    mediaType: 'application/json',
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return { promise, resolve: resolvePromise };
}

function fullValidator(): U0FullValidationService {
  return new U0FullValidationService(
    new PythonU0FullPackageValidatorAdapter({
      pythonExecutable: process.env.WL_TEST_U0_PYTHON?.trim() || 'python3',
      contractRoot: CONTRACT_ROOT,
      contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
      validatorRevision: 's1000d-v1.1-repository-fixture-test',
    }),
  );
}
