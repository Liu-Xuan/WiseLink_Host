import { Inject, Injectable } from '@nestjs/common';

import type {
  UnifiedAcceptanceCandidateReceipt,
  UnifiedAcceptanceCorrelation,
  UnifiedAcceptanceRequest,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';

import { Frozen2CandidateReaderService } from './frozen2-candidate-reader.service';
import { U0FullValidationService } from './u0-full-validation.service';
import {
  AEO_SPECIALIST_READER,
  UNIFIED_ARTIFACT_STORE,
  UNIFIED_READER,
} from './unified-reader.constants';
import type {
  AeoSpecialistReaderInspection,
  AeoSpecialistReaderPort,
  UnifiedArtifactStorePort,
  UnifiedReaderPackageInspection,
} from './unified-reader.types';
import {
  canonicalJson,
  packageIdValue,
  rawHashValue,
  requiredText,
  sha256Text,
} from './unified-reader.utils';

type DispatchResult =
  | {
      route: 'UNIFIED_FROZEN_2';
      handlerId: 'Frozen2CandidateReaderService';
      handlerRevision: 'frozen.2-bounded.candidate.1';
      summaryHash: string;
      sourceBoundUnitCount: number;
    }
  | {
      route: 'AEO_SPECIALIST';
      handlerId: string;
      handlerRevision: string;
      summaryHash: string;
      sourceBoundUnitCount: number;
    };

@Injectable()
export class UnifiedAcceptanceFacadeService {
  constructor(
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
    private readonly frozen2Reader: Frozen2CandidateReaderService,
    private readonly fullValidator: U0FullValidationService,
    @Inject(AEO_SPECIALIST_READER)
    private readonly aeoReader: AeoSpecialistReaderPort,
  ) {}

  async inspect(
    request: UnifiedAcceptanceRequest,
  ): Promise<UnifiedAcceptanceCandidateReceipt> {
    validateRequest(request);
    const bytes: Uint8Array = await this.artifactStore.readActualBytes(
      request.package.artifact,
    );
    const dispatch: DispatchResult = await this.dispatch(
      request,
      bytes,
    );
    const receiptCore = {
      schemaVersion: UNIFIED_READER.acceptanceReceiptSchemaVersion,
      acceptanceFacade: {
        role: 'UnifiedAcceptanceFacadeCandidate' as const,
        registryRevision: UNIFIED_READER.acceptanceRegistryRevision,
        implementationRevision: UNIFIED_READER.acceptanceFacadeRevision,
      },
      correlation: { ...request.correlation },
      package: {
        packageId: request.package.packageId,
        contract: { ...request.package.contract },
        artifactStoreRole: request.package.artifact.storeRole,
        artifactRef: request.package.artifact.ref,
        artifactSha256: request.package.artifact.sha256,
        artifactByteLength: request.package.artifact.byteLength,
        artifactMediaType: request.package.artifact.mediaType,
      },
      dispatch: {
        route: dispatch.route,
        handlerId: dispatch.handlerId,
        handlerRevision: dispatch.handlerRevision,
        fallbackUsed: false as const,
      },
      validationStatus: 'CANDIDATE_ACCEPTED' as const,
      validatedSummaryHash: dispatch.summaryHash,
      sourceBoundUnitCount: dispatch.sourceBoundUnitCount,
      authority: {
        canonicalReaderActivated: false as const,
        createsWorkItemState: false as const,
        createsEngineeringConclusion: false as const,
        grantsPublication: false as const,
        selectsCurrent: false as const,
      },
    };
    const receiptCanonicalSha256: string = sha256Text(
      canonicalJson(receiptCore),
    );
    return {
      ...receiptCore,
      receiptId:
        `unified_acceptance_candidate_${receiptCanonicalSha256.slice(
          'sha256:'.length,
          'sha256:'.length + 32,
        )}`,
      receiptCanonicalSha256,
    };
  }

  private async dispatch(
    request: UnifiedAcceptanceRequest,
    bytes: Uint8Array,
  ): Promise<DispatchResult> {
    const contract = request.package.contract;
    if (
      contract.contractId === UNIFIED_READER.packageSchemaVersion &&
      contract.contractRevision === UNIFIED_READER.contractRevision
    ) {
      if (request.specialistContext !== null) {
        throw new Error(
          'UNIFIED_ACCEPTANCE_DISPATCH_REJECTED:UNIFIED_CONTEXT_MUST_BE_NULL',
        );
      }
      await this.fullValidator.validate({
        artifact: request.package.artifact,
        bytes,
        packageId: request.package.packageId,
      });
      const inspection: UnifiedReaderPackageInspection =
        this.frozen2Reader.inspect(request.package.artifact, bytes);
      if (inspection.packageId !== request.package.packageId) {
        throw new Error('UNIFIED_ACCEPTANCE_REJECTED:PACKAGE_ID_MISMATCH');
      }
      return {
        route: 'UNIFIED_FROZEN_2',
        handlerId: 'Frozen2CandidateReaderService',
        handlerRevision: 'frozen.2-bounded.candidate.1',
        summaryHash: inspection.summaryHash,
        sourceBoundUnitCount: inspection.sourceBoundUnitCount,
      };
    }
    if (
      contract.contractId === 'aeo_structured_parse_v1' &&
      contract.contractRevision === 'candidate.1'
    ) {
      if (request.specialistContext?.family !== 'AEO') {
        throw new Error(
          'UNIFIED_ACCEPTANCE_DISPATCH_REJECTED:AEO_CONTEXT_REQUIRED',
        );
      }
      const inspection: AeoSpecialistReaderInspection =
        await this.aeoReader.inspectActualBytes({
          artifact: request.package.artifact,
          bytes,
          packageId: request.package.packageId,
          context: request.specialistContext,
        });
      if (
        inspection.packageId !== request.package.packageId ||
        inspection.contractId !== contract.contractId ||
        inspection.contractRevision !== contract.contractRevision
      ) {
        throw new Error('UNIFIED_ACCEPTANCE_REJECTED:HANDLER_BINDING_MISMATCH');
      }
      return {
        route: 'AEO_SPECIALIST',
        handlerId: requiredText(
          inspection.handlerId,
          'inspection.handlerId',
          200,
        ),
        handlerRevision: requiredText(
          inspection.handlerRevision,
          'inspection.handlerRevision',
          200,
        ),
        summaryHash: requiredPrefixedHash(
          inspection.summaryHash,
          'inspection.summaryHash',
        ),
        sourceBoundUnitCount: positiveCount(
          inspection.sourceBoundUnitCount,
          'inspection.sourceBoundUnitCount',
        ),
      };
    }
    throw new Error('UNIFIED_ACCEPTANCE_DISPATCH_REJECTED:UNKNOWN_CONTRACT');
  }
}

function validateRequest(request: UnifiedAcceptanceRequest): void {
  exactKeys(
    request,
    ['schemaVersion', 'correlation', 'package', 'specialistContext'],
    'request',
  );
  if (request.schemaVersion !== UNIFIED_READER.acceptanceRequestSchemaVersion) {
    throw new Error('UNIFIED_ACCEPTANCE_REQUEST_INVALID:SCHEMA_VERSION');
  }
  validateCorrelation(request.correlation);
  exactKeys(
    request.package,
    ['packageId', 'contract', 'artifact'],
    'package',
  );
  exactKeys(
    request.package.contract,
    ['contractId', 'contractRevision'],
    'package.contract',
  );
  const isUnifiedFrozen2 =
    request.package.contract.contractId ===
      UNIFIED_READER.packageSchemaVersion &&
    request.package.contract.contractRevision === UNIFIED_READER.contractRevision;
  const isAeoCandidate =
    request.package.contract.contractId === 'aeo_structured_parse_v1' &&
    request.package.contract.contractRevision === 'candidate.1';
  if (!isUnifiedFrozen2 && !isAeoCandidate) {
    throw new Error('UNIFIED_ACCEPTANCE_DISPATCH_REJECTED:UNKNOWN_CONTRACT');
  }
  if (isUnifiedFrozen2 && request.specialistContext !== null) {
    throw new Error(
      'UNIFIED_ACCEPTANCE_DISPATCH_REJECTED:UNIFIED_CONTEXT_MUST_BE_NULL',
    );
  }
  if (isAeoCandidate && request.specialistContext?.family !== 'AEO') {
    throw new Error(
      'UNIFIED_ACCEPTANCE_DISPATCH_REJECTED:AEO_CONTEXT_REQUIRED',
    );
  }
  requiredText(request.package.packageId, 'package.packageId', 300);
  if (isUnifiedFrozen2) {
    packageIdValue(request.package.packageId, 'package.packageId');
  } else if (!/^AEOPARSE-[A-F0-9]{24}$/u.test(request.package.packageId)) {
    throw new Error('UNIFIED_ACCEPTANCE_REQUEST_INVALID:AEO_PACKAGE_ID');
  }
  validateArtifact(request.package.artifact);
  if (request.specialistContext !== null) {
    exactKeys(
      request.specialistContext,
      [
        'family',
        'formalAeoIdentity',
        'revision',
        'iteration',
        'sourceMediaType',
        'sourceByteLength',
        'sourceSha256',
        'packageHash',
        'currentness',
      ],
      'specialistContext',
    );
    if (
      request.specialistContext.family !== 'AEO' ||
      !Number.isSafeInteger(request.specialistContext.sourceByteLength) ||
      request.specialistContext.sourceByteLength <= 0 ||
      !['UNVERIFIED', 'CURRENT', 'HISTORICAL', 'CANCELLED'].includes(
        request.specialistContext.currentness,
      )
    ) {
      throw new Error('UNIFIED_ACCEPTANCE_REQUEST_INVALID:AEO_CONTEXT');
    }
    requiredText(
      request.specialistContext.formalAeoIdentity,
      'specialistContext.formalAeoIdentity',
      300,
    );
    requiredText(
      request.specialistContext.revision,
      'specialistContext.revision',
      100,
    );
    requiredText(
      request.specialistContext.iteration,
      'specialistContext.iteration',
      100,
    );
    requiredText(
      request.specialistContext.sourceMediaType,
      'specialistContext.sourceMediaType',
      300,
    );
    rawHashValue(
      request.specialistContext.sourceSha256,
      'specialistContext.sourceSha256',
    );
    rawHashValue(
      request.specialistContext.packageHash,
      'specialistContext.packageHash',
    );
  }
}

function validateCorrelation(value: UnifiedAcceptanceCorrelation): void {
  exactKeys(
    value,
    [
      'workItemId',
      'requestId',
      'documentVersionId',
      'permissionSnapshotVersion',
      'classificationFingerprint',
    ],
    'correlation',
  );
  requiredText(value.workItemId, 'correlation.workItemId', 300);
  requiredText(value.requestId, 'correlation.requestId', 300);
  requiredText(
    value.documentVersionId,
    'correlation.documentVersionId',
    300,
  );
  requiredText(
    value.permissionSnapshotVersion,
    'correlation.permissionSnapshotVersion',
    300,
  );
  requiredText(
    value.classificationFingerprint,
    'correlation.classificationFingerprint',
    300,
  );
}

function validateArtifact(artifact: UnifiedPackageArtifactDescriptor): void {
  exactKeys(
    artifact,
    ['storeRole', 'ref', 'sha256', 'byteLength', 'mediaType'],
    'package.artifact',
  );
  if (
    artifact.storeRole !== UNIFIED_READER.artifactStoreRole ||
    artifact.mediaType !== 'application/json' ||
    !Number.isSafeInteger(artifact.byteLength) ||
    artifact.byteLength <= 0
  ) {
    throw new Error('UNIFIED_ACCEPTANCE_REQUEST_INVALID:ARTIFACT');
  }
  requiredText(artifact.ref, 'package.artifact.ref', 1000);
  rawHashValue(artifact.sha256, 'package.artifact.sha256');
}

function exactKeys(
  value: unknown,
  keys: readonly string[],
  field: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`UNIFIED_ACCEPTANCE_REQUEST_INVALID:${field}`);
  }
  const actual: string[] = Object.keys(value as Record<string, unknown>).sort();
  const expected: string[] = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key: string, index: number) => key !== expected[index])
  ) {
    throw new Error(`UNIFIED_ACCEPTANCE_REQUEST_INVALID:${field}_KEYS`);
  }
}

function requiredPrefixedHash(value: unknown, field: string): string {
  const normalized: string = requiredText(value, field, 71);
  if (!/^sha256:[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error(`UNIFIED_ACCEPTANCE_HANDLER_INVALID:${field}`);
  }
  return normalized;
}

function positiveCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`UNIFIED_ACCEPTANCE_HANDLER_INVALID:${field}`);
  }
  return value as number;
}
