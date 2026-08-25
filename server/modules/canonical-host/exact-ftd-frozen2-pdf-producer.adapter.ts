import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { Injectable } from '@nestjs/common';

import type {
  CanonicalClassificationSelection,
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
import { PHASE5_737_34_3830_HANDOFF } from '../document-management/src/hosted/phase5BoeingSbHandoff.js';
import { runProfessionalInputPipeline } from '../professional-input/builders/professional-input-pipeline';
import { PdfjsDistLayoutExtractor } from '../professional-input/parser/pdfjs-dist-layout-extractor.adapter';

interface ExactPdfProfile {
  family: 'FTD' | 'OEM_REFERENCE' | 'SB';
  parserProfileId: string;
  parserProfileHash: string;
  documentType: 'service_bulletin' | 'oem_reference';
  presentationMode: CanonicalParsedPackageUsagePolicy['presentationMode'];
  executionRoute: string;
}

interface ExactPdfBinding {
  profile: ExactPdfProfile;
  sourceSha256: string;
  sourceByteLength: number;
  documentId: string;
  documentVersionId: string;
  packageId: string;
  assetName: string;
  documentCode: string;
  businessRevision: string | null;
  packageRevisionLabel: string | null;
}

const FTD_PROFILE: ExactPdfProfile = {
  family: 'FTD',
  parserProfileId: 'parser-profile:boeing.ftd.v1@1.0.0',
  parserProfileHash:
    'sha256:c47a7388da23d106c2476b579308c458332127153930ced8c684212f1b431731',
  documentType: 'service_bulletin',
  presentationMode: 'ENGINEERING_DOCUMENT',
  executionRoute:
    'file_service_source->exact_ftd_producer_output->u0_frozen2_strict_validator',
};

const OEM_REFERENCE_PROFILE: ExactPdfProfile = {
  family: 'OEM_REFERENCE',
  parserProfileId: 'parser-profile:generic.document@1.0.0',
  parserProfileHash:
    'sha256:0508c397ca2249dc38507b7de312547503208dad6ad7993659ec900713ed1dde',
  documentType: 'oem_reference',
  presentationMode: 'REFERENCE_ONLY',
  executionRoute:
    'dm_formal_parse_request->controlled_oem_reference_producer_output->u0_frozen2_strict_validator',
};

const SB_PROFILE: ExactPdfProfile = {
  family: 'SB',
  parserProfileId: phase5Handoff().canonicalHostClassification.parserProfileId,
  parserProfileHash:
    phase5Handoff().canonicalHostClassification.parserProfileHash,
  documentType: 'service_bulletin',
  presentationMode: 'ENGINEERING_DOCUMENT',
  executionRoute:
    'dm_phase5_boeing_sb_document_version->existing_pdf_producer_output->u0_frozen2_strict_validator',
};

const EXACT_BINDINGS: readonly ExactPdfBinding[] = [
  {
    profile: SB_PROFILE,
    sourceSha256: phase5Handoff().source.sha256,
    sourceByteLength: phase5Handoff().source.byteLength,
    documentId: phase5Handoff().catalogIdentity.documentId,
    documentVersionId: phase5Handoff().catalogIdentity.documentVersionId,
    packageId: phase5Handoff().parsedPackageImport.packageId,
    assetName:
      'assessment-host/real-sb/737-34-3830-original-issue/unified-package.frozen-2.json',
    documentCode: phase5Handoff().descriptor.documentCode,
    businessRevision: phase5Handoff().descriptor.businessRevision,
    packageRevisionLabel: null,
  },
  {
    profile: FTD_PROFILE,
    sourceSha256:
      'b1b5c198df4a3d42925218f48d70ddc361563c65692be35dac4c81e0d8367a3c',
    sourceByteLength: 122_102,
    documentId: 'document_3943d8eb5b7c7ee8fc742092',
    documentVersionId: 'document_version_fd88dcb9cf64cf3ba21033ef',
    packageId:
      'urn:techpub:package:v1:sha256:9e734a0de1c37c368b954662e9bb11036cc24b430468a073b31da127380df622',
    assetName: 'real-ftd-frozen2.unified-package.json',
    documentCode: '777-FTD-31-21002',
    businessRevision: null,
    packageRevisionLabel: null,
  },
  {
    profile: OEM_REFERENCE_PROFILE,
    sourceSha256:
      '05cf88265253e63a16bb3d850c2bff5a6b620088a245b316fcdbddcc6a8c0dd8',
    sourceByteLength: 10_036_964,
    documentId: 'document_ca48ac1dc4b0642ef85c97b6',
    documentVersionId: 'document_version_7d5aca8851db8ea41b89003d',
    packageId:
      'urn:techpub:package:v1:sha256:c2e4716fdde0ca6d29673d19ec21288d0030ac07a6d511081e7d857400897aa3',
    assetName: 'airbus-fast61-oem-reference.frozen2.unified-package.json',
    documentCode: 'AIRBUS-FAST',
    businessRevision: 'ISSUE 61',
    packageRevisionLabel: 'ISSUE 61',
  },
  {
    profile: OEM_REFERENCE_PROFILE,
    sourceSha256:
      '7b793ed00e10ae8513de6972cce06128986c938b565986f49aa02405fab4f380',
    sourceByteLength: 7_179_982,
    documentId: 'document_ca48ac1dc4b0642ef85c97b6',
    documentVersionId: 'document_version_c71fbc457cdc5e7a05725a4d',
    packageId:
      'urn:techpub:package:v1:sha256:bd7d7f707b6ac6518d99de187c1f1295f70df5d12714d4eab000f6025cb354a2',
    assetName: 'airbus-fast62-oem-reference.frozen2.unified-package.json',
    documentCode: 'AIRBUS-FAST',
    businessRevision: 'ISSUE 62',
    packageRevisionLabel: 'ISSUE 62',
  },
] as const;

@Injectable()
export class ExactFtdFrozen2PdfProducerAdapter implements CanonicalPdfProducerPort {
  constructor(
    private readonly fileService: FileService,
    private readonly resolver: MiaodaDocumentVersionSourceResolver,
    private readonly validator: U0FullValidationService,
  ) {}

  async producePdf(
    request: CanonicalPdfVerticalRunRequest,
  ): Promise<CanonicalPdfProducerResult> {
    if (matchesHostNativeFtdProfile(request)) {
      return this.produceHostNativeFtd(request);
    }
    const binding = exactBindingForRequest(request);
    if (!binding) {
      return {
        kind: 'FAILURE_SIGNAL',
        failureCode: 'PDF_PRODUCER_PROFILE_NOT_AVAILABLE',
        message:
          'No verified exact PDF producer profile matches this controlled DocumentVersion and classification.',
        executionRoute: 'dm_document_version->exact_pdf_frozen2_adapter',
      };
    }
    const profile = binding.profile;
    const resolved = await this.resolver.resolve(binding.documentVersionId, {
      requireCurrent: true,
    });
    if (
      resolved.version.documentId !== binding.documentId ||
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
      selection.sha256 !== binding.sourceSha256 ||
      Number(selection.byteLength) !== binding.sourceByteLength ||
      selection.providerObjectId !== resolved.artifact.providerObjectId
    ) {
      throw new Error('PDF_PRODUCER_SOURCE_READBACK_MISMATCH');
    }

    const bytes = await readPackageAsset(binding.assetName);
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<
      string,
      unknown
    >;
    const usagePolicy = assertPackageSourceBinding(parsed, binding);
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
      packageId: binding.packageId,
    });
    return {
      kind: 'PACKAGE',
      packageId: binding.packageId,
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      bytes,
      strictReaderValidated: true,
      executionRoute: profile.executionRoute,
      usagePolicy,
      documentIdentity: {
        documentCode: binding.documentCode,
        businessRevision: binding.businessRevision,
      },
    };
  }

  private async produceHostNativeFtd(
    request: CanonicalPdfVerticalRunRequest,
  ): Promise<CanonicalPdfProducerResult> {
    const resolved = await this.resolver.resolve(
      request.source.documentVersionId,
      { requireCurrent: true },
    );
    if (
      resolved.version.documentId !== request.source.documentId ||
      resolved.version.documentVersionId !== request.source.documentVersionId ||
      resolved.version.sourceArtifactId !== request.source.sourceArtifactId ||
      resolved.family.documentFamily !== 'FTD' ||
      resolved.artifact.sourceArtifactId !== request.source.sourceArtifactId ||
      resolved.artifact.mediaType !== 'application/pdf' ||
      request.source.sourceFileSha256 !==
        `sha256:${resolved.artifact.sha256}` ||
      request.source.sourceByteLength !== Number(resolved.artifact.byteLength)
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
      selection.sha256 !== resolved.artifact.sha256 ||
      selection.byteLength !== Number(resolved.artifact.byteLength) ||
      selection.providerObjectId !== resolved.artifact.providerObjectId
    ) {
      throw new Error('PDF_PRODUCER_SOURCE_READBACK_MISMATCH');
    }
    const pipeline = runProfessionalInputPipeline(
      {
        pdfBytes: selection.bytes,
        artifact: {
          artifactRef: `artifact://CanonicalArtifactStore/${resolved.artifact.filePath.replace(/^\/+/, '')}`,
          normalizedPath: resolved.version.originalFilename,
        },
        document: {
          documentCode: resolved.family.canonicalDocumentNumber,
          documentType: FTD_PROFILE.documentType,
          language: 'en-US',
        },
        lineage: {
          generatedAt: new Date(resolved.version.committedAt).toISOString(),
          producerName: 'WiseLinkCanonicalHostProfessionalInput',
          producerVersion: 'professional-input-pure.v1.candidate.1',
        },
      },
      { extractor: new PdfjsDistLayoutExtractor() },
    );
    await this.validator.validate(pipeline.u0Input);
    return {
      kind: 'PACKAGE',
      packageId: pipeline.pkg.packageId,
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      bytes: pipeline.u0Input.bytes,
      strictReaderValidated: true,
      executionRoute: FTD_PROFILE.executionRoute,
      usagePolicy: {
        presentationMode: FTD_PROFILE.presentationMode,
        qualityStatus: 'PASS',
        applicability: {
          sourceExpressionCount: 0,
          normalizedCandidateCount: 0,
          assignmentCount: 0,
        },
        assessmentAutoAdoptionAllowed: false,
        aeoAutoAdoptionAllowed: false,
        projectionSource: 'IMMUTABLE_PACKAGE_ACTUAL_BYTES',
      },
      documentIdentity: {
        documentCode: resolved.family.canonicalDocumentNumber,
        businessRevision: resolved.version.businessRevision || null,
      },
    };
  }
}

function matchesHostNativeFtdProfile(
  request: CanonicalPdfVerticalRunRequest,
): boolean {
  return (
    request.classification.normalizedFamily === FTD_PROFILE.family &&
    request.classification.parserProfileId === FTD_PROFILE.parserProfileId &&
    request.classification.parserProfileHash === FTD_PROFILE.parserProfileHash
  );
}

function exactBindingForRequest(
  request: CanonicalPdfVerticalRunRequest,
): ExactPdfBinding | undefined {
  return EXACT_BINDINGS.find(
    (binding) =>
      request.source.documentId === binding.documentId &&
      request.source.documentVersionId === binding.documentVersionId &&
      request.source.sourceFileSha256 === `sha256:${binding.sourceSha256}` &&
      request.source.sourceByteLength === binding.sourceByteLength &&
      request.classification.normalizedFamily === binding.profile.family &&
      request.classification.parserProfileId ===
        binding.profile.parserProfileId &&
      request.classification.parserProfileHash ===
        binding.profile.parserProfileHash,
  );
}

async function readPackageAsset(assetName: string): Promise<Uint8Array> {
  const candidates = [
    resolve(process.cwd(), 'dist/server/runtime-assets', assetName),
    resolve(
      process.cwd(),
      'dist/server/runtime-assets/first-vertical',
      assetName,
    ),
    resolve(process.cwd(), 'server/runtime-assets', assetName),
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

function phase5Handoff() {
  return PHASE5_737_34_3830_HANDOFF as {
    source: { sha256: string; byteLength: number };
    descriptor: { documentCode: string; businessRevision: string };
    catalogIdentity: { documentId: string; documentVersionId: string };
    canonicalHostClassification: CanonicalClassificationSelection;
    parsedPackageImport: { packageId: string };
  };
}

function assertPackageSourceBinding(
  value: Record<string, unknown>,
  binding: ExactPdfBinding,
): CanonicalParsedPackageUsagePolicy {
  const profile = binding.profile;
  const source = value.source as Record<string, unknown> | undefined;
  const artifacts = value.artifacts as
    | Array<Record<string, unknown>>
    | undefined;
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
  const identifiers = arrayValue(
    document?.identifiers,
    'document.identifiers',
  ) as Array<Record<string, unknown>>;
  const documentCode = identifiers.find(
    (identifier) => identifier.scheme === 'oem_document_code',
  )?.value;
  const revision = document?.revision as Record<string, unknown> | undefined;
  const revisionLabel = (revision?.label as Record<string, unknown> | undefined)
    ?.value;
  const result = value.result as Record<string, unknown> | undefined;
  const applicability = value.applicability as
    | Record<string, unknown>
    | undefined;
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
    value.packageId !== binding.packageId ||
    value.schemaVersion !== 'techpub.parsed-package.v1' ||
    value.contractRevision !== 'frozen.2' ||
    source?.sourcePackageHash !== `sha256:${binding.sourceSha256}` ||
    legacyMap.get('wiselink_document_id') !== binding.documentId ||
    legacyMap.get('wiselink_document_version_id') !==
      binding.documentVersionId ||
    sourceArtifact?.sha256 !== `sha256:${binding.sourceSha256}` ||
    Number(sourceArtifact?.byteLength) !== binding.sourceByteLength ||
    documentType?.value !== profile.documentType ||
    documentCode !== binding.documentCode ||
    (revisionLabel ?? null) !== binding.packageRevisionLabel ||
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
