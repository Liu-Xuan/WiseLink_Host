import { resolve } from 'node:path';

import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import { CanonicalFailureRecordingService } from '../../server/modules/canonical-host/canonical-failure-recording.service';
import { OrdinaryFailureValidationWriteAuthorizationAdapter } from '../../server/modules/canonical-host/ordinary-failure-validation-write-authorization.adapter';
import { PythonU0FullPackageValidatorAdapter } from '../../server/modules/unified-reader/python-u0-full-package-validator.adapter';
import { U0Frozen2FailureAdapterService } from '../../server/modules/unified-reader/u0-frozen2-failure-adapter.service';
import { U0FullValidationService } from '../../server/modules/unified-reader/u0-full-validation.service';
import { sha256Raw } from '../../server/modules/unified-reader/unified-reader.utils';

export function readerPreviewFullValidator(): U0FullValidationService {
  return new U0FullValidationService(new PythonU0FullPackageValidatorAdapter({
    pythonExecutable: process.env.WL31_U0_PYTHON?.trim() || 'python3',
    contractRoot: resolve(process.cwd(), 'server/runtime-assets/technical-publication-parsed-package/v1-frozen-2'),
    contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
    validatorRevision: 'optional-preview-local-real-frozen2-validator',
  }));
}

/** Synthetic binding; failure bytes are checked by the actual frozen.2 Python validator. */
export async function readerPreviewFailureProjection(
  override: Partial<CanonicalWorkItemProjection> = {},
): Promise<CanonicalWorkItemProjection> {
  const snapshot = `sha256:${'0'.repeat(64)}`;
  const projection: CanonicalWorkItemProjection = {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-RETRY-1', requestId: 'REQ-RETRY-1', revision: 3, phase: 'FAILED',
    permissionSnapshotVersion: snapshot,
    parseAuthorization: {
      action: 'PARSE_PDF', actorFingerprint: `sha256:${'9'.repeat(64)}`,
      decisionId: 'decision-original-development-run', decisionHash: `sha256:${'8'.repeat(64)}`,
      permissionSnapshotVersion: snapshot,
    },
    source: {
      documentId: 'document-retry', documentVersionId: 'document-version-retry',
      parserRequestId: 'REQ-RETRY-1', sourceArtifactId: 'artifact-retry',
      sourceFileSha256: `sha256:${'a'.repeat(64)}`, sourceByteLength: 25556,
      driveFileToken: 'drive-source-retry', driveSourceVersion: 'drive-version-retry',
    },
    classification: {
      status: 'CANDIDATE', normalizedFamily: 'FTD',
      classifierReleaseId: 'classifier-release:test', classifierReleaseHash: `sha256:${'b'.repeat(64)}`,
      parserProfileId: 'parser-profile:test', parserProfileHash: `sha256:${'c'.repeat(64)}`,
      fingerprint: `sha256:${'d'.repeat(64)}`,
    },
    package: null, failure: null, recordingFailure: null, ...override,
  };
  const values = new Map<string, Uint8Array>();
  const store = {
    persistAndReadback: async (bytes: Uint8Array) => {
      const hash = sha256Raw(bytes);
      const artifact = {
        storeRole: 'UnifiedArtifactStoreCandidate' as const,
        ref: `artifact://UnifiedArtifactStoreCandidate/unified-parsed-packages/sha256/${hash}`,
        sha256: hash, byteLength: bytes.byteLength, mediaType: 'application/json' as const,
      };
      values.set(artifact.ref, Uint8Array.from(bytes));
      return { artifact, bytes: Uint8Array.from(bytes), reused: false };
    },
    readActualBytes: async (artifact: { ref: string }) => {
      const bytes = values.get(artifact.ref);
      if (!bytes) throw new Error('SOURCE_ARTIFACT_NOT_FOUND');
      return Uint8Array.from(bytes);
    },
  };
  const recording = new CanonicalFailureRecordingService(
    new U0Frozen2FailureAdapterService(readerPreviewFullValidator()),
    new OrdinaryFailureValidationWriteAuthorizationAdapter(), store,
    { nowIso: () => '2026-08-26T00:00:00.000Z' },
  );
  const failure = await recording.record({
    request: {
      schemaVersion: 'wiselink.3_1.canonical_pdf_vertical_request.v0.candidate',
      workItemId: projection.workItemId, requestId: projection.requestId,
      source: projection.source, classification: projection.classification, query: 'applicability',
    },
    permissionSnapshotVersion: projection.permissionSnapshotVersion,
    error: new Error('READER_QUERY_NO_RESULTS'), executionRoute: 'synthetic-reader-preview-recovery-test',
    packageAttempt: {
      packageId: `urn:techpub:package:v1:sha256:${'1'.repeat(64)}`,
      contractId: 'techpub.parsed-package.v1', contractRevision: 'frozen.2',
    },
  });
  return { ...projection, failure: {
    failureCode: failure.receipt.taxonomy.stableErrorCode, message: failure.report.message,
    artifact: failure.persisted.artifact, adapterReceipt: failure.receipt,
    validationWriteReceipt: failure.writeReceipt,
  } };
}
