import { Inject, Injectable } from '@nestjs/common';

import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';

import {
  U0_FULL_PACKAGE_VALIDATOR,
  UNIFIED_READER,
} from './unified-reader.constants';
import type {
  U0FullPackageValidatorPort,
  U0FullValidationProof,
  U0ParseFailureValidationProof,
} from './unified-reader.types';
import { packageIdValue, requiredText } from './unified-reader.utils';

@Injectable()
export class U0FullValidationService {
  constructor(
    @Inject(U0_FULL_PACKAGE_VALIDATOR)
    private readonly validator: U0FullPackageValidatorPort,
  ) {}

  async validate(input: {
    artifact: UnifiedPackageArtifactDescriptor;
    bytes: Uint8Array;
    packageId: string;
  }): Promise<U0FullValidationProof> {
    const proof = await this.validator.validateActualBytes(input);
    if (
      proof.status !== 'FULL_STRICT_VALIDATOR_PASSED' ||
      proof.validatorId !== 'U0Frozen2SchemaSemanticValidator' ||
      proof.contractId !== UNIFIED_READER.packageSchemaVersion ||
      proof.contractRevision !== UNIFIED_READER.contractRevision ||
      proof.contractCommit !== UNIFIED_READER.contractCommit ||
      proof.packageId !== input.packageId ||
      proof.artifactSha256 !== input.artifact.sha256
    ) {
      throw new Error('FULL_U0_VALIDATOR_REJECTED:PROOF_BINDING_MISMATCH');
    }
    packageIdValue(proof.packageId, 'validationProof.packageId');
    requiredText(
      proof.validatorRevision,
      'validationProof.validatorRevision',
      300,
    );
    return { ...proof };
  }

  async validateFailureReport(input: {
    artifact: UnifiedPackageArtifactDescriptor;
    bytes: Uint8Array;
    failureId: string;
  }): Promise<U0ParseFailureValidationProof> {
    const proof: U0ParseFailureValidationProof =
      await this.validator.validateFailureReportActualBytes(input);
    if (
      proof.status !== 'FULL_STRICT_FAILURE_REPORT_VALIDATOR_PASSED' ||
      proof.validatorId !== 'U0Frozen2ParseFailureReportValidator' ||
      proof.contractId !== UNIFIED_READER.failureReportSchemaVersion ||
      proof.contractRevision !== UNIFIED_READER.failureReportContractRevision ||
      proof.contractCommit !== UNIFIED_READER.contractCommit ||
      proof.failureId !== input.failureId ||
      proof.artifactSha256 !== input.artifact.sha256
    ) {
      throw new Error(
        'FULL_U0_FAILURE_REPORT_VALIDATOR_REJECTED:PROOF_BINDING_MISMATCH',
      );
    }
    requiredText(proof.failureId, 'failureValidationProof.failureId', 200);
    requiredText(
      proof.validatorRevision,
      'failureValidationProof.validatorRevision',
      300,
    );
    return { ...proof };
  }
}
