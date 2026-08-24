import type { Provider } from '@nestjs/common';
import { resolve } from 'node:path';

import {
  resolveHostedU0PythonRuntime,
} from '../../runtime/u0-python/hosted-u0-python-runtime';
import { U0_FULL_PACKAGE_VALIDATOR } from './unified-reader.constants';
import { PythonU0FullPackageValidatorAdapter } from './python-u0-full-package-validator.adapter';

const U0_COMMIT = 'fa69ada08265934951df53c7a61a3ccdb8cb2900' as const;
const LOCAL_DEVELOPMENT_VALIDATOR_REVISION =
  'unified-a958e4b-local-python-frozen2' as const;

export function createHostedU0FullPackageValidatorProvider(): Provider {
  const localPython: string | undefined = localDevelopmentPython();
  return {
    provide: U0_FULL_PACKAGE_VALIDATOR,
    useFactory: async (): Promise<PythonU0FullPackageValidatorAdapter> => {
      if (localPython) {
        return new PythonU0FullPackageValidatorAdapter({
          pythonExecutable: localPython,
          contractRoot: contractRoot(),
          contractCommit: U0_COMMIT,
          validatorRevision: LOCAL_DEVELOPMENT_VALIDATOR_REVISION,
        });
      }
      const runtime = await resolveHostedU0PythonRuntime();
      return new PythonU0FullPackageValidatorAdapter({
        pythonExecutable: runtime.pythonExecutable,
        pythonModulePath: runtime.pythonModulePath,
        contractRoot: contractRoot(),
        contractCommit: U0_COMMIT,
        validatorRevision: 'unified-a958e4b-vendored-python-frozen2',
      });
    },
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
