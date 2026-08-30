import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';

import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import { S1000dIngressService } from '../../server/modules/s1000d-ingress/s1000d-ingress.service';
import type {
  ResolvedS1000dDocumentSource,
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
import { UnifiedReaderService } from '../../server/modules/unified-reader/unified-reader.service';
import type {
  ImmutableArtifactPersistResult,
  UnifiedArtifactStorePort,
} from '../../server/modules/unified-reader/unified-reader.types';
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

const ACTOR: CanonicalHostActor = {
  userId: 'fixture-user',
  tenantId: 'fixture-tenant',
  appId: 'fixture-app',
  roles: ['fixture-role'],
  env: 'test',
};

class MemoryCanonicalArtifactStore implements UnifiedArtifactStorePort {
  readonly values = new Map<string, Uint8Array>();
  readonly persistAndReadback = jest.fn(
    async (bytes: Uint8Array): Promise<ImmutableArtifactPersistResult> => {
      const sha256 = sha256Raw(bytes);
      const artifact: UnifiedPackageArtifactDescriptor = {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: `artifact://UnifiedArtifactStoreCandidate/unified-parsed-packages/sha256/${sha256}`,
        sha256,
        byteLength: bytes.byteLength,
        mediaType: 'application/json',
      };
      this.values.set(artifact.ref, Uint8Array.from(bytes));
      return {
        artifact,
        bytes: Uint8Array.from(bytes),
        reused: false,
      };
    },
  );
  readonly readActualBytes = jest.fn(
    async (artifact: UnifiedPackageArtifactDescriptor) => {
      const value = this.values.get(artifact.ref);
      if (!value) throw new Error('TEST_ARTIFACT_NOT_FOUND');
      return Uint8Array.from(value);
    },
  );
}

describe('S1000D V1.1 ingress adapter seam', () => {
  it('runs repository-controlled SYNTHETIC bytes through frozen.2 U0, SourceRef/units and the sole Reader without exposing native locators', async () => {
    const sourceBytes = Uint8Array.from(await readFile(SOURCE_PATH));
    const packageBytes = Uint8Array.from(await readFile(PACKAGE_PATH));
    const parsed = JSON.parse(new TextDecoder().decode(packageBytes)) as {
      packageId: string;
    };
    const events: string[] = [];
    const source = fixtureSource(sourceBytes, events);
    const authorization = fixtureAuthorization(events);
    const producer = fixtureProducer(packageBytes, parsed.packageId, events);
    const store = new MemoryCanonicalArtifactStore();
    const service = new S1000dIngressService(
      source,
      authorization,
      producer,
      realReader(store),
    );

    const response = await service.ingest(
      {
        workItemId: 'fixture-work-item',
        requestId: 'fixture-request',
        documentVersionId: 'fixture-document-version',
        query: 'electrical power',
      },
      ACTOR,
    );

    expect(events).toEqual(['resolve', 'authorize', 'read-bytes', 'produce']);
    expect(response).toMatchObject({
      status: 'CANDIDATE_READBACK_VERIFIED',
      sourceKind: 'native_s1000d',
      package: {
        packageId: parsed.packageId,
        contractRevision: 'frozen.2',
        contentUnitCount: 2,
        sourceRefCount: 1,
      },
      authorization: {
        sourceClass: 'REPOSITORY_CONTROLLED_SYNTHETIC_FIXTURE',
      },
      query: {
        resultCount: 1,
        units: [
          {
            displayKind: 'body',
            displayText: 'Disconnect electrical power.',
            sourceLocators: [
              {
                kind: 'xml',
                pageStart: null,
                pageEnd: null,
                quote: 'Disconnect electrical power.',
              },
            ],
          },
        ],
      },
      boundary: {
        actualSourceBytesExposed: false,
        fileServiceLocatorExposed: false,
        packageArtifactLocatorExposed: false,
        nativeXmlLocatorExposed: false,
        applicabilityIsInstallationFact: false,
        publicationAuthorized: false,
        currentSelectionChanged: false,
      },
    });
    expect(store.persistAndReadback).toHaveBeenCalledTimes(1);
    const browserJson = JSON.stringify(response);
    expect(browserJson).not.toMatch(
      /fixture-bucket|document-management\/source|artifact:\/\/|xpath|elementId|actualBytes/iu,
    );
  });

  it('blocks OEM bytes before FileService read when redistribution evidence is absent', async () => {
    const sourceBytes = Uint8Array.from(await readFile(SOURCE_PATH));
    const events: string[] = [];
    const source = fixtureSource(sourceBytes, events);
    const store = new MemoryCanonicalArtifactStore();
    const service = new S1000dIngressService(
      source,
      {
        authorize: async ({ source: resolved }) => {
          events.push('authorize');
          return {
            ...authorizedFixture(resolved),
            sourceClass: 'OEM_CONTROLLED',
            sourceRedistributionAllowed: false,
            processingAuthorizationRef: 'license://server/oem-processing',
            redistributionAuthorizationRef: null,
          };
        },
      },
      {
        produce: jest.fn(),
      } as unknown as S1000dStructuredPackageProducerPort,
      realReader(store),
    );

    await expect(
      service.ingest(
        {
          workItemId: 'oem-work-item',
          requestId: 'oem-request',
          documentVersionId: 'fixture-document-version',
          query: 'electrical power',
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: 'S1000D_OEM_AUTHORIZATION_AND_REDISTRIBUTION_REQUIRED',
      statusCode: 403,
    });
    expect(events).toEqual(['resolve', 'authorize']);
    expect(store.persistAndReadback).not.toHaveBeenCalled();
  });

  it('keeps an unconfigured deployment explicitly blocked instead of using contract fixtures as a parser fallback', async () => {
    const sourceBytes = Uint8Array.from(await readFile(SOURCE_PATH));
    const events: string[] = [];
    const service = new S1000dIngressService(
      fixtureSource(sourceBytes, events),
      new UnconfiguredS1000dSourceUseAuthorizerAdapter(),
      { produce: jest.fn() } as unknown as S1000dStructuredPackageProducerPort,
      realReader(new MemoryCanonicalArtifactStore()),
    );

    await expect(
      service.ingest(
        {
          workItemId: 'blocked-work-item',
          requestId: 'blocked-request',
          documentVersionId: 'fixture-document-version',
          query: 'electrical power',
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: 'S1000D_SOURCE_USE_AUTHORIZATION_UNCONFIGURED',
      statusCode: 503,
    });
    expect(events).toEqual(['resolve']);
  });

  it('reports the production producer blocker after authorization without falling back to fixture output', async () => {
    const sourceBytes = Uint8Array.from(await readFile(SOURCE_PATH));
    const events: string[] = [];
    const store = new MemoryCanonicalArtifactStore();
    const service = new S1000dIngressService(
      fixtureSource(sourceBytes, events),
      fixtureAuthorization(events),
      new UnconfiguredS1000dStructuredPackageProducerAdapter(),
      realReader(store),
    );

    await expect(
      service.ingest(
        {
          workItemId: 'producer-blocked-work-item',
          requestId: 'producer-blocked-request',
          documentVersionId: 'fixture-document-version',
          query: 'electrical power',
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      code: 'S1000D_PRODUCER_UNCONFIGURED',
      statusCode: 503,
    });
    expect(events).toEqual(['resolve', 'authorize', 'read-bytes']);
    expect(store.persistAndReadback).not.toHaveBeenCalled();
  });
});

function fixtureSource(
  bytes: Uint8Array,
  events: string[],
): S1000dDocumentSourcePort {
  const resolved: ResolvedS1000dDocumentSource = {
    documentId: 'fixture-document',
    documentVersionId: 'fixture-document-version',
    sourceArtifactId: 'fixture-source-artifact',
    originalFilename: 'minimal-s1000d.xml',
    mediaType: 'application/xml',
    sha256: sha256Raw(bytes),
    byteLength: bytes.byteLength,
    providerObjectId: 'fixture-provider-object',
    fileServiceLocator: {
      bucketId: 'fixture-bucket',
      filePath: '/document-management/source/minimal-s1000d.xml',
    },
  };
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

function fixtureAuthorization(events: string[]): S1000dSourceUseAuthorizerPort {
  return {
    authorize: async ({ source }) => {
      events.push('authorize');
      return authorizedFixture(source);
    },
  };
}

function authorizedFixture(
  source: ResolvedS1000dDocumentSource,
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
  };
}

function fixtureProducer(
  bytes: Uint8Array,
  packageId: string,
  events: string[],
): S1000dStructuredPackageProducerPort {
  return {
    produce: async () => {
      events.push('produce');
      return {
        packageId,
        contractId: 'techpub.parsed-package.v1',
        contractRevision: 'frozen.2',
        bytes: Uint8Array.from(bytes),
        producerId: 'techpub-contract-fixture-builder',
        producerRevision: 'frozen.2-synthetic-fixture-only',
      };
    },
  };
}

function realReader(store: UnifiedArtifactStorePort): UnifiedReaderService {
  const fullValidator = new U0FullValidationService(
    new PythonU0FullPackageValidatorAdapter({
      pythonExecutable: process.env.WL_TEST_U0_PYTHON?.trim() || 'python3',
      contractRoot: CONTRACT_ROOT,
      contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
      validatorRevision: 's1000d-v1.1-repository-fixture-test',
    }),
  );
  return new UnifiedReaderService(
    store,
    new Frozen2CandidateReaderService(),
    fullValidator,
    {
      mode: 'HOST_CONFIGURED',
      artifactStoreConfigured: true,
      fullU0ValidatorConfigured: true,
      immutableAcceptanceReceiptOwnerConfigured: false,
      aeoSpecialistReaderConfigured: false,
      authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
    },
  );
}
