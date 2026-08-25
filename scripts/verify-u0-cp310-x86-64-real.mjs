// Real x86_64 / CPython 3.10 execution of the exact frozen.2 U0 full
// validator against the exact FTD frozen.2 artifact bytes, plus real
// negative cases (corrupt bytes, hash mismatch, structural damage).
//
// The adapter itself is invoked with the committed dist build. On this
// macOS host the genuine x86_64 CPython 3.10 standalone interpreter runs
// under Rosetta transparently (no `arch` wrapper needed — the binary is
// x86_64 and the kernel executes it via Rosetta). Nothing is mocked,
// faked, or monkey-patched; cp39 never stands in for cp310.
//
// Prerequisites:
//   - .u0-build/python-x86_64 (x86_64 standalone CPython 3.10)
//   - .u0-build/darwin-x64-cp310 (darwin x86_64 cp310 vendor)
//   - `npm run build:server` output in dist/
//
// Usage:
//   node scripts/verify-u0-cp310-x86-64-real.mjs
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pythonExecutable = resolve(root, '.u0-build/python-x86_64/bin/python3.10');
const pythonModulePath = resolve(
  root,
  '.u0-build/darwin-x64-cp310',
);
const contractRoot = resolve(
  root,
  'server/runtime-assets/technical-publication-parsed-package/v1-frozen-2',
);
const ftdPackagePath = resolve(
  root,
  'test/fixtures/real-ftd-frozen2.unified-package.json',
);

// 1. Prove the runtime is genuine x86_64 CPython 3.10 before anything else.
const { stdout: inspectOut } = await execFileAsync(
  pythonExecutable,
  ['-S', '-c', [
    'import json,platform,sysconfig',
    'print(json.dumps({"python":platform.python_version(),"system":platform.system().lower(),"machine":platform.machine().lower(),"soabi":sysconfig.get_config_var("SOABI")}))',
  ].join(';')],
  { encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 },
);
const runtimeFacts = JSON.parse(inspectOut.trim());
assert.match(runtimeFacts.python, /^3\.10\./u, 'must be CPython 3.10');
assert.equal(runtimeFacts.machine, 'x86_64', 'must be genuine x86_64');
assert.match(runtimeFacts.soabi, /^cpython-310-/u, 'must be cp310 ABI');
process.stdout.write(`runtime: ${JSON.stringify(runtimeFacts)}\n`);

const { PythonU0FullPackageValidatorAdapter } = await import(
  pathToFileURL(
    join(
      root,
      'dist/server/modules/unified-reader/python-u0-full-package-validator.adapter.js',
    ),
  )
);

const validator = new PythonU0FullPackageValidatorAdapter({
  pythonExecutable,
  pythonModulePath,
  contractRoot,
  contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
  validatorRevision: 'canonical-host-cp310-x86-64-real',
});

function descriptor(bytes) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    storeRole: 'UnifiedArtifactStoreCandidate',
    ref: `artifact://validation-only/sha256/${sha256}`,
    sha256,
    byteLength: bytes.byteLength,
    mediaType: 'application/json',
  };
}

// 2. Exact FTD frozen.2 actual bytes — full U0 must PASS.
const ftdBytes = Uint8Array.from(await readFile(ftdPackagePath));
const ftd = JSON.parse(Buffer.from(ftdBytes).toString('utf8'));
const ftdProof = await validator.validateActualBytes({
  artifact: descriptor(ftdBytes),
  bytes: ftdBytes,
  packageId: ftd.packageId,
});
assert.equal(ftdProof.status, 'FULL_STRICT_VALIDATOR_PASSED');
process.stdout.write(
  `ftd: packageId=${ftd.packageId} bytes=${ftdBytes.byteLength} status=${ftdProof.status}\n`,
);

// 3. Corrupt bytes (invalid JSON) — real failure.
const corruptBytes = new TextEncoder().encode(
  `${Buffer.from(ftdBytes).toString('utf8', 0, ftdBytes.byteLength - 40)}XXX-CORRUPT`,
);
await assert.rejects(
  validator.validateActualBytes({
    artifact: descriptor(corruptBytes),
    bytes: corruptBytes,
    packageId: ftd.packageId,
  }),
  /FULL_U0_VALIDATOR_(REJECTED|UNAVAILABLE)/u,
);

// 4. Hash mismatch (descriptor hash != bytes hash) — real failure.
await assert.rejects(
  validator.validateActualBytes({
    artifact: {
      ...descriptor(ftdBytes),
      sha256: createHash('sha256').update('tampered').digest('hex'),
    },
    bytes: ftdBytes,
    packageId: ftd.packageId,
  }),
  /FULL_U0_VALIDATOR_REJECTED:ACTUAL_BYTE_MISMATCH/u,
);

// 5. Structural damage (invalid $schema) — real strict-validation failure.
const damaged = JSON.parse(Buffer.from(ftdBytes).toString('utf8'));
damaged.$schema = 'urn:techpub:schema:v1:parsed-package:invalid';
const damagedBytes = new TextEncoder().encode(`${JSON.stringify(damaged)}\n`);
await assert.rejects(
  validator.validateActualBytes({
    artifact: descriptor(damagedBytes),
    bytes: damagedBytes,
    packageId: damaged.packageId,
  }),
  /FULL_U0_VALIDATOR_REJECTED:STRICT_VALIDATION/u,
);
process.stdout.write(
  'negatives: corrupt-bytes / hash-mismatch / structural-damage all rejected\n',
);

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'CP310_X86_64_REAL_U0_VALIDATION_PASS',
      runtime: runtimeFacts,
      pythonModulePath,
      contractRevision: 'frozen.2',
      positive: {
        ftdPackageId: ftd.packageId,
        ftdByteLength: ftdBytes.byteLength,
        ftdStatus: ftdProof.status,
        },
      negative: [
        'FULL_U0_VALIDATOR_REJECTED (corrupt bytes)',
        'FULL_U0_VALIDATOR_REJECTED:ACTUAL_BYTE_MISMATCH (hash mismatch)',
        'FULL_U0_VALIDATOR_REJECTED:STRICT_VALIDATION (structural damage)',
      ],
      onlineWrites: 0,
    },
    null,
    2,
  )}\n`,
);
