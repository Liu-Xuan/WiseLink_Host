import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TesseractTsvPdfOcrAdapter } from '../../../server/modules/professional-input/parser/tesseract-tsv-pdf-ocr.adapter';

describe('TesseractTsvPdfOcrAdapter runtime containment', () => {
  it('fails closed when an executable symlink resolves outside the runtime root', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'wl31-ocr-runtime-preflight-'));
    const runtimeRoot = join(fixture, 'runtime');
    const outsideExecutable = join(fixture, 'outside-pdftoppm');
    mkdirSync(join(runtimeRoot, 'bin'), { recursive: true });
    mkdirSync(join(runtimeRoot, 'share/tessdata'), { recursive: true });
    writeFileSync(outsideExecutable, '#!/bin/sh\nexit 0\n', 'utf8');
    chmodSync(outsideExecutable, 0o755);
    symlinkSync(outsideExecutable, join(runtimeRoot, 'bin/pdftoppm'));
    writeFileSync(join(runtimeRoot, 'bin/tesseract'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(runtimeRoot, 'bin/tesseract'), 0o755);
    writeFileSync(join(runtimeRoot, 'share/tessdata/eng.traineddata'), 'eng');
    writeFileSync(
      join(runtimeRoot, 'share/tessdata/chi_sim.traineddata'),
      'chi_sim',
    );
    writeFileSync(
      join(runtimeRoot, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 'wiselink.host-pdf-ocr-runtime.v1',
        renderer: { executable: 'bin/pdftoppm', version: '25.03.0' },
        engine: { executable: 'bin/tesseract', version: '5.5.0' },
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
        reasons: ['OCR_RUNTIME_REALPATH_OUTSIDE_ROOT'],
      });
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
