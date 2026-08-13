import type {
  U0Frozen2FailureAdapterInput,
  U0Frozen2FailureAdapterPort,
  U0Frozen2FailureAdapterResult,
  U0Frozen2FailureBuildResult,
} from './unified-reader.types';

export class UnconfiguredU0Frozen2FailureAdapter
  implements U0Frozen2FailureAdapterPort
{
  readonly sourceContract = {
    port: 'wiselink.3_1.port.u0_frozen2_failure_adapter.v0.candidate.1',
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

  build(_input: U0Frozen2FailureAdapterInput): U0Frozen2FailureBuildResult {
    throw new Error('U0_FROZEN2_FAILURE_ADAPTER_UNCONFIGURED');
  }

  async validateActualBytes(_input: {
    source: U0Frozen2FailureAdapterInput;
    artifact: import('@shared/api.interface').UnifiedPackageArtifactDescriptor;
    actualBytes: Uint8Array;
  }): Promise<U0Frozen2FailureAdapterResult> {
    throw new Error('U0_FROZEN2_FAILURE_ADAPTER_UNCONFIGURED');
  }
}
