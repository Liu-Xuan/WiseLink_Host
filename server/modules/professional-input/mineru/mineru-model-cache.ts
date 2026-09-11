import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { withFileReadTransportRetry } from '../../unified-reader/file-service-read-transport';

export interface MineruDeploymentPart {
  offset: number;
  bytes: number;
  sha256: string;
  bucketId: string;
  filePath: string;
  verified: true;
}

export interface MineruDeploymentFile {
  relativePath: string;
  bytes: number;
  sha256: string;
  parts: MineruDeploymentPart[];
}

export interface MineruModelStorageManifest {
  schemaVersion: 'wiselink.mineru.runtime-files.v1';
  appId: string;
  mineruVersion: '3.4.5';
  files: MineruDeploymentFile[];
}

const sha256Pattern = /^[a-f0-9]{64}$/;

/** The manifest is a server deployment artifact, never an HTTP request parameter. */
export function readMineruModelStorageManifest(input: unknown): MineruModelStorageManifest {
  if (!input || typeof input !== 'object') throw new Error('MINERU_MODEL_MANIFEST_INVALID');
  const manifest = input as MineruModelStorageManifest;
  if (manifest.schemaVersion !== 'wiselink.mineru.runtime-files.v1' || manifest.mineruVersion !== '3.4.5' ||
      !/^app_[a-z0-9]+$/.test(manifest.appId) || !Array.isArray(manifest.files) ||
      manifest.files.length < 1 || manifest.files.length > 200) throw new Error('MINERU_MODEL_MANIFEST_INVALID');
  const paths = new Set<string>();
  let bytes = 0;
  for (const file of manifest.files) {
    if (!file || typeof file.relativePath !== 'string' ||
        (!/^(pipeline|vlm)\/[A-Za-z0-9_./-]+$/.test(file.relativePath) && !['runtime/wheelhouse.tar', 'runtime/python.tar.gz'].includes(file.relativePath)) ||
        file.relativePath.split('/').some(part => !part || part === '.' || part === '..') || paths.has(file.relativePath) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 1 || !sha256Pattern.test(file.sha256) ||
        !Array.isArray(file.parts) || !file.parts.length || file.parts.length > 100) throw new Error('MINERU_MODEL_MANIFEST_INVALID');
    paths.add(file.relativePath);
    let offset = 0;
    for (const part of file.parts) {
      if (!part || part.offset !== offset || !Number.isSafeInteger(part.bytes) || part.bytes < 1 || part.bytes > 100_000_000 ||
          !sha256Pattern.test(part.sha256) || !/^bucket_[A-Za-z0-9_-]+$/.test(part.bucketId) ||
          !/^\/[A-Za-z0-9_.-]+$/.test(part.filePath) || part.verified !== true) throw new Error('MINERU_MODEL_MANIFEST_INVALID');
      offset += part.bytes;
    }
    if (offset !== file.bytes) throw new Error('MINERU_MODEL_MANIFEST_INVALID');
    bytes += file.bytes;
  }
  if (bytes > 8 * 1024 ** 3) throw new Error('MINERU_MODEL_MANIFEST_INVALID');
  return structuredClone(manifest);
}

/**
 * Container disk is only a cache. Missing files are restored from app FileService,
 * checked against the deployment manifest, then atomically published. No model
 * provider network or signed URL is needed when a container is replaced.
 */
export class MineruModelCache {
  private prepared: Promise<string> | undefined;
  private configuration: string | undefined;

  constructor(private readonly files: Pick<FileService, 'from'>) {}

  prepare(input: { root: string; manifest: MineruModelStorageManifest; onProgress?: (path: string) => void }): Promise<string> {
    // The owning runtime service creates one cache per deployment configuration.
    const configuration = JSON.stringify([input.root, input.manifest]);
    if (this.configuration && this.configuration !== configuration) throw new Error('MINERU_MODEL_CACHE_CONFIG_CHANGED');
    this.configuration = configuration;
    this.prepared ??= this.restore(input).catch(error => {
      this.prepared = undefined;
      throw error;
    });
    return this.prepared;
  }

  private async restore(input: { root: string; manifest: MineruModelStorageManifest; onProgress?: (path: string) => void }) {
    const manifest = readMineruModelStorageManifest(input.manifest);
    if (!isAbsolute(input.root)) throw new Error('MINERU_MODEL_CACHE_ROOT_INVALID');
    const configuredRoot = resolve(input.root);
    await mkdir(configuredRoot, { recursive: true });
    if ((await lstat(configuredRoot)).isSymbolicLink()) throw new Error('MINERU_MODEL_CACHE_SYMLINK');
    const root = await realpath(configuredRoot);
    for (const file of manifest.files) {
      const destination = join(root, file.relativePath);
      await mkdir(dirname(destination), { recursive: true });
      if ((await realpath(dirname(destination))) !== dirname(destination) || relative(root, destination).startsWith('..')) {
        throw new Error('MINERU_MODEL_CACHE_SYMLINK');
      }
      if (await exists(destination)) {
        await verifyFile(destination, file.bytes, file.sha256);
      } else {
        const staging = `${destination}.assembling`;
        const chunk = `${destination}.chunk`;
        await removeStaging(staging);
        await removeStaging(chunk);
        try {
          const target = await open(staging, 'wx', 0o600);
          try {
            for (const part of file.parts) {
              await this.downloadPart(part, chunk);
              for await (const data of createReadStream(chunk)) await target.writeFile(data);
              await rm(chunk);
            }
            await target.sync();
          } finally {
            await target.close();
          }
          await verifyFile(staging, file.bytes, file.sha256);
          await rename(staging, destination);
        } finally {
          await removeStaging(chunk);
          await removeStaging(staging);
        }
      }
      input.onProgress?.(file.relativePath);
    }
    const configPath = join(root, 'mineru.json');
    const config = JSON.stringify({
      'model-source': 'local',
      'models-dir': { pipeline: join(root, 'pipeline'), vlm: join(root, 'vlm') },
      'llm-aided-config': { title_aided: { enable: false } },
    }, null, 2) + '\n';
    if (await exists(configPath)) {
      if ((await lstat(configPath)).isSymbolicLink() || await readFile(configPath, 'utf8') !== config) {
        throw new Error('MINERU_MODEL_CONFIG_MISMATCH');
      }
    } else {
      await writeFile(configPath, config, { flag: 'wx', mode: 0o600 });
    }
    return configPath;
  }

  private async downloadPart(part: MineruDeploymentPart, path: string) {
    await withFileReadTransportRetry(async () => {
      await removeStaging(path);
      await this.downloadPartOnce(part, path);
    });
  }

  private async downloadPartOnce(part: MineruDeploymentPart, path: string) {
    const downloaded = await this.files.from(part.bucketId).download(part.filePath).asStream();
    if (!downloaded.metadata || downloaded.metadata.bucketID !== part.bucketId ||
        downloaded.metadata.filePath.replace(/^\//, '') !== part.filePath.slice(1) ||
        Number(downloaded.metadata.metadata.contentLength) !== part.bytes) {
      await downloaded.content.cancel();
      throw new Error('MINERU_MODEL_OBJECT_MISMATCH');
    }
    const output = await open(path, 'wx', 0o600);
    const reader = downloaded.content.getReader();
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        if (!(item.value instanceof Uint8Array)) throw new Error('MINERU_MODEL_STREAM_INVALID');
        bytes += item.value.length;
        if (bytes > part.bytes) throw new Error('MINERU_MODEL_OBJECT_MISMATCH');
        hash.update(item.value);
        await output.writeFile(item.value);
      }
      if (bytes !== part.bytes || hash.digest('hex') !== part.sha256) throw new Error('MINERU_MODEL_OBJECT_MISMATCH');
      await output.sync();
    } finally {
      await reader.cancel().catch(() => undefined);
      await output.close();
    }
  }
}

async function exists(path: string) {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

async function removeStaging(path: string) {
  if (!(await exists(path))) return;
  if (!(await lstat(path)).isFile()) throw new Error('MINERU_MODEL_CACHE_SYMLINK');
  await rm(path);
}

async function verifyFile(path: string, bytes: number, expected: string) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size !== bytes) throw new Error('MINERU_MODEL_CACHE_MISMATCH');
  const hash = createHash('sha256');
  for await (const data of createReadStream(path)) hash.update(data);
  if (hash.digest('hex') !== expected) throw new Error('MINERU_MODEL_CACHE_MISMATCH');
}
