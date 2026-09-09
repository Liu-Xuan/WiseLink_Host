import {
  documentIngressIdentityFromDescriptor,
  documentIngressIdentityFromDocument,
  compareDocumentIngressVersions,
  buildGovernedDocumentIngressPreflightDecision,
} from '../../server/modules/document-management/src/migrated/ingress/documentIngressPreflight.js';

function descriptor(
  revision: string,
  date: string,
  family = 'SB',
  digest = 'a',
) {
  const documentCode = family === 'FTD' ? '737-FTD-34-12345' : '737-34-3830';
  const sha256 = digest.repeat(64);
  return {
    documentCode,
    businessRevision: revision,
    revisionDate: date,
    canonicalDocumentFamily: family,
    documentFamily: family,
    issuer: 'BOEING',
    sha256,
    sizeBytes: 100,
    originalFilename: 'publication.pdf',
    documentCodeProvenance: {
      schemaVersion: 'wiselink.document_code_provenance.v1',
      source: 'pdf_text_first_three_pages',
      candidates: [documentCode],
      inspectedSha256: sha256,
      conflict: false,
    },
  };
}
function identity(revision: string, date: string, family = 'SB') {
  const value = descriptor(revision, date, family);
  return documentIngressIdentityFromDescriptor(value, value);
}
function decision(
  incoming: ReturnType<typeof descriptor>,
  existing: ReturnType<typeof descriptor>[],
) {
  return buildGovernedDocumentIngressPreflightDecision({
    rawDescriptor: incoming,
    normalizedDescriptor: incoming,
    documents: existing.map((value, index) => ({
      documentVersionId: `version-${index}`,
      detail: { ...value, issuerAuthority: value.issuer },
      upload: { descriptorSummary: value },
    })),
  });
}

describe('DM publication revision ordering', () => {
  it.each(['SB', 'SL', 'SIL', 'AEO', 'RB', 'AD'])(
    '%s keeps the same numbered revision despite a changed date',
    (family) => {
      expect(
        compareDocumentIngressVersions(
          identity('R1', '2026-01-02', family),
          identity('R1', '2026-01-01', family),
        ),
      ).toBe(0);
    },
  );
  it.each([
    ['R2', 'R1'],
    ['ISSUE 002', 'ISSUE 001'],
    ['R1', 'ORIGINAL ISSUE'],
  ])('%s advances %s on the same day', (next, previous) => {
    expect(
      compareDocumentIngressVersions(
        identity(next, '2026-01-01'),
        identity(previous, '2026-01-01'),
      ),
    ).toBe(1);
    expect(
      decision(descriptor(next, '2026-01-01', 'SB', 'b'), [
        descriptor(previous, '2026-01-01'),
      ]).decision,
    ).toBe('INGEST_NEW_REVISION');
  });
  it('quarantines changed content for the same current or historical revision', () => {
    const incoming = descriptor('R1', '2026-01-02', 'SB', 'c');
    expect(decision(incoming, [descriptor('R1', '2026-01-01')]).decision).toBe(
      'SAME_REVISION_CONTENT_CONFLICT',
    );
    expect(
      decision(incoming, [
        descriptor('R1', '2026-01-01'),
        descriptor('R2', '2026-02-01', 'SB', 'b'),
      ]).decision,
    ).toBe('SAME_REVISION_CONTENT_CONFLICT');
  });
  it.each([
    ['R2', '2025-12-31', 'R1', '2026-01-01'],
    ['R1', '2026-02-01', 'R2', '2026-01-01'],
    ['ISSUE 2', '2025-12-31', 'ISSUE 1', '2026-01-01'],
  ])(
    'requires review when %s date contradicts %s ordering',
    (next, nextDate, previous, previousDate) => {
      const result = decision(descriptor(next, nextDate, 'SB', 'b'), [
        descriptor(previous, previousDate),
      ]);
      expect(result.decision).toBe('VERSION_ORDER_UNKNOWN');
      expect(result.shouldProcess).toBe(false);
    },
  );
  it('does not guess between issue and revision axes or unknown labels', () => {
    expect(
      compareDocumentIngressVersions(
        identity('ISSUE 2', '2026-01-02'),
        identity('R1', '2026-01-01'),
      ),
    ).toBeNull();
    expect(identity('REV B', '2026-01-01').versionOrderResolved).toBe(false);
  });
  it('does not order different families or infer currentness across conflicting stored dates', () => {
    expect(
      compareDocumentIngressVersions(
        identity('R2', '', 'SL'),
        identity('R1', '', 'SB'),
      ),
    ).toBeNull();
    expect(
      decision(descriptor('R3', '2026-03-01', 'SB', 'c'), [
        descriptor('R1', '2026-02-01'),
        descriptor('R2', '2026-01-01', 'SB', 'b'),
      ]).decision,
    ).toBe('VERSION_ORDER_UNKNOWN');
  });
  it('keeps exact byte reuse ahead of ordering and leaves stored records unchanged', () => {
    const stored = descriptor('R1', '2026-01-01');
    const snapshot = JSON.stringify(stored);
    expect(decision(stored, [stored]).decision).toBe('RESUME_EXISTING_PROCESS');
    expect(JSON.stringify(stored)).toBe(snapshot);
  });
  it('keeps older revision import as review instead of moving current backwards', () => {
    expect(
      decision(descriptor('R1', '2026-01-01', 'SB', 'b'), [
        descriptor('R2', '2026-02-01'),
      ]).decision,
    ).toBe('ASK_IMPORT_OLDER_REVISION');
  });
  it('keeps date-only publications ordered by date', () => {
    expect(
      compareDocumentIngressVersions(
        identity('', '2026-01-02', 'AD'),
        identity('', '2026-01-01', 'AD'),
      ),
    ).toBe(1);
  });
  it('uses the committed FTD generated date without depending on the retained filename', () => {
    const value = {
      ...descriptor('', '', 'FTD'),
      sourceGeneratedDate: '2026-01-01',
    };
    const stored = documentIngressIdentityFromDocument({
      detail: { ...value, issuerAuthority: 'BOEING' },
      upload: { descriptorSummary: value },
    });
    expect(stored.comparableVersion).toBe('GENERATED:2026-01-01');
    expect(stored.sourceGeneratedDateProvenance).toMatchObject({
      source: 'stored_document',
      controlled: true,
    });
    expect(
      documentIngressIdentityFromDescriptor(value, value).versionOrderResolved,
    ).toBe(false);
  });
  it('orders FTD only by controlled generated dates, never a revision date fallback', () => {
    const ftd = (date: string) => {
      const value = {
        ...descriptor('', '2030-01-01', 'FTD'),
        sourceGeneratedDate: date,
        sourceGeneratedDateProvenance: {
          schemaVersion: 'wiselink.source_generated_date_provenance.v1',
          source: 'pdf_text_first_three_pages',
          value: date,
          inspectedSha256: 'a'.repeat(64),
          conflict: false,
        },
      };
      return documentIngressIdentityFromDescriptor(value, value);
    };
    expect(
      compareDocumentIngressVersions(ftd('2026-01-02'), ftd('2026-01-01')),
    ).toBe(1);
    expect(identity('', '2026-01-01', 'FTD').versionOrderResolved).toBe(false);
  });
});
