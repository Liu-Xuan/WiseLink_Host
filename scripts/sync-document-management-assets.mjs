import {
  access,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { copyPinnedPdfOcrRuntime } from './lib/pdf-ocr-runtime-deployment.mjs';

const root = resolve(import.meta.dirname, '..');

const execFileAsync = promisify(execFile);

/** Bind the artifact to clean Git facts, or official build metadata only when Git is absent. */
export async function writeServerBuildFingerprint(
  buildRoot,
  { requireProvenance = false } = {},
) {
  let sourceCommit = 'UNAVAILABLE';
  let buildTime = 'UNAVAILABLE';
  let failureReason;
  let platformBuildMetadata = false;
  let phase = 'CHECKOUT_ROOT';
  const reject = (reason) => {
    failureReason = reason;
    throw new Error(reason);
  };
  try {
    const environment = { ...process.env };
    // These controls can substitute a foreign repository, index, objects, or Git configuration.
    // Reject ambiguity without changing the caller's environment or trusting the redirected facts.
    if (
      Object.keys(environment).some((key) =>
        /^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CEILING_DIRECTORIES|DISCOVERY_ACROSS_FILESYSTEM|EXEC_PATH|CONFIG(?:_.*)?)$/u.test(
          key,
        ),
      )
    ) {
      reject('GIT_ENVIRONMENT_REDIRECT_PRESENT');
    }
    const checkoutRoot = await realpath(buildRoot);
    const options = {
      cwd: checkoutRoot,
      env: environment,
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 64 * 1024,
    };
    phase = 'GIT_ROOT';
    let actualRoot;
    try {
      actualRoot = (
        await execFileAsync('git', ['rev-parse', '--show-toplevel'], options)
      ).stdout.trim();
    } catch (error) {
      // Only this first spawn may select the platform's Git-less build path.
      if (error?.code !== 'ENOENT') throw error;
      phase = 'GIT_ROOT_REALPATH';
      if ((await realpath(buildRoot)) !== checkoutRoot)
        reject('GIT_ROOT_CHANGED');
      const releaseCommit = environment.RELEASE_ID;
      if (releaseCommit === undefined || releaseCommit === '')
        reject('GIT_EXECUTABLE_MISSING');
      if (!/^[a-f0-9]{40}$/u.test(releaseCommit))
        reject('PLATFORM_BUILD_METADATA_INVALID');
      sourceCommit = releaseCommit;
      buildTime = new Date().toISOString();
      platformBuildMetadata = true;
    }
    if (!platformBuildMetadata) {
      phase = 'GIT_ROOT_REALPATH';
      if ((await realpath(actualRoot)) !== checkoutRoot) {
        reject('GIT_ROOT_MISMATCH');
      }
      phase = 'GIT_HEAD';
      const head = (
        await execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], options)
      ).stdout.trim();
      phase = 'GIT_STATUS';
      const status = (
        await execFileAsync(
          'git',
          ['status', '--porcelain=v1', '--untracked-files=normal'],
          options,
        )
      ).stdout;
      // Detect a checkout change while collecting provenance; never use deployment env or client fields.
      phase = 'GIT_FINAL_HEAD';
      const finalHead = (
        await execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], options)
      ).stdout.trim();
      phase = 'GIT_FINAL_ROOT';
      const finalRoot = (
        await execFileAsync('git', ['rev-parse', '--show-toplevel'], options)
      ).stdout.trim();
      if (!/^[a-f0-9]{40}$/u.test(head)) reject('GIT_HEAD_INVALID');
      if (head !== finalHead) reject('GIT_HEAD_CHANGED');
      if (status !== '') reject('GIT_WORKTREE_DIRTY');
      phase = 'GIT_FINAL_ROOT_REALPATH';
      if ((await realpath(finalRoot)) !== checkoutRoot)
        reject('GIT_ROOT_CHANGED');
      sourceCommit = head;
      buildTime = new Date().toISOString();
    }
  } catch (error) {
    // Never include stderr, paths, environment values or exception text in diagnostics.
    failureReason ??= fingerprintFailureReason(phase, error);
  }
  const metadata = {
    schemaVersion: 'wiselink.server-build-fingerprint.v1',
    sourceCommit,
    buildTime,
  };
  const directory = resolve(buildRoot, 'dist/server/runtime-assets/host-build');
  const target = resolve(directory, 'build-fingerprint.json');
  await mkdir(directory, { recursive: true });
  const staging = await mkdtemp(resolve(directory, '.build-fingerprint-'));
  try {
    const temporary = resolve(staging, 'metadata.json');
    await writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o644,
    });
    await rename(temporary, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  if (platformBuildMetadata) {
    process.stdout.write('SERVER_BUILD_FINGERPRINT:PLATFORM_BUILD_METADATA\n');
  }
  if (failureReason) {
    process.stderr.write(`SERVER_BUILD_FINGERPRINT:${failureReason}\n`);
    if (requireProvenance) {
      const error = new Error(
        `SERVER_BUILD_PROVENANCE_REQUIRED:${failureReason}`,
      );
      error.code = 'SERVER_BUILD_PROVENANCE_REQUIRED';
      throw error;
    }
  }
  return metadata;
}

function fingerprintFailureReason(phase, error) {
  if (phase === 'CHECKOUT_ROOT' || phase.endsWith('_REALPATH'))
    return 'BUILD_CHECKOUT_UNAVAILABLE';
  if (error?.code === 'ENOENT') return 'GIT_EXECUTABLE_MISSING';
  if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
    return `${phase}_OUTPUT_LIMIT`;
  if (error?.killed && error?.signal === 'SIGTERM') return `${phase}_TIMEOUT`;
  // The fixed phase distinguishes unavailable Git/repository facts without parsing private stderr.
  return `${phase}_UNAVAILABLE`;
}

async function syncDocumentManagementAssets() {
  const source = resolve(root, 'config/document-family-adapters');
  const target = resolve(root, 'dist/config/document-family-adapters');

  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true, force: true });

  const technicalPublicationContractSource = resolve(
    root,
    'server/runtime-assets/technical-publication-parsed-package/v1-frozen-2',
  );
  const technicalPublicationContractTarget = resolve(
    root,
    'dist/server/runtime-assets/technical-publication-parsed-package/v1-frozen-2',
  );
  await access(
    resolve(
      technicalPublicationContractSource,
      'freeze/frozen-2-contract-manifest.json',
    ),
  );
  await rm(technicalPublicationContractTarget, {
    recursive: true,
    force: true,
  });
  await mkdir(resolve(technicalPublicationContractTarget, '..'), {
    recursive: true,
  });
  await cp(
    technicalPublicationContractSource,
    technicalPublicationContractTarget,
    { recursive: true, force: true },
  );

  const producerAssetTargetDirectory = resolve(
    root,
    'dist/server/runtime-assets/first-vertical',
  );
  await mkdir(producerAssetTargetDirectory, { recursive: true });
  const producerAssets = [
    'real-ftd-frozen2.unified-package.json',
    'airbus-fast61-oem-reference.frozen2.unified-package.json',
    'airbus-fast62-oem-reference.frozen2.unified-package.json',
  ];
  const copiedProducerAssets = [];
  for (const assetName of producerAssets) {
    const producerAssetSource = resolve(root, 'test/fixtures', assetName);
    const producerAssetTarget = resolve(
      producerAssetTargetDirectory,
      assetName,
    );
    await copyFile(producerAssetSource, producerAssetTarget);
    copiedProducerAssets.push({ producerAssetSource, producerAssetTarget });
  }

  // pdfjs-dist is loaded by the professional-input child-process runner. The
  // Miaoda Hosted runtime does not preserve dist/node_modules for this dynamic
  // ESM import, so copy the declared, lockfile-pinned engine into the server
  // runtime assets that the platform does preserve. This packages the existing
  // parser; it does not introduce a second parser implementation.
  const pdfjsSource = resolve(root, 'node_modules/pdfjs-dist');
  const pdfjsTarget = resolve(
    root,
    'dist/server/runtime-assets/professional-input/pdfjs-dist',
  );
  const pdfjsEntrypoint = resolve(pdfjsSource, 'legacy/build/pdf.mjs');
  await access(pdfjsEntrypoint);
  await mkdir(resolve(pdfjsTarget, '..'), { recursive: true });
  await cp(pdfjsSource, pdfjsTarget, { recursive: true, force: true });

  // The OCR executables and language data are deployment assets, not npm
  // dependencies. The repository-owned Linux/x64 runtime is the production
  // default so a remote branch build cannot silently publish a manifest-only
  // package. Deployments may still select another complete pinned runtime, but
  // every source is validated before it is copied into the Host artifact.
  const configuredOcrRuntimeSource =
    process.env.WL31_PDF_OCR_RUNTIME_ROOT?.trim();
  const ocrRuntimeTarget = resolve(
    root,
    'dist/server/runtime-assets/professional-input/ocr-runtime',
  );
  const repositoryOcrRuntimeSource = resolve(
    root,
    'server/runtime-assets/professional-input/ocr-runtime',
  );
  const ocrRuntimeSource =
    configuredOcrRuntimeSource || repositoryOcrRuntimeSource;
  const copiedOcrRuntime = await copyPinnedPdfOcrRuntime({
    source: ocrRuntimeSource,
    target: ocrRuntimeTarget,
    // macOS developer builds still package the exact Linux runtime after the
    // full manifest/ELF/ABI closure check. Hosted Linux/x64 builds additionally
    // execute the renderer and bilingual OCR probe and must return READY.
    allowCrossPlatformCopy: true,
  });

  const serverBuildFingerprint = await writeServerBuildFingerprint(root, {
    requireProvenance: true,
  });

  process.stdout.write(
    `${JSON.stringify({
      serverBuildFingerprint,
      source,
      target,
      copiedTechnicalPublicationContract: {
        source: technicalPublicationContractSource,
        target: technicalPublicationContractTarget,
      },
      copiedProducerAssets,
      copiedPdfjsRuntime: {
        source: pdfjsSource,
        target: pdfjsTarget,
      },
      copiedOcrRuntime,
      ocrRuntimeDeploymentStatus:
        copiedOcrRuntime.preflightStatus === 'READY'
          ? 'PINNED_RUNTIME_READY'
          : 'PINNED_RUNTIME_STATICALLY_VALIDATED_NON_TARGET_BUILD',
      ocrRuntimeSourceSelection: configuredOcrRuntimeSource
        ? 'CONFIGURED_OVERRIDE'
        : 'REPOSITORY_PINNED_DEFAULT',
      copiedForHostedRuntime: copiedOcrRuntime.preflightStatus === 'READY',
      onlineMutationPerformed: false,
    })}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await syncDocumentManagementAssets();
  } catch (error) {
    if (error?.code !== 'SERVER_BUILD_PROVENANCE_REQUIRED') throw error;
    // The writer already emitted the bounded reason; do not print a path-bearing stack.
    process.exitCode = 1;
  }
}
