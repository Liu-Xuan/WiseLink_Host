import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  inspectHostedU0PythonRuntime,
  resolveHostedU0PythonRuntime,
  type HostedU0PythonRuntime,
} from '../../runtime/u0-python/hosted-u0-python-runtime';
import type {
  RuntimeProbeCheck,
  RuntimeProbeResponse,
} from './runtime-probe.types';

const execFileAsync = promisify(execFile);

const APP_ID = 'app_17bzc551rsg' as const;
const U0_COMMIT = 'fa69ada08265934951df53c7a61a3ccdb8cb2900' as const;
const U0_MANIFEST_SHA256 =
  '730baa88e7254bac6d3808ca2ddbfb1824c5891d6ce3d6d29ce177431cd5ffc0' as const;

@Injectable()
export class RuntimeProbeService {
  async probe(): Promise<RuntimeProbeResponse> {
    const contractRoot = resolve(
      __dirname,
      '../../runtime-assets/technical-publication-parsed-package/v1-frozen-2',
    );
    const checks: RuntimeProbeResponse['checks'] = {
      pythonExecutable: fail('NOT_RUN'),
      childProcess: fail('NOT_RUN'),
      temporaryFile: fail('NOT_RUN'),
      jsonschemaDependency: fail('NOT_RUN'),
      exactU0Manifest: fail('NOT_RUN'),
      exactU0Scripts: fail('NOT_RUN'),
      strictReader: fail('NOT_RUN'),
    };
    const blockers: string[] = [];
    let pythonRuntime: HostedU0PythonRuntime | null = null;
    try {
      pythonRuntime = await resolveHostedU0PythonRuntime();
      checks.pythonExecutable = pass(
        JSON.stringify({
          executable: pythonRuntime.pythonExecutable,
          version: pythonRuntime.pythonVersion,
          platform: pythonRuntime.platform,
          arch: pythonRuntime.arch,
          modulePath: pythonRuntime.pythonModulePath,
        }),
      );
    } catch (error) {
      checks.pythonExecutable = fail(errorSummary(error));
      blockers.push('HOSTED_PYTHON_EXECUTABLE_NOT_FOUND');
    }
    if (pythonRuntime) {
      checks.childProcess = await commandCheck(
        pythonRuntime.pythonExecutable,
        ['-S', '-c', 'import sys; print(sys.version.split()[0])'],
        'HOSTED_CHILD_PROCESS_FAILED',
        blockers,
        pythonEnvironment(pythonRuntime),
      );
      checks.jsonschemaDependency = await vendoredDependencyCheck(
        pythonRuntime,
        blockers,
      );
    }

    checks.temporaryFile = await temporaryFileCheck(blockers);
    checks.exactU0Manifest = await manifestCheck(contractRoot, blockers);
    checks.exactU0Scripts = await scriptsCheck(contractRoot, blockers);
    if (
      pythonRuntime &&
      checks.childProcess.status === 'PASS' &&
      checks.jsonschemaDependency.status === 'PASS' &&
      checks.exactU0Manifest.status === 'PASS' &&
      checks.exactU0Scripts.status === 'PASS' &&
      checks.temporaryFile.status === 'PASS'
    ) {
      checks.strictReader = await strictReaderCheck(
        pythonRuntime,
        contractRoot,
        blockers,
      );
    } else {
      checks.strictReader = fail('STRICT_READER_PREREQUISITES_BLOCKED');
      blockers.push('HOSTED_U0_STRICT_READER_PREREQUISITES_BLOCKED');
    }

    return {
      schemaVersion: 'wiselink.3_1.hosted_runtime_probe.v1',
      status: blockers.length === 0 ? 'PASS' : 'BLOCKED',
      appId: APP_ID,
      deployedCommit:
        process.env.MIAODA_DEPLOYED_COMMIT ??
        process.env.GIT_COMMIT ??
        process.env.COMMIT_SHA ??
        'UNAVAILABLE',
      releaseId:
        process.env.MIAODA_RELEASE_ID ??
        process.env.RELEASE_ID ??
        'UNAVAILABLE',
      apiContractVersion: 'wiselink.3_1.canonical_host.r06.0',
      selectedContract: {
        contractId: 'techpub.parsed-package.v1',
        contractRevision: 'frozen.2',
        u0Commit: U0_COMMIT,
        manifestSha256: U0_MANIFEST_SHA256,
      },
      checks,
      authority: {
        businessWriteAuthorized: false,
        artifactPersistAuthorized: false,
        baseRecordWriteAuthorized: false,
        publicationDecisionCreated: false,
      },
      blockers: [...new Set(blockers)],
    };
  }
}

async function commandCheck(
  executable: string,
  args: string[],
  blocker: string,
  blockers: string[],
  env?: NodeJS.ProcessEnv,
): Promise<RuntimeProbeCheck> {
  try {
    const { stdout, stderr } = await execFileAsync(executable, args, {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      env,
    });
    return pass((stdout || stderr).trim().slice(0, 300) || 'EXIT_0');
  } catch (error) {
    blockers.push(blocker);
    return fail(errorSummary(error));
  }
}

async function vendoredDependencyCheck(
  runtime: HostedU0PythonRuntime,
  blockers: string[],
): Promise<RuntimeProbeCheck> {
  try {
    const inspection = await inspectHostedU0PythonRuntime(runtime);
    return pass(JSON.stringify(inspection));
  } catch (error) {
    blockers.push('HOSTED_JSONSCHEMA_DEPENDENCY_MISSING');
    return fail(errorSummary(error));
  }
}

async function temporaryFileCheck(
  blockers: string[],
): Promise<RuntimeProbeCheck> {
  let directory: string | null = null;
  try {
    directory = await mkdtemp(join(tmpdir(), 'wiselink-v31-probe-'));
    const path = join(directory, 'probe.txt');
    const expected = new TextEncoder().encode('wiselink-v31-runtime-probe\n');
    await writeFile(path, expected, { flag: 'wx' });
    const actual = await readFile(path);
    if (!Buffer.from(actual).equals(Buffer.from(expected))) {
      throw new Error('TEMPORARY_FILE_BYTE_MISMATCH');
    }
    return pass(`${tmpdir()}/wiselink-v31-probe-*`);
  } catch (error) {
    blockers.push('HOSTED_TEMPORARY_FILE_UNAVAILABLE');
    return fail(errorSummary(error));
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

async function manifestCheck(
  contractRoot: string,
  blockers: string[],
): Promise<RuntimeProbeCheck> {
  try {
    const path = join(contractRoot, 'freeze/frozen-2-contract-manifest.json');
    const bytes = await readFile(path);
    const observed = createHash('sha256').update(bytes).digest('hex');
    if (observed !== U0_MANIFEST_SHA256) {
      throw new Error(`U0_MANIFEST_SHA256_DRIFT:${observed}`);
    }
    return pass(`sha256:${observed}`);
  } catch (error) {
    blockers.push('HOSTED_U0_MANIFEST_MISSING_OR_DRIFTED');
    return fail(errorSummary(error));
  }
}

async function scriptsCheck(
  contractRoot: string,
  blockers: string[],
): Promise<RuntimeProbeCheck> {
  try {
    for (const relative of [
      'scripts/__init__.py',
      'scripts/contract_core.py',
      'scripts/version_dispatch.py',
      'scripts/read_package.py',
      'schema/parsed-package.schema.json',
      'schema/parse-failure-report.schema.json',
      'extensions/registry.json',
      'fixtures/positive/minimal-pdf-complete.json',
    ]) {
      await access(join(contractRoot, relative));
    }
    return pass('FROZEN_2_RUNTIME_ASSETS_PRESENT');
  } catch (error) {
    blockers.push('HOSTED_U0_RUNTIME_ASSETS_MISSING');
    return fail(errorSummary(error));
  }
}

async function strictReaderCheck(
  runtime: HostedU0PythonRuntime,
  contractRoot: string,
  blockers: string[],
): Promise<RuntimeProbeCheck> {
  try {
    const { stdout } = await execFileAsync(
      runtime.pythonExecutable,
      [
        '-S',
        '-m',
        'scripts.read_package',
        '--contract-root',
        '.',
        '--package',
        'fixtures/positive/minimal-pdf-complete.json',
        '--mode',
        'strict',
      ],
      {
        cwd: contractRoot,
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 256 * 1024,
        env: pythonEnvironment(runtime),
      },
    );
    const parsed = JSON.parse(stdout) as {
      ok?: unknown;
      summary?: { selectedContractRevision?: unknown };
    };
    if (
      parsed.ok !== true ||
      parsed.summary?.selectedContractRevision !== 'frozen.2'
    ) {
      throw new Error('STRICT_READER_RESULT_INVALID');
    }
    return pass('FROZEN_2_MINIMAL_PDF_STRICT_READER_PASS');
  } catch (error) {
    blockers.push('HOSTED_U0_STRICT_READER_FAILED');
    return fail(errorSummary(error));
  }
}

function pythonEnvironment(runtime: HostedU0PythonRuntime): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONPATH: runtime.pythonModulePath,
    PYTHONNOUSERSITE: '1',
  };
}

function pass(detail: string): RuntimeProbeCheck {
  return { status: 'PASS', detail };
}

function fail(detail: string): RuntimeProbeCheck {
  return { status: 'FAIL', detail };
}

function errorSummary(error: unknown): string {
  if (!(error instanceof Error)) return 'UNKNOWN_ERROR';
  const value = error as Error & {
    code?: string;
    stdout?: string | Buffer;
    stderr?: string | Buffer;
  };
  const output = [value.code, value.message, value.stdout, value.stderr]
    .filter(Boolean)
    .map((item) => String(item).trim())
    .filter(Boolean)
    .join(' | ');
  return output.slice(0, 800) || 'UNKNOWN_ERROR';
}
