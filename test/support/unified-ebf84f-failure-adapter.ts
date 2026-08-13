import { readFileSync } from 'node:fs';
import { Module } from 'node:module';
import { dirname, resolve } from 'node:path';

import type {
  U0Frozen2FailureAdapterPort,
  U0Frozen2FailureAdapterResult,
  U0Frozen2FailureBuildResult,
  U0Frozen2FailureAdapterInput,
} from '../../server/modules/unified-reader/unified-reader.types';

const unifiedRoot = resolve(
  '/Volumes/SSD/LLM/WiseLink/private/runtime/worktrees/',
  'v3-1-unified-real-http-vertical',
);
const modulePath = resolve(
  unifiedRoot,
  'dist/server/modules/unified-reader/u0-frozen2-failure-adapter.service.js',
);

interface UnifiedAdapterConstructor {
  new (validator: unknown): {
    build(input: unknown): unknown;
    validateActualBytes(input: unknown): Promise<unknown>;
  };
}

const externalModule = new Module(modulePath, module);
externalModule.filename = modulePath;
externalModule.paths = module.paths;
const source = readFileSync(modulePath, 'utf8');
(
  externalModule as Module & {
    _compile(content: string, filename: string): void;
  }
)._compile(source, modulePath);
const loaded = externalModule.exports as {
  U0Frozen2FailureAdapterService: UnifiedAdapterConstructor;
};

export function unifiedEbf84fFailureAdapter(
  validator: unknown,
): U0Frozen2FailureAdapterPort {
  const service = new loaded.U0Frozen2FailureAdapterService(validator);
  return {
    sourceContract: {
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
    },
    build(input: U0Frozen2FailureAdapterInput): U0Frozen2FailureBuildResult {
      return service.build(input) as U0Frozen2FailureBuildResult;
    },
    validateActualBytes(input: {
      source: U0Frozen2FailureAdapterInput;
      artifact: import('@shared/api.interface').UnifiedPackageArtifactDescriptor;
      actualBytes: Uint8Array;
    }): Promise<U0Frozen2FailureAdapterResult> {
      return service.validateActualBytes(
        input,
      ) as Promise<U0Frozen2FailureAdapterResult>;
    },
  };
}
