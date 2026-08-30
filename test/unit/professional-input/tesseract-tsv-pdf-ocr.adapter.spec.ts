import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { TesseractTsvPdfOcrAdapter } from '../../../server/modules/professional-input/parser/tesseract-tsv-pdf-ocr.adapter';

describe('TesseractTsvPdfOcrAdapter runtime containment', () => {
  it('fails closed when an executable symlink resolves outside the runtime root', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'wl31-ocr-runtime-preflight-'));
    const runtimeRoot = join(fixture, 'runtime');
    const outsideExecutable = join(fixture, 'outside-pdftoppm');
    mkdirSync(join(runtimeRoot, 'libexec'), { recursive: true });
    mkdirSync(join(runtimeRoot, 'share/tessdata'), { recursive: true });
    writeFileSync(outsideExecutable, '#!/bin/sh\nexit 0\n', 'utf8');
    chmodSync(outsideExecutable, 0o755);
    symlinkSync(outsideExecutable, join(runtimeRoot, 'libexec/pdftoppm'));
    writeFileSync(
      join(runtimeRoot, 'libexec/tesseract'),
      '#!/bin/sh\nexit 0\n',
    );
    chmodSync(join(runtimeRoot, 'libexec/tesseract'), 0o755);
    writeFileSync(join(runtimeRoot, 'share/tessdata/eng.traineddata'), 'eng');
    writeFileSync(
      join(runtimeRoot, 'share/tessdata/chi_sim.traineddata'),
      'chi_sim',
    );
    writeFileSync(
      join(runtimeRoot, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 'wiselink.host-pdf-ocr-runtime.v2',
        target: {
          platform: 'linux',
          arch: 'x64',
          libc: 'bundled-glibc',
        },
        renderer: { executable: 'libexec/pdftoppm', version: '25.03.0' },
        engine: { executable: 'libexec/tesseract', version: '5.5.0' },
        tessdata: {
          directory: 'share/tessdata',
          distribution: 'tessdata_fast',
          revision: '4.1.0',
          requiredLanguages: ['eng', 'chi_sim'],
        },
      }),
      'utf8',
    );

    try {
      expect(
        new TesseractTsvPdfOcrAdapter({ runtimeRoot }).preflight(),
      ).toMatchObject({
        status: 'UNAVAILABLE',
        missingLanguages: [],
        reasons: ['OCR_RUNTIME_REALPATH_OUTSIDE_ROOT'],
      });
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  const platformMismatchTest =
    process.platform === 'linux' && process.arch === 'x64' ? it.skip : it;

  platformMismatchTest(
    'classifies a target platform mismatch as provider failure, not missing language data',
    () => {
      const runtimeRoot = resolve(
        __dirname,
        '../../../server/runtime-assets/professional-input/ocr-runtime',
      );

      expect(
        new TesseractTsvPdfOcrAdapter({ runtimeRoot }).preflight(),
      ).toMatchObject({
        status: 'UNAVAILABLE',
        rendererVersion: null,
        engineVersion: null,
        installedLanguages: [],
        missingLanguages: [],
        reasons: ['OCR_RUNTIME_TARGET_PLATFORM_MISMATCH'],
      });
    },
  );
});
