import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { recognizeHostNativePdfProfile } from '../../../server/modules/canonical-host/host-native-pdf-profile.registry';
import {
  buildFamilySectionTopology,
  buildSourceBoundSilDocumentReferences,
  buildSourceBoundSilPartNumberMatrix,
} from '../../../server/modules/professional-input/builders/family-section-topology.builder';
import { runProfessionalInputPipelineFromLayout } from '../../../server/modules/professional-input/builders/professional-input-pipeline';
import { PdfjsDistLayoutExtractor } from '../../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import type {
  SourceUnit,
  StructuredParsePackage,
} from '../../../server/modules/professional-input/pure/professional-input-pure.types';
import { Frozen2CandidateReaderService } from '../../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { PythonU0FullPackageValidatorAdapter } from '../../../server/modules/unified-reader/python-u0-full-package-validator.adapter';
import { U0FullValidationService } from '../../../server/modules/unified-reader/u0-full-validation.service';
import { sha256Raw } from '../../../server/modules/unified-reader/unified-reader.utils';

const SIL_PATH = process.env.WL31_REAL_HONEYWELL_SIL_PDF_PATH?.trim();
const describeActualHoneywellSil = SIL_PATH ? describe : describe.skip;
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

describeActualHoneywellSil(
  'professional-input Honeywell SIL A-H topology and typed source facts with actual bytes',
  () => {
    jest.setTimeout(120_000);

    it('preserves the cross-page part-number matrix, Boeing references and missing recommendation section', async () => {
      const pipeline = await actualHoneywellSilPipeline();
      const observations = structuredObservations(pipeline.pkg);
      const windows = observations.filter(
        (observation) => observation.observationType === 'SECTION_WINDOW',
      );
      expect(
        windows.map((observation) => observation.value.sectionKey),
      ).toEqual([
        'subject',
        'effectivity',
        'reason',
        'references',
        'summary',
        'contact_information',
        'summary_of_change',
        'revision_history',
      ]);
      expect(
        windows.find((observation) => observation.value.sectionKey === 'reason')
          ?.value,
      ).toMatchObject({
        semanticBodyState: 'CONTENT',
        pageStart: 1,
        pageEnd: 2,
      });
      expect(
        windows.find(
          (observation) => observation.value.sectionKey === 'revision_history',
        )?.value,
      ).toMatchObject({ pageStart: 4, pageEnd: 4 });

      const matrix = singleObservation(observations, 'SIL_PART_NUMBER_MATRIX');
      expect(matrix.value).toMatchObject({
        sectionKey: 'reason',
        tableNumber: '1',
        rowsStructured: true,
        unstructuredReason: null,
        columns: [
          'name',
          'hardware_part_number',
          'software_part_number',
          'media_part_number',
        ],
      });
      const rows = matrix.value.rows as Array<{
        rowName: string;
        hardwarePartNumberRaw: string;
        softwarePartNumberRaw: string;
        mediaPartNumberRaw: string;
        sourceUnitIds: string[];
        sourceRefIds: string[];
      }>;
      expect(rows).toEqual([
        expect.objectContaining({
          rowName: 'DEU I Hardware',
          hardwarePartNumberRaw: '4081600-930',
          softwarePartNumberRaw: '3114-HNP-01A-11',
          mediaPartNumberRaw: 'PS4081855-911',
        }),
        expect.objectContaining({
          rowName: 'DEU II Hardware',
          hardwarePartNumberRaw: '4081600-940',
          softwarePartNumberRaw: 'HNP5C-AL02-6003',
          mediaPartNumberRaw: 'HNP5E-AM01-6003',
        }),
        expect.objectContaining({
          rowName: 'DUDB Software',
          hardwarePartNumberRaw: 'CDS BP 2015',
          softwarePartNumberRaw: '3111-HNP-03A-07',
          mediaPartNumberRaw: 'PS4081887-907',
        }),
      ]);
      expect(
        rows.every(
          (row) =>
            row.sourceUnitIds.length === 1 && row.sourceRefIds.length > 0,
        ),
      ).toBe(true);

      const references = singleObservation(
        observations,
        'SIL_DOCUMENT_REFERENCES',
      );
      expect(references.value).toMatchObject({
        sectionKey: 'references',
        referencesStructured: true,
        unstructuredReason: null,
        subsequentRevisionsAcceptableByDefault: true,
      });
      expect(
        (references.value.references as Array<Record<string, unknown>>).map(
          (reference) => [
            reference.issuerAuthority,
            reference.targetDocumentKind,
            reference.targetDocumentCode,
          ],
        ),
      ).toEqual([
        ['BOEING', 'SERVICE_LETTER', '737-SL-31-074'],
        ['BOEING', 'SERVICE_BULLETIN', '737-31A1880'],
      ]);

      expect(
        singleObservation(observations, 'SIL_RECOMMENDATION_SECTION_STATUS')
          .value,
      ).toMatchObject({
        semanticState: 'SOURCE_ABSENT',
        reason: 'COMPLETE_A_TO_H_PUBLICATION_HAS_NO_RECOMMENDATION_SECTION',
      });
      expect(pipeline.pkg.applicability).toEqual({
        sourceExpressions: [],
        normalizedCandidates: [],
        assignments: [],
      });

      const reader = new Frozen2CandidateReaderService().read(
        pipeline.u0Input.artifact,
        pipeline.u0Input.bytes,
        'PS4081887-907',
      );
      expect(reader.queryResults.length).toBeGreaterThan(0);
      expect(
        reader.queryResults.every((result) => result.sourceRefIds.length > 0),
      ).toBe(true);
    });

    it('fails closed on incomplete or reordered A-H topology and ambiguous typed rows or references', async () => {
      const pipeline = await actualHoneywellSilPipeline();
      const identity = honeywellSilIdentity();
      const missingSubject = replaceUnitText(
        pipeline.unitSet.units,
        'A.Subject',
        'A.Unrecognized',
      );
      expect(
        buildFamilySectionTopology({
          unitSet: { ...pipeline.unitSet, units: missingSubject },
          document: identity,
        }),
      ).toEqual([]);
      expect(
        buildFamilySectionTopology({
          unitSet: pipeline.unitSet,
          document: {
            ...identity,
            documentCode: '737-SL-31-074',
          },
        }),
      ).toEqual([]);

      const reversed = pipeline.unitSet.units.map((unit) => ({
        ...unit,
        text:
          unit.text === 'B.Effectivity'
            ? 'C.Reason'
            : unit.text === 'C.Reason'
              ? 'B.Effectivity'
              : unit.text,
      }));
      expect(
        buildFamilySectionTopology({
          unitSet: { ...pipeline.unitSet, units: reversed },
          document: identity,
        }),
      ).toEqual([]);

      const topology = buildFamilySectionTopology({
        unitSet: pipeline.unitSet,
        document: identity,
      });
      const reason = topology.find(
        (section) => section.sectionKey === 'reason',
      );
      const references = topology.find(
        (section) => section.sectionKey === 'references',
      );
      expect(reason).toBeDefined();
      expect(references).toBeDefined();

      const incompleteRow = {
        ...(reason as NonNullable<typeof reason>),
        bodyUnits: (reason?.bodyUnits ?? []).map((unit) => ({
          ...unit,
          text: unit.text.replace('PN HNP5E-AM01-6003', 'HNP5E-AM01-6003'),
        })),
      };
      expect(buildSourceBoundSilPartNumberMatrix(incompleteRow)).toMatchObject({
        rowsStructured: false,
        unstructuredReason: 'TABLE_ROW_UNRESOLVED',
        rows: [],
      });

      const unresolvedReference = {
        ...(references as NonNullable<typeof references>),
        bodyUnits: (references?.bodyUnits ?? []).map((unit) => ({
          ...unit,
          text: unit.text.replace(
            'Publication Number 737-31A1880',
            'unresolved publication',
          ),
        })),
      };
      expect(
        buildSourceBoundSilDocumentReferences(unresolvedReference),
      ).toMatchObject({
        referencesStructured: false,
        unstructuredReason: 'REFERENCE_ENTRY_UNRESOLVED',
        references: [],
      });
    });
  },
);

async function actualHoneywellSilPipeline() {
  const sourceBytes = await readFile(SIL_PATH as string);
  expect(sourceBytes.byteLength).toBe(141_487);
  expect(sha256Raw(sourceBytes)).toBe(
    'fd12b19c6e8999b2821e6dcf51273c49b94f9085f58629c727817b27759bfbec',
  );
  const layout = new PdfjsDistLayoutExtractor().extractLayout(sourceBytes);
  expect(layout.pageCount).toBe(4);
  expect(recognizeHostNativePdfProfile(layout, 'SIL')).toMatchObject({
    adapterId: 'issuer.honeywell.sil.v1',
    family: 'SIL',
    issuerAuthority: 'HONEYWELL',
    parseProfileRef: 'honeywell.sil',
    documentType: 'service_information_letter',
  });
  const pipeline = runProfessionalInputPipelineFromLayout(layout, {
    artifact: {
      artifactRef: 'fixture://professional-input/D201908000037.pdf',
      normalizedPath: 'D201908000037.pdf',
    },
    document: honeywellSilIdentity(),
    lineage: {
      generatedAt: '2026-09-03T00:00:00.000Z',
      producerName: 'professional-input-actual-honeywell-sil-structure-test',
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

function honeywellSilIdentity() {
  return {
    documentCode: 'D201908000037',
    documentType: 'service_information_letter' as const,
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
      validatorRevision: 'honeywell-sil-structure-actual-file',
    }),
  );
}
