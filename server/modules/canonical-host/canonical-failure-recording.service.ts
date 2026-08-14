import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalFailureValidationWriteReceipt,
  CanonicalPdfVerticalRunRequest,
  U0Frozen2FailureAdapterReceipt,
  UnifiedPackageArtifactDescriptor,
  UnifiedParseFailureReport,
} from '@shared/api.interface';

import {
  U0_FROZEN2_FAILURE_ADAPTER_PORT,
  UNIFIED_ARTIFACT_STORE,
} from '../unified-reader/unified-reader.constants';
import type {
  ImmutableArtifactPersistResult,
  U0Frozen2FailureAdapterInput,
  U0Frozen2FailureAdapterPort,
  U0Frozen2FailureBuildResult,
  UnifiedArtifactStorePort,
} from '../unified-reader/unified-reader.types';
import { sha256Raw } from '../unified-reader/unified-reader.utils';
import {
  CANONICAL_FAILURE_VALIDATION_WRITE_AUTHORIZATION,
  CANONICAL_HOST_CLOCK,
} from './canonical-host.constants';
import type {
  CanonicalFailureValidationWriteAuthorizationPort,
  CanonicalHostClockPort,
} from './canonical-host.types';

interface PackageAttempt {
  packageId: string;
  contractId: string;
  contractRevision: string;
}

export interface CanonicalFailureRecordingResult {
  report: UnifiedParseFailureReport;
  receipt: U0Frozen2FailureAdapterReceipt;
  writeReceipt: CanonicalFailureValidationWriteReceipt;
  persisted: ImmutableArtifactPersistResult;
}

const UNIFIED_FAILURE_SOURCE = {
  port: U0_FROZEN2_FAILURE_ADAPTER_PORT,
  sourceCommit: 'ebf84f87213227b0a4bdf2f9d4909ca1a58b3518',
  adapterRevision: 'candidate.1',
  adapterBuildHash:
    'sha256:255b3354ee9aa0eebd9e2d0a2beb9338d9ce261330de0b1ebb1b3ce0ff804b84',
  manifestSha256:
    '7cb7d08263d3b1e21cd02a38bad9f0d151082633352fdc53781c44f3e3c71787',
  implementationSha256:
    '1658c01ca7bef349a1f364f5330c8332c1715b0191ee93d34353156849d0f048',
  inputSchemaSha256:
    '951bac2fce24f4b58a9bcbf34c0ccb6c124b64c1ab1cfe1867e36db818312240',
} as const;

@Injectable()
export class CanonicalFailureRecordingService {
  constructor(
    @Inject(U0_FROZEN2_FAILURE_ADAPTER_PORT)
    private readonly adapter: U0Frozen2FailureAdapterPort,
    @Inject(CANONICAL_FAILURE_VALIDATION_WRITE_AUTHORIZATION)
    private readonly writeAuthorization:
      CanonicalFailureValidationWriteAuthorizationPort,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
    @Inject(CANONICAL_HOST_CLOCK)
    private readonly clock: CanonicalHostClockPort,
  ) {}

  async record(input: {
    request: CanonicalPdfVerticalRunRequest;
    permissionSnapshotVersion: string;
    error: unknown;
    executionRoute: string;
    packageAttempt: PackageAttempt | null;
  }): Promise<CanonicalFailureRecordingResult> {
    const source: U0Frozen2FailureAdapterInput = this.adapterInput(input);
    const built: U0Frozen2FailureBuildResult = this.adapter.build(source);

    // The authorization call is deliberately before any ArtifactStore mutation.
    const writeReceipt: CanonicalFailureValidationWriteReceipt =
      await this.writeAuthorization.authorize({ source, built });
    validateWriteReceipt(writeReceipt, source, built);

    const persisted: ImmutableArtifactPersistResult =
      await this.artifactStore.persistAndReadback(built.reportBytes);
    const actualBytes: Uint8Array =
      await this.artifactStore.readActualBytes(persisted.artifact);
    assertActualBytes(persisted, built.reportBytes, actualBytes);

    const unified = await this.adapter.validateActualBytes({
      source,
      artifact: persisted.artifact,
      actualBytes,
    });
    validateUnifiedReceipt(unified.receipt, persisted.artifact, built.report);
    return {
      report: unified.report,
      receipt: unified.receipt,
      writeReceipt,
      persisted,
    };
  }

  private adapterInput(input: {
    request: CanonicalPdfVerticalRunRequest;
    permissionSnapshotVersion: string;
    error: unknown;
    executionRoute: string;
    packageAttempt: PackageAttempt | null;
  }): U0Frozen2FailureAdapterInput {
    const causeMessage: string =
      input.error instanceof Error ? input.error.message : String(input.error);
    const [causeCode = 'UNKNOWN_ERROR'] = causeMessage.split(':', 1);
    return {
      schemaVersion:
        'wiselink.3_1.u0_frozen2_failure_adapter_input.v0.candidate.1',
      observedAt: this.clock.nowIso(),
      cause: {
        code: causeCode,
        errorClass:
          input.error instanceof Error
            ? input.error.constructor.name
            : 'NonErrorThrown',
      },
      source: {
        sourceKind: 'pdf',
        sourceArtifactId: input.request.source.sourceArtifactId,
        inputRef: input.request.source.sourceArtifactId,
        inputHash: input.request.source.sourceFileSha256,
      },
      correlation: {
        workItemId: input.request.workItemId,
        requestId: input.request.requestId,
        documentId: input.request.source.documentId,
        documentVersionId: input.request.source.documentVersionId,
        permissionSnapshotVersion: input.permissionSnapshotVersion,
        classificationFingerprint: input.request.classification.fingerprint,
      },
      packageAttempt: input.packageAttempt,
      producer: {
        producerId: 'CanonicalPdfProducer',
        producerRevision: input.request.classification.parserProfileId,
        producerBuildHash: input.request.classification.parserProfileHash,
        executionRoute: input.executionRoute,
      },
    };
  }
}

function validateWriteReceipt(
  receipt: CanonicalFailureValidationWriteReceipt,
  source: U0Frozen2FailureAdapterInput,
  built: U0Frozen2FailureBuildResult,
): void {
  const bytesHash: string = sha256Raw(built.reportBytes);
  if (
    receipt.schemaVersion !==
      'wiselink.3_1.failure_validation_write_receipt.v0.candidate.1' ||
    receipt.status !== 'AUTHORIZED' ||
    receipt.port !==
      'wiselink.3_1.port.failure_validation_write_authorization.v0.candidate.1' ||
    receipt.revision !== 'candidate.1' ||
    receipt.scope !== 'PERSIST_U0_FROZEN2_FAILURE_AND_CAS_WORKITEM' ||
    receipt.workItemId !== source.correlation.workItemId ||
    receipt.requestId !== source.correlation.requestId ||
    receipt.documentVersionId !== source.correlation.documentVersionId ||
    receipt.failureId !== built.report.failureId ||
    receipt.reportBytesSha256 !== bytesHash ||
    receipt.reportByteLength !== built.reportBytes.byteLength ||
    !/^sha256:[0-9a-f]{64}$/u.test(receipt.receiptHash) ||
    !/^sha256:[0-9a-f]{64}$/u.test(receipt.fingerprint) ||
    receipt.authority.failureArtifactPersistAuthorized !== true ||
    receipt.authority.failureWorkItemCasAuthorized !== true ||
    receipt.authority.packageArtifactPersistAuthorized !== false ||
    receipt.authority.publicationAuthorized !== false ||
    receipt.authority.currentSwitchAuthorized !== false
  ) {
    throw new Error('FAILURE_VALIDATION_WRITE_RECEIPT_REJECTED');
  }
}

function assertActualBytes(
  persisted: ImmutableArtifactPersistResult,
  expected: Uint8Array,
  actual: Uint8Array,
): void {
  const hash: string = sha256Raw(expected);
  if (
    persisted.artifact.sha256 !== hash ||
    persisted.artifact.byteLength !== expected.byteLength ||
    sha256Raw(persisted.bytes) !== hash ||
    sha256Raw(actual) !== hash ||
    actual.byteLength !== expected.byteLength
  ) {
    throw new Error('PARSE_FAILURE_REPORT_PERSIST_READBACK_MISMATCH');
  }
}

function validateUnifiedReceipt(
  receipt: U0Frozen2FailureAdapterReceipt,
  artifact: UnifiedPackageArtifactDescriptor,
  report: UnifiedParseFailureReport,
): void {
  if (
    receipt.adapter.port !== U0_FROZEN2_FAILURE_ADAPTER_PORT ||
    receipt.adapter.adapterRevision !== UNIFIED_FAILURE_SOURCE.adapterRevision ||
    receipt.adapter.buildHash !== UNIFIED_FAILURE_SOURCE.adapterBuildHash ||
    receipt.selectedFailureContract.contractCommit !==
      'fa69ada08265934951df53c7a61a3ccdb8cb2900' ||
    receipt.selectedFailureContract.contractManifestSha256 !==
      '730baa88e7254bac6d3808ca2ddbfb1824c5891d6ce3d6d29ce177431cd5ffc0' ||
    receipt.failureId !== report.failureId ||
    receipt.failureArtifact.ref !== artifact.ref ||
    receipt.failureArtifact.sha256 !== artifact.sha256 ||
    receipt.failureArtifact.byteLength !== artifact.byteLength ||
    receipt.strictValidation.failureId !== report.failureId ||
    receipt.strictValidation.artifactSha256 !== artifact.sha256 ||
    receipt.authority.failureContractAuthority !== 'U0_FROZEN_2' ||
    receipt.authority.createsWorkItemState !== false ||
    receipt.authority.writeAuthorized !== false ||
    receipt.authority.publicationAuthorized !== false
  ) {
    throw new Error('U0_FAILURE_ADAPTER_RECEIPT_REJECTED');
  }
}
