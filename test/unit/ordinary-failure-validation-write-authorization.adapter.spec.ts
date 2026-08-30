import { resolve } from 'node:path';

import { OrdinaryFailureValidationWriteAuthorizationAdapter } from '../../server/modules/canonical-host/ordinary-failure-validation-write-authorization.adapter';
import { PythonU0FullPackageValidatorAdapter } from '../../server/modules/unified-reader/python-u0-full-package-validator.adapter';
import { U0Frozen2FailureAdapterService } from '../../server/modules/unified-reader/u0-frozen2-failure-adapter.service';
import { U0FullValidationService } from '../../server/modules/unified-reader/u0-full-validation.service';
import type { U0Frozen2FailureAdapterInput } from '../../server/modules/unified-reader/unified-reader.types';
import { sha256Raw } from '../../server/modules/unified-reader/unified-reader.utils';

describe('OrdinaryFailureValidationWriteAuthorizationAdapter', () => {
  it('binds the existing receipt to the authenticated WorkItem failure bytes', async () => {
    const source: U0Frozen2FailureAdapterInput = {
      schemaVersion:
        'wiselink.3_1.u0_frozen2_failure_adapter_input.v0.candidate.1',
      observedAt: '2026-08-14T06:00:00.000Z',
      cause: {
        code: 'PDF_PRODUCER_PROFILE_NOT_AVAILABLE',
        errorClass: 'Error',
      },
      source: {
        sourceKind: 'pdf',
        sourceArtifactId: 'source-artifact-1',
        inputRef: 'source-artifact-1',
        inputHash: `sha256:${'1'.repeat(64)}`,
      },
      correlation: {
        workItemId: 'WI-ordinary-failure',
        requestId: 'REQ-ordinary-failure',
        documentId: 'DOC-ordinary-failure',
        documentVersionId: 'REV-ordinary-failure',
        permissionSnapshotVersion: 'permission-snapshot:test',
        classificationFingerprint: `sha256:${'2'.repeat(64)}`,
      },
      packageAttempt: null,
      producer: {
        producerId: 'CanonicalPdfProducer',
        producerRevision: 'parser-profile:test',
        producerBuildHash: `sha256:${'3'.repeat(64)}`,
        executionRoute: 'ordinary-test',
      },
    };
    const unified = new U0Frozen2FailureAdapterService({} as never);
    const built = unified.build(source);
    const adapter = new OrdinaryFailureValidationWriteAuthorizationAdapter();

    const first = await adapter.authorize({ source, built });
    const second = await adapter.authorize({ source, built });

    expect(second).toEqual(first);
    expect(first.workItemId).toBe(source.correlation.workItemId);
    expect(first.documentVersionId).toBe(
      source.correlation.documentVersionId,
    );
    expect(first.failureId).toBe(built.report.failureId);
    expect(first.authority.failureArtifactPersistAuthorized).toBe(true);
    expect(first.authority.packageArtifactPersistAuthorized).toBe(false);
    expect(first.authority.publicationAuthorized).toBe(false);
  });

  it('keeps page-level OCR-needed diagnostics in the frozen failure report', async () => {
    const source: U0Frozen2FailureAdapterInput = {
      schemaVersion:
        'wiselink.3_1.u0_frozen2_failure_adapter_input.v0.candidate.1',
      observedAt: '2026-08-30T06:00:00.000Z',
      cause: {
        code: 'PDF_OCR_REQUIRED_UNSUPPORTED',
        errorClass: 'ProfessionalInputPureError',
        parameters: {
          diagnosticKind: 'PDF_PAGE_TEXT_LAYER_COVERAGE',
          ocrRequirementKind: 'TEXT_LAYER_EMPTY',
          textLayerStatus: 'PARTIAL',
          visualTextStatus: 'NOT_DETECTED',
          pageCount: 97,
          ocrRequiredPages: [
            '26',
            '27',
            '29',
            '30',
            '31',
            '32',
            '33',
            '34',
            '35',
            '36',
            '37',
            '48',
            '49',
          ],
          ocrRequiredPageRanges: '26-27,29-37,48-49',
          ocrRequiredPageCount: 13,
          emptyTextLayerPages: [
            '26',
            '27',
            '29',
            '30',
            '31',
            '32',
            '33',
            '34',
            '35',
            '36',
            '37',
            '48',
            '49',
          ],
          emptyTextLayerPageRanges: '26-27,29-37,48-49',
          emptyTextLayerPageCount: 13,
          visualTextUnverifiedPages: [],
          visualTextUnverifiedPageRanges: 'none',
          visualTextUnverifiedPageCount: 0,
          visualTextUnverifiedPageDetails: [],
          materialUnverifiedRasterPagePercent: 25,
          ocrProviderStatus: 'UNAVAILABLE_CURRENT_PRODUCTION',
          requiredProvider: 'HOST_BUNDLED_PAGE_OCR_LAYOUT_PROVIDER',
        },
      },
      source: {
        sourceKind: 'pdf',
        sourceArtifactId: 'source-artifact-mixed-pdf',
        inputRef: 'source-artifact-mixed-pdf',
        inputHash: `sha256:${'4'.repeat(64)}`,
      },
      correlation: {
        workItemId: 'WI-ocr-needed',
        requestId: 'REQ-ocr-needed',
        documentId: 'DOC-ocr-needed',
        documentVersionId: 'REV-ocr-needed',
        permissionSnapshotVersion: 'permission-snapshot:ocr-needed',
        classificationFingerprint: `sha256:${'5'.repeat(64)}`,
      },
      packageAttempt: null,
      producer: {
        producerId: 'CanonicalPdfProducer',
        producerRevision: 'parser-profile:test',
        producerBuildHash: `sha256:${'6'.repeat(64)}`,
        executionRoute:
          'file_service_source->host_native_pdf_layout_provider->ocr_provider_unavailable',
      },
    };

    const built = new U0Frozen2FailureAdapterService({} as never).build(source);

    expect(built.report).toMatchObject({
      stage: 'parse',
      code: 'PDF_OCR_REQUIRED_UNSUPPORTED',
      blocking: true,
      packageProduced: false,
      parameters: {
        textLayerStatus: 'PARTIAL',
        pageCount: 97,
        ocrRequiredPageRanges: '26-27,29-37,48-49',
        emptyTextLayerPageRanges: '26-27,29-37,48-49',
        emptyTextLayerPageCount: 13,
      },
    });
    expect(built.report.message).toContain(
      'PDF pages 26-27,29-37,48-49 of 97 require OCR',
    );
    expect(built.taxonomy).toMatchObject({
      stableErrorCode: 'PDF_OCR_REQUIRED_UNSUPPORTED',
      projectStage: 'PARSE_SOURCE',
      retryClass: 'NOT_SAFE_WITHOUT_OWNER_ACTION',
    });

    const validator = new U0FullValidationService(
      new PythonU0FullPackageValidatorAdapter({
        pythonExecutable: process.env.WL31_U0_PYTHON?.trim() || 'python3',
        contractRoot: resolve(
          process.cwd(),
          'server/runtime-assets/technical-publication-parsed-package/v1-frozen-2',
        ),
        contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
        validatorRevision: 'pdf-ocr-required-failure-report-test',
      }),
    );
    await expect(
      validator.validateFailureReport({
        artifact: {
          storeRole: 'UnifiedArtifactStoreCandidate',
          ref: 'artifact://UnifiedArtifactStoreCandidate/failure-report-test',
          sha256: sha256Raw(built.reportBytes),
          byteLength: built.reportBytes.byteLength,
          mediaType: 'application/json',
        },
        bytes: built.reportBytes,
        failureId: built.report.failureId,
      }),
    ).resolves.toMatchObject({
      status: 'FULL_STRICT_FAILURE_REPORT_VALIDATOR_PASSED',
      failureId: built.report.failureId,
    });
  });
});
