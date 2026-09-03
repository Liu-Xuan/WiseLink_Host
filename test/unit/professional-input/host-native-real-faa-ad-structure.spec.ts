import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { recognizeHostNativePdfProfile } from '../../../server/modules/canonical-host/host-native-pdf-profile.registry';
import {
  buildFamilySectionTopology,
  buildSourceBoundAdObligations,
} from '../../../server/modules/professional-input/builders/family-section-topology.builder';
import { runProfessionalInputPipelineFromLayout } from '../../../server/modules/professional-input/builders/professional-input-pipeline';
import { PdfjsDistLayoutExtractor } from '../../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import type { StructuredParsePackage } from '../../../server/modules/professional-input/pure/professional-input-pure.types';
import { Frozen2CandidateReaderService } from '../../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { PythonU0FullPackageValidatorAdapter } from '../../../server/modules/unified-reader/python-u0-full-package-validator.adapter';
import { U0FullValidationService } from '../../../server/modules/unified-reader/u0-full-validation.service';
import { sha256Raw } from '../../../server/modules/unified-reader/unified-reader.utils';

const OLD_FIXTURE_PATH = process.env.WL31_REAL_FAA_AD_OLD_PATH?.trim();
const MODERN_FIXTURE_PATH = process.env.WL31_REAL_FAA_AD_MODERN_PATH?.trim();
const describeActualFaaAd =
  OLD_FIXTURE_PATH && MODERN_FIXTURE_PATH ? describe : describe.skip;
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

describeActualFaaAd(
  'professional-input FAA AD scoped sections, obligations and relations with actual bytes',
  () => {
    jest.setTimeout(120_000);

    it('preserves old-style body ordinals, named action sections and cross-page obligations', async () => {
      const pipeline = await actualFaaAdPipeline({
        path: OLD_FIXTURE_PATH as string,
        expectedBytes: 60_075,
        expectedSha256:
          'b2b56ba97edfc97a9ad41a7b40677864981e185ed95f39fd01404c2b83a4d166',
        expectedPages: 10,
        documentCode: 'AD-2011-03-14',
      });
      const observations = structuredObservations(pipeline.pkg);
      const windows = observations.filter(
        (observation) => observation.observationType === 'SECTION_WINDOW',
      );
      expect(
        windows.map((observation) => observation.value.sectionKey),
      ).toEqual([
        'effective_date',
        'affected_ads',
        'applicability',
        'subject',
        'unsafe_condition',
        'compliance',
        'installation_of_warning_indicator_lights',
        'activation_of_warning_indicator_lights',
        'airplane_flight_manual_afm_revisions',
        'terminating_action_for_affected_ads',
        'special_flight_permit',
        'alternative_methods_of_compliance',
        'related_information',
        'material_incorporated_by_reference',
      ]);
      expect(windows.map((observation) => observation.value.ordinal)).toEqual(
        'abcdefghijklmn'.split(''),
      );
      expect(
        windows.find(
          (observation) =>
            observation.value.sectionKey ===
            'installation_of_warning_indicator_lights',
        )?.value,
      ).toMatchObject({
        nodeKind: 'action',
        pageStart: 7,
        pageEnd: 8,
        semanticBodyState: 'CONTENT',
      });

      const obligations = observations.filter(
        (observation) => observation.observationType === 'AD_OBLIGATION',
      );
      expect(
        observations
          .filter(
            (observation) => observation.observationType === 'AD_OBLIGATIONS',
          )
          .map((observation) => ({
            structured: observation.value.obligationsStructured,
            count: observation.value.obligationCount,
          })),
      ).toEqual([
        { structured: true, count: 1 },
        { structured: true, count: 1 },
        { structured: true, count: 1 },
      ]);
      expect(obligations).toHaveLength(3);
      expect(
        obligations.map((observation) => ({
          itemOrdinal: observation.value.itemOrdinal,
          actionTitle: observation.value.actionTitle,
          modality: observation.value.modality,
          complianceTimeRaw: observation.value.complianceTimeRaw,
        })),
      ).toEqual([
        {
          itemOrdinal: 'g',
          actionTitle: 'Installation of Warning Indicator Lights',
          modality: 'CONDITIONAL',
          complianceTimeRaw:
            'Within 36 months after the effective date of this AD',
        },
        {
          itemOrdinal: 'h',
          actionTitle: 'Activation of Warning Indicator Lights',
          modality: 'CONDITIONAL',
          complianceTimeRaw:
            'Within 36 months after the effective date of this AD',
        },
        {
          itemOrdinal: 'i',
          actionTitle: 'Airplane Flight Manual (AFM) Revisions',
          modality: 'REQUIRED',
          complianceTimeRaw:
            'Before further flight after doing the installation or activation of the warning lights required by paragraph (g) or (h) of this AD',
        },
      ]);
      expect(obligations[2].value.conditionalClauseCount).toBeGreaterThan(0);
      expect(
        obligations.every(
          (observation) =>
            observation.unit.sourceRefIds.length > 0 &&
            observation.unit.sourceSegmentIds.length > 0,
        ),
      ).toBe(true);

      const relations = observations.filter(
        (observation) =>
          observation.observationType === 'AD_DOCUMENT_RELATIONS',
      );
      expect(relationTargets(relations, 'affected_ads')).toEqual([
        ['AD 2003-03-15 R1', null],
        ['AD 2006-13-13', null],
        ['AD 2008-23-07', null],
      ]);
      expect(
        relationTargets(relations, 'terminating_action_for_affected_ads'),
      ).toEqual([
        ['AD 2003-03-15 R1', null],
        ['AD 2006-13-13', null],
        ['AD 2008-23-07', null],
      ]);
      expect(
        relationTargets(relations, 'material_incorporated_by_reference'),
      ).toEqual([
        ['737-31A1325', null],
        ['737-31A1398', null],
      ]);
      expect(
        relationTargets(relations, 'airplane_flight_manual_afm_revisions'),
      ).toEqual([['130S-09-134A', null]]);

      assertNoBarePageNumberInDerivedObservations(observations, pipeline);
      assertNoPageFurnitureInDerivedObservations(observations, pipeline);
      const shiftedActionUnits = pipeline.unitSet.units.map((unit) => ({
        ...unit,
        text: unit.text
          .replace(/^\(f\) You are responsible/u, '(e) You are responsible')
          .replace(/^\(g\) For airplanes/u, '(f) For airplanes'),
      }));
      const shiftedActionTopology = buildFamilySectionTopology({
        unitSet: { ...pipeline.unitSet, units: shiftedActionUnits },
        document: {
          documentCode: 'AD-2011-03-14-shifted-action',
          documentType: 'airworthiness_directive',
          language: 'en-US',
        },
      });
      expect(
        shiftedActionTopology.find(
          (section) =>
            section.sectionKey === 'installation_of_warning_indicator_lights',
        ),
      ).toMatchObject({ nodeKind: 'action', ordinal: 'f' });
      const reader = new Frozen2CandidateReaderService().read(
        pipeline.u0Input.artifact,
        pipeline.u0Input.bytes,
        'Within 36 months after the effective date',
      );
      expect(reader.queryResults.length).toBeGreaterThan(0);
      expect(
        reader.queryResults.every((result) => result.sourceRefIds.length > 0),
      ).toBe(true);
    });

    it('preserves modern heading ordinals, explicit NONE and numbered action subtrees', async () => {
      const pipeline = await actualFaaAdPipeline({
        path: MODERN_FIXTURE_PATH as string,
        expectedBytes: 160_717,
        expectedSha256:
          '4180ec881a9677c54b89f5b220e86c055491a438b0bcb67490ec8617d0e9a8a8',
        expectedPages: 9,
        documentCode: 'AD-2024-16-07',
      });
      const observations = structuredObservations(pipeline.pkg);
      const windows = observations.filter(
        (observation) => observation.observationType === 'SECTION_WINDOW',
      );
      expect(
        windows.map((observation) => observation.value.sectionKey),
      ).toEqual([
        'effective_date',
        'affected_ads',
        'applicability',
        'subject',
        'unsafe_condition',
        'compliance',
        'required_actions',
        'alternative_methods_of_compliance',
        'related_information',
        'material_incorporated_by_reference',
      ]);
      expect(windows.map((observation) => observation.value.ordinal)).toEqual(
        'abcdefghij'.split(''),
      );
      expect(
        windows.find(
          (observation) => observation.value.sectionKey === 'affected_ads',
        )?.value.semanticBodyState,
      ).toBe('NONE');
      const requiredActions = windows.find(
        (observation) => observation.value.sectionKey === 'required_actions',
      );
      expect(requiredActions?.value).toMatchObject({
        pageStart: 7,
        pageEnd: 8,
        semanticBodyState: 'CONTENT',
      });
      const textBySegment = new Map(
        pipeline.unitSet.units.map((unit) => [unit.sourceUnitId, unit.text]),
      );
      const requiredActionText = (requiredActions?.unit.sourceSegmentIds ?? [])
        .map((id) => textBySegment.get(id) ?? '')
        .join('\n');
      expect(requiredActionText).toContain('Note 1 to paragraph (g)(1):');
      expect(requiredActionText).toContain('Note 2 to paragraph (g)(1):');
      expect(requiredActionText).toContain('Note 3 to paragraph (g)(2):');

      const obligations = observations.filter(
        (observation) => observation.observationType === 'AD_OBLIGATION',
      );
      expect(
        observations.find(
          (observation) => observation.observationType === 'AD_OBLIGATIONS',
        )?.value,
      ).toMatchObject({
        obligationsStructured: true,
        unstructuredReason: null,
        obligationCount: 2,
      });
      expect(obligations).toHaveLength(2);
      expect(
        obligations.map((observation) => ({
          itemOrdinal: observation.value.itemOrdinal,
          modality: observation.value.modality,
          complianceTimeRaw: observation.value.complianceTimeRaw,
        })),
      ).toEqual([
        {
          itemOrdinal: '1',
          modality: 'CONDITIONAL',
          complianceTimeRaw:
            'Within 6 months after the effective date of this AD',
        },
        {
          itemOrdinal: '2',
          modality: 'CONDITIONAL',
          complianceTimeRaw:
            'Within 6 months after the effective date of this AD',
        },
      ]);
      expect(
        obligations.every(
          (observation) =>
            observation.unit.sourceRefIds.length > 0 &&
            observation.unit.sourceSegmentIds.length > 0,
        ),
      ).toBe(true);

      const relations = observations.filter(
        (observation) =>
          observation.observationType === 'AD_DOCUMENT_RELATIONS',
      );
      const affected = relations.find(
        (observation) => observation.value.sectionKey === 'affected_ads',
      );
      expect(affected?.value).toMatchObject({
        semanticState: 'NONE',
        relationsStructured: true,
        relations: [],
      });
      expect(relationTargets(relations, 'required_actions')).toEqual([
        ['B787-81205-SB310018-00', 'ISSUE 001'],
        ['B787-81205-SB310018-00', 'ISSUE 002'],
        ['B787-81205-SB340053-00', 'ISSUE 001'],
      ]);
      expect(
        relationTargets(relations, 'material_incorporated_by_reference'),
      ).toEqual([
        ['B787-81205-SB310018-00', 'ISSUE 002'],
        ['B787-81205-SB340053-00', 'ISSUE 001'],
      ]);

      assertNoPageFurnitureInDerivedObservations(observations, pipeline);
      const requiredActionsSection = buildFamilySectionTopology({
        unitSet: pipeline.unitSet,
        document: {
          documentCode: 'AD-2024-16-07',
          documentType: 'airworthiness_directive',
          language: 'en-US',
        },
      }).find((section) => section.sectionKey === 'required_actions');
      expect(requiredActionsSection).toBeDefined();
      const leadingUnscoped = buildSourceBoundAdObligations({
        ...(requiredActionsSection as NonNullable<
          typeof requiredActionsSection
        >),
        bodyUnits: (requiredActionsSection?.bodyUnits ?? []).map(
          (unit, index) =>
            index === 0
              ? { ...unit, text: unit.text.replace(/^\(1\)\s*/u, '') }
              : unit,
        ),
      });
      expect(leadingUnscoped).toMatchObject({
        obligationsStructured: false,
        unstructuredReason: 'LEADING_UNSCOPED_CONTENT',
        obligations: [],
      });

      const operativeIdentity = pipeline.unitSet.units.find((unit) =>
        /^2024-16-07/u.test(unit.text),
      );
      expect(operativeIdentity).toBeDefined();
      expect(
        buildFamilySectionTopology({
          unitSet: {
            ...pipeline.unitSet,
            units: [
              ...pipeline.unitSet.units,
              {
                ...(operativeIdentity as NonNullable<typeof operativeIdentity>),
                sourceUnitId: `${operativeIdentity?.sourceUnitId}:second-ad`,
                continuityKey: `${operativeIdentity?.continuityKey}:second-ad`,
                order: (operativeIdentity?.order ?? 0) + 0.5,
                text: '2024-16-08 The Boeing Company: Amendment 39-22814;',
              },
            ],
          },
          document: {
            documentCode: 'AD-2024-16-07-multi-ad-rule',
            documentType: 'airworthiness_directive',
            language: 'en-US',
          },
        }),
      ).toEqual([]);

      const reader = new Frozen2CandidateReaderService().read(
        pipeline.u0Input.artifact,
        pipeline.u0Input.bytes,
        'B787-81205-SB340053-00',
      );
      expect(reader.queryResults.length).toBeGreaterThan(0);
      expect(
        reader.queryResults.every((result) => result.sourceRefIds.length > 0),
      ).toBe(true);
    });
  },
);

async function actualFaaAdPipeline(input: {
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
  expect(recognizeHostNativePdfProfile(layout, 'AD')).toMatchObject({
    adapterId: 'issuer.faa.airworthiness_directive.v1',
    family: 'AD',
    issuerAuthority: 'FAA',
    parseProfileRef: 'faa.ad',
    documentType: 'airworthiness_directive',
  });
  const pipeline = runProfessionalInputPipelineFromLayout(layout, {
    artifact: {
      artifactRef: `fixture://professional-input/${input.documentCode}.pdf`,
      normalizedPath: `${input.documentCode}.pdf`,
    },
    document: {
      documentCode: input.documentCode,
      documentType: 'airworthiness_directive',
      language: 'en-US',
    },
    lineage: {
      generatedAt: '2026-09-03T00:00:00.000Z',
      producerName: 'professional-input-actual-faa-ad-structure-test',
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

function relationTargets(
  observations: readonly StructuredObservation[],
  sectionKey: string,
): Array<[string, string | null]> {
  const value = observations.find(
    (observation) => observation.value.sectionKey === sectionKey,
  )?.value;
  const relations = (value?.relations ?? []) as Array<{
    targetDocumentCode: string;
    targetRevision: string | null;
  }>;
  return relations
    .map((relation): [string, string | null] => [
      relation.targetDocumentCode,
      relation.targetRevision,
    ])
    .sort(([leftCode, leftRevision], [rightCode, rightRevision]) =>
      `${leftCode}:${leftRevision ?? ''}`.localeCompare(
        `${rightCode}:${rightRevision ?? ''}`,
      ),
    );
}

function assertNoBarePageNumberInDerivedObservations(
  observations: readonly StructuredObservation[],
  pipeline: Awaited<ReturnType<typeof actualFaaAdPipeline>>,
): void {
  const textBySegment = new Map(
    pipeline.unitSet.units.map((unit) => [unit.sourceUnitId, unit.text.trim()]),
  );
  const derivedSegments = observations.flatMap(
    (observation) => observation.unit.sourceSegmentIds,
  );
  expect(
    derivedSegments
      .map((sourceSegmentId) => textBySegment.get(sourceSegmentId))
      .filter((text) => text !== undefined && /^\d+$/u.test(text)),
  ).toEqual([]);
}

function assertNoPageFurnitureInDerivedObservations(
  observations: readonly StructuredObservation[],
  pipeline: Awaited<ReturnType<typeof actualFaaAdPipeline>>,
): void {
  const textBySegment = new Map(
    pipeline.unitSet.units.map((unit) => [unit.sourceUnitId, unit.text.trim()]),
  );
  const derivedText = observations
    .flatMap((observation) => observation.unit.sourceSegmentIds)
    .map((sourceSegmentId) => textBySegment.get(sourceSegmentId) ?? '')
    .join('\n');
  expect(derivedText).not.toMatch(
    /(?:^|\n)(?:AIRWORTHINESS DIRECTIVE|\d+\s+Federal Register\s*\/)/u,
  );
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
      validatorRevision: `faa-ad-structure-${validatorRevision}`,
    }),
  );
}
