import {
  hostNativePdfAdapterIdFromDmPreflight,
  hostNativePdfClassificationFor,
  recognizeHostNativePdfProfile,
} from '../../server/modules/canonical-host/host-native-pdf-profile.registry';
import type { ParsedPdfLayout } from '../../server/modules/professional-input/pure/professional-input-pure.types';
import { resolveDocumentFamilyAdapter } from '../../server/modules/document-management/src/migrated/adapters/documentFamilyAdapterRegistry.js';

function layoutWithText(
  text: string,
  sourceSha256 = `sha256:${'a'.repeat(64)}`,
): ParsedPdfLayout {
  const pageTextLayerDiagnostics = [
    {
      page: 1,
      status: 'PRESENT' as const,
      textRunCount: 1,
      nonWhitespaceCharacterCount: text.replace(/\s/gu, '').length,
      rasterVisualCoverage: {
        status: 'NO_MATERIAL_RASTER' as const,
        materialUnverifiedRasterPageFraction: 0.25,
        rasterRegionCount: 0,
        rasterPageAreaRatio: 0,
        unverifiedRasterRegionCount: 0,
        unverifiedRasterPageAreaRatio: 0,
        unverifiedRasterRegions: [],
      },
    },
  ] as const;
  return {
    kind: 'pdf',
    pdfVersion: '1.7',
    pageCount: 1,
    pageBoxes: [{ page: 1, mediaBox: [0, 0, 612, 792] }],
    metadata: { title: null },
    textRuns: [
      {
        page: 1,
        fontName: 'F1',
        bold: false,
        fontSize: 12,
        x: 10,
        y: 700,
        text,
      },
    ],
    pageTextLayerDiagnostics,
    sourceSha256,
    sourceByteLength: 1_000,
  } as ParsedPdfLayout & {
    readonly pageTextLayerDiagnostics: typeof pageTextLayerDiagnostics;
  };
}

describe('host-native PDF profile registry', () => {
  it('recognizes a split-run-equivalent FTD cover identity without accepting a bare reference', () => {
    expect(
      recognizeHostNativePdfProfile(
        layoutWithText(
          '777- FTD-31-21002 Issue Title : Airplane Information Management System update. FLEET TEAM DIGEST BOEING PROPRIETARY.',
        ),
        'FTD',
      ),
    ).toMatchObject({
      adapterId: 'issuer.boeing.ftd.v1',
      family: 'FTD',
      parseProfileRef: 'boeing.ftd.v1',
      documentType: 'fleet_team_digest',
    });
    expect(
      recognizeHostNativePdfProfile(
        layoutWithText(
          'SERVICE LETTER References: Fleet Team Digest 777-FTD-31-21002.',
        ),
        'FTD',
      ),
    ).toBeNull();
  });

  it('selects a Boeing SB from source content without binding a file digest', () => {
    const content =
      'Commercial Airplanes 777 Service Bulletin. BOEING SERVICE BULLETIN 777-34-0425.';
    expect(
      resolveDocumentFamilyAdapter({ documentFamily: 'SB', content }),
    ).toMatchObject({
      adapterId: 'issuer.boeing.service_bulletin.v1',
      parseProfileRef: 'boeing.sb',
    });
    const first = recognizeHostNativePdfProfile(
      layoutWithText(content, `sha256:${'1'.repeat(64)}`),
      'SB',
    );
    const second = recognizeHostNativePdfProfile(
      layoutWithText(content, `sha256:${'2'.repeat(64)}`),
      'SB',
    );

    expect(first).toMatchObject({
      adapterId: 'issuer.boeing.service_bulletin.v1',
      family: 'SB',
      parserProfileId: 'parser-profile:boeing.sb@1.0.0',
      documentType: 'service_bulletin',
      evidence: { kind: 'PDF_SOURCE_TITLE_AND_TEXT' },
    });
    expect(second?.parserProfileId).toBe(first?.parserProfileId);
    expect(second?.parserProfileHash).toBe(first?.parserProfileHash);
  });

  it('uses the controlled family to resist cross-reference profile capture', () => {
    const serviceLetter = recognizeHostNativePdfProfile(
      layoutWithText(
        'SERVICE LETTER Commercial Aviation Services CUSTOMER SUPPORT ENGINEERING BOEING COMMERCIAL AIRPLANES 777-SL-45-006. References: Fleet Team Digest 777-FTD-00-13001 and Service Bulletin 777-45-0017.',
      ),
      'SL',
    );
    const directive = recognizeHostNativePdfProfile(
      layoutWithText(
        'DEPARTMENT OF TRANSPORTATION Federal Aviation Administration 14 CFR Part 39 Airworthiness Directives; The Boeing Company Airplanes. AD 2011-03-14. Referenced Boeing Alert Service Bulletin.',
      ),
      'AD',
    );

    expect(serviceLetter?.adapterId).toBe('issuer.boeing.service_letter.v1');
    expect(directive?.adapterId).toBe('issuer.faa.airworthiness_directive.v1');
  });

  it('keeps Alert SB unreachable until ordinary classification can carry its subtype', () => {
    const content =
      'BOEING ALERT SERVICE BULLETIN 777-34A0425. Commercial Airplanes.';
    expect(
      resolveDocumentFamilyAdapter({ documentFamily: 'SB', content }),
    ).toMatchObject({
      adapterId: 'issuer.boeing.alert_service_bulletin.v1',
      parseProfileRef: 'boeing.asb',
    });
    expect(
      recognizeHostNativePdfProfile(layoutWithText(content), 'SB'),
    ).toBeNull();
    expect(
      hostNativePdfClassificationFor({
        family: 'SB',
        issuerAuthority: 'BOEING',
      }),
    ).toMatchObject({
      parserProfileId: 'parser-profile:boeing.sb@1.0.0',
    });
  });

  it('keeps AEO and AMM-linked responses unavailable in this slice', () => {
    expect(
      recognizeHostNativePdfProfile(
        layoutWithText(
          'AEO-B787-46-0012-R00 Engineering Order SECTION 1. Airworthiness Directive is a reference field only.',
        ),
        'GENERIC',
      ),
    ).toBeNull();
    expect(
      recognizeHostNativePdfProfile(
        layoutWithText(
          'Dossier Reference 80217647 Documentation Content Final Answer. Main Manual Business Cat AMM. Reference TASK 31-36-00-200-803A.',
        ),
        'MT',
      ),
    ).toBeNull();
  });

  it('only emits ordinary classifications for activated issuer/family pairs', () => {
    expect(
      hostNativePdfClassificationFor({
        family: 'SL',
        issuerAuthority: 'BOEING',
      }),
    ).toMatchObject({
      status: 'CANDIDATE',
      normalizedFamily: 'SL',
      parserProfileId: 'parser-profile:boeing.sl@1.0.0',
    });
    expect(
      hostNativePdfClassificationFor({
        family: 'SIL',
        issuerAuthority: 'BOEING',
      }),
    ).toBeNull();
    expect(
      hostNativePdfClassificationFor({
        family: 'AD',
        issuerAuthority: 'UNKNOWN',
      }),
    ).toBeNull();
    expect(
      hostNativePdfClassificationFor({
        family: 'FTD',
        issuerAuthority: 'UNKNOWN',
      }),
    ).toBeNull();
  });

  it('binds subtype profiles to the controlled DM preflight adapter release', () => {
    expect(
      hostNativePdfAdapterIdFromDmPreflight({
        normalizedDescriptorJson: JSON.stringify({
          adapterRelease: {
            adapterId: 'issuer.airbus.retrofit_information_letter.v1',
            adapterVersion: 'v8.4-document-family-adapter.v1',
          },
        }),
      }),
    ).toBe('issuer.airbus.retrofit_information_letter.v1');
    expect(
      hostNativePdfClassificationFor({
        family: 'SB',
        issuerAuthority: 'AIRBUS',
        adapterId: 'issuer.airbus.retrofit_information_letter.v1',
      }),
    ).toMatchObject({
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
      parserProfileId:
        'parser-profile:airbus.retrofit_information_letter@1.0.0',
    });
    expect(
      hostNativePdfClassificationFor({
        family: 'SB',
        issuerAuthority: 'BOEING',
        adapterId: 'issuer.airbus.retrofit_information_letter.v1',
      }),
    ).toBeNull();
    expect(
      hostNativePdfClassificationFor({
        family: 'SB',
        issuerAuthority: 'AIRBUS',
        adapterId: 'issuer.airbus.support_document.v1',
      }),
    ).toBeNull();
    expect(
      hostNativePdfAdapterIdFromDmPreflight({
        normalizedDescriptorJson: '{not-json',
      }),
    ).toBe('');
  });
});
