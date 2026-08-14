import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import {
  AEO_VALIDATION_WRITE_RECEIPT_VERSION,
  WISELINK_3_1_AEO_VALIDATION_PURPOSE,
  type AeoArtifactActionRequest,
  type AeoValidationWriteAuthorizationVerification,
  type AeoValidationWriteReceipt,
} from '../../../shared/aeo-integration';

import {
  canonicalStringify,
  isRecord,
  projectionError,
  requireExactKeys,
  requireNonEmptyString,
  requirePrefixedSha256,
  requirePositiveInteger,
  requireSha256,
  sha256Prefixed,
} from './aeo-editor-projection.utils';
import { AeoHostedPlatformReadinessService } from './aeo-hosted-platform.service';

export const AEO_VALIDATION_WRITE_AUTHORITY_PORT = Symbol(
  'AEO_VALIDATION_WRITE_AUTHORITY_PORT',
);

export interface AeoValidationWriteReceiptReadRequest {
  purpose: typeof WISELINK_3_1_AEO_VALIDATION_PURPOSE;
  workItemId: string;
  requestId: string;
  runId: string;
  actorRef: string;
  permissionSnapshotVersion: string;
  action: AeoArtifactActionRequest['action'];
  expectedStateVersion: number;
  actionInputHash: string;
  activationManifestCanonicalSha256: string;
}

export interface AeoValidationWriteAuthorityPort {
  readReceiptActualBytes(
    request: AeoValidationWriteReceiptReadRequest,
  ): Promise<{
    artifactRef: string;
    artifactSha256: string;
    bytes: Uint8Array;
  }>;
}

export class UnconfiguredAeoValidationWriteAuthorityPort implements AeoValidationWriteAuthorityPort {
  async readReceiptActualBytes(): Promise<never> {
    projectionError(
      'AEO_VALIDATION_WRITE_AUTHORITY_UNAVAILABLE',
      'WiseLink 3.1 主控尚未注入独立 validation-write receipt actual-byte port。',
    );
  }
}

@Injectable()
export class AeoValidationWriteAuthorizationService {
  constructor(
    private readonly readiness: AeoHostedPlatformReadinessService,
    @Inject(AEO_VALIDATION_WRITE_AUTHORITY_PORT)
    private readonly authority: AeoValidationWriteAuthorityPort,
  ) {}

  async verify(
    request: AeoArtifactActionRequest,
  ): Promise<AeoValidationWriteAuthorizationVerification> {
    // Platform activation proves only that the host may be read. It is
    // intentionally re-read for every action and never grants artifact writes.
    const readiness = await this.readiness.read();
    const activationManifestCanonicalSha256 =
      readiness.activationAuthority?.activationManifestCanonicalSha256;
    if (readiness.status !== 'READY' || !activationManifestCanonicalSha256) {
      projectionError(
        'AEO_VALIDATION_WRITE_AUTHORITY_UNAVAILABLE',
        'host activation 未 READY；activation-only 不能执行任何 artifact action。',
      );
    }

    const readRequest: AeoValidationWriteReceiptReadRequest = {
      purpose: WISELINK_3_1_AEO_VALIDATION_PURPOSE,
      workItemId: request.workItemId,
      requestId: request.requestId,
      runId: request.runId,
      actorRef: request.requesterRef,
      permissionSnapshotVersion: request.permissionSnapshotVersion,
      action: request.action,
      expectedStateVersion: request.expectedStateVersion,
      actionInputHash: hashAeoArtifactActionInput(request),
      activationManifestCanonicalSha256,
    };

    let actual: Awaited<
      ReturnType<AeoValidationWriteAuthorityPort['readReceiptActualBytes']>
    >;
    try {
      // This independent port is invoked afresh for every action. No receipt is
      // cached or accepted from the HTTP body or the WorkItem projection.
      actual = await this.authority.readReceiptActualBytes(readRequest);
    } catch (error) {
      const code = readCode(error);
      projectionError(
        code.startsWith('AEO_VALIDATION_WRITE_')
          ? code
          : 'AEO_VALIDATION_WRITE_AUTHORITY_UNAVAILABLE',
        `${code}: validation-write receipt actual bytes 不可用。`,
      );
    }
    const receiptArtifactRef = requireNonEmptyString(
      actual.artifactRef,
      'AEO_VALIDATION_WRITE_RECEIPT_INVALID',
      'receiptArtifactRef',
    );
    const receiptArtifactSha256 = requireSha256(
      actual.artifactSha256,
      'AEO_VALIDATION_WRITE_RECEIPT_INVALID',
      'receiptArtifactSha256',
    );
    if (sha256Bytes(actual.bytes) !== receiptArtifactSha256) {
      projectionError(
        'AEO_VALIDATION_WRITE_RECEIPT_HASH_MISMATCH',
        'validation-write receipt actual-byte hash 不匹配。',
      );
    }
    const receipt = normalizeValidationWriteReceipt(actual.bytes);
    if (receipt.receiptArtifactRef !== receiptArtifactRef) {
      projectionError(
        'AEO_VALIDATION_WRITE_RECEIPT_BINDING_MISMATCH',
        'validation-write receipt locator 与 actual-byte port 不一致。',
      );
    }
    const canonicalSha256 = hashAeoValidationWriteReceipt(receipt);
    if (canonicalSha256 !== receipt.receiptCanonicalSha256) {
      projectionError(
        'AEO_VALIDATION_WRITE_RECEIPT_CANONICAL_HASH_MISMATCH',
        'validation-write receipt canonical hash 不匹配。',
      );
    }
    if (!matchesReadRequest(receipt, readRequest)) {
      projectionError(
        'AEO_VALIDATION_WRITE_RECEIPT_BINDING_MISMATCH',
        'validation-write receipt 未绑定 exact activation/WorkItem/input/Decision/actor/action。',
      );
    }
    return {
      receiptId: receipt.receiptId,
      receiptArtifactRef,
      receiptArtifactSha256,
      receiptCanonicalSha256: canonicalSha256,
      activationManifestCanonicalSha256,
      purpose: WISELINK_3_1_AEO_VALIDATION_PURPOSE,
      workItemId: receipt.workItemId,
      requestId: receipt.requestId,
      runId: receipt.runId,
      actorRef: receipt.actorRef,
      permissionSnapshotVersion: receipt.permissionSnapshotVersion,
      action: receipt.action,
      expectedStateVersion: receipt.expectedStateVersion,
      actionInputHash: receipt.actionInputHash,
      issuedBy: 'WiseLink3_1Master',
      authorizedByDecisionId: receipt.authorizedByDecisionId,
      issuedAt: receipt.issuedAt,
      expiresAt: receipt.expiresAt,
      verified: true,
    };
  }
}

export function hashAeoArtifactActionInput(
  request: AeoArtifactActionRequest,
): string {
  return sha256Prefixed(canonicalStringify(request));
}

export function hashAeoValidationWriteReceipt(
  receipt: AeoValidationWriteReceipt,
): string {
  const { receiptCanonicalSha256: _ignored, ...projection } = receipt;
  return sha256Prefixed(canonicalStringify(projection));
}

function normalizeValidationWriteReceipt(
  bytes: Uint8Array,
): AeoValidationWriteReceipt {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    projectionError(
      'AEO_VALIDATION_WRITE_RECEIPT_INVALID',
      'validation-write receipt 不是 JSON。',
    );
  }
  if (!isRecord(value)) {
    projectionError(
      'AEO_VALIDATION_WRITE_RECEIPT_INVALID',
      'validation-write receipt 必须是对象。',
    );
  }
  requireExactKeys(
    value,
    [
      'schemaVersion',
      'receiptId',
      'receiptArtifactRef',
      'receiptCanonicalSha256',
      'activationManifestCanonicalSha256',
      'purpose',
      'workItemId',
      'requestId',
      'runId',
      'actorRef',
      'permissionSnapshotVersion',
      'action',
      'expectedStateVersion',
      'actionInputHash',
      'issuedBy',
      'authorizedByDecisionId',
      'issuedAt',
      'expiresAt',
      'authority',
    ],
    'AEO_VALIDATION_WRITE_RECEIPT_INVALID',
    'validation-write receipt',
  );
  if (
    value.schemaVersion !== AEO_VALIDATION_WRITE_RECEIPT_VERSION ||
    value.purpose !== WISELINK_3_1_AEO_VALIDATION_PURPOSE ||
    value.issuedBy !== 'WiseLink3_1Master' ||
    value.authority !==
      'VALIDATION_WRITE_ONLY_NOT_APPROVAL_NOT_RELEASE_NOT_DELIVERY' ||
    !isArtifactAction(value.action)
  ) {
    projectionError(
      'AEO_VALIDATION_WRITE_RECEIPT_INVALID',
      'validation-write receipt authority、purpose、action 或版本无效。',
    );
  }
  const issuedAt = requireNonEmptyString(
    value.issuedAt,
    'AEO_VALIDATION_WRITE_RECEIPT_INVALID',
    'issuedAt',
  );
  const expiresAt = requireNonEmptyString(
    value.expiresAt,
    'AEO_VALIDATION_WRITE_RECEIPT_INVALID',
    'expiresAt',
  );
  const issuedAtTime = Date.parse(issuedAt);
  const expiresAtTime = Date.parse(expiresAt);
  if (
    Number.isNaN(issuedAtTime) ||
    Number.isNaN(expiresAtTime) ||
    issuedAtTime >= expiresAtTime ||
    issuedAtTime > Date.now()
  ) {
    projectionError(
      'AEO_VALIDATION_WRITE_RECEIPT_INVALID',
      'validation-write receipt 时间窗无效。',
    );
  }
  if (expiresAtTime <= Date.now()) {
    projectionError(
      'AEO_VALIDATION_WRITE_RECEIPT_EXPIRED',
      'validation-write receipt 已过期。',
    );
  }
  const actionInputHash = requireNonEmptyString(
    value.actionInputHash,
    'AEO_VALIDATION_WRITE_RECEIPT_INVALID',
    'actionInputHash',
  );
  if (!/^sha256:[a-f0-9]{64}$/u.test(actionInputHash)) {
    projectionError(
      'AEO_VALIDATION_WRITE_RECEIPT_INVALID',
      'actionInputHash 必须使用 sha256: 前缀 wire format。',
    );
  }
  return {
    schemaVersion: AEO_VALIDATION_WRITE_RECEIPT_VERSION,
    receiptId: text(value.receiptId, 'receiptId'),
    receiptArtifactRef: text(value.receiptArtifactRef, 'receiptArtifactRef'),
    receiptCanonicalSha256: requirePrefixedSha256(
      value.receiptCanonicalSha256,
      'AEO_VALIDATION_WRITE_RECEIPT_INVALID',
      'receiptCanonicalSha256',
    ),
    activationManifestCanonicalSha256: requirePrefixedSha256(
      value.activationManifestCanonicalSha256,
      'AEO_VALIDATION_WRITE_RECEIPT_INVALID',
      'activationManifestCanonicalSha256',
    ),
    purpose: WISELINK_3_1_AEO_VALIDATION_PURPOSE,
    workItemId: text(value.workItemId, 'workItemId'),
    requestId: text(value.requestId, 'requestId'),
    runId: text(value.runId, 'runId'),
    actorRef: text(value.actorRef, 'actorRef'),
    permissionSnapshotVersion: text(
      value.permissionSnapshotVersion,
      'permissionSnapshotVersion',
    ),
    action: value.action,
    expectedStateVersion: requirePositiveInteger(
      value.expectedStateVersion,
      'AEO_VALIDATION_WRITE_RECEIPT_INVALID',
      'expectedStateVersion',
    ),
    actionInputHash,
    issuedBy: 'WiseLink3_1Master',
    authorizedByDecisionId: text(
      value.authorizedByDecisionId,
      'authorizedByDecisionId',
    ),
    issuedAt,
    expiresAt,
    authority: 'VALIDATION_WRITE_ONLY_NOT_APPROVAL_NOT_RELEASE_NOT_DELIVERY',
  };
}

function matchesReadRequest(
  receipt: AeoValidationWriteReceipt,
  request: AeoValidationWriteReceiptReadRequest,
): boolean {
  return (
    receipt.activationManifestCanonicalSha256 ===
      request.activationManifestCanonicalSha256 &&
    receipt.purpose === request.purpose &&
    receipt.workItemId === request.workItemId &&
    receipt.requestId === request.requestId &&
    receipt.runId === request.runId &&
    receipt.actorRef === request.actorRef &&
    receipt.permissionSnapshotVersion === request.permissionSnapshotVersion &&
    receipt.action === request.action &&
    receipt.expectedStateVersion === request.expectedStateVersion &&
    receipt.actionInputHash === request.actionInputHash &&
    receipt.authorizedByDecisionId.length > 0
  );
}

function isArtifactAction(
  value: unknown,
): value is AeoArtifactActionRequest['action'] {
  return (
    value === 'BOOTSTRAP_FROM_PARSED_PACKAGE' ||
    value === 'PERSIST_WORKING_COPY' ||
    value === 'FREEZE_DRAFT_PACKAGE' ||
    value === 'EXPORT_WORD_CANDIDATE'
  );
}

function text(value: unknown, label: string): string {
  return requireNonEmptyString(
    value,
    'AEO_VALIDATION_WRITE_RECEIPT_INVALID',
    label,
  );
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function readCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : error instanceof Error
      ? error.message
      : 'UNKNOWN_ERROR';
}
