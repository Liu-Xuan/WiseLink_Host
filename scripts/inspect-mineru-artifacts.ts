/** Offline artifact inspection; does not upload, adopt or publish a document. */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { readMineruArtifacts } from '../server/modules/professional-input/mineru/mineru-artifacts';

async function main() {
  const [directory, stem, destination] = process.argv.slice(2);
  if (!directory || !stem || !destination || !/^[^/\\]+$/.test(stem)) {
    throw new Error(
      'Usage: ts-node --project tsconfig.node.json scripts/inspect-mineru-artifacts.ts DIRECTORY STEM OUTPUT_JSON',
    );
  }
  const root = resolve(directory);
  async function text(name: string) {
    const path = join(root, name);
    if ((await stat(path)).size > 50 * 1024 * 1024)
      throw new Error('MINERU_INSPECTION_FILE_TOO_LARGE');
    return readFile(path, 'utf8');
  }
  const assetPaths: string[] = [];
  async function images(relative: string) {
    let entries;
    try {
      entries = await readdir(join(root, relative), { withFileTypes: true });
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
        throw new Error('MINERU_INSPECTION_SYMLINK_FORBIDDEN');
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await images(path);
      else if (entry.isFile()) assetPaths.push(path);
    }
  }
  await images('images');
  const [markdown, contentList, middle] = await Promise.all([
    text(`${stem}.md`),
    text(`${stem}_content_list_v2.json`),
    text(`${stem}_middle.json`),
  ]);
  const document = readMineruArtifacts({
    markdown,
    contentListV2: JSON.parse(contentList),
    middle: JSON.parse(middle),
    assetPaths,
  });
  await writeFile(
    resolve(destination),
    `${JSON.stringify(document, null, 2)}\n`,
    { flag: 'wx' },
  );
  process.stdout.write(
    `${JSON.stringify({
      version: document.version,
      pages: document.pages.length,
      blocks: document.blocks.length,
      discarded: document.discardedBlocks.length,
      diagnostics: document.diagnostics,
      output: resolve(destination),
    })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
