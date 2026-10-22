import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

import { resolveVendoredU0PythonModulePath } from './resolve-vendored-python-module-path';

const execFileAsync = promisify(execFile);

interface HostedU0PythonCandidate {
  executable: string;
  diagnosticLabel: string;
}

function hostedPythonCandidates(): HostedU0PythonCandidate[] {
  const mineruHome: string =
    process.env.WL_MINERU_HOME?.trim() ||
    join(tmpdir(), 'wiselink-mineru-runtime', '3.4.5');
  return [
    // A newer system default must not hide an already installed supported ABI.
    { executable: 'python3.10', diagnosticLabel: 'python3.10' },
    { executable: '/usr/local/bin/python3.10', diagnosticLabel: 'local-cp310' },
    { executable: '/usr/bin/python3.10', diagnosticLabel: 'system-cp310' },
    { executable: 'python3.9', diagnosticLabel: 'python3.9' },
    { executable: '/usr/local/bin/python3.9', diagnosticLabel: 'local-cp39' },
    { executable: '/usr/bin/python3.9', diagnosticLabel: 'system-cp39' },
    // Reuse only an already restored Host runtime; never start MinerU or restore
    // deployment files while reading a workbench. Requests cannot choose it.
    ...(isAbsolute(mineruHome)
      ? [{
          executable: join(mineruHome, 'python/bin/python3.10'),
          diagnosticLabel: 'mineru-cp310',
        }]
      : []),
    { executable: 'python3', diagnosticLabel: 'python3' },
    { executable: 'python', diagnosticLabel: 'python' },
    { executable: '/usr/bin/python3', diagnosticLabel: 'system-python3' },
  ];
}

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
  let lastVendorError: Error | null = null;
  const detectedVersions: string[] = [];
  for (const candidate of hostedPythonCandidates()) {
    const pythonExecutable: string = candidate.executable;
    try {
      const { stdout, stderr } = await execFileAsync(
        pythonExecutable,
        ['--version'],
        { encoding: 'utf8', timeout: 5_000, maxBuffer: 16 * 1024 },
      );
      const match = `${stdout}\n${stderr}`.match(/Python\s+(\d+\.\d+\.\d+)/);
      if (!match) continue;
      const pythonVersion = match[1];
      detectedVersions.push(`${candidate.diagnosticLabel}=${pythonVersion}`);
      try {
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
      } catch (error) {
        // A resolvable interpreter with no matching vendor is a precise,
        // request-independent unavailable condition. Remember it so the
        // final failure names the exact vendor mismatch instead of a generic
        // runtime error.
        lastVendorError = error instanceof Error ? error : null;
      }
    } catch {
      // Continue through the fixed server-owned executable list. Requests cannot
      // select an executable or a module path.
    }
  }
  if (lastVendorError) {
    // Fixed labels and parsed numeric versions distinguish ABI mismatch from a
    // missing runtime without exposing configured paths or command output.
    throw new Error(
      `${lastVendorError.message}:DETECTED_PYTHON_VERSIONS=${detectedVersions.join(',')}`,
    );
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
    !/^cpython-(39|310|313)-/.test(inspection.soabi ?? '') ||
    Object.values(inspection.origins).some(
      (origin) => !origin.startsWith(`${runtime.pythonModulePath}/`),
    )
  ) {
    throw new Error('FULL_U0_VALIDATOR_UNAVAILABLE:PYTHON_VENDOR_IMPORT');
  }
  return inspection;
}
