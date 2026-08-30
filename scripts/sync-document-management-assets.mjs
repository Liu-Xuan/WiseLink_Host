import { access, copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { copyPinnedPdfOcrRuntime } from './lib/pdf-ocr-runtime-deployment.mjs';

const root = resolve(import.meta.dirname, '..');
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
await rm(technicalPublicationContractTarget, { recursive: true, force: true });
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
  const producerAssetTarget = resolve(producerAssetTargetDirectory, assetName);
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
// dependencies. A deployment that enables scanned-page materialization must
// supply one complete pinned runtime directory explicitly; an omitted runtime
// remains observable at Host startup and fails closed only when OCR is needed.
const ocrRuntimeSource = process.env.WL31_PDF_OCR_RUNTIME_ROOT?.trim();
const ocrRuntimeTarget = resolve(
  root,
  'dist/server/runtime-assets/professional-input/ocr-runtime',
);
const ocrRuntimeManifestSource = resolve(
  root,
  'server/runtime-assets/professional-input/ocr-runtime',
);
let copiedOcrRuntime = null;
if (ocrRuntimeSource) {
  copiedOcrRuntime = await copyPinnedPdfOcrRuntime({
    source: ocrRuntimeSource,
    target: ocrRuntimeTarget,
  });
} else {
  // deleteOutDir is intentionally false for this app. Remove any runtime left
  // by an earlier enabled build so an unset deployment input can never inherit
  // stale executables or tessdata and masquerade as configured.
  await rm(ocrRuntimeTarget, { recursive: true, force: true });
  await mkdir(ocrRuntimeTarget, { recursive: true });
  await copyFile(
    resolve(ocrRuntimeManifestSource, 'manifest.json'),
    resolve(ocrRuntimeTarget, 'manifest.json'),
  );
}

process.stdout.write(
  `${JSON.stringify({
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
    ocrRuntimeDeploymentStatus: copiedOcrRuntime
      ? 'PINNED_RUNTIME_READY'
      : 'NOT_SUPPLIED_FAIL_CLOSED_WHEN_REQUIRED',
    copiedForHostedRuntime: copiedOcrRuntime?.preflightStatus === 'READY',
    onlineMutationPerformed: false,
  })}\n`,
);
