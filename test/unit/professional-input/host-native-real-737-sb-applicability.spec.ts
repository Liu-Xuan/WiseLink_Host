import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type {
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';

import { evaluateApplicabilityForAircraft } from '../../../server/modules/assessment-workbench/applicability-fleet/applicabilityFleetEvaluator';
import {
  FLEET_MASTER_DATA_SCHEMA_VERSION,
  type FleetMasterDataSource,
} from '../../../server/modules/assessment-workbench/applicability-fleet/fleetMasterData';
import { UNKNOWN } from '../../../server/modules/assessment-workbench/applicability-fleet/applicabilityKleeneEngine';
import { readFrozenApplicabilitySourceBinding } from '../../../server/modules/canonical-host/canonical-host-applicability-source';
import {
  APPLICABILITY_CANDIDATE_SCHEMA_VERSION,
  APPLICABILITY_TASK_SCHEMA_VERSION,
  applicabilityAstVocabulary,
  applicabilityRuntimePolicy,
  parseApplicabilityCandidate,
  validateApplicabilityCandidateBinding,
  type ApplicabilityTaskContract,
} from '../../../server/modules/canonical-host/canonical-host-openclaw-applicability.contract';
import { recognizeHostNativePdfProfile } from '../../../server/modules/canonical-host/host-native-pdf-profile.registry';
import { runProfessionalInputPipelineFromLayout } from '../../../server/modules/professional-input/builders/professional-input-pipeline';
import { PdfjsDistLayoutExtractor } from '../../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import type {
  ParsedPdfLayout,
  ParsedPdfTextRun,
  StructuredApplicabilityExpression,
} from '../../../server/modules/professional-input/pure/professional-input-pure.types';
import { Frozen2CandidateReaderService } from '../../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { PythonU0FullPackageValidatorAdapter } from '../../../server/modules/unified-reader/python-u0-full-package-validator.adapter';
import { U0FullValidationService } from '../../../server/modules/unified-reader/u0-full-validation.service';
import { UnifiedReaderService } from '../../../server/modules/unified-reader/unified-reader.service';
import type {
  ImmutableArtifactPersistResult,
  UnifiedArtifactStorePort,
} from '../../../server/modules/unified-reader/unified-reader.types';
import { sha256Raw } from '../../../server/modules/unified-reader/unified-reader.utils';

const FIXTURE_PATH = process.env.WL31_REAL_737_SB_PDF_PATH?.trim();
const describeRealSb = FIXTURE_PATH ? describe : describe.skip;
const EXPECTED_SOURCE_SHA256 =
  'add32c7d4192d35c59162f15eb57f08247427135d5912438501ec9267fa4d41a';
const U0_CONTRACT_COMMIT = 'fa69ada08265934951df53c7a61a3ccdb8cb2900' as const;
const INCLUSIVE_EVIDENCE =
  'applicability means "through" and "inclusive", e.g. line numbers 1-9 means line numbers 1 through';

describeRealSb('actual 737-34-3830 source-bound applicability', () => {
  jest.setTimeout(120_000);

  it('runs actual pdfjs evidence through SPP/U0/Reader/Host and the formal candidate contract', async () => {
    const sourceBytes = await readFile(FIXTURE_PATH as string);
    expect(sourceBytes.byteLength).toBe(1_060_204);
    expect(sha256Raw(sourceBytes)).toBe(EXPECTED_SOURCE_SHA256);

    const layout = new PdfjsDistLayoutExtractor().extractLayoutWithDiagnostics(
      sourceBytes,
    );
    expect(layout.pageCount).toBe(22);
    const profile = recognizeHostNativePdfProfile(layout, 'SB');
    expect(profile).toMatchObject({
      adapterId: 'issuer.boeing.service_bulletin.v1',
      family: 'SB',
      issuerAuthority: 'BOEING',
      parserProfileId: 'parser-profile:boeing.sb@1.0.0',
      documentType: 'service_bulletin',
    });
    if (!profile) throw new Error('BOEING_SB_PROFILE_NOT_RECOGNIZED');

    const declaredInput = {
      artifact: {
        artifactRef: `artifact://CanonicalArtifactStore/sha256/${EXPECTED_SOURCE_SHA256}`,
        normalizedPath: 'SB/BOEING/737-34-3830 Original.pdf',
      },
      document: {
        documentCode: '737-34-3830',
        documentType: profile.documentType,
        language: 'en',
      },
      lineage: {
        generatedAt: '2026-08-31T00:00:00.000Z',
        producerName: 'host-native-real-737-sb-applicability-test',
        producerVersion: '1.0.0',
      },
    } as const;
    const pipeline = runProfessionalInputPipelineFromLayout(
      layout,
      declaredInput,
    );

    expect(pipeline.pkg.applicability.sourceExpressions).toHaveLength(1);
    expect(pipeline.pkg.applicability.normalizedCandidates).toHaveLength(1);
    expect(pipeline.pkg.applicability.assignments).toHaveLength(1);
    const sourceExpression = pipeline.pkg.applicability.sourceExpressions[0];
    const normalizedCandidate =
      pipeline.pkg.applicability.normalizedCandidates[0];
    expect(sourceExpression.text).toContain(INCLUSIVE_EVIDENCE);
    expect(sourceExpression.text).toContain('10-62225-005');
    expect(sourceExpression.text).toContain('10-62225-004');

    const refsById = new Map(
      pipeline.unitSet.sourceRefs.map((sourceRef) => [
        sourceRef.sourceRefId,
        sourceRef,
      ]),
    );
    expect(
      [
        ...new Set(
          sourceExpression.sourceRefIds.map(
            (id) => refsById.get(id)?.pageStart,
          ),
        ),
      ].sort((left, right) => Number(left) - Number(right)),
    ).toEqual([9, 10, 17]);
    expect(sourceExpression.sourceRefIds.every((id) => refsById.has(id))).toBe(
      true,
    );

    const lineSummary = summarizeLineExpression(normalizedCandidate.expression);
    expect(lineSummary.groupSizes).toEqual([99, 99, 46]);
    expect(lineSummary.inValueCounts).toEqual([200, 108]);
    expect(lineSummary.rangeCount).toBe(242);
    expect(lineSummary.expanded.size).toBe(2468);
    expect(Math.min(...lineSummary.expanded)).toBe(5602);
    expect(Math.max(...lineSummary.expanded)).toBe(9820);
    for (const lineNumber of [
      5602, 6490, 6555, 6722, 6975, 6976, 8040, 8042, 8043, 8044, 8047, 9600,
      9631, 9818, 9820,
    ]) {
      expect(lineSummary.expanded.has(lineNumber)).toBe(true);
    }
    for (const lineNumber of [5603, 6977, 8041, 8045, 8046, 9819]) {
      expect(lineSummary.expanded.has(lineNumber)).toBe(false);
    }
    expect(normalizedCandidate.expression).toMatchObject({
      operator: 'all',
      children: [
        {
          operator: 'predicate',
          predicate: {
            property: 'model',
            comparator: 'in',
            values: ['737-8', '737-9', '737-8200'],
          },
        },
        { operator: 'any' },
        {
          operator: 'predicate',
          predicate: {
            property: 'pnInstalled',
            comparator: 'eq',
            values: ['10-62225-004'],
          },
        },
      ],
    });

    const fullValidator = createFullValidator();
    await expect(
      fullValidator.validate(pipeline.u0Input),
    ).resolves.toMatchObject({
      status: 'FULL_STRICT_VALIDATOR_PASSED',
      packageId: pipeline.pkg.packageId,
    });

    const reader = new UnifiedReaderService(
      new InMemoryArtifactStore(),
      new Frozen2CandidateReaderService(),
      fullValidator,
      {
        mode: 'HOST_CONFIGURED',
        artifactStoreConfigured: true,
        fullU0ValidatorConfigured: true,
        immutableAcceptanceReceiptOwnerConfigured: false,
        aeoSpecialistReaderConfigured: false,
        authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
      },
    );
    const readback = await reader.persistAndReadback(pipeline.u0Input.bytes, {
      workItemId: 'work-item-real-737-sb-applicability',
      requestId: 'request-real-737-sb-applicability',
      documentVersionId: 'document-version-real-737-sb-applicability',
      permissionSnapshotVersion: 'permission-snapshot-real-737-sb',
      packageId: pipeline.pkg.packageId,
      contractId: pipeline.pkg.schemaVersion,
      contractRevision: pipeline.pkg.contractRevision,
      query: '10-62225-004',
    });
    expect(readback.status).toBe('CANDIDATE_READBACK_VERIFIED');
    expect(readback.queryResults.length).toBeGreaterThan(0);
    expect(
      readback.queryResults.some((result) =>
        result.text.includes('10-62225-004'),
      ),
    ).toBe(true);
    const sourceUnits = await reader.readAllSourceUnits({
      artifact: readback.artifact,
      packageId: pipeline.pkg.packageId,
    });
    expect(sourceUnits).toHaveLength(pipeline.pkg.contentUnits.length);

    const workItem = {
      package: {
        usagePolicy: {
          applicability: {
            sourceExpressionCount: 1,
            normalizedCandidateCount: 1,
            assignmentCount: 1,
          },
        },
      },
    } as unknown as CanonicalWorkItemProjection;
    const frozenBinding = readFrozenApplicabilitySourceBinding({
      bytes: pipeline.u0Input.bytes,
      workItem,
      sourceUnits,
    });
    expect(frozenBinding.sourceExpressions).toHaveLength(1);
    expect(frozenBinding.deterministicFragments).toHaveLength(1);
    const deterministicAst =
      frozenBinding.deterministicFragments[0].expressionAst;

    const task = applicabilityTask(
      pipeline.pkg.packageId,
      pipeline.pkg.integrity.contentHash,
      frozenBinding.sourceExpressions,
    );
    const parsedCandidate = parseApplicabilityCandidate({
      schemaVersion: APPLICABILITY_CANDIDATE_SCHEMA_VERSION,
      operation: 'EXTRACT_APPLICABILITY',
      candidateStatus: 'CANDIDATE',
      inputRevision: task.inputRevision,
      documentVersionRef: task.documentVersionRef,
      sourcePackage: task.sourcePackage,
      bilingualBinding: task.bilingualBinding,
      aircraft: task.aircraft,
      fleetBinding: task.fleetBinding,
      expressions: [
        {
          expressionId: frozenBinding.sourceExpressions[0].expressionId,
          sourceRefIds: frozenBinding.sourceExpressions[0].sourceRefIds,
          extractionStatus: 'extracted',
          expressionAst: deterministicAst,
        },
      ],
      runtime: applicabilityRuntimePolicy(),
      authority: {
        candidateOnly: true,
        createsEvidenceRef: false,
        createsClosureDecision: false,
        createsActionReadiness: false,
        createsAirworthinessConclusion: false,
      },
    });
    expect(() =>
      validateApplicabilityCandidateBinding(parsedCandidate, task),
    ).not.toThrow();

    const missingPartNumber = evaluateApplicabilityForAircraft({
      dataSource: fleetData(6490),
      aircraftNumber: 'B-7378-TEST',
      asOf: '2026-08-31',
      applicabilityAst: deterministicAst,
    });
    expect(missingPartNumber).toMatchObject({
      status: 'WAITING_INPUT',
      decision: 'needs_review',
      kleeneResult: UNKNOWN,
      pass: false,
    });
    expect(missingPartNumber.blockingUnknowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'fact_unknown',
          property: 'pnInstalled',
          qualifier: '1062225004',
        }),
      ]),
    );

    const missingLineNumber = evaluateApplicabilityForAircraft({
      dataSource: fleetData(null),
      aircraftNumber: 'B-7378-TEST',
      asOf: '2026-08-31',
      applicabilityAst: deterministicAst,
    });
    expect(missingLineNumber).toMatchObject({
      status: 'WAITING_INPUT',
      decision: 'needs_review',
      kleeneResult: UNKNOWN,
      pass: false,
    });
    expect(missingLineNumber.blockingUnknowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'fact_unknown',
          property: 'lineNumber',
        }),
      ]),
    );

    for (const lineNumber of [5602, 6490, 6555, 6722, 9820]) {
      expect(
        evaluateApplicabilityForAircraft({
          dataSource: fleetData(lineNumber, true),
          aircraftNumber: 'B-7378-TEST',
          asOf: '2026-08-31',
          applicabilityAst: deterministicAst,
        }),
      ).toMatchObject({
        status: 'EVALUATED',
        decision: 'applicable',
        kleeneResult: true,
        pass: true,
      });
    }
    expect(
      evaluateApplicabilityForAircraft({
        dataSource: fleetData(5603, true),
        aircraftNumber: 'B-7378-TEST',
        asOf: '2026-08-31',
        applicabilityAst: deterministicAst,
      }),
    ).toMatchObject({
      status: 'EVALUATED',
      decision: 'not_applicable',
      kleeneResult: false,
      pass: false,
    });

    const missingListLine = runProfessionalInputPipelineFromLayout(
      layoutWithoutExactNativeLine(
        layout,
        pipeline.unitSet.units.find(
          (unit) =>
            /^\d{4}(?:-\d{4})?, /u.test(unit.text) &&
            !unit.text.endsWith(' in 1'),
        )?.text ?? '',
      ),
      declaredInput,
    );
    expect(missingListLine.pkg.applicability).toEqual(emptyApplicability());

    const missingInclusiveSemantics = runProfessionalInputPipelineFromLayout(
      layoutWithoutExactNativeLine(layout, INCLUSIVE_EVIDENCE),
      declaredInput,
    );
    expect(missingInclusiveSemantics.pkg.applicability).toEqual(
      emptyApplicability(),
    );
  });
});

function summarizeLineExpression(
  expression: StructuredApplicabilityExpression,
): {
  groupSizes: number[];
  inValueCounts: number[];
  rangeCount: number;
  expanded: Set<number>;
} {
  if (expression.operator !== 'all' || expression.children.length !== 3) {
    throw new Error('EXPECTED_ROOT_ALL');
  }
  const lineExpression = expression.children[1];
  if (lineExpression.operator !== 'any') {
    throw new Error('EXPECTED_OUTER_LINE_ANY');
  }
  const groupSizes: number[] = [];
  const inValueCounts: number[] = [];
  let rangeCount = 0;
  const expanded = new Set<number>();
  for (const group of lineExpression.children) {
    if (group.operator !== 'any') throw new Error('EXPECTED_INNER_LINE_ANY');
    groupSizes.push(group.children.length);
    for (const child of group.children) {
      if (
        child.operator !== 'predicate' ||
        child.predicate.property !== 'lineNumber'
      ) {
        throw new Error('EXPECTED_LINE_NUMBER_PREDICATE');
      }
      const values = child.predicate.values.map(Number);
      if (child.predicate.comparator === 'in') {
        inValueCounts.push(values.length);
        values.forEach((value) => expanded.add(value));
      } else if (child.predicate.comparator === 'range') {
        if (values.length !== 2) throw new Error('EXPECTED_BOUNDED_RANGE');
        rangeCount += 1;
        for (let value = values[0]; value <= values[1]; value += 1) {
          expanded.add(value);
        }
      } else {
        throw new Error('EXPECTED_EXACT_OR_RANGE_LINE_PREDICATE');
      }
    }
  }
  return { groupSizes, inValueCounts, rangeCount, expanded };
}

function applicabilityTask(
  packageId: string,
  contentHash: string,
  sourceExpressions: ApplicabilityTaskContract['sourceExpressions'],
): ApplicabilityTaskContract {
  return {
    schemaVersion: APPLICABILITY_TASK_SCHEMA_VERSION,
    operation: 'EXTRACT_APPLICABILITY',
    applicabilityContextRef: 'applicability-context-real-737-sb',
    inputRevision: 1,
    configurationEvidenceReevaluation: null,
    documentVersionRef: 'document-version-real-737-sb-applicability',
    sourcePackage: { packageId, contentHash },
    bilingualBinding: null,
    aircraft: {
      aircraftNumber: 'B-7378-TEST',
      assessmentAsOf: '2026-08-31',
    },
    fleetBinding: {
      bindingRevision: 'binding-real-737-sb',
      selectionRevision: 'selection-real-737-sb',
      sourceSnapshotId: 'snapshot-real-737-sb',
      sourceRevisionKey: 'revision-real-737-sb',
      authorityRevision: 'authority-real-737-sb',
      sourceAsOf: '2026-08-31',
    },
    controlledAircraft: null,
    controlledFacts: [],
    astVocabulary: applicabilityAstVocabulary(),
    sourceExpressions,
    bilingualSourceUnits: [],
    runtimePolicy: applicabilityRuntimePolicy(),
    authority: {
      candidateOnly: true,
      documentTextDoesNotProveFleetApplicability: true,
      hostDeterministicEvaluationRequired: true,
    },
  };
}

function fleetData(
  lineNumber: number | null,
  partNumberInstalled?: boolean,
): FleetMasterDataSource {
  return {
    schemaVersion: FLEET_MASTER_DATA_SCHEMA_VERSION,
    sourceSnapshotId: 'snapshot-real-737-sb',
    sourceRevisionKey: 'revision-real-737-sb',
    authorityRevision: 'authority-real-737-sb',
    sourceAsOf: '2026-08-31',
    assets: [
      {
        assetId: 'asset-real-737-sb',
        assetVersionId: 'asset-version-real-737-sb',
        aircraftNumber: 'B-7378-TEST',
        fleetFamily: 'B737',
        aircraftModel: '737-8',
        series: '737-8',
        msn: 'TEST-MSN',
        lineNumber,
        deliveryDate: null,
        sourceRef: {
          sourceTable: 'HostDV.fleetAssets',
          sourceRecordId: 'asset-real-737-sb',
        },
        recordHash: 'sha256:asset-real-737-sb',
      },
    ],
    facts:
      partNumberInstalled === undefined
        ? []
        : [
            {
              factId: 'fact-real-737-sb-pn',
              assetId: 'asset-real-737-sb',
              factType: 'fleet_configuration',
              property: 'pnInstalled',
              qualifier: '10-62225-004',
              value: partNumberInstalled,
              validAsOf: '2026-08-31',
              sourceRef: {
                sourceTable: 'HostDV.componentFacts',
                sourceRecordId: 'fact-real-737-sb-pn',
              },
              recordHash: 'sha256:fact-real-737-sb-pn',
            },
          ],
  };
}

function layoutWithoutExactNativeLine(
  layout: ParsedPdfLayout,
  targetText: string,
): ParsedPdfLayout {
  if (!targetText) throw new Error('TARGET_LINE_REQUIRED');
  const matchingRuns: ParsedPdfTextRun[][] = [];
  for (let page = 1; page <= layout.pageCount; page += 1) {
    const runs = layout.textRuns
      .filter((run) => run.page === page && run.origin !== 'ocr_tesseract_tsv')
      .slice()
      .sort((left, right) => right.y - left.y || left.x - right.x);
    let current: ParsedPdfTextRun[] = [];
    let currentY: number | null = null;
    const flush = () => {
      if (
        current
          .slice()
          .sort((left, right) => left.x - right.x)
          .map((run) => run.text)
          .join('')
          .trim() === targetText
      ) {
        matchingRuns.push([...current]);
      }
      current = [];
      currentY = null;
    };
    for (const run of runs) {
      if (currentY === null || Math.abs(run.y - currentY) <= 2) {
        current.push(run);
        currentY ??= run.y;
      } else {
        flush();
        current = [run];
        currentY = run.y;
      }
    }
    flush();
  }
  if (matchingRuns.length !== 1) {
    throw new Error(`TARGET_LINE_NOT_UNIQUE:${targetText}`);
  }
  const removed = new Set(matchingRuns[0]);
  return {
    ...layout,
    textRuns: layout.textRuns.filter((run) => !removed.has(run)),
  };
}

function emptyApplicability() {
  return {
    sourceExpressions: [],
    normalizedCandidates: [],
    assignments: [],
  };
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
      validatorRevision: 'host-native-real-737-sb-applicability-test',
    }),
  );
}

class InMemoryArtifactStore implements UnifiedArtifactStorePort {
  private readonly values = new Map<string, Uint8Array>();

  async persistAndReadback(
    bytes: Uint8Array,
  ): Promise<ImmutableArtifactPersistResult> {
    const sha256 = sha256Raw(bytes);
    const artifact: UnifiedPackageArtifactDescriptor = {
      storeRole: 'UnifiedArtifactStoreCandidate',
      ref:
        'artifact://UnifiedArtifactStoreCandidate/' +
        `unified-parsed-packages/sha256/${sha256}`,
      sha256,
      byteLength: bytes.byteLength,
      mediaType: 'application/json',
    };
    const reused = this.values.has(artifact.ref);
    this.values.set(artifact.ref, Uint8Array.from(bytes));
    return { artifact, bytes: Uint8Array.from(bytes), reused };
  }

  async readActualBytes(
    artifact: UnifiedPackageArtifactDescriptor,
  ): Promise<Uint8Array> {
    const bytes = this.values.get(artifact.ref);
    if (!bytes) throw new Error('SOURCE_ARTIFACT_NOT_FOUND');
    if (
      bytes.byteLength !== artifact.byteLength ||
      sha256Raw(bytes) !== artifact.sha256
    ) {
      throw new Error('ARTIFACT_READBACK_MISMATCH');
    }
    return Uint8Array.from(bytes);
  }
}
