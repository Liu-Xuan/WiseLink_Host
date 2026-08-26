import { Inject, Injectable } from '@nestjs/common';

import type {
  UnifiedPackageArtifactDescriptor,
  UnifiedPackageReadbackRequest,
  UnifiedPackageReadbackResponse,
  UnifiedReaderReadinessResponse,
  UnifiedReaderCandidateReceipt,
  UnifiedReaderQueryResult,
} from '@shared/api.interface';

import { Frozen2CandidateReaderService } from './frozen2-candidate-reader.service';
import { U0FullValidationService } from './u0-full-validation.service';
import {
  UNIFIED_ARTIFACT_STORE,
  UNIFIED_READER,
  UNIFIED_READER_HOST_BINDING,
} from './unified-reader.constants';
import type {
  ImmutableArtifactPersistResult,
  UnifiedArtifactStorePort,
  UnifiedReaderHostBindingState,
  UnifiedReaderPackageSummary,
} from './unified-reader.types';
import {
  canonicalJson,
  packageIdValue,
  rawHashValue,
  requiredText,
  sha256Text,
} from './unified-reader.utils';

@Injectable()
export class UnifiedReaderService {
  constructor(
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
    private readonly reader: Frozen2CandidateReaderService,
    private readonly fullValidator: U0FullValidationService,
    @Inject(UNIFIED_READER_HOST_BINDING)
    private readonly hostBinding: UnifiedReaderHostBindingState,
  ) {}

  readiness(): UnifiedReaderReadinessResponse {
    return {
      schemaVersion: UNIFIED_READER.readinessSchemaVersion,
      status: 'VERIFICATION_PENDING',
      hostedServiceRevision: UNIFIED_READER.implementationRevision,
      packageContract: {
        selectionStatus: 'R1_FROZEN',
        preferredCandidate: {
          contractId: UNIFIED_READER.packageSchemaVersion,
          contractRevision: UNIFIED_READER.contractRevision,
          contractCommit: UNIFIED_READER.contractCommit,
        },
      },
      capabilities: {
        candidateSourceAvailable: true,
        unifiedAcceptanceFacadeSourceAvailable: true,
        aeoSpecialistReaderConfigured:
          this.hostBinding.aeoSpecialistReaderConfigured,
        artifactStoreConfigured: this.hostBinding.artifactStoreConfigured,
        fullU0ValidatorConfigured: this.hostBinding.fullU0ValidatorConfigured,
        immutableAcceptanceReceiptOwnerConfigured:
          this.hostBinding.immutableAcceptanceReceiptOwnerConfigured,
        immutableArtifactPersistAndReadback: false,
        sourceBoundCandidateReadback: false,
        boundedSourceQuery: true,
        workItemMutation: false,
        publication: false,
        currentnessMutation: false,
      },
      blockers: [
        'CANONICAL_ROLE_UNRESOLVED',
        'CANONICAL_ROLE_NOT_VERIFIED',
        'HOSTED_CANONICAL_RUNTIME_UNVERIFIED',
        ...(!this.hostBinding.artifactStoreConfigured
          ? ['UNIFIED_ARTIFACT_STORE_NOT_CONFIGURED']
          : []),
        ...(!this.hostBinding.fullU0ValidatorConfigured
          ? ['U0_FULL_VALIDATOR_NOT_CONFIGURED']
          : []),
        ...(!this.hostBinding.immutableAcceptanceReceiptOwnerConfigured
          ? ['IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_NOT_CONFIGURED']
          : []),
        ...(!this.hostBinding.aeoSpecialistReaderConfigured
          ? ['AEO_SPECIALIST_READER_NOT_CONFIGURED']
          : []),
        'ONLINE_WRITE_NOT_AUTHORIZED',
        'APPLICATION_PUBLISH_NOT_AUTHORIZED',
      ],
    };
  }

  async readAllSourceUnits(input: {
    artifact: UnifiedPackageArtifactDescriptor;
    packageId: string;
  }): Promise<UnifiedReaderQueryResult[]> {
    const bytes = await this.artifactStore.readActualBytes(input.artifact);
    await this.fullValidator.validate({
      artifact: input.artifact,
      bytes,
      packageId: input.packageId,
    });
    return this.reader.readAllSourceUnits(input.artifact, bytes);
  }

  async persistAndReadback(
    bytes: Uint8Array,
    context: Omit<UnifiedPackageReadbackRequest, 'package'> & {
      packageId: string;
      contractId: string;
      contractRevision: string;
    },
  ): Promise<UnifiedPackageReadbackResponse> {
    const persisted: ImmutableArtifactPersistResult =
      await this.artifactStore.persistAndReadback(bytes);
    const request: UnifiedPackageReadbackRequest = {
      workItemId: context.workItemId,
      requestId: context.requestId,
      documentVersionId: context.documentVersionId,
      permissionSnapshotVersion: context.permissionSnapshotVersion,
      package: {
        packageId: context.packageId,
        contractId: context.contractId,
        contractRevision: context.contractRevision,
        artifact: persisted.artifact,
      },
      query: context.query,
    };
    return this.readback(request);
  }

  async readback(
    request: UnifiedPackageReadbackRequest,
  ): Promise<UnifiedPackageReadbackResponse> {
    this.validateRequest(request);
    const artifact: UnifiedPackageArtifactDescriptor = request.package.artifact;
    const bytes: Uint8Array = await this.artifactStore.readActualBytes(artifact);
    const fullValidatorProof = await this.fullValidator.validate({
      artifact,
      bytes,
      packageId: request.package.packageId,
    });
    const summary: UnifiedReaderPackageSummary = this.reader.read(
      artifact,
      bytes,
      request.query,
    );
    if (
      summary.packageId !== request.package.packageId ||
      summary.contractId !== request.package.contractId ||
      summary.contractRevision !== request.package.contractRevision
    ) {
      throw new Error('READER_REJECTED:PACKAGE_BINDING_MISMATCH');
    }
    const receipt: UnifiedReaderCandidateReceipt = this.receipt(
      artifact,
      request.query,
      summary,
    );
    return {
      schemaVersion: UNIFIED_READER.readbackSchemaVersion,
      status: 'CANDIDATE_READBACK_VERIFIED',
      workItemId: request.workItemId,
      requestId: request.requestId,
      documentVersionId: request.documentVersionId,
      permissionSnapshotVersion: request.permissionSnapshotVersion,
      artifact: { ...artifact },
      package: {
        packageId: summary.packageId,
        contractId: summary.contractId,
        contractRevision: summary.contractRevision,
        sourceKind: summary.sourceKind,
        contentHash: summary.contentHash,
        semanticHash: summary.semanticHash,
        provenanceHash: summary.provenanceHash,
        coverageHash: summary.coverageHash,
        resultStatus: summary.resultStatus,
        title: summary.title,
        revisionLabel: summary.revisionLabel,
        contentUnitCount: summary.contentUnitCount,
        sourceRefCount: summary.sourceRefCount,
      },
      receipt,
      fullValidatorProof: {
        status: fullValidatorProof.status,
        validatorId: fullValidatorProof.validatorId,
        validatorRevision: fullValidatorProof.validatorRevision,
        contractCommit: fullValidatorProof.contractCommit,
        artifactSha256: fullValidatorProof.artifactSha256,
      },
      queryResults: summary.queryResults.map((result) => ({
        ...result,
        sourceRefIds: [...result.sourceRefIds],
        sourceLocators: result.sourceLocators?.map((locator) => ({
          ...locator,
          bbox: locator.bbox ? [...locator.bbox] : null,
        })),
      })),
    };
  }

  private validateRequest(request: UnifiedPackageReadbackRequest): void {
    requiredText(request.workItemId, 'workItemId', 300);
    requiredText(request.requestId, 'requestId', 300);
    requiredText(request.documentVersionId, 'documentVersionId', 300);
    requiredText(
      request.permissionSnapshotVersion,
      'permissionSnapshotVersion',
      300,
    );
    packageIdValue(request.package.packageId, 'package.packageId');
    requiredText(request.package.contractId, 'package.contractId', 300);
    requiredText(
      request.package.contractRevision,
      'package.contractRevision',
      100,
    );
    rawHashValue(request.package.artifact.sha256, 'package.artifact.sha256');
    requiredText(request.query, 'query', 200);
    if (
      request.package.contractId !== UNIFIED_READER.packageSchemaVersion ||
      request.package.contractRevision !== UNIFIED_READER.contractRevision
    ) {
      throw new Error('CANONICAL_ROLE_NOT_VERIFIED:PACKAGE_CONTRACT');
    }
  }

  private receipt(
    artifact: UnifiedPackageArtifactDescriptor,
    query: string,
    summary: UnifiedReaderPackageSummary,
  ): UnifiedReaderCandidateReceipt {
    const receiptIdDigest: string = sha256Text(
      canonicalJson({
        namespace: 'wiselink-3-1-reader-candidate-receipt-v0',
        implementationRevision: UNIFIED_READER.implementationRevision,
        contractId: summary.contractId,
        contractRevision: summary.contractRevision,
        packageId: summary.packageId,
        packageArtifactSha256: artifact.sha256,
        summaryHash: summary.summaryHash,
        query,
        resultIds: summary.queryResults.map(
          (result) => result.unitId,
        ),
      }),
    ).slice('sha256:'.length, 'sha256:'.length + 32);
    return {
      schemaVersion: UNIFIED_READER.receiptSchemaVersion,
      readerReceiptId: `reader_receipt_${receiptIdDigest}`,
      reader: {
        role: 'UnifiedReaderCandidate',
        contractId: summary.contractId,
        revision: `candidate.${UNIFIED_READER.contractRevision}`,
        implementationRevision: UNIFIED_READER.implementationRevision,
      },
      packageId: summary.packageId,
      packageArtifactSha256: artifact.sha256,
      validationStatus: 'CONSUMER_READBACK_VERIFIED',
      summaryHash: summary.summaryHash,
      sourceBoundUnitCount: summary.sourceBoundUnitCount,
      queryProbe: {
        query,
        resultCount: summary.queryResults.length,
        allResultsHaveSourceRefs: true,
      },
      authority: {
        createsWorkItemState: false,
        createsEngineeringConclusion: false,
        grantsPublication: false,
        selectsCurrent: false,
      },
    };
  }
}
