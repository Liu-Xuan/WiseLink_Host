import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { MineruModelCache, readMineruModelStorageManifest, type MineruModelStorageManifest } from '../../../server/modules/professional-input/mineru/mineru-model-cache';

const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

function fixture() {
  const parts = [Buffer.from('first-model-part'), Buffer.from('second-model-part')];
  const bytes = Buffer.concat(parts);
  let offset = 0;
  const manifest: MineruModelStorageManifest = {
    schemaVersion: 'wiselink.mineru.runtime-files.v1', appId: 'app_test', mineruVersion: '3.4.5',
    files: [{ relativePath: 'pipeline/models/model.bin', bytes: bytes.length, sha256: sha(bytes),
      parts: parts.map((part, index) => {
        const descriptor = { offset, bytes: part.length, sha256: sha(part), bucketId: 'bucket_test', filePath: `/object-${index}.bin`, verified: true as const };
        offset += part.length;
        return descriptor;
      }),
    }],
  };
  let corrupt = false;
  const download = jest.fn((path: string) => ({ asStream: async () => {
    const part = manifest.files[0].parts.find(value => value.filePath === path)!;
    const original = parts[manifest.files[0].parts.indexOf(part)];
    return {
      metadata: { bucketID: 'bucket_test', filePath: path, metadata: { contentLength: String(part.bytes) } },
      content: new ReadableStream({ start(controller) {
        controller.enqueue(corrupt ? Buffer.alloc(part.bytes) : original.subarray(0, 3));
        if (!corrupt) controller.enqueue(original.subarray(3));
        controller.close();
      } }),
    };
  } }));
  const files = { from: jest.fn(() => ({ download })) } as unknown as Pick<FileService, 'from'>;
  return { manifest, bytes, files, download, corrupt: (value: boolean) => { corrupt = value; } };
}

describe('MinerU deployment model cache', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mineru-model-cache-test-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('restores a fresh container, verifies existing files after restart, and restores again after cache loss', async () => {
    const input = fixture();
    const path = join(root, input.manifest.files[0].relativePath);
    const cache = new MineruModelCache(input.files);
    const [config, same] = await Promise.all([cache.prepare({ root, manifest: input.manifest }), cache.prepare({ root, manifest: input.manifest })]);
    expect(config).toBe(same);
    expect(await readFile(path)).toEqual(input.bytes);
    expect(input.download).toHaveBeenCalledTimes(2);
    const configuration = JSON.parse(await readFile(config, 'utf8'));
    expect(configuration['model-source']).toBe('local');
    expect(configuration['llm-aided-config'].title_aided.enable).toBe(false);
    await new MineruModelCache(input.files).prepare({ root, manifest: input.manifest });
    expect(input.download).toHaveBeenCalledTimes(2);
    await rm(root, { recursive: true });
    await new MineruModelCache(input.files).prepare({ root, manifest: input.manifest });
    expect(await readFile(path)).toEqual(input.bytes);
    expect(input.download).toHaveBeenCalledTimes(4);
  });

  it('never publishes corrupted storage data and permits an explicit retry after the data is repaired', async () => {
    const input = fixture();
    input.corrupt(true);
    const cache = new MineruModelCache(input.files);
    await expect(cache.prepare({ root, manifest: input.manifest })).rejects.toThrow('MINERU_MODEL_OBJECT_MISMATCH');
    await expect(readFile(join(root, input.manifest.files[0].relativePath))).rejects.toMatchObject({ code: 'ENOENT' });
    input.corrupt(false);
    await cache.prepare({ root, manifest: input.manifest });
    expect(await readFile(join(root, input.manifest.files[0].relativePath))).toEqual(input.bytes);
  });

  it('rejects changed local files and malformed deployment paths instead of calling the model provider', async () => {
    const input = fixture();
    await new MineruModelCache(input.files).prepare({ root, manifest: input.manifest });
    await writeFile(join(root, input.manifest.files[0].relativePath), Buffer.alloc(input.bytes.length));
    await expect(new MineruModelCache(input.files).prepare({ root, manifest: input.manifest })).rejects.toThrow('MINERU_MODEL_CACHE_MISMATCH');
    expect(input.download).toHaveBeenCalledTimes(2);
    const invalid = structuredClone(input.manifest);
    invalid.files[0].relativePath = 'pipeline/../../outside';
    expect(() => readMineruModelStorageManifest(invalid)).toThrow('MINERU_MODEL_MANIFEST_INVALID');
    const gap = structuredClone(input.manifest);
    gap.files[0].parts[1].offset += 1;
    expect(() => readMineruModelStorageManifest(gap)).toThrow('MINERU_MODEL_MANIFEST_INVALID');
  });
});
