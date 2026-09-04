import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { recognizeHostNativePdfProfile } from '../../../server/modules/canonical-host/host-native-pdf-profile.registry';
import {
  buildFamilySectionTopology,
  buildSourceBoundSlReferenceCatalog,
} from '../../../server/modules/professional-input/builders/family-section-topology.builder';
import { runProfessionalInputPipelineFromLayout } from '../../../server/modules/professional-input/builders/professional-input-pipeline';
import { PdfjsDistLayoutExtractor } from '../../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import type { StructuredParsePackage } from '../../../server/modules/professional-input/pure/professional-input-pure.types';
import { Frozen2CandidateReaderService } from '../../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { PythonU0FullPackageValidatorAdapter } from '../../../server/modules/unified-reader/python-u0-full-package-validator.adapter';
import { U0FullValidationService } from '../../../server/modules/unified-reader/u0-full-validation.service';
import { sha256Raw } from '../../../server/modules/unified-reader/unified-reader.utils';

const SL_777_PATH = process.env.WL31_REAL_BOEING_SL_777_PATH?.trim();
const SL_787_PATH = process.env.WL31_REAL_BOEING_SL_787_PATH?.trim();
const describeActualBoeingSl =
  SL_777_PATH && SL_787_PATH ? describe : describe.skip;
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

describeActualBoeingSl(
  'professional-input Boeing SL scoped sections, reference catalog and actions with actual bytes',
  () => {
    jest.setTimeout(120_000);

    it('preserves standalone labels, cross-page references and the optional supplier action', async () => {
      const pipeline = await actualBoeingSlPipeline({
        path: SL_777_PATH as string,
        expectedBytes: 59_629,
        expectedSha256:
          '06cdf55f6f4531b4613fbecfa0b77fbd009c783bbb7f982de91188210ef9afb9',
        expectedPages: 8,
        documentCode: '777-SL-31-064',
      });
      const observations = structuredObservations(pipeline.pkg);
      const windows = observations.filter(
        (observation) => observation.observationType === 'SECTION_WINDOW',
      );
      expect(
        windows.map((observation) => observation.value.sectionKey),
      ).toEqual([
        'subject',
        'applicability',
        'references',
        'background',
        'boeing_action',
        'supplier_action',
        'suggested_operator_action',
      ]);
      expect(
        windows.find(
          (observation) => observation.value.sectionKey === 'subject',
        )?.unit.sourceSegmentIds,
      ).toHaveLength(2);
      expect(
        windows.find(
          (observation) => observation.value.sectionKey === 'references',
        )?.value,
      ).toMatchObject({
        semanticBodyState: 'CONTENT',
        pageStart: 1,
        pageEnd: 2,
      });

      const catalog = singleObservation(observations, 'SL_REFERENCE_CATALOG');
      expect(catalog.value).toMatchObject({
        referencesStructured: true,
        unstructuredReason: null,
      });
      const entries = catalog.value.entries as Array<{
        referenceLabel: string;
        referenceKind: string;
        targetDocumentCode: string | null;
        rawText: string;
        sourceUnitIds: string[];
        sourceRefIds: string[];
      }>;
      expect(entries.map((entry) => entry.referenceLabel)).toEqual(
        'abcdefghijklmn'.split(''),
      );
      expect(entries).toHaveLength(14);
      expect(
        entries.find((entry) => entry.referenceLabel === 'm'),
      ).toMatchObject({
        referenceKind: 'SERVICE_INFORMATION_LETTER',
        targetDocumentCode: 'D202404004340',
        rawText: 'Service Information Letter (SIL)Honeywell SIL D202404004340',
      });
      expect(
        entries.find((entry) => entry.referenceLabel === 'm')?.sourceUnitIds,
      ).toHaveLength(2);
      expect(
        entries.find((entry) => entry.referenceLabel === 'n'),
      ).toMatchObject({
        referenceKind: 'AIRPLANE_CONFIGURATION_BULLETIN',
        targetDocumentCode: '2022-ACB-0020-2',
      });
      expect(
        entries.every(
          (entry) =>
            entry.sourceUnitIds.length > 0 && entry.sourceRefIds.length > 0,
        ),
      ).toBe(true);

      const relations = observations.filter(
        (observation) =>
          observation.observationType === 'SL_REFERENCE_RELATIONS',
      );
      expect(
        relations.map((observation) => ({
          sectionKey: observation.value.sectionKey,
          labels: (
            (observation.value.relations ?? []) as Array<{
              referenceLabel: string;
            }>
          ).map((relation) => relation.referenceLabel),
        })),
      ).toEqual([
        { sectionKey: 'background', labels: ['a', 'b', 'c'] },
        { sectionKey: 'boeing_action', labels: ['a', 'b', 'c'] },
        { sectionKey: 'supplier_action', labels: ['a', 'b', 'c'] },
        {
          sectionKey: 'suggested_operator_action',
          labels: ['a', 'b', 'c', 'd'],
        },
      ]);
      expect(
        relations.reduce(
          (count, observation) =>
            count + ((observation.value.relations ?? []) as unknown[]).length,
          0,
        ),
      ).toBe(13);
      expect(
        observations
          .filter((observation) => observation.observationType === 'SL_ACTION')
          .map((observation) => observation.value.actionRole),
      ).toEqual([
        'BOEING_ACTION',
        'SUPPLIER_ACTION',
        'OPERATOR_RECOMMENDATION',
      ]);
      expect(
        observations.filter(
          (observation) =>
            observation.observationType === 'SECTION_ANCHOR' &&
            observation.value.sectionKey === 'suggested_operator_action',
        ),
      ).toHaveLength(1);

      const missingActionUnits = pipeline.unitSet.units.map((unit) => ({
        ...unit,
        text:
          unit.text === 'BOEING ACTION:'
            ? 'UNRECOGNIZED OEM ACTION:'
            : unit.text,
      }));
      expect(
        buildFamilySectionTopology({
          unitSet: { ...pipeline.unitSet, units: missingActionUnits },
          document: serviceLetterIdentity('777-SL-31-064'),
        }),
      ).toEqual([]);

      const reversedActionUnits = pipeline.unitSet.units.map((unit) => ({
        ...unit,
        text:
          unit.text === 'BOEING ACTION:'
            ? 'SUGGESTED OPERATOR ACTION:'
            : unit.text === 'SUGGESTED OPERATOR ACTION:'
              ? 'BOEING ACTION:'
              : unit.text,
      }));
      expect(
        buildFamilySectionTopology({
          unitSet: { ...pipeline.unitSet, units: reversedActionUnits },
          document: serviceLetterIdentity('777-SL-31-064'),
        }),
      ).toEqual([]);

      assertReaderQuery(pipeline, 'D202404004340');
    });

    it('preserves inline label bodies, split references and valid missing Supplier Action', async () => {
      const pipeline = await actualBoeingSlPipeline({
        path: SL_787_PATH as string,
        expectedBytes: 106_940,
        expectedSha256:
          '444af0c6947b1ed94989cbfb5fc50c37448028ec578b75e5198bf5072f754240',
        expectedPages: 11,
        documentCode: '787-SL-46-034-B',
      });
      const observations = structuredObservations(pipeline.pkg);
      const windows = observations.filter(
        (observation) => observation.observationType === 'SECTION_WINDOW',
      );
      expect(
        windows.map((observation) => observation.value.sectionKey),
      ).toEqual([
        'subject',
        'applicability',
        'references',
        'background',
        'boeing_action',
        'suggested_operator_action',
      ]);
      expect(
        windows.find(
          (observation) => observation.value.sectionKey === 'subject',
        )?.unit.sourceSegmentIds,
      ).toHaveLength(1);
      expect(
        windows.find(
          (observation) => observation.value.sectionKey === 'applicability',
        )?.unit.sourceSegmentIds,
      ).toHaveLength(5);
      expect(
        windows.some(
          (observation) =>
            observation.value.sectionKey === 'supplier_action' ||
            observation.value.sectionKey === 'attachment_boundary' ||
            observation.value.sectionKey === 'interchangeability',
        ),
      ).toBe(false);

      const catalog = singleObservation(observations, 'SL_REFERENCE_CATALOG');
      expect(catalog.value).toMatchObject({
        referencesStructured: true,
        unstructuredReason: null,
      });
      const entries = catalog.value.entries as Array<{
        referenceLabel: string;
        referenceKind: string;
        targetDocumentCode: string | null;
        sourceUnitIds: string[];
      }>;
      expect(
        entries.map((entry) => [
          entry.referenceLabel,
          entry.referenceKind,
          entry.targetDocumentCode,
        ]),
      ).toEqual([
        ['a', 'AIRPLANE_CONFIGURATION_BULLETIN', 'B-S003-562-15-03705'],
        ['b', 'DRAWING', '246W0900'],
        ['c', 'SERVICE_BULLETIN', 'B787-81205-SB460008'],
        ['d', 'FLEET_TEAM_DIGEST', '787-FTD-46-14004'],
      ]);
      expect(
        entries.find((entry) => entry.referenceLabel === 'a')?.sourceUnitIds,
      ).toHaveLength(2);
      expect(
        entries.find((entry) => entry.referenceLabel === 'd')?.sourceUnitIds,
      ).toHaveLength(2);

      const relations = observations.filter(
        (observation) =>
          observation.observationType === 'SL_REFERENCE_RELATIONS',
      );
      expect(relations).toHaveLength(1);
      expect(relations[0].value).toMatchObject({
        sectionKey: 'background',
        relationsStructured: true,
        unstructuredReason: null,
      });
      expect(
        (relations[0].value.relations as Array<{ referenceLabel: string }>).map(
          (relation) => relation.referenceLabel,
        ),
      ).toEqual(['a']);
      expect(
        observations
          .filter((observation) => observation.observationType === 'SL_ACTION')
          .map((observation) => observation.value.actionRole),
      ).toEqual(['BOEING_ACTION', 'OPERATOR_RECOMMENDATION']);

      const topology = buildFamilySectionTopology({
        unitSet: pipeline.unitSet,
        document: serviceLetterIdentity('787-SL-46-034-B'),
      });
      const duplicateReferenceUnits = pipeline.unitSet.units.map((unit) => ({
        ...unit,
        text: unit.text.replace(/^b\)246W0900/u, 'a)246W0900'),
      }));
      const duplicateReferenceTopology = buildFamilySectionTopology({
        unitSet: { ...pipeline.unitSet, units: duplicateReferenceUnits },
        document: serviceLetterIdentity('787-SL-46-034-B'),
      });
      expect(
        buildSourceBoundSlReferenceCatalog(duplicateReferenceTopology),
      ).toMatchObject({
        referencesStructured: false,
        unstructuredReason: 'DUPLICATE_REFERENCE_LABEL',
        entries: [],
      });
      const referenceSection = topology.find(
        (section) => section.sectionKey === 'references',
      );
      expect(referenceSection).toBeDefined();
      expect(
        buildSourceBoundSlReferenceCatalog([
          ...topology.filter((section) => section.sectionKey !== 'references'),
          {
            ...(referenceSection as NonNullable<typeof referenceSection>),
            bodyUnits: (referenceSection?.bodyUnits ?? []).map((unit, index) =>
              index === 0
                ? { ...unit, text: unit.text.replace(/^REFERENCES:a\)/u, '') }
                : unit,
            ),
          },
        ]),
      ).toMatchObject({
        referencesStructured: false,
        unstructuredReason: 'ORPHAN_REFERENCE_CONTINUATION',
        entries: [],
      });

      const suggestedAnchor = pipeline.unitSet.units.find(
        (unit) => unit.text === 'SUGGESTED OPERATOR ACTION:',
      );
      expect(suggestedAnchor).toBeDefined();
      expect(
        buildFamilySectionTopology({
          unitSet: {
            ...pipeline.unitSet,
            units: [
              ...pipeline.unitSet.units,
              {
                ...(suggestedAnchor as NonNullable<typeof suggestedAnchor>),
                sourceUnitId: `${suggestedAnchor?.sourceUnitId}:duplicate`,
                continuityKey: `${suggestedAnchor?.continuityKey}:duplicate`,
                order: (suggestedAnchor?.order ?? 0) + 0.5,
              },
            ],
          },
          document: serviceLetterIdentity('787-SL-46-034-B'),
        }),
      ).toEqual([]);

      assertReaderQuery(pipeline, 'B787-81205-SB460008');
    });
  },
);

async function actualBoeingSlPipeline(input: {
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
  expect(recognizeHostNativePdfProfile(layout, 'SL')).toMatchObject({
    adapterId: 'issuer.boeing.service_letter.v1',
    family: 'SL',
    issuerAuthority: 'BOEING',
    parseProfileRef: 'boeing.sl',
    documentType: 'service_letter',
  });
  const pipeline = runProfessionalInputPipelineFromLayout(layout, {
    artifact: {
      artifactRef: `fixture://professional-input/${input.documentCode}.pdf`,
      normalizedPath: `${input.documentCode}.pdf`,
    },
    document: serviceLetterIdentity(input.documentCode),
    lineage: {
      generatedAt: '2026-09-03T00:00:00.000Z',
      producerName: 'professional-input-actual-boeing-sl-structure-test',
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

function serviceLetterIdentity(documentCode: string) {
  return {
    documentCode,
    documentType: 'service_letter' as const,
    language: 'en-US',
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

function assertReaderQuery(
  pipeline: Awaited<ReturnType<typeof actualBoeingSlPipeline>>,
  query: string,
): void {
  const reader = new Frozen2CandidateReaderService().read(
    pipeline.u0Input.artifact,
    pipeline.u0Input.bytes,
    query,
  );
  expect(reader.queryResults.length).toBeGreaterThan(0);
  expect(
    reader.queryResults.every((result) => result.sourceRefIds.length > 0),
  ).toBe(true);
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
      validatorRevision: `boeing-sl-structure-${validatorRevision}`,
    }),
  );
}
