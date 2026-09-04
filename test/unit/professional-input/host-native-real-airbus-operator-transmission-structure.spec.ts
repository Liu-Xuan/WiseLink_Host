import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { recognizeHostNativePdfProfile } from '../../../server/modules/canonical-host/host-native-pdf-profile.registry';
import { resolveActualPdfDocumentIdentity } from '../../../server/modules/document-management/src/migrated/ingress/pdfDocumentIdentityOwner.js';
import { buildSourceBoundOperatorTransmissionDocument } from '../../../server/modules/professional-input/builders/airbus-operator-transmission-structure.builder';
import { buildFamilySectionTopology } from '../../../server/modules/professional-input/builders/family-section-topology.builder';
import { runProfessionalInputPipelineFromLayout } from '../../../server/modules/professional-input/builders/professional-input-pipeline';
import { PdfjsDistLayoutExtractor } from '../../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import type {
  SourceUnitSet,
  StructuredParsePackage,
} from '../../../server/modules/professional-input/pure/professional-input-pure.types';
import { Frozen2CandidateReaderService } from '../../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { PythonU0FullPackageValidatorAdapter } from '../../../server/modules/unified-reader/python-u0-full-package-validator.adapter';
import { U0FullValidationService } from '../../../server/modules/unified-reader/u0-full-validation.service';
import { sha256Raw } from '../../../server/modules/unified-reader/unified-reader.utils';

const OIT_PATH = process.env.WL31_REAL_AIRBUS_OIT_PDF_PATH?.trim();
const FOT_PATH = process.env.WL31_REAL_AIRBUS_FOT_PDF_PATH?.trim();
const SBIT_PATH = process.env.WL31_REAL_AIRBUS_SBIT_PDF_PATH?.trim();
const describeActualOperatorTransmissions =
  OIT_PATH && FOT_PATH && SBIT_PATH ? describe : describe.skip;
const U0_CONTRACT_COMMIT = 'fa69ada08265934951df53c7a61a3ccdb8cb2900';

interface StructuredObservation {
  unit: {
    sourceRefIds: string[];
    sourceSegmentIds: string[];
    payload: { text: string };
  };
  observationType: string;
  value: Record<string, unknown>;
}

const CASES = [
  {
    subtype: 'OIT',
    path: OIT_PATH,
    bytes: 179_992,
    pages: 3,
    sha256: 'c62d1ed5458de786a8511b4cb7273f7d154d59e4cc182b931636df4ddc424fd6',
    documentCode: '999.0014/26',
    revision: 'R0',
    revisionDate: '2026-03-05',
    sections: ['purpose', 'background', 'description', 'follow_up', 'contacts'],
    references: [
      '22-1C43',
      'SAFETY FIRST JANUARY 2011',
      '22-1296',
      '22-1614',
      '22-1338',
      '22-1536',
      '34-1403',
    ],
    recommendationModalities: ['HIGHLY_RECOMMENDED', 'INVITED'],
    followUpState: 'PLANNED_INSPECTION_BULLETIN',
    readerQuery: '22-1C43',
  },
  {
    subtype: 'FOT',
    path: FOT_PATH,
    bytes: 798_296,
    pages: 2,
    sha256: '29a9fdb67a2b14f9eec3bd03f68c8a2b3f3bfe3c251bbcdadd9e4a36a3819b1b',
    documentCode: '999.0062/25',
    revision: 'R0',
    revisionDate: '2026-03-03',
    sections: ['purpose', 'description', 'recommendations', 'follow_up_plan'],
    references: ['05-50-00-810-801-A'],
    recommendationModalities: ['ENCOURAGED'],
    followUpState: 'NO_UPDATE_PLANNED',
    readerQuery: '05-50-00-810-801-A',
  },
  {
    subtype: 'SBIT',
    path: SBIT_PATH,
    bytes: 809_070,
    pages: 2,
    sha256: '22edadedc7e25a1b558e28800c0a812be4996cabb07f86ed09061a9a2c178c2f',
    documentCode: '24-0015',
    revision: 'R3',
    revisionDate: '2026-03-18',
    sections: [
      'reason_for_revision',
      'purpose',
      'background',
      'recommendation',
      'follow_up',
      'contacts',
    ],
    references: ['A330-28-3141'],
    recommendationModalities: ['CONFIRMED_NOTE_CHANGE'],
    followUpState: 'PLANNED_REFERENCE_REVISION',
    readerQuery: 'A330-28-3141',
  },
] as const;

describeActualOperatorTransmissions(
  'professional-input Airbus OIT/FOT/SBIT source-bound typed semantics with actual bytes',
  () => {
    jest.setTimeout(120_000);

    it.each(CASES)(
      'preserves $subtype primary identity, section state and scoped business facts through U0/Reader',
      async (fixture) => {
        const pipeline = await actualPipeline(fixture);
        const observations = structuredObservations(pipeline.pkg);
        const windows = observations.filter(
          (observation) => observation.observationType === 'SECTION_WINDOW',
        );
        expect(
          windows.map((observation) => observation.value.sectionKey),
        ).toEqual(fixture.sections);
        if (fixture.subtype === 'OIT') {
          expect(
            windows.find(
              (observation) => observation.value.sectionKey === 'background',
            )?.value,
          ).toMatchObject({ pageStart: 1, pageEnd: 2 });
          const sourceWindows = buildFamilySectionTopology({
            unitSet: pipeline.unitSet,
            document: {
              documentCode: fixture.documentCode,
              documentType: 'operator_transmission',
              language: 'en-US',
            },
          });
          expect(
            sourceWindows.flatMap((window) => window.bodyUnits).some((unit) =>
              /^(?:TELEPHONE|OIT\s+ref:|©\s*AIRBUS)/iu.test(unit.text),
            ),
          ).toBe(false);
        }

        const typed = singleObservation(
          observations,
          'OPERATOR_TRANSMISSION_DOCUMENT',
        );
        expect(typed.value).toMatchObject({
          semanticState: 'CONTENT',
          documentStructured: true,
          unstructuredReason: null,
          subtype: fixture.subtype,
          identity: {
            documentCode: fixture.documentCode,
            businessRevision: fixture.revision,
            revisionDate: fixture.revisionDate,
          },
          prohibitedInferences: {
            documentMandatoryInferred: false,
            applicabilityDecisionInferred: false,
            referencePromotedToAttachment: false,
            actionReadinessInferred: false,
            completionInferred: false,
            approvalInferred: false,
            closureInferred: false,
          },
        });
        expect(
          (
            typed.value.references as Array<{ targetDocumentCode: string }>
          ).map((reference) => reference.targetDocumentCode),
        ).toEqual(fixture.references);
        expect(
          (
            typed.value.recommendations as Array<{ modality: string }>
          ).map((recommendation) => recommendation.modality),
        ).toEqual(fixture.recommendationModalities);
        expect(typed.value.followUp).toMatchObject({
          state: fixture.followUpState,
          completionInferred: false,
          closureInferred: false,
        });
        expect(
          (typed.value.pageFurniture as unknown[]).length,
        ).toBe(fixture.pages);
        if (fixture.subtype === 'OIT') {
          expect(typed.value.statedAircraftScopes).toEqual([
            expect.objectContaining({
              field: 'AIRCRAFT_TYPE',
              qualifiersRaw: [
                'operators with aircraft equipped with NAV mode in Go-Around function',
              ],
              decisionInferred: false,
            }),
          ]);
        }
        expect(typed.unit.sourceRefIds.length).toBeGreaterThan(0);
        expect(typed.unit.sourceSegmentIds.length).toBeGreaterThan(0);
        expect(pipeline.pkg.applicability).toEqual({
          sourceExpressions: [],
          normalizedCandidates: [],
          assignments: [],
        });

        const reader = new Frozen2CandidateReaderService().read(
          pipeline.u0Input.artifact,
          pipeline.u0Input.bytes,
          fixture.readerQuery,
        );
        expect(reader.queryResults.length).toBeGreaterThan(0);
        expect(
          reader.queryResults.every(
            (result) => result.sourceRefIds.length > 0,
          ),
        ).toBe(true);
      },
    );

    it('keeps referenced/body mandatory wording scoped away from document authority', async () => {
      const oit = await actualPipeline(CASES[0]);
      const sbit = await actualPipeline(CASES[2]);
      const oitValue = singleObservation(
        structuredObservations(oit.pkg),
        'OPERATOR_TRANSMISSION_DOCUMENT',
      ).value;
      const sbitValue = singleObservation(
        structuredObservations(sbit.pkg),
        'OPERATOR_TRANSMISSION_DOCUMENT',
      ).value;
      expect(oitValue.selfClassification).toMatchObject({ value: 'ADVICE' });
      expect(
        (sbitValue.references as Array<{ mandatoryQualifier: boolean }>)[0]
          .mandatoryQualifier,
      ).toBe(true);
      expect(sbitValue.prohibitedInferences).toMatchObject({
        documentMandatoryInferred: false,
      });
    });

    it('fails closed on primary/footer conflicts, lost SBIT subtype and missing inline FOT reference', async () => {
      const oit = await actualPipeline(CASES[0]);
      const oitConflict = mutateUnitSet(oit.unitSet, (text) =>
        text.includes('OIT ref:999.0014/26 Rev 00Page 2')
          ? text.replace('Rev 00', 'Rev 01')
          : text,
      );
      expect(buildDocument(oitConflict, CASES[0].documentCode)).toMatchObject({
        documentStructured: false,
        unstructuredReason: 'PAGE_FURNITURE_CONFLICT',
      });
      const referenceGap = mutateUnitSet(oit.unitSet, (text) =>
        text.startsWith('Ref 2:') ? text.replace('Ref 2:', 'Ref 4:') : text,
      );
      expect(buildDocument(referenceGap, CASES[0].documentCode)).toMatchObject({
        documentStructured: false,
        unstructuredReason: 'REFERENCE_CATALOG_UNRESOLVED',
      });

      const sbit = await actualPipeline(CASES[2]);
      const lostSubtype = mutateUnitSet(sbit.unitSet, (text) =>
        text.includes('SERVICE BULLETIN INFORMATION TRANSMISSION (SBIT)')
          ? 'OIT CATEGORY: Advice'
          : text,
      );
      expect(buildDocument(lostSubtype, CASES[2].documentCode)).toMatchObject({
        documentStructured: false,
        unstructuredReason: 'SECTION_SEQUENCE_UNRESOLVED',
      });
      const lostRevisionMarker = mutateUnitSet(sbit.unitSet, (text) =>
        text === '“BEG. REV”' ? 'revision marker unavailable' : text,
      );
      expect(
        buildDocument(lostRevisionMarker, CASES[2].documentCode),
      ).toMatchObject({
        documentStructured: false,
        unstructuredReason: 'REVISION_MARKER_UNRESOLVED',
      });

      const fot = await actualPipeline(CASES[1]);
      const missingReference = mutateUnitSet(fot.unitSet, (text) =>
        text.replace('TSM task 05-50-00-', 'controlled task reference '),
      );
      expect(buildDocument(missingReference, CASES[1].documentCode)).toMatchObject(
        {
          documentStructured: false,
          unstructuredReason: 'REFERENCE_CATALOG_UNRESOLVED',
        },
      );
    });
  },
);

async function actualPipeline(fixture: (typeof CASES)[number]) {
  const sourceBytes = await readFile(fixture.path as string);
  expect(sourceBytes.byteLength).toBe(fixture.bytes);
  expect(sha256Raw(sourceBytes)).toBe(fixture.sha256);
  const layout =
    new PdfjsDistLayoutExtractor().extractLayoutWithDiagnostics(sourceBytes);
  expect(layout.pageCount).toBe(fixture.pages);
  const identity = (resolveActualPdfDocumentIdentity as any)({
    layout,
    actualSha256: fixture.sha256,
    actualByteLength: fixture.bytes,
    inspectionSha256: fixture.sha256,
    inspectionByteLength: fixture.bytes,
    originalFilename: 'renamed-actual-operator-transmission.pdf',
  });
  expect(identity).toMatchObject({
    documentCode: fixture.documentCode,
    documentFamily: 'SB',
    sourceType: 'airbus_operator_transmission',
    issuer: 'AIRBUS',
    businessRevision: fixture.revision,
    revisionDate: fixture.revisionDate,
    documentFamilyAdapterId: 'issuer.airbus.operator_transmission.v1',
    identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
  });
  expect(recognizeHostNativePdfProfile(layout, 'SB')).toMatchObject({
    adapterId: 'issuer.airbus.operator_transmission.v1',
    family: 'SB',
    issuerAuthority: 'AIRBUS',
    parseProfileRef: 'airbus.operator_transmission',
    documentType: 'operator_transmission',
  });
  const pipeline = runProfessionalInputPipelineFromLayout(layout, {
    artifact: {
      artifactRef: `artifact://CanonicalArtifactStore/sha256/${fixture.sha256}`,
      normalizedPath: `actual-${fixture.subtype}.pdf`,
    },
    document: {
      documentCode: fixture.documentCode,
      documentType: 'operator_transmission',
      language: 'en-US',
    },
    lineage: {
      generatedAt: '2026-09-04T00:00:00.000Z',
      producerName: 'professional-input-actual-operator-transmission-test',
      producerVersion: '1.0.0',
    },
  });
  await expect(createFullValidator().validate(pipeline.u0Input)).resolves.toMatchObject(
    {
      status: 'FULL_STRICT_VALIDATOR_PASSED',
      packageId: pipeline.pkg.packageId,
    },
  );
  return pipeline;
}

function buildDocument(unitSet: SourceUnitSet, documentCode: string) {
  const document = {
    documentCode,
    documentType: 'operator_transmission' as const,
    language: 'en-US',
  };
  return buildSourceBoundOperatorTransmissionDocument({
    unitSet,
    sections: buildFamilySectionTopology({ unitSet, document }),
    documentCode,
    documentType: document.documentType,
  });
}

function mutateUnitSet(
  unitSet: SourceUnitSet,
  mutate: (text: string) => string,
): SourceUnitSet {
  return {
    ...unitSet,
    units: unitSet.units.map((unit) => ({
      ...unit,
      text: mutate(unit.text),
    })),
  };
}

function structuredObservations(
  pkg: StructuredParsePackage,
): StructuredObservation[] {
  return (
    pkg.contentUnits as Array<{
      sourceRefIds: string[];
      sourceSegmentIds: string[];
      payload: { text: string };
    }>
  )
    .map((unit) => {
      try {
        const parsed = JSON.parse(unit.payload.text) as {
          observationType?: string;
          value?: Record<string, unknown>;
        };
        return parsed.observationType && parsed.value
          ? {
              unit,
              observationType: parsed.observationType,
              value: parsed.value,
            }
          : null;
      } catch {
        return null;
      }
    })
    .filter((value): value is StructuredObservation => value !== null);
}

function singleObservation(
  observations: readonly StructuredObservation[],
  observationType: string,
): StructuredObservation {
  const matching = observations.filter(
    (observation) => observation.observationType === observationType,
  );
  expect(matching).toHaveLength(1);
  return matching[0];
}

function createFullValidator(): U0FullValidationService {
  return new U0FullValidationService(
    new PythonU0FullPackageValidatorAdapter({
      pythonExecutable: process.env.WL31_U0_PYTHON?.trim() || 'python3',
      contractRoot: resolve(
        process.cwd(),
        'server/runtime-assets/technical-publication-parsed-package/v1-frozen-2',
      ),
      contractCommit: U0_CONTRACT_COMMIT,
      validatorRevision: 'airbus-operator-transmission-actual-files',
    }),
  );
}
