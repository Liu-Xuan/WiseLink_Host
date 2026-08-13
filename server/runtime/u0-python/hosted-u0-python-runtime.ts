import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { resolveVendoredU0PythonModulePath } from './resolve-vendored-python-module-path';

const execFileAsync = promisify(execFile);
const PYTHON_CANDIDATES = ['python3', 'python', '/usr/bin/python3'] as const;

export interface HostedU0PythonRuntime {
  pythonExecutable: string;
  pythonVersion: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  pythonModulePath: string;
}

export interface HostedU0PythonInspection {
  python: string;
  system: string;
  machine: string;
  soabi: string;
  versions: Record<string, string>;
  origins: Record<string, string>;
}

export async function resolveHostedU0PythonRuntime(): Promise<HostedU0PythonRuntime> {
  for (const pythonExecutable of PYTHON_CANDIDATES) {
    try {
      const { stdout, stderr } = await execFileAsync(
        pythonExecutable,
        ['--version'],
        { encoding: 'utf8', timeout: 5_000, maxBuffer: 16 * 1024 },
      );
      const match = `${stdout}\n${stderr}`.match(/Python\s+(\d+\.\d+\.\d+)/);
      if (!match) continue;
      const pythonVersion = match[1];
      const pythonModulePath = resolveVendoredU0PythonModulePath({
        pythonVersion,
      });
      return {
        pythonExecutable,
        pythonVersion,
        platform: process.platform,
        arch: process.arch,
        pythonModulePath,
      };
    } catch {
      // Continue through the fixed server-owned executable list. Requests cannot
      // select an executable or a module path.
    }
  }
  throw new Error('FULL_U0_VALIDATOR_UNAVAILABLE:PYTHON_VENDOR_RUNTIME');
}

export async function inspectHostedU0PythonRuntime(
  runtime: HostedU0PythonRuntime,
): Promise<HostedU0PythonInspection> {
  const code = [
    'import json,platform,sysconfig',
    'from pathlib import Path',
    'from importlib.metadata import version',
    'import attrs,jsonschema,jsonschema_specifications,referencing,rfc3339_validator,rpds,rpds.rpds,six,typing_extensions',
    'modules={"attrs":attrs,"jsonschema":jsonschema,"jsonschemaSpecifications":jsonschema_specifications,"referencing":referencing,"rfc3339":rfc3339_validator,"rpds":rpds,"rpdsNative":rpds.rpds,"six":six,"typingExtensions":typing_extensions}',
    'versions={name:version(name) for name in ("attrs","jsonschema","jsonschema-specifications","referencing","rfc3339-validator","rpds-py","six","typing-extensions")}',
    'origins={name:str(Path(module.__file__).resolve()) for name,module in modules.items()}',
    'print(json.dumps({"python":platform.python_version(),"system":platform.system().lower(),"machine":platform.machine().lower(),"soabi":sysconfig.get_config_var("SOABI"),"versions":versions,"origins":origins},sort_keys=True,separators=(",",":")))',
  ].join(';');
  const { stdout } = await execFileAsync(
    runtime.pythonExecutable,
    ['-S', '-c', code],
    {
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 64 * 1024,
      env: {
        ...process.env,
        PYTHONPATH: runtime.pythonModulePath,
        PYTHONNOUSERSITE: '1',
      },
    },
  );
  const inspection = JSON.parse(stdout.trim()) as HostedU0PythonInspection;
  const allowedMachines =
    runtime.arch === 'arm64' ? new Set(['aarch64', 'arm64']) : new Set(['x86_64', 'amd64']);
  if (
    inspection.python !== runtime.pythonVersion ||
    inspection.system !== 'linux' ||
    !allowedMachines.has(inspection.machine) ||
    !inspection.soabi.startsWith('cpython-39-') ||
    Object.values(inspection.origins).some(
      (origin) => !origin.startsWith(`${runtime.pythonModulePath}/`),
    )
  ) {
    throw new Error('FULL_U0_VALIDATOR_UNAVAILABLE:PYTHON_VENDOR_IMPORT');
  }
  return inspection;
}
