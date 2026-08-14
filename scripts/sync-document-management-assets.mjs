import { copyFile, cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'config/document-family-adapters');
const target = resolve(root, 'dist/config/document-family-adapters');

await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true, force: true });

const producerAssetSource = resolve(
  root,
  'test/fixtures/real-ftd-frozen2.unified-package.json',
);
const producerAssetTargetDirectory = resolve(
  root,
  'dist/server/runtime-assets/first-vertical',
);
const producerAssetTarget = resolve(
  producerAssetTargetDirectory,
  'real-ftd-frozen2.unified-package.json',
);
await mkdir(producerAssetTargetDirectory, { recursive: true });
await copyFile(producerAssetSource, producerAssetTarget);

process.stdout.write(`${JSON.stringify({
  source,
  target,
  producerAssetSource,
  producerAssetTarget,
  copiedForHostedRuntime: true,
  onlineMutationPerformed: false,
})}\n`);
