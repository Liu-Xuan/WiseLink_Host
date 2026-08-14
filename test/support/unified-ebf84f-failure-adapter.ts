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
