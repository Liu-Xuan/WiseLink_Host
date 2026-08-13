import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
}

/** Host-configured adapter for the selected U0 frozen.2 full Validator. */
export class PythonU0FullPackageValidatorAdapter implements U0FullPackageValidatorPort {
  private readonly pythonExecutable: string;
  private readonly contractRoot: string;
  private readonly validatorRevision: string;

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
    const directory = await mkdtemp(join(tmpdir(), 'wiselink-u0-validator-'));
    const packagePath = join(directory, 'package.json');
    try {
      await writeFile(packagePath, input.bytes, { flag: 'wx' });
      const { stdout } = await execFileAsync(
        this.pythonExecutable,
        [
          '-m',
          'scripts.read_package',
          '--contract-root',
          '.',
          '--package',
          packagePath,
          '--mode',
          'strict',
        ],
        {
          cwd: this.contractRoot,
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
      const failed = parseFailedProcessOutput(error);
      if (failed?.ok === false) {
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
    const directory: string = await mkdtemp(
      join(tmpdir(), 'wiselink-u0-failure-validator-'),
    );
    const reportPath: string = join(directory, 'failure-report.json');
    try {
      await writeFile(reportPath, input.bytes, { flag: 'wx' });
      const code: string = [
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
        ['-c', code, this.contractRoot, reportPath],
        {
          cwd: this.contractRoot,
          encoding: 'utf8',
          maxBuffer: 2 * 1024 * 1024,
          timeout: 120_000,
        },
      );
      const response: FailureValidatorResponse =
        parseFailureValidatorResponse(stdout);
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
        error.message.startsWith(
          'FULL_U0_FAILURE_REPORT_VALIDATOR_REJECTED:',
        )
      ) {
        throw error;
      }
      const failed: FailureValidatorResponse | null =
        parseFailureProcessOutput(error);
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
  const text: string = stdout.trim();
  if (text === '') {
    throw new Error(
      'FULL_U0_FAILURE_REPORT_VALIDATOR_REJECTED:EMPTY_RESPONSE',
    );
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
