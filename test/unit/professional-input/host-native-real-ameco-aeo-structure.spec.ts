import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { CanonicalWorkItemProjection } from '@shared/api.interface';

import {
  UNKNOWN,
  evaluateWithTrace,
} from '../../../server/modules/assessment-workbench/applicability-fleet/applicabilityKleeneEngine';
import { readFrozenApplicabilitySourceBinding } from '../../../server/modules/canonical-host/canonical-host-applicability-source';
import { recognizeHostNativePdfProfile } from '../../../server/modules/canonical-host/host-native-pdf-profile.registry';
import { resolveActualPdfDocumentIdentity } from '../../../server/modules/document-management/src/migrated/ingress/pdfDocumentIdentityOwner.js';
import {
  buildSourceBoundAeoEffectivity,
  buildSourceBoundAeoProcedure,
  buildSourceBoundAeoSafetyBoundary,
  buildSourceBoundAeoSoftwareControl,
} from '../../../server/modules/professional-input/builders/ameco-aeo-structure.builder';
import { buildFamilySectionTopology } from '../../../server/modules/professional-input/builders/family-section-topology.builder';
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

const AEO_PATH = process.env.WL31_REAL_AMECO_AEO_PDF_PATH?.trim();
const describeActualAeo = AEO_PATH ? describe : describe.skip;
const SOURCE_SHA256 =
  'd05004b66389f546a481e1ab279bc6d5337901410631a6064b682d89879bddef';
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

describeActualAeo(
  'professional-input AMECO AEO identity, group graph and procedure semantics with actual bytes',
  () => {
    jest.setTimeout(120_000);

    it('routes the actual bytes and preserves G-Z-W-phase, item branches and software scopes through U0/Reader', async () => {
      const pipeline = await actualAeoPipeline();
      const observations = structuredObservations(pipeline.pkg);
      const windows = observations.filter(
        (observation) => observation.observationType === 'SECTION_WINDOW',
      );
      expect(
        windows.map((observation) => [
          observation.value.sectionKey,
          observation.value.pageStart,
          observation.value.pageEnd,
        ]),
      ).toEqual([
        ['engineering_basis', 1, 6],
        ['accomplishment_instructions', 7, 10],
        ['safety_checklist', 11, 11],
      ]);

      const effectivity = singleObservation(
        observations,
        'AEO_EFFECTIVITY_GROUPS',
      );
      expect(effectivity.value).toMatchObject({
        effectivityStructured: true,
        unstructuredReason: null,
      });
      const groups = effectivity.value.groups as Array<{
        groupId: string;
        aircraftModel: string;
        declaredAircraftCount: number;
        aircraftRegistrations: string[];
        zoneId: string;
        workTypeId: string;
        phaseId: string;
      }>;
      expect(groups).toEqual([
        expect.objectContaining({
          groupId: 'G1',
          aircraftModel: 'B787-9',
          declaredAircraftCount: 4,
          aircraftRegistrations: ['B-1466', 'B-1467', 'B-7800', 'B-7832'],
          zoneId: 'Z1',
          workTypeId: 'W1',
          phaseId: 'G1-Z1-W1',
        }),
        expect.objectContaining({
          groupId: 'G2',
          aircraftModel: 'B787-9',
          declaredAircraftCount: 10,
          aircraftRegistrations: [
            'B-1368',
            'B-1431',
            'B-1468',
            'B-1469',
            'B-1591',
            'B-7877',
            'B-7878',
            'B-7879',
            'B-7898',
            'B-7899',
          ],
          zoneId: 'Z1',
          workTypeId: 'W1',
          phaseId: 'G2-Z1-W1',
        }),
      ]);

      const procedure = singleObservation(
        observations,
        'AEO_PROCEDURE_GRAPH',
      );
      expect(procedure.value).toMatchObject({
        procedureStructured: true,
        unstructuredReason: null,
      });
      expect(
        (procedure.value.actions as Array<{ itemOrdinal: number }>).map(
          (action) => action.itemOrdinal,
        ),
      ).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(procedure.value.branches).toEqual([
        expect.objectContaining({
          fromItemOrdinal: 2,
          condition: 'SOFTWARE_ALREADY_PRESENT',
          whenTrue: {
            nextItemOrdinal: 4,
            markItemOrdinalNotApplicable: 3,
          },
          whenFalse: { nextItemOrdinal: 3 },
        }),
      ]);
      expect(
        (
          procedure.value.references as Array<{
            targetDocumentCode: string;
          }>
        ).map((reference) => reference.targetDocumentCode),
      ).toEqual([
        'B787-A-46-13-00-01A-750A-A',
        'B787-A-46-13-00-03A-550A-A',
        'B787-A-46-13-00-04A-110B-A',
        'DMC-B787-A-45-13-00-00A-750A-A',
        'DMC-B787-A-46-12-00-00A-750A-A',
      ]);

      const software = singleObservation(
        observations,
        'AEO_SOFTWARE_CONTROL',
      );
      expect(software.value).toMatchObject({
        softwareControlStructured: true,
        unstructuredReason: null,
      });
      expect(
        (
          software.value.assignments as Array<{
            partNumber: string;
            groupScope: string;
          }>
        ).map((value) => [value.partNumber, value.groupScope]),
      ).toEqual([
        ['CCA24-0ASB-0005', 'ALL_GROUPS'],
        ['CCA24-0ASC-0004', 'ALL_GROUPS'],
        ['CCA3C-C1SS-8007', 'G2'],
        ['CCA3C-TCU1-8006', 'G1'],
        ['CCA3D-C1SS-8006', 'G1'],
        ['CCA3D-TCU1-8007', 'G2'],
        ['CCA50-0ASA-000B', 'ALL_GROUPS'],
      ]);
      expect(
        (
          software.value.invalidSoftwareParts as Array<{
            partNumber: string;
          }>
        ).map((value) => value.partNumber),
      ).toEqual([
        'CCA23-0ASB-0002',
        'CCA23-0ASC-0003',
        'CCA3E-C1SS-8005',
        'CCA3F-TCU1-8005',
        'CCA53-0ASA-000A',
      ]);

      const safety = singleObservation(
        observations,
        'AEO_SAFETY_BOUNDARY',
      );
      expect(safety.value).toMatchObject({
        checklistStructured: true,
        selectionState: 'UNRESOLVED',
        operationalRequirementInferred: false,
      });
      const safetyItems = safety.value.items as Array<{
        displayedNaMarker: boolean;
      }>;
      expect(safetyItems).toHaveLength(20);
      expect(safetyItems.filter((item) => item.displayedNaMarker)).toHaveLength(
        7,
      );

      expect(pipeline.pkg.applicability).toMatchObject({
        sourceExpressions: [expect.any(Object)],
        normalizedCandidates: [expect.any(Object)],
        assignments: [expect.any(Object)],
      });
      const reader = new Frozen2CandidateReaderService();
      const allSourceUnits = reader.readAllSourceUnits(
        pipeline.u0Input.artifact,
        pipeline.u0Input.bytes,
      );
      const binding = readFrozenApplicabilitySourceBinding({
        bytes: pipeline.u0Input.bytes,
        workItem: {
          package: {
            usagePolicy: {
              applicability: {
                sourceExpressionCount: 1,
                normalizedCandidateCount: 1,
                assignmentCount: 1,
              },
            },
          },
        } as unknown as CanonicalWorkItemProjection,
        sourceUnits: allSourceUnits,
      });
      expect(binding.deterministicFragments).toHaveLength(1);
      const applicabilityAst = binding.deterministicFragments[0].expressionAst;
      expect(
        evaluateWithTrace(
          applicabilityAst,
          {
            assetId: 'B-1466',
            assessmentAsOf: '2026-09-04',
            properties: {
              model: 'B787-9',
              registrationNumber: 'B-1466',
            },
          },
          null,
        ).result,
      ).toBe(true);
      expect(
        evaluateWithTrace(
          applicabilityAst,
          {
            assetId: 'B-9999',
            assessmentAsOf: '2026-09-04',
            properties: {
              model: 'B787-9',
              registrationNumber: 'B-9999',
            },
          },
          null,
        ).result,
      ).toBe(false);
      expect(
        evaluateWithTrace(
          applicabilityAst,
          {
            assetId: 'B-1466',
            assessmentAsOf: '2026-09-04',
            properties: { model: 'B787-9' },
          },
          null,
        ).result,
      ).toBe(UNKNOWN);

      for (const query of [
        'B-7899',
        'CCA24-0ASC-0004',
        'B787-A-46-13-00-03A-550A-A',
      ]) {
        const readback = reader.read(
          pipeline.u0Input.artifact,
          pipeline.u0Input.bytes,
          query,
        );
        expect(readback.queryResults.length).toBeGreaterThan(0);
        expect(
          readback.queryResults.every(
            (result) => result.sourceRefIds.length > 0,
          ),
        ).toBe(true);
      }
      expect(
        observations.some((observation) =>
          observation.observationType.startsWith('AD_'),
        ),
      ).toBe(false);
      expect(
        observations
          .filter((observation) => observation.observationType.startsWith('AEO_'))
          .every(
            (observation) =>
              observation.unit.sourceRefIds.length > 0 &&
              observation.unit.sourceSegmentIds.length > 0,
          ),
      ).toBe(true);
    });

    it('fails closed on broken group continuations, relation keys, branch semantics and conflicting software scopes', async () => {
      const pipeline = await actualAeoPipeline();
      const topology = buildFamilySectionTopology({
        unitSet: pipeline.unitSet,
        document: aeoIdentity(),
      });
      const basis = requiredSection(topology, 'engineering_basis');
      const instructions = requiredSection(
        topology,
        'accomplishment_instructions',
      );
      const safety = requiredSection(topology, 'safety_checklist');

      expect(
        buildSourceBoundAeoEffectivity({
          ...basis,
          bodyUnits: replaceUnitText(basis.bodyUnits, '7832', 'unresolved'),
        }),
      ).toMatchObject({
        effectivityStructured: false,
        unstructuredReason: 'GROUP_ROW_UNRESOLVED',
        groups: [],
      });
      expect(
        buildSourceBoundAeoEffectivity({
          ...basis,
          bodyUnits: replaceUnitText(basis.bodyUnits, 'G2Z1W1', 'G2Z2W1'),
        }),
      ).toMatchObject({
        effectivityStructured: false,
        unstructuredReason: 'GROUP_RELATION_UNRESOLVED',
        groups: [],
      });
      expect(
        buildSourceBoundAeoProcedure({
          ...instructions,
          bodyUnits: instructions.bodyUnits.map((unit) => ({
            ...unit,
            text: unit.text
              .replace(
                '如果包含，则跳至步骤Item 4，并对步骤Item 3签署N/A；',
                '分支条件未解析',
              )
              .replace(
                'If Yes, go to Item 4, and sign N/A for Item 3;',
                'branch condition unresolved',
              ),
          })),
        }),
      ).toMatchObject({
        procedureStructured: false,
        unstructuredReason: 'CONDITIONAL_BRANCH_UNRESOLVED',
        actions: [],
      });
      expect(
        buildSourceBoundAeoSoftwareControl({
          ...instructions,
          bodyUnits: replaceFirstUnitText(
            instructions.bodyUnits,
            'CCA3D-C1SS-8006Group 1',
            'CCA3D-C1SS-8006Group 2',
          ),
        }),
      ).toMatchObject({
        softwareControlStructured: false,
        unstructuredReason: 'CONFLICTING_GROUP_SCOPE',
        assignments: [],
      });
      expect(buildSourceBoundAeoSafetyBoundary(safety)).toMatchObject({
        checklistStructured: true,
        selectionState: 'UNRESOLVED',
        operationalRequirementInferred: false,
      });
    });
  },
);

async function actualAeoPipeline() {
  const sourceBytes = await readFile(AEO_PATH as string);
  expect(sourceBytes.byteLength).toBe(557_202);
  expect(sha256Raw(sourceBytes)).toBe(SOURCE_SHA256);
  const layout =
    new PdfjsDistLayoutExtractor().extractLayoutWithDiagnostics(sourceBytes);
  expect(layout.pageCount).toBe(11);
  const identity = (resolveActualPdfDocumentIdentity as any)({
    layout,
    actualSha256: SOURCE_SHA256,
    actualByteLength: sourceBytes.byteLength,
    inspectionSha256: SOURCE_SHA256,
    inspectionByteLength: sourceBytes.byteLength,
    originalFilename: 'renamed-actual-engineering-document.pdf',
  });
  expect(identity).toMatchObject({
    documentCode: 'AEO-B787-46-0012',
    documentFamily: 'AEO',
    sourceType: 'ameco_engineering_order',
    issuer: 'AMECO',
    businessRevision: 'R0',
    revisionDate: '',
    documentFamilyAdapterId: 'issuer.ameco.engineering_order.v1',
    identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
  });
  expect(recognizeHostNativePdfProfile(layout, 'AEO')).toMatchObject({
    adapterId: 'issuer.ameco.engineering_order.v1',
    family: 'AEO',
    issuerAuthority: 'AMECO',
    parseProfileRef: 'ameco.engineering_order',
    parserProfileId: 'parser-profile:ameco.engineering_order@1.0.0',
    documentType: 'engineering_order',
  });
  const pipeline = runProfessionalInputPipelineFromLayout(layout, {
    artifact: {
      artifactRef: `artifact://CanonicalArtifactStore/sha256/${SOURCE_SHA256}`,
      normalizedPath: 'AEO-B787-46-0012-R00.pdf',
    },
    document: aeoIdentity(),
    lineage: {
      generatedAt: '2026-09-04T00:00:00.000Z',
      producerName: 'professional-input-actual-ameco-aeo-structure-test',
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

function aeoIdentity() {
  return {
    documentCode: 'AEO-B787-46-0012',
    documentType: 'engineering_order' as const,
    language: 'zh-CN/en-US',
  };
}

function requiredSection(
  sections: readonly ReturnType<typeof buildFamilySectionTopology>[number][],
  sectionKey: string,
) {
  const section = sections.find((value) => value.sectionKey === sectionKey);
  expect(section).toBeDefined();
  return section as NonNullable<typeof section>;
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

function replaceFirstUnitText(
  units: readonly SourceUnit[],
  source: string,
  replacement: string,
): SourceUnit[] {
  let replaced = false;
  return units.map((unit) => {
    if (replaced || unit.text !== source) return { ...unit };
    replaced = true;
    return { ...unit, text: replacement };
  });
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
      validatorRevision: 'ameco-aeo-structure-actual-file',
    }),
  );
}
