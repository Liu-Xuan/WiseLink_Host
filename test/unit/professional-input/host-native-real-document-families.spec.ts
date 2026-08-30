import { basename, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

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

import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';

import { HostNativeDocumentFamilyPdfProducerAdapter } from '../../../server/modules/canonical-host/exact-ftd-frozen2-pdf-producer.adapter';
import {
  hostNativePdfClassificationFor,
  recognizeHostNativePdfProfile,
  type HostNativePdfDocumentType,
} from '../../../server/modules/canonical-host/host-native-pdf-profile.registry';
import { scopedProfessionalArtifactRef } from '../../../server/modules/canonical-host/scoped-professional-artifact-correlation.port';
import { PdfjsDistLayoutExtractor } from '../../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import { Frozen2CandidateReaderService } from '../../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { PythonU0FullPackageValidatorAdapter } from '../../../server/modules/unified-reader/python-u0-full-package-validator.adapter';
import { U0FullValidationService } from '../../../server/modules/unified-reader/u0-full-validation.service';
import { UnifiedReaderService } from '../../../server/modules/unified-reader/unified-reader.service';
import type {
  ImmutableArtifactPersistResult,
  UnifiedArtifactStorePort,
} from '../../../server/modules/unified-reader/unified-reader.types';
import { sha256Raw } from '../../../server/modules/unified-reader/unified-reader.utils';

const U0_CONTRACT_COMMIT = 'fa69ada08265934951df53c7a61a3ccdb8cb2900';

interface RealFamilyCase {
  key: string;
  path: string | undefined;
  family: 'AD' | 'MT' | 'SB' | 'SIL' | 'SL';
  issuerAuthority: string;
  adapterId: string;
  documentCode: string;
  query: string;
  businessRevision: string;
  expectedParserProfileId: string;
  expectedDocumentType: HostNativePdfDocumentType;
  expectedOcrRequiredPages?: readonly number[];
}

const REAL_FAMILY_CASES: RealFamilyCase[] = [
  {
    key: 'boeing-sb',
    path: process.env.WL31_REAL_BOEING_SB_PDF_PATH?.trim(),
    family: 'SB',
    issuerAuthority: 'BOEING',
    adapterId: 'issuer.boeing.service_bulletin.v1',
    documentCode: '777-34-0425',
    query: '777-34-0425',
    businessRevision: 'Original Issue',
    expectedParserProfileId: 'parser-profile:boeing.sb@1.0.0',
    expectedDocumentType: 'service_bulletin',
  },
  {
    key: 'airbus-sb',
    path: process.env.WL31_REAL_AIRBUS_SB_PDF_PATH?.trim(),
    family: 'SB',
    issuerAuthority: 'AIRBUS',
    adapterId: 'issuer.airbus.service_bulletin.v1',
    documentCode: 'A320-23-1837',
    query: 'A320-23-1837',
    businessRevision: 'Revision 04',
    expectedParserProfileId: 'parser-profile:airbus.sb@1.0.0',
    expectedDocumentType: 'service_bulletin',
  },
  {
    key: 'faa-ad',
    path: process.env.WL31_REAL_FAA_AD_PDF_PATH?.trim(),
    family: 'AD',
    issuerAuthority: 'FAA',
    adapterId: 'issuer.faa.airworthiness_directive.v1',
    documentCode: 'AD-2011-03-14',
    query: '2011-03-14',
    businessRevision: 'Original Issue',
    expectedParserProfileId: 'parser-profile:faa.ad@1.0.0',
    expectedDocumentType: 'airworthiness_directive',
  },
  {
    key: 'honeywell-sil',
    path: process.env.WL31_REAL_HONEYWELL_SIL_PDF_PATH?.trim(),
    family: 'SIL',
    issuerAuthority: 'HONEYWELL',
    adapterId: 'issuer.honeywell.sil.v1',
    documentCode: 'D201908000037',
    query: 'service information',
    businessRevision: 'Revision 4',
    expectedParserProfileId: 'parser-profile:honeywell.sil@1.0.0',
    expectedDocumentType: 'service_information_letter',
  },
  {
    key: 'boeing-maintenance-tip',
    path: process.env.WL31_REAL_BOEING_MT_PDF_PATH?.trim(),
    family: 'MT',
    issuerAuthority: 'BOEING',
    adapterId: 'issuer.boeing.maintenance_tip.v1',
    documentCode: '787 MT 51-001',
    query: 'torx-plus',
    businessRevision: 'Revision 3',
    expectedParserProfileId: 'parser-profile:boeing.maintenance_tip@1.0.0',
    expectedDocumentType: 'maintenance_tip',
    expectedOcrRequiredPages: [2],
  },
  {
    key: 'airbus-ril',
    path: process.env.WL31_REAL_AIRBUS_RIL_PDF_PATH?.trim(),
    family: 'SB',
    issuerAuthority: 'AIRBUS',
    adapterId: 'issuer.airbus.retrofit_information_letter.v1',
    documentCode: 'V27M24001856',
    query: 'retrofit',
    businessRevision: 'Revision 03',
    expectedParserProfileId:
      'parser-profile:airbus.retrofit_information_letter@1.0.0',
    expectedDocumentType: 'retrofit_information_letter',
  },
  {
    key: 'airbus-aot',
    path: process.env.WL31_REAL_AIRBUS_AOT_PDF_PATH?.trim(),
    family: 'SB',
    issuerAuthority: 'AIRBUS',
    adapterId: 'issuer.airbus.operator_transmission.v1',
    documentCode: 'A32N033-24',
    query: 'alert operators transmission',
    businessRevision: 'Revision 03',
    expectedParserProfileId:
      'parser-profile:airbus.operator_transmission@1.0.0',
    expectedDocumentType: 'operator_transmission',
    expectedOcrRequiredPages: [4, 27, 28, 37, 38, 42],
  },
  {
    key: 'airbus-oit',
    path: process.env.WL31_REAL_AIRBUS_OIT_PDF_PATH?.trim(),
    family: 'SB',
    issuerAuthority: 'AIRBUS',
    adapterId: 'issuer.airbus.operator_transmission.v1',
    documentCode: '999.0013/26',
    query: 'operators information transmission',
    businessRevision: 'Revision 00',
    expectedParserProfileId:
      'parser-profile:airbus.operator_transmission@1.0.0',
    expectedDocumentType: 'operator_transmission',
  },
  {
    key: 'airbus-fot',
    path: process.env.WL31_REAL_AIRBUS_FOT_PDF_PATH?.trim(),
    family: 'SB',
    issuerAuthority: 'AIRBUS',
    adapterId: 'issuer.airbus.operator_transmission.v1',
    documentCode: '999.0062/25',
    query: 'flight operations transmission',
    businessRevision: 'Revision 00',
    expectedParserProfileId:
      'parser-profile:airbus.operator_transmission@1.0.0',
    expectedDocumentType: 'operator_transmission',
  },
  {
    key: 'airbus-sbit',
    path: process.env.WL31_REAL_AIRBUS_SBIT_PDF_PATH?.trim(),
    family: 'SB',
    issuerAuthority: 'AIRBUS',
    adapterId: 'issuer.airbus.operator_transmission.v1',
    documentCode: '24-0015',
    query: 'operators information transmission',
    businessRevision: 'Revision 03',
    expectedParserProfileId:
      'parser-profile:airbus.operator_transmission@1.0.0',
    expectedDocumentType: 'operator_transmission',
  },
  {
    key: 'airbus-als',
    path: process.env.WL31_REAL_AIRBUS_ALS_PDF_PATH?.trim(),
    family: 'MT',
    issuerAuthority: 'AIRBUS',
    adapterId: 'issuer.airbus.maintenance_programme.v1',
    documentCode: 'A320-ALS-PART-3-V11.1',
    query: 'airworthiness limitations',
    businessRevision: 'Variation 11.1',
    expectedParserProfileId:
      'parser-profile:airbus.maintenance_programme@1.0.0',
    expectedDocumentType: 'maintenance_programme',
  },
  {
    key: 'airbus-etops-cmp',
    path: process.env.WL31_REAL_AIRBUS_CMP_PDF_PATH?.trim(),
    family: 'MT',
    issuerAuthority: 'AIRBUS',
    adapterId: 'issuer.airbus.maintenance_programme.v1',
    documentCode: 'A330-ETOPS-CMP',
    query: 'ETOPS',
    businessRevision: 'Revision 39',
    expectedParserProfileId:
      'parser-profile:airbus.maintenance_programme@1.0.0',
    expectedDocumentType: 'maintenance_programme',
  },
];

const describeRealFamilies = REAL_FAMILY_CASES.every((item) => item.path)
  ? describe
  : describe.skip;

const REAL_OCR_BLOCKED_BOEING_SL_PATH =
  process.env.WL31_REAL_BOEING_SL_PDF_PATH?.trim();
const describeRealOcrBlockedBoeingSl = REAL_OCR_BLOCKED_BOEING_SL_PATH
  ? describe
  : describe.skip;

const REAL_UNAVAILABLE_CASES = [
  {
    key: 'aeo-engineering-pdf',
    path: process.env.WL31_REAL_AEO_PDF_PATH?.trim(),
    expectedFamily: 'GENERIC',
  },
  {
    key: 'amm-linked-response',
    path: process.env.WL31_REAL_AMM_LINKED_RESPONSE_PDF_PATH?.trim(),
    expectedFamily: 'MT',
  },
  {
    key: 'airbus-tfu-support-document',
    path: process.env.WL31_REAL_AIRBUS_TFU_PDF_PATH?.trim(),
    expectedFamily: 'GENERIC',
  },
  {
    key: 'airbus-concession-support-document',
    path: process.env.WL31_REAL_AIRBUS_CONCESSION_PDF_PATH?.trim(),
    expectedFamily: 'GENERIC',
    expectedOcrRequiredPages: [5],
  },
] as const;

const describeRealUnavailable = REAL_UNAVAILABLE_CASES.every(
  (item) => item.path,
)
  ? describe
  : describe.skip;

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

describeRealOcrBlockedBoeingSl(
  'Boeing SL profile recognition with the actual OCR-blocked PDF',
  () => {
    it('never turns the page-9 visual-text gap into a package-success claim', async () => {
      const sourceBytes = await readFile(
        REAL_OCR_BLOCKED_BOEING_SL_PATH as string,
      );
      try {
        const layout = new PdfjsDistLayoutExtractor().extractLayout(
          sourceBytes,
        );
        expect(recognizeHostNativePdfProfile(layout, 'SL')).toMatchObject({
          adapterId: 'issuer.boeing.service_letter.v1',
          parserProfileId: 'parser-profile:boeing.sl@1.0.0',
          documentType: 'service_letter',
        });
      } catch (error) {
        expect(error).toMatchObject({
          code: 'PDF_OCR_REQUIRED_UNSUPPORTED',
          diagnostic: expect.objectContaining({
            ocrRequirementKind: 'VISUAL_TEXT_UNVERIFIED',
            ocrRequiredPages: [9],
            visualTextUnverifiedPages: [9],
            visualTextUnverifiedPageDetails: expect.arrayContaining([
              expect.stringContaining(
                '9:textChars=554;unverifiedRasterPageAreaRatio=0.282093;regions=2',
              ),
            ]),
            ocrProviderStatus: 'UNAVAILABLE_CURRENT_PRODUCTION',
          }),
        });
      }
    });
  },
);

describeRealUnavailable(
  'Host-native profile gate with real unsupported engineering PDFs',
  () => {
    jest.setTimeout(120_000);

    it.each(REAL_UNAVAILABLE_CASES)(
      '$key preserves its current unavailable or OCR-required boundary',
      async (fixture) => {
        const sourceBytes = await readFile(fixture.path as string);
        try {
          const layout = new PdfjsDistLayoutExtractor().extractLayout(
            sourceBytes,
          );
          if ('expectedOcrRequiredPages' in fixture) {
            throw new Error('EXPECTED_PDF_OCR_REQUIRED_UNSUPPORTED');
          }
          const pagesWithText = new Set(
            layout.textRuns
              .filter((run) => run.text.trim().length > 0)
              .map((run) => run.page),
          );

          expect(pagesWithText.size).toBe(layout.pageCount);
          expect(
            recognizeHostNativePdfProfile(layout, fixture.expectedFamily),
          ).toBeNull();
        } catch (error) {
          if (!('expectedOcrRequiredPages' in fixture)) throw error;
          expect(error).toMatchObject({
            code: 'PDF_OCR_REQUIRED_UNSUPPORTED',
            diagnostic: expect.objectContaining({
              ocrRequiredPages: fixture.expectedOcrRequiredPages,
              visualTextUnverifiedPages: fixture.expectedOcrRequiredPages,
              ocrProviderStatus: 'UNAVAILABLE_CURRENT_PRODUCTION',
            }),
          });
        }
      },
    );
  },
);

describeRealFamilies(
  'Host-native production profiles with real engineering PDF families',
  () => {
    jest.setTimeout(600_000);

    it.each(REAL_FAMILY_CASES)(
      '$key reads FileService/DV actual bytes -> frozen.2/U0 -> Unified Reader',
      async (fixture) => {
        const sourceBytes = await readFile(fixture.path as string);
        const sourceSha256 = sha256Raw(sourceBytes);
        const classification = hostNativePdfClassificationFor({
          family: fixture.family,
          issuerAuthority: fixture.issuerAuthority,
          adapterId: fixture.adapterId,
        });
        expect(classification).toMatchObject({
          normalizedFamily: fixture.family,
          parserProfileId: fixture.expectedParserProfileId,
        });
        if (!classification) throw new Error('TEST_PROFILE_NOT_ACTIVATED');

        const bucketId = `bucket-real-${fixture.key}`;
        const sourceFilePath = `/document-management/source/${fixture.key}/${sourceSha256}.pdf`;
        const sourceProviderObjectId = `provider-source-${fixture.key}`;
        const professionalFilePath = `/canonical-host/professional-artifacts/${fixture.key}.json`;
        const professionalProviderObjectId = `provider-professional-${fixture.key}`;
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
                  providerObjectId: professionalProviderObjectId,
                  providerVersionId: professionalProviderObjectId,
                  providerUpdatedAt: '2026-08-30T00:00:00.000Z',
                  fileName: `${fixture.key}.json`,
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
                filePath: sourceFilePath,
                providerObjectId: sourceProviderObjectId,
                providerVersionId: sourceProviderObjectId,
                providerUpdatedAt: '2026-08-30T00:00:00.000Z',
                fileName: basename(fixture.path as string),
                mediaType: 'application/pdf',
                providerByteLength: sourceBytes.byteLength,
                bytes: sourceBytes,
                byteLength: sourceBytes.byteLength,
                sha256: sourceSha256,
                readbackVerified: true,
              };
            },
          ),
        };

        const documentId = `document-real-${fixture.key}`;
        const documentVersionId = `document-version-real-${fixture.key}`;
        const sourceArtifactId = `source-artifact-real-${fixture.key}`;
        const resolveCurrent = jest.fn(async () => ({
          version: {
            documentId,
            documentVersionId,
            sourceArtifactId,
            originalFilename: basename(fixture.path as string),
            lifecycleStatus: 'COMMITTED_IMMUTABLE',
            pdfSha256: sourceSha256,
            byteLength: sourceBytes.byteLength,
            committedAt: '2026-08-30T00:00:00.000Z',
            businessRevision: fixture.businessRevision,
          },
          family: {
            familyId: `publication-family-real-${fixture.key}`,
            documentFamily: fixture.family,
            issuerAuthority: fixture.issuerAuthority,
            canonicalDocumentNumber: fixture.documentCode,
            currentDocumentVersionId: documentVersionId,
            currentGeneration: 1,
          },
          preflight: {
            normalizedDescriptorJson: JSON.stringify({
              adapterRelease: {
                adapterId: fixture.adapterId,
                adapterVersion: 'v8.4-document-family-adapter.v1',
              },
            }),
          },
          artifact: {
            sourceArtifactId,
            bucketId,
            filePath: sourceFilePath,
            providerObjectId: sourceProviderObjectId,
            providerVersionId: sourceProviderObjectId,
            mediaType: 'application/pdf',
            sha256: sourceSha256,
            byteLength: sourceBytes.byteLength,
            readbackVerified: true,
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
            validatorRevision: `real-family-${fixture.key}-test`,
          }),
        );
        const producer = new HostNativeDocumentFamilyPdfProducerAdapter(
          fileService as never,
          { resolve: resolveCurrent } as never,
          fullValidator,
          {
            available: true,
            persistAndCorrelate: jest.fn(
              async (correlationRequest, produced) => {
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
                    ownerDocumentVersionId:
                      correlationRequest.documentVersionId,
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
                      providerObjectId: professionalProviderObjectId,
                    },
                  },
                  lineage: { ...produced.lineage },
                };
              },
            ),
          },
        );

        const workItemId = `work-item-real-${fixture.key}`;
        const requestId = `request-real-${fixture.key}`;
        const produced = await producer.producePdf({
          schemaVersion:
            'wiselink.3_1.canonical_pdf_vertical_request.v0.candidate',
          workItemId,
          requestId,
          source: {
            documentId,
            documentVersionId,
            parserRequestId: requestId,
            sourceArtifactId,
            sourceFileSha256: `sha256:${sourceSha256}`,
            sourceByteLength: sourceBytes.byteLength,
            driveFileToken: sourceProviderObjectId,
            driveSourceVersion: sourceProviderObjectId,
          },
          classification,
          query: fixture.query,
        });

        expect(resolveCurrent).toHaveBeenCalledWith(documentVersionId, {
          requireCurrent: true,
        });
        if (fixture.expectedOcrRequiredPages) {
          expect(produced).toMatchObject({
            kind: 'FAILURE_SIGNAL',
            failureCode: 'PDF_OCR_REQUIRED_UNSUPPORTED',
            parameters: {
              ocrRequiredPages: fixture.expectedOcrRequiredPages.map(String),
              visualTextUnverifiedPages:
                fixture.expectedOcrRequiredPages.map(String),
            },
          });
          expect(professionalBytes).toBeNull();
          return;
        }
        if (produced.kind !== 'PACKAGE') {
          throw new Error(`${produced.failureCode}: ${produced.message}`);
        }
        expect(produced.kind).toBe('PACKAGE');
        expect(produced).toMatchObject({
          contractId: 'techpub.parsed-package.v1',
          contractRevision: 'frozen.2',
          strictReaderValidated: true,
          documentIdentity: {
            documentCode: fixture.documentCode,
            businessRevision: fixture.businessRevision,
          },
          usagePolicy: {
            presentationMode: 'ENGINEERING_DOCUMENT',
            qualityStatus: 'PASS',
            assessmentAutoAdoptionAllowed: false,
            aeoAutoAdoptionAllowed: false,
            projectionSource: 'IMMUTABLE_PACKAGE_ACTUAL_BYTES',
          },
        });

        const pkg = JSON.parse(
          Buffer.from(produced.bytes).toString('utf8'),
        ) as {
          result: { status: string };
          source: { sourcePackageHash: string };
          document: { documentType: { value: string } };
          artifacts: Array<{
            origin: string;
            role: string;
            sha256: string;
            byteLength: number;
          }>;
          sourceRefs: unknown[];
          contentUnits: unknown[];
        };
        expect(pkg).toMatchObject({
          result: { status: 'complete' },
          source: { sourcePackageHash: `sha256:${sourceSha256}` },
          document: {
            documentType: { value: fixture.expectedDocumentType },
          },
        });
        expect(
          pkg.artifacts.find(
            (artifact) =>
              artifact.origin === 'source' && artifact.role === 'pdf',
          ),
        ).toMatchObject({
          sha256: `sha256:${sourceSha256}`,
          byteLength: sourceBytes.byteLength,
        });
        expect(pkg.sourceRefs.length).toBeGreaterThan(0);
        expect(pkg.contentUnits.length).toBeGreaterThan(0);

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
            authority:
              'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
          },
        );
        const readback = await reader.persistAndReadback(produced.bytes, {
          workItemId,
          requestId,
          documentVersionId,
          permissionSnapshotVersion: `permission-snapshot-${fixture.key}`,
          packageId: produced.packageId,
          contractId: produced.contractId,
          contractRevision: produced.contractRevision,
          query: fixture.query,
        });
        expect(readback).toMatchObject({
          status: 'CANDIDATE_READBACK_VERIFIED',
          package: {
            packageId: produced.packageId,
            sourceKind: 'pdf',
            resultStatus: 'complete',
          },
          fullValidatorProof: {
            status: 'FULL_STRICT_VALIDATOR_PASSED',
            contractCommit: U0_CONTRACT_COMMIT,
          },
        });
        expect(readback.queryResults.length).toBeGreaterThan(0);
        expect(
          readback.queryResults.every(
            (result) => result.sourceRefIds.length > 0,
          ),
        ).toBe(true);
      },
    );
  },
);
