import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { recognizeHostNativePdfProfile } from '../../../server/modules/canonical-host/host-native-pdf-profile.registry';
import { runProfessionalInputPipelineFromLayout } from '../../../server/modules/professional-input/builders/professional-input-pipeline';
import { PdfjsDistLayoutExtractor } from '../../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import type { StructuredParsePackage } from '../../../server/modules/professional-input/pure/professional-input-pure.types';
import { Frozen2CandidateReaderService } from '../../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { PythonU0FullPackageValidatorAdapter } from '../../../server/modules/unified-reader/python-u0-full-package-validator.adapter';
import { U0FullValidationService } from '../../../server/modules/unified-reader/u0-full-validation.service';
import { sha256Raw } from '../../../server/modules/unified-reader/unified-reader.utils';

const NONE_FIXTURE_PATH = process.env.WL31_REAL_AIRBUS_SB_NONE_PATH?.trim();
const RELATION_FIXTURE_PATH =
  process.env.WL31_REAL_AIRBUS_SB_RELATION_PATH?.trim();
const describeActualAirbusSb =
  NONE_FIXTURE_PATH && RELATION_FIXTURE_PATH ? describe : describe.skip;
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

describeActualAirbusSb(
  'professional-input Airbus SB state and relation topology with actual bytes',
  () => {
    jest.setTimeout(120_000);

    it('preserves Summary and Planning explicit NONE as separate scoped facts', async () => {
      const pipeline = await actualAirbusSbPipeline({
        path: NONE_FIXTURE_PATH as string,
        expectedBytes: 309_661,
        expectedSha256:
          '41ae66e1610bea202f4dff7346c0147b817269f988c26093ff3cd0a49d436877',
        expectedPages: 22,
        documentCode: 'A330-55-3054',
      });
      const observations = structuredObservations(pipeline.pkg);
      const concurrent = observations.filter(
        (observation) =>
          observation.observationType === 'CONCURRENT_REQUIREMENTS',
      );
      expect(concurrent).toHaveLength(2);
      expect(
        concurrent.map((observation) => observation.value.scopeKey),
      ).toEqual(['summary', 'planning_information']);
      expect(
        concurrent.every(
          (observation) =>
            observation.value.semanticState === 'NONE' &&
            observation.value.requirementsStructured === true &&
            Array.isArray(observation.value.requirements) &&
            observation.value.requirements.length === 0 &&
            Array.isArray(observation.value.relationGroups) &&
            observation.value.relationGroups.length === 0,
        ),
      ).toBe(true);
      expect(
        concurrent.every(
          (observation) =>
            observation.unit.sourceRefIds.length === 1 &&
            observation.unit.sourceSegmentIds.length === 1,
        ),
      ).toBe(true);
      const textsBySegmentId = new Map(
        pipeline.unitSet.units.map((unit) => [unit.sourceUnitId, unit.text]),
      );
      expect(
        concurrent.map((observation) =>
          textsBySegmentId.get(observation.unit.sourceSegmentIds[0]),
        ),
      ).toEqual(['None', 'None']);

      const reader = new Frozen2CandidateReaderService().read(
        pipeline.u0Input.artifact,
        pipeline.u0Input.bytes,
        'CONCURRENT_REQUIREMENTS',
      );
      expect(reader.queryResults.length).toBeGreaterThanOrEqual(2);
      expect(
        reader.queryResults.every((result) => result.sourceRefIds.length > 0),
      ).toBe(true);
    });

    it('preserves conditional prerequisite plus an ANY relation group in both scopes', async () => {
      const pipeline = await actualAirbusSbPipeline({
        path: RELATION_FIXTURE_PATH as string,
        expectedBytes: 479_258,
        expectedSha256:
          '7c247a9e7e3cdb2518ec071254d2ef462500d3c42d4142b44c9c755924a2e5cd',
        expectedPages: 26,
        documentCode: 'A350-29-P053',
      });
      const concurrent = structuredObservations(pipeline.pkg).filter(
        (observation) =>
          observation.observationType === 'CONCURRENT_REQUIREMENTS',
      );
      expect(concurrent).toHaveLength(2);
      expect(
        concurrent.map((observation) => observation.value.scopeKey),
      ).toEqual(['summary', 'planning_information']);
      for (const observation of concurrent) {
        expect(observation.value).toMatchObject({
          semanticState: 'CONTENT',
          requirementsStructured: true,
        });
        const requirements = observation.value.requirements as Array<{
          targetDocumentCode: string;
          modificationCode: string | null;
          modality: string;
          conditionRaw: string | null;
          sourceRefIds: string[];
        }>;
        expect(
          requirements.map((requirement) => requirement.targetDocumentCode),
        ).toEqual(['A350-29-P013', 'A350-29-P051', 'A350-29-P052']);
        expect(
          requirements.map((requirement) => requirement.modificationCode),
        ).toEqual(['112192L43554', '120342L49157', '120343L44523']);
        expect(requirements[0]).toMatchObject({
          modality: 'CONDITIONAL',
          conditionRaw: expect.stringMatching(
            /concurrent requirement if MOD No\. 112192L43554 has not been embodied before delivery/iu,
          ),
        });
        expect(
          requirements.slice(1).map((requirement) => requirement.modality),
        ).toEqual(['REQUIRED', 'REQUIRED']);
        expect(
          requirements.every(
            (requirement) => requirement.sourceRefIds.length > 0,
          ),
        ).toBe(true);
        expect(observation.value.relationGroups).toEqual([
          expect.objectContaining({
            operator: 'ANY',
            memberDocumentCodes: ['A350-29-P051', 'A350-29-P052'],
            sourceRefIds: expect.any(Array),
          }),
        ]);
      }

      const reader = new Frozen2CandidateReaderService().read(
        pipeline.u0Input.artifact,
        pipeline.u0Input.bytes,
        'A350-29-P013',
      );
      expect(reader.queryResults.length).toBeGreaterThan(0);
      expect(
        reader.queryResults.every((result) => result.sourceRefIds.length > 0),
      ).toBe(true);
    });
  },
);

async function actualAirbusSbPipeline(input: {
  path: string;
  expectedBytes: number;
  expectedSha256: string;
  expectedPages: number;
  documentCode: string;
}) {
  const sourceBytes = await readFile(input.path);
  expect(sourceBytes.byteLength).toBe(input.expectedBytes);
  expect(sha256Raw(sourceBytes)).toBe(input.expectedSha256);
  const layout = new PdfjsDistLayoutExtractor().extractLayout(sourceBytes);
  expect(layout.pageCount).toBe(input.expectedPages);
  expect(recognizeHostNativePdfProfile(layout, 'SB')).toMatchObject({
    adapterId: 'issuer.airbus.service_bulletin.v1',
    family: 'SB',
    parseProfileRef: 'airbus.sb',
    documentType: 'service_bulletin',
  });
  const pipeline = runProfessionalInputPipelineFromLayout(layout, {
    artifact: {
      artifactRef: `fixture://professional-input/${input.documentCode}.pdf`,
      normalizedPath: `${input.documentCode}.pdf`,
    },
    document: {
      documentCode: input.documentCode,
      documentType: 'service_bulletin',
      language: 'en-US',
    },
    lineage: {
      generatedAt: '2026-09-03T00:00:00.000Z',
      producerName: 'professional-input-actual-airbus-sb-structure-test',
      producerVersion: '1.0.0',
    },
  });
  await expect(
    createFullValidator(input.documentCode).validate(pipeline.u0Input),
  ).resolves.toMatchObject({
    status: 'FULL_STRICT_VALIDATOR_PASSED',
    packageId: pipeline.pkg.packageId,
  });
  return pipeline;
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

function createFullValidator(
  validatorRevision: string,
): U0FullValidationService {
  return new U0FullValidationService(
    new PythonU0FullPackageValidatorAdapter({
      pythonExecutable: process.env.WL31_U0_PYTHON?.trim() || 'python3',
      contractRoot: resolve(
        process.cwd(),
        'server/runtime-assets/technical-publication-parsed-package/v1-frozen-2',
      ),
      contractCommit: U0_CONTRACT_COMMIT,
      validatorRevision: `airbus-sb-structure-${validatorRevision}`,
    }),
  );
}
