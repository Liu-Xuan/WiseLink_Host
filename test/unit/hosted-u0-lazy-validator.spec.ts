import {
  createHostedU0FullPackageValidatorProvider,
  LazyHostedU0FullPackageValidator,
} from '../../server/modules/unified-reader/hosted-u0-full-validator.provider';
import { U0_FULL_PACKAGE_VALIDATOR } from '../../server/modules/unified-reader/unified-reader.constants';

const mockResolveHostedU0PythonRuntime = jest.fn<Promise<never>, []>();

jest.mock(
  '../../server/runtime/u0-python/hosted-u0-python-runtime',
  () => ({
    resolveHostedU0PythonRuntime: (...args: []) =>
      mockResolveHostedU0PythonRuntime(...args),
  }),
);

const PACKAGE_ID = 'urn:techpub:package:v1:sha256:' + '1'.repeat(64);
const FAILURE_ID = 'urn:techpub:parse-failure:v1:sha256:' + '5'.repeat(64);
const ARTIFACT = {
  storeRole: 'UnifiedArtifactStoreCandidate',
  ref: 'artifact://UnifiedArtifactStoreCandidate/test/package.json',
  sha256: '2'.repeat(64),
  byteLength: 2,
  mediaType: 'application/json',
} as const;

beforeEach(() => {
  mockResolveHostedU0PythonRuntime.mockReset();
  mockResolveHostedU0PythonRuntime.mockRejectedValue(
    new Error('FULL_U0_VALIDATOR_UNAVAILABLE:PYTHON_VENDOR_PLATFORM'),
  );
});

describe('createHostedU0FullPackageValidatorProvider (lazy startup)', () => {
  it('binds the lazy validator to the U0_FULL_PACKAGE_VALIDATOR port', () => {
    const provider = createHostedU0FullPackageValidatorProvider() as {
      provide: symbol;
      useClass: unknown;
    };
    expect(provider.provide).toBe(U0_FULL_PACKAGE_VALIDATOR);
    expect(provider.useClass).toBe(LazyHostedU0FullPackageValidator);
  });

  it('constructing the validator never resolves the Python U0 runtime', () => {
    expect(() => new LazyHostedU0FullPackageValidator()).not.toThrow();
    expect(mockResolveHostedU0PythonRuntime).not.toHaveBeenCalled();
  });
});

describe('LazyHostedU0FullPackageValidator (fail-closed on real calls)', () => {
  it('rejects a real package validation with the precise unavailable error from the vendored runtime', async () => {
    const validator = new LazyHostedU0FullPackageValidator();
    await expect(
      validator.validateActualBytes({
        artifact: ARTIFACT,
        bytes: new TextEncoder().encode('{}'),
        packageId: PACKAGE_ID,
      }),
    ).rejects.toThrow(
      'FULL_U0_VALIDATOR_UNAVAILABLE:PYTHON_VENDOR_PLATFORM',
    );
    expect(mockResolveHostedU0PythonRuntime).toHaveBeenCalledTimes(1);
  });

  it('rejects a real failure-report validation with the precise unavailable error', async () => {
    const validator = new LazyHostedU0FullPackageValidator();
    await expect(
      validator.validateFailureReportActualBytes({
        artifact: ARTIFACT,
        bytes: new TextEncoder().encode('{}'),
        failureId: FAILURE_ID,
      }),
    ).rejects.toThrow(
      'FULL_U0_VALIDATOR_UNAVAILABLE:PYTHON_VENDOR_PLATFORM',
    );
  });

  it('memoizes resolution so an unavailable runtime fails closed for every later call', async () => {
    const validator = new LazyHostedU0FullPackageValidator();
    for (let index = 0; index < 2; index += 1) {
      await expect(
        validator.validateActualBytes({
          artifact: ARTIFACT,
          bytes: new TextEncoder().encode('{}'),
          packageId: PACKAGE_ID,
        }),
      ).rejects.toThrow(/FULL_U0_VALIDATOR_UNAVAILABLE:/u);
    }
    expect(mockResolveHostedU0PythonRuntime).toHaveBeenCalledTimes(1);
  });
});
