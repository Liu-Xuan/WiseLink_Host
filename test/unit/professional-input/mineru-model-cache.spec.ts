import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

  it('retries a transient storage read but never retries a permission response', async () => {
    const input = fixture();
    input.download.mockImplementationOnce(() => ({ asStream: async () => { throw new TypeError('fetch failed'); } }));
    await new MineruModelCache(input.files).prepare({ root, manifest: input.manifest });
    expect(await readFile(join(root, input.manifest.files[0].relativePath))).toEqual(input.bytes);
    expect(input.download).toHaveBeenCalledTimes(3);
    await rm(root, { recursive: true });
    input.download.mockClear();
    input.download.mockImplementationOnce(() => ({ asStream: async () => { throw Object.assign(new Error('fetch failed'), { status: 403 }); } }));
    await expect(new MineruModelCache(input.files).prepare({ root, manifest: input.manifest })).rejects.toMatchObject({ status: 403 });
    expect(input.download).toHaveBeenCalledTimes(1);
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

  it('resumes verified parts after a storage interruption and removes an incomplete append', async () => {
    const input = fixture();
    const originalDownload = input.download.getMockImplementation()!;
    input.download.mockImplementation((path: string) => path === '/object-1.bin'
      ? { asStream: async () => { throw Object.assign(new Error('storage unavailable'), { status: 503 }); } }
      : originalDownload(path));
    await expect(new MineruModelCache(input.files).prepare({ root, manifest: input.manifest })).rejects.toMatchObject({ status: 503 });
    const destination = join(root, input.manifest.files[0].relativePath);
    await expect(readFile(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    const prefix = input.bytes.subarray(0, input.manifest.files[0].parts[0].bytes);
    expect(await readFile(destination + '.assembling')).toEqual(prefix);
    await writeFile(destination + '.assembling', Buffer.alloc(prefix.length));
    input.download.mockClear();
    await expect(new MineruModelCache(input.files).prepare({ root, manifest: input.manifest })).rejects.toThrow('MINERU_MODEL_CACHE_MISMATCH');
    expect(input.download).not.toHaveBeenCalled();
    await writeFile(destination + '.assembling', prefix);
    await appendFile(destination + '.assembling', 'interrupted');
    input.download.mockReset().mockImplementation(originalDownload);
    await new MineruModelCache(input.files).prepare({ root, manifest: input.manifest });
    expect(input.download.mock.calls.map(args => args[0])).toEqual(['/object-1.bin']);
    expect(await readFile(destination)).toEqual(input.bytes);
  });
});
