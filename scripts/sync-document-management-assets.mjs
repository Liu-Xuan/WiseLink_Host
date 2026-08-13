import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'config/document-family-adapters');
const target = resolve(root, 'dist/config/document-family-adapters');

await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true, force: true });

process.stdout.write(`${JSON.stringify({
  source,
  target,
  copiedForHostedRuntime: true,
  onlineMutationPerformed: false,
})}\n`);
