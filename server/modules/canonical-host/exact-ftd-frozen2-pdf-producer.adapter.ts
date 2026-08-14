import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { Injectable } from '@nestjs/common';

import type {
  CanonicalParsedPackageUsagePolicy,
  CanonicalPdfVerticalRunRequest,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';
import { MiaodaFileServiceArtifactStore } from '../document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import { U0FullValidationService } from '../unified-reader/u0-full-validation.service';
import { sha256Raw } from '../unified-reader/unified-reader.utils';
import type {
  CanonicalPdfProducerPort,
  CanonicalPdfProducerResult,
} from './canonical-host.types';

interface ExactPdfProfile {
  family: 'FTD' | 'OEM_REFERENCE';
  parserProfileId: string;
  parserProfileHash: string;
  sourceSha256: string;
  sourceByteLength: number;
  documentId: string;
  documentVersionId: string;
  packageId: string;
  assetName: string;
  documentType: 'service_bulletin' | 'oem_reference';
  presentationMode: CanonicalParsedPackageUsagePolicy['presentationMode'];
  executionRoute: string;
}

const EXACT_PROFILES: readonly ExactPdfProfile[] = [
  {
    family: 'FTD',
    parserProfileId: 'parser-profile:boeing.ftd.v1@1.0.0',
    parserProfileHash:
      'sha256:c47a7388da23d106c2476b579308c458332127153930ced8c684212f1b431731',
    sourceSha256:
      'b1b5c198df4a3d42925218f48d70ddc361563c65692be35dac4c81e0d8367a3c',
    sourceByteLength: 122_102,
    documentId: 'document_3943d8eb5b7c7ee8fc742092',
    documentVersionId: 'document_version_fd88dcb9cf64cf3ba21033ef',
    packageId:
      'urn:techpub:package:v1:sha256:9e734a0de1c37c368b954662e9bb11036cc24b430468a073b31da127380df622',
    assetName: 'real-ftd-frozen2.unified-package.json',
    documentType: 'service_bulletin',
    presentationMode: 'ENGINEERING_DOCUMENT',
    executionRoute:
      'file_service_source->exact_ftd_producer_output->u0_frozen2_strict_validator',
  },
  {
    family: 'OEM_REFERENCE',
    parserProfileId: 'parser-profile:generic.document@1.0.0',
    parserProfileHash:
      'sha256:0508c397ca2249dc38507b7de312547503208dad6ad7993659ec900713ed1dde',
    sourceSha256:
      '05cf88265253e63a16bb3d850c2bff5a6b620088a245b316fcdbddcc6a8c0dd8',
    sourceByteLength: 10_036_964,
    documentId: 'document_3ca189e09878d76f24477bf1',
    documentVersionId: 'document_version_ad56cbdaec487e554130afe4',
    packageId:
      'urn:techpub:package:v1:sha256:88824f5f49f28b1f80ad2fc3df7e12b87bee7510f134c06323a5d8ced1b48797',
    assetName: 'airbus-fast61-oem-reference.frozen2.unified-package.json',
    documentType: 'oem_reference',
    presentationMode: 'REFERENCE_ONLY',
    executionRoute:
      'dm_formal_parse_request->controlled_oem_reference_producer_output->u0_frozen2_strict_validator',
  },
] as const;

@Injectable()
export class ExactFtdFrozen2PdfProducerAdapter
  implements CanonicalPdfProducerPort
{
  constructor(
    private readonly fileService: FileService,
    private readonly resolver: MiaodaDocumentVersionSourceResolver,
    private readonly validator: U0FullValidationService,
  ) {}

  async producePdf(
    request: CanonicalPdfVerticalRunRequest,
  ): Promise<CanonicalPdfProducerResult> {
    const profile = exactProfileForRequest(request);
    if (!profile) {
      return {
        kind: 'FAILURE_SIGNAL',
        failureCode: 'PDF_PRODUCER_PROFILE_NOT_AVAILABLE',
        message:
          'No verified exact PDF producer profile matches this controlled DocumentVersion and classification.',
        executionRoute: 'dm_document_version->exact_pdf_frozen2_adapter',
      };
    }
    const resolved = await this.resolver.resolve(profile.documentVersionId);
    if (
      resolved.version.documentId !== profile.documentId ||
      resolved.family.documentFamily !== profile.family
    ) {
      throw new Error('PDF_PRODUCER_DOCUMENT_VERSION_READBACK_MISMATCH');
    }
    const sourceStore = new MiaodaFileServiceArtifactStore(this.fileService);
    const selection = await sourceStore.readSelection({
      bucketId: resolved.artifact.bucketId,
      filePath: resolved.artifact.filePath,
    });
    if (
      selection.readbackVerified !== true ||
      selection.sha256 !== profile.sourceSha256 ||
      Number(selection.byteLength) !== profile.sourceByteLength ||
      selection.providerObjectId !== resolved.artifact.providerObjectId
    ) {
      throw new Error('PDF_PRODUCER_SOURCE_READBACK_MISMATCH');
    }

    const bytes = await readPackageAsset(profile.assetName);
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<
      string,
      unknown
    >;
    const usagePolicy = assertPackageSourceBinding(parsed, profile);
    const artifact: UnifiedPackageArtifactDescriptor = {
      storeRole: 'UnifiedArtifactStoreCandidate',
      ref: `artifact://UnifiedArtifactStoreCandidate/unified-parsed-packages/sha256/${sha256Raw(bytes)}`,
      sha256: sha256Raw(bytes),
      byteLength: bytes.byteLength,
      mediaType: 'application/json',
    };
    await this.validator.validate({
      artifact,
      bytes,
      packageId: profile.packageId,
    });
    return {
      kind: 'PACKAGE',
      packageId: profile.packageId,
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      bytes,
      strictReaderValidated: true,
      executionRoute: profile.executionRoute,
      usagePolicy,
    };
  }
}

function exactProfileForRequest(
  request: CanonicalPdfVerticalRunRequest,
): ExactPdfProfile | undefined {
  return EXACT_PROFILES.find(
    (profile) =>
      request.source.documentId === profile.documentId &&
      request.source.documentVersionId === profile.documentVersionId &&
      request.source.sourceFileSha256 === `sha256:${profile.sourceSha256}` &&
      request.source.sourceByteLength === profile.sourceByteLength &&
      request.classification.normalizedFamily === profile.family &&
      request.classification.parserProfileId === profile.parserProfileId &&
      request.classification.parserProfileHash === profile.parserProfileHash,
  );
}

async function readPackageAsset(assetName: string): Promise<Uint8Array> {
  const candidates = [
    resolve(
      process.cwd(),
      'dist/server/runtime-assets/first-vertical',
      assetName,
    ),
    resolve(process.cwd(), 'test/fixtures', assetName),
    resolve(__dirname, '../../runtime-assets/first-vertical', assetName),
  ];
  for (const path of candidates) {
    try {
      return new Uint8Array(await readFile(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error('PDF_PRODUCER_ASSET_NOT_PACKAGED');
}

function assertPackageSourceBinding(
  value: Record<string, unknown>,
  profile: ExactPdfProfile,
): CanonicalParsedPackageUsagePolicy {
  const source = value.source as Record<string, unknown> | undefined;
  const artifacts = value.artifacts as Array<Record<string, unknown>> | undefined;
  const legacy = source?.legacyIdentifiers as
    | Array<Record<string, unknown>>
    | undefined;
  const sourceArtifact = artifacts?.find(
    (artifact) => artifact.origin === 'source' && artifact.role === 'pdf',
  );
  const legacyMap = new Map(
    (legacy ?? []).map((item) => [String(item.namespace), String(item.value)]),
  );
  const document = value.document as Record<string, unknown> | undefined;
  const documentType = document?.documentType as
    | Record<string, unknown>
    | undefined;
  const result = value.result as Record<string, unknown> | undefined;
  const applicability = value.applicability as Record<string, unknown> | undefined;
  const sourceExpressions = arrayValue(
    applicability?.sourceExpressions,
    'applicability.sourceExpressions',
  );
  const normalizedCandidates = arrayValue(
    applicability?.normalizedCandidates,
    'applicability.normalizedCandidates',
  );
  const assignments = arrayValue(
    applicability?.assignments,
    'applicability.assignments',
  );
  if (
    value.packageId !== profile.packageId ||
    value.schemaVersion !== 'techpub.parsed-package.v1' ||
    value.contractRevision !== 'frozen.2' ||
    source?.sourcePackageHash !== `sha256:${profile.sourceSha256}` ||
    legacyMap.get('wiselink_document_id') !== profile.documentId ||
    legacyMap.get('wiselink_document_version_id') !==
      profile.documentVersionId ||
    sourceArtifact?.sha256 !== `sha256:${profile.sourceSha256}` ||
    Number(sourceArtifact?.byteLength) !== profile.sourceByteLength ||
    documentType?.value !== profile.documentType ||
    !['complete', 'partial'].includes(String(result?.status))
  ) {
    throw new Error('PDF_PRODUCER_PACKAGE_SOURCE_BINDING_MISMATCH');
  }
  if (
    profile.presentationMode === 'REFERENCE_ONLY' &&
    (result?.status !== 'partial' ||
      sourceExpressions.length !== 0 ||
      normalizedCandidates.length !== 0 ||
      assignments.length !== 0)
  ) {
    throw new Error('OEM_REFERENCE_PACKAGE_AUTHORITY_BOUNDARY_INVALID');
  }
  return {
    presentationMode: profile.presentationMode,
    qualityStatus: result?.status === 'complete' ? 'PASS' : 'NEEDS_REVIEW',
    applicability: {
      sourceExpressionCount: sourceExpressions.length,
      normalizedCandidateCount: normalizedCandidates.length,
      assignmentCount: assignments.length,
    },
    assessmentAutoAdoptionAllowed: false,
    aeoAutoAdoptionAllowed: false,
    projectionSource: 'IMMUTABLE_PACKAGE_ACTUAL_BYTES',
  };
}

function arrayValue(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`PDF_PRODUCER_PACKAGE_INVALID:${field}`);
  }
  return value;
}
