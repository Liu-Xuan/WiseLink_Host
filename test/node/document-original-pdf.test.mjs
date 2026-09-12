import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only'); require('tsconfig-paths/register');
const { jsPDF } = require('jspdf');
const { extractDocumentPdfPages } = require('../../server/modules/document-management/src/hosted/nest/document-original-pdf.ts');
const { composeDocumentOriginal } = require('../../server/modules/document-management/src/hosted/nest/document-original-compose.ts');

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
  const pdf = new jsPDF(); pdf.text('Key Value A 10', 20, 20);
  pdf.addPage(); pdf.text('B 20 C 30', 20, 20);
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
  assert.equal(result.locations.every(location => location.precision === 'PAGE' && location.boxes.length === 0), true);
  assert.deepEqual(result.coverage.unresolvedRanges, []);
});
