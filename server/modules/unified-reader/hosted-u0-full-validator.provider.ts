import type { Provider } from '@nestjs/common';
import { resolve } from 'node:path';

import {
  resolveHostedU0PythonRuntime,
} from '../../runtime/u0-python/hosted-u0-python-runtime';
import { U0_FULL_PACKAGE_VALIDATOR } from './unified-reader.constants';
import { PythonU0FullPackageValidatorAdapter } from './python-u0-full-package-validator.adapter';

const U0_COMMIT = 'fa69ada08265934951df53c7a61a3ccdb8cb2900' as const;

export function createHostedU0FullPackageValidatorProvider(): Provider {
  return {
    provide: U0_FULL_PACKAGE_VALIDATOR,
    useFactory: async (): Promise<PythonU0FullPackageValidatorAdapter> => {
      const runtime = await resolveHostedU0PythonRuntime();
      return new PythonU0FullPackageValidatorAdapter({
        pythonExecutable: runtime.pythonExecutable,
        pythonModulePath: runtime.pythonModulePath,
        contractRoot: resolve(
          __dirname,
          '../../runtime-assets/technical-publication-parsed-package/v1-frozen-2',
        ),
        contractCommit: U0_COMMIT,
        validatorRevision: 'unified-a958e4b-vendored-python-frozen2',
      });
    },
  };
}
