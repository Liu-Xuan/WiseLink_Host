import type {
  UnifiedPackageArtifactDescriptor,
  UnifiedPackageReadbackRequest,
} from '@shared/api.interface';

import { Frozen2CandidateReaderService } from '../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { UnifiedArtifactReadScope } from '../../server/modules/unified-reader/unified-artifact-read-scope';
import { UnifiedReaderService } from '../../server/modules/unified-reader/unified-reader.service';
import { U0FullValidationService } from '../../server/modules/unified-reader/u0-full-validation.service';
import { buildUnifiedSbJobAidAssessmentInput } from '../../server/modules/assessment-workbench/unified-assessment-input';
import { evaluateByJobAidForAily } from '../../server/modules/assessment-workbench/assessment-aily-orchestration';
import { buildJobAidCriterionSetVersion } from '../../server/modules/assessment-workbench/job-aid-runtime/criterionSet.js';
import type {
  DocumentVersionUnifiedArtifactBinding,
  UnifiedParsedPackageArtifactRecord,
} from '../../server/modules/assessment-workbench/unified-parsed-package-reader';
import type {
  ImmutableArtifactPersistResult,
  UnifiedArtifactStorePort,
} from '../../server/modules/unified-reader/unified-reader.types';
import {
  canonicalJson,
  contentView,
  sha256Raw,
  sha256Text,
} from '../../server/modules/unified-reader/unified-reader.utils';

class InMemoryArtifactStore implements UnifiedArtifactStorePort {
  private readonly values: Map<string, Uint8Array> = new Map();

  async persistAndReadback(
    bytes: Uint8Array,
  ): Promise<ImmutableArtifactPersistResult> {
    const sha256: string = sha256Raw(bytes);
    const ref: string =
      'artifact://UnifiedArtifactStoreCandidate/' +
      `unified-parsed-packages/sha256/${sha256}`;
    const reused: boolean = this.values.has(ref);
    this.values.set(ref, Uint8Array.from(bytes));
    const artifact: UnifiedPackageArtifactDescriptor = {
      storeRole: 'UnifiedArtifactStoreCandidate',
      ref,
      sha256,
      byteLength: bytes.byteLength,
      mediaType: 'application/json',
    };
    return { artifact, bytes: Uint8Array.from(bytes), reused };
  }

  async readActualBytes(
    artifact: UnifiedPackageArtifactDescriptor,
  ): Promise<Uint8Array> {
    const bytes: Uint8Array | undefined = this.values.get(artifact.ref);
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

describe('UnifiedReaderService hosted candidate loop', () => {
  let store: InMemoryArtifactStore;
  let service: UnifiedReaderService;
  let candidateReader: Frozen2CandidateReaderService;
  let validator: U0FullValidationService;

  beforeEach(() => {
    store = new InMemoryArtifactStore();
    candidateReader = new Frozen2CandidateReaderService();
    validator = fullValidator();
    service = new UnifiedReaderService(
      store,
      candidateReader,
      validator,
      {
        mode: 'DEFAULT_UNCONFIGURED',
        artifactStoreConfigured: false,
        fullU0ValidatorConfigured: true,
        aeoSpecialistReaderConfigured: false,
        immutableAcceptanceReceiptOwnerConfigured: false,
        authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
      },
    );
  });

  it('declares capability without claiming canonical activation', () => {
    expect(service.readiness()).toMatchObject({
      status: 'VERIFICATION_PENDING',
      packageContract: {
        selectionStatus: 'R1_FROZEN',
        preferredCandidate: {
          contractRevision: 'frozen.2',
          contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
        },
      },
      capabilities: {
        candidateSourceAvailable: true,
        unifiedAcceptanceFacadeSourceAvailable: true,
        aeoSpecialistReaderConfigured: false,
        artifactStoreConfigured: false,
        immutableArtifactPersistAndReadback: false,
        sourceBoundCandidateReadback: false,
        workItemMutation: false,
        currentnessMutation: false,
        publication: false,
      },
      blockers: expect.arrayContaining([
        'HOSTED_CANONICAL_RUNTIME_UNVERIFIED',
        'AEO_SPECIALIST_READER_NOT_CONFIGURED',
      ]),
    });
  });

  it.each(['pdf', 'native_s1000d'] as const)(
    'persists, reads and queries a portable %s candidate package',
    async (sourceKind) => {
      const fixture = makeCandidatePackage(sourceKind);
      const { bytes, packageId } = fixture;
      const query = 'electrical power';
      const response = await service.persistAndReadback(bytes, {
        workItemId: `wi-${sourceKind}`,
        requestId: `req-${sourceKind}`,
        documentVersionId: `docv-${sourceKind}`,
        permissionSnapshotVersion: 'perm-test-1',
        packageId,
        contractId: 'techpub.parsed-package.v1',
        contractRevision: 'frozen.2',
        query,
      });

      expect(response).toMatchObject({
        status: 'CANDIDATE_READBACK_VERIFIED',
        workItemId: `wi-${sourceKind}`,
        requestId: `req-${sourceKind}`,
        documentVersionId: `docv-${sourceKind}`,
        permissionSnapshotVersion: 'perm-test-1',
        package: {
          packageId,
          sourceKind,
          contentUnitCount: 2,
          sourceRefCount: 1,
        },
        receipt: {
          validationStatus: 'CONSUMER_READBACK_VERIFIED',
          reader: { role: 'UnifiedReaderCandidate' },
          packageId,
          sourceBoundUnitCount: 2,
          queryProbe: {
            query,
            resultCount: 1,
            allResultsHaveSourceRefs: true,
          },
        },
      });
      expect(response.queryResults[0].sourceRefIds.length).toBeGreaterThan(0);
      expect(response.queryResults[0].sourceLocators).toEqual([
        expect.objectContaining(
          sourceKind === 'pdf'
            ? {
                sourceRefId: `source-ref-${sourceKind}`,
                kind: 'pdf',
                pageStart: 2,
                pageEnd: 2,
                charOffsetUnit: 'unicode_scalar_value',
                quote: 'Disconnect electrical power.',
              }
            : {
                sourceRefId: `source-ref-${sourceKind}`,
                kind: 'xml',
                normalizedPath: 'DMC-FIXTURE.XML',
                xpath: '/dmodule/content/description/levelledPara',
                elementId: 'para-1',
                quote: 'Disconnect electrical power.',
              },
        ),
      ]);
    },
  );

  it('rejects exact-byte drift and empty query results explicitly', async () => {
    const { bytes, packageId } = makeCandidatePackage('pdf');
    const persisted: ImmutableArtifactPersistResult =
      await store.persistAndReadback(bytes);
    const request: UnifiedPackageReadbackRequest = {
      workItemId: 'wi-drift',
      requestId: 'req-drift',
      documentVersionId: 'docv-drift',
      permissionSnapshotVersion: 'perm-drift',
      package: {
        packageId,
        contractId: 'techpub.parsed-package.v1',
        contractRevision: 'frozen.2',
        artifact: persisted.artifact,
      },
      query: 'value-does-not-exist',
    };

    await expect(service.readback(request)).rejects.toThrow(
      'READER_QUERY_NO_RESULTS',
    );
    request.package.artifact = {
      ...request.package.artifact,
      sha256: '0'.repeat(64),
    };
    await expect(service.readback(request)).rejects.toThrow(
      'ARTIFACT_READBACK_MISMATCH',
    );
  });

  it('reads metadata and units once per request, without retaining missing source bytes', async () => {
    const { bytes, packageId } = makeCandidatePackage('pdf');
    const { artifact } = await store.persistAndReadback(bytes);
    const reads = jest.spyOn(store, 'readActualBytes');
    const sourcePackage = await service.readSourcePackage({ artifact, packageId });
    expect(sourcePackage.inspection.sourceKind).toBe('pdf');
    expect(sourcePackage.units).toHaveLength(2);
    expect(reads).toHaveBeenCalledTimes(1);
    reads.mockRejectedValueOnce(new Error('SOURCE_ARTIFACT_NOT_FOUND'));
    await expect(service.readSourcePackage({ artifact, packageId }))
      .rejects.toThrow('SOURCE_ARTIFACT_NOT_FOUND');
  });

  it('coalesces the exact package download, strict validation and JSON parse within an explicit scope', async () => {
    const { bytes, packageId } = makeCandidatePackage('pdf');
    const { artifact } = await store.persistAndReadback(bytes);
    const readScope = new UnifiedArtifactReadScope(store);
    const reads = jest.spyOn(store, 'readActualBytes');
    const validations = jest.spyOn(validator, 'validate');
    const inspections = jest.spyOn(candidateReader, 'readSourcePackage');
    const parses = jest.spyOn(JSON, 'parse');
    const rawText = new TextDecoder().decode(bytes);
    const input = { artifact, packageId, documentVersionId: 'DV-SCOPED', readScope };
    try {
      const [units, inspection, readback, actualBytes] = await Promise.all([
        service.readAllSourceUnits(input),
        service.inspectSourcePackage(input),
        service.readback({
          workItemId: 'WI-SCOPED',
          requestId: 'REQ-SCOPED',
          documentVersionId: input.documentVersionId,
          permissionSnapshotVersion: 'PERMISSION-SCOPED',
          package: {
            artifact,
            packageId,
            contractId: 'techpub.parsed-package.v1',
            contractRevision: 'frozen.2',
          },
          query: 'electrical power',
        }, readScope),
        readScope.readActualBytes(artifact),
      ]);
      // SourceRef extraction and the assessment consumer use this same parser.
      expect(readScope.parseJson(actualBytes)).toBe(readScope.parseJson(actualBytes));
      expect(units).toHaveLength(2);
      expect(inspection.packageId).toBe(readback.package.packageId);
      expect(readback.permissionSnapshotVersion).toBe('PERMISSION-SCOPED');
      expect(reads).toHaveBeenCalledTimes(1);
      expect(validations).toHaveBeenCalledTimes(1);
      expect(inspections).toHaveBeenCalledTimes(1);
      expect(parses.mock.calls.filter(([text]) => text === rawText)).toHaveLength(1);
    } finally {
      parses.mockRestore();
    }
  });

  it('keeps requests isolated and never aliases a changed descriptor or version binding', async () => {
    const { bytes, packageId } = makeCandidatePackage('pdf');
    const { artifact } = await store.persistAndReadback(bytes);
    const reads = jest.spyOn(store, 'readActualBytes');
    const validations = jest.spyOn(validator, 'validate');
    const firstScope = new UnifiedArtifactReadScope(store);
    const input = { artifact, packageId, documentVersionId: 'DV-1', readScope: firstScope };
    await service.readSourcePackage(input);
    await service.readSourcePackage({ ...input, documentVersionId: 'DV-2' });
    expect(reads).toHaveBeenCalledTimes(1);
    expect(validations).toHaveBeenCalledTimes(2);
    await service.readSourcePackage({ ...input, readScope: new UnifiedArtifactReadScope(store) });
    expect(reads).toHaveBeenCalledTimes(2);
    expect(validations).toHaveBeenCalledTimes(3);
    await expect(service.readSourcePackage({
      ...input,
      artifact: { ...artifact, sha256: '0'.repeat(64) },
    })).rejects.toThrow('ARTIFACT_READBACK_MISMATCH');
    expect(reads).toHaveBeenCalledTimes(3);
  });

  it('does not retain failed downloads or failed validations as successful source reads', async () => {
    const { bytes, packageId } = makeCandidatePackage('pdf');
    const { artifact } = await store.persistAndReadback(bytes);
    const reads = jest.spyOn(store, 'readActualBytes');
    const validations = jest.spyOn(validator, 'validate');
    const input = {
      artifact, packageId, documentVersionId: 'DV-RETRY',
      readScope: new UnifiedArtifactReadScope(store),
    };
    reads.mockRejectedValueOnce(new Error('SOURCE_ARTIFACT_NOT_FOUND'));
    const failed = await Promise.allSettled([
      service.readSourcePackage(input), service.inspectSourcePackage(input),
    ]);
    expect(failed.map((entry) => entry.status)).toEqual(['rejected', 'rejected']);
    expect(reads).toHaveBeenCalledTimes(1);
    validations.mockRejectedValueOnce(new Error('FULL_U0_VALIDATOR_REJECTED'));
    await expect(service.readSourcePackage(input)).rejects.toThrow('FULL_U0_VALIDATOR_REJECTED');
    await expect(service.readSourcePackage(input)).resolves.toMatchObject({
      inspection: { packageId },
    });
    expect(reads).toHaveBeenCalledTimes(3);
    expect(validations).toHaveBeenCalledTimes(2);
  });

  it('reuses one parse across the actual Reader, SB input builder and 150-item JobAid consumer', async () => {
    const assetDirectory = resolve(
      process.cwd(), 'server/runtime-assets/assessment-host/real-sb/737-34-3830-original-issue',
    );
    const bytes = new Uint8Array(readFileSync(resolve(assetDirectory, 'unified-package.frozen-2.json')));
    const artifactRecord = JSON.parse(readFileSync(
      resolve(assetDirectory, 'artifact-record.frozen-2.json'), 'utf8',
    )) as UnifiedParsedPackageArtifactRecord;
    const { artifact } = await store.persistAndReadback(bytes);
    const documentVersionBinding: DocumentVersionUnifiedArtifactBinding = {
      documentId: 'document_10085d27e5c05266403bb74c',
      documentVersionId: 'document_version_f4813607b91ee1a20e754e2d',
      artifactRecord: { ...artifactRecord, artifactRef: artifact.ref },
      lifecycleStatus: 'FROZEN', selectionStatus: 'SELECTED', isCurrent: true,
      classification: {
        schemaVersion: 'wiselink.v3_1.document_classification_envelope.v1',
        classificationId: 'CLS-READ-SCOPE-TEST',
        classificationHash: `sha256:${'a'.repeat(64)}`,
        status: 'CONFIRMED', normalizedFamily: 'SB', issuer: 'BOEING',
        subtype: 'service_bulletin',
        profileId: 'document-family-profile:issuer.boeing.service_bulletin@1.0.0',
        nativeParseProfileId: 'boeing.sb',
      },
    };
    const ruleBytes = new Uint8Array(readFileSync(resolve(
      process.cwd(), 'server/runtime-assets/assessment-host/job-aid/rule-pack-0.2.json',
    )));
    const rulePack = JSON.parse(new TextDecoder().decode(ruleBytes)) as Record<string, unknown>;
    const rulePackHash = sha256Raw(ruleBytes);
    const criterionSet = buildJobAidCriterionSetVersion({
      rulePack,
      artifactRef: 'artifact://rule-pack-read-scope',
      artifactDigest: `sha256:${rulePackHash}`,
      artifactVersion: '0.2',
      lifecycleStatus: 'ACTIVE',
    });
    const referenceInput = buildUnifiedSbJobAidAssessmentInput({
      documentVersionBinding, artifactBytes: bytes, assessmentAsOf: '2026-09-06T00:00:00.000Z',
    });
    const readScope = new UnifiedArtifactReadScope(store);
    const reads = jest.spyOn(store, 'readActualBytes');
    const parses = jest.spyOn(JSON, 'parse');
    const rawText = new TextDecoder().decode(bytes);
    try {
      await service.readAllSourceUnits({
        artifact, packageId: artifactRecord.packageId,
        documentVersionId: documentVersionBinding.documentVersionId, readScope,
      });
      const options = {
        documentVersionBinding,
        artifactBytes: await readScope.readActualBytes(artifact),
        assessmentAsOf: '2026-09-06T00:00:00.000Z',
        readScope,
      };
      const scopedInput = buildUnifiedSbJobAidAssessmentInput(options);
      const evaluation = evaluateByJobAidForAily({
        ...options, workItemId: 'WI-READ-SCOPE', rulePack, rulePackHash, criterionSet,
        generatedAt: '2026-09-06T00:00:00.000Z',
        jobAidSourceIdentity: {
          status: 'SOURCE_IDENTITY_MISMATCH', sourceManifestHash: 'sha256:test',
          allowsCandidateOnlyAssessment: true,
          blocksEngineeringClosure: true, blocksRulePromotion: true,
        },
      });
      expect(scopedInput).toEqual(referenceInput);
      expect(evaluation.snapshot.items).toHaveLength(150);
      expect(reads).toHaveBeenCalledTimes(1);
      expect(parses.mock.calls.filter(([text]) => text === rawText)).toHaveLength(1);
    } finally {
      parses.mockRestore();
    }
  });
});

function makeCandidatePackage(sourceKind: 'pdf' | 'native_s1000d'): {
  bytes: Uint8Array;
  packageId: string;
} {
  const sourceRefId = `source-ref-${sourceKind}`;
  const content: Record<string, unknown> = {
    $schema: 'urn:techpub:schema:v1:parsed-package:frozen-2',
    schemaVersion: 'techpub.parsed-package.v1',
    contractRevision: 'frozen.2',
    source: { kind: sourceKind },
    document: {
      title: {
        value: `Portable ${sourceKind} package`,
        sourceRefIds: [sourceRefId],
      },
      revision: { label: { value: 'R1', sourceRefIds: [sourceRefId] } },
    },
    result: {
      status: 'complete',
      accountingComplete: true,
      contentPreserved: true,
      structuredCoverageComplete: true,
    },
    sourceRefs: [
      sourceKind === 'pdf'
        ? {
            sourceRefId,
            kind: 'pdf',
            artifactId: `artifact-${sourceKind}`,
            pageStart: 2,
            pageEnd: 2,
            charStart: 10,
            charEnd: 38,
            charOffsetUnit: 'unicode_scalar_value',
            quote: 'Disconnect electrical power.',
            bbox: [1, 2, 3, 4],
          }
        : {
            sourceRefId,
            kind: 'xml',
            artifactId: `artifact-${sourceKind}`,
            normalizedPath: 'DMC-FIXTURE.XML',
            xpath: '/dmodule/content/description/levelledPara',
            elementId: 'para-1',
            quote: 'Disconnect electrical power.',
          },
    ],
    contentUnits: [
      {
        unitId: `unit-${sourceKind}-heading`,
        kind: 'heading',
        unitHash: sha256Text(`heading-${sourceKind}`),
        sourceRefIds: [sourceRefId],
        payload: { text: 'Procedure', level: 1 },
      },
      {
        unitId: `unit-${sourceKind}-step`,
        kind: 'paragraph',
        unitHash: sha256Text(`step-${sourceKind}`),
        sourceRefIds: [sourceRefId],
        payload: { text: 'Disconnect electrical power.' },
      },
    ],
  };
  const contentHash = sha256Text(canonicalJson(contentView(content)));
  const pkg: Record<string, unknown> = {
    ...content,
    packageId: `urn:techpub:package:v1:${contentHash}`,
    integrity: {
      contentHash,
      semanticHash: sha256Text(`semantic-${sourceKind}`),
      provenanceHash: sha256Text(`provenance-${sourceKind}`),
      coverageHash: sha256Text(`coverage-${sourceKind}`),
    },
  };
  return {
    bytes: new TextEncoder().encode(`${JSON.stringify(pkg, null, 2)}\n`),
    packageId: pkg.packageId as string,
  };
}

function fullValidator(): U0FullValidationService {
  return new U0FullValidationService({
    validateActualBytes: async ({ artifact, packageId }) => ({
      status: 'FULL_STRICT_VALIDATOR_PASSED',
      validatorId: 'U0Frozen2SchemaSemanticValidator',
      validatorRevision: 'test-u0-fa69ada-frozen.2',
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
      packageId,
      artifactSha256: artifact.sha256,
    }),
    validateFailureReportActualBytes: async () => {
      throw new Error('TEST_FAILURE_VALIDATOR_NOT_USED');
    },
  });
}
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
