import { Injectable } from '@nestjs/common';

import type { CanonicalFailureValidationWriteReceipt } from '@shared/api.interface';
import type {
  U0Frozen2FailureAdapterInput,
  U0Frozen2FailureBuildResult,
} from '../unified-reader/unified-reader.types';
import {
  canonicalJson,
  sha256Raw,
  sha256Text,
} from '../unified-reader/unified-reader.utils';
import type { CanonicalFailureValidationWriteAuthorizationPort } from './canonical-host.types';

/**
 * Reuses the existing failure-write receipt shape after the host has already
 * authenticated and authorized PARSE_PDF. It is server-owned and cannot be
 * supplied by a browser or Aily request.
 */
@Injectable()
export class OrdinaryFailureValidationWriteAuthorizationAdapter
  implements CanonicalFailureValidationWriteAuthorizationPort
{
  async authorize(input: {
    source: U0Frozen2FailureAdapterInput;
    built: U0Frozen2FailureBuildResult;
  }): Promise<CanonicalFailureValidationWriteReceipt> {
    const reportBytesSha256 = sha256Raw(input.built.reportBytes);
    const fingerprint = sha256Text(
      canonicalJson({
        namespace: 'ordinary-authenticated-failure-write-v1',
        workItemId: input.source.correlation.workItemId,
        requestId: input.source.correlation.requestId,
        documentVersionId: input.source.correlation.documentVersionId,
        permissionSnapshotVersion:
          input.source.correlation.permissionSnapshotVersion,
        failureId: input.built.report.failureId,
        reportBytesSha256,
        reportByteLength: input.built.reportBytes.byteLength,
      }),
    );
    const receiptHash = sha256Text(
      canonicalJson({
        namespace: 'failure-validation-write-receipt-v1',
        fingerprint,
        scope: 'PERSIST_U0_FROZEN2_FAILURE_AND_CAS_WORKITEM',
      }),
    );
    return {
      schemaVersion:
        'wiselink.3_1.failure_validation_write_receipt.v0.candidate.1',
      status: 'AUTHORIZED',
      receiptId: `failure-write-${receiptHash.slice(7, 39)}`,
      receiptHash,
      port:
        'wiselink.3_1.port.failure_validation_write_authorization.v0.candidate.1',
      revision: 'candidate.1',
      fingerprint,
      scope: 'PERSIST_U0_FROZEN2_FAILURE_AND_CAS_WORKITEM',
      workItemId: input.source.correlation.workItemId,
      requestId: input.source.correlation.requestId,
      documentVersionId: input.source.correlation.documentVersionId,
      failureId: input.built.report.failureId,
      reportBytesSha256,
      reportByteLength: input.built.reportBytes.byteLength,
      authority: {
        failureArtifactPersistAuthorized: true,
        failureWorkItemCasAuthorized: true,
        packageArtifactPersistAuthorized: false,
        publicationAuthorized: false,
        currentSwitchAuthorized: false,
      },
    };
  }
}
