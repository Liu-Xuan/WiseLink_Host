import { extractActualPdfMetadata } from '../../server/modules/document-management/src/migrated/ingress/pdfDocumentMetadata.js';
import type { ParsedPdfLayout } from '../../server/modules/professional-input/pure/professional-input-pure.types';

function layout(pages: string[][]): ParsedPdfLayout {
  return {
    kind: 'pdf',
    pdfVersion: '1.7',
    pageCount: pages.length,
    pageBoxes: [],
    metadata: { title: 'Filename-like metadata must not become source title' },
    pageTextLayerDiagnostics: [],
    sourceSha256: `sha256:${'a'.repeat(64)}`,
    sourceByteLength: 200,
    textRuns: pages.flatMap((lines, index) =>
      lines.map((text, line) => ({
        page: index + 1,
        text,
        x: 0,
        y: 800 - line * 20,
        fontName: 'F1',
        fontSize: 12,
        bold: false,
      })),
    ),
  };
}
function extract(pages: string[][]) {
  return extractActualPdfMetadata({
    layout: layout(pages),
    actualSha256: 'a'.repeat(64),
    actualByteLength: 200,
    identity: { documentFamily: 'SB', issuer: 'BOEING' },
    extractedAt: '2026-09-09T00:00:00.000Z',
  });
}

describe('actual PDF descriptive metadata', () => {
  it('captures title, type, issuer and explicit ATA with source pages, including late model mentions', () => {
    const metadata = extract([
      [
        'BOEING SERVICE BULLETIN 737-31-21003',
        'Subject: Display unit wiring',
        'ATA Chapter: 31-20',
      ],
      ['Unrelated engineering text'],
      [],
      ['A320neo is mentioned as a comparison; Boeing 737 MAX 8 is discussed.'],
    ]);
    expect(metadata.title.observations[0]).toEqual({
      value: 'Display unit wiring',
      status: 'PENDING_REVIEW',
      evidence: [{ page: 1, text: 'Subject: Display unit wiring' }],
    });
    expect(metadata.documentType.observations[0].value).toBe('SB');
    expect(metadata.issuer.observations[0].value).toBe('BOEING');
    expect(metadata.ata.observations[0].value).toBe('31-20');
    expect(metadata.mentionedAircraftModels.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 'A320NEO',
          evidence: [expect.objectContaining({ page: 4 })],
        }),
      ]),
    );
    expect(
      metadata.mentionedAircraftModels.observations.some(
        (item) => item.value === '737-31',
      ),
    ).toBe(false);
    expect(metadata).toMatchObject({
      sourceSha256: 'a'.repeat(64),
      inspectedPages: [1, 2, 4],
      aircraftModelSemantics: 'DOCUMENT_MENTION_ONLY',
      applicabilityAssessment: 'NOT_EVALUATED',
    });
  });

  it('requires numeric model separators and preserves explicit variant lists instead of interpreting line numbers', () => {
    const metadata = extract([
      [
        'Airplane line numbers: 7077, 7079-7080, 7178, 7278, 7378, 7478, 7578, 7678-7679, 7877, 7879.',
        'Model references: 737-8, 737-8200, 787-9 and 737-7/8/8200/9/10 AMM.',
      ],
    ]);
    expect(
      metadata.mentionedAircraftModels.observations.map((item) => item.value),
    ).toEqual(['737-8', '737-8200', '787-9', '737-7/8/8200/9/10']);
  });
  it('preserves complete explicitly labelled ATA codes without interpreting ATA Spec publication numbers', () => {
    const metadata = extract([
      ['ATA System: 4613. ATA Chapter: 46-13. Order using ATA Spec 2000.'],
    ]);
    expect(metadata.ata.observations.map((item) => item.value)).toEqual([
      '4613',
      '46-13',
    ]);
  });
  it('joins an aligned two-column subject continuation and stops at the next labelled block', () => {
    const base = layout([[]]);
    const runs = [
      { text: 'SUBJECT:', x: 101, y: 580 },
      { text: 'Network File', x: 171, y: 580 },
      { text: 'Server Configuration Software', x: 171, y: 568 },
      { text: 'EXPORT CONTROLLED', x: 171, y: 556 },
    ];
    base.textRuns = runs.map((run) => ({
      ...run,
      page: 1,
      fontSize: 10,
      fontName: 'F1',
      bold: false,
    }));
    const metadata = extractActualPdfMetadata({
      layout: base,
      actualSha256: 'a'.repeat(64),
      actualByteLength: 200,
      identity: { documentFamily: 'SB', issuer: 'BOEING' },
    });
    expect(metadata.title.observations).toEqual([
      {
        value: 'Network File Server Configuration Software',
        status: 'PENDING_REVIEW',
        evidence: [
          {
            page: 1,
            text: 'SUBJECT: Network File Server Configuration Software',
          },
        ],
      },
    ]);
  });
  it('excludes only explicit trademark declarations and keeps the same model when real text mentions it', () => {
    const metadata = extract([
      [
        'Copyright 2020 Boeing. Boeing, 707, 737 and 787 are all trademarks owned by The Boeing Company.',
        'The following applicability paragraph describes the subject of the bulletin, independently of the preceding legal notice.',
        '737-800 airplanes are discussed as a comparison.',
      ],
    ]);
    expect(
      metadata.mentionedAircraftModels.observations.map((item) => item.value),
    ).toEqual(['737-800']);
    expect(metadata.applicabilityAssessment).toBe('NOT_EVALUATED');
  });
  it('keeps missing fields unknown without inferring ATA from document numbers or using PDF metadata titles', () => {
    const metadata = extract([
      ['737-31-21003 discusses a wiring change without labelled title.'],
    ]);
    expect(metadata.title).toEqual({ status: 'NOT_FOUND', observations: [] });
    expect(metadata.ata).toEqual({ status: 'NOT_FOUND', observations: [] });
    expect(metadata.documentType.status).toBe('NOT_FOUND');
    expect(metadata.issuer.status).toBe('NOT_FOUND');
  });

  it('retains conflicting labelled titles as pending observations and handles split title labels', () => {
    const metadata = extract([
      ['Issue Title:', 'First document title'],
      ['Subject: Second document title'],
    ]);
    expect(metadata.title.observations.map((item) => item.value)).toEqual([
      'First document title',
      'Second document title',
    ]);
    expect(metadata.title.status).toBe('PENDING_REVIEW');
  });
});
