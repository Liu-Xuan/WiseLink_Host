import { resolve } from 'node:path';

import { resolveVendoredU0PythonModulePath } from '../../server/runtime/u0-python/resolve-vendored-python-module-path';

const VENDOR_ROOT = resolve('server/runtime/u0-python/vendor');

describe('resolveVendoredU0PythonModulePath', () => {
  it.each([
    ['arm64', 'linux-arm64-cp39'],
    ['x64', 'linux-x64-cp39'],
  ] as const)(
    'selects the exact Linux CPython 3.9 %s directory',
    (arch, directory) => {
      expect(
        resolveVendoredU0PythonModulePath({
          platform: 'linux',
          arch,
          pythonVersion: '3.9.2',
          runtimeRoot: VENDOR_ROOT,
        }),
      ).toBe(resolve(VENDOR_ROOT, directory));
    },
  );

  it.each([
    ['darwin', 'arm64', '3.9.2', 'PYTHON_VENDOR_PLATFORM'],
    ['linux', 'arm64', '3.10.0', 'PYTHON_VENDOR_PLATFORM'],
    ['linux', 'riscv64', '3.9.2', 'PYTHON_VENDOR_ARCH'],
  ] as const)(
    'rejects unsupported runtime %s/%s/%s',
    (platform, arch, pythonVersion, expected) => {
      expect(() =>
        resolveVendoredU0PythonModulePath({
          platform: platform as NodeJS.Platform,
          arch: arch as NodeJS.Architecture,
          pythonVersion,
          runtimeRoot: VENDOR_ROOT,
        }),
      ).toThrow(`FULL_U0_VALIDATOR_UNAVAILABLE:${expected}`);
    },
  );
});
