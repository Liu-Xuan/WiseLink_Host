import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { readMineruArtifacts, safeMineruAssetPath } from './mineru-artifacts';

export interface MineruAssetBytes {
  path: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  sha256: string;
  bytes: Uint8Array;
}

/** Reads an isolated output bundle, never follows a link out of that bundle. */
export async function readMineruArtifactFiles(directory: string, stem: string) {
  if (!/^[^/\\]+$/.test(stem) || stem === '.' || stem === '..')
    throw new Error('MINERU_STEM_INVALID');
  const root = await realpath(directory);
  let totalBytes = 0;
  async function bytes(relative: string): Promise<Buffer> {
    const path = resolve(root, relative);
    if (
      !path.startsWith(`${root}${sep}`) ||
      (await lstat(path)).isSymbolicLink() ||
      (await realpath(path)) !== path
    ) {
      throw new Error('MINERU_OUTPUT_PATH_INVALID');
    }
    const size = (await lstat(path)).size;
    totalBytes += size;
    if (size > 64 * 1024 * 1024 || totalBytes > 128 * 1024 * 1024)
      throw new Error('MINERU_OUTPUT_TOO_LARGE');
    const content = await readFile(path);
    if (content.length !== size)
      throw new Error('MINERU_OUTPUT_CHANGED_DURING_READ');
    return content;
  }
  const assets: MineruAssetBytes[] = [];
  async function collect(relative: string) {
    let entries;
    try {
      const directory = resolve(root, relative);
      if (
        (await lstat(directory)).isSymbolicLink() ||
        (await realpath(directory)) !== directory
      )
        throw new Error('MINERU_OUTPUT_SYMLINK_FORBIDDEN');
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (
        relative === 'images' &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      )
        return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink())
        throw new Error('MINERU_OUTPUT_SYMLINK_FORBIDDEN');
      const path = safeMineruAssetPath(`${relative}/${entry.name}`);
      if (entry.isDirectory()) await collect(path);
      else if (entry.isFile()) {
        if (assets.length >= 1024)
          throw new Error('MINERU_ASSET_COUNT_EXCEEDED');
        const content = await bytes(path);
        assets.push({
          path,
          mediaType: imageType(content),
          sha256: createHash('sha256').update(content).digest('hex'),
          bytes: content,
        });
      }
    }
  }
  // Serial reads make the aggregate output limit deterministic.
  const markdown = (await bytes(`${stem}.md`)).toString('utf8');
  const contentListV2: unknown = JSON.parse(
    (await bytes(`${stem}_content_list_v2.json`)).toString('utf8'),
  );
  const middle: unknown = JSON.parse(
    (await bytes(`${stem}_middle.json`)).toString('utf8'),
  );
  await collect('images');
  return {
    rawMarkdown: markdown,
    document: readMineruArtifacts({
      markdown,
      contentListV2,
      middle,
      assetPaths: assets.map((a) => a.path),
    }),
    assets,
    // Keep original JSON, including fields not used by the reading projection.
    contentListV2,
    middle,
  };
}

function imageType(bytes: Buffer): MineruAssetBytes['mediaType'] {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg';
  if (
    bytes.subarray(0, 4).toString() === 'RIFF' &&
    bytes.subarray(8, 12).toString() === 'WEBP'
  )
    return 'image/webp';
  throw new Error('MINERU_ASSET_MEDIA_TYPE_UNSUPPORTED');
}
