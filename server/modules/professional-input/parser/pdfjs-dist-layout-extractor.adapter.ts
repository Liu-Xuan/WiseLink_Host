import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { ProfessionalInputPureError } from '../pure/professional-input-pure.error';
import type {
  ParsedPdfLayout,
  ParsedPdfPageBox,
  ParsedPdfTextRun,
} from '../pure/professional-input-pure.types';
import type { PdfLayoutExtractorPort } from './pdf-layout.extractor.port';

/**
 * Mature PDF layout extractor backed by the declared Mozilla pdfjs-dist
 * 4.10.38 dependency's legacy build. The port contract is synchronous, while pdfjs is
 * inherently async — the adapter bridges this by executing a standalone
 * runner child process (pdfjs-layout-extractor.runner.mjs). Source bytes
 * are handed over via a caller-private temp file (argv path), not stdin:
 * stdin pipes are unreliable under test-runner environments (EPIPE), and
 * the file path keeps the exact-bytes contract verifiable by the runner.
 *
 * Determinism: identical bytes produce an identical ParsedPdfLayout value.
 * The adapter adds only caller-derived fields (sourceSha256 over the exact
 * input bytes, sourceByteLength); the runner emits no clock or randomness.
 * Fail-closed: malformed/unsupported bytes throw ProfessionalInputPureError
 * with a stable code — never degraded or synthetic output.
 */
export class PdfjsDistLayoutExtractor implements PdfLayoutExtractorPort {
  readonly extractorId = 'pdfjs-dist-4.10.38-legacy-layout-extractor' as const;

  private readonly runnerPath: string;
  private readonly pdfjsEntrypoint: string;

  constructor(
    runnerPath?: string,
    pdfjsEntrypoint = resolvePdfjsEntrypoint(),
  ) {
    this.runnerPath =
      runnerPath ?? resolve(__dirname, 'pdfjs-layout-extractor.runner.mjs');
    this.pdfjsEntrypoint = pdfjsEntrypoint;
  }

  extractLayout(bytes: Uint8Array): ParsedPdfLayout {
    if (bytes.byteLength === 0) {
      throw new ProfessionalInputPureError(
        'PDFJS_LAYOUT_EMPTY_INPUT',
        'extractLayout received zero bytes.',
      );
    }
    const tempDir = mkdtempSync(join(tmpdir(), 'wiselink-pdfjs-layout-'));
    const sourcePath = join(tempDir, 'source.pdf');
    try {
      writeFileSync(
        sourcePath,
        Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      );
      const result = spawnSync(
        process.execPath,
        [this.runnerPath, sourcePath, this.pdfjsEntrypoint],
        {
          maxBuffer: 512 * 1024 * 1024,
          timeout: 120_000,
        },
      );
      if (result.error) {
        throw new ProfessionalInputPureError(
          'PDFJS_LAYOUT_RUNNER_SPAWN_FAILED',
          `Failed to execute pdfjs-dist runner: ${result.error.message}`,
        );
      }
      if (result.status === 3) {
        throw new ProfessionalInputPureError(
          'PDFJS_LAYOUT_PARSE_FAILED',
          result.stderr.toString('utf8').trim() ||
            'pdfjs-dist rejected the input bytes.',
        );
      }
      if (result.status !== 0 || result.stdout.length === 0) {
        throw new ProfessionalInputPureError(
          'PDFJS_LAYOUT_RUNNER_FAILED',
          `pdfjs-dist runner exited with status ${result.status ?? 'null'}: ${result.stderr
            .toString('utf8')
            .trim()
            .slice(0, 500)}`,
        );
      }
      const layout = parseRunnerPayload(result.stdout.toString('utf8'));
      return {
        kind: 'pdf',
        pdfVersion: layout.pdfVersion,
        pageCount: layout.pageCount,
        pageBoxes: layout.pageBoxes,
        metadata: layout.metadata,
        textRuns: layout.textRuns,
        sourceSha256: `sha256:${sourceSha256Hex(bytes)}`,
        sourceByteLength: bytes.byteLength,
      };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function resolvePdfjsEntrypoint(): string {
  const hostedRuntimeEntrypoint = resolve(
    __dirname,
    '../../../runtime-assets/professional-input/pdfjs-dist/legacy/build/pdf.mjs',
  );
  if (existsSync(hostedRuntimeEntrypoint)) {
    return hostedRuntimeEntrypoint;
  }
  return createRequire(__filename).resolve(
    'pdfjs-dist/legacy/build/pdf.mjs',
  );
}

/** SHA-256 hex over the exact input bytes. */
function sourceSha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface RunnerPayload {
  pdfVersion: unknown;
  pageCount: unknown;
  pageBoxes: unknown;
  metadata: unknown;
  textRuns: unknown;
}

const RUNNER_PAYLOAD_BEGIN = '<<<PDFJS-LAYOUT-JSON-BEGIN>>>';
const RUNNER_PAYLOAD_END = '<<<PDFJS-LAYOUT-JSON-END>>>';

function parseRunnerPayload(raw: string): {
  pdfVersion: string;
  pageCount: number;
  pageBoxes: readonly ParsedPdfPageBox[];
  metadata: { title: string | null };
  textRuns: readonly ParsedPdfTextRun[];
} {
  const beginIndex = raw.indexOf(RUNNER_PAYLOAD_BEGIN);
  const endIndex = raw.lastIndexOf(RUNNER_PAYLOAD_END);
  if (beginIndex < 0 || endIndex <= beginIndex) {
    throw new ProfessionalInputPureError(
      'PDFJS_LAYOUT_RUNNER_PAYLOAD_INVALID',
      'Runner stdout carried no sentinel-wrapped JSON payload.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      raw.slice(beginIndex + RUNNER_PAYLOAD_BEGIN.length, endIndex),
    );
  } catch {
    throw new ProfessionalInputPureError(
      'PDFJS_LAYOUT_RUNNER_PAYLOAD_INVALID',
      'Runner payload between sentinels was not valid JSON.',
    );
  }
  const value = parsed as RunnerPayload;
  if (
    typeof value.pdfVersion !== 'string' ||
    typeof value.pageCount !== 'number' ||
    !Number.isSafeInteger(value.pageCount) ||
    value.pageCount < 1 ||
    !Array.isArray(value.pageBoxes) ||
    !Array.isArray(value.textRuns) ||
    value.pageBoxes.length !== value.pageCount
  ) {
    throw new ProfessionalInputPureError(
      'PDFJS_LAYOUT_RUNNER_PAYLOAD_INVALID',
      'Runner payload failed structural validation.',
    );
  }
  const pageBoxes = value.pageBoxes.map(
    (box: Record<string, unknown>): ParsedPdfPageBox => ({
      page: Number(box.page),
      mediaBox: [
        Number(box.mediaBox?.[0]),
        Number(box.mediaBox?.[1]),
        Number(box.mediaBox?.[2]),
        Number(box.mediaBox?.[3]),
      ],
    }),
  );
  const metadataValue = value.metadata as { title?: unknown };
  const textRuns = value.textRuns.map(
    (run: Record<string, unknown>): ParsedPdfTextRun => ({
      page: Number(run.page),
      fontName: String(run.fontName),
      bold: Boolean(run.bold),
      fontSize: Number(run.fontSize),
      x: Number(run.x),
      y: Number(run.y),
      text: String(run.text),
    }),
  );
  return {
    pdfVersion: value.pdfVersion,
    pageCount: value.pageCount,
    pageBoxes,
    metadata: {
      title:
        typeof metadataValue?.title === 'string' &&
        metadataValue.title.length > 0
          ? metadataValue.title
          : null,
    },
    textRuns,
  };
}
