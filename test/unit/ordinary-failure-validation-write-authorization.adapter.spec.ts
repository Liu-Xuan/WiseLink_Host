import { OrdinaryFailureValidationWriteAuthorizationAdapter } from '../../server/modules/canonical-host/ordinary-failure-validation-write-authorization.adapter';
import { U0Frozen2FailureAdapterService } from '../../server/modules/unified-reader/u0-frozen2-failure-adapter.service';
import type { U0Frozen2FailureAdapterInput } from '../../server/modules/unified-reader/unified-reader.types';

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
});
