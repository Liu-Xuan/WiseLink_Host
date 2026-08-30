import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import type {
  ParsedPdfLayout,
  ParsedPdfPageBox,
  ParsedPdfTextRun,
} from '../pure/professional-input-pure.types';
import type {
  PdfOcrConfidenceMetrics,
  PdfOcrRuntimePreflight,
  PdfOcrTarget,
  PdfOcrTargetFailure,
  PdfOcrTargetResult,
  TargetedPdfOcrProvider,
  TargetedPdfOcrResult,
} from './targeted-pdf-ocr.port';

const OCR_RUNTIME_SCHEMA = 'wiselink.host-pdf-ocr-runtime.v1' as const;
const OCR_PROVIDER_ID =
  'host-owned-pdftoppm-25.03.0-tesseract-5.5.0-tsv' as const;
const DEFAULT_DPI = 300;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_COMMAND_BUFFER = 512 * 1024 * 1024;
const MAX_QUOTE_SCALARS = 512;
const LOW_CONFIDENCE_WORD_THRESHOLD = 60;
const MIN_CHARACTER_WEIGHTED_CONFIDENCE = 70;
const MAX_LOW_CONFIDENCE_WORD_RATIO = 0.2;
const REQUIRED_OCR_LANGUAGES = ['eng', 'chi_sim'] as const;
const TESSERACT_LANGUAGE_FAILURE =
  /Failed loading language|Error opening data file|Could not initialize tesseract/iu;
const TSV_HEADER =
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';

interface OcrRuntimeManifest {
  schemaVersion: typeof OCR_RUNTIME_SCHEMA;
  renderer: {
    executable: string;
    version: '25.03.0';
  };
  engine: {
    executable: string;
    version: '5.5.0';
  };
  tessdata: {
    directory: string;
    distribution: 'tessdata_fast';
    revision: '4.1.0';
    requiredLanguages: readonly ['eng', 'chi_sim'];
  };
}

interface OcrRuntimePaths {
  manifest: OcrRuntimeManifest;
  rendererExecutable: string;
  engineExecutable: string;
  tessdataDirectory: string;
}

export interface TesseractTsvPdfOcrOptions {
  runtimeRoot?: string;
  dpi?: number;
  timeoutMs?: number;
}

interface PageGeometry {
  pageBox: ParsedPdfPageBox;
  viewportWidthPixels: number;
  viewportHeightPixels: number;
  viewportTransformPixels: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
}

interface RenderCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  fullPage: boolean;
}

interface TsvWord {
  block: number;
  paragraph: number;
  line: number;
  word: number;
  rowSequence: number;
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number;
  text: string;
  pdfUserSpaceBbox: readonly [number, number, number, number];
  normalizedBbox: readonly [number, number, number, number];
}

type ProviderFailureReason = PdfOcrTargetFailure['reason'];

class ProviderFailure extends Error {
  constructor(
    readonly reason: ProviderFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderFailure';
  }
}

/**
 * Deployment-bound OCR implementation. It is private to the composite
 * PdfLayoutExtractorPort and emits no package/store/Reader contract.
 */
export class TesseractTsvPdfOcrAdapter implements TargetedPdfOcrProvider {
  readonly providerId = OCR_PROVIDER_ID;

  private readonly runtimeRoot: string;
  private readonly dpi: number;
  private readonly timeoutMs: number;

  constructor(options: TesseractTsvPdfOcrOptions = {}) {
    this.runtimeRoot =
      options.runtimeRoot ??
      resolve(
        __dirname,
        '../../../runtime-assets/professional-input/ocr-runtime',
      );
    this.dpi = options.dpi ?? DEFAULT_DPI;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  preflight(): PdfOcrRuntimePreflight {
    const reasons: string[] = [];
    let runtime: OcrRuntimePaths | null = null;
    try {
      runtime = this.resolveRuntimePaths();
    } catch (error) {
      reasons.push(compactDiagnostic(error));
    }
    if (!runtime) {
      return unavailablePreflight(reasons);
    }

    const renderer = runCommand(
      runtime.rendererExecutable,
      ['-v'],
      this.timeoutMs,
    );
    const rendererOutput = `${renderer.stderr}\n${renderer.stdout}`;
    const rendererVersion = extractVersion(
      rendererOutput,
      /pdftoppm version\s+([0-9.]+)/iu,
    );
    if (renderer.status !== 0 || rendererVersion !== '25.03.0') {
      reasons.push('PDFTOPPM_VERSION_MISMATCH');
    }

    const engine = runCommand(
      runtime.engineExecutable,
      ['--version'],
      this.timeoutMs,
    );
    const engineVersion = extractVersion(
      `${engine.stdout}\n${engine.stderr}`,
      /tesseract\s+([0-9.]+)/iu,
    );
    if (engine.status !== 0 || engineVersion !== '5.5.0') {
      reasons.push('TESSERACT_VERSION_MISMATCH');
    }

    const languages = runCommand(
      runtime.engineExecutable,
      ['--tessdata-dir', runtime.tessdataDirectory, '--list-langs'],
      this.timeoutMs,
    );
    const installedLanguages = parseLanguages(languages.stdout);
    if (languages.status !== 0) reasons.push('TESSERACT_LANG_LIST_FAILED');
    let missingLanguages = runtime.manifest.tessdata.requiredLanguages.filter(
      (language: string) =>
        !installedLanguages.includes(language) ||
        !existsSync(join(runtime.tessdataDirectory, `${language}.traineddata`)),
    );
    if (missingLanguages.length > 0) {
      reasons.push('OCR_LANGUAGE_ASSET_MISSING');
    } else {
      // --list-langs only enumerates filenames. Corrupt language files can
      // therefore look installed, and an ordinary OCR invocation can even
      // exit 0 after dropping one requested language. Force a real bilingual
      // engine initialization against a deterministic in-memory raster.
      const languageProbe = runCommand(
        runtime.engineExecutable,
        [
          'stdin',
          'stdout',
          '--tessdata-dir',
          runtime.tessdataDirectory,
          '-l',
          REQUIRED_OCR_LANGUAGES.join('+'),
          '--psm',
          '6',
          '--dpi',
          String(DEFAULT_DPI),
          '-c',
          'tessedit_create_tsv=1',
        ],
        this.timeoutMs,
        blankPgmProbe(),
      );
      if (
        languageProbe.status !== 0 ||
        TESSERACT_LANGUAGE_FAILURE.test(languageProbe.stderr) ||
        !languageProbe.stdout.startsWith(TSV_HEADER)
      ) {
        reasons.push('OCR_LANGUAGE_INITIALIZATION_FAILED');
        missingLanguages = [...REQUIRED_OCR_LANGUAGES];
      }
    }

    return {
      status: reasons.length === 0 ? 'READY' : 'UNAVAILABLE',
      providerId: this.providerId,
      rendererVersion,
      engineVersion,
      tessdataRevision:
        `${runtime.manifest.tessdata.distribution}-` +
        runtime.manifest.tessdata.revision,
      installedLanguages,
      missingLanguages,
      reasons,
    };
  }

  recognize(input: {
    bytes: Uint8Array;
    layout: ParsedPdfLayout;
    targets: readonly PdfOcrTarget[];
  }): TargetedPdfOcrResult {
    const preflight = this.preflight();
    const sourceSha256 = `sha256:${createHash('sha256')
      .update(input.bytes)
      .digest('hex')}`;
    if (
      sourceSha256 !== input.layout.sourceSha256 ||
      input.bytes.byteLength !== input.layout.sourceByteLength
    ) {
      return failureResult(
        input,
        this.providerId,
        'OCR_TARGET_RESULT_INCOMPLETE',
        'OCR_SOURCE_IDENTITY_MISMATCH',
      );
    }
    if (preflight.status !== 'READY') {
      return {
        sourceSha256,
        sourceByteLength: input.bytes.byteLength,
        pageCount: input.layout.pageCount,
        providerId: this.providerId,
        targets: input.targets.map(
          (target: PdfOcrTarget): PdfOcrTargetFailure => ({
            targetId: target.targetId,
            page: target.page,
            status: 'FAILED',
            reason: preflight.missingLanguages.length
              ? 'OCR_LANGUAGE_ASSET_MISSING'
              : 'OCR_PROVIDER_FAILED',
            diagnostic: preflight.reasons.join(','),
            ...(preflight.missingLanguages.length
              ? { missingLanguages: preflight.missingLanguages }
              : {}),
          }),
        ),
      };
    }

    let runtime: OcrRuntimePaths;
    try {
      runtime = this.resolveRuntimePaths();
    } catch (error) {
      return failureResult(
        input,
        this.providerId,
        'OCR_PROVIDER_FAILED',
        compactDiagnostic(error),
      );
    }

    const tempDirectory = mkdtempSync(join(tmpdir(), 'wiselink-pdf-ocr-'));
    const sourcePath = join(tempDirectory, 'source.pdf');
    try {
      writeFileSync(
        sourcePath,
        Buffer.from(
          input.bytes.buffer,
          input.bytes.byteOffset,
          input.bytes.byteLength,
        ),
      );
      const results: PdfOcrTargetResult[] = input.targets.map(
        (target: PdfOcrTarget): PdfOcrTargetResult => {
          try {
            return this.recognizeTarget(
              sourcePath,
              input.layout,
              target,
              runtime,
              tempDirectory,
            );
          } catch (error) {
            const failure =
              error instanceof ProviderFailure
                ? error
                : new ProviderFailure(
                    'OCR_PROVIDER_FAILED',
                    compactDiagnostic(error),
                  );
            return {
              targetId: target.targetId,
              page: target.page,
              status: 'FAILED',
              reason: failure.reason,
              diagnostic: compactDiagnostic(failure),
            };
          }
        },
      );
      return {
        sourceSha256,
        sourceByteLength: input.bytes.byteLength,
        pageCount: input.layout.pageCount,
        providerId: this.providerId,
        targets: results,
      };
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  }

  private recognizeTarget(
    sourcePath: string,
    layout: ParsedPdfLayout,
    target: PdfOcrTarget,
    runtime: OcrRuntimePaths,
    tempDirectory: string,
  ): PdfOcrTargetResult {
    validateTarget(layout, target);
    const geometry = pageGeometry(layout, target.page, this.dpi);
    const displayBounds = pdfBboxToDisplayBbox(
      target.pdfUserSpaceBbox,
      geometry.viewportTransformPixels,
    );
    const padding = target.scope === 'FULL_PAGE' ? 0 : (4 * this.dpi) / 72;
    const crop = displayBboxToCrop(
      displayBounds,
      geometry.viewportWidthPixels,
      geometry.viewportHeightPixels,
      padding,
    );
    const targetDirectory = join(
      tempDirectory,
      target.targetId.replace(/[^a-zA-Z0-9_-]+/gu, '_'),
    );
    const outputPrefix = join(targetDirectory, 'ocr-input');
    ensureParentDirectory(outputPrefix);
    const renderArguments: string[] = [
      '-f',
      String(target.page),
      '-l',
      String(target.page),
      '-singlefile',
      '-r',
      String(this.dpi),
      '-gray',
      '-cropbox',
    ];
    if (!crop.fullPage) {
      renderArguments.push(
        '-x',
        String(crop.x),
        '-y',
        String(crop.y),
        '-W',
        String(crop.width),
        '-H',
        String(crop.height),
      );
    }
    renderArguments.push(sourcePath, outputPrefix);
    const render = runCommand(
      runtime.rendererExecutable,
      renderArguments,
      this.timeoutMs,
    );
    if (render.timedOut) {
      throw new ProviderFailure('OCR_PROVIDER_TIMEOUT', 'PDFTOPPM_TIMEOUT');
    }
    if (render.status !== 0) {
      throw new ProviderFailure(
        'OCR_PROVIDER_FAILED',
        `PDFTOPPM_FAILED:${compactText(render.stderr || render.stdout)}`,
      );
    }
    const imagePath = `${outputPrefix}.pgm`;
    const image = parsePgmHeader(imagePath);
    const expectedWidth = crop.fullPage
      ? Math.round(geometry.viewportWidthPixels)
      : crop.width;
    const expectedHeight = crop.fullPage
      ? Math.round(geometry.viewportHeightPixels)
      : crop.height;
    if (
      Math.abs(image.width - expectedWidth) > 1 ||
      Math.abs(image.height - expectedHeight) > 1
    ) {
      throw new ProviderFailure(
        'OCR_RASTER_GEOMETRY_MISMATCH',
        `OCR_RASTER_GEOMETRY_MISMATCH:${image.width}x${image.height}:${expectedWidth}x${expectedHeight}`,
      );
    }

    const language = target.requiredLanguages.join('+');
    // Sparse-text segmentation preserves independent cells in scanned
    // landscape forms (for example certificate and eligibility fields).
    // Portrait full pages and diagnostics-selected regions keep the uniform
    // text-block strategy used by the accepted procedure regressions.
    const pageSegmentationMode =
      target.scope === 'FULL_PAGE' &&
      geometry.viewportWidthPixels > geometry.viewportHeightPixels
        ? '11'
        : '6';
    const tesseract = runCommand(
      runtime.engineExecutable,
      [
        imagePath,
        'stdout',
        '--tessdata-dir',
        runtime.tessdataDirectory,
        '-l',
        language,
        '--psm',
        pageSegmentationMode,
        '--dpi',
        String(this.dpi),
        '-c',
        'tessedit_create_tsv=1',
      ],
      this.timeoutMs,
    );
    if (tesseract.timedOut) {
      throw new ProviderFailure('OCR_PROVIDER_TIMEOUT', 'TESSERACT_TIMEOUT');
    }
    if (TESSERACT_LANGUAGE_FAILURE.test(tesseract.stderr)) {
      throw new ProviderFailure(
        'OCR_LANGUAGE_ASSET_MISSING',
        `TESSERACT_LANGUAGE_FAILURE:${compactText(tesseract.stderr)}`,
      );
    }
    if (tesseract.status !== 0) {
      throw new ProviderFailure(
        'OCR_PROVIDER_FAILED',
        `TESSERACT_FAILED:${compactText(tesseract.stderr || tesseract.stdout)}`,
      );
    }

    const parsedWords = parseTsvWords(tesseract.stdout, image);
    const words = parsedWords.map(
      (word: Omit<TsvWord, 'pdfUserSpaceBbox' | 'normalizedBbox'>): TsvWord =>
        mapWordCoordinates(word, crop, image, geometry),
    );
    const lines = buildOcrLines(words, target.page);
    if (lines.length === 0) {
      throw new ProviderFailure(
        'OCR_EMPTY_REQUIRED_REGION',
        'OCR_EMPTY_REQUIRED_REGION',
      );
    }
    const confidence = confidenceMetrics(words);
    if (
      confidence.characterWeightedMean < MIN_CHARACTER_WEIGHTED_CONFIDENCE ||
      confidence.wordsBelow60Ratio > MAX_LOW_CONFIDENCE_WORD_RATIO
    ) {
      throw new ProviderFailure(
        'OCR_LOW_CONFIDENCE',
        `OCR_LOW_CONFIDENCE:mean=${confidence.characterWeightedMean};below60Ratio=${confidence.wordsBelow60Ratio}`,
      );
    }
    return {
      targetId: target.targetId,
      page: target.page,
      status: 'EXTRACTED',
      lines,
      confidence,
    };
  }

  private resolveRuntimePaths(): OcrRuntimePaths {
    let runtimeRootReal: string;
    try {
      runtimeRootReal = realpathSync(this.runtimeRoot);
    } catch {
      throw new Error('OCR_RUNTIME_ROOT_MISSING');
    }
    const manifestPath = safeRuntimePath(
      runtimeRootReal,
      'manifest.json',
      'OCR_RUNTIME_MANIFEST_MISSING',
    );
    if (!existsSync(manifestPath)) {
      throw new Error('OCR_RUNTIME_MANIFEST_MISSING');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      throw new Error('OCR_RUNTIME_MANIFEST_INVALID');
    }
    const manifest = validateManifest(parsed);
    const rendererExecutable = safeRuntimePath(
      runtimeRootReal,
      manifest.renderer.executable,
      'PDFTOPPM_EXECUTABLE_MISSING',
    );
    const engineExecutable = safeRuntimePath(
      runtimeRootReal,
      manifest.engine.executable,
      'TESSERACT_EXECUTABLE_MISSING',
    );
    const tessdataDirectory = safeRuntimePath(
      runtimeRootReal,
      manifest.tessdata.directory,
      'TESSDATA_DIRECTORY_MISSING',
    );
    assertExecutable(rendererExecutable, 'PDFTOPPM_EXECUTABLE_MISSING');
    assertExecutable(engineExecutable, 'TESSERACT_EXECUTABLE_MISSING');
    if (!existsSync(tessdataDirectory)) {
      throw new Error('TESSDATA_DIRECTORY_MISSING');
    }
    for (const language of manifest.tessdata.requiredLanguages) {
      const languagePath = resolve(
        tessdataDirectory,
        `${language}.traineddata`,
      );
      if (existsSync(languagePath)) {
        assertRuntimeRealpathContained(runtimeRootReal, languagePath);
      }
    }
    return {
      manifest,
      rendererExecutable,
      engineExecutable,
      tessdataDirectory,
    };
  }
}

function validateManifest(value: unknown): OcrRuntimeManifest {
  const manifest = value as Partial<OcrRuntimeManifest>;
  const languages = manifest.tessdata?.requiredLanguages;
  if (
    manifest.schemaVersion !== OCR_RUNTIME_SCHEMA ||
    manifest.renderer?.version !== '25.03.0' ||
    typeof manifest.renderer.executable !== 'string' ||
    manifest.engine?.version !== '5.5.0' ||
    typeof manifest.engine.executable !== 'string' ||
    manifest.tessdata?.distribution !== 'tessdata_fast' ||
    manifest.tessdata.revision !== '4.1.0' ||
    typeof manifest.tessdata.directory !== 'string' ||
    !Array.isArray(languages) ||
    languages.length !== 2 ||
    languages[0] !== 'eng' ||
    languages[1] !== 'chi_sim'
  ) {
    throw new Error('OCR_RUNTIME_MANIFEST_CONTRACT_MISMATCH');
  }
  return manifest as OcrRuntimeManifest;
}

function safeRuntimePath(
  root: string,
  child: string,
  missingReason: string,
): string {
  const resolvedRoot = resolve(root);
  const resolvedChild = resolve(resolvedRoot, child);
  const childRelative = relative(resolvedRoot, resolvedChild);
  if (
    childRelative.length === 0 ||
    childRelative.startsWith('..') ||
    resolve(resolvedRoot, childRelative) !== resolvedChild
  ) {
    throw new Error('OCR_RUNTIME_PATH_INVALID');
  }
  try {
    return assertRuntimeRealpathContained(resolvedRoot, resolvedChild);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'OCR_RUNTIME_REALPATH_OUTSIDE_ROOT'
    ) {
      throw error;
    }
    throw new Error(missingReason);
  }
}

function assertRuntimeRealpathContained(root: string, child: string): string {
  const rootReal = realpathSync(root);
  const childReal = realpathSync(child);
  const childRelative = relative(rootReal, childReal);
  if (
    childRelative === '..' ||
    childRelative.startsWith(`..${sep}`) ||
    resolve(rootReal, childRelative) !== childReal
  ) {
    throw new Error('OCR_RUNTIME_REALPATH_OUTSIDE_ROOT');
  }
  return childReal;
}

function assertExecutable(path: string, reason: string): void {
  try {
    accessSync(path, fsConstants.X_OK);
  } catch {
    throw new Error(reason);
  }
}

function unavailablePreflight(
  reasons: readonly string[],
): PdfOcrRuntimePreflight {
  return {
    status: 'UNAVAILABLE',
    providerId: OCR_PROVIDER_ID,
    rendererVersion: null,
    engineVersion: null,
    tessdataRevision: null,
    installedLanguages: [],
    missingLanguages: REQUIRED_OCR_LANGUAGES,
    reasons,
  };
}

function failureResult(
  input: {
    bytes: Uint8Array;
    layout: ParsedPdfLayout;
    targets: readonly PdfOcrTarget[];
  },
  providerId: string,
  reason: ProviderFailureReason,
  diagnostic: string,
): TargetedPdfOcrResult {
  return {
    sourceSha256: `sha256:${createHash('sha256')
      .update(input.bytes)
      .digest('hex')}`,
    sourceByteLength: input.bytes.byteLength,
    pageCount: input.layout.pageCount,
    providerId,
    targets: input.targets.map(
      (target: PdfOcrTarget): PdfOcrTargetFailure => ({
        targetId: target.targetId,
        page: target.page,
        status: 'FAILED',
        reason,
        diagnostic,
      }),
    ),
  };
}

function validateTarget(layout: ParsedPdfLayout, target: PdfOcrTarget): void {
  const pageBox = layout.pageBoxes.find(
    (candidate: ParsedPdfPageBox) => candidate.page === target.page,
  );
  if (
    !pageBox ||
    !Number.isSafeInteger(target.page) ||
    target.page < 1 ||
    target.page > layout.pageCount ||
    target.requiredLanguages.length === 0 ||
    !target.requiredLanguages.every(
      (language: string) => language === 'eng' || language === 'chi_sim',
    ) ||
    !validBbox(target.pdfUserSpaceBbox)
  ) {
    throw new ProviderFailure(
      'OCR_TARGET_RESULT_INCOMPLETE',
      'OCR_TARGET_INVALID',
    );
  }
}

function pageGeometry(
  layout: ParsedPdfLayout,
  page: number,
  dpi: number,
): PageGeometry {
  const pageBox = layout.pageBoxes.find(
    (candidate: ParsedPdfPageBox) => candidate.page === page,
  );
  if (!pageBox?.viewport) {
    throw new ProviderFailure(
      'OCR_RASTER_GEOMETRY_MISMATCH',
      'OCR_PAGE_VIEWPORT_MISSING',
    );
  }
  const scale = dpi / 72;
  const transform = pageBox.viewport.transform.map(
    (value: number): number => value * scale,
  );
  return {
    pageBox,
    viewportWidthPixels: pageBox.viewport.width * scale,
    viewportHeightPixels: pageBox.viewport.height * scale,
    viewportTransformPixels: [
      transform[0],
      transform[1],
      transform[2],
      transform[3],
      transform[4],
      transform[5],
    ],
  };
}

function displayBboxToCrop(
  bbox: readonly [number, number, number, number],
  viewportWidth: number,
  viewportHeight: number,
  padding: number,
): RenderCrop {
  const x = Math.max(0, Math.floor(bbox[0] - padding));
  const y = Math.max(0, Math.floor(bbox[1] - padding));
  const right = Math.min(
    Math.ceil(viewportWidth),
    Math.ceil(bbox[2] + padding),
  );
  const bottom = Math.min(
    Math.ceil(viewportHeight),
    Math.ceil(bbox[3] + padding),
  );
  if (!(right > x) || !(bottom > y)) {
    throw new ProviderFailure(
      'OCR_RASTER_GEOMETRY_MISMATCH',
      'OCR_RENDER_CROP_EMPTY',
    );
  }
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    fullPage:
      x === 0 &&
      y === 0 &&
      right === Math.ceil(viewportWidth) &&
      bottom === Math.ceil(viewportHeight),
  };
}

function ensureParentDirectory(path: string): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true });
}

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runCommand(
  command: string,
  args: readonly string[],
  timeoutMs: number,
  input?: Uint8Array,
): CommandResult {
  const result = spawnSync(command, [...args], {
    encoding: 'utf8',
    ...(input ? { input } : {}),
    maxBuffer: MAX_COMMAND_BUFFER,
    timeout: timeoutMs,
  });
  const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
    timedOut: errorCode === 'ETIMEDOUT',
  };
}

function blankPgmProbe(): Uint8Array {
  return Buffer.concat([
    Buffer.from('P5\n32 32\n255\n', 'ascii'),
    Buffer.alloc(32 * 32, 255),
  ]);
}

function parsePgmHeader(path: string): { width: number; height: number } {
  if (!existsSync(path)) {
    throw new ProviderFailure('OCR_PROVIDER_FAILED', 'OCR_PGM_MISSING');
  }
  const bytes = readFileSync(path);
  const head = bytes
    .subarray(0, Math.min(bytes.length, 4096))
    .toString('latin1');
  const tokens = head
    .replace(/#[^\r\n]*/gu, ' ')
    .trim()
    .split(/\s+/u);
  const width = Number(tokens[1]);
  const height = Number(tokens[2]);
  if (
    (tokens[0] !== 'P5' && tokens[0] !== 'P2') ||
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    !Number.isSafeInteger(height) ||
    height <= 0
  ) {
    throw new ProviderFailure('OCR_PROVIDER_FAILED', 'OCR_PGM_HEADER_INVALID');
  }
  return { width, height };
}

function parseTsvWords(
  tsv: string,
  image: { width: number; height: number },
): Array<Omit<TsvWord, 'pdfUserSpaceBbox' | 'normalizedBbox'>> {
  const rows = tsv.split(/\r?\n/u);
  if (rows[0] !== TSV_HEADER) {
    throw new ProviderFailure('OCR_TSV_MALFORMED', 'OCR_TSV_HEADER_INVALID');
  }
  const words: Array<Omit<TsvWord, 'pdfUserSpaceBbox' | 'normalizedBbox'>> = [];
  rows.slice(1).forEach((row: string, rowIndex: number): void => {
    if (!row) return;
    const columns = row.split('\t');
    if (columns.length < 12 || Number(columns[0]) !== 5) return;
    const text = columns.slice(11).join('\t').trim();
    if (!text) return;
    const numeric = columns.slice(1, 11).map(Number);
    const [page, block, paragraph, line, word, left, top, width, height, conf] =
      numeric;
    if (
      !numeric.every(Number.isFinite) ||
      ![page, block, paragraph, line, word, left, top, width, height].every(
        Number.isSafeInteger,
      ) ||
      page !== 1 ||
      block < 0 ||
      paragraph < 0 ||
      line < 0 ||
      word < 0 ||
      left < 0 ||
      top < 0 ||
      width <= 0 ||
      height <= 0 ||
      left + width > image.width ||
      top + height > image.height ||
      conf < 0 ||
      conf > 100
    ) {
      throw new ProviderFailure('OCR_TSV_MALFORMED', 'OCR_TSV_WORD_INVALID');
    }
    words.push({
      block,
      paragraph,
      line,
      word,
      rowSequence: rowIndex + 1,
      left,
      top,
      width,
      height,
      confidence: round6(conf),
      text,
    });
  });
  return words;
}

function mapWordCoordinates(
  word: Omit<TsvWord, 'pdfUserSpaceBbox' | 'normalizedBbox'>,
  crop: RenderCrop,
  image: { width: number; height: number },
  geometry: PageGeometry,
): TsvWord {
  const xScale = crop.width / image.width;
  const yScale = crop.height / image.height;
  const displayBbox: readonly [number, number, number, number] = [
    crop.x + word.left * xScale,
    crop.y + word.top * yScale,
    crop.x + (word.left + word.width) * xScale,
    crop.y + (word.top + word.height) * yScale,
  ];
  const pdfUserSpaceBbox = displayBboxToPdfBbox(
    displayBbox,
    geometry.viewportTransformPixels,
  ).map(round6) as [number, number, number, number];
  const normalizedBbox = normalizeDisplayBbox(
    displayBbox,
    geometry.viewportWidthPixels,
    geometry.viewportHeightPixels,
  );
  return { ...word, pdfUserSpaceBbox, normalizedBbox };
}

function buildOcrLines(
  words: readonly TsvWord[],
  page: number,
): ParsedPdfTextRun[] {
  const groups = new Map<string, TsvWord[]>();
  for (const word of words) {
    const key = `${word.block}:${word.paragraph}:${word.line}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(word);
    groups.set(key, bucket);
  }
  const lines: ParsedPdfTextRun[] = [];
  for (const lineWords of groups.values()) {
    lineWords.sort(
      (left: TsvWord, right: TsvWord): number =>
        left.rowSequence - right.rowSequence || left.word - right.word,
    );
    const chunks = chunkWords(lineWords);
    for (const chunk of chunks) {
      const text = joinOcrWords(chunk);
      const pdfUserSpaceBbox = unionBboxes(
        chunk.map((word: TsvWord) => word.pdfUserSpaceBbox),
      );
      const normalizedBbox = unionBboxes(
        chunk.map((word: TsvWord) => word.normalizedBbox),
      ).map(Math.round) as [number, number, number, number];
      const confidence = weightedConfidence(chunk);
      lines.push({
        page,
        fontName: 'OCR_TESSERACT_TSV',
        bold: false,
        fontSize: Math.max(
          1,
          Math.abs(pdfUserSpaceBbox[3] - pdfUserSpaceBbox[1]),
        ),
        x: pdfUserSpaceBbox[0],
        y: pdfUserSpaceBbox[1],
        text,
        origin: 'ocr_tesseract_tsv',
        readingOrder: lines.length,
        pdfUserSpaceBbox,
        normalizedBbox,
        confidence,
      });
    }
  }
  return lines;
}

function chunkWords(words: readonly TsvWord[]): TsvWord[][] {
  const chunks: TsvWord[][] = [];
  let current: TsvWord[] = [];
  for (const word of words) {
    const candidate = [...current, word];
    if ([...joinOcrWords(candidate)].length <= MAX_QUOTE_SCALARS) {
      current = candidate;
      continue;
    }
    if (current.length === 0 || [...word.text].length > MAX_QUOTE_SCALARS) {
      throw new ProviderFailure(
        'OCR_TSV_MALFORMED',
        'OCR_WORD_EXCEEDS_BOUNDED_QUOTE',
      );
    }
    chunks.push(current);
    current = [word];
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function joinOcrWords(words: readonly TsvWord[]): string {
  let output = '';
  for (const word of words) {
    if (!output) {
      output = word.text;
      continue;
    }
    output += `${ocrSeparator(output, word.text)}${word.text}`;
  }
  return output.trim();
}

function ocrSeparator(left: string, right: string): string {
  const leftCharacter = [...left].at(-1) ?? '';
  const rightCharacter = [...right][0] ?? '';
  if (
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
      leftCharacter,
    ) &&
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
      rightCharacter,
    )
  ) {
    return '';
  }
  if (/^[,.;:!?，。；：！？、）》】]/u.test(rightCharacter)) return '';
  if (/[（《【]$/u.test(leftCharacter)) return '';
  return ' ';
}

function confidenceMetrics(words: readonly TsvWord[]): PdfOcrConfidenceMetrics {
  if (words.length === 0) {
    return {
      characterWeightedMean: 0,
      wordsBelow60Ratio: 1,
      wordCount: 0,
    };
  }
  const weights = words.map((word: TsvWord): number =>
    Math.max(1, [...word.text].length),
  );
  const totalWeight = weights.reduce(
    (sum: number, value: number): number => sum + value,
    0,
  );
  const weighted = words.reduce(
    (sum: number, word: TsvWord, index: number): number =>
      sum + word.confidence * weights[index],
    0,
  );
  return {
    characterWeightedMean: round6(weighted / totalWeight),
    wordsBelow60Ratio: round6(
      words.filter(
        (word: TsvWord) => word.confidence < LOW_CONFIDENCE_WORD_THRESHOLD,
      ).length / words.length,
    ),
    wordCount: words.length,
  };
}

function weightedConfidence(words: readonly TsvWord[]): number {
  return confidenceMetrics(words).characterWeightedMean;
}

function pdfBboxToDisplayBbox(
  bbox: readonly [number, number, number, number],
  transform: readonly [number, number, number, number, number, number],
): [number, number, number, number] {
  return bboxFromPoints([
    applyTransform([bbox[0], bbox[1]], transform),
    applyTransform([bbox[2], bbox[1]], transform),
    applyTransform([bbox[0], bbox[3]], transform),
    applyTransform([bbox[2], bbox[3]], transform),
  ]);
}

function displayBboxToPdfBbox(
  bbox: readonly [number, number, number, number],
  transform: readonly [number, number, number, number, number, number],
): [number, number, number, number] {
  return bboxFromPoints([
    applyInverseTransform([bbox[0], bbox[1]], transform),
    applyInverseTransform([bbox[2], bbox[1]], transform),
    applyInverseTransform([bbox[0], bbox[3]], transform),
    applyInverseTransform([bbox[2], bbox[3]], transform),
  ]);
}

function applyTransform(
  point: readonly [number, number],
  matrix: readonly [number, number, number, number, number, number],
): [number, number] {
  return [
    point[0] * matrix[0] + point[1] * matrix[2] + matrix[4],
    point[0] * matrix[1] + point[1] * matrix[3] + matrix[5],
  ];
}

function applyInverseTransform(
  point: readonly [number, number],
  matrix: readonly [number, number, number, number, number, number],
): [number, number] {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (Math.abs(determinant) < 1e-12) {
    throw new ProviderFailure(
      'OCR_RASTER_GEOMETRY_MISMATCH',
      'PDF_VIEWPORT_TRANSFORM_NOT_INVERTIBLE',
    );
  }
  const u = point[0] - matrix[4];
  const v = point[1] - matrix[5];
  return [
    (matrix[3] * u - matrix[2] * v) / determinant,
    (-matrix[1] * u + matrix[0] * v) / determinant,
  ];
}

function bboxFromPoints(
  points: readonly (readonly [number, number])[],
): [number, number, number, number] {
  return [
    Math.min(...points.map((point) => point[0])),
    Math.min(...points.map((point) => point[1])),
    Math.max(...points.map((point) => point[0])),
    Math.max(...points.map((point) => point[1])),
  ];
}

function unionBboxes(
  bboxes: readonly (readonly [number, number, number, number])[],
): [number, number, number, number] {
  return [
    Math.min(...bboxes.map((bbox) => bbox[0])),
    Math.min(...bboxes.map((bbox) => bbox[1])),
    Math.max(...bboxes.map((bbox) => bbox[2])),
    Math.max(...bboxes.map((bbox) => bbox[3])),
  ];
}

function normalizeDisplayBbox(
  bbox: readonly [number, number, number, number],
  width: number,
  height: number,
): [number, number, number, number] {
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  const left = Math.round(clamp(bbox[0] / width) * 1_000_000);
  const top = Math.round(clamp(bbox[1] / height) * 1_000_000);
  const right = Math.round(clamp(bbox[2] / width) * 1_000_000);
  const bottom = Math.round(clamp(bbox[3] / height) * 1_000_000);
  return [
    Math.min(left, 999_999),
    Math.min(top, 999_999),
    Math.max(right, left + 1),
    Math.max(bottom, top + 1),
  ];
}

function validBbox(bbox: readonly [number, number, number, number]): boolean {
  return (
    bbox.length === 4 &&
    bbox.every(Number.isFinite) &&
    bbox[2] > bbox[0] &&
    bbox[3] > bbox[1]
  );
}

function parseLanguages(output: string): string[] {
  return output
    .split(/\r?\n/u)
    .map((line: string): string => line.trim())
    .filter(
      (line: string): boolean =>
        Boolean(line) && !line.startsWith('List of available languages'),
    )
    .sort();
}

function extractVersion(value: string, pattern: RegExp): string | null {
  return value.match(pattern)?.[1] ?? null;
}

function compactDiagnostic(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return compactText(value);
}

function compactText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, 500);
}

function round6(value: number): number {
  return Number(value.toFixed(6));
}
