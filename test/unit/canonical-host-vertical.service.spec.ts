import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type {
  CanonicalPdfVerticalRunRequest,
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';

import { CanonicalEntryFacadeService } from '../../server/modules/canonical-host/canonical-entry-facade.service';
import { CanonicalFailureRecordingService } from '../../server/modules/canonical-host/canonical-failure-recording.service';
import { CanonicalHostVerticalService } from '../../server/modules/canonical-host/canonical-host-vertical.service';
import { UnconfiguredCanonicalMiaodaAppBindingAdapter } from '../../server/modules/canonical-host/unconfigured-canonical-miaoda-app-binding.adapter';
import { UnconfiguredFailureValidationWriteAuthorizationAdapter } from '../../server/modules/canonical-host/unconfigured-failure-validation-write-authorization.adapter';
import type {
  CanonicalAuthorizationDecision,
  CanonicalHostActor,
  CanonicalPdfProducerPort,
  CanonicalWorkItemRegistrarPort,
} from '../../server/modules/canonical-host/canonical-host.types';
import { Frozen2CandidateReaderService } from '../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { UnifiedReaderService } from '../../server/modules/unified-reader/unified-reader.service';
import { U0FullValidationService } from '../../server/modules/unified-reader/u0-full-validation.service';
import { UnconfiguredU0Frozen2FailureAdapter } from '../../server/modules/unified-reader/unconfigured-u0-frozen2-failure-adapter.adapter';
import type {
  ImmutableArtifactPersistResult,
  UnifiedArtifactStorePort,
} from '../../server/modules/unified-reader/unified-reader.types';
import { sha256Raw } from '../../server/modules/unified-reader/unified-reader.utils';
import { unifiedEbf84fFailureAdapter } from '../support/unified-ebf84f-failure-adapter';

class InMemoryArtifactStore implements UnifiedArtifactStorePort {
  private readonly values = new Map<string, Uint8Array>();

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
    const reused = this.values.has(artifact.ref);
    this.values.set(artifact.ref, Uint8Array.from(bytes));
    return { artifact, bytes: Uint8Array.from(bytes), reused };
  }

  async readActualBytes(
    artifact: UnifiedPackageArtifactDescriptor,
  ): Promise<Uint8Array> {
    const bytes = this.values.get(artifact.ref);
    if (!bytes) throw new Error('SOURCE_ARTIFACT_NOT_FOUND');
    return Uint8Array.from(bytes);
  }

  overwrite(
    artifact: UnifiedPackageArtifactDescriptor,
    bytes: Uint8Array,
  ): void {
    this.values.set(artifact.ref, Uint8Array.from(bytes));
  }
}

class InMemoryRegistrar implements CanonicalWorkItemRegistrarPort {
  private readonly values = new Map<string, CanonicalWorkItemProjection>();

  async loadOrCreate(
    seed: Omit<CanonicalWorkItemProjection, 'revision'>,
  ): Promise<CanonicalWorkItemProjection> {
    const existing = this.values.get(seed.workItemId);
    if (existing) return clone(existing);
    const created = { ...seed, revision: 1 };
    this.values.set(seed.workItemId, clone(created));
    return clone(created);
  }

  async compareAndSet(input: {
    workItemId: string;
    expectedRevision: number;
    next: Omit<CanonicalWorkItemProjection, 'revision'>;
  }): Promise<CanonicalWorkItemProjection> {
    const existing = this.values.get(input.workItemId);
    if (!existing || existing.revision !== input.expectedRevision) {
      throw new Error('WORK_ITEM_CAS_CONFLICT');
    }
    const next = { ...input.next, revision: existing.revision + 1 };
    this.values.set(input.workItemId, clone(next));
    return clone(next);
  }

  async getExact(input: {
    workItemId: string;
    requestId: string;
    documentVersionId: string;
  }): Promise<CanonicalWorkItemProjection> {
    const value = this.values.get(input.workItemId);
    if (
      !value ||
      value.requestId !== input.requestId ||
      value.source.documentVersionId !== input.documentVersionId
    ) {
      throw new Error('WORK_ITEM_NOT_FOUND');
    }
    return clone(value);
  }

  async getByWorkItemId(
    workItemId: string,
  ): Promise<CanonicalWorkItemProjection> {
    const value = this.values.get(workItemId);
    if (!value) throw new Error('WORK_ITEM_NOT_FOUND');
    return clone(value);
  }
}

const TEST_PERMISSION_SNAPSHOT =
  'permission-snapshot:sha256:7db79431e59d1556fc039b56340d4ad159ac32f6fc25950084cd5b53ebb91416';

const TEST_ACTOR: CanonicalHostActor = {
  userId: 'miaoda-user-1001',
  tenantId: 'tenant-2001',
  appId: 'app-local-candidate',
  roles: ['local-candidate-parser'],
  env: 'preview',
};

const TEST_APP_ORIGIN = 'https://candidate-host.example.test';

function entryFacade(): CanonicalEntryFacadeService {
  return new CanonicalEntryFacadeService({
    deepLinkForWorkItem: (workItemId: string) => ({
      bindingStatus: 'VERIFIED_CANONICAL',
      appId: 'app-synthetic-unit-test-only',
      origin: TEST_APP_ORIGIN,
      deepLink:
        `${TEST_APP_ORIGIN}/work-items/${encodeURIComponent(workItemId)}/documents`,
    }),
  });
}

function failureReports(
  store: UnifiedArtifactStorePort,
  validator: U0FullValidationService,
  writeAuthorization = validationWriteAuthorization(),
): CanonicalFailureRecordingService {
  return new CanonicalFailureRecordingService(
    unifiedEbf84fFailureAdapter(validator),
    writeAuthorization,
    store,
    { nowIso: () => '2026-08-13T07:00:00.000Z' },
  );
}

function validationWriteAuthorization() {
  return {
    authorize: async ({ source, built }: Parameters<
      import('../../server/modules/canonical-host/canonical-host.types').CanonicalFailureValidationWriteAuthorizationPort['authorize']
    >[0]) => ({
      schemaVersion:
        'wiselink.3_1.failure_validation_write_receipt.v0.candidate.1' as const,
      status: 'AUTHORIZED' as const,
      receiptId: 'validation-write-receipt-local-test',
      receiptHash:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      port:
        'wiselink.3_1.port.failure_validation_write_authorization.v0.candidate.1' as const,
      revision: 'candidate.1' as const,
      fingerprint:
        'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      scope: 'PERSIST_U0_FROZEN2_FAILURE_AND_CAS_WORKITEM' as const,
      workItemId: source.correlation.workItemId,
      requestId: source.correlation.requestId,
      documentVersionId: source.correlation.documentVersionId,
      failureId: built.report.failureId,
      reportBytesSha256: sha256Raw(built.reportBytes),
      reportByteLength: built.reportBytes.byteLength,
      authority: {
        failureArtifactPersistAuthorized: true as const,
        failureWorkItemCasAuthorized: true as const,
        packageArtifactPersistAuthorized: false as const,
        publicationAuthorized: false as const,
        currentSwitchAuthorized: false as const,
      },
    }),
  };
}

function authorization() {
  return {
    authorize: async (input: {
      actor: CanonicalHostActor;
      action: CanonicalAuthorizationDecision['action'];
    }): Promise<CanonicalAuthorizationDecision> => ({
      action: input.action,
      allowed: true,
      actorFingerprint:
        'sha256:2ddf749765842ba6c86dcde6a16bfb8f0ef9adacaa676efc08347cf946595f62',
      decisionId: `decision-${input.action.toLowerCase()}`,
      decisionHash:
        'sha256:11a717f1a92303bd8c4382dd3848e00cdcf24ea5b1df5c201125344b27270b49',
      permissionSnapshotVersion: TEST_PERMISSION_SNAPSHOT,
    }),
  };
}

function permissionSnapshots() {
  return {
    freshRead: async () => ({
      permissionSnapshotVersion: TEST_PERMISSION_SNAPSHOT,
    }),
  };
}

describe('CanonicalHostVerticalService', () => {
  it('runs one real frozen.2 package through one WorkItem, Reader and entry facade', async () => {
    const request = await realRequest();
    const bytes = await realPackageBytes();
    const packageId =
      'urn:techpub:package:v1:sha256:9e734a0de1c37c368b954662e9bb11036cc24b430468a073b31da127380df622';
    const producer: CanonicalPdfProducerPort = {
      producePdf: jest.fn().mockResolvedValue({
        kind: 'PACKAGE',
        packageId,
        contractId: 'techpub.parsed-package.v1',
        contractRevision: 'frozen.2',
        bytes,
        strictReaderValidated: true,
        executionRoute: 'dm_request->pdf_producer->frozen_2->strict_reader',
      }),
    };
    const registrar = new InMemoryRegistrar();
    const store = new InMemoryArtifactStore();
    const reader = new UnifiedReaderService(
      store,
      new Frozen2CandidateReaderService(),
      fullValidator(),
      {
        mode: 'HOST_CONFIGURED',
        artifactStoreConfigured: true,
        fullU0ValidatorConfigured: true,
        aeoSpecialistReaderConfigured: false,
        authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
      },
    );
    const service = new CanonicalHostVerticalService(
      registrar,
      producer,
      authorization(),
      permissionSnapshots(),
      store,
      reader,
      entryFacade(),
      failureReports(store, fullValidator()),
    );

    const first = await service.runPdf(request, TEST_ACTOR);
    const second = await service.runPdf(request, TEST_ACTOR);
    const entry = await service.status({
      workItemId: request.workItemId,
      requestId: request.requestId,
      documentVersionId: request.source.documentVersionId,
    }, TEST_ACTOR);
    const query = await service.query({
      workItemId: request.workItemId,
      requestId: request.requestId,
      documentVersionId: request.source.documentVersionId,
      query: request.query,
    }, TEST_ACTOR);
    const ailyEntry = await service.openApiStatus(request.workItemId);
    const ailyQuery = await service.openApiQuery({
      workItemId: request.workItemId,
      query: request.query,
    });
    const ailyDeepLink = await service.openApiDeepLink(request.workItemId);

    expect(first).toMatchObject({
      status: 'CANDIDATE_VERTICAL_VERIFIED',
      workItem: {
        phase: 'CANDIDATE_READBACK_VERIFIED',
        revision: 3,
        source: {
          documentVersionId: request.source.documentVersionId,
        },
        classification: { normalizedFamily: 'FTD' },
        package: {
          packageId,
          contentUnitCount: 311,
          sourceRefCount: 239,
          resultStatus: 'partial',
        },
      },
      entry: {
        phase: 'CANDIDATE_READBACK_VERIFIED',
        packageId,
        deepLinkPath:
          `${TEST_APP_ORIGIN}/work-items/${request.workItemId}/documents`,
        capabilities: {
          status: true,
          queryParsedUnits: true,
          mutatesParsingState: false,
        },
      },
      authority: {
        canonicalRoleSelected: false,
        onlineWritePerformed: false,
        applicationPublished: false,
      },
    });
    expect(first.readback?.queryResults.length).toBeGreaterThan(0);
    expect(first.readback?.queryResults.length).toBeLessThanOrEqual(50);
    expect(
      first.readback?.queryResults.every(
        (item) => item.sourceRefIds.length > 0,
      ),
    ).toBe(true);
    expect(second.workItem.revision).toBe(3);
    expect(producer.producePdf).toHaveBeenCalledTimes(1);
    expect(entry.packageId).toBe(packageId);
    expect(query.readback.package.packageId).toBe(packageId);
    expect(ailyEntry).toEqual({
      entry,
      assessmentSummary: null,
      packageSummary: expect.objectContaining({
        packageId,
        contractRevision: 'frozen.2',
        contentUnitCount: 311,
        sourceRefCount: 239,
        fullValidationStatus: 'FULL_STRICT_VALIDATOR_PASSED',
      }),
    });
    expect(ailyQuery).toMatchObject({
      workItemId: request.workItemId,
      packageId,
      query: request.query,
      resultCount: ailyQuery.results.length,
    });
    expect(ailyQuery.results.length).toBeGreaterThan(0);
    expect(
      ailyQuery.results.every(
        (item) => item.sourceRefIds.length > 0,
      ),
    ).toBe(true);
    expect(ailyDeepLink).toEqual({
      workItemId: request.workItemId,
      deepLink: `${TEST_APP_ORIGIN}/work-items/${request.workItemId}/documents`,
    });
    await expect(
      service.openApiQuery({
        workItemId: request.workItemId,
        query: ' ',
      }),
    ).rejects.toMatchObject({
      code: 'AILY_READ_INPUT_INVALID',
      statusCode: 400,
    });
    expect(producer.producePdf).toHaveBeenCalledTimes(1);
  });

  it('persists an explicit FailureReport and leaves query unavailable', async () => {
    const request = await realRequest();
    const producer: CanonicalPdfProducerPort = {
      producePdf: jest.fn().mockResolvedValue({
        kind: 'FAILURE_SIGNAL',
        failureCode: 'PDF.PROFILE_UNSUPPORTED',
        message: 'Parser profile unavailable for exact document family.',
        executionRoute: 'dm_request->failure_report',
      }),
    };
    const registrar = new InMemoryRegistrar();
    const store = new InMemoryArtifactStore();
    const service = new CanonicalHostVerticalService(
      registrar,
      producer,
      authorization(),
      permissionSnapshots(),
      store,
      new UnifiedReaderService(
        store,
        new Frozen2CandidateReaderService(),
        fullValidator(),
        {
          mode: 'HOST_CONFIGURED',
          artifactStoreConfigured: true,
          fullU0ValidatorConfigured: true,
          aeoSpecialistReaderConfigured: false,
          authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
        },
      ),
      entryFacade(),
      failureReports(store, fullValidator()),
    );

    const response = await service.runPdf(request, TEST_ACTOR);

    expect(response).toMatchObject({
      status: 'FAILED',
      workItem: {
        phase: 'FAILED',
        package: null,
        failure: {
          failureCode: 'PRODUCER_UNSUPPORTED',
          adapterReceipt: {
            adapter: {
              port:
                'wiselink.3_1.port.u0_frozen2_failure_adapter.v0.candidate.1',
              adapterId: 'U0Frozen2FailureAdapterService',
            },
            selectedFailureContract: {
              schemaVersion: 'techpub.parse-failure-report.v1',
              contractRevision: 'frozen.2',
            },
            actualByteReadbackVerified: true,
            strictValidation: {
              status: 'FULL_STRICT_FAILURE_REPORT_VALIDATOR_PASSED',
            },
            authority: {
              createsWorkItemState: false,
              writeAuthorized: false,
            },
          },
          validationWriteReceipt: {
            status: 'AUTHORIZED',
            scope: 'PERSIST_U0_FROZEN2_FAILURE_AND_CAS_WORKITEM',
          },
        },
      },
      readback: null,
      entry: {
        phase: 'FAILED',
        failureCode: 'PRODUCER_UNSUPPORTED',
        capabilities: { queryParsedUnits: false },
      },
    });
    await expect(
      service.query({
        workItemId: request.workItemId,
        requestId: request.requestId,
        documentVersionId: request.source.documentVersionId,
        query: request.query,
      }, TEST_ACTOR),
    ).rejects.toThrow('WORK_ITEM_QUERY_NOT_READY:FAILED');
  });

  it('stops before ArtifactStore I/O when validation-write receipt is absent', async () => {
    const request = await realRequest();
    const store = new InMemoryArtifactStore();
    const persistSpy = jest.spyOn(store, 'persistAndReadback');
    const service = new CanonicalHostVerticalService(
      new InMemoryRegistrar(),
      {
        producePdf: jest.fn().mockResolvedValue({
          kind: 'FAILURE_SIGNAL',
          failureCode: 'PDF.PROFILE_UNSUPPORTED',
          message: 'No profile.',
          executionRoute: 'missing-write-receipt',
        }),
      },
      authorization(),
      permissionSnapshots(),
      store,
      new UnifiedReaderService(
        store,
        new Frozen2CandidateReaderService(),
        fullValidator(),
        {
          mode: 'HOST_CONFIGURED',
          artifactStoreConfigured: true,
          fullU0ValidatorConfigured: true,
          aeoSpecialistReaderConfigured: false,
          authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
        },
      ),
      entryFacade(),
      failureReports(
        store,
        fullValidator(),
        new UnconfiguredFailureValidationWriteAuthorizationAdapter(),
      ),
    );

    await expect(service.runPdf(request, TEST_ACTOR)).rejects.toThrow(
      'FAILURE_VALIDATION_WRITE_RECEIPT_REQUIRED',
    );
    expect(persistSpy).not.toHaveBeenCalled();
  });

  it('stops before authorization and ArtifactStore I/O when the Unified adapter port is unconfigured', async () => {
    const request = await realRequest();
    const store = new InMemoryArtifactStore();
    const persistSpy = jest.spyOn(store, 'persistAndReadback');
    const authorizeSpy = jest.fn(validationWriteAuthorization().authorize);
    const recorder = new CanonicalFailureRecordingService(
      new UnconfiguredU0Frozen2FailureAdapter(),
      { authorize: authorizeSpy },
      store,
      { nowIso: () => '2026-08-13T07:00:00.000Z' },
    );

    await expect(
      recorder.record({
        request,
        permissionSnapshotVersion: TEST_PERMISSION_SNAPSHOT,
        error: new Error('PDF.PROFILE_UNSUPPORTED'),
        executionRoute: 'missing-unified-adapter-port',
        packageAttempt: null,
      }),
    ).rejects.toThrow('U0_FROZEN2_FAILURE_ADAPTER_UNCONFIGURED');
    expect(authorizeSpy).not.toHaveBeenCalled();
    expect(persistSpy).not.toHaveBeenCalled();
  });

  it('records Validator failure as immutable FailureReport with actual-byte readback', async () => {
    const request = await realRequest();
    const bytes = await realPackageBytes();
    const registrar = new InMemoryRegistrar();
    const store = new InMemoryArtifactStore();
    const service = new CanonicalHostVerticalService(
      registrar,
      {
        producePdf: jest.fn().mockResolvedValue({
          kind: 'PACKAGE',
          packageId:
            'urn:techpub:package:v1:sha256:9e734a0de1c37c368b954662e9bb11036cc24b430468a073b31da127380df622',
          contractId: 'techpub.parsed-package.v1',
          contractRevision: 'frozen.2',
          bytes,
          strictReaderValidated: true,
          executionRoute: 'test-validator-failure',
        }),
      },
      authorization(),
      permissionSnapshots(),
      store,
      new UnifiedReaderService(
        store,
        new Frozen2CandidateReaderService(),
        new U0FullValidationService({
          validateActualBytes: async () => {
            throw new Error('FULL_U0_VALIDATOR_REJECTED:STRICT_VALIDATION');
          },
          validateFailureReportActualBytes: async () => {
            throw new Error('TEST_FAILURE_VALIDATOR_NOT_USED');
          },
        }),
        {
          mode: 'HOST_CONFIGURED',
          artifactStoreConfigured: true,
          fullU0ValidatorConfigured: true,
          aeoSpecialistReaderConfigured: false,
          authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
        },
      ),
      entryFacade(),
      failureReports(store, fullValidator()),
    );

    const response = await service.runPdf(request, TEST_ACTOR);
    const artifact = response.workItem.failure?.artifact;

    expect(response).toMatchObject({
      status: 'FAILED',
      workItem: {
        phase: 'FAILED',
        package: null,
        recordingFailure: null,
        failure: {
          failureCode: 'PACKAGE_SEMANTIC_VALIDATION_FAILED',
          message:
            'The package failed the selected frozen.2 validation contract.',
          artifact: { sha256: expect.stringMatching(/^[0-9a-f]{64}$/u) },
        },
      },
    });
    expect(artifact).toBeDefined();
    const actual = await store.readActualBytes(artifact!);
    expect(sha256Raw(actual)).toBe(artifact?.sha256);
    expect(new TextDecoder().decode(actual)).toContain(
      'FULL_U0_VALIDATOR_REJECTED',
    );
  });

  it('records transient package-store failure when FailureReport storage recovers', async () => {
    const request = await realRequest();
    const bytes = await realPackageBytes();
    const delegate = new InMemoryArtifactStore();
    let persistCount = 0;
    const transientStore: UnifiedArtifactStorePort = {
      persistAndReadback: async (value) => {
        persistCount += 1;
        if (persistCount === 1) throw new Error('PACKAGE_STORE_UNAVAILABLE');
        return delegate.persistAndReadback(value);
      },
      readActualBytes: (artifact) => delegate.readActualBytes(artifact),
    };
    const service = new CanonicalHostVerticalService(
      new InMemoryRegistrar(),
      {
        producePdf: jest.fn().mockResolvedValue({
          kind: 'PACKAGE',
          packageId:
            'urn:techpub:package:v1:sha256:9e734a0de1c37c368b954662e9bb11036cc24b430468a073b31da127380df622',
          contractId: 'techpub.parsed-package.v1',
          contractRevision: 'frozen.2',
          bytes,
          strictReaderValidated: true,
          executionRoute: 'test-transient-store-failure',
        }),
      },
      authorization(),
      permissionSnapshots(),
      transientStore,
      new UnifiedReaderService(
        transientStore,
        new Frozen2CandidateReaderService(),
        fullValidator(),
        {
          mode: 'HOST_CONFIGURED',
          artifactStoreConfigured: true,
          fullU0ValidatorConfigured: true,
          aeoSpecialistReaderConfigured: false,
          authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
        },
      ),
      entryFacade(),
      failureReports(transientStore, fullValidator()),
    );

    const response = await service.runPdf(request, TEST_ACTOR);

    expect(response).toMatchObject({
      status: 'FAILED',
      workItem: {
        phase: 'FAILED',
        failure: {
          failureCode: 'PACKAGE_SEMANTIC_VALIDATION_FAILED',
          message:
            'The package failed the selected frozen.2 validation contract.',
          artifact: { sha256: expect.stringMatching(/^[0-9a-f]{64}$/u) },
        },
      },
    });
    expect(persistCount).toBe(2);
  });

  it('records Reader no-result failure as immutable FailureReport', async () => {
    const request = {
      ...(await realRequest()),
      query: 'query-that-does-not-exist-in-the-real-package-4f7166',
    };
    const bytes = await realPackageBytes();
    const store = new InMemoryArtifactStore();
    const service = new CanonicalHostVerticalService(
      new InMemoryRegistrar(),
      {
        producePdf: jest.fn().mockResolvedValue({
          kind: 'PACKAGE',
          packageId:
            'urn:techpub:package:v1:sha256:9e734a0de1c37c368b954662e9bb11036cc24b430468a073b31da127380df622',
          contractId: 'techpub.parsed-package.v1',
          contractRevision: 'frozen.2',
          bytes,
          strictReaderValidated: true,
          executionRoute: 'test-reader-failure',
        }),
      },
      authorization(),
      permissionSnapshots(),
      store,
      new UnifiedReaderService(
        store,
        new Frozen2CandidateReaderService(),
        fullValidator(),
        {
          mode: 'HOST_CONFIGURED',
          artifactStoreConfigured: true,
          fullU0ValidatorConfigured: true,
          aeoSpecialistReaderConfigured: false,
          authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
        },
      ),
      entryFacade(),
      failureReports(store, fullValidator()),
    );

    const response = await service.runPdf(request, TEST_ACTOR);

    expect(response).toMatchObject({
      status: 'FAILED',
      workItem: {
        phase: 'FAILED',
        failure: {
          failureCode: 'READER_REJECTED',
          message:
            'The selected Reader rejected the frozen package query or binding.',
          artifact: { sha256: expect.stringMatching(/^[0-9a-f]{64}$/u) },
        },
      },
    });
  });

  it('records actual-byte drift during idempotent Reader readback', async () => {
    const request = await realRequest();
    const bytes = await realPackageBytes();
    const registrar = new InMemoryRegistrar();
    const store = new InMemoryArtifactStore();
    const producer = {
      producePdf: jest.fn().mockResolvedValue({
        kind: 'PACKAGE' as const,
        packageId:
          'urn:techpub:package:v1:sha256:9e734a0de1c37c368b954662e9bb11036cc24b430468a073b31da127380df622',
        contractId: 'techpub.parsed-package.v1' as const,
        contractRevision: 'frozen.2' as const,
        bytes,
        strictReaderValidated: true as const,
        executionRoute: 'test-idempotent-reader-drift',
      }),
    };
    const service = new CanonicalHostVerticalService(
      registrar,
      producer,
      authorization(),
      permissionSnapshots(),
      store,
      new UnifiedReaderService(
        store,
        new Frozen2CandidateReaderService(),
        fullValidator(),
        {
          mode: 'HOST_CONFIGURED',
          artifactStoreConfigured: true,
          fullU0ValidatorConfigured: true,
          aeoSpecialistReaderConfigured: false,
          authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
        },
      ),
      entryFacade(),
      failureReports(store, fullValidator()),
    );
    const first = await service.runPdf(request, TEST_ACTOR);
    const artifact = first.workItem.package?.artifact;
    expect(artifact).toBeDefined();
    store.overwrite(artifact!, new TextEncoder().encode('{"drift":true}\n'));

    const second = await service.runPdf(request, TEST_ACTOR);

    expect(second).toMatchObject({
      status: 'FAILED',
      workItem: {
        phase: 'FAILED',
        revision: 4,
        failure: {
          failureCode: 'ARTIFACT_READBACK_MISMATCH',
          message: 'The persisted artifact failed exact actual-byte readback.',
          artifact: { sha256: expect.stringMatching(/^[0-9a-f]{64}$/u) },
        },
      },
    });
    expect(producer.producePdf).toHaveBeenCalledTimes(1);
  });

  it('ends RECORDING_FAILED when immutable FailureReport persistence fails', async () => {
    const request = await realRequest();
    const bytes = await realPackageBytes();
    const registrar = new InMemoryRegistrar();
    const packageStore = new InMemoryArtifactStore();
    const failingStore: UnifiedArtifactStorePort = {
      persistAndReadback: async () => {
        throw new Error('ARTIFACT_STORE_WRITE_FAILED');
      },
      readActualBytes: async () => {
        throw new Error('ARTIFACT_STORE_READ_FAILED');
      },
    };
    const service = new CanonicalHostVerticalService(
      registrar,
      {
        producePdf: jest.fn().mockResolvedValue({
          kind: 'PACKAGE',
          packageId:
            'urn:techpub:package:v1:sha256:9e734a0de1c37c368b954662e9bb11036cc24b430468a073b31da127380df622',
          contractId: 'techpub.parsed-package.v1',
          contractRevision: 'frozen.2',
          bytes,
          strictReaderValidated: true,
          executionRoute: 'test-store-failure',
        }),
      },
      authorization(),
      permissionSnapshots(),
      failingStore,
      new UnifiedReaderService(
        packageStore,
        new Frozen2CandidateReaderService(),
        new U0FullValidationService({
          validateActualBytes: async () => {
            throw new Error('FULL_U0_VALIDATOR_REJECTED:STRICT_VALIDATION');
          },
          validateFailureReportActualBytes: async () => {
            throw new Error('TEST_FAILURE_VALIDATOR_NOT_USED');
          },
        }),
        {
          mode: 'HOST_CONFIGURED',
          artifactStoreConfigured: true,
          fullU0ValidatorConfigured: true,
          aeoSpecialistReaderConfigured: false,
          authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
        },
      ),
      entryFacade(),
      failureReports(failingStore, fullValidator()),
    );

    const response = await service.runPdf(request, TEST_ACTOR);

    expect(response).toMatchObject({
      status: 'RECORDING_FAILED',
      workItem: {
        phase: 'RECORDING_FAILED',
        package: null,
        failure: null,
        recordingFailure: {
          failureCode: 'FAILURE_REPORT_RECORDING_FAILED',
          originalFailureCode: 'FULL_U0_VALIDATOR_REJECTED',
          message:
            'FailureReport recording failed: ARTIFACT_STORE_WRITE_FAILED',
        },
      },
      entry: { failureCode: 'FAILURE_REPORT_RECORDING_FAILED' },
    });
  });

  it('fresh-reads page projection and authorizes query without client snapshot', async () => {
    const request = await realRequest();
    const bytes = await realPackageBytes();
    const registrar = new InMemoryRegistrar();
    const store = new InMemoryArtifactStore();
    const authorize = authorization();
    const authorizeSpy = jest.spyOn(authorize, 'authorize');
    const service = new CanonicalHostVerticalService(
      registrar,
      {
        producePdf: jest.fn().mockResolvedValue({
          kind: 'PACKAGE',
          packageId:
            'urn:techpub:package:v1:sha256:9e734a0de1c37c368b954662e9bb11036cc24b430468a073b31da127380df622',
          contractId: 'techpub.parsed-package.v1',
          contractRevision: 'frozen.2',
          bytes,
          strictReaderValidated: true,
          executionRoute: 'test-fresh-page',
        }),
      },
      authorize,
      permissionSnapshots(),
      store,
      new UnifiedReaderService(
        store,
        new Frozen2CandidateReaderService(),
        fullValidator(),
        {
          mode: 'HOST_CONFIGURED',
          artifactStoreConfigured: true,
          fullU0ValidatorConfigured: true,
          aeoSpecialistReaderConfigured: false,
          authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
        },
      ),
      entryFacade(),
      failureReports(store, fullValidator()),
    );
    await service.runPdf(request, TEST_ACTOR);

    const page = await service.page(
      {
        workItemId: request.workItemId,
        query: request.query,
      },
      TEST_ACTOR,
    );

    expect(page).toMatchObject({
      status: 'FRESH_READ',
      workItem: { revision: 3, phase: 'CANDIDATE_READBACK_VERIFIED' },
      readAuthorization: {
        action: 'READ_DOCUMENT_PARSING',
        permissionSnapshotVersion: TEST_PERMISSION_SNAPSHOT,
      },
    });
    expect(page.queryResults.length).toBeGreaterThan(0);
    expect(authorizeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'READ_DOCUMENT_PARSING' }),
    );
  });

  it('fails closed when CanonicalMiaodaApp binding is unconfigured', async () => {
    const request = await realRequest();
    const facade = new CanonicalEntryFacadeService(
      new UnconfiguredCanonicalMiaodaAppBindingAdapter(),
    );

    expect(() => facade.status(entryProjection(request))).toThrow(
      'CANONICAL_MIAODA_APP_BINDING_UNCONFIGURED',
    );
  });

  it('rejects a verified binding whose deep link escapes its exact origin', async () => {
    const request = await realRequest();
    const facade = new CanonicalEntryFacadeService({
      deepLinkForWorkItem: (workItemId) => ({
        bindingStatus: 'VERIFIED_CANONICAL',
        appId: 'app-synthetic-unit-test-only',
        origin: TEST_APP_ORIGIN,
        deepLink:
          `https://attacker.example.test/work-items/` +
          `${encodeURIComponent(workItemId)}/documents`,
      }),
    });

    expect(() => facade.status(entryProjection(request))).toThrow(
      'CANONICAL_ENTRY_INVALID:DEEP_LINK_PATH',
    );
  });

  it.each([
    'actor',
    'authority',
    'decision',
    'permissionSnapshotVersion',
    'deepLinkPath',
  ])('rejects parse request self-reported authority field %s', async (field) => {
    const request = await realRequest();
    const untrustedRequest = {
      ...request,
      [field]: field === 'permissionSnapshotVersion' ? 'client-snapshot' : {},
    } as CanonicalPdfVerticalRunRequest;
    const producer = { producePdf: jest.fn() };
    const store = new InMemoryArtifactStore();
    const service = new CanonicalHostVerticalService(
      new InMemoryRegistrar(),
      producer,
      authorization(),
      permissionSnapshots(),
      store,
      new UnifiedReaderService(
        store,
        new Frozen2CandidateReaderService(),
        fullValidator(),
        {
          mode: 'HOST_CONFIGURED',
          artifactStoreConfigured: true,
          fullU0ValidatorConfigured: true,
          aeoSpecialistReaderConfigured: false,
          authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
        },
      ),
      entryFacade(),
      failureReports(store, fullValidator()),
    );

    await expect(service.runPdf(untrustedRequest, TEST_ACTOR)).rejects.toThrow(
      `CANONICAL_VERTICAL_REQUEST_INVALID:SELF_REPORTED_AUTHORITY:${field}`,
    );
    expect(producer.producePdf).not.toHaveBeenCalled();
  });

  it('rejects idempotency collisions before producer execution', async () => {
    const request = await realRequest();
    const registrar = new InMemoryRegistrar();
    await registrar.loadOrCreate({
      schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
      workItemId: request.workItemId,
      requestId: request.requestId,
      phase: 'PARSE_REQUESTED',
      permissionSnapshotVersion: TEST_PERMISSION_SNAPSHOT,
      parseAuthorization: {
        action: 'PARSE_PDF',
        actorFingerprint:
          'sha256:2ddf749765842ba6c86dcde6a16bfb8f0ef9adacaa676efc08347cf946595f62',
        decisionId: 'decision-parse_pdf',
        decisionHash:
          'sha256:11a717f1a92303bd8c4382dd3848e00cdcf24ea5b1df5c201125344b27270b49',
        permissionSnapshotVersion: TEST_PERMISSION_SNAPSHOT,
      },
      source: {
        ...request.source,
        sourceFileSha256: `sha256:${'0'.repeat(64)}`,
      },
      classification: request.classification,
      package: null,
      failure: null,
      recordingFailure: null,
    });
    const producer = { producePdf: jest.fn() };
    const store = new InMemoryArtifactStore();
    const service = new CanonicalHostVerticalService(
      registrar,
      producer,
      authorization(),
      permissionSnapshots(),
      store,
      new UnifiedReaderService(
        store,
        new Frozen2CandidateReaderService(),
        fullValidator(),
        {
          mode: 'HOST_CONFIGURED',
          artifactStoreConfigured: true,
          fullU0ValidatorConfigured: true,
          aeoSpecialistReaderConfigured: false,
          authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
        },
      ),
      entryFacade(),
      failureReports(store, fullValidator()),
    );

    await expect(service.runPdf(request, TEST_ACTOR)).rejects.toThrow(
      'WORK_ITEM_IDEMPOTENCY_COLLISION',
    );
    expect(producer.producePdf).not.toHaveBeenCalled();
  });
});

async function realRequest(): Promise<CanonicalPdfVerticalRunRequest> {
  return JSON.parse(
    await readFile(
      resolve('test/fixtures/real-ftd-canonical-vertical.request.json'),
      'utf8',
    ),
  ) as CanonicalPdfVerticalRunRequest;
}

async function realPackageBytes(): Promise<Uint8Array> {
  return new Uint8Array(
    await readFile(
      resolve('test/fixtures/real-ftd-frozen2.unified-package.json'),
    ),
  );
}

function clone(
  value: CanonicalWorkItemProjection,
): CanonicalWorkItemProjection {
  return structuredClone(value);
}

function entryProjection(
  request: CanonicalPdfVerticalRunRequest,
): CanonicalWorkItemProjection {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: request.workItemId,
    requestId: request.requestId,
    revision: 1,
    phase: 'PARSE_REQUESTED',
    permissionSnapshotVersion: TEST_PERMISSION_SNAPSHOT,
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint:
        'sha256:2ddf749765842ba6c86dcde6a16bfb8f0ef9adacaa676efc08347cf946595f62',
      decisionId: 'decision-parse_pdf',
      decisionHash:
        'sha256:11a717f1a92303bd8c4382dd3848e00cdcf24ea5b1df5c201125344b27270b49',
      permissionSnapshotVersion: TEST_PERMISSION_SNAPSHOT,
    },
    source: request.source,
    classification: request.classification,
    package: null,
    failure: null,
    recordingFailure: null,
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
    validateFailureReportActualBytes: async ({ artifact, failureId }) => ({
      status: 'FULL_STRICT_FAILURE_REPORT_VALIDATOR_PASSED',
      validatorId: 'U0Frozen2ParseFailureReportValidator',
      validatorRevision: 'test-u0-fa69ada-frozen.2',
      contractId: 'techpub.parse-failure-report.v1',
      contractRevision: 'frozen.2',
      contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
      failureId,
      artifactSha256: artifact.sha256,
    }),
  });
}
