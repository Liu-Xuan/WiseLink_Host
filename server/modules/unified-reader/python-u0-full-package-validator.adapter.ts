import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import { UNIFIED_READER } from './unified-reader.constants';
import type {
  U0FullPackageValidatorPort,
  U0FullValidationProof,
  U0ParseFailureValidationProof,
} from './unified-reader.types';
import {
  packageIdValue,
  requiredText,
  sha256Raw,
} from './unified-reader.utils';

const execFileAsync = promisify(execFile);

export interface PythonU0FullPackageValidatorOptions {
  pythonExecutable: string;
  contractRoot: string;
  contractCommit: string;
  validatorRevision: string;
  pythonModulePath?: string;
}

/**
 * Exact frozen.2 U0 Schema/Semantic Validator adapter. It is host-configured
 * only; no path or executable is read from an HTTP request.
 */
export class PythonU0FullPackageValidatorAdapter implements U0FullPackageValidatorPort {
  private readonly pythonExecutable: string;
  private readonly contractRoot: string;
  private readonly validatorRevision: string;
  private readonly pythonEnvironment: NodeJS.ProcessEnv | undefined;
  private readonly pythonModulePath: string | undefined;

  constructor(options: PythonU0FullPackageValidatorOptions) {
    this.pythonExecutable = requiredText(
      options.pythonExecutable,
      'validator.pythonExecutable',
      1000,
    );
    this.contractRoot = resolve(
      requiredText(options.contractRoot, 'validator.contractRoot', 2000),
    );
    if (options.contractCommit !== UNIFIED_READER.contractCommit) {
      throw new Error('FULL_U0_VALIDATOR_CONFIG_INVALID:CONTRACT_COMMIT');
    }
    this.validatorRevision = requiredText(
      options.validatorRevision,
      'validator.validatorRevision',
      300,
    );
    this.pythonModulePath = options.pythonModulePath
      ? resolve(
          requiredText(
            options.pythonModulePath,
            'validator.pythonModulePath',
            2000,
          ),
        )
      : undefined;
    this.pythonEnvironment = this.pythonModulePath
      ? {
          ...process.env,
          PYTHONPATH: this.pythonModulePath,
          PYTHONNOUSERSITE: '1',
        }
      : undefined;
  }

  async validateActualBytes(input: {
    artifact: import('@shared/api.interface').UnifiedPackageArtifactDescriptor;
    bytes: Uint8Array;
    packageId: string;
  }): Promise<U0FullValidationProof> {
    packageIdValue(input.packageId, 'validator.packageId');
    await this.assertContractManifest();
    if (
      input.bytes.byteLength !== input.artifact.byteLength ||
      sha256Raw(input.bytes) !== input.artifact.sha256
    ) {
      throw new Error('FULL_U0_VALIDATOR_REJECTED:ACTUAL_BYTE_MISMATCH');
    }
    await this.assertVendoredRuntime();
    const directory = await mkdtemp(
      join(tmpdir(), 'wiselink-u0-full-validator-'),
    );
    const packagePath = join(directory, 'package.json');
    try {
      await writeFile(packagePath, input.bytes, { flag: 'wx' });
      const { stdout } = await execFileAsync(
        this.pythonExecutable,
        this.pythonArguments([
          '-m',
          'scripts.read_package',
          '--contract-root',
          '.',
          '--package',
          packagePath,
          '--mode',
          'strict',
        ]),
        {
          cwd: this.contractRoot,
          env: this.pythonEnvironment,
          encoding: 'utf8',
          maxBuffer: 2 * 1024 * 1024,
          timeout: 120_000,
        },
      );
      const response = parseValidatorResponse(stdout);
      if (
        response.ok !== true ||
        response.summary?.selectedContractRevision !==
          UNIFIED_READER.contractRevision ||
        response.summary.package?.schemaVersion !==
          UNIFIED_READER.packageSchemaVersion ||
        response.summary.package?.contractRevision !==
          UNIFIED_READER.contractRevision ||
        response.summary.package?.packageId !== input.packageId
      ) {
        throw new Error('FULL_U0_VALIDATOR_REJECTED:STRICT_VALIDATION');
      }
      return {
        status: 'FULL_STRICT_VALIDATOR_PASSED',
        validatorId: 'U0Frozen2SchemaSemanticValidator',
        validatorRevision: this.validatorRevision,
        contractId: UNIFIED_READER.packageSchemaVersion,
        contractRevision: UNIFIED_READER.contractRevision,
        contractCommit: UNIFIED_READER.contractCommit,
        packageId: input.packageId,
        artifactSha256: input.artifact.sha256,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('FULL_U0_VALIDATOR_REJECTED:')
      ) {
        throw error;
      }
      const failedResponse: ValidatorResponse | null =
        parseFailedProcessOutput(error);
      if (failedResponse?.ok === false) {
        throw new Error('FULL_U0_VALIDATOR_REJECTED:STRICT_VALIDATION');
      }
      throw new Error('FULL_U0_VALIDATOR_UNAVAILABLE:PROCESS_FAILURE');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async validateFailureReportActualBytes(input: {
    artifact: import('@shared/api.interface').UnifiedPackageArtifactDescriptor;
    bytes: Uint8Array;
    failureId: string;
  }): Promise<U0ParseFailureValidationProof> {
    await this.assertContractManifest();
    if (
      input.bytes.byteLength !== input.artifact.byteLength ||
      sha256Raw(input.bytes) !== input.artifact.sha256
    ) {
      throw new Error(
        'FULL_U0_FAILURE_REPORT_VALIDATOR_REJECTED:ACTUAL_BYTE_MISMATCH',
      );
    }
    await this.assertVendoredRuntime();
    const directory = await mkdtemp(
      join(tmpdir(), 'wiselink-u0-failure-validator-'),
    );
    const reportPath = join(directory, 'failure-report.json');
    try {
      await writeFile(reportPath, input.bytes, { flag: 'wx' });
      const code = [
        'import json,sys',
        'from pathlib import Path',
        'from scripts.contract_core import validate_parse_failure_report',
        'root=Path(sys.argv[1])',
        'report=json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))',
        'issues=validate_parse_failure_report(report, contract_root=root)',
        'print(json.dumps({"ok":not issues,"failureId":report.get("failureId"),"issues":[{"code":i.code,"path":i.path} for i in issues]},sort_keys=True,separators=(",",":")))',
        'raise SystemExit(0 if not issues else 2)',
      ].join(';');
      const { stdout } = await execFileAsync(
        this.pythonExecutable,
        this.pythonArguments(['-c', code, this.contractRoot, reportPath]),
        {
          cwd: this.contractRoot,
          env: this.pythonEnvironment,
          encoding: 'utf8',
          maxBuffer: 2 * 1024 * 1024,
          timeout: 120_000,
        },
      );
      const response = parseFailureValidatorResponse(stdout);
      if (response.ok !== true || response.failureId !== input.failureId) {
        throw new Error(
          'FULL_U0_FAILURE_REPORT_VALIDATOR_REJECTED:STRICT_VALIDATION',
        );
      }
      return {
        status: 'FULL_STRICT_FAILURE_REPORT_VALIDATOR_PASSED',
        validatorId: 'U0Frozen2ParseFailureReportValidator',
        validatorRevision: this.validatorRevision,
        contractId: UNIFIED_READER.failureReportSchemaVersion,
        contractRevision: UNIFIED_READER.failureReportContractRevision,
        contractCommit: UNIFIED_READER.contractCommit,
        failureId: input.failureId,
        artifactSha256: input.artifact.sha256,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('FULL_U0_FAILURE_REPORT_VALIDATOR_REJECTED:')
      ) {
        throw error;
      }
      const failed = parseFailureProcessOutput(error);
      if (failed?.ok === false) {
        throw new Error(
          'FULL_U0_FAILURE_REPORT_VALIDATOR_REJECTED:STRICT_VALIDATION',
        );
      }
      throw new Error(
        'FULL_U0_FAILURE_REPORT_VALIDATOR_UNAVAILABLE:PROCESS_FAILURE',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async assertContractManifest(): Promise<void> {
    try {
      const bytes = await readFile(
        join(this.contractRoot, 'freeze', 'frozen-2-contract-manifest.json'),
      );
      if (sha256Raw(bytes) !== UNIFIED_READER.contractManifestSha256) {
        throw new Error(
          'FULL_U0_VALIDATOR_UNAVAILABLE:CONTRACT_MANIFEST_DRIFT',
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('FULL_U0_VALIDATOR_UNAVAILABLE:')
      ) {
        throw error;
      }
      throw new Error(
        'FULL_U0_VALIDATOR_UNAVAILABLE:CONTRACT_MANIFEST_MISSING',
      );
    }
  }

  private async assertVendoredRuntime(): Promise<void> {
    if (!this.pythonModulePath) return;
    try {
      const { stdout } = await execFileAsync(
        this.pythonExecutable,
        this.pythonArguments([
          '-c',
          [
            'import json,platform,sysconfig',
            'from pathlib import Path',
            'from importlib.metadata import version',
            'import attrs,jsonschema,jsonschema_specifications,referencing,rfc3339_validator,rpds,rpds.rpds,six,typing_extensions',
            'modules={"attrs":attrs,"jsonschema":jsonschema,"jsonschemaSpecifications":jsonschema_specifications,"referencing":referencing,"rfc3339":rfc3339_validator,"rpds":rpds,"rpdsNative":rpds.rpds,"six":six,"typingExtensions":typing_extensions}',
            'versions={name:version(name) for name in ("attrs","jsonschema","jsonschema-specifications","referencing","rfc3339-validator","rpds-py","six","typing-extensions")}',
            'origins={name:str(Path(module.__file__).resolve()) for name,module in modules.items()}',
            'print(json.dumps({"python":platform.python_version(),"system":platform.system().lower(),"machine":platform.machine().lower(),"soabi":sysconfig.get_config_var("SOABI"),"versions":versions,"origins":origins},sort_keys=True,separators=(",",":")))',
          ].join(';'),
        ]),
        {
          cwd: this.contractRoot,
          env: this.pythonEnvironment,
          encoding: 'utf8',
          maxBuffer: 64 * 1024,
          timeout: 30_000,
        },
      );
      const runtime = JSON.parse(stdout.trim()) as PythonVendorRuntime;
      const target: string = basename(this.pythonModulePath);
      const expected = EXPECTED_VENDOR_RUNTIMES[target];
        if (
          !expected ||
          !runtime.python?.startsWith(expected.pythonPrefix) ||
            runtime.system !== expected.system ||
            runtime.machine !== expected.machine ||
      !runtime.soabi?.startsWith(expected.soabiPrefix) ||
        runtime.versions?.attrs !== '26.1.0' ||
        runtime.versions?.jsonschema !== '4.25.1' ||
        runtime.versions?.['jsonschema-specifications'] !== '2025.9.1' ||
        runtime.versions?.referencing !== '0.36.2' ||
        runtime.versions?.['rfc3339-validator'] !== '0.1.4' ||
        runtime.versions?.['rpds-py'] !== '0.27.1' ||
        runtime.versions?.six !== '1.17.0' ||
        runtime.versions?.['typing-extensions'] !== '4.16.0' ||
        !runtime.origins ||
        !Object.values(runtime.origins).every((origin: string) =>
          isInside(this.pythonModulePath as string, origin),
        ) ||
        !runtime.origins.rpdsNative?.endsWith(expected.rpdsNativeSuffix)
          ) {
        throw new Error('PYTHON_VENDOR_VERSION');
      }
    } catch {
      throw new Error('FULL_U0_VALIDATOR_UNAVAILABLE:PYTHON_VENDOR_IMPORT');
    }
  }

  private pythonArguments(args: string[]): string[] {
    return this.pythonModulePath ? ['-S', ...args] : args;
  }
}

interface PythonVendorRuntime {
  python?: string;
  system?: string;
  machine?: string;
  soabi?: string;
  versions?: Record<string, string>;
  origins?: Record<string, string>;
}

interface ExpectedVendorRuntime {
  system: 'linux' | 'darwin';
  machine: string;
  pythonPrefix: string;
  soabiPrefix: string;
  rpdsNativeSuffix: string;
}

const EXPECTED_VENDOR_RUNTIMES: Record<string, ExpectedVendorRuntime> = {
  'linux-arm64-cp39': {
    system: 'linux',
    machine: 'aarch64',
    pythonPrefix: '3.9.',
    soabiPrefix: 'cpython-39-aarch64',
    rpdsNativeSuffix: 'rpds.cpython-39-aarch64-linux-gnu.so',
  },
  'linux-x64-cp39': {
    system: 'linux',
    machine: 'x86_64',
    pythonPrefix: '3.9.',
    soabiPrefix: 'cpython-39-x86_64',
    rpdsNativeSuffix: 'rpds.cpython-39-x86_64-linux-gnu.so',
  },
  'linux-arm64-cp310': {
    system: 'linux',
    machine: 'aarch64',
    pythonPrefix: '3.10.',
    soabiPrefix: 'cpython-310-aarch64',
    rpdsNativeSuffix: 'rpds.cpython-310-aarch64-linux-gnu.so',
  },
  'linux-x64-cp310': {
    system: 'linux',
    machine: 'x86_64',
    pythonPrefix: '3.10.',
    soabiPrefix: 'cpython-310-x86_64',
    rpdsNativeSuffix: 'rpds.cpython-310-x86_64-linux-gnu.so',
  },
  // Local real-run verification vendor (genuine x86_64 CPython 3.10 under
  // Rosetta on macOS). Hosted resolution never selects these directories;
  // resolveVendoredU0PythonModulePath only resolves linux-*.
  'darwin-x64-cp310': {
    system: 'darwin',
    machine: 'x86_64',
    pythonPrefix: '3.10.',
    soabiPrefix: 'cpython-310-',
    rpdsNativeSuffix: 'rpds.cpython-310-darwin.so',
  },
};

function isInside(root: string, candidate: string): boolean {
  const path: string = relative(resolve(root), resolve(candidate));
  return (
    path !== '' &&
    path !== '..' &&
    !path.startsWith(`..${sep}`) &&
    !isAbsolute(path)
  );
}

interface ValidatorResponse {
  ok?: boolean;
  summary?: {
    selectedContractRevision?: string;
    package?: {
      schemaVersion?: string;
      contractRevision?: string;
      packageId?: string;
    };
  };
}

interface FailureValidatorResponse {
  ok?: boolean;
  failureId?: string;
}

function parseValidatorResponse(stdout: string): ValidatorResponse {
  const text = stdout.trim();
  if (text === '') {
    throw new Error('FULL_U0_VALIDATOR_REJECTED:EMPTY_RESPONSE');
  }
  try {
    return JSON.parse(text) as ValidatorResponse;
  } catch {
    throw new Error('FULL_U0_VALIDATOR_REJECTED:INVALID_RESPONSE');
  }
}

function parseFailedProcessOutput(error: unknown): ValidatorResponse | null {
  if (!error || typeof error !== 'object' || !('stdout' in error)) return null;
  const stdout: unknown = error.stdout;
  if (typeof stdout !== 'string' || stdout.trim() === '') return null;
  try {
    return JSON.parse(stdout.trim()) as ValidatorResponse;
  } catch {
    return null;
  }
}

function parseFailureValidatorResponse(
  stdout: string,
): FailureValidatorResponse {
  const text = stdout.trim();
  if (text === '') {
    throw new Error('FULL_U0_FAILURE_REPORT_VALIDATOR_REJECTED:EMPTY_RESPONSE');
  }
  try {
    return JSON.parse(text) as FailureValidatorResponse;
  } catch {
    throw new Error(
      'FULL_U0_FAILURE_REPORT_VALIDATOR_REJECTED:INVALID_RESPONSE',
    );
  }
}

function parseFailureProcessOutput(
  error: unknown,
): FailureValidatorResponse | null {
  if (!error || typeof error !== 'object' || !('stdout' in error)) return null;
  const stdout: unknown = error.stdout;
  if (typeof stdout !== 'string' || stdout.trim() === '') return null;
  try {
    return JSON.parse(stdout.trim()) as FailureValidatorResponse;
  } catch {
    return null;
  }
}
