import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import {
  actionAttempt,
  dmAcquisition,
  dmCurrentnessDecision,
  dmDocument,
  dmDocumentVersion,
  dmIngressPreflight,
  dmPublicationFamily,
  dmSourceArtifact,
  reviewConversation,
  workItem,
} from '@server/database/schema';

const REVIEW_ATTACHMENT_SOURCE_CHANNEL =
  'canonical_review_attachment_selection';
const LEGACY_REVIEW_ATTACHMENT_DECISION =
  'DOCUMENT_IDENTITY_UNRESOLVED';

function fail(code: string, message: string, details: Record<string, unknown> = {}) {
  throw Object.assign(new Error(message), { code, details });
}

function asDate(value: string | Date) {
  return value instanceof Date ? value : new Date(value);
}

function parseJson(value: string) {
  return JSON.parse(value);
}

const COMPLETE_ACQUISITION_STATUSES = new Set([
  'COMMITTED_CANONICAL',
  'LINKED_EXACT_DOCUMENT_VERSION',
]);

type ImmutableSourceReuseInput = {
  sourceArtifactId: string;
  acquisitionId: string;
  idempotencyKey: string;
  sha256: string;
  byteLength: number;
  mediaType: string;
  bucketId: string;
  filePath: string;
  providerObjectId: string;
  providerVersionId: string;
  serverBoundReviewAttachmentScope?: {
    sourceChannel: string;
    reviewConversationId: string;
    requestRef: string;
    actorUserId: string;
    tenantId: string;
    workItemId: string;
    expectedRevision: number;
  };
};

type ImmutableSourceReuseState = {
  artifacts: Array<typeof dmSourceArtifact.$inferSelect>;
  acquisitions: Array<typeof dmAcquisition.$inferSelect>;
  preflights: Array<typeof dmIngressPreflight.$inferSelect>;
  versions: Array<typeof dmDocumentVersion.$inferSelect>;
};

type DownstreamWorkItemLineage = Pick<
  typeof workItem.$inferSelect,
  'workItemId' | 'sourceArtifactId' | 'documentId' | 'documentVersionId'
>;

type ReviewAttachmentResidualReuseState = ImmutableSourceReuseState & {
  currentness: Array<typeof dmCurrentnessDecision.$inferSelect>;
  downstreamWorkItems: DownstreamWorkItemLineage[];
  actionAttempts: Array<Pick<
    typeof actionAttempt.$inferSelect,
    'attemptId' | 'workItemId' | 'documentVersionId'
  >>;
  scopeConversations: Array<typeof reviewConversation.$inferSelect>;
  scopeWorkItems: Array<typeof workItem.$inferSelect>;
};

type IncompleteIngestionRecoveryInput = {
  sourceArtifact: ImmutableSourceReuseInput;
  acquisition: {
    acquisitionId: string;
    sourceArtifactId: string;
    sourceChannel: string;
    sourceRef: string;
    selectionBucketId: string;
    selectionFilePath: string;
    providerObjectId: string;
    providerVersionId: string;
    acquiredBy: string;
    idempotencyKey: string;
    sourceDescriptor: Record<string, unknown>;
  };
  preflight: {
    preflightId: string;
    acquisitionId: string;
    decision: string;
    branch: string;
    observedCurrentGeneration: number;
    observedCurrentDocumentVersionId: string | null;
    normalizedDescriptor: Record<string, unknown>;
    decisionPayload: Record<string, unknown>;
  };
  downstream: {
    familyId: string;
    canonicalIdentityKey: string;
    documentId: string;
    documentVersionId: string;
  };
};

type IncompleteIngestionRecoveryState = {
  artifacts: Array<typeof dmSourceArtifact.$inferSelect>;
  acquisitions: Array<typeof dmAcquisition.$inferSelect>;
  preflights: Array<typeof dmIngressPreflight.$inferSelect>;
  families: Array<typeof dmPublicationFamily.$inferSelect>;
  documents: Array<typeof dmDocument.$inferSelect>;
  versions: Array<typeof dmDocumentVersion.$inferSelect>;
  currentness: Array<typeof dmCurrentnessDecision.$inferSelect>;
  workItems: unknown[];
  actionAttempts: unknown[];
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function recordJson(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = parseJson(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function recordValue(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const selected: unknown = value[key];
  return selected && typeof selected === 'object' && !Array.isArray(selected)
    ? selected as Record<string, unknown>
    : {};
}

function reviewConversationIdFromSourceRef(value: string): string {
  const prefix = 'ATTACHMENT:';
  const refBody: string = value.startsWith(prefix)
    ? value.slice(prefix.length)
    : '';
  const separatorIndex: number = refBody.indexOf(':');
  return separatorIndex > 0 ? refBody.slice(0, separatorIndex).trim() : '';
}

function reviewRequestRefFromSourceRef(value: string): string {
  const prefix = 'ATTACHMENT:';
  const refBody: string = value.startsWith(prefix)
    ? value.slice(prefix.length)
    : '';
  const separatorIndex: number = refBody.indexOf(':');
  return separatorIndex > 0 ? refBody.slice(separatorIndex + 1).trim() : '';
}

function assertExactImmutableSource(
  input: ImmutableSourceReuseInput,
  artifacts: Array<typeof dmSourceArtifact.$inferSelect>,
): typeof dmSourceArtifact.$inferSelect {
  if (artifacts.length !== 1) {
    fail(
      'IMMUTABLE_SOURCE_REUSE_DB_PARTIAL',
      'Existing immutable bytes do not have one exact Catalog source identity.',
    );
  }
  const artifact = artifacts[0];
  if (
    artifact.sourceArtifactId !== input.sourceArtifactId
    || artifact.sha256 !== input.sha256
    || Number(artifact.byteLength) !== Number(input.byteLength)
    || artifact.mediaType !== input.mediaType
    || artifact.bucketId !== input.bucketId
    || artifact.filePath !== input.filePath
    || artifact.providerObjectId !== input.providerObjectId
    || artifact.providerVersionId !== input.providerVersionId
    || artifact.readbackVerified !== true
  ) {
    fail(
      'IMMUTABLE_SOURCE_REUSE_DB_CONFLICT',
      'Existing Catalog source identity differs from the verified immutable object.',
    );
  }
  return artifact;
}

function assertCompletedOrdinaryDownstreamLineage(
  input: ImmutableSourceReuseInput,
  completedVersions: Array<typeof dmDocumentVersion.$inferSelect>,
  downstreamWorkItems: DownstreamWorkItemLineage[],
  actionAttempts: ReviewAttachmentResidualReuseState['actionAttempts'],
): void {
  const completedVersionById: Map<
    string,
    typeof dmDocumentVersion.$inferSelect
  > = new Map(completedVersions.map((row) => [row.documentVersionId, row]));
  const workItemVersionById: Map<string, string> = new Map();
  const hasUnprovenWorkItem: boolean = downstreamWorkItems.some((row) => {
    const version: typeof dmDocumentVersion.$inferSelect | undefined =
      completedVersionById.get(row.documentVersionId);
    if (
      row.sourceArtifactId !== input.sourceArtifactId
      || !version
      || version.sourceArtifactId !== input.sourceArtifactId
      || row.documentId !== version.documentId
    ) {
      return true;
    }
    workItemVersionById.set(row.workItemId, row.documentVersionId);
    return false;
  });
  const hasUnprovenActionAttempt: boolean = actionAttempts.some((row) => {
    const documentVersionId: string | undefined = workItemVersionById.get(
      row.workItemId,
    );
    return !documentVersionId || Boolean(
      row.documentVersionId
      && row.documentVersionId !== documentVersionId,
    );
  });
  if (hasUnprovenWorkItem || hasUnprovenActionAttempt) {
    fail(
      'REVIEW_ATTACHMENT_RESIDUAL_DOWNSTREAM_PRESENT',
      'Residual recovery is forbidden when downstream WorkItem or ActionAttempt bindings cannot be proven to belong to complete ordinary Catalog lineage.',
    );
  }
}

function withoutGeneratedAt(value: Record<string, unknown>) {
  const { generatedAt: _generatedAt, ...semantic } = value;
  return semantic;
}

export function classifyIncompleteIngestionRecoveryState(
  input: IncompleteIngestionRecoveryInput,
  state: IncompleteIngestionRecoveryState,
) {
  const downstreamCount = state.families.length
    + state.documents.length
    + state.versions.length
    + state.currentness.length
    + state.workItems.length
    + state.actionAttempts.length;
  if (
    state.artifacts.length !== 1
    || state.acquisitions.length !== 1
    || state.preflights.length !== 1
  ) {
    fail(
      'INCOMPLETE_INGESTION_RECOVERY_SHAPE_MISMATCH',
      'Recovery requires exactly one SourceArtifact, Acquisition, and READY ingress preflight.',
    );
  }
  if (downstreamCount !== 0) {
    fail(
      'INCOMPLETE_INGESTION_RECOVERY_DOWNSTREAM_PRESENT',
      'Recovery is forbidden after any related family, document, version, currentness, WorkItem, or ActionAttempt exists.',
    );
  }
  const artifact = state.artifacts[0];
  const expectedArtifact = input.sourceArtifact;
  if (
    artifact.sourceArtifactId !== expectedArtifact.sourceArtifactId
    || artifact.sha256 !== expectedArtifact.sha256
    || Number(artifact.byteLength) !== Number(expectedArtifact.byteLength)
    || artifact.mediaType !== expectedArtifact.mediaType
    || artifact.bucketId !== expectedArtifact.bucketId
    || artifact.filePath !== expectedArtifact.filePath
    || artifact.providerObjectId !== expectedArtifact.providerObjectId
    || artifact.providerVersionId !== expectedArtifact.providerVersionId
    || artifact.readbackVerified !== true
  ) {
    fail(
      'INCOMPLETE_INGESTION_RECOVERY_ARTIFACT_CONFLICT',
      'Residual SourceArtifact differs from the freshly verified immutable object.',
    );
  }
  const acquisition = state.acquisitions[0];
  const expectedAcquisition = input.acquisition;
  if (
    acquisition.acquisitionId !== expectedAcquisition.acquisitionId
    || acquisition.sourceArtifactId !== expectedAcquisition.sourceArtifactId
    || acquisition.sourceChannel !== expectedAcquisition.sourceChannel
    || acquisition.sourceRef !== expectedAcquisition.sourceRef
    || acquisition.selectionBucketId !== expectedAcquisition.selectionBucketId
    || acquisition.selectionFilePath !== expectedAcquisition.selectionFilePath
    || acquisition.providerObjectId !== expectedAcquisition.providerObjectId
    || acquisition.providerVersionId !== expectedAcquisition.providerVersionId
    || acquisition.acquiredBy !== expectedAcquisition.acquiredBy
    || acquisition.idempotencyKey !== expectedAcquisition.idempotencyKey
    || acquisition.status !== 'ACQUIRED_READBACK_VERIFIED'
    || acquisition.documentVersionId !== null
    || stableJson(parseJson(acquisition.sourceDescriptorJson))
      !== stableJson(expectedAcquisition.sourceDescriptor)
  ) {
    fail(
      'INCOMPLETE_INGESTION_RECOVERY_ACQUISITION_CONFLICT',
      'Residual Acquisition differs from the same actor, route, selection, or source metadata.',
    );
  }
  const preflight = state.preflights[0];
  const expectedPreflight = input.preflight;
  if (
    preflight.preflightId !== expectedPreflight.preflightId
    || preflight.acquisitionId !== expectedPreflight.acquisitionId
    || preflight.decision !== expectedPreflight.decision
    || preflight.branch !== expectedPreflight.branch
    || preflight.executionAuthorized !== false
    || preflight.observedCurrentGeneration !== expectedPreflight.observedCurrentGeneration
    || (preflight.observedCurrentDocumentVersionId || null)
      !== (expectedPreflight.observedCurrentDocumentVersionId || null)
    || preflight.status !== 'READY'
    || preflight.documentVersionId !== null
    || preflight.commitIdempotencyKey !== null
    || stableJson(parseJson(preflight.normalizedDescriptorJson))
      !== stableJson(expectedPreflight.normalizedDescriptor)
    || stableJson(withoutGeneratedAt(parseJson(preflight.decisionPayloadJson)))
      !== stableJson(withoutGeneratedAt(expectedPreflight.decisionPayload))
  ) {
    fail(
      'INCOMPLETE_INGESTION_RECOVERY_PREFLIGHT_CONFLICT',
      'Residual ingress preflight differs from the deterministic retry decision.',
    );
  }
  return {
    disposition: 'INCOMPLETE_INGESTION_RECOVERY_ALLOWED',
    acquisition,
    preflight,
  };
}

export function classifyImmutableSourceReuseState(
  input: ImmutableSourceReuseInput,
  state: ImmutableSourceReuseState,
) {
  const artifacts = state.artifacts ?? [];
  const acquisitions = state.acquisitions ?? [];
  const preflights = state.preflights ?? [];
  const versions = state.versions ?? [];
  if (
    artifacts.length === 0
    && acquisitions.length === 0
    && preflights.length === 0
    && versions.length === 0
  ) {
    return { disposition: 'ORPHAN_RECOVERY_ALLOWED' };
  }
  if (artifacts.length !== 1) {
    fail(
      'IMMUTABLE_SOURCE_REUSE_DB_PARTIAL',
      'Existing immutable bytes do not have one complete Catalog source identity.',
    );
  }
  const artifact = artifacts[0];
  if (
    artifact.sourceArtifactId !== input.sourceArtifactId
    || artifact.sha256 !== input.sha256
    || Number(artifact.byteLength) !== Number(input.byteLength)
    || artifact.mediaType !== input.mediaType
    || artifact.bucketId !== input.bucketId
    || artifact.filePath !== input.filePath
    || artifact.providerObjectId !== input.providerObjectId
    || artifact.providerVersionId !== input.providerVersionId
    || artifact.readbackVerified !== true
  ) {
    fail(
      'IMMUTABLE_SOURCE_REUSE_DB_CONFLICT',
      'Existing Catalog source identity differs from the verified immutable object.',
    );
  }
  const versionIds = new Set(versions.map((row) => row.documentVersionId));
  const completeAcquisitions = acquisitions.length > 0 && acquisitions.every((row) => (
    row.sourceArtifactId === input.sourceArtifactId
    && COMPLETE_ACQUISITION_STATUSES.has(row.status)
    && Boolean(row.documentVersionId)
    && versionIds.has(row.documentVersionId)
  ));
  const preflightByAcquisition = new Map(
    preflights.map((row) => [row.acquisitionId, row]),
  );
  const completePreflights = acquisitions.length > 0 && acquisitions.every((row) => {
    const preflight = preflightByAcquisition.get(row.acquisitionId);
    return preflight?.status === 'COMMITTED'
      && preflight.documentVersionId === row.documentVersionId;
  });
  const completeVersions = versions.length > 0 && versions.every((row) => (
    row.sourceArtifactId === input.sourceArtifactId
    && acquisitions.some((acquisition) => (
      acquisition.acquisitionId === row.acquisitionId
      && acquisition.documentVersionId === row.documentVersionId
    ))
  ));
  if (!completeAcquisitions || !completePreflights || !completeVersions) {
    fail(
      'IMMUTABLE_SOURCE_REUSE_DB_PARTIAL',
      'Existing immutable bytes are bound to incomplete Catalog state.',
    );
  }
  return { disposition: 'CATALOGED_SOURCE_REUSE_ALLOWED' };
}

export function classifyReviewAttachmentResidualReuseState(
  input: ImmutableSourceReuseInput,
  state: ReviewAttachmentResidualReuseState,
) {
  const scope = input.serverBoundReviewAttachmentScope;
  if (
    !scope
    || scope.sourceChannel !== REVIEW_ATTACHMENT_SOURCE_CHANNEL
    || !scope.reviewConversationId
    || !scope.requestRef
    || !scope.actorUserId
    || !scope.tenantId
    || !scope.workItemId
    || !Number.isSafeInteger(scope.expectedRevision)
    || scope.expectedRevision < 0
  ) {
    fail(
      'REVIEW_ATTACHMENT_RESIDUAL_SCOPE_INVALID',
      'Residual recovery requires one complete server-bound Review attachment scope.',
    );
  }
  const artifact = assertExactImmutableSource(input, state.artifacts ?? []);
  const acquisitions = state.acquisitions ?? [];
  const preflights = state.preflights ?? [];
  const residualAcquisitions = acquisitions.filter((row) => (
    row.sourceChannel === REVIEW_ATTACHMENT_SOURCE_CHANNEL
    && row.status === 'ACQUIRED_READBACK_VERIFIED'
    && row.documentVersionId === null
  ));
  if (residualAcquisitions.length !== 1) {
    fail(
      'REVIEW_ATTACHMENT_RESIDUAL_SHAPE_MISMATCH',
      'Residual recovery requires exactly one unlinked legacy Review Acquisition.',
    );
  }
  const acquisition = residualAcquisitions[0];
  const residualPreflights = preflights.filter(
    (row) => row.acquisitionId === acquisition.acquisitionId,
  );
  if (residualPreflights.length !== 1) {
    fail(
      'REVIEW_ATTACHMENT_RESIDUAL_SHAPE_MISMATCH',
      'Residual recovery requires exactly one legacy Review preflight.',
    );
  }
  const preflight = residualPreflights[0];
  if (
    (state.versions ?? []).some(
      (row) => row.acquisitionId === acquisition.acquisitionId,
    )
    || (state.currentness ?? []).some(
      (row) => row.preflightId === preflight.preflightId,
    )
  ) {
    fail(
      'REVIEW_ATTACHMENT_RESIDUAL_DOWNSTREAM_PRESENT',
      'Residual recovery is forbidden when the residual has a DocumentVersion or currentness link.',
    );
  }
  if (
    (state.scopeConversations ?? []).length !== 1
    || (state.scopeWorkItems ?? []).length !== 1
  ) {
    fail(
      'REVIEW_ATTACHMENT_RESIDUAL_SCOPE_NOT_FOUND',
      'Residual recovery requires one fresh Review conversation and WorkItem scope.',
    );
  }
  const conversation = state.scopeConversations[0];
  const controlledWorkItem = state.scopeWorkItems[0];
  if (
    conversation.reviewConversationId !== scope.reviewConversationId
    || conversation.tenantId !== scope.tenantId
    || conversation.actorId !== scope.actorUserId
    || conversation.workItemId !== scope.workItemId
    || conversation.status !== 'ACTIVE'
    || controlledWorkItem.workItemId !== scope.workItemId
    || controlledWorkItem.tenantId !== scope.tenantId
    || controlledWorkItem.requestedByUserId !== scope.actorUserId
    || controlledWorkItem.revision !== scope.expectedRevision
  ) {
    fail(
      'REVIEW_ATTACHMENT_RESIDUAL_SCOPE_CONFLICT',
      'Residual Review attachment is outside the fresh server-bound conversation or WorkItem scope.',
    );
  }

  const legacyConversationId = reviewConversationIdFromSourceRef(
    acquisition.sourceRef,
  );
  const legacyRequestRef = reviewRequestRefFromSourceRef(acquisition.sourceRef);
  const expectedLegacyDocumentCode = [
    'REVIEW',
    legacyConversationId,
    legacyRequestRef,
  ].join('-').toUpperCase();
  const sourceDescriptor = recordJson(acquisition.sourceDescriptorJson);
  if (
    acquisition.sourceArtifactId !== artifact.sourceArtifactId
    || acquisition.documentVersionId !== null
    || acquisition.sourceChannel !== REVIEW_ATTACHMENT_SOURCE_CHANNEL
    || legacyConversationId !== scope.reviewConversationId
    || !legacyRequestRef
    || legacyRequestRef === scope.requestRef
    || acquisition.acquiredBy !== scope.actorUserId
    || acquisition.idempotencyKey !== [
      'review-attachment',
      legacyConversationId,
      legacyRequestRef,
    ].join(':')
    || acquisition.status !== 'ACQUIRED_READBACK_VERIFIED'
    || sourceDescriptor.sourceKind !== REVIEW_ATTACHMENT_SOURCE_CHANNEL
    || sourceDescriptor.sourceStorageKey
      !== `${input.bucketId}:${input.filePath}`
    || sourceDescriptor.sha256 !== input.sha256
    || Number(sourceDescriptor.sizeBytes) !== Number(input.byteLength)
    || sourceDescriptor.mediaType !== input.mediaType
    || sourceDescriptor.documentFamily !== 'OEM_REFERENCE'
    || sourceDescriptor.documentCode !== expectedLegacyDocumentCode
  ) {
    fail(
      'REVIEW_ATTACHMENT_RESIDUAL_ACQUISITION_CONFLICT',
      'Residual Acquisition is not the exact legacy Review attachment state for these immutable bytes and scope.',
    );
  }

  const normalizedDescriptor = recordJson(preflight.normalizedDescriptorJson);
  const decisionPayload = recordJson(preflight.decisionPayloadJson);
  const incoming = recordValue(decisionPayload, 'incoming');
  const provenance = recordValue(incoming, 'documentCodeProvenance');
  const identityIssues: unknown = incoming.identityIssues;
  if (
    preflight.acquisitionId !== acquisition.acquisitionId
    || preflight.decision !== LEGACY_REVIEW_ATTACHMENT_DECISION
    || preflight.branch !== 'REVIEW'
    || preflight.executionAuthorized !== false
    || preflight.status !== 'READY'
    || preflight.documentVersionId !== null
    || preflight.commitIdempotencyKey !== null
    || normalizedDescriptor.sha256 !== input.sha256
    || Number(normalizedDescriptor.sizeBytes) !== Number(input.byteLength)
    || normalizedDescriptor.sourceKind !== REVIEW_ATTACHMENT_SOURCE_CHANNEL
    || normalizedDescriptor.canonicalDocumentFamily !== 'OEM_REFERENCE'
    || normalizedDescriptor.documentCode !== expectedLegacyDocumentCode
    || decisionPayload.decision !== LEGACY_REVIEW_ATTACHMENT_DECISION
    || decisionPayload.branch !== 'REVIEW'
    || decisionPayload.executionAuthorized !== false
    || incoming.identityResolved !== false
    || incoming.sha256 !== input.sha256
    || Number(incoming.sizeBytes) !== Number(input.byteLength)
    || incoming.documentCode !== expectedLegacyDocumentCode
    || provenance.sourceVerified !== false
    || !Array.isArray(identityIssues)
    || !identityIssues.includes('DOCUMENT_CODE_PROVENANCE_UNVERIFIED')
  ) {
    fail(
      'REVIEW_ATTACHMENT_RESIDUAL_PREFLIGHT_CONFLICT',
      'Residual preflight is not the exact unresolved legacy Review attachment decision.',
    );
  }
  const completedAcquisitions = acquisitions.filter(
    (row) => row.acquisitionId !== acquisition.acquisitionId,
  );
  const completedPreflights = preflights.filter(
    (row) => row.acquisitionId !== acquisition.acquisitionId,
  );
  if (
    completedPreflights.length !== completedAcquisitions.length
    || completedPreflights.some((row) => !completedAcquisitions.some(
      (candidate) => candidate.acquisitionId === row.acquisitionId,
    ))
  ) {
    fail(
      'REVIEW_ATTACHMENT_RESIDUAL_COMPANION_STATE_INVALID',
      'Only complete ordinary Catalog lineage may coexist with the legacy Review residual.',
    );
  }
  if (
    completedAcquisitions.length > 0
    || completedPreflights.length > 0
    || (state.versions ?? []).length > 0
  ) {
    classifyImmutableSourceReuseState(input, {
      artifacts: state.artifacts,
      acquisitions: completedAcquisitions,
      preflights: completedPreflights,
      versions: state.versions,
    });
  }
  assertCompletedOrdinaryDownstreamLineage(
    input,
    state.versions ?? [],
    state.downstreamWorkItems ?? [],
    state.actionAttempts ?? [],
  );
  return {
    disposition: 'REVIEW_ATTACHMENT_RESIDUAL_RECOVERY_ALLOWED',
    residualAcquisitionId: acquisition.acquisitionId,
    residualPreflightId: preflight.preflightId,
  };
}

@Injectable()
// Registered by DocumentManagementHostedModule.register().
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class MiaodaHostedDocumentCatalog {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  private async finalizeCatalogLinks(command) {
    const acquisitionUpdate = await this.db.update(dmAcquisition).set({
      documentVersionId: command.documentVersion.documentVersionId,
      status: 'COMMITTED_CANONICAL',
    }).where(and(
      eq(dmAcquisition.acquisitionId, command.documentVersion.acquisitionId),
      isNull(dmAcquisition.documentVersionId),
    )).returning({ acquisitionId: dmAcquisition.acquisitionId });
    if (acquisitionUpdate.length !== 1) {
      const [freshAcquisition] = await this.db.select().from(dmAcquisition).where(
        eq(dmAcquisition.acquisitionId, command.documentVersion.acquisitionId),
      ).limit(1);
      if (freshAcquisition?.documentVersionId !== command.documentVersion.documentVersionId) {
        fail('ACQUISITION_VERSION_CONFLICT', 'Acquisition did not link to committed DocumentVersion.');
      }
    }
    const preflightUpdate = await this.db.update(dmIngressPreflight).set({
      status: 'COMMITTED',
      documentVersionId: command.documentVersion.documentVersionId,
      commitIdempotencyKey: command.idempotencyKey,
      committedAt: asDate(command.documentVersion.committedAt),
    }).where(and(
      eq(dmIngressPreflight.preflightId, command.preflightId),
      eq(dmIngressPreflight.status, 'READY'),
    )).returning({ preflightId: dmIngressPreflight.preflightId });
    if (preflightUpdate.length !== 1) {
      const [freshPreflight] = await this.db.select().from(dmIngressPreflight).where(
        eq(dmIngressPreflight.preflightId, command.preflightId),
      ).limit(1);
      if (
        freshPreflight?.documentVersionId !== command.documentVersion.documentVersionId
        || freshPreflight.commitIdempotencyKey !== command.idempotencyKey
      ) {
        fail('PREFLIGHT_COMMIT_CONFLICT', 'Preflight did not finalize under the commit identity.');
      }
    }
  }

  async findIngestionByIdempotency({ idempotencyKey, sourceChannel, sourceRef, selection }) {
    const [acquisition] = await this.db.select().from(dmAcquisition).where(
      eq(dmAcquisition.idempotencyKey, idempotencyKey),
    ).limit(1);
    if (!acquisition) return null;
    const selectionBucketId = String(selection?.bucketId || selection?.bucket_id || '').trim();
    const selectionFilePath = String(selection?.filePath || selection?.file_path || '').trim();
    if (
      acquisition.sourceChannel !== String(sourceChannel || '').trim()
      || acquisition.sourceRef !== String(sourceRef || '').trim()
      || acquisition.selectionBucketId !== selectionBucketId
      || acquisition.selectionFilePath !== selectionFilePath
    ) {
      fail('ACQUISITION_IDEMPOTENCY_CONFLICT', 'Idempotency key was reused for another selection.');
    }
    if (!acquisition.documentVersionId) {
      return { status: 'INCOMPLETE', acquisitionId: acquisition.acquisitionId };
    }
    const rows = await this.db.select({
      version: dmDocumentVersion,
      family: dmPublicationFamily,
      artifact: dmSourceArtifact,
      preflight: dmIngressPreflight,
    }).from(dmDocumentVersion).innerJoin(
      dmPublicationFamily,
      eq(dmPublicationFamily.familyId, dmDocumentVersion.familyId),
    ).innerJoin(
      dmSourceArtifact,
      eq(dmSourceArtifact.sourceArtifactId, dmDocumentVersion.sourceArtifactId),
    ).innerJoin(
      dmIngressPreflight,
      and(
        eq(dmIngressPreflight.acquisitionId, acquisition.acquisitionId),
        eq(dmIngressPreflight.status, 'COMMITTED'),
      ),
    ).where(eq(
      dmDocumentVersion.documentVersionId,
      acquisition.documentVersionId,
    )).limit(2);
    if (rows.length !== 1 || rows[0].artifact.readbackVerified !== true) {
      fail('CATALOG_REPLAY_READ_FAILED', 'Completed replay lacks one fresh exact Catalog lineage.');
    }
    const row = rows[0];
    return {
      status: 'COMMITTED',
      acquisitionId: acquisition.acquisitionId,
      sourceArtifactId: acquisition.sourceArtifactId,
      preflightId: row.preflight.preflightId,
      decision: row.preflight.decision,
      familyId: row.family.familyId,
      documentId: row.version.documentId,
      documentVersionId: row.version.documentVersionId,
      currentGeneration: row.family.currentGeneration,
      immutableReadbackVerified: true,
    };
  }

  async assertImmutableSourceReuseSafe(input: ImmutableSourceReuseInput) {
    const artifacts = await this.db.select().from(dmSourceArtifact).where(or(
      eq(dmSourceArtifact.sourceArtifactId, input.sourceArtifactId),
      and(
        eq(dmSourceArtifact.sha256, input.sha256),
        eq(dmSourceArtifact.byteLength, Number(input.byteLength)),
      ),
      and(
        eq(dmSourceArtifact.bucketId, input.bucketId),
        eq(dmSourceArtifact.filePath, input.filePath),
      ),
    )).limit(3);
    const acquisitions = await this.db.select().from(dmAcquisition).where(or(
      eq(dmAcquisition.acquisitionId, input.acquisitionId),
      eq(dmAcquisition.idempotencyKey, input.idempotencyKey),
      eq(dmAcquisition.sourceArtifactId, input.sourceArtifactId),
    )).limit(100);
    const acquisitionIds = [...new Set([
      input.acquisitionId,
      ...acquisitions.map((row) => row.acquisitionId),
    ])];
    const preflights = await this.db.select().from(dmIngressPreflight).where(
      inArray(dmIngressPreflight.acquisitionId, acquisitionIds),
    ).limit(100);
    const versions = await this.db.select().from(dmDocumentVersion).where(or(
      eq(dmDocumentVersion.sourceArtifactId, input.sourceArtifactId),
      eq(dmDocumentVersion.acquisitionId, input.acquisitionId),
    )).limit(100);
    const hasIncompleteState = acquisitions.some((row) => (
      !row.documentVersionId || !COMPLETE_ACQUISITION_STATUSES.has(row.status)
    )) || preflights.some((row) => (
      row.status !== 'COMMITTED' || !row.documentVersionId
    ));
    if (input.serverBoundReviewAttachmentScope && hasIncompleteState) {
      const preflightIds = preflights.map((row) => row.preflightId);
      const currentness = preflightIds.length > 0
        ? await this.db.select().from(dmCurrentnessDecision).where(
          inArray(dmCurrentnessDecision.preflightId, preflightIds),
        ).limit(100)
        : [];
      const downstreamWorkItems = await this.db.select({
        workItemId: workItem.workItemId,
        sourceArtifactId: workItem.sourceArtifactId,
        documentId: workItem.documentId,
        documentVersionId: workItem.documentVersionId,
      }).from(workItem).where(
        eq(workItem.sourceArtifactId, input.sourceArtifactId),
      );
      const actionAttempts = await this.db.select({
        attemptId: actionAttempt.attemptId,
        workItemId: actionAttempt.workItemId,
        documentVersionId: actionAttempt.documentVersionId,
      }).from(actionAttempt).innerJoin(
        workItem,
        eq(workItem.workItemId, actionAttempt.workItemId),
      ).where(
        eq(workItem.sourceArtifactId, input.sourceArtifactId),
      );
      const scope = input.serverBoundReviewAttachmentScope;
      const scopeConversations = await this.db.select()
        .from(reviewConversation)
        .where(eq(
          reviewConversation.reviewConversationId,
          scope.reviewConversationId,
        )).limit(2);
      const scopeWorkItems = await this.db.select().from(workItem).where(
        eq(workItem.workItemId, scope.workItemId),
      ).limit(2);
      return classifyReviewAttachmentResidualReuseState(input, {
        artifacts,
        acquisitions,
        preflights,
        versions,
        currentness,
        downstreamWorkItems,
        actionAttempts,
        scopeConversations,
        scopeWorkItems,
      });
    }
    return classifyImmutableSourceReuseState(input, {
      artifacts,
      acquisitions,
      preflights,
      versions,
    });
  }

  async assertIncompleteIngestionRecoverySafe(input: IncompleteIngestionRecoveryInput) {
    const artifacts = await this.db.select().from(dmSourceArtifact).where(or(
      eq(dmSourceArtifact.sourceArtifactId, input.sourceArtifact.sourceArtifactId),
      and(
        eq(dmSourceArtifact.sha256, input.sourceArtifact.sha256),
        eq(dmSourceArtifact.byteLength, Number(input.sourceArtifact.byteLength)),
      ),
      and(
        eq(dmSourceArtifact.bucketId, input.sourceArtifact.bucketId),
        eq(dmSourceArtifact.filePath, input.sourceArtifact.filePath),
      ),
    )).limit(3);
    const acquisitions = await this.db.select().from(dmAcquisition).where(or(
      eq(dmAcquisition.acquisitionId, input.acquisition.acquisitionId),
      eq(dmAcquisition.idempotencyKey, input.acquisition.idempotencyKey),
      eq(dmAcquisition.sourceArtifactId, input.sourceArtifact.sourceArtifactId),
    )).limit(3);
    const preflights = await this.db.select().from(dmIngressPreflight).where(or(
      eq(dmIngressPreflight.preflightId, input.preflight.preflightId),
      eq(dmIngressPreflight.acquisitionId, input.acquisition.acquisitionId),
    )).limit(3);
    const families = await this.db.select().from(dmPublicationFamily).where(or(
      eq(dmPublicationFamily.familyId, input.downstream.familyId),
      eq(dmPublicationFamily.canonicalIdentityKey, input.downstream.canonicalIdentityKey),
    )).limit(3);
    const documents = await this.db.select().from(dmDocument).where(or(
      eq(dmDocument.documentId, input.downstream.documentId),
      eq(dmDocument.familyId, input.downstream.familyId),
    )).limit(3);
    const versions = await this.db.select().from(dmDocumentVersion).where(or(
      eq(dmDocumentVersion.documentVersionId, input.downstream.documentVersionId),
      eq(dmDocumentVersion.familyId, input.downstream.familyId),
      eq(dmDocumentVersion.sourceArtifactId, input.sourceArtifact.sourceArtifactId),
      eq(dmDocumentVersion.acquisitionId, input.acquisition.acquisitionId),
    )).limit(3);
    const currentness = await this.db.select().from(dmCurrentnessDecision).where(or(
      eq(dmCurrentnessDecision.familyId, input.downstream.familyId),
      eq(dmCurrentnessDecision.preflightId, input.preflight.preflightId),
      eq(dmCurrentnessDecision.nextDocumentVersionId, input.downstream.documentVersionId),
    )).limit(3);
    const workItems = await this.db.select().from(workItem).where(or(
      eq(workItem.sourceArtifactId, input.sourceArtifact.sourceArtifactId),
      eq(workItem.documentId, input.downstream.documentId),
      eq(workItem.documentVersionId, input.downstream.documentVersionId),
    )).limit(3);
    const actionAttempts = await this.db.select({
      attemptId: actionAttempt.attemptId,
    }).from(actionAttempt).innerJoin(
      workItem,
      eq(workItem.workItemId, actionAttempt.workItemId),
    ).where(or(
      eq(workItem.sourceArtifactId, input.sourceArtifact.sourceArtifactId),
      eq(workItem.documentId, input.downstream.documentId),
      eq(workItem.documentVersionId, input.downstream.documentVersionId),
    )).limit(3);
    return classifyIncompleteIngestionRecoveryState(input, {
      artifacts,
      acquisitions,
      preflights,
      families,
      documents,
      versions,
      currentness,
      workItems,
      actionAttempts,
    });
  }

  async recordAcquisition({ sourceArtifact, acquisition }) {
    await this.db.insert(dmSourceArtifact).values({
      ...sourceArtifact,
      createdAt: asDate(sourceArtifact.createdAt),
    }).onConflictDoNothing({ target: dmSourceArtifact.sourceArtifactId });
    const [storedArtifact] = await this.db.select().from(dmSourceArtifact).where(
      eq(dmSourceArtifact.sourceArtifactId, sourceArtifact.sourceArtifactId),
    ).limit(1);
    if (
      !storedArtifact
      || storedArtifact.sha256 !== sourceArtifact.sha256
      || Number(storedArtifact.byteLength) !== Number(sourceArtifact.byteLength)
      || storedArtifact.bucketId !== sourceArtifact.bucketId
      || storedArtifact.filePath !== sourceArtifact.filePath
    ) {
      fail('SOURCE_ARTIFACT_IDENTITY_CONFLICT', 'SourceArtifact identity drifted in hosted Catalog.');
    }

    await this.db.insert(dmAcquisition).values({
      acquisitionId: acquisition.acquisitionId,
      sourceArtifactId: acquisition.sourceArtifactId,
      sourceChannel: acquisition.sourceChannel,
      sourceRef: acquisition.sourceRef,
      selectionBucketId: acquisition.selectionBucketId,
      selectionFilePath: acquisition.selectionFilePath,
      providerObjectId: acquisition.providerObjectId,
      providerVersionId: acquisition.providerVersionId,
      acquiredBy: acquisition.acquiredBy,
      acquiredAt: asDate(acquisition.acquiredAt),
      idempotencyKey: acquisition.idempotencyKey,
      sourceDescriptorJson: JSON.stringify(acquisition.sourceDescriptor),
      status: 'ACQUIRED_READBACK_VERIFIED',
    }).onConflictDoNothing({ target: dmAcquisition.idempotencyKey });
    const [stored] = await this.db.select().from(dmAcquisition).where(
      eq(dmAcquisition.idempotencyKey, acquisition.idempotencyKey),
    ).limit(1);
    if (!stored || stored.acquisitionId !== acquisition.acquisitionId) {
      fail('ACQUISITION_IDEMPOTENCY_CONFLICT', 'Idempotency key resolved to another Acquisition.');
    }
    return {
      ...stored,
      sourceDescriptor: parseJson(stored.sourceDescriptorJson),
    };
  }

  async listIngressDocuments() {
    const rows = await this.db.select({
      version: dmDocumentVersion,
      family: dmPublicationFamily,
    }).from(dmDocumentVersion).innerJoin(
      dmPublicationFamily,
      eq(dmDocumentVersion.familyId, dmPublicationFamily.familyId),
    );
    return rows.map(({ version, family }) => ({
      documentId: version.documentId,
      documentVersionId: version.documentVersionId,
      familyId: version.familyId,
      versionStatus: family.currentDocumentVersionId === version.documentVersionId
        ? 'CANONICAL_CURRENT'
        : 'CANONICAL_HISTORICAL',
      detail: {
        sha256: version.pdfSha256,
        sizeBytes: Number(version.byteLength),
        documentCode: family.canonicalDocumentNumber,
        originalFilename: version.originalFilename,
        documentFamily: family.documentFamily,
        canonicalDocumentFamily: family.documentFamily,
        businessRevision: version.businessRevision,
        revisionDate: version.revisionDate,
        sourceGeneratedDate: version.sourceGeneratedDate,
        revisionId: version.revisionId,
        status: 'catalog_committed',
      },
      upload: {
        descriptorSummary: {
          sha256: version.pdfSha256,
          sizeBytes: Number(version.byteLength),
          documentCode: family.canonicalDocumentNumber,
          documentFamily: family.documentFamily,
          businessRevision: version.businessRevision,
          revisionDate: version.revisionDate,
          sourceGeneratedDate: version.sourceGeneratedDate,
        },
      },
      report: { status: 'not_available' },
      ownerActionState: { pipeline: { selectedReplacementRevisionId: '' } },
      documentAnalysisWorkbenchView: { status: 'not_available' },
    }));
  }

  async observeFamily(canonicalIdentityKey: string) {
    const [family] = await this.db.select().from(dmPublicationFamily).where(
      eq(dmPublicationFamily.canonicalIdentityKey, canonicalIdentityKey),
    ).limit(1);
    return family || null;
  }

  async recordPreflight(preflight) {
    await this.db.insert(dmIngressPreflight).values({
      preflightId: preflight.preflightId,
      acquisitionId: preflight.acquisitionId,
      decision: preflight.decision,
      branch: preflight.branch,
      executionAuthorized: false,
      observedCurrentGeneration: preflight.observedCurrentGeneration,
      observedCurrentDocumentVersionId: preflight.observedCurrentDocumentVersionId,
      normalizedDescriptorJson: JSON.stringify(preflight.normalizedDescriptor),
      decisionPayloadJson: JSON.stringify(preflight.decisionPayload),
      status: preflight.status,
      createdAt: asDate(preflight.createdAt),
    }).onConflictDoNothing({ target: dmIngressPreflight.preflightId });
    const [stored] = await this.db.select().from(dmIngressPreflight).where(
      eq(dmIngressPreflight.preflightId, preflight.preflightId),
    ).limit(1);
    return stored;
  }

  async findExactDocumentVersion({ sha256, byteLength }) {
    const matches = await this.db.select().from(dmDocumentVersion).where(and(
      eq(dmDocumentVersion.pdfSha256, sha256),
      eq(dmDocumentVersion.byteLength, Number(byteLength)),
    )).limit(2);
    if (matches.length > 1) {
      fail('MULTIPLE_EXACT_MATCHES', 'Content identity resolved to multiple DocumentVersions.');
    }
    return matches[0] || null;
  }

  async linkAcquisitionToVersion({
    acquisitionId,
    documentVersionId,
    preflightId,
    idempotencyKey,
  }) {
    const [current] = await this.db.select().from(dmAcquisition).where(
      eq(dmAcquisition.acquisitionId, acquisitionId),
    ).limit(1);
    if (!current) fail('ACQUISITION_NOT_FOUND', `Acquisition not found: ${acquisitionId}`);
    if (current.documentVersionId && current.documentVersionId !== documentVersionId) {
      fail('ACQUISITION_VERSION_CONFLICT', 'Acquisition is already linked to another DocumentVersion.');
    }
    const [updated] = await this.db.update(dmAcquisition).set({
      documentVersionId,
      status: 'LINKED_EXACT_DOCUMENT_VERSION',
    }).where(and(
      eq(dmAcquisition.acquisitionId, acquisitionId),
      current.documentVersionId
        ? eq(dmAcquisition.documentVersionId, current.documentVersionId)
        : isNull(dmAcquisition.documentVersionId),
    )).returning();
    if (!updated && current.documentVersionId !== documentVersionId) {
      fail('ACQUISITION_LINK_CAS_CONFLICT', 'Acquisition link changed concurrently.');
    }
    const preflightUpdate = await this.db.update(dmIngressPreflight).set({
      status: 'COMMITTED',
      documentVersionId,
      commitIdempotencyKey: idempotencyKey,
      committedAt: new Date(),
    }).where(and(
      eq(dmIngressPreflight.preflightId, preflightId),
      eq(dmIngressPreflight.acquisitionId, acquisitionId),
      eq(dmIngressPreflight.status, 'READY'),
    )).returning({ preflightId: dmIngressPreflight.preflightId });
    if (preflightUpdate.length !== 1) {
      const [freshPreflight] = await this.db.select().from(dmIngressPreflight).where(
        eq(dmIngressPreflight.preflightId, preflightId),
      ).limit(1);
      if (
        freshPreflight?.documentVersionId !== documentVersionId
        || freshPreflight.commitIdempotencyKey !== idempotencyKey
      ) {
        fail('PREFLIGHT_COMMIT_CONFLICT', 'Exact-link preflight did not finalize idempotently.');
      }
    }
    return updated || current;
  }

  async commitNewVersion(command) {
    const [storedPreflight] = await this.db.select().from(dmIngressPreflight).where(
      eq(dmIngressPreflight.preflightId, command.preflightId),
    ).limit(1);
    if (!storedPreflight) fail('PREFLIGHT_NOT_FOUND', `Preflight not found: ${command.preflightId}`);
    if (
      storedPreflight.decision !== command.preflightDecision
      || storedPreflight.observedCurrentGeneration !== command.observedCurrentGeneration
      || (storedPreflight.observedCurrentDocumentVersionId || null)
        !== (command.observedCurrentDocumentVersionId || null)
    ) {
      fail('PREFLIGHT_COMMAND_MISMATCH', 'Commit command differs from stored preflight observation.');
    }
    if (storedPreflight.executionAuthorized !== false) {
      fail('PREFLIGHT_AUTHORITY_VIOLATION', 'Preflight cannot authorize its own execution.');
    }
    if (storedPreflight.status === 'COMMITTED' && storedPreflight.documentVersionId) {
      const version = await this.readDocumentVersion(storedPreflight.documentVersionId);
      const family = version ? await this.readFamily(version.familyId) : null;
      if (!version || !family) fail('CATALOG_REPLAY_READ_FAILED', 'Committed replay lacks fresh Catalog rows.');
      return {
        disposition: 'IDEMPOTENT_REPLAY',
        familyId: family.familyId,
        documentId: version.documentId,
        documentVersionId: version.documentVersionId,
        currentnessChanged: false,
        currentGeneration: family.currentGeneration,
      };
    }

    let [familyBefore] = await this.db.select().from(dmPublicationFamily).where(
      eq(dmPublicationFamily.familyId, command.family.familyId),
    ).limit(1);
    if (familyBefore && familyBefore.canonicalIdentityKey !== command.family.canonicalIdentityKey) {
      fail('FAMILY_IDENTITY_CONFLICT', 'Family ID resolved to another canonical identity.');
    }
    const [sameRevision] = await this.db.select().from(dmDocumentVersion).where(and(
      eq(dmDocumentVersion.familyId, command.family.familyId),
      eq(
        dmDocumentVersion.canonicalRevisionIdentity,
        command.documentVersion.canonicalRevisionIdentity,
      ),
    )).limit(1);
    if (
      sameRevision
      && (
        sameRevision.pdfSha256 !== command.documentVersion.pdfSha256
        || Number(sameRevision.byteLength) !== Number(command.documentVersion.byteLength)
      )
    ) {
      fail('SAME_REVISION_CONTENT_CONFLICT', 'Exact revision already has different actual bytes.');
    }
    if (sameRevision) {
      const [currentness] = await this.db.select().from(dmCurrentnessDecision).where(
        eq(
          dmCurrentnessDecision.currentnessDecisionId,
          command.currentnessDecision.currentnessDecisionId,
        ),
      ).limit(1);
      const committedBeforeLink = Boolean(
        familyBefore
        && familyBefore.currentDocumentVersionId === sameRevision.documentVersionId
        && familyBefore.currentGeneration === command.observedCurrentGeneration + 1
        && currentness?.nextDocumentVersionId === sameRevision.documentVersionId
        && currentness.previousGeneration === command.observedCurrentGeneration
      );
      if (!committedBeforeLink) {
        fail(
          'DOCUMENT_VERSION_ALREADY_EXISTS_NOT_CURRENT',
          'Exact revision exists but is not the currentness commit owned by this preflight.',
        );
      }
      await this.finalizeCatalogLinks(command);
      return {
        disposition: 'IDEMPOTENT_REPLAY',
        familyId: command.family.familyId,
        documentId: sameRevision.documentId,
        documentVersionId: sameRevision.documentVersionId,
        currentnessChanged: false,
        currentGeneration: familyBefore.currentGeneration,
      };
    }
    const familyCreatedInCommand = !familyBefore;
    await this.db.transaction(async (transaction) => {
      if (familyCreatedInCommand) {
        const createdFamily = await transaction.insert(dmPublicationFamily).values({
          ...command.family,
          currentDocumentVersionId: null,
          currentGeneration: 0,
          createdAt: asDate(command.family.createdAt),
          updatedAt: asDate(command.family.createdAt),
        }).onConflictDoNothing({ target: dmPublicationFamily.familyId }).returning({
          familyId: dmPublicationFamily.familyId,
        });
        if (createdFamily.length !== 1) {
          fail('FAMILY_CREATE_CONFLICT', 'Family was created concurrently after preflight.');
        }
        const createdDocument = await transaction.insert(dmDocument).values({
          documentId: command.document.documentId,
          familyId: command.document.familyId,
          documentFamily: command.document.documentFamily,
          status: command.document.status,
          createdAt: asDate(command.document.createdAt),
        }).returning({ familyId: dmDocument.familyId });
        if (createdDocument.length !== 1) {
          fail('FAMILY_CREATE_CONFLICT', 'Family Document was not created in the hosted transaction.');
        }
      }

      const movedRows = await transaction.update(dmPublicationFamily).set({
        currentDocumentVersionId: command.documentVersion.documentVersionId,
        currentGeneration: command.observedCurrentGeneration + 1,
        updatedAt: asDate(command.documentVersion.committedAt),
      }).where(and(
        eq(dmPublicationFamily.familyId, command.family.familyId),
        eq(dmPublicationFamily.currentGeneration, command.observedCurrentGeneration),
        command.observedCurrentDocumentVersionId
          ? eq(
            dmPublicationFamily.currentDocumentVersionId,
            command.observedCurrentDocumentVersionId,
          )
          : isNull(dmPublicationFamily.currentDocumentVersionId),
      )).returning({ familyId: dmPublicationFamily.familyId });
      if (movedRows.length !== 1) {
        fail('CURRENTNESS_CAS_CONFLICT', 'Family current head changed after preflight.');
      }

      const insertedVersion = await transaction.insert(dmDocumentVersion).values({
        documentVersionId: command.documentVersion.documentVersionId,
        documentId: command.documentVersion.documentId,
        familyId: command.documentVersion.familyId,
        revisionId: command.documentVersion.revisionId,
        canonicalRevisionIdentity: command.documentVersion.canonicalRevisionIdentity,
        businessRevision: command.documentVersion.businessRevision,
        revisionDate: command.documentVersion.revisionDate,
        sourceGeneratedDate: command.documentVersion.sourceGeneratedDate,
        originalFilename: command.documentVersion.originalFilename,
        sourceArtifactId: command.documentVersion.sourceArtifactId,
        acquisitionId: command.documentVersion.acquisitionId,
        pdfSha256: command.documentVersion.pdfSha256,
        byteLength: Number(command.documentVersion.byteLength),
        mediaType: command.documentVersion.mediaType,
        lifecycleStatus: 'COMMITTED_IMMUTABLE',
        committedAt: asDate(command.documentVersion.committedAt),
        committedBy: command.documentVersion.committedBy,
      }).returning({ documentVersionId: dmDocumentVersion.documentVersionId });
      if (insertedVersion.length !== 1) {
        fail('DOCUMENT_VERSION_INSERT_CONFLICT', 'DocumentVersion was not created in the hosted transaction.');
      }

      const currentnessRows = await transaction.insert(dmCurrentnessDecision).values({
        currentnessDecisionId: command.currentnessDecision.currentnessDecisionId,
        familyId: command.family.familyId,
        previousDocumentVersionId: command.observedCurrentDocumentVersionId,
        nextDocumentVersionId: command.documentVersion.documentVersionId,
        previousGeneration: command.observedCurrentGeneration,
        nextGeneration: command.observedCurrentGeneration + 1,
        reason: command.currentnessDecision.reason,
        decidedAt: asDate(command.currentnessDecision.decidedAt),
        decidedBy: command.currentnessDecision.decidedBy,
        preflightId: command.preflightId,
      }).returning({
        currentnessDecisionId: dmCurrentnessDecision.currentnessDecisionId,
      });
      if (currentnessRows.length !== 1) {
        fail('CURRENTNESS_COMMIT_CONFLICT', 'Currentness decision was not created in the hosted transaction.');
      }
    });

    [familyBefore] = await this.db.select().from(dmPublicationFamily).where(
      eq(dmPublicationFamily.familyId, command.family.familyId),
    ).limit(1);
    if (
      !familyBefore
      || familyBefore.currentDocumentVersionId !== command.documentVersion.documentVersionId
      || familyBefore.currentGeneration !== command.observedCurrentGeneration + 1
    ) {
      fail('CURRENTNESS_READBACK_CONFLICT', 'Hosted Family currentness failed fresh readback.');
    }

    await this.finalizeCatalogLinks(command);
    return {
      disposition: command.preflightDecision,
      familyId: command.family.familyId,
      documentId: command.document.documentId,
      documentVersionId: command.documentVersion.documentVersionId,
      currentnessChanged: true,
      currentGeneration: command.observedCurrentGeneration + 1,
    };
  }

  async readDocumentVersion(documentVersionId: string) {
    const [version] = await this.db.select().from(dmDocumentVersion).where(
      eq(dmDocumentVersion.documentVersionId, documentVersionId),
    ).limit(1);
    return version || null;
  }

  async readFamily(familyId: string) {
    const [family] = await this.db.select().from(dmPublicationFamily).where(
      eq(dmPublicationFamily.familyId, familyId),
    ).limit(1);
    return family || null;
  }
}
