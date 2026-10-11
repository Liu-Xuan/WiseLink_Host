import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { extractDocumentPdfPages } = require('../../server/modules/document-management/src/hosted/nest/document-original-pdf.ts');
const { documentMineruOriginal } = require('../../server/modules/document-management/src/hosted/nest/document-mineru-original-adapter.ts');
const { reconcileMineruTextCoverage } = require('../../server/modules/document-management/src/hosted/nest/document-mineru-text-coverage.ts');
const { documentOriginalStructuredSource } = require('../../server/modules/document-management/src/hosted/nest/document-original-adapter.ts');
const { buildTranslationSourcePlan } = require('../../server/modules/canonical-host/canonical-translation-source-plan.ts');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Private authorized source/captured responses stay outside Git. This regression
// uses the complete worker bundle, including omitted furniture, without publishing it.
const paths = {
  pdf: process.env.WL_DOCUMENT_PROSE_PDF,
  candidate: process.env.WL_DOCUMENT_PROSE_CANDIDATE,
  published: process.env.WL_DOCUMENT_PROSE_PUBLISHED,
  layout: process.env.WL_DOCUMENT_PROSE_LAYOUT,
};
test('actual PDF plus complete MinerU bundle restores the published prose gap with anchors and immutable raw',
  { skip: Object.values(paths).some(value => !value) }, async () => {
    const files = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, readFileSync(path)]));
    const candidate = JSON.parse(files.candidate.toString('utf8'));
    const published = JSON.parse(files.published.toString('utf8'));
    const layout = JSON.parse(files.layout.toString('utf8'));
    const beforeCandidate = JSON.stringify(candidate);
    const beforePublished = JSON.stringify(published);
    const binding = published.original.binding;
    assert.equal(sha(files.pdf), binding.sourceSha256);
    assert.equal(files.pdf.length, binding.sourceByteLength);
    assert.equal(candidate.source.sha256, binding.sourceSha256);
    assert.equal(candidate.source.byteLength, binding.sourceByteLength);
    const target = published.original.source.units.find(unit => unit.kind === 'table' &&
      unit.payload.columnCount === 1 && unit.payload.rawMineruContent?.table_type === 'simple_table' &&
      unit.mapping.nativeBbox[1] < layout.box[1] * 1000 / layout.pageHeight + 1 &&
      unit.mapping.nativeBbox[3] > layout.box[3] * 1000 / layout.pageHeight - 1);
    assert.ok(target, 'the captured incomplete table is bound to the independently inspected region');
    assert.equal(layout.touched.length, 12);
    const expectedParagraphs = [layout.touched[0].text];
    for (const [index, line] of layout.touched.slice(1).entries()) {
      if (!index || line.gapPrior > line.gapLimit) expectedParagraphs.push(line.text);
      else expectedParagraphs[expectedParagraphs.length - 1] += ` ${line.text}`;
    }
    assert.equal(expectedParagraphs.length, 5, 'initial label and four independently inspected body paragraphs');
    const expectedText = expectedParagraphs.join('\n\n');
    const extraction = await extractDocumentPdfPages({ bytes: files.pdf, pageStart: 0,
      pageCount: published.original.coverage.knownPageCount, assertActive: async () => {} });
    const beforeExtraction = JSON.stringify(extraction);
    const original = documentMineruOriginal({ binding, documentVersion: {
      documentVersionId: binding.documentVersionId, documentId: 'private-regression', familyId: 'private-regression',
      sourceArtifactId: binding.sourceArtifactId, pdfSha256: binding.sourceSha256, byteLength: binding.sourceByteLength,
    }, result: { sourceSha256: candidate.source.sha256, sourceByteLength: candidate.source.byteLength,
      rawArtifacts: candidate.raw, assets: candidate.assets } });
    const beforeOriginal = JSON.stringify(original);
    const result = reconcileMineruTextCoverage({ original, extraction,
      rawMiddle: candidate.raw.middle, rawContentListV2: candidate.raw.contentListV2 });
    const recovered = result.source.units.find(unit => unit.unitId === target.unitId);
    assert.equal(recovered.kind, 'paragraph');
    assert.equal(recovered.payload.text, expectedText);
    assert.equal(JSON.stringify(recovered.payload.rawMineruContent), JSON.stringify(target.payload.rawMineruContent));
    assert.equal(recovered.mapping.sourcePointer, target.mapping.sourcePointer);
    assert.deepEqual(recovered.mapping.nativeBbox, target.mapping.nativeBbox);
    assert.equal(recovered.mapping.textItems.length, 12);
    assert.deepEqual(result.binding, binding);
    assert.equal(result.source.units.length, published.original.source.units.length);
    assert.equal(result.source.units.filter(unit => unit.unitId !== target.unitId && JSON.stringify(unit) !==
      JSON.stringify(published.original.source.units.find(previous => previous.unitId === unit.unitId))).length, 0,
    'other published units, including real grid tables, stay unchanged');
    const ref = recovered.sourceRefIds[0];
    const location = result.locations.find(entry => entry.sourceRefId === ref);
    assert.equal(location.precision, 'TEXT_ITEM');
    assert.equal(location.boxes.length, 12);
    assert.equal(result.source.sourceLocators.find(entry => entry.sourceRefId === ref).quote, expectedText);
    const descriptor = Buffer.from(JSON.stringify(result));
    const plan = buildTranslationSourcePlan({ documentVersionId: binding.documentVersionId, packageId: binding.parseRunId,
      title: '', source: documentOriginalStructuredSource(result, binding), parsedArtifact: {
        storeRole: 'UnifiedArtifactStoreCandidate', ref: 'fixture://private-prose-regression',
        sha256: sha(descriptor), byteLength: descriptor.length, mediaType: 'application/json',
      } });
    const anchor = plan.anchors.find(entry => entry.sourceUnitId === target.unitId && entry.payloadPath === '/payload/text');
    assert.ok(anchor, 'restored prose is delivered as a citeable text anchor');
    assert.equal(anchor.sourceText, expectedText);
    assert.deepEqual(anchor.sourceRefIds, recovered.sourceRefIds);
    assert.equal(anchor.sourceLocators[0].quote, expectedText);
    const oldAffected = published.original.coverage.unresolvedRanges.filter(range => range.unitIds.includes(target.unitId));
    assert.equal(oldAffected.length, 9);
    assert.equal(result.coverage.unresolvedRanges.filter(range => range.unitIds.includes(target.unitId)).length, 0);
    assert.equal(result.coverage.unresolvedRanges.length, published.original.coverage.unresolvedRanges.length - 9);
    assert.equal(result.source.findings.filter(finding => finding.code === 'PDF_TEXT_REGION_RECOVERY').length, 1);
    assert.equal(JSON.stringify(candidate), beforeCandidate);
    assert.equal(JSON.stringify(published), beforePublished);
    assert.equal(JSON.stringify(extraction), beforeExtraction);
    assert.equal(JSON.stringify(original), beforeOriginal);
    for (const [key, path] of Object.entries(paths)) assert.equal(sha(readFileSync(path)), sha(files[key]), `${key} file unchanged`);
  });
