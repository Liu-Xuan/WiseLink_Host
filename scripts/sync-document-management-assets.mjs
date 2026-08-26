import { access, copyFile, cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'config/document-family-adapters');
const target = resolve(root, 'dist/config/document-family-adapters');

await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true, force: true });

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

process.stdout.write(`${JSON.stringify({
  source,
  target,
  copiedProducerAssets,
  copiedPdfjsRuntime: {
    source: pdfjsSource,
    target: pdfjsTarget,
  },
  copiedForHostedRuntime: true,
  onlineMutationPerformed: false,
})}\n`);
