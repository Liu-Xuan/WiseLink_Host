import { accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';

const CPYTHON_39_PREFIX = '3.9.';

export function resolveVendoredU0PythonModulePath(input: {
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  pythonVersion: string;
  runtimeRoot?: string;
}): string {
  const platform: NodeJS.Platform = input.platform ?? process.platform;
  const arch: NodeJS.Architecture = input.arch ?? process.arch;
  if (
    platform !== 'linux' ||
    !input.pythonVersion.startsWith(CPYTHON_39_PREFIX)
  ) {
    throw new Error('FULL_U0_VALIDATOR_UNAVAILABLE:PYTHON_VENDOR_PLATFORM');
  }
  const directory: string =
    arch === 'arm64'
      ? 'linux-arm64-cp39'
      : arch === 'x64'
        ? 'linux-x64-cp39'
        : '';
  if (directory === '') {
    throw new Error('FULL_U0_VALIDATOR_UNAVAILABLE:PYTHON_VENDOR_ARCH');
  }
  const root: string = input.runtimeRoot
    ? resolve(input.runtimeRoot)
    : resolve(__dirname, 'vendor');
  const modulePath: string = resolve(root, directory);
  try {
    accessSync(modulePath, constants.R_OK);
  } catch {
    throw new Error('FULL_U0_VALIDATOR_UNAVAILABLE:PYTHON_VENDOR_MISSING');
  }
  return modulePath;
}
