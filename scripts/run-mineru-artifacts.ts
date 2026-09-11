/** Local operator entry for the same runner exported to the Host integration. */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { MineruRunner } from '../server/modules/professional-input/mineru/mineru-runner';

async function main() {
  const [input, destination] = process.argv.slice(2);
  const executable = process.env.WL_MINERU_EXECUTABLE;
  const configPath = process.env.WL_MINERU_CONFIG;
  if (!input || !destination || !executable || !configPath) {
    throw new Error(
      'Usage: WL_MINERU_EXECUTABLE=/path/mineru WL_MINERU_CONFIG=/path/mineru.json ts-node --project tsconfig.node.json scripts/run-mineru-artifacts.ts INPUT_PDF NEW_OUTPUT_DIR',
    );
  }
  if ((await stat(input)).size > 100 * 1024 * 1024)
    throw new Error('MINERU_INPUT_TOO_LARGE');
  const source = await readFile(input);
  const result = await new MineruRunner({ executable, configPath }).parse(
    source,
  );
  const output = resolve(destination);
  await mkdir(output); // A new directory is required; never overwrite another parse.
  await writeFile(join(output, 'original.pdf'), source, { flag: 'wx' });
  await writeFile(
    join(output, 'document.raw.md'),
    result.rawArtifacts.markdown,
    { flag: 'wx' },
  );
  await writeFile(
    join(output, 'document.raw_content_list_v2.json'),
    JSON.stringify(result.rawArtifacts.contentListV2),
    { flag: 'wx' },
  );
  await writeFile(
    join(output, 'document.raw_middle.json'),
    JSON.stringify(result.rawArtifacts.middle),
    { flag: 'wx' },
  );
  await writeFile(join(output, 'document.md'), result.document.markdown, {
    flag: 'wx',
  });
  await writeFile(
    join(output, 'document_middle.json'),
    JSON.stringify(result.middle),
    { flag: 'wx' },
  );
  await writeFile(
    join(output, 'document_content_list_v2.json'),
    JSON.stringify(result.contentListV2),
    { flag: 'wx' },
  );
  for (const asset of result.assets) {
    const path = join(output, asset.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, asset.bytes, { flag: 'wx' });
  }
  await writeFile(
    join(output, 'reading.json'),
    JSON.stringify(result.document, null, 2),
    { flag: 'wx' },
  );
  const summary = {
    sourceSha256: result.sourceSha256,
    sourceByteLength: result.sourceByteLength,
    mineruVersion: result.document.version,
    pages: result.document.pages.length,
    assets: result.assets.map(({ bytes, ...metadata }) => ({
      ...metadata,
      byteLength: bytes.length,
    })),
    diagnostics: result.document.diagnostics,
    titleEnhancement: result.titleEnhancement,
    output,
  };
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(summary, null, 2),
    { flag: 'wx' },
  );
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
