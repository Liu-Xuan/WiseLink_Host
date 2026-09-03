import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { recognizeHostNativePdfProfile } from '../../../server/modules/canonical-host/host-native-pdf-profile.registry';
import {
  buildSourceBoundRilDocumentReferences,
  buildSourceBoundRilGeneralEvaluation,
  buildSourceBoundRilPageChrome,
  buildSourceBoundRilProcedure,
} from '../../../server/modules/professional-input/builders/airbus-ril-structure.builder';
import { buildFamilySectionTopology } from '../../../server/modules/professional-input/builders/family-section-topology.builder';
import { runProfessionalInputPipelineFromLayout } from '../../../server/modules/professional-input/builders/professional-input-pipeline';
import { PdfjsDistLayoutExtractor } from '../../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import type {
  SourceUnit,
  SourceUnitSet,
  StructuredParsePackage,
} from '../../../server/modules/professional-input/pure/professional-input-pure.types';
import { Frozen2CandidateReaderService } from '../../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { PythonU0FullPackageValidatorAdapter } from '../../../server/modules/unified-reader/python-u0-full-package-validator.adapter';
import { U0FullValidationService } from '../../../server/modules/unified-reader/u0-full-validation.service';
import { sha256Raw } from '../../../server/modules/unified-reader/unified-reader.utils';

const RIL_PATH = process.env.WL31_REAL_AIRBUS_RIL_PDF_PATH?.trim();
const describeActualAirbusRil = RIL_PATH ? describe : describe.skip;
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

describeActualAirbusRil(
  'professional-input Airbus RIL topology and source-bound typed facts with actual bytes',
  () => {
    jest.setTimeout(120_000);

    it('reconstructs repeated chrome, the evaluation, seven references and six geometry-bound actions', async () => {
      const pipeline = await actualAirbusRilPipeline();
      const observations = structuredObservations(pipeline.pkg);
      const windows = observations.filter(
        (observation) => observation.observationType === 'SECTION_WINDOW',
      );
      expect(
        windows.map((observation) => [
          observation.value.ordinal,
          observation.value.sectionKey,
        ]),
      ).toEqual([
        ['1', 'general_evaluation'],
        ['2', 'document_references'],
        ['3', 'context'],
        ['4', 'retrofit_procedure'],
        ['5', 'material'],
        ['5.1', 'availability'],
        ['5.2', 'list_of_material'],
        ['5.3', 'ordering'],
        ['6', 'industry_support'],
        ['7', 'reporting'],
      ]);
      expect(
        windows.find((observation) => observation.value.ordinal === '5.3')
          ?.value,
      ).toMatchObject({ pageStart: 6, pageEnd: 7 });

      const chrome = singleObservation(observations, 'RIL_PAGE_CHROME');
      expect(chrome.value).toMatchObject({
        chromeStructured: true,
        repeatedSignatureCount: 5,
        chromeUnitCount: 35,
        pageCounts: Array.from({ length: 7 }, (_, index) => ({
          page: index + 1,
          count: 5,
        })),
      });
      const chromeSourceIds = new Set(chrome.value.sourceUnitIds as string[]);
      expect(
        pipeline.unitSet.units
          .filter((unit) => /^FCRM on /u.test(unit.text))
          .every((unit) => !chromeSourceIds.has(unit.sourceUnitId)),
      ).toBe(true);

      const evaluation = singleObservation(
        observations,
        'RIL_GENERAL_EVALUATION',
      );
      expect(evaluation.value).toMatchObject({
        evaluationStructured: true,
        unstructuredReason: null,
        recommendedOpportunityRaw: 'Line Maintenance',
        monitoringEndDate: '2027-11-12',
        mandatoryAuthorities: [
          {
            issuerAuthority: 'EASA',
            targetDocumentCode: 'EASA AD 2025-0008',
            effectiveDate: '2025-01-23',
          },
          {
            issuerAuthority: 'FAA',
            targetDocumentCode: 'FAA AD 2026-03-01',
            effectiveDate: '2026-03-09',
          },
        ],
      });

      const references = singleObservation(
        observations,
        'RIL_DOCUMENT_REFERENCES',
      );
      expect(references.value).toMatchObject({
        referencesStructured: true,
        unstructuredReason: null,
      });
      expect(
        (references.value.references as Array<Record<string, unknown>>).map(
          (reference) => [
            reference.targetDocumentKind,
            reference.targetDocumentCode,
          ],
        ),
      ).toEqual([
        ['AIRWORTHINESS_DIRECTIVE', 'EASA AD 2025-0008'],
        ['AIRWORTHINESS_DIRECTIVE', 'FAA AD 2026-03-01'],
        ['TECHNICAL_FOLLOW_UP', 'TFU 27.00.00116'],
        ['SERVICE_BULLETIN', 'A350-27-P067'],
        ['SERVICE_BULLETIN', 'A350-27-P068'],
        ['SERVICE_BULLETIN', 'A350-27-P069'],
        ['ALL_OPERATORS_TRANSMISSION', 'AOT A27P021-25'],
      ]);

      const procedure = singleObservation(
        observations,
        'RIL_RETROFIT_PROCEDURE',
      );
      const actions = procedure.value.actions as Array<{
        actionOrdinal: number;
        actionTextRaw: string;
        sourceUnitIds: string[];
        sourceRefIds: string[];
      }>;
      expect(procedure.value).toMatchObject({
        procedureStructured: true,
        unstructuredReason: null,
      });
      expect(actions.map((action) => action.actionOrdinal)).toEqual([
        1, 2, 3, 4, 5, 6,
      ]);
      expect(actions[1].actionTextRaw).toBe(
        'Send the Inspection Report with PN, SN, FH and FC for each FCRM of the aircraft (22 in total) to monitored.retrofit@airbus.com and attach the respective inspection report on AirbusWorld.',
      );
      expect(actions[3].actionTextRaw).toContain('Place your PO');
      expect(actions[4].actionTextRaw).toContain('9000FC / 50000FH');
      expect(
        actions.every(
          (action) =>
            action.sourceUnitIds.length > 0 && action.sourceRefIds.length > 0,
        ),
      ).toBe(true);
      expect(procedure.value.noteRaw).toContain('CA71323-017');
      expect(pipeline.pkg.applicability).toEqual({
        sourceExpressions: [],
        normalizedCandidates: [],
        assignments: [],
      });

      const reader = new Frozen2CandidateReaderService().read(
        pipeline.u0Input.artifact,
        pipeline.u0Input.bytes,
        '9000FC',
      );
      expect(reader.queryResults.length).toBeGreaterThan(0);
      expect(
        reader.queryResults.every((result) => result.sourceRefIds.length > 0),
      ).toBe(true);
    });

    it('fails closed when the source topology, typed rows or procedure geometry are ambiguous', async () => {
      const pipeline = await actualAirbusRilPipeline();
      const identity = airbusRilIdentity();
      expect(
        buildFamilySectionTopology({
          unitSet: {
            ...pipeline.unitSet,
            units: replaceUnitText(
              pipeline.unitSet.units,
              '5.3ORDERING',
              '5.3UNRECOGNIZED',
            ),
          },
          document: identity,
        }),
      ).toEqual([]);
      expect(
        buildFamilySectionTopology({
          unitSet: pipeline.unitSet,
          document: { ...identity, documentCode: 'V27M24009999' },
        }),
      ).toEqual([]);

      const topology = buildFamilySectionTopology({
        unitSet: pipeline.unitSet,
        document: identity,
      });
      const evaluation = requiredSection(topology, 'general_evaluation');
      const references = requiredSection(topology, 'document_references');
      const procedure = requiredSection(topology, 'retrofit_procedure');

      expect(
        buildSourceBoundRilGeneralEvaluation(
          {
            ...evaluation,
            bodyUnits: replaceUnitText(
              evaluation.bodyUnits,
              'FAA AD 2026-03-01 - Effective date 09-MAR-2026',
              'FAA AD unresolved',
            ),
          },
          pipeline.unitSet,
        ),
      ).toMatchObject({
        evaluationStructured: false,
        unstructuredReason: 'MANDATORY_AUTHORITY_UNRESOLVED',
        mandatoryAuthorities: [],
      });

      expect(
        buildSourceBoundRilDocumentReferences(
          {
            ...references,
            bodyUnits: references.bodyUnits.map((unit) => ({
              ...unit,
              text: unit.text.replace('TFU27.00.00116', 'TFU unresolved'),
            })),
          },
          identity.documentCode,
          pipeline.unitSet,
        ),
      ).toMatchObject({
        referencesStructured: false,
        unstructuredReason: 'REFERENCE_ENTRY_UNRESOLVED',
        references: [],
      });
      expect(
        buildSourceBoundRilDocumentReferences(
          {
            ...references,
            bodyUnits: references.bodyUnits.map((unit) => ({
              ...unit,
              text: unit.text.replace(
                'TFU27.00.00116A350',
                'TFU27.00.00116-R1A350',
              ),
            })),
          },
          identity.documentCode,
          pipeline.unitSet,
        ),
      ).toMatchObject({
        referencesStructured: false,
        unstructuredReason: 'REFERENCE_ENTRY_UNRESOLVED',
        references: [],
      });

      const markerFour = procedure.bodyUnits.find(
        (unit) => unit.text.trim() === '4',
      );
      expect(markerFour).toBeDefined();
      const markerRefId = markerFour?.sourceRefIds[0] as string;
      const displaced: SourceUnitSet = {
        ...pipeline.unitSet,
        sourceRefs: pipeline.unitSet.sourceRefs.map((sourceRef) =>
          sourceRef.sourceRefId === markerRefId
            ? {
                ...sourceRef,
                bbox: [
                  sourceRef.bbox[0] + 50_000,
                  sourceRef.bbox[1],
                  sourceRef.bbox[2] + 50_000,
                  sourceRef.bbox[3],
                ],
              }
            : sourceRef,
        ),
      };
      expect(buildSourceBoundRilProcedure(procedure, displaced)).toMatchObject({
        procedureStructured: false,
        unstructuredReason: 'STEP_MARKERS_UNRESOLVED',
        actions: [],
      });

      const chrome = buildSourceBoundRilPageChrome(pipeline.unitSet);
      expect(chrome.chromeUnitCount).toBe(35);
      expect(chrome.pageCounts).toHaveLength(7);
    });
  },
);

async function actualAirbusRilPipeline() {
  const sourceBytes = await readFile(RIL_PATH as string);
  expect(sourceBytes.byteLength).toBe(1_295_774);
  expect(sha256Raw(sourceBytes)).toBe(
    'c4e55c4ca7fedafbc42dd57c318161f2f435cb1321a226a72a62eb74e84b17ff',
  );
  const layout = new PdfjsDistLayoutExtractor().extractLayout(sourceBytes);
  expect(layout.pageCount).toBe(7);
  expect(recognizeHostNativePdfProfile(layout, 'SB')).toMatchObject({
    adapterId: 'issuer.airbus.retrofit_information_letter.v1',
    family: 'SB',
    issuerAuthority: 'AIRBUS',
    parseProfileRef: 'airbus.retrofit_information_letter',
    documentType: 'retrofit_information_letter',
  });
  const pipeline = runProfessionalInputPipelineFromLayout(layout, {
    artifact: {
      artifactRef: 'fixture://professional-input/V27M24001856.pdf',
      normalizedPath: 'RIL V27M24001856 R03.pdf',
    },
    document: airbusRilIdentity(),
    lineage: {
      generatedAt: '2026-09-03T00:00:00.000Z',
      producerName: 'professional-input-actual-airbus-ril-structure-test',
      producerVersion: '1.0.0',
    },
  });
  await expect(
    createFullValidator().validate(pipeline.u0Input),
  ).resolves.toMatchObject({
    status: 'FULL_STRICT_VALIDATOR_PASSED',
    packageId: pipeline.pkg.packageId,
  });
  return pipeline;
}

function airbusRilIdentity() {
  return {
    documentCode: 'V27M24001856',
    documentType: 'retrofit_information_letter' as const,
    language: 'en-US',
  };
}

function replaceUnitText(
  units: readonly SourceUnit[],
  source: string,
  replacement: string,
): SourceUnit[] {
  return units.map((unit) => ({
    ...unit,
    text: unit.text === source ? replacement : unit.text,
  }));
}

function requiredSection(
  sections: readonly ReturnType<typeof buildFamilySectionTopology>[number][],
  sectionKey: string,
) {
  const section = sections.find((value) => value.sectionKey === sectionKey);
  expect(section).toBeDefined();
  return section as NonNullable<typeof section>;
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
      validatorRevision: 'airbus-ril-structure-actual-file',
    }),
  );
}
