import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = parseArgs(process.argv.slice(2));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { PythonU0FullPackageValidatorAdapter } = await import(
  pathToFileURL(
    join(
      root,
      'dist/server/modules/unified-reader/python-u0-full-package-validator.adapter.js',
    ),
  )
);
const validator = new PythonU0FullPackageValidatorAdapter({
  pythonExecutable: args.pythonExecutable,
  pythonModulePath: args.pythonModulePath,
  contractRoot: args.contractRoot,
  contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
  validatorRevision: 'canonical-host-a958e4b-vendored-real',
});

const packages = [];
for (const [caseId, path] of [
  ['pdf', args.pdfPackage],
  ['native-s1000d', args.s1000dPackage],
]) {
  const bytes = Uint8Array.from(await readFile(path));
  const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
  const artifact = descriptor(bytes);
  const proof = await validator.validateActualBytes({
    artifact,
    bytes,
    packageId: parsed.packageId,
  });
  assert.equal(proof.status, 'FULL_STRICT_VALIDATOR_PASSED');
  packages.push({
    caseId,
    packageId: parsed.packageId,
    sourceKind: parsed.source.kind,
    byteLength: bytes.byteLength,
    artifactSha256: artifact.sha256,
    contentUnits: parsed.contentUnits.length,
    sourceRefs: parsed.sourceRefs.length,
  });
}

const negative = JSON.parse(await readFile(args.pdfPackage, 'utf8'));
negative.$schema = 'urn:techpub:schema:v1:parsed-package:invalid';
const negativeBytes = new TextEncoder().encode(`${JSON.stringify(negative)}\n`);
await assert.rejects(
  validator.validateActualBytes({
    artifact: descriptor(negativeBytes),
    bytes: negativeBytes,
    packageId: negative.packageId,
  }),
  /FULL_U0_VALIDATOR_REJECTED:STRICT_VALIDATION/u,
);

const failureBytes = Uint8Array.from(await readFile(args.failureReport));
const failure = JSON.parse(Buffer.from(failureBytes).toString('utf8'));
const failureArtifact = descriptor(failureBytes);
const failureProof = await validator.validateFailureReportActualBytes({
  artifact: failureArtifact,
  bytes: failureBytes,
  failureId: failure.failureId,
});
assert.equal(
  failureProof.status,
  'FULL_STRICT_FAILURE_REPORT_VALIDATOR_PASSED',
);

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'CANONICAL_HOST_DIST_VENDORED_U0_REAL_PASS',
      unifiedSourceCommit: 'a958e4b36f81ec50906d80ab78ef7b3b663bab5e',
      validatorSource: 'dist/server/modules/unified-reader',
      pythonModulePath: args.pythonModulePath,
      packages,
      negative: {
        mutation: '$schema invalid',
        rejectedWith: 'FULL_U0_VALIDATOR_REJECTED:STRICT_VALIDATION',
      },
      failureReport: {
        failureId: failure.failureId,
        byteLength: failureBytes.byteLength,
        artifactSha256: failureArtifact.sha256,
        status: failureProof.status,
      },
      onlineWrites: 0,
    },
    null,
    2,
  )}\n`,
);

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

function parseArgs(values) {
  const result = {};
  const fields = new Map([
    ['--python-executable', 'pythonExecutable'],
    ['--python-module-path', 'pythonModulePath'],
    ['--contract-root', 'contractRoot'],
    ['--pdf-package', 'pdfPackage'],
    ['--s1000d-package', 's1000dPackage'],
    ['--failure-report', 'failureReport'],
  ]);
  for (let index = 0; index < values.length; index += 2) {
    const field = fields.get(values[index]);
    if (!field || !values[index + 1]) throw new Error(`ARGUMENT_INVALID:${values[index]}`);
    result[field] = resolve(values[index + 1]);
  }
  for (const field of fields.values()) {
    if (!result[field]) throw new Error(`ARGUMENT_REQUIRED:${field}`);
  }
  return result;
}
