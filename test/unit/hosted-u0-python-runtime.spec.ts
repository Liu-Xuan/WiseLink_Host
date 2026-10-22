import { ChildProcess, execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  inspectHostedU0PythonRuntime,
  resolveHostedU0PythonRuntime,
} from '../../server/runtime/u0-python/hosted-u0-python-runtime';

jest.mock('node:child_process', () => ({
  ...jest.requireActual<typeof import('node:child_process')>('node:child_process'),
  execFile: Object.assign(jest.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: jest.fn(),
  }),
}));

const execute = jest.mocked(promisify(execFile));
const originalMineruHome: string | undefined = process.env.WL_MINERU_HOME;
const originalPlatform: NodeJS.Platform = process.platform;
const originalArch: NodeJS.Architecture = process.arch;

function interpreters(versions: Record<string, string>): void {
  execute.mockImplementation((executable: string) => {
    const version: string | undefined = versions[executable];
    const output: Promise<{ stdout: string; stderr: string }> = version
      ? Promise.resolve({ stdout: `Python ${version}\n`, stderr: '' })
      : Promise.reject(Object.assign(new Error('missing executable'), { code: 'ENOENT' }));
    return Object.assign(output, { child: new ChildProcess() });
  });
}

describe('Hosted U0 Python interpreter selection', () => {
  beforeEach(() => {
    execute.mockReset();
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
    process.env.WL_MINERU_HOME = '/tmp/test-existing-mineru';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    Object.defineProperty(process, 'arch', { value: originalArch, configurable: true });
    if (originalMineruHome === undefined) delete process.env.WL_MINERU_HOME;
    else process.env.WL_MINERU_HOME = originalMineruHome;
  });

  it('selects installed CPython 3.10 before an unsupported newer system default', async () => {
    interpreters({ 'python3.10': '3.10.21', python3: '3.11.9' });
    await expect(resolveHostedU0PythonRuntime()).resolves.toMatchObject({
      pythonExecutable: 'python3.10',
      pythonVersion: '3.10.21',
      platform: 'linux',
      arch: 'x64',
      pythonModulePath: resolve('server/runtime/u0-python/vendor/linux-x64-cp310'),
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('python3.10', ['--version'], expect.any(Object));
  });

  it('uses the supported 3.9 ABI when no 3.10 interpreter is installed', async () => {
    interpreters({ '/usr/bin/python3.9': '3.9.21', python3: '3.12.8' });
    await expect(resolveHostedU0PythonRuntime()).resolves.toMatchObject({
      pythonExecutable: '/usr/bin/python3.9',
      pythonModulePath: resolve('server/runtime/u0-python/vendor/linux-x64-cp39'),
    });
  });

  it('reuses an already restored MinerU CPython without downloading or preparing it', async () => {
    const executable = '/tmp/test-existing-mineru/python/bin/python3.10';
    interpreters({ [executable]: '3.10.21', python3: '3.11.9' });
    await expect(resolveHostedU0PythonRuntime()).resolves.toMatchObject({
      pythonExecutable: executable,
      pythonModulePath: resolve('server/runtime/u0-python/vendor/linux-x64-cp310'),
    });
    expect(execute.mock.calls.every((call) => JSON.stringify(call[1]) === '["--version"]')).toBe(true);
  });

  it('retains the existing supported system-default path', async () => {
    interpreters({ python3: '3.10.12' });
    await expect(resolveHostedU0PythonRuntime()).resolves.toMatchObject({
      pythonExecutable: 'python3',
      pythonModulePath: resolve('server/runtime/u0-python/vendor/linux-x64-cp310'),
    });
  });

  it('selects the actual hosted 3.13 default with its exact cp313 vendor', async () => {
    interpreters({ python3: '3.13.5', '/usr/bin/python3': '3.13.5' });
    await expect(resolveHostedU0PythonRuntime()).resolves.toMatchObject({
      pythonExecutable: 'python3',
      pythonVersion: '3.13.5',
      pythonModulePath: resolve('server/runtime/u0-python/vendor/linux-x64-cp313'),
    });
  });

  it('inspects cp313 and rejects a free-threaded ABI or an outside dependency origin', async () => {
    const pythonModulePath = resolve('server/runtime/u0-python/vendor/linux-x64-cp313');
    const runtime = {
      pythonExecutable: 'python3',
      pythonVersion: '3.13.5',
      platform: 'linux' as const,
      arch: 'x64' as const,
      pythonModulePath,
    };
    const inspection = {
      python: '3.13.5', system: 'linux', machine: 'x86_64',
      soabi: 'cpython-313-x86_64-linux-gnu', versions: {},
      origins: { rpdsNative: `${pythonModulePath}/rpds/rpds.cpython-313-x86_64-linux-gnu.so` },
    };
    execute.mockResolvedValueOnce({ stdout: JSON.stringify(inspection), stderr: '' });
    await expect(inspectHostedU0PythonRuntime(runtime)).resolves.toEqual(inspection);
    execute.mockResolvedValueOnce({
      stdout: JSON.stringify({ ...inspection, soabi: 'cpython-313t-x86_64-linux-gnu' }), stderr: '',
    });
    await expect(inspectHostedU0PythonRuntime(runtime)).rejects.toThrow('PYTHON_VENDOR_IMPORT');
    execute.mockResolvedValueOnce({
      stdout: JSON.stringify({ ...inspection, origins: { rpdsNative: '/outside/rpds.so' } }), stderr: '',
    });
    await expect(inspectHostedU0PythonRuntime(runtime)).rejects.toThrow('PYTHON_VENDOR_IMPORT');
  });

  it('reports only fixed labels and parsed versions when every available ABI is unsupported', async () => {
    interpreters({
      '/tmp/test-existing-mineru/python/bin/python3.10': '3.12.8',
      python3: '3.11.9',
      '/usr/bin/python3': '3.11.9',
    });
    await expect(resolveHostedU0PythonRuntime()).rejects.toThrow(
      'FULL_U0_VALIDATOR_UNAVAILABLE:PYTHON_VENDOR_PLATFORM:DETECTED_PYTHON_VERSIONS=mineru-cp310=3.12.8,python3=3.11.9,system-python3=3.11.9',
    );
  });

  it('fails closed when no executable returns a numeric Python version', async () => {
    execute.mockResolvedValue({ stdout: 'private command output', stderr: '' });
    await expect(resolveHostedU0PythonRuntime()).rejects.toThrow(
      'FULL_U0_VALIDATOR_UNAVAILABLE:PYTHON_VENDOR_RUNTIME',
    );
  });
});
