import { copyFile, cp, mkdir } from 'node:fs/promises';
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
];
const copiedProducerAssets = [];
for (const assetName of producerAssets) {
  const producerAssetSource = resolve(root, 'test/fixtures', assetName);
  const producerAssetTarget = resolve(producerAssetTargetDirectory, assetName);
  await copyFile(producerAssetSource, producerAssetTarget);
  copiedProducerAssets.push({ producerAssetSource, producerAssetTarget });
}

process.stdout.write(`${JSON.stringify({
  source,
  target,
  copiedProducerAssets,
  copiedForHostedRuntime: true,
  onlineMutationPerformed: false,
})}\n`);
