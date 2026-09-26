/** Package a local MinerU result as a candidate; Host supplies all business identities. */
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readLocalMineruCandidate } from '../server/modules/document-management/src/hosted/nest/document-mineru-local-candidate';
import { readMineruArtifactFiles } from '../server/modules/professional-input/mineru/mineru-artifact-files';

async function main() {
  const [pdfPath, artifactDirectory, stem, outputPath, titleReceiptPath] = process.argv.slice(2);
  if (!pdfPath || !artifactDirectory || !stem || !outputPath || ![6, 7].includes(process.argv.length))
    throw new Error('Usage: ts-node --project tsconfig.node.json scripts/package-local-mineru-candidate.ts ORIGINAL_PDF ARTIFACT_DIRECTORY STEM NEW_OUTPUT_JSON [TITLE_RECEIPT_JSON]');
  const size = (await stat(pdfPath)).size;
  if (size < 5 || size > 100 * 1024 * 1024) throw new Error('MINERU_INPUT_INVALID');
  const bytes = await readFile(pdfPath);
  if (bytes.length !== size || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('MINERU_INPUT_INVALID');
  const parsed = await readMineruArtifactFiles(artifactDirectory, stem);
  const candidate = {
    schemaVersion: 'wiselink.mineru.local-candidate.v1',
    source: { sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length },
    parser: { version: parsed.document.version, backend: parsed.document.backend },
    raw: { markdown: parsed.rawMarkdown, contentListV2: parsed.contentListV2, middle: parsed.middle },
    assets: parsed.assets.map(asset => ({ path: asset.path, mediaType: asset.mediaType,
      sha256: asset.sha256, byteLength: asset.bytes.length, base64: Buffer.from(asset.bytes).toString('base64') })),
  };
  const titleFile = titleReceiptPath ? JSON.parse(await readFile(titleReceiptPath, 'utf8')) : undefined;
  if (titleFile && (typeof titleFile !== 'object' || Array.isArray(titleFile) ||
      Object.keys(titleFile).length !== 1 || !('titleEnhancement' in titleFile)))
    throw new Error('MINERU_TITLE_RECEIPT_INVALID');
  const titleReceipt = titleFile?.titleEnhancement;
  const serialized = Buffer.from(JSON.stringify({ ...candidate, ...(titleReceipt ? { titleEnhancement: titleReceipt } : {}) }));
  if (serialized.length > 64 * 1024 * 1024) throw new Error('MINERU_CANDIDATE_TOO_LARGE');
  readLocalMineruCandidate(serialized);
  const output = resolve(outputPath);
  await writeFile(output, serialized, { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ output, source: candidate.source, parser: candidate.parser,
    pageCount: parsed.document.pages.length, assetCount: parsed.assets.length,
    candidateBytes: serialized.length, candidateSha256: createHash('sha256').update(serialized).digest('hex'),
    status: 'CANDIDATE_PACKAGED_NOT_PUBLISHED' }) + '\n');
}
main().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.message : 'MINERU_CANDIDATE_PACKAGING_FAILED') + '\n');
  process.exitCode = 1;
});
