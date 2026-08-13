import type {
  AeoSpecialistAcceptanceContext,
  UnifiedAcceptanceRequest,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';

import { Frozen2CandidateReaderService } from '../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { UnifiedAcceptanceFacadeService } from '../../server/modules/unified-reader/unified-acceptance-facade.service';
import { U0FullValidationService } from '../../server/modules/unified-reader/u0-full-validation.service';
import type {
  AeoSpecialistReaderPort,
  ImmutableArtifactPersistResult,
  UnifiedArtifactStorePort,
} from '../../server/modules/unified-reader/unified-reader.types';
import {
  canonicalJson,
  contentView,
  sha256Raw,
  sha256Text,
} from '../../server/modules/unified-reader/unified-reader.utils';

class MemoryStore implements UnifiedArtifactStorePort {
  private readonly values: Map<string, Uint8Array> = new Map();
  readonly readActualBytes = jest.fn(
    async (artifact: UnifiedPackageArtifactDescriptor): Promise<Uint8Array> => {
      const bytes = this.values.get(artifact.ref);
      if (!bytes) throw new Error('SOURCE_ARTIFACT_NOT_FOUND');
      return Uint8Array.from(bytes);
    },
  );

  async persistAndReadback(
    bytes: Uint8Array,
  ): Promise<ImmutableArtifactPersistResult> {
    const sha256 = sha256Raw(bytes);
    const artifact: UnifiedPackageArtifactDescriptor = {
      storeRole: 'UnifiedArtifactStoreCandidate',
      ref:
        'artifact://UnifiedArtifactStoreCandidate/' +
        `unified-parsed-packages/sha256/${sha256}`,
      sha256,
      byteLength: bytes.byteLength,
      mediaType: 'application/json',
    };
    this.values.set(artifact.ref, Uint8Array.from(bytes));
    return { artifact, bytes: Uint8Array.from(bytes), reused: false };
  }

  alias(ref: string, bytes: Uint8Array): void {
    this.values.set(ref, Uint8Array.from(bytes));
  }
}

const AEO_CONTEXT: AeoSpecialistAcceptanceContext = {
  family: 'AEO',
  formalAeoIdentity: 'AEO-B787-46-0015',
  revision: 'R09',
  iteration: 'A.1',
  sourceMediaType:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  sourceByteLength: 3_344_160,
  sourceSha256:
    '4244c5afd5038fd8a2a5cb1534b30609a20f31f45c6ce43de07c025d1e1f6035',
  packageHash:
    'd39eb2e83c552549a9aa5784f41065282bd0ff6a99d4a668ad119c65c5a3be56',
  currentness: 'UNVERIFIED',
};

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

describe('UnifiedAcceptanceFacadeService', () => {
  it('dispatches frozen.2 and binds the candidate receipt to all correlation identities', async () => {
    const store = new MemoryStore();
    const frozen = makeFrozenPackage();
    const persisted = await store.persistAndReadback(frozen.bytes);
    const aeo = { inspectActualBytes: jest.fn() };
    const service = new UnifiedAcceptanceFacadeService(
      store,
      new Frozen2CandidateReaderService(),
      fullValidator(),
      aeo as never,
    );
    const request = unifiedRequest(frozen.packageId, persisted.artifact);

    const first = await service.inspect(request);
    const second = await service.inspect({
      ...request,
      correlation: {
        ...request.correlation,
        permissionSnapshotVersion: 'permission-2',
      },
    });

    expect(first).toMatchObject({
      dispatch: {
        route: 'UNIFIED_FROZEN_2',
        handlerId: 'Frozen2CandidateReaderService',
        fallbackUsed: false,
      },
      validationStatus: 'CANDIDATE_ACCEPTED',
      correlation: request.correlation,
      package: {
        packageId: frozen.packageId,
        artifactStoreRole: persisted.artifact.storeRole,
        artifactRef: persisted.artifact.ref,
        artifactSha256: persisted.artifact.sha256,
        artifactMediaType: persisted.artifact.mediaType,
      },
      authority: { canonicalReaderActivated: false },
    });
    expect(first.receiptCanonicalSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first.receiptId).not.toBe(second.receiptId);
    expect(aeo.inspectActualBytes).not.toHaveBeenCalled();
  });

  it('dispatches the AEO contract only to one registered specialist port', async () => {
    const store = new MemoryStore();
    const bytes = new TextEncoder().encode('{"aeo":true}\n');
    const persisted = await store.persistAndReadback(bytes);
    const aeo: AeoSpecialistReaderPort = {
      inspectActualBytes: jest.fn().mockResolvedValue({
        packageId: 'AEOPARSE-D39EB2E83C552549A9AA5784',
        contractId: 'aeo_structured_parse_v1',
        contractRevision: 'candidate.1',
        handlerId: 'AeoStructuredParseCandidateReader',
        handlerRevision: 'aeo-structured-parse.candidate.1',
        summaryHash: sha256Text('aeo-summary'),
        sourceBoundUnitCount: 29,
      }),
    };
    const service = new UnifiedAcceptanceFacadeService(
      store,
      new Frozen2CandidateReaderService(),
      fullValidator(),
      aeo,
    );
    const request = aeoRequest(persisted.artifact);

    const receipt = await service.inspect(request);

    expect(receipt).toMatchObject({
      dispatch: {
        route: 'AEO_SPECIALIST',
        handlerId: 'AeoStructuredParseCandidateReader',
        fallbackUsed: false,
      },
      correlation: request.correlation,
      package: {
        contract: {
          contractId: 'aeo_structured_parse_v1',
          contractRevision: 'candidate.1',
        },
      },
      sourceBoundUnitCount: 29,
    });
    expect(aeo.inspectActualBytes).toHaveBeenCalledWith({
      artifact: persisted.artifact,
      bytes: expect.any(Uint8Array),
      packageId: request.package.packageId,
      context: AEO_CONTEXT,
    });
  });

  it('rejects contract/context mismatch without fallback or specialist invocation', async () => {
    const store = new MemoryStore();
    const frozen = makeFrozenPackage();
    const persisted = await store.persistAndReadback(frozen.bytes);
    const aeo = { inspectActualBytes: jest.fn() };
    const service = new UnifiedAcceptanceFacadeService(
      store,
      new Frozen2CandidateReaderService(),
      fullValidator(),
      aeo as never,
    );

    await expect(
      service.inspect({
        ...unifiedRequest(frozen.packageId, persisted.artifact),
        specialistContext: AEO_CONTEXT,
      }),
    ).rejects.toThrow(
      'UNIFIED_ACCEPTANCE_DISPATCH_REJECTED:UNIFIED_CONTEXT_MUST_BE_NULL',
    );
    expect(aeo.inspectActualBytes).not.toHaveBeenCalled();
  });

  it('rejects unknown fields and specialist binding drift', async () => {
    const store = new MemoryStore();
    const persisted = await store.persistAndReadback(
      new TextEncoder().encode('{"aeo":true}\n'),
    );
    const aeo: AeoSpecialistReaderPort = {
      inspectActualBytes: jest.fn().mockResolvedValue({
        packageId: 'AEOPARSE-000000000000000000000000',
        contractId: 'aeo_structured_parse_v1',
        contractRevision: 'candidate.1',
        handlerId: 'AeoStructuredParseCandidateReader',
        handlerRevision: 'aeo-structured-parse.candidate.1',
        summaryHash: sha256Text('aeo-summary'),
        sourceBoundUnitCount: 1,
      }),
    };
    const service = new UnifiedAcceptanceFacadeService(
      store,
      new Frozen2CandidateReaderService(),
      fullValidator(),
      aeo,
    );

    await expect(
      service.inspect({
        ...aeoRequest(persisted.artifact),
        extraAuthority: true,
      } as never),
    ).rejects.toThrow('UNIFIED_ACCEPTANCE_REQUEST_INVALID:request_KEYS');
    await expect(
      service.inspect(aeoRequest(persisted.artifact)),
    ).rejects.toThrow('UNIFIED_ACCEPTANCE_REJECTED:HANDLER_BINDING_MISMATCH');
  });

  it('rejects an unregistered contract before reading an artifact', async () => {
    const store = new MemoryStore();
    const frozen = makeFrozenPackage();
    const persisted = await store.persistAndReadback(frozen.bytes);
    const service = new UnifiedAcceptanceFacadeService(
      store,
      new Frozen2CandidateReaderService(),
      fullValidator(),
      { inspectActualBytes: jest.fn() },
    );
    const request = unifiedRequest(frozen.packageId, persisted.artifact);

    await expect(
      service.inspect({
        ...request,
        package: {
          ...request.package,
          contract: {
            contractId: 'unknown.contract',
            contractRevision: 'v1',
          },
        },
      } as never),
    ).rejects.toThrow('UNIFIED_ACCEPTANCE_DISPATCH_REJECTED:UNKNOWN_CONTRACT');
    expect(store.readActualBytes).not.toHaveBeenCalled();
  });

  it('binds artifact locator, store role and media type into the receipt hash', async () => {
    const store = new MemoryStore();
    const frozen = makeFrozenPackage();
    const persisted = await store.persistAndReadback(frozen.bytes);
    const alternateRef = `${persisted.artifact.ref}/alternate-locator`;
    store.alias(alternateRef, frozen.bytes);
    const service = new UnifiedAcceptanceFacadeService(
      store,
      new Frozen2CandidateReaderService(),
      fullValidator(),
      { inspectActualBytes: jest.fn() },
    );
    const original = await service.inspect(
      unifiedRequest(frozen.packageId, persisted.artifact),
    );
    const relocated = await service.inspect(
      unifiedRequest(frozen.packageId, {
        ...persisted.artifact,
        ref: alternateRef,
      }),
    );

    expect(original.package).toMatchObject({
      artifactStoreRole: 'UnifiedArtifactStoreCandidate',
      artifactRef: persisted.artifact.ref,
      artifactMediaType: 'application/json',
    });
    expect(original.receiptId).not.toBe(relocated.receiptId);
  });
});

function correlation() {
  return {
    workItemId: 'work-item-aeo-001',
    requestId: 'request-aeo-001',
    documentVersionId: 'document-version-aeo-r09',
    permissionSnapshotVersion: 'permission-1',
    classificationFingerprint: 'classification-aeo-confirmed-1',
  };
}

function unifiedRequest(
  packageId: string,
  artifact: UnifiedPackageArtifactDescriptor,
): UnifiedAcceptanceRequest {
  return {
    schemaVersion: 'wiselink.3_1.unified_acceptance_request.v0.candidate',
    correlation: correlation(),
    package: {
      packageId,
      contract: {
        contractId: 'techpub.parsed-package.v1',
        contractRevision: 'frozen.2',
      },
      artifact,
    },
    specialistContext: null,
  };
}

function aeoRequest(
  artifact: UnifiedPackageArtifactDescriptor,
): UnifiedAcceptanceRequest {
  return {
    schemaVersion: 'wiselink.3_1.unified_acceptance_request.v0.candidate',
    correlation: correlation(),
    package: {
      packageId: 'AEOPARSE-D39EB2E83C552549A9AA5784',
      contract: {
        contractId: 'aeo_structured_parse_v1',
        contractRevision: 'candidate.1',
      },
      artifact,
    },
    specialistContext: AEO_CONTEXT,
  };
}

function makeFrozenPackage(): { bytes: Uint8Array; packageId: string } {
  const sourceRefId = 'source-ref-pdf';
  const content: Record<string, unknown> = {
    $schema: 'urn:techpub:schema:v1:parsed-package:frozen-2',
    schemaVersion: 'techpub.parsed-package.v1',
    contractRevision: 'frozen.2',
    source: { kind: 'pdf' },
    document: {
      title: { value: 'Portable PDF package', sourceRefIds: [sourceRefId] },
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
        unitId: 'unit-pdf-step',
        kind: 'paragraph',
        unitHash: sha256Text('step-pdf'),
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
      semanticHash: sha256Text('semantic-pdf'),
      provenanceHash: sha256Text('provenance-pdf'),
      coverageHash: sha256Text('coverage-pdf'),
    },
  };
  return {
    bytes: new TextEncoder().encode(`${JSON.stringify(pkg, null, 2)}\n`),
    packageId: pkg.packageId as string,
  };
}
