import { accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';

const CPYTHON_39_PREFIX = '3.9.';
const CPYTHON_310_PREFIX = '3.10.';

export function resolveVendoredU0PythonModulePath(input: {
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  pythonVersion: string;
  runtimeRoot?: string;
}): string {
  const platform: NodeJS.Platform = input.platform ?? process.platform;
  const arch: NodeJS.Architecture = input.arch ?? process.arch;
  if (platform !== 'linux') {
    throw new Error('FULL_U0_VALIDATOR_UNAVAILABLE:PYTHON_VENDOR_PLATFORM');
  }
  if (arch !== 'arm64' && arch !== 'x64') {
    throw new Error('FULL_U0_VALIDATOR_UNAVAILABLE:PYTHON_VENDOR_ARCH');
  }
  const minor: 'cp39' | 'cp310' | null = input.pythonVersion.startsWith(
    CPYTHON_39_PREFIX,
  )
    ? 'cp39'
    : input.pythonVersion.startsWith(CPYTHON_310_PREFIX)
      ? 'cp310'
      : null;
  if (minor === null) {
    throw new Error('FULL_U0_VALIDATOR_UNAVAILABLE:PYTHON_VENDOR_PLATFORM');
  }
  const archDirectory: 'arm64' | 'x64' = arch === 'arm64' ? 'arm64' : 'x64';
  const directory = `linux-${archDirectory}-${minor}`;
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
