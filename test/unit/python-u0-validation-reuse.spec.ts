import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { PythonU0FullPackageValidatorAdapter } from '../../server/modules/unified-reader/python-u0-full-package-validator.adapter';
import { sha256Raw } from '../../server/modules/unified-reader/unified-reader.utils';

jest.mock('node:child_process', () => ({
  execFile: Object.assign(jest.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: jest.fn(),
  }),
}));

const execute = jest.mocked(promisify(execFile));
const packageId = `urn:techpub:package:v1:sha256:${'1'.repeat(64)}`;
const successfulOutput = {
  stdout: JSON.stringify({
    ok: true,
    summary: {
      selectedContractRevision: 'frozen.2',
      package: { schemaVersion: 'techpub.parsed-package.v1', contractRevision: 'frozen.2', packageId },
    },
  }),
  stderr: '',
};

function input(value = 1) {
  const bytes = new TextEncoder().encode(JSON.stringify({ value }));
  return {
    packageId,
    bytes,
    artifact: {
      storeRole: 'UnifiedArtifactStoreCandidate' as const,
      ref: 'artifact://test/validation-reuse',
      sha256: sha256Raw(bytes),
      byteLength: bytes.byteLength,
      mediaType: 'application/json' as const,
    },
  };
}

function adapter() {
  return new PythonU0FullPackageValidatorAdapter({
    pythonExecutable: '/test/python',
    contractRoot: resolve('server/runtime-assets/technical-publication-parsed-package/v1-frozen-2'),
    contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
    validatorRevision: 'test-validation-reuse',
  });
}

describe('immutable U0 validation reuse', () => {
  beforeEach(() => execute.mockReset().mockResolvedValue(successfulOutput));

  it('shares identical concurrent validation and returns separate proof values', async () => {
    const validator = adapter();
    const [first, second] = await Promise.all([
      validator.validateActualBytes(input()),
      validator.validateActualBytes(input()),
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    await validator.validateActualBytes(input());
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('checks actual bytes on every reuse and validates new content or a new instance', async () => {
    const validator = adapter();
    await validator.validateActualBytes(input());
    await expect(validator.validateActualBytes({ ...input(), bytes: input(2).bytes }))
      .rejects.toThrow('FULL_U0_VALIDATOR_REJECTED:ACTUAL_BYTE_MISMATCH');
    expect(execute).toHaveBeenCalledTimes(1);
    await validator.validateActualBytes(input(2));
    await adapter().validateActualBytes(input());
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('does not retain a failed validation', async () => {
    execute.mockResolvedValueOnce({ stdout: '{"ok":false}', stderr: '' });
    const validator = adapter();
    await expect(validator.validateActualBytes(input()))
      .rejects.toThrow('FULL_U0_VALIDATOR_REJECTED:STRICT_VALIDATION');
    await validator.validateActualBytes(input());
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
