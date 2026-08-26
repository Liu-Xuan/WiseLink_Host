import {
  deriveTranslationConsumptionAxes,
  type CanonicalTranslationConsumptionBinding,
  type CanonicalTranslationOwnerObservation,
  type CanonicalTranslationOwnerUnitRow,
} from '../../server/modules/canonical-host/canonical-reader-consumption';

const OWNER_OBSERVATION_SCHEMA_VERSION =
  'wiselink.3_1.translation_owner_observation.v0.candidate';

function binding(
  overrides: Partial<CanonicalTranslationConsumptionBinding> = {},
): CanonicalTranslationConsumptionBinding {
  return {
    documentId: 'DOC-1',
    revisionId: 'REV-1',
    sbdPackageId: 'SBD-1',
    sbdContentHash: 'sha256:sbd',
    tcpPackageId: null,
    tcpContentHash: null,
    ...overrides,
  };
}

function observation(
  overrides: Partial<CanonicalTranslationOwnerObservation> = {},
): CanonicalTranslationOwnerObservation {
  const translated = overrides.translatedUnitCount ?? 10;
  const pending = overrides.pendingTranslationUnitCount ?? 0;
  return {
    schemaVersion: OWNER_OBSERVATION_SCHEMA_VERSION,
    documentId: 'DOC-1',
    revisionId: 'REV-1',
    sourceTruth: 'StructuredBilingualDocument.units',
    currentConsumptionAllowed: true,
    currentnessGuardReason: null,
    productState: 'reading_aid_available',
    translatedUnitCount: translated,
    pendingTranslationUnitCount: pending,
    translationRequiredUnitCount: translated + pending,
    units: buildUnitRows(translated, pending),
    lineage: {
      documentId: 'DOC-1',
      revisionId: 'REV-1',
      sbdPackageId: 'SBD-1',
      sbdContentHash: 'sha256:sbd',
      tcpPackageId: null,
      tcpContentHash: null,
    },
    ...overrides,
  };
}

function buildUnitRows(
  translated: number,
  pending: number,
): CanonicalTranslationOwnerUnitRow[] {
  const rows: CanonicalTranslationOwnerUnitRow[] = [];
  for (let index = 0; index < translated + pending; index += 1) {
    rows.push({
      unitKey: `UNIT-KEY-${index}`,
      sourceUnitId: `SRC-UNIT-${index}`,
      sourceRef: `SRC-REF-${index}`,
      sourceHash: `sha256:source:${index}`,
      sourceTextHash: `sha256:text:${index}`,
      targetLocale: 'zh-CN',
      translatedTextState: index < translated ? 'translated' : 'pending',
    });
  }
  return rows;
}

describe('deriveTranslationConsumptionAxes (WL31 translation-reader candidate)', () => {
  it('opens both axes for a current, fully translated owner observation', () => {
    const result = deriveTranslationConsumptionAxes({
      observation: observation(),
      binding: binding(),
    });
    expect(result.status).toBe('BILINGUAL_READING_AID_AVAILABLE');
    if (result.status === 'UNAVAILABLE') throw new Error('unreachable');
    expect(result.axes.ownerSourceReaderConsumptionAllowed).toBe(true);
    expect(result.axes.bilingualTranslationConsumptionAllowed).toBe(true);
    expect(result.axes.failureReasons).toEqual([]);
  });

  it('keeps the source axis open while the bilingual axis stays closed for translation_pending', () => {
    const result = deriveTranslationConsumptionAxes({
      observation: observation({
        productState: 'translation_pending',
        translatedUnitCount: 4,
        pendingTranslationUnitCount: 6,
        translationRequiredUnitCount: 10,
      }),
      binding: binding(),
    });
    expect(result.status).toBe('SOURCE_CURRENT_TRANSLATION_PENDING');
    if (result.status === 'UNAVAILABLE') throw new Error('unreachable');
    expect(result.axes.ownerSourceReaderConsumptionAllowed).toBe(true);
    expect(result.axes.bilingualTranslationConsumptionAllowed).toBe(false);
    expect(result.axes.pendingTranslationUnitCount).toBe(6);
  });

  it('does not promote the bilingual axis when pending units exist even if productState claims reading_aid_available', () => {
    const result = deriveTranslationConsumptionAxes({
      observation: observation({
        translatedUnitCount: 9,
        pendingTranslationUnitCount: 1,
        translationRequiredUnitCount: 10,
      }),
      binding: binding(),
    });
    expect(result.status).toBe('SOURCE_CURRENT_TRANSLATION_PENDING');
    if (result.status === 'UNAVAILABLE') throw new Error('unreachable');
    expect(result.axes.ownerSourceReaderConsumptionAllowed).toBe(true);
    expect(result.axes.bilingualTranslationConsumptionAllowed).toBe(false);
  });

  it.each([
    [
      'unrecognized owner schema',
      observation({ schemaVersion: 'wiselink.unknown.v99' }),
    ],
    ['document identity mismatch', observation({ documentId: 'DOC-OTHER' })],
    ['revision identity mismatch', observation({ revisionId: 'REV-OTHER' })],
    [
      'unexpected sourceTruth',
      observation({ sourceTruth: 'PdfRawText.pages' }),
    ],
    [
      'owner current consumption denied',
      observation({ currentConsumptionAllowed: false }),
    ],
    [
      'currentness guard set',
      observation({ currentnessGuardReason: 'SOURCE_UPDATED_AFTER_READ' }),
    ],
    [
      'lineage package mismatch',
      observation({
        lineage: {
          documentId: 'DOC-1',
          revisionId: 'REV-1',
          sbdPackageId: 'SBD-OTHER',
          sbdContentHash: 'sha256:sbd',
          tcpPackageId: null,
          tcpContentHash: null,
        },
      }),
    ],
    [
      'lineage content hash mismatch',
      observation({
        lineage: {
          documentId: 'DOC-1',
          revisionId: 'REV-1',
          sbdPackageId: 'SBD-1',
          sbdContentHash: 'sha256:other',
          tcpPackageId: null,
          tcpContentHash: null,
        },
      }),
    ],
    [
      'unit counts inconsistent',
      observation({
        translatedUnitCount: 5,
        pendingTranslationUnitCount: 3,
        translationRequiredUnitCount: 10,
      }),
    ],
  ])('fails closed on both axes when %s', (_label, obs) => {
    const result = deriveTranslationConsumptionAxes({
      observation: obs,
      binding: binding(),
    });
    expect(result.status).toBe('TRANSLATION_GAP');
    if (result.status === 'UNAVAILABLE') throw new Error('unreachable');
    expect(result.axes.ownerSourceReaderConsumptionAllowed).toBe(false);
    expect(result.axes.bilingualTranslationConsumptionAllowed).toBe(false);
    expect(result.axes.failureReasons.length).toBeGreaterThan(0);
  });

  it('treats an unexpected TCP lineage in the observation as a lineage mismatch', () => {
    const result = deriveTranslationConsumptionAxes({
      observation: observation({
        lineage: {
          documentId: 'DOC-1',
          revisionId: 'REV-1',
          sbdPackageId: 'SBD-1',
          sbdContentHash: 'sha256:sbd',
          tcpPackageId: 'TCP-UNEXPECTED',
          tcpContentHash: 'sha256:tcp',
        },
      }),
      binding: binding(),
    });
    expect(result.status).toBe('TRANSLATION_GAP');
    if (result.status === 'UNAVAILABLE') throw new Error('unreachable');
    expect(result.axes.failureReasons).toContain(
      'OWNER_LINEAGE_IDENTITY_MISMATCH',
    );
  });

  it('closes everything when the owner observation is missing', () => {
    const result = deriveTranslationConsumptionAxes({
      observation: null,
      binding: binding(),
    });
    expect(result).toEqual({
      status: 'UNAVAILABLE',
      reason: 'TRANSLATION_PROJECTION_NOT_AVAILABLE',
    });
  });

  it('closes everything when the Host binding is missing', () => {
    const result = deriveTranslationConsumptionAxes({
      observation: observation(),
      binding: null,
    });
    expect(result).toEqual({
      status: 'UNAVAILABLE',
      reason: 'TRANSLATION_PROJECTION_NOT_AVAILABLE',
    });
  });

  it('rejects a needs_inputs product state as a gap with the source axis closed', () => {
    const result = deriveTranslationConsumptionAxes({
      observation: observation({
        productState: 'needs_inputs',
        currentConsumptionAllowed: false,
      }),
      binding: binding(),
    });
    expect(result.status).toBe('TRANSLATION_GAP');
    if (result.status === 'UNAVAILABLE') throw new Error('unreachable');
    expect(result.axes.ownerProductState).toBe('needs_inputs');
    expect(result.axes.ownerSourceReaderConsumptionAllowed).toBe(false);
    expect(result.axes.bilingualTranslationConsumptionAllowed).toBe(false);
  });

  describe('owner SourceUnit row integrity', () => {
    it('fails closed when required rows are missing or row counts drift', () => {
      for (const units of [null, buildUnitRows(9, 0)]) {
        const result = deriveTranslationConsumptionAxes({
          observation: observation({ units }),
          binding: binding(),
        });
        expect(result.status).toBe('TRANSLATION_GAP');
        if (result.status === 'UNAVAILABLE') throw new Error('unreachable');
        expect(result.axes.failureReasons).toContain(
          'OWNER_UNIT_ROWS_INCONSISTENT',
        );
        expect(result.axes.ownerSourceReaderConsumptionAllowed).toBe(false);
        expect(result.axes.bilingualTranslationConsumptionAllowed).toBe(false);
      }
    });

    it('fails closed when row states drift or unit keys repeat', () => {
      const stateDrift = buildUnitRows(10, 0);
      stateDrift[9] = { ...stateDrift[9], translatedTextState: 'pending' };
      const duplicateKey = buildUnitRows(10, 0);
      duplicateKey[9] = {
        ...duplicateKey[9],
        unitKey: duplicateKey[0].unitKey,
      };

      for (const units of [stateDrift, duplicateKey]) {
        const result = deriveTranslationConsumptionAxes({
          observation: observation({ units }),
          binding: binding(),
        });
        expect(result.status).toBe('TRANSLATION_GAP');
        if (result.status === 'UNAVAILABLE') throw new Error('unreachable');
        expect(result.axes.failureReasons).toContain(
          'OWNER_UNIT_ROWS_INCONSISTENT',
        );
      }
    });

    it('fails closed on blank identities and unknown translated-text states', () => {
      const blankRef = buildUnitRows(10, 0);
      blankRef[3] = { ...blankRef[3], sourceRef: '   ' };
      const badState = buildUnitRows(10, 0);
      badState[5] = {
        ...badState[5],
        translatedTextState: 'in_progress' as never,
      };

      for (const units of [blankRef, badState]) {
        const result = deriveTranslationConsumptionAxes({
          observation: observation({ units }),
          binding: binding(),
        });
        expect(result.status).toBe('TRANSLATION_GAP');
        if (result.status === 'UNAVAILABLE') throw new Error('unreachable');
        expect(result.axes.failureReasons).toContain(
          'OWNER_UNIT_ROWS_INCONSISTENT',
        );
      }
    });

    it('accepts zero required units with null rows without inventing rows', () => {
      const result = deriveTranslationConsumptionAxes({
        observation: observation({
          translatedUnitCount: 0,
          pendingTranslationUnitCount: 0,
          translationRequiredUnitCount: 0,
          units: null,
        }),
        binding: binding(),
      });
      expect(result.status).toBe('BILINGUAL_READING_AID_AVAILABLE');
      if (result.status === 'UNAVAILABLE') throw new Error('unreachable');
      expect(result.axes.ownerSourceReaderConsumptionAllowed).toBe(true);
      expect(result.axes.bilingualTranslationConsumptionAllowed).toBe(true);
    });

    it('fails closed without throwing for malformed runtime row payloads', () => {
      const missingUnits = { ...observation({}) } as Record<string, unknown>;
      delete missingUnits.units;
      const malformed: unknown[] = [
        missingUnits,
        { ...observation({}), units: 'not-an-array' },
        { ...observation({}), units: [null] },
        { ...observation({}), units: ['primitive-row'] },
      ];

      for (const ownerObservation of malformed) {
        const result = deriveTranslationConsumptionAxes({
          observation: ownerObservation as never,
          binding: binding(),
        });
        expect(result.status).toBe('TRANSLATION_GAP');
        if (result.status === 'UNAVAILABLE') throw new Error('unreachable');
        expect(result.axes.failureReasons).toContain(
          'OWNER_UNIT_ROWS_INCONSISTENT',
        );
      }
    });
  });
});
