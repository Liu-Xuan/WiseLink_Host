import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { Inject, Injectable, Optional } from '@nestjs/common';

import type {
  CanonicalParsedPackageUsagePolicy,
  CanonicalPdfVerticalRunRequest,
} from '@shared/api.interface';
import { MiaodaFileServiceArtifactStore } from '../document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import { runProfessionalInputPipelineFromLayout } from '../professional-input/builders/professional-input-pipeline';
import { PdfjsDistLayoutExtractor } from '../professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import { ProfessionalInputPureError } from '../professional-input/pure/professional-input-pure.error';
import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import { U0FullValidationService } from '../unified-reader/u0-full-validation.service';
import type {
  CanonicalPdfFailureParameter,
  CanonicalPdfProducerPort,
  CanonicalPdfProducerResult,
} from './canonical-host.types';
import { SCOPED_PROFESSIONAL_ARTIFACT_CORRELATION } from './canonical-host.constants';
import {
  assertScopedProfessionalArtifactCorrelation,
  type ScopedProfessionalArtifactCorrelation,
  type ScopedProfessionalArtifactCorrelationPort,
} from './scoped-professional-artifact-correlation.port';
import {
  hostNativePdfAdapterIdFromDmPreflight,
  matchesHostNativePdfClassification,
  recognizeHostNativePdfProfile,
  type HostNativePdfProfile,
} from './host-native-pdf-profile.registry';

@Injectable()
export class HostNativeDocumentFamilyPdfProducerAdapter implements CanonicalPdfProducerPort {
  constructor(
    private readonly fileService: FileService,
    private readonly resolver: MiaodaDocumentVersionSourceResolver,
    private readonly validator: U0FullValidationService,
    @Optional()
    @Inject(SCOPED_PROFESSIONAL_ARTIFACT_CORRELATION)
    private readonly professionalCorrelations?: ScopedProfessionalArtifactCorrelationPort,
  ) {}

  async producePdf(
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
      resolved.version.pdfSha256 !== resolved.artifact.sha256 ||
      Number(resolved.version.byteLength) !==
        Number(resolved.artifact.byteLength) ||
      resolved.family.documentFamily !==
        request.classification.normalizedFamily ||
      resolved.artifact.sourceArtifactId !== request.source.sourceArtifactId ||
      resolved.artifact.mediaType !== 'application/pdf' ||
      request.source.sourceFileSha256 !==
        `sha256:${resolved.artifact.sha256}` ||
      request.source.sourceByteLength !== Number(resolved.artifact.byteLength)
    ) {
      throw new Error('PDF_PRODUCER_DOCUMENT_VERSION_READBACK_MISMATCH');
    }

    const sourceStore = new MiaodaFileServiceArtifactStore(this.fileService);
    const sourceSelection = await sourceStore.readSelection({
      bucketId: resolved.artifact.bucketId,
      filePath: resolved.artifact.filePath,
    });
    if (
      sourceSelection.readbackVerified !== true ||
      sourceSelection.sha256 !== resolved.artifact.sha256 ||
      sourceSelection.byteLength !== Number(resolved.artifact.byteLength) ||
      sourceSelection.providerObjectId !== resolved.artifact.providerObjectId
    ) {
      throw new Error('PDF_PRODUCER_SOURCE_READBACK_MISMATCH');
    }

    let layout: ReturnType<PdfjsDistLayoutExtractor['extractLayout']>;
    try {
      layout = new PdfjsDistLayoutExtractor().extractLayout(
        sourceSelection.bytes,
      );
    } catch (error) {
      if (
        error instanceof ProfessionalInputPureError &&
        error.code === 'PDF_OCR_REQUIRED_UNSUPPORTED'
      ) {
        return failureSignal(
          error.code,
          error.message,
          'file_service_source->host_native_pdf_layout_provider->ocr_provider_unavailable',
          toCanonicalFailureParameters(error.diagnostic),
        );
      }
      throw error;
    }
    const profile = recognizeHostNativePdfProfile(
      layout,
      resolved.family.documentFamily,
    );
    const dmAdapterId = hostNativePdfAdapterIdFromDmPreflight(
      resolved.preflight,
    );
    if (
      !profile ||
      !matchesHostNativePdfClassification(profile, request.classification) ||
      !matchesResolvedIssuer(profile, resolved.family.issuerAuthority) ||
      (dmAdapterId
        ? dmAdapterId !== profile.adapterId
        : profile.requiresDmAdapterRelease)
    ) {
      return failureSignal(
        'PDF_PRODUCER_PROFILE_NOT_AVAILABLE',
        `No content-evidenced Host-native PDF producer profile matches the DM family, adapter release, and request classification (recognized=${profile?.adapterId ?? 'none'}, dmAdapter=${dmAdapterId || 'none'}, requested=${request.classification.parserProfileId}, family=${resolved.family.documentFamily}).`,
        'dm_document_version->host_native_pdf_pipeline',
      );
    }

    if (!this.professionalCorrelations?.available) {
      return failureSignal(
        'PDF_PRODUCER_CORRELATION_UNAVAILABLE',
        'No Host-owned WorkItem and DocumentVersion scoped professional artifact correlation is available.',
        'dm_document_version->scoped_professional_artifact_correlation',
      );
    }

    let pipeline: ReturnType<typeof runProfessionalInputPipelineFromLayout>;
    try {
      pipeline = runProfessionalInputPipelineFromLayout(layout, {
        artifact: {
          artifactRef: `artifact://CanonicalArtifactStore/${resolved.artifact.filePath.replace(/^\/+/, '')}`,
          normalizedPath: resolved.version.originalFilename,
        },
        document: {
          documentCode: resolved.family.canonicalDocumentNumber,
          documentType: profile.documentType,
          language: 'en-US',
        },
        lineage: {
          generatedAt: new Date(resolved.version.committedAt).toISOString(),
          producerName: 'WiseLinkCanonicalHostProfessionalInput',
          producerVersion: 'professional-input-pure.v1.candidate.1',
        },
      });
    } catch (error) {
      if (
        error instanceof ProfessionalInputPureError &&
        error.code === 'PDF_OCR_REQUIRED_UNSUPPORTED'
      ) {
        return failureSignal(
          error.code,
          error.message,
          'file_service_source->host_native_pdf_layout_provider->ocr_provider_unavailable',
          toCanonicalFailureParameters(error.diagnostic),
        );
      }
      throw error;
    }
    await this.validator.validate(pipeline.u0Input);

    const correlationRequest = {
      workItemId: request.workItemId,
      documentId: request.source.documentId,
      documentVersionId: request.source.documentVersionId,
      sourceArtifactId: request.source.sourceArtifactId,
      sourceSha256: resolved.artifact.sha256,
      sourceByteLength: Number(resolved.artifact.byteLength),
      sourceProviderObjectId: resolved.artifact.providerObjectId,
      classification: request.classification,
    };
    const unresolvedCorrelation =
      await this.professionalCorrelations.persistAndCorrelate(
        correlationRequest,
        {
          packageId: pipeline.pkg.packageId,
          artifact: pipeline.u0Input.artifact,
          bytes: pipeline.u0Input.bytes,
          lineage: {
            producerDocumentId: resolved.version.documentId,
            producerDocumentVersionId: resolved.version.documentVersionId,
            documentCode: resolved.family.canonicalDocumentNumber,
            businessRevision: resolved.version.businessRevision || null,
            packageRevisionLabel: null,
          },
        },
      );
    if (!unresolvedCorrelation) {
      return failureSignal(
        'PDF_PRODUCER_CORRELATION_UNAVAILABLE',
        'No Host-owned WorkItem and DocumentVersion scoped professional artifact correlation is available.',
        'dm_document_version->scoped_professional_artifact_correlation',
      );
    }

    const professionalSelection = await sourceStore.readSelection({
      bucketId:
        unresolvedCorrelation.professionalArtifact.fileServiceLocator.bucketId,
      filePath:
        unresolvedCorrelation.professionalArtifact.fileServiceLocator.filePath,
    });
    const correlation = assertScopedProfessionalArtifactCorrelation(
      correlationRequest,
      unresolvedCorrelation,
      {
        verified: professionalSelection.readbackVerified,
        bytes: professionalSelection.bytes,
        providerObjectId: professionalSelection.providerObjectId,
        sha256: professionalSelection.sha256,
        byteLength: professionalSelection.byteLength,
      },
    );
    assertCorrelationProducedByHostNativePipeline(
      correlation,
      pipeline.u0Input,
      professionalSelection.bytes,
      {
        documentId: resolved.version.documentId,
        documentVersionId: resolved.version.documentVersionId,
        documentCode: resolved.family.canonicalDocumentNumber,
        businessRevision: resolved.version.businessRevision || null,
      },
    );

    const parsed = JSON.parse(
      Buffer.from(professionalSelection.bytes).toString('utf8'),
    ) as Record<string, unknown>;
    const usagePolicy = assertHostNativePackageSourceBinding(
      parsed,
      {
        packageId: pipeline.pkg.packageId,
        sourceSha256: resolved.artifact.sha256,
        sourceByteLength: Number(resolved.artifact.byteLength),
        sourceArtifactRef: `artifact://CanonicalArtifactStore/${resolved.artifact.filePath.replace(/^\/+/, '')}`,
        documentCode: resolved.family.canonicalDocumentNumber,
      },
      profile,
    );

    return {
      kind: 'PACKAGE',
      packageId: pipeline.pkg.packageId,
      contractId: 'techpub.parsed-package.v1',
      contractRevision: 'frozen.2',
      bytes: Uint8Array.from(professionalSelection.bytes),
      strictReaderValidated: true,
      executionRoute: profile.executionRoute,
      usagePolicy,
      documentIdentity: {
        documentCode: resolved.family.canonicalDocumentNumber,
        businessRevision: resolved.version.businessRevision || null,
      },
    };
  }
}

function matchesResolvedIssuer(
  profile: HostNativePdfProfile,
  issuerAuthority: string | null | undefined,
): boolean {
  const normalized = String(issuerAuthority ?? '')
    .trim()
    .replace(/\s+/gu, ' ')
    .toUpperCase();
  if (!normalized) return false;
  if (profile.issuerAuthority === 'FAA') {
    return normalized === 'FAA' || normalized.includes('FEDERAL AVIATION');
  }
  if (profile.issuerAuthority === 'CAAC') {
    return normalized.includes('CAAC') || normalized.includes('中国民用航空局');
  }
  return normalized.includes(profile.issuerAuthority);
}

function failureSignal(
  failureCode: string,
  message: string,
  executionRoute: string,
  parameters?: Record<string, CanonicalPdfFailureParameter>,
): CanonicalPdfProducerResult {
  return {
    kind: 'FAILURE_SIGNAL',
    failureCode,
    message,
    executionRoute,
    ...(parameters ? { parameters } : {}),
  };
}

function toCanonicalFailureParameters(
  diagnostic: Readonly<
    Record<
      string,
      string | number | boolean | readonly string[] | readonly number[]
    >
  >,
): Record<string, CanonicalPdfFailureParameter> {
  return Object.fromEntries(
    Object.entries(diagnostic).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.map(String) : value,
    ]),
  ) as Record<string, CanonicalPdfFailureParameter>;
}

function assertCorrelationProducedByHostNativePipeline(
  correlation: ScopedProfessionalArtifactCorrelation,
  produced: {
    packageId: string;
    artifact: { sha256: string; byteLength: number };
    bytes: Uint8Array;
  },
  actualBytes: Uint8Array,
  expectedLineage: {
    documentId: string;
    documentVersionId: string;
    documentCode: string;
    businessRevision: string | null;
  },
): void {
  if (
    correlation.professionalArtifact.packageId !== produced.packageId ||
    correlation.professionalArtifact.artifact.sha256 !==
      produced.artifact.sha256 ||
    correlation.professionalArtifact.artifact.byteLength !==
      produced.artifact.byteLength ||
    correlation.lineage.producerDocumentId !== expectedLineage.documentId ||
    correlation.lineage.producerDocumentVersionId !==
      expectedLineage.documentVersionId ||
    correlation.lineage.documentCode !== expectedLineage.documentCode ||
    correlation.lineage.businessRevision !== expectedLineage.businessRevision ||
    correlation.lineage.packageRevisionLabel !== null ||
    !sameBytes(actualBytes, produced.bytes)
  ) {
    throw new Error('PDF_PRODUCER_CORRELATION_NOT_FROM_HOST_NATIVE_PIPELINE');
  }
}

function assertHostNativePackageSourceBinding(
  value: Record<string, unknown>,
  expected: {
    packageId: string;
    sourceSha256: string;
    sourceByteLength: number;
    sourceArtifactRef: string;
    documentCode: string;
  },
  profile: HostNativePdfProfile,
): CanonicalParsedPackageUsagePolicy {
  const source = value.source as Record<string, unknown> | undefined;
  const artifacts = value.artifacts as
    | Array<Record<string, unknown>>
    | undefined;
  const sourceArtifact = artifacts?.find(
    (artifact) => artifact.origin === 'source' && artifact.role === 'pdf',
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
    value.packageId !== expected.packageId ||
    value.schemaVersion !== 'techpub.parsed-package.v1' ||
    value.contractRevision !== 'frozen.2' ||
    source?.kind !== 'pdf' ||
    source?.sourcePackageHash !== `sha256:${expected.sourceSha256}` ||
    sourceArtifact?.artifactRef !== expected.sourceArtifactRef ||
    sourceArtifact?.sha256 !== `sha256:${expected.sourceSha256}` ||
    Number(sourceArtifact?.byteLength) !== expected.sourceByteLength ||
    sourceArtifact?.mediaType !== 'application/pdf' ||
    documentType?.value !== profile.documentType ||
    documentCode !== expected.documentCode ||
    !['complete', 'partial'].includes(String(result?.status))
  ) {
    throw new Error('PDF_PRODUCER_PACKAGE_SOURCE_BINDING_MISMATCH');
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

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}
