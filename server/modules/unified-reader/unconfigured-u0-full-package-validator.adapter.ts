import type {
  U0FullPackageValidatorPort,
  U0FullValidationProof,
  U0ParseFailureValidationProof,
} from './unified-reader.types';

export class UnconfiguredU0FullPackageValidatorAdapter implements U0FullPackageValidatorPort {
  async validateActualBytes(
    _input: Parameters<U0FullPackageValidatorPort['validateActualBytes']>[0],
  ): Promise<U0FullValidationProof> {
    throw new Error(
      'CANONICAL_ROLE_NOT_VERIFIED:U0_FULL_VALIDATOR_UNCONFIGURED',
    );
  }
  async validateFailureReportActualBytes(
    _input: Parameters<
      U0FullPackageValidatorPort['validateFailureReportActualBytes']
    >[0],
  ): Promise<U0ParseFailureValidationProof> {
    throw new Error(
      'CANONICAL_ROLE_NOT_VERIFIED:U0_FAILURE_VALIDATOR_UNCONFIGURED',
    );
  }
}
