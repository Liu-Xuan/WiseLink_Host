import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

jest.mock(
  '../../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js',
  () => ({
    MiaodaFileServiceArtifactStore: class {
      constructor(
        private readonly fileService: {
          readSelection(input: {
            bucketId: string;
            filePath: string;
          }): Promise<unknown>;
        },
      ) {}

      readSelection(input: { bucketId: string; filePath: string }) {
        return this.fileService.readSelection(input);
      }
    },
  }),
);
jest.mock(
  '../../../server/modules/document-management/src/hosted/phase5BoeingSbHandoff.js',
  () => ({
    PHASE5_737_34_3830_HANDOFF: {
      source: { sha256: 'a'.repeat(64), byteLength: 1 },
      catalogIdentity: {
        documentId: 'unused-sb-document',
        documentVersionId: 'unused-sb-version',
      },
      parsedPackageImport: {
        packageId: `urn:techpub:package:v1:sha256:${'b'.repeat(64)}`,
      },
      descriptor: {
        documentCode: 'UNUSED-SB',
        businessRevision: null,
      },
      canonicalHostClassification: {
        parserProfileId: 'unused-sb-profile',
        parserProfileHash: `sha256:${'c'.repeat(64)}`,
      },
    },
  }),
);

import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';

import { ExactFtdFrozen2PdfProducerAdapter } from '../../../server/modules/canonical-host/exact-ftd-frozen2-pdf-producer.adapter';
import { scopedProfessionalArtifactRef } from '../../../server/modules/canonical-host/scoped-professional-artifact-correlation.port';
import { runProfessionalInputPipeline } from '../../../server/modules/professional-input/builders/professional-input-pipeline';
import { PdfjsDistLayoutExtractor } from '../../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import type { StructuredApplicability } from '../../../server/modules/professional-input/pure/professional-input-pure.types';
import { Frozen2CandidateReaderService } from '../../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { PythonU0FullPackageValidatorAdapter } from '../../../server/modules/unified-reader/python-u0-full-package-validator.adapter';
import { U0FullValidationService } from '../../../server/modules/unified-reader/u0-full-validation.service';
import { UnifiedReaderService } from '../../../server/modules/unified-reader/unified-reader.service';
import type {
  ImmutableArtifactPersistResult,
  UnifiedArtifactStorePort,
} from '../../../server/modules/unified-reader/unified-reader.types';
import { sha256Raw } from '../../../server/modules/unified-reader/unified-reader.utils';

const FIXTURE_PATH = process.env.WL31_REAL_FTD_FIXTURE?.trim();
const EXPECTED_SOURCE_SHA256 =
  'b1b5c198df4a3d42925218f48d70ddc361563c65692be35dac4c81e0d8367a3c';
const EXPECTED_PACKAGE_ID =
  'urn:techpub:package:v1:sha256:5463009173acc1cf7f944f6b4dcd4c247cc36ab0c86395530bcbcdfc99fda5f2';
const EXPECTED_APPLICABILITY_TEXT =
  'All777modelsequippedwithAirplaneInformationManagementSystem2(AIMS-2)Platform.';
const EXPECTED_APPLICABILITY_SOURCE_REF =
  'urn:techpub:source-ref:v1:sha256:0893eb82455c0d193bc56b18c67f344c515c97be35248b461c701fd06e316dcf';
const U0_CONTRACT_COMMIT = 'fa69ada08265934951df53c7a61a3ccdb8cb2900' as const;
const CVE_2024_4367_FIRST_FIXED = '4.2.67';

const describeRealFtd = FIXTURE_PATH ? describe : describe.skip;

describe('professional-input PDF runtime security pin', () => {
  it('locks a CVE-2024-4367-fixed pdfjs ESM build with evaluation and scripting disabled', async () => {
    const lock = JSON.parse(
      await readFile(resolve(process.cwd(), 'package-lock.json'), 'utf8'),
    ) as {
      packages: Record<
        string,
        { version?: string; dependencies?: Record<string, string> }
      >;
    };
    const declared = lock.packages[''].dependencies?.['pdfjs-dist'];
    const locked = lock.packages['node_modules/pdfjs-dist'].version;
    expect(declared).toBe('4.10.38');
    expect(locked).toBe('4.10.38');
    expect(versionAtLeast(locked as string, CVE_2024_4367_FIRST_FIXED)).toBe(
      true,
    );

    const runnerSource = await readFile(
      resolve(
        process.cwd(),
        'server/modules/professional-input/parser/pdfjs-layout-extractor.runner.mjs',
      ),
      'utf8',
    );
    expect(runnerSource).toContain('isEvalSupported: false');
    expect(runnerSource).toContain('enableScripting: false');
    expect(runnerSource).not.toMatch(/\.render\s*\(/u);
    expect(runnerSource).not.toContain('getViewport(');
    expect(runnerSource).not.toContain('canvasContext');
  });
});

describe('professional-input deterministic applicability recognition', () => {
  jest.setTimeout(120_000);

  it('keeps frozen.2 applicability empty for actual PDF bytes with no recognized observation', async () => {
    const fixturePath = resolve(
      process.cwd(),
      'server/runtime-assets/technical-publication-parsed-package/v1-frozen-2/fixtures/source/minimal-pdf.pdf',
    );
    const pdfBytes = await readFile(fixturePath);
    expect(sha256Raw(pdfBytes)).toBe(
      'c7a1f296066a1147a7fc5c9ba7f0e16289ab18aeb14715594ccf8733807f39d1',
    );
    const pipeline = runProfessionalInputPipeline(
      {
        pdfBytes,
        artifact: {
          artifactRef: 'fixture://professional-input/minimal-pdf.pdf',
          normalizedPath: 'fixtures/source/minimal-pdf.pdf',
        },
        document: {
          documentCode: 'MINIMAL-PDF',
          documentType: 'service_bulletin',
          language: 'en',
        },
        lineage: {
          generatedAt: '2026-08-27T00:00:00.000Z',
          producerName: 'professional-input-no-applicability-test',
          producerVersion: '1.0.0',
        },
      },
      { extractor: new PdfjsDistLayoutExtractor() },
    );

    expect(pipeline.pkg.applicability).toEqual({
      sourceExpressions: [],
      normalizedCandidates: [],
      assignments: [],
    });
    await expect(
      createFullValidator('professional-input-no-applicability-test').validate(
        pipeline.u0Input,
      ),
    ).resolves.toMatchObject({
      status: 'FULL_STRICT_VALIDATOR_PASSED',
      packageId: pipeline.pkg.packageId,
    });
  });
});

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

describeRealFtd('Host-native professional input with actual FTD bytes', () => {
  jest.setTimeout(120_000);

  it('requires currentness and reads source -> SPP/U0 -> frozen.2 -> Unified Reader', async () => {
    const sourceBytes = await readFile(FIXTURE_PATH as string);
    expect(sourceBytes.byteLength).toBe(122_102);
    expect(sha256Raw(sourceBytes)).toBe(EXPECTED_SOURCE_SHA256);

    const filePath =
      '/document-management/source/sha256/b1/' +
      `${EXPECTED_SOURCE_SHA256}.pdf`;
    const fileMetadata = {
      bucketID: 'bucket-professional-input-test',
      filePath,
      id: 'provider-object-real-ftd-test',
      name: '777-FTD-31-21002_Doc_09262025.pdf',
      updatedAt: '2026-08-25T00:00:00.000Z',
      metadata: {
        mimeType: 'application/pdf',
        contentLength: sourceBytes.byteLength,
      },
    };
    const professionalFilePath =
      '/canonical-host/professional-artifacts/real-ftd-test.json';
    let professionalBytes: Uint8Array | null = null;
    const fileService = {
      readSelection: jest.fn(
        async (selection: { bucketId: string; filePath: string }) => {
          if (selection.filePath === professionalFilePath) {
            if (!professionalBytes) {
              throw new Error('PROFESSIONAL_BYTES_NOT_REGISTERED');
            }
            return {
              bucketId: fileMetadata.bucketID,
              filePath: professionalFilePath,
              providerObjectId: 'provider-object-real-ftd-professional-test',
              providerVersionId: 'provider-object-real-ftd-professional-test',
              providerUpdatedAt: fileMetadata.updatedAt,
              fileName: 'real-ftd-test.json',
              mediaType: 'application/json',
              providerByteLength: professionalBytes.byteLength,
              bytes: professionalBytes,
              byteLength: professionalBytes.byteLength,
              sha256: sha256Raw(professionalBytes),
              readbackVerified: true,
            };
          }
          return {
            bucketId: fileMetadata.bucketID,
            filePath,
            providerObjectId: fileMetadata.id,
            providerVersionId: fileMetadata.id,
            providerUpdatedAt: fileMetadata.updatedAt,
            fileName: fileMetadata.name,
            mediaType: fileMetadata.metadata.mimeType,
            providerByteLength: fileMetadata.metadata.contentLength,
            bytes: sourceBytes,
            byteLength: sourceBytes.byteLength,
            sha256: sha256Raw(sourceBytes),
            readbackVerified: true,
          };
        },
      ),
    };

    const documentId = 'document_actual_ftd_professional_input_test';
    const documentVersionId =
      'document_version_actual_ftd_professional_input_test';
    const sourceArtifactId =
      'source_artifact_actual_ftd_professional_input_test';
    const resolveCurrent = jest.fn(async () => ({
      version: {
        documentId,
        documentVersionId,
        sourceArtifactId,
        originalFilename: fileMetadata.name,
        lifecycleStatus: 'COMMITTED_IMMUTABLE',
        pdfSha256: EXPECTED_SOURCE_SHA256,
        byteLength: sourceBytes.byteLength,
        committedAt: '2026-08-25T00:00:00.000Z',
        businessRevision: null,
      },
      family: {
        familyId: 'publication_family_actual_ftd_test',
        documentFamily: 'FTD',
        canonicalDocumentNumber: '777-FTD-31-21002',
        currentDocumentVersionId: documentVersionId,
        currentGeneration: 1,
      },
      artifact: {
        sourceArtifactId,
        bucketId: fileMetadata.bucketID,
        filePath,
        providerObjectId: fileMetadata.id,
        mediaType: 'application/pdf',
        sha256: EXPECTED_SOURCE_SHA256,
        byteLength: sourceBytes.byteLength,
        readbackVerified: true,
      },
      currentness: {
        familyId: 'publication_family_actual_ftd_test',
        nextDocumentVersionId: documentVersionId,
        nextGeneration: 1,
      },
    }));

    const fullValidator = createFullValidator(
      'professional-input-real-ftd-test',
    );
    const producer = new ExactFtdFrozen2PdfProducerAdapter(
      fileService as never,
      { resolve: resolveCurrent } as never,
      fullValidator,
      {
        available: true,
        persistAndCorrelate: jest.fn(async (correlationRequest, produced) => {
          professionalBytes = Uint8Array.from(produced.bytes);
          return {
            schemaVersion:
              'wiselink.3_1.scoped_professional_artifact_correlation.v1',
            status: 'HOST_SCOPE_BOUND_IMMUTABLE',
            scope: {
              workItemId: correlationRequest.workItemId,
              documentVersionId: correlationRequest.documentVersionId,
            },
            source: {
              documentId: correlationRequest.documentId,
              sourceArtifactId: correlationRequest.sourceArtifactId,
              sha256: correlationRequest.sourceSha256,
              byteLength: correlationRequest.sourceByteLength,
              providerObjectId: correlationRequest.sourceProviderObjectId,
            },
            profile: { ...correlationRequest.classification },
            professionalArtifact: {
              professionalArtifactId: produced.packageId,
              ownerWorkItemId: correlationRequest.workItemId,
              ownerDocumentVersionId: correlationRequest.documentVersionId,
              packageId: produced.packageId,
              artifact: {
                ...produced.artifact,
                ref: scopedProfessionalArtifactRef(
                  correlationRequest,
                  produced.packageId,
                ),
              },
              fileServiceLocator: {
                bucketId: fileMetadata.bucketID,
                filePath: professionalFilePath,
                providerObjectId: 'provider-object-real-ftd-professional-test',
              },
            },
            lineage: { ...produced.lineage },
          };
        }),
      },
    );
    const produced = await producer.producePdf({
      schemaVersion: 'wiselink.3_1.canonical_pdf_vertical_request.v0.candidate',
      workItemId: 'work-item-real-ftd-professional-input',
      requestId: 'request-real-ftd-professional-input',
      source: {
        documentId,
        documentVersionId,
        parserRequestId: 'parser-request-real-ftd-professional-input',
        sourceArtifactId,
        sourceFileSha256: `sha256:${EXPECTED_SOURCE_SHA256}`,
        sourceByteLength: sourceBytes.byteLength,
        driveFileToken: 'drive-file-token-test-only',
        driveSourceVersion: 'drive-source-version-test-only',
      },
      classification: {
        status: 'CONFIRMED',
        normalizedFamily: 'FTD',
        classifierReleaseId: 'classifier-release-test-only',
        classifierReleaseHash:
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        parserProfileId: 'parser-profile:boeing.ftd.v1@1.0.0',
        parserProfileHash:
          'sha256:c47a7388da23d106c2476b579308c458332127153930ced8c684212f1b431731',
        fingerprint:
          'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      query: '777-FTD-31-21002',
    });

    expect(resolveCurrent).toHaveBeenCalledWith(documentVersionId, {
      requireCurrent: true,
    });
    expect(fileService.readSelection).toHaveBeenCalledWith({
      bucketId: fileMetadata.bucketID,
      filePath,
    });
    expect(produced.kind).toBe('PACKAGE');
    if (produced.kind !== 'PACKAGE') throw new Error(produced.failureCode);
    expect(produced).toMatchObject({
      packageId: EXPECTED_PACKAGE_ID,
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      strictReaderValidated: true,
      documentIdentity: {
        documentCode: '777-FTD-31-21002',
        businessRevision: null,
      },
    });

    const pkg = JSON.parse(Buffer.from(produced.bytes).toString('utf8')) as {
      modules: Array<{ moduleId: string }>;
      sourceRefs: Array<{ sourceRefId: string; quote: string }>;
      sourceSegments: unknown[];
      contentUnits: unknown[];
      applicability: StructuredApplicability;
    };
    expect(pkg.sourceRefs).toHaveLength(197);
    expect(pkg.sourceSegments).toHaveLength(197);
    expect(pkg.contentUnits).toHaveLength(196);
    expect(pkg.modules).toHaveLength(1);
    expect(pkg.applicability.sourceExpressions).toHaveLength(1);
    expect(pkg.applicability.normalizedCandidates).toHaveLength(1);
    expect(pkg.applicability.assignments).toHaveLength(1);

    const sourceExpression = pkg.applicability.sourceExpressions[0];
    const normalizedCandidate = pkg.applicability.normalizedCandidates[0];
    const assignment = pkg.applicability.assignments[0];
    expect(sourceExpression).toMatchObject({
      text: EXPECTED_APPLICABILITY_TEXT,
      form: 'logical_expression',
      authority: 'source_asserted',
      sourceRefIds: [EXPECTED_APPLICABILITY_SOURCE_REF],
    });
    expect(normalizedCandidate).toMatchObject({
      language: 'techpub-applicability-expr.v1',
      confidence: 'deterministic',
      sourceExpressionIds: [sourceExpression.expressionId],
      expression: {
        operator: 'all',
        children: [
          {
            operator: 'predicate',
            predicate: {
              property: 'model',
              comparator: 'eq',
              values: ['777'],
            },
          },
          {
            operator: 'predicate',
            predicate: {
              property: 'equipmentModelInstalled',
              comparator: 'eq',
              values: ['AIMS-2'],
            },
          },
        ],
      },
      authority: 'parser_candidate',
    });
    expect(assignment).toMatchObject({
      expressionId: sourceExpression.expressionId,
      target: {
        kind: 'module',
        targetId: pkg.modules[0].moduleId,
        sourceRefIds: [EXPECTED_APPLICABILITY_SOURCE_REF],
      },
      authority: 'source_asserted',
    });
    expect(
      pkg.sourceRefs.find(
        (sourceRef) =>
          sourceRef.sourceRefId === EXPECTED_APPLICABILITY_SOURCE_REF,
      ),
    ).toMatchObject({ quote: EXPECTED_APPLICABILITY_TEXT });

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
    const readback = await reader.persistAndReadback(produced.bytes, {
      workItemId: 'work-item-real-ftd-professional-input',
      requestId: 'request-real-ftd-professional-input',
      documentVersionId,
      permissionSnapshotVersion: 'permission-snapshot-real-ftd-test',
      packageId: produced.packageId,
      contractId: produced.contractId,
      contractRevision: produced.contractRevision,
      query: 'AIMS-2',
    });
    expect(readback).toMatchObject({
      status: 'CANDIDATE_READBACK_VERIFIED',
      package: {
        packageId: EXPECTED_PACKAGE_ID,
        sourceKind: 'pdf',
        resultStatus: 'complete',
        contentUnitCount: 196,
        sourceRefCount: 197,
      },
      fullValidatorProof: {
        status: 'FULL_STRICT_VALIDATOR_PASSED',
        contractCommit: U0_CONTRACT_COMMIT,
      },
      receipt: {
        validationStatus: 'CONSUMER_READBACK_VERIFIED',
        sourceBoundUnitCount: 196,
        authority: {
          createsWorkItemState: false,
          createsEngineeringConclusion: false,
          grantsPublication: false,
          selectsCurrent: false,
        },
      },
    });
    expect(readback.queryResults.length).toBeGreaterThan(0);
    expect(
      readback.queryResults.every((result) => result.sourceRefIds.length > 0),
    ).toBe(true);
    const applicabilityReadback = readback.queryResults.find(
      (result) => result.text === EXPECTED_APPLICABILITY_TEXT,
    );
    expect(applicabilityReadback).toMatchObject({
      sourceRefIds: [EXPECTED_APPLICABILITY_SOURCE_REF],
      sourceLocators: [
        {
          sourceRefId: EXPECTED_APPLICABILITY_SOURCE_REF,
          kind: 'pdf',
          quote: EXPECTED_APPLICABILITY_TEXT,
        },
      ],
    });
  });
});

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
      validatorRevision,
    }),
  );
}

function versionAtLeast(actual: string, minimum: string): boolean {
  const actualParts = actual.split('.').map(Number);
  const minimumParts = minimum.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (actualParts[index] > minimumParts[index]) return true;
    if (actualParts[index] < minimumParts[index]) return false;
  }
  return true;
}
