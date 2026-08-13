import type {
  UnifiedPackageArtifactDescriptor,
  UnifiedPackageReadbackRequest,
} from '@shared/api.interface';

import { Frozen2CandidateReaderService } from '../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { UnifiedReaderService } from '../../server/modules/unified-reader/unified-reader.service';
import { U0FullValidationService } from '../../server/modules/unified-reader/u0-full-validation.service';
import type {
  ImmutableArtifactPersistResult,
  UnifiedArtifactStorePort,
} from '../../server/modules/unified-reader/unified-reader.types';
import {
  canonicalJson,
  contentView,
  sha256Raw,
  sha256Text,
} from '../../server/modules/unified-reader/unified-reader.utils';

class InMemoryArtifactStore implements UnifiedArtifactStorePort {
  private readonly values: Map<string, Uint8Array> = new Map();

  async persistAndReadback(
    bytes: Uint8Array,
  ): Promise<ImmutableArtifactPersistResult> {
    const sha256: string = sha256Raw(bytes);
    const ref: string =
      'artifact://UnifiedArtifactStoreCandidate/' +
      `unified-parsed-packages/sha256/${sha256}`;
    const reused: boolean = this.values.has(ref);
    this.values.set(ref, Uint8Array.from(bytes));
    const artifact: UnifiedPackageArtifactDescriptor = {
      storeRole: 'UnifiedArtifactStoreCandidate',
      ref,
      sha256,
      byteLength: bytes.byteLength,
      mediaType: 'application/json',
    };
    return { artifact, bytes: Uint8Array.from(bytes), reused };
  }

  async readActualBytes(
    artifact: UnifiedPackageArtifactDescriptor,
  ): Promise<Uint8Array> {
    const bytes: Uint8Array | undefined = this.values.get(artifact.ref);
    if (!bytes) throw new Error('SOURCE_ARTIFACT_NOT_FOUND');
    if (
      bytes.byteLength !== artifact.byteLength ||
      sha256Raw(bytes) !== artifact.sha256
    ) {
      throw new Error('ARTIFACT_READBACK_MISMATCH');
    }
    return Uint8Array.from(bytes);
  }
}

describe('UnifiedReaderService hosted candidate loop', () => {
  let store: InMemoryArtifactStore;
  let service: UnifiedReaderService;

  beforeEach(() => {
    store = new InMemoryArtifactStore();
    service = new UnifiedReaderService(
      store,
      new Frozen2CandidateReaderService(),
      fullValidator(),
      {
        mode: 'DEFAULT_UNCONFIGURED',
        artifactStoreConfigured: false,
        fullU0ValidatorConfigured: true,
        aeoSpecialistReaderConfigured: false,
        authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
      },
    );
  });

  it('declares capability without claiming canonical activation', () => {
    expect(service.readiness()).toMatchObject({
      status: 'VERIFICATION_PENDING',
      packageContract: {
        selectionStatus: 'R1_FROZEN',
        preferredCandidate: {
          contractRevision: 'frozen.2',
          contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
        },
      },
      capabilities: {
        candidateSourceAvailable: true,
        unifiedAcceptanceFacadeSourceAvailable: true,
        aeoSpecialistReaderConfigured: false,
        artifactStoreConfigured: false,
        immutableArtifactPersistAndReadback: false,
        sourceBoundCandidateReadback: false,
        workItemMutation: false,
        publication: false,
      },
      blockers: expect.arrayContaining([
        'HOSTED_CANONICAL_RUNTIME_UNVERIFIED',
        'AEO_SPECIALIST_READER_NOT_CONFIGURED',
      ]),
    });
  });

  it.each(['pdf', 'native_s1000d'] as const)(
    'persists, reads and queries a portable %s candidate package',
    async (sourceKind) => {
      const fixture = makeCandidatePackage(sourceKind);
      const { bytes, packageId } = fixture;
      const query = 'electrical power';
      const response = await service.persistAndReadback(bytes, {
        workItemId: `wi-${sourceKind}`,
        requestId: `req-${sourceKind}`,
        documentVersionId: `docv-${sourceKind}`,
        permissionSnapshotVersion: 'perm-test-1',
        packageId,
        contractId: 'techpub.parsed-package.v1',
        contractRevision: 'frozen.2',
        query,
      });

      expect(response).toMatchObject({
        status: 'CANDIDATE_READBACK_VERIFIED',
        package: {
          packageId,
          sourceKind,
          contentUnitCount: 2,
          sourceRefCount: 1,
        },
        receipt: {
          validationStatus: 'CONSUMER_READBACK_VERIFIED',
          reader: { role: 'UnifiedReaderCandidate' },
          packageId,
          sourceBoundUnitCount: 2,
          queryProbe: {
            query,
            resultCount: 1,
            allResultsHaveSourceRefs: true,
          },
        },
      });
      expect(response.queryResults[0].sourceRefIds.length).toBeGreaterThan(0);
    },
  );

  it('rejects exact-byte drift and empty query results explicitly', async () => {
    const { bytes, packageId } = makeCandidatePackage('pdf');
    const persisted: ImmutableArtifactPersistResult =
      await store.persistAndReadback(bytes);
    const request: UnifiedPackageReadbackRequest = {
      workItemId: 'wi-drift',
      requestId: 'req-drift',
      documentVersionId: 'docv-drift',
      permissionSnapshotVersion: 'perm-drift',
      package: {
        packageId,
        contractId: 'techpub.parsed-package.v1',
        contractRevision: 'frozen.2',
        artifact: persisted.artifact,
      },
      query: 'value-does-not-exist',
    };

    await expect(service.readback(request)).rejects.toThrow(
      'READER_QUERY_NO_RESULTS',
    );
    request.package.artifact = {
      ...request.package.artifact,
      sha256: '0'.repeat(64),
    };
    await expect(service.readback(request)).rejects.toThrow(
      'ARTIFACT_READBACK_MISMATCH',
    );
  });
});

function makeCandidatePackage(sourceKind: 'pdf' | 'native_s1000d'): {
  bytes: Uint8Array;
  packageId: string;
} {
  const sourceRefId = `source-ref-${sourceKind}`;
  const content: Record<string, unknown> = {
    $schema: 'urn:techpub:schema:v1:parsed-package:frozen-2',
    schemaVersion: 'techpub.parsed-package.v1',
    contractRevision: 'frozen.2',
    source: { kind: sourceKind },
    document: {
      title: {
        value: `Portable ${sourceKind} package`,
        sourceRefIds: [sourceRefId],
      },
      revision: { label: { value: 'R1', sourceRefIds: [sourceRefId] } },
    },
    result: {
      status: 'complete',
      accountingComplete: true,
      contentPreserved: true,
      structuredCoverageComplete: true,
    },
    sourceRefs: [{ sourceRefId }],
    contentUnits: [
      {
        unitId: `unit-${sourceKind}-heading`,
        kind: 'heading',
        unitHash: sha256Text(`heading-${sourceKind}`),
        sourceRefIds: [sourceRefId],
        payload: { text: 'Procedure' },
      },
      {
        unitId: `unit-${sourceKind}-step`,
        kind: 'paragraph',
        unitHash: sha256Text(`step-${sourceKind}`),
        sourceRefIds: [sourceRefId],
        payload: { text: 'Disconnect electrical power.' },
      },
    ],
  };
  const contentHash = sha256Text(canonicalJson(contentView(content)));
  const pkg: Record<string, unknown> = {
    ...content,
    packageId: `urn:techpub:package:v1:${contentHash}`,
    integrity: {
      contentHash,
      semanticHash: sha256Text(`semantic-${sourceKind}`),
      provenanceHash: sha256Text(`provenance-${sourceKind}`),
      coverageHash: sha256Text(`coverage-${sourceKind}`),
    },
  };
  return {
    bytes: new TextEncoder().encode(`${JSON.stringify(pkg, null, 2)}\n`),
    packageId: pkg.packageId as string,
  };
}

function fullValidator(): U0FullValidationService {
  return new U0FullValidationService({
    validateActualBytes: async ({ artifact, packageId }) => ({
      status: 'FULL_STRICT_VALIDATOR_PASSED',
      validatorId: 'U0Frozen2SchemaSemanticValidator',
      validatorRevision: 'test-u0-fa69ada-frozen.2',
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
      packageId,
      artifactSha256: artifact.sha256,
    }),
    validateFailureReportActualBytes: async () => {
      throw new Error('TEST_FAILURE_VALIDATOR_NOT_USED');
    },
  });
}
