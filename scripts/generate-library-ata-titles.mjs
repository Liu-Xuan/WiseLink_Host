import { readFile, writeFile } from 'node:fs/promises';

// The complete attachment catalog is the only source of truth. The library
// needs titles and provenance synchronously; definitions and other Atlas-only
// fields stay in the complete catalog behind the existing Atlas route boundary.
const input = new URL('../client/src/features/atlas/data/ata-catalog.json', import.meta.url);
const output = new URL('../client/src/pages/WorkspaceHomePage/library-ata-titles.generated.json', import.meta.url);
const catalog = JSON.parse(await readFile(input, 'utf8'));
const titles = {
  asOf: catalog.asOf,
  schemes: Object.fromEntries(Object.entries(catalog.schemes).map(([namespace, scheme]) => [
    namespace,
    Object.fromEntries(['chapters', 'expanded'].map((section) => [
      section,
      scheme[section].map(({ code, titleZH, titleEN, file, locator }) => ({ code, titleZH, titleEN, file, locator })),
    ])),
  ])),
};
const content = `${JSON.stringify(titles, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const existing = await readFile(output, 'utf8');
  if (existing !== content) {
    console.error('Library ATA title projection is stale. Run node scripts/generate-library-ata-titles.mjs');
    process.exitCode = 1;
  } else {
    console.log('Library ATA title projection matches the complete attachment catalog.');
  }
} else {
  await writeFile(output, content);
  console.log('Generated the complete bilingual library ATA title projection.');
}
