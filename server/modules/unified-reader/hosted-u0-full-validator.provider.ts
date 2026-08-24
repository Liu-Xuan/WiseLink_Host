import type { Provider } from '@nestjs/common';
import { resolve } from 'node:path';

import { U0_FULL_PACKAGE_VALIDATOR } from './unified-reader.constants';
import type {
  U0FullPackageValidatorPort,
  U0FullValidationProof,
  U0ParseFailureValidationProof,
} from './unified-reader.types';

const U0_COMMIT = 'fa69ada08265934951df53c7a61a3ccdb8cb2900' as const;
const HOSTED_VALIDATOR_REVISION =
  'unified-a958e4b-vendored-python-frozen2' as const;
const LOCAL_DEVELOPMENT_VALIDATOR_REVISION =
  'unified-a958e4b-local-python-frozen2' as const;

/**
 * Lazy host binding for the exact frozen.2 U0 validator.
 *
 * Nest bootstrap, /api/identity/whoami, native FileService and document
 * management routes must never resolve the Python U0 runtime. The underlying
 * PythonU0FullPackageValidatorAdapter (and the vendored Python runtime it
 * probes) is resolved on the first real U0 validation call only. When the
 * cp310/cp39 vendor or runtime is not ready, the real call fails closed with
 * the precise FULL_U0_VALIDATOR_UNAVAILABLE:* error — never a synthetic
 * validator, never a local filesystem fallback, never a silent downgrade.
 */
export class LazyHostedU0FullPackageValidator
  implements U0FullPackageValidatorPort
{
  private adapterPromise: Promise<U0FullPackageValidatorPort> | null = null;

  async validateActualBytes(input: {
    artifact: import('@shared/api.interface').UnifiedPackageArtifactDescriptor;
    bytes: Uint8Array;
    packageId: string;
  }): Promise<U0FullValidationProof> {
    const adapter = await this.resolveAdapter();
    return adapter.validateActualBytes(input);
  }

  async validateFailureReportActualBytes(input: {
    artifact: import('@shared/api.interface').UnifiedPackageArtifactDescriptor;
    bytes: Uint8Array;
    failureId: string;
  }): Promise<U0ParseFailureValidationProof> {
    const adapter = await this.resolveAdapter();
    return adapter.validateFailureReportActualBytes(input);
  }

  private resolveAdapter(): Promise<U0FullPackageValidatorPort> {
    // Resolution — including its failure — is memoized so an unavailable
    // vendor stays fail-closed for every subsequent call.
    this.adapterPromise ??= createHostedValidatorAdapter();
    return this.adapterPromise;
  }
}

async function createHostedValidatorAdapter(): Promise<U0FullPackageValidatorPort> {
  const { PythonU0FullPackageValidatorAdapter } = await import(
    './python-u0-full-package-validator.adapter'
  );
  const localPython = localDevelopmentPython();
  if (localPython) {
    return new PythonU0FullPackageValidatorAdapter({
      pythonExecutable: localPython,
      contractRoot: contractRoot(),
      contractCommit: U0_COMMIT,
      validatorRevision: LOCAL_DEVELOPMENT_VALIDATOR_REVISION,
    });
  }
  const { resolveHostedU0PythonRuntime } = await import(
    '../../runtime/u0-python/hosted-u0-python-runtime'
  );
  const runtime = await resolveHostedU0PythonRuntime();
  return new PythonU0FullPackageValidatorAdapter({
    pythonExecutable: runtime.pythonExecutable,
    pythonModulePath: runtime.pythonModulePath,
    contractRoot: contractRoot(),
    contractCommit: U0_COMMIT,
    validatorRevision: HOSTED_VALIDATOR_REVISION,
  });
}

export function createHostedU0FullPackageValidatorProvider(): Provider {
  return {
    provide: U0_FULL_PACKAGE_VALIDATOR,
    useClass: LazyHostedU0FullPackageValidator,
  };
}

function localDevelopmentPython(): string | undefined {
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.MIAODA_LOCAL_DEV !== '1'
  ) {
    return undefined;
  }
  const executable: string | undefined =
    process.env.WL_LOCAL_U0_PYTHON?.trim();
  if (!executable) {
    throw new Error('FULL_U0_VALIDATOR_UNAVAILABLE:LOCAL_PYTHON_REQUIRED');
  }
  return executable;
}

function contractRoot(): string {
  return resolve(
    __dirname,
    '../../runtime-assets/technical-publication-parsed-package/v1-frozen-2',
  );
}
