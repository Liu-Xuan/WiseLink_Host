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
      source: {
        sha256:
          'add32c7d4192d35c59162f15eb57f08247427135d5912438501ec9267fa4d41a',
        byteLength: 1_060_204,
      },
      descriptor: {
        documentCode: '737-34-3830',
        businessRevision: 'Original Issue',
      },
      canonicalHostClassification: {
        status: 'CONFIRMED',
        normalizedFamily: 'SB',
        classifierReleaseId:
          'intake-classifier-release:q1-native-migration@1.0.0',
        classifierReleaseHash:
          'sha256:d374483eaa1c209912bf8ed0f830b582f8f0578e3149899de24633ad8e10587c',
        parserProfileId: 'parser-profile:boeing.sb@1.0.0',
        parserProfileHash:
          'sha256:f87dbe8607c4958f253f980bc459cea062e7ebc1e7e8c65353549399cb07f3c0',
        fingerprint:
          'sha256:f87850cddc741f2969280db07d775125315d0f1b61ae2beb7bb14584176a2663',
      },
    },
  }),
);

import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';

import {
  TRANSLATION_RULE_PACK_SCHEMA_VERSION,
  validateTranslationCandidate,
  type TranslationRulePack,
  type TranslationSourceUnit,
} from '../../../server/modules/canonical-host/canonical-translation-rule-contract';
import { buildUnifiedSbJobAidAssessmentInput } from '../../../server/modules/assessment-workbench/unified-assessment-input';
import { HostNativeDocumentFamilyPdfProducerAdapter } from '../../../server/modules/canonical-host/exact-ftd-frozen2-pdf-producer.adapter';
import { scopedProfessionalArtifactRef } from '../../../server/modules/canonical-host/scoped-professional-artifact-correlation.port';
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
const EXPECTED_SOURCE_SHA256 =
  'add32c7d4192d35c59162f15eb57f08247427135d5912438501ec9267fa4d41a';
const EXPECTED_SOURCE_BYTE_LENGTH = 1_060_204;
const U0_CONTRACT_COMMIT = 'fa69ada08265934951df53c7a61a3ccdb8cb2900' as const;
const describeRealSb = FIXTURE_PATH ? describe : describe.skip;
const TRANSLATION_UNIT_KINDS = new Set<TranslationSourceUnit['kind']>([
  'paragraph',
  'heading',
  'text_block',
  'table',
  'preserved_source',
  'step',
  'list_item',
  'warning',
  'caution',
  'note',
  'figure',
]);

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

describeRealSb(
  'Host-native professional input with actual 737 SB bytes',
  () => {
    jest.setTimeout(120_000);

    it('reads FileService bytes -> pdfjs/SPP/U0 frozen.2 -> Unified Reader', async () => {
      const sourceBytes = await readFile(FIXTURE_PATH as string);
      expect(sourceBytes.byteLength).toBe(EXPECTED_SOURCE_BYTE_LENGTH);
      expect(sha256Raw(sourceBytes)).toBe(EXPECTED_SOURCE_SHA256);

      const bucketId = 'bucket-real-737-sb-test';
      const filePath =
        '/document-management/source/sha256/ad/' +
        `${EXPECTED_SOURCE_SHA256}.pdf`;
      const providerObjectId = 'provider-object-real-737-sb-test';
      const professionalFilePath =
        '/canonical-host/professional-artifacts/real-737-sb-test.json';
      let professionalBytes: Uint8Array | null = null;
      const fileService = {
        readSelection: jest.fn(
          async (selection: { bucketId: string; filePath: string }) => {
            if (selection.filePath === professionalFilePath) {
              if (!professionalBytes) {
                throw new Error('PROFESSIONAL_BYTES_NOT_REGISTERED');
              }
              return {
                bucketId,
                filePath: professionalFilePath,
                providerObjectId:
                  'provider-object-real-737-sb-professional-test',
                providerVersionId:
                  'provider-object-real-737-sb-professional-test',
                providerUpdatedAt: '2026-08-26T00:00:00.000Z',
                fileName: 'real-737-sb-test.json',
                mediaType: 'application/json',
                providerByteLength: professionalBytes.byteLength,
                bytes: professionalBytes,
                byteLength: professionalBytes.byteLength,
                sha256: sha256Raw(professionalBytes),
                readbackVerified: true,
              };
            }
            return {
              bucketId,
              filePath,
              providerObjectId,
              providerVersionId: providerObjectId,
              providerUpdatedAt: '2026-08-26T00:00:00.000Z',
              fileName: '737-34-3830 Original.pdf',
              mediaType: 'application/pdf',
              providerByteLength: sourceBytes.byteLength,
              bytes: sourceBytes,
              byteLength: sourceBytes.byteLength,
              sha256: sha256Raw(sourceBytes),
              readbackVerified: true,
            };
          },
        ),
      };

      const documentId = 'document_real_737_sb_test';
      const documentVersionId = 'document_version_real_737_sb_test';
      const sourceArtifactId = 'source_artifact_real_737_sb_test';
      const resolveCurrent = jest.fn(async () => ({
        version: {
          documentId,
          documentVersionId,
          sourceArtifactId,
          originalFilename: '737-34-3830 Original.pdf',
          lifecycleStatus: 'COMMITTED_IMMUTABLE',
          pdfSha256: EXPECTED_SOURCE_SHA256,
          byteLength: sourceBytes.byteLength,
          committedAt: '2026-08-26T00:00:00.000Z',
          businessRevision: 'ORIGINAL ISSUE',
        },
        family: {
          familyId: 'publication_family_real_737_sb_test',
          documentFamily: 'SB',
          issuerAuthority: 'BOEING',
          canonicalDocumentNumber: '737-34-3830',
          currentDocumentVersionId: documentVersionId,
          currentGeneration: 1,
        },
        artifact: {
          sourceArtifactId,
          bucketId,
          filePath,
          providerObjectId,
          mediaType: 'application/pdf',
          sha256: EXPECTED_SOURCE_SHA256,
          byteLength: sourceBytes.byteLength,
          readbackVerified: true,
        },
        currentness: {
          familyId: 'publication_family_real_737_sb_test',
          nextDocumentVersionId: documentVersionId,
          nextGeneration: 1,
        },
      }));

      const fullValidator = new U0FullValidationService(
        new PythonU0FullPackageValidatorAdapter({
          pythonExecutable: process.env.WL31_U0_PYTHON?.trim() || 'python3',
          contractRoot: resolve(
            process.cwd(),
            'server/runtime-assets/technical-publication-parsed-package/v1-frozen-2',
          ),
          contractCommit: U0_CONTRACT_COMMIT,
          validatorRevision: 'professional-input-real-737-sb-test',
        }),
      );
      const producer = new HostNativeDocumentFamilyPdfProducerAdapter(
        fileService as never,
        { resolve: resolveCurrent } as never,
        fullValidator,
        {
          available: true,
          persistAndCorrelate: jest.fn(async (correlationRequest, produced) => {
            professionalBytes = Uint8Array.from(produced.bytes);
            return {
              schemaVersion:
                'wiselink.3_1.scoped_professional_artifact_correlation.v1' as const,
              status: 'HOST_SCOPE_BOUND_IMMUTABLE' as const,
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
                  bucketId,
                  filePath: professionalFilePath,
                  providerObjectId:
                    'provider-object-real-737-sb-professional-test',
                },
              },
              lineage: { ...produced.lineage },
            };
          }),
        },
      );
      const workItemId = 'work-item-real-737-sb-professional-input';
      const requestId = 'request-real-737-sb-professional-input';
      const produced = await producer.producePdf({
        schemaVersion:
          'wiselink.3_1.canonical_pdf_vertical_request.v0.candidate',
        workItemId,
        requestId,
        source: {
          documentId,
          documentVersionId,
          parserRequestId: 'parser-request-real-737-sb-professional-input',
          sourceArtifactId,
          sourceFileSha256: `sha256:${EXPECTED_SOURCE_SHA256}`,
          sourceByteLength: sourceBytes.byteLength,
          driveFileToken: 'drive-file-token-test-only',
          driveSourceVersion: 'drive-source-version-test-only',
        },
        classification: {
          status: 'CONFIRMED',
          normalizedFamily: 'SB',
          classifierReleaseId:
            'intake-classifier-release:q1-native-migration@1.0.0',
          classifierReleaseHash:
            'sha256:d374483eaa1c209912bf8ed0f830b582f8f0578e3149899de24633ad8e10587c',
          parserProfileId: 'parser-profile:boeing.sb@1.0.0',
          parserProfileHash:
            'sha256:f87dbe8607c4958f253f980bc459cea062e7ebc1e7e8c65353549399cb07f3c0',
          fingerprint:
            'sha256:f87850cddc741f2969280db07d775125315d0f1b61ae2beb7bb14584176a2663',
        },
        query: '737-34-3830',
      });

      expect(resolveCurrent).toHaveBeenCalledWith(documentVersionId, {
        requireCurrent: true,
      });
      expect(fileService.readSelection).toHaveBeenCalledWith({
        bucketId,
        filePath,
      });
      if (produced.kind === 'FAILURE_SIGNAL') {
        expect(produced).toMatchObject({
          failureCode: 'PDF_OCR_REQUIRED_UNSUPPORTED',
          parameters: {
            ocrRequiredPages: expect.arrayContaining(['7', '21']),
            visualTextUnverifiedPages: expect.arrayContaining(['7', '21']),
          },
        });
        return;
      }
      expect(produced.kind).toBe('FAILURE_SIGNAL');
      expect(produced).toMatchObject({
        contractId: 'techpub.parsed-package.v1',
        contractRevision: 'frozen.2',
        strictReaderValidated: true,
        documentIdentity: {
          documentCode: '737-34-3830',
          businessRevision: 'ORIGINAL ISSUE',
        },
        usagePolicy: {
          presentationMode: 'ENGINEERING_DOCUMENT',
          assessmentAutoAdoptionAllowed: false,
          aeoAutoAdoptionAllowed: false,
          projectionSource: 'IMMUTABLE_PACKAGE_ACTUAL_BYTES',
        },
      });

      const pkg = JSON.parse(Buffer.from(produced.bytes).toString('utf8')) as {
        source: { sourcePackageHash: string };
        artifacts: Array<{
          origin: string;
          role: string;
          sha256: string;
          byteLength: number;
        }>;
        sourceRefs: Array<{
          sourceRefId: string;
          pageStart: number;
          pageEnd: number;
          bbox?: number[];
          charStart?: number;
          charEnd?: number;
          charOffsetUnit?: string;
          quote: string;
          anchorTextHash: string;
        }>;
        contentUnits: Array<{
          sourceRefIds: string[];
          payload: { text: string };
        }>;
      };
      expect(pkg.source.sourcePackageHash).toBe(
        `sha256:${EXPECTED_SOURCE_SHA256}`,
      );
      expect(
        pkg.artifacts.find(
          (artifact) => artifact.origin === 'source' && artifact.role === 'pdf',
        ),
      ).toMatchObject({
        sha256: `sha256:${EXPECTED_SOURCE_SHA256}`,
        byteLength: EXPECTED_SOURCE_BYTE_LENGTH,
      });
      expect(pkg.sourceRefs).toHaveLength(600);
      expect(pkg.contentUnits).toHaveLength(599);
      const wholePageRefs = pkg.sourceRefs.filter(
        (ref) =>
          ref.pageStart === ref.pageEnd &&
          ref.charStart === 0 &&
          ref.bbox?.join(',') === '0,0,1000000,1000000',
      );
      expect(wholePageRefs).toHaveLength(22);
      expect(wholePageRefs.map((ref) => ref.pageStart)).toEqual(
        Array.from({ length: 22 }, (_, index) => index + 1),
      );
      expect(
        wholePageRefs.every(
          (ref) =>
            ref.charEnd === [...ref.quote].length &&
            ref.charOffsetUnit === 'unicode_scalar_value' &&
            ref.anchorTextHash ===
              `sha256:${sha256Raw(new TextEncoder().encode(ref.quote))}` &&
            ref.quote !== 'Untitled',
        ),
      ).toBe(true);
      expect(wholePageRefs.find((ref) => ref.pageStart === 6)?.quote).toMatch(
        /No compliance time is given/u,
      );
      expect(wholePageRefs.find((ref) => ref.pageStart === 14)?.quote).toMatch(
        /Boeing recommends this service bulletin/u,
      );
      const sourceRefsById = new Map(
        pkg.sourceRefs.map((ref) => [ref.sourceRefId, ref]),
      );
      expect(
        pkg.contentUnits.every((unit) =>
          unit.sourceRefIds.every((sourceRefId) =>
            sourceRefsById.get(sourceRefId)?.quote.includes(unit.payload.text),
          ),
        ),
      ).toBe(true);

      const artifactStore = new InMemoryArtifactStore();
      const reader = new UnifiedReaderService(
        artifactStore,
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
        workItemId,
        requestId,
        documentVersionId,
        permissionSnapshotVersion: 'permission-snapshot-real-737-sb-test',
        packageId: produced.packageId,
        contractId: produced.contractId,
        contractRevision: produced.contractRevision,
        query: '737-34-3830',
      });
      expect(readback).toMatchObject({
        status: 'CANDIDATE_READBACK_VERIFIED',
        package: {
          packageId: produced.packageId,
          sourceKind: 'pdf',
        },
        fullValidatorProof: {
          status: 'FULL_STRICT_VALIDATOR_PASSED',
          contractCommit: U0_CONTRACT_COMMIT,
        },
        receipt: {
          validationStatus: 'CONSUMER_READBACK_VERIFIED',
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

      const actualSourceUnits = await reader.readAllSourceUnits({
        artifact: readback.artifact,
        packageId: readback.package.packageId,
      });
      expect(actualSourceUnits.length).toBe(pkg.contentUnits.length);
      const connectorUnit = actualSourceUnits.find(
        (unit) =>
          TRANSLATION_UNIT_KINDS.has(
            unit.kind as TranslationSourceUnit['kind'],
          ) && /[\p{L}\p{N}_]-\d/u.test(unit.text),
      );
      expect(connectorUnit).toBeDefined();
      if (!connectorUnit) throw new Error('CONNECTOR_UNIT_NOT_FOUND');

      const boundaryChangedText = connectorUnit.text.replace(
        /(?<=[\p{L}\p{N}_])-(?=\d)/gu,
        '、',
      );
      expect(boundaryChangedText).not.toBe(connectorUnit.text);
      const numericOnlyRulePack: TranslationRulePack = {
        meta: {
          schemaVersion: TRANSLATION_RULE_PACK_SCHEMA_VERSION,
          rulePackId: 'test.numeric-fidelity-only',
          rulePackVersion: 'test-only',
          label: 'Numeric fidelity only',
          targetLocale: 'zh-CN',
          sourceLocales: ['en-US'],
        },
        terms: [],
        noTranslate: [],
        deterministic: {
          preservedIdentifierPatterns: [],
          numericFidelity: true,
          preservedUnits: [],
          preserveAtaChapterNumbers: false,
          preservePartNumbers: false,
          segmentAlignment: true,
          tableAlignment: false,
          preserveCitations: false,
        },
      };
      const sourceBinding = {
        documentId,
        revisionId: readback.package.contentHash,
        sbdPackageId: readback.package.packageId,
        sbdContentHash: readback.package.contentHash,
        tcpPackageId: null,
        tcpContentHash: null,
      };
      const resultGate = validateTranslationCandidate({
        rulePack: numericOnlyRulePack,
        rulePackId: numericOnlyRulePack.meta.rulePackId,
        rulePackVersion: numericOnlyRulePack.meta.rulePackVersion,
        sourceUnits: [
          {
            unitKey: connectorUnit.unitId,
            kind: connectorUnit.kind as TranslationSourceUnit['kind'],
            text: connectorUnit.text,
            sourceRefIds: connectorUnit.sourceRefIds,
          },
        ],
        candidateUnits: [
          {
            unitKey: connectorUnit.unitId,
            text: boundaryChangedText,
            sourceRefIds: connectorUnit.sourceRefIds,
            engineerRevision: null,
          },
        ],
        taskStartBinding: sourceBinding,
        validationTimeBinding: sourceBinding,
      });
      expect(resultGate.verdict).toBe('ACCEPTED');
      expect(resultGate.findings).toEqual([]);

      const assessmentInput = buildUnifiedSbJobAidAssessmentInput({
        documentVersionBinding: {
          documentId,
          documentVersionId,
          artifactRecord: {
            $schema: 'urn:techpub:schema:v1:artifact-record:frozen-2',
            schemaVersion: 'techpub.artifact-record.v1',
            contractRevision: 'frozen.2',
            artifactRef: readback.artifact.ref,
            mediaType: 'application/json',
            byteLength: readback.artifact.byteLength,
            artifactHash: `sha256:${readback.artifact.sha256}`,
            packageId: readback.package.packageId,
            contentHash: readback.package.contentHash,
          },
          lifecycleStatus: 'FROZEN',
          selectionStatus: 'SELECTED',
          isCurrent: true,
          classification: {
            schemaVersion: 'wiselink.v3_1.document_classification_envelope.v1',
            classificationId: 'CLS-F87850CDDC741F2969280DB0',
            classificationHash:
              'sha256:f87850cddc741f2969280db07d775125315d0f1b61ae2beb7bb14584176a2663',
            status: 'CONFIRMED',
            normalizedFamily: 'SB',
            issuer: 'BOEING',
            subtype: 'service_bulletin',
            profileId:
              'document-family-profile:issuer.boeing.service_bulletin@1.0.0',
            nativeParseProfileId: 'boeing.sb',
          },
        },
        artifactBytes: produced.bytes,
        assessmentAsOf: '2026-08-28T00:00:00.000Z',
      }) as {
        upstreamBinding: {
          unifiedParsedPackage: { currentness: string };
        };
        publicPackageObservation: {
          contentUnitCount: number;
          sourceRefCount: number;
          pageSourceRefs: Array<{ pageStart: number; quote: string }>;
        };
      };
      expect(
        assessmentInput.upstreamBinding.unifiedParsedPackage.currentness,
      ).toBe('current');
      expect(assessmentInput.publicPackageObservation).toMatchObject({
        contentUnitCount: 599,
        sourceRefCount: 600,
      });
      expect(
        assessmentInput.publicPackageObservation.pageSourceRefs,
      ).toHaveLength(22);
      expect(
        assessmentInput.publicPackageObservation.pageSourceRefs[0].quote,
      ).not.toBe('Untitled');
    });
  },
);
