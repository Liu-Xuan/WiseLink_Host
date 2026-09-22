import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only'); require('tsconfig-paths/register');
const { jsPDF } = require('jspdf');
const { extractDocumentPdfPages, openDocumentPdfSession } = require('../../server/modules/document-management/src/hosted/nest/document-original-pdf.ts');
const { composeDocumentOriginal } = require('../../server/modules/document-management/src/hosted/nest/document-original-compose.ts');

test('Hosted extraction loads the packaged runtime engine without project node_modules', () => {
  const root = mkdtempSync(join(tmpdir(), 'wiselink-pdf-hosted-'));
  try {
    const modulePath = join(root, 'server/modules/document-management/src/hosted/nest/document-original-pdf.js');
    mkdirSync(join(modulePath, '..'), { recursive: true });
    const ts = require('typescript');
    writeFileSync(modulePath, ts.transpileModule(readFileSync(new URL('../../server/modules/document-management/src/hosted/nest/document-original-pdf.ts', import.meta.url), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
    const engine = join(root, 'server/runtime-assets/professional-input/pdfjs-dist/legacy/build');
    mkdirSync(engine, { recursive: true });
    for (const file of ['pdf.mjs', 'pdf.worker.mjs']) cpSync(require.resolve(`pdfjs-dist/legacy/build/${file}`), join(engine, file));
    const pdf = new jsPDF(); pdf.text('Hosted original survives dependency pruning.', 20, 20);
    writeFileSync(join(root, 'input.pdf'), Buffer.from(pdf.output('arraybuffer')));
    writeFileSync(join(root, 'check.cjs'), `
      const { extractDocumentPdfPages } = require(${JSON.stringify(modulePath)});
      extractDocumentPdfPages({ bytes: require('node:fs').readFileSync('./input.pdf'), pageStart: 0, pageCount: 1,
        assertActive: async () => {} }).then(result => {
          require('node:assert/strict').match(result.pages[0].text, /Hosted original survives dependency pruning/);
        }).catch(error => { console.error(error); process.exitCode = 1; });
    `);
    const result = spawnSync(process.execPath, ['check.cjs'], { cwd: root, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('actual PDF.js bounded extraction reports raster painting even when parser markdown has no image link', async () => {
  const pdf = new jsPDF(); pdf.text('A-12 limit -0.25', 20, 20);
  pdf.addImage({ imageData: { data: new Uint8ClampedArray([255, 0, 0, 255]), width: 1, height: 1 }, format: 'RGBA', x: 20, y: 30, width: 10, height: 10 });
  pdf.addPage(); pdf.text('Text-only next page.', 20, 20);
  const bytes = new Uint8Array(pdf.output('arraybuffer'));
  const first = await extractDocumentPdfPages({ bytes, pageStart: 0, pageCount: 1, assertActive: async () => {} });
  assert.equal(first.pageCount, 2); assert.equal(first.pages.length, 1);
  assert.match(first.pages[0].text, /A-12 limit -0\.25/); assert.ok(first.pages[0].imagePaintOperations > 0);
  const next = await extractDocumentPdfPages({ bytes, pageStart: 1, pageCount: 1, assertActive: async () => {} });
  assert.equal(next.pages[0].imagePaintOperations, 0);
  const result = composeDocumentOriginal({ binding: { documentVersionId: 'DV-test', parseRunId: 'PR-test', parseRevision: 1,
    sourceArtifactId: 'PDF-test', sourceSha256: 'a'.repeat(64), sourceByteLength: bytes.length },
    producer: { kind: 'OFFICIAL_PLUGIN_HYBRID', instanceId: 'fixture', pluginVersion: 'fixture', actionKey: 'fixture', concreteModel: null, extractedAt: null },
    extraction: { pageCount: 2, pages: [...first.pages, ...next.pages] }, markdown: 'A-12 limit -0.25\n\nText-only next page.' });
  assert.deepEqual(result.coverage.unresolvedRanges.filter(range => range.reason === 'FIGURE_UNINTERPRETED').map(range => range.pageIndexes), [[0]]);
  assert.equal(result.source.units.map(unit => unit.payload.text).join(' '), 'A-12 limit -0.25 Text-only next page.');
});

test('a single verified logical table retains both physical source pages and every cell', async () => {
  // Physical aligned columns are required; identical prose words do not prove a table.
  const pdf = new jsPDF(); pdf.setFontSize(10);
  const row = (left, right, y) => { pdf.text(left, 20, y); pdf.text(right, 70, y); };
  row('Key', 'Value', 40); row('A', '10', 50);
  pdf.addPage(); row('B', '20', 40); row('C', '30', 50);
  const bytes = new Uint8Array(pdf.output('arraybuffer'));
  const extraction = await extractDocumentPdfPages({ bytes, pageStart: 0, pageCount: 2, assertActive: async () => {} });
  const result = composeDocumentOriginal({ binding: { documentVersionId: 'DV-table', parseRunId: 'PR-table', parseRevision: 1,
    sourceArtifactId: 'PDF-table', sourceSha256: 'b'.repeat(64), sourceByteLength: bytes.length },
    producer: { kind: 'OFFICIAL_PLUGIN_HYBRID', instanceId: 'fixture', pluginVersion: 'fixture', actionKey: 'fixture', concreteModel: null, extractedAt: null },
    extraction, markdown: '| Key | Value |\n| --- | --- |\n| A | 10 |\n| B | 20 |\n| C | 30 |' });
  assert.equal(result.source.units.length, 1); assert.equal(result.source.units[0].kind, 'table');
  const rows = result.source.units[0].payload.rowGroups[0].rows;
  assert.deepEqual(rows.map(row => row.cells.map(cell => cell.inlineContent[0].text)), [['Key','Value'],['A','10'],['B','20'],['C','30']]);
  assert.deepEqual(result.locations.map(location => location.pageIndex), [0, 1]);
  assert.equal(result.locations.every(location => location.precision === 'TEXT_ITEM' && location.boxes.length > 0), true);
  assert.deepEqual(result.coverage.unresolvedRanges, []);
});


test('one actual PDF session processes successive bounded groups and rejects use after release', async () => {
  const pdf = new jsPDF();
  for (let page = 0; page < 17; page++) {
    if (page) pdf.addPage();
    pdf.text(`Original physical page ${page}.`, 20, 20);
  }
  const bytes = new Uint8Array(pdf.output('arraybuffer'));
  const originalLength = bytes.length;
  let checks = 0;
  const session = await openDocumentPdfSession({ bytes, assertActive: async () => { checks++; } });
  try {
    await assert.rejects(session.extract({ pageStart: -1, pageCount: 8 }), /DOCUMENT_PDF_INPUT_INVALID/);
    const first = await session.extract({ pageStart: 0, pageCount: 8 });
    const next = await session.extract({ pageStart: 8, pageCount: 8 });
    assert.equal(first.pageCount, 17); assert.equal(next.pageCount, 17);
    assert.deepEqual([...first.pages, ...next.pages].map(page => page.text),
      Array.from({ length: 16 }, (_, index) => `Original physical page ${index}.`));
    assert.equal(bytes.length, originalLength, 'PDF worker must not transfer/detach the verified caller bytes');
    assert.ok(checks >= 36, 'authorization/lease callback remains active throughout both page groups');
  } finally { await session.destroy(); }
  await session.destroy();
  await assert.rejects(session.extract({ pageStart: 16, pageCount: 1 }), /DOCUMENT_PDF_SESSION_CLOSED/);
});

test('a reused actual PDF session rechecks authorization before serving the next group', async () => {
  const pdf = new jsPDF(); pdf.text('First group.', 20, 20);
  pdf.addPage(); pdf.text('Second group.', 20, 20);
  let revoked = false;
  const session = await openDocumentPdfSession({ bytes: new Uint8Array(pdf.output('arraybuffer')),
    assertActive: async () => { if (revoked) throw new Error('SOURCE_READ_REVOKED'); } });
  try {
    assert.match((await session.extract({ pageStart: 0, pageCount: 1 })).pages[0].text, /First group/);
    revoked = true;
    await assert.rejects(session.extract({ pageStart: 1, pageCount: 1 }), /SOURCE_READ_REVOKED/);
  } finally { await session.destroy(); }
});
