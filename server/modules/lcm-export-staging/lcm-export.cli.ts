import type { LcmStageOptions, LcmStageResult } from '../../../shared/lcm-export-staging.interface';
import { LcmStagingError } from './lcm-export.helpers';
import { stageLcmExport } from './lcm-export.store';

const USAGE: string = 'run-once --input <xls/xlsx> --staging-dir <private-local-dir> ' +
  '[--aircraft-model <exact-model>] [--host-snapshot <read-only-json>] [--collection-context <json>]';

function parseArguments(args: string[]): LcmStageOptions {
  if (args[0] !== 'run-once') throw new LcmStagingError('CLI_ARGUMENTS_INVALID', USAGE);
  const values: Map<string, string> = new Map();
  const allowed: string[] = ['--input', '--staging-dir', '--aircraft-model', '--host-snapshot', '--collection-context'];
  for (let index: number = 1; index < args.length; index += 2) {
    const key: string = args[index];
    const value: string | undefined = args[index + 1];
    if (!allowed.includes(key) || values.has(key) || !value || value.startsWith('--')) {
      throw new LcmStagingError('CLI_ARGUMENTS_INVALID', USAGE);
    }
    values.set(key, value);
  }
  const inputPath: string | undefined = values.get('--input');
  const stagingDirectory: string | undefined = values.get('--staging-dir');
  if (!inputPath || !stagingDirectory) throw new LcmStagingError('CLI_ARGUMENTS_INVALID', USAGE);
  return { inputPath, stagingDirectory, aircraftModel: values.get('--aircraft-model'),
    hostSnapshotPath: values.get('--host-snapshot'), collectionContextPath: values.get('--collection-context') };
}

export async function runLcmCli(args: string[]): Promise<LcmStageResult> {
  return stageLcmExport(parseArguments(args));
}

if (require.main === module) {
  void runLcmCli(process.argv.slice(2)).then((result: LcmStageResult) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error: unknown) => {
    const code: string = error instanceof LcmStagingError ? error.code : 'LOCAL_IO_ERROR';
    // No workbook data, source paths or raw exceptions are printed by default.
    const message: string = error instanceof LcmStagingError ? error.message : 'Local file operation failed.';
    process.stderr.write(`${JSON.stringify({ code, message })}\n`);
    process.exitCode = 1;
  });
}
