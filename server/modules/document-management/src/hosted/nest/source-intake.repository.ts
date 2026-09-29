import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, sql } from 'drizzle-orm';
import type { DocumentDeliverySelection } from '@shared/api.interface';
import { actionAttempt, dmAcquisition, dmSourceArtifact } from '../../../../../database/schema';
import type { DocumentUploadAuthority } from './document-upload-authority';
import {
  assertSourceIntakeAuthority,
  assertSourceReceiptReadAuthority,
  isMintedSourceDelegationAuthority,
  type SourceReceiptReadAuthority,
  type SourceIntakeAuthority,
  validDelivery,
} from './source-intake-authority';

export interface SourceIntakeRequest {
  acquisitionId: string;
  tenantId: string;
  actorUserId: string;
  documentDelivery: DocumentDeliverySelection;
  engineeringMode: 'DOCUMENT_ONLY' | 'AUTHORIZED_SCOPE';
  authority: SourceIntakeAuthority;
}

export interface SourceIntakeReceipt {
  attemptId: string;
  acquisitionId: string;
  status: 'RECORDED';
  pendingReason: 'WAITING_IDENTITY' | 'READY_FOR_NEXT_STAGE';
  created: boolean;
}

interface IntakeEnvelope {
  schemaVersion: 'wiselink.document_delivery_intent.v2';
  acquisitionId: string;
  authority: {
    kind: 'VERIFIED_UPLOAD' | 'SOURCE_DELEGATION';
    authorityRef: string;
    policyRevision: string;
    executorPrincipalId: string;
  };
  documentDelivery: DocumentDeliverySelection;
  engineeringMode: 'DOCUMENT_ONLY' | 'AUTHORIZED_SCOPE';
}

@Injectable()
// Registered in DocumentManagementHostedModule.register dynamic providers.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class SourceIntakeRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async reserve(input: SourceIntakeRequest): Promise<SourceIntakeReceipt> {
    assertRequest(input);
    assertSourceIntakeAuthority(input);
    // P1 admits one initial processing purpose per acquisition. A later
    // explicit purpose may add a different fixed suffix without a new index.
    const idempotencyKey =
      `source-intake:${input.acquisitionId}:initial`;
    if (idempotencyKey.length > 255) throw new Error('SOURCE_INTAKE_REQUEST_KEY_INVALID');
    return this.db.transaction(async tx => {
      // The capability is checked before installing the existing actor SQL scope.
      await tx.execute(sql`SELECT set_config('app.tenant_id',${input.tenantId},true)`);
      await tx.execute(sql`SELECT set_config('app.user_id',${input.actorUserId},true)`);
      const [source] = await tx.select({ acquisition: dmAcquisition, artifact: dmSourceArtifact })
        .from(dmAcquisition)
        .innerJoin(dmSourceArtifact,
          eq(dmAcquisition.sourceArtifactId, dmSourceArtifact.sourceArtifactId))
        .where(and(eq(dmAcquisition.acquisitionId, input.acquisitionId),
          eq(dmAcquisition.acquiredBy, input.actorUserId),
          sql`starts_with(${dmAcquisition.idempotencyKey},
            ${`tenant:${encodeURIComponent(input.tenantId)}:request:`})`))
        .limit(1);
      if (!source || !source.artifact.readbackVerified ||
        source.acquisition.acquiredBy !== input.actorUserId ||
        !source.acquisition.idempotencyKey.startsWith(
          `tenant:${encodeURIComponent(input.tenantId)}:request:`) ||
        source.artifact.sourceArtifactId !== source.acquisition.sourceArtifactId ||
        source.artifact.bucketId !== source.acquisition.selectionBucketId ||
        source.artifact.filePath !== source.acquisition.selectionFilePath ||
        source.artifact.providerObjectId !== source.acquisition.providerObjectId ||
        source.artifact.providerVersionId !== source.acquisition.providerVersionId) {
        throw new Error('SOURCE_INTAKE_ACQUISITION_MISMATCH');
      }
      const envelope = validatedEnvelope(input, source.acquisition);
      const [inserted] = await tx.insert(actionAttempt).values({
        attemptId: `ATT-${randomUUID()}`,
        subjectKind: 'ACQUISITION',
        workItemId: null,
        documentVersionId: null,
        actionType: 'DOCUMENT_DELIVERY_INTENT',
        attemptNo: 1,
        triggerRequestId: `REQ-${randomUUID()}`,
        requestOrigin: 'HOST_SOURCE_INTAKE_V2',
        status: 'RECORDED',
        actorUserId: input.actorUserId,
        tenantId: input.tenantId,
        taskEnvelopeJson: JSON.stringify(envelope),
        idempotencyKey,
      }).onConflictDoNothing({ target: [actionAttempt.tenantId, actionAttempt.idempotencyKey] })
        .returning({ attemptId: actionAttempt.attemptId });
      const [stored] = await tx.select().from(actionAttempt).where(and(
        eq(actionAttempt.tenantId, input.tenantId),
        eq(actionAttempt.idempotencyKey, idempotencyKey))).limit(1);
      if (!stored || stored.subjectKind !== 'ACQUISITION' ||
        stored.actionType !== 'DOCUMENT_DELIVERY_INTENT' ||
        stored.actorUserId !== input.actorUserId || stored.status !== 'RECORDED' ||
        stored.taskEnvelopeJson !== JSON.stringify(envelope)) {
        throw new Error('SOURCE_INTAKE_IDEMPOTENCY_CONFLICT');
      }
      return { attemptId: stored.attemptId, acquisitionId: input.acquisitionId,
        status: 'RECORDED' as const,
        pendingReason: source.acquisition.documentVersionId
          ? 'READY_FOR_NEXT_STAGE' as const : 'WAITING_IDENTITY' as const,
        created: Boolean(inserted) };
    });
  }

  async read(input: { tenantId: string; actorUserId: string; attemptId: string;
    authority: DocumentUploadAuthority | SourceReceiptReadAuthority }): Promise<SourceIntakeReceipt | null> {
    assertSourceReceiptReadAuthority(input);
    return this.db.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('app.tenant_id',${input.tenantId},true)`);
      await tx.execute(sql`SELECT set_config('app.user_id',${input.actorUserId},true)`);
      const [row] = await tx.select({ attempt: actionAttempt, acquisition: dmAcquisition })
        .from(actionAttempt).innerJoin(dmAcquisition,
          sql`${dmAcquisition.acquisitionId} = ${actionAttempt.taskEnvelopeJson}::jsonb ->> 'acquisitionId'`)
        .where(and(eq(actionAttempt.attemptId, input.attemptId),
          eq(actionAttempt.tenantId, input.tenantId),
          eq(actionAttempt.actorUserId, input.actorUserId),
          eq(actionAttempt.subjectKind, 'ACQUISITION'),
          eq(actionAttempt.actionType, 'DOCUMENT_DELIVERY_INTENT'),
          eq(actionAttempt.status, 'RECORDED'))).limit(1);
      if (!row) return null;
      const storedEnvelope = readEnvelope(row.attempt.taskEnvelopeJson);
      if (storedEnvelope.acquisitionId !== row.acquisition.acquisitionId ||
        row.acquisition.acquiredBy !== input.actorUserId ||
        !row.acquisition.idempotencyKey.startsWith(
          `tenant:${encodeURIComponent(input.tenantId)}:request:`)) {
        throw new Error('SOURCE_INTAKE_ENVELOPE_MISMATCH');
      }
      if ('kind' in input.authority) {
        let descriptor: unknown;
        try { descriptor = JSON.parse(row.acquisition.sourceDescriptorJson); }
        catch { throw new Error('SOURCE_INTAKE_DESCRIPTOR_INVALID'); }
        const data = descriptor as Record<string, unknown>;
        if (row.acquisition.sourceChannel !== 'wiselink_drive_source' ||
          data.sourceKey !== input.authority.sourceKey ||
          data.rootToken !== input.authority.rootToken ||
          storedEnvelope.authority.kind !== 'SOURCE_DELEGATION' ||
          storedEnvelope.authority.authorityRef !==
            `${input.authority.sourceKey}:${input.authority.rootToken}` ||
          storedEnvelope.authority.executorPrincipalId !== input.authority.executorPrincipalId) {
          throw new Error('SOURCE_INTAKE_ENVELOPE_MISMATCH');
        }
      } else if (row.acquisition.sourceChannel !== 'document_library_upload' ||
        storedEnvelope.authority.kind !== 'VERIFIED_UPLOAD' ||
        storedEnvelope.authority.authorityRef !== row.acquisition.acquisitionId ||
        storedEnvelope.authority.executorPrincipalId !== input.authority.appId) {
        throw new Error('SOURCE_INTAKE_ENVELOPE_MISMATCH');
      }
      return { attemptId: row.attempt.attemptId,
        acquisitionId: row.acquisition.acquisitionId, status: 'RECORDED', created: false,
        pendingReason: row.acquisition.documentVersionId
          ? 'READY_FOR_NEXT_STAGE' : 'WAITING_IDENTITY' };
    });
  }
}

function validatedEnvelope(input: SourceIntakeRequest,
  acquisition: typeof dmAcquisition.$inferSelect): IntakeEnvelope {
  let descriptor: unknown;
  try { descriptor = JSON.parse(acquisition.sourceDescriptorJson); }
  catch { throw new Error('SOURCE_INTAKE_DESCRIPTOR_INVALID'); }
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor))
    throw new Error('SOURCE_INTAKE_DESCRIPTOR_INVALID');
  const data = descriptor as Record<string, unknown>;
  if (isMintedSourceDelegationAuthority(input.authority)) {
    const { policy, observation } = input.authority;
    if (acquisition.sourceChannel !== 'wiselink_drive_source' ||
      data.sourceKey !== policy.sourceKey || data.rootToken !== policy.rootToken ||
      acquisition.providerObjectId !== observation.providerObjectId ||
      acquisition.providerVersionId !== observation.providerVersionId ||
      acquisition.selectionBucketId !== observation.selectionBucketId ||
      acquisition.selectionFilePath !== observation.selectionFilePath ||
      input.documentDelivery.reading !== policy.documentDelivery.reading ||
      input.documentDelivery.translation !== policy.documentDelivery.translation ||
      input.engineeringMode !== policy.engineeringMode) {
      throw new Error('SOURCE_INTAKE_DELEGATION_MISMATCH');
    }
    return { schemaVersion: 'wiselink.document_delivery_intent.v2',
      acquisitionId: input.acquisitionId,
      authority: { kind: 'SOURCE_DELEGATION',
        authorityRef: `${policy.sourceKey}:${policy.rootToken}`,
        policyRevision: policy.policyRevision,
        executorPrincipalId: policy.executorPrincipalId },
      documentDelivery: { reading: input.documentDelivery.reading,
        translation: input.documentDelivery.translation },
      engineeringMode: input.engineeringMode };
  }
  if (acquisition.sourceChannel !== 'document_library_upload' ||
    input.engineeringMode !== 'DOCUMENT_ONLY' ||
    !validDelivery(data.documentDeliveryIntent) ||
    data.documentDeliveryIntent.reading !== input.documentDelivery.reading ||
    data.documentDeliveryIntent.translation !== input.documentDelivery.translation) {
    throw new Error('SOURCE_INTAKE_UPLOAD_MISMATCH');
  }
  return { schemaVersion: 'wiselink.document_delivery_intent.v2',
    acquisitionId: input.acquisitionId,
    authority: { kind: 'VERIFIED_UPLOAD', authorityRef: input.acquisitionId,
      policyRevision: 'verified-upload.v1', executorPrincipalId: input.authority.appId },
    documentDelivery: { reading: input.documentDelivery.reading,
      translation: input.documentDelivery.translation },
    engineeringMode: input.engineeringMode };
}

function assertRequest(input: SourceIntakeRequest): void {
  if (!input.acquisitionId || !input.tenantId || !input.actorUserId ||
    !validDelivery(input.documentDelivery) ||
    !['DOCUMENT_ONLY', 'AUTHORIZED_SCOPE'].includes(input.engineeringMode)) {
    throw new Error('SOURCE_INTAKE_REQUEST_INVALID');
  }
}

function readEnvelope(raw: string | null): IntakeEnvelope {
  let value: unknown;
  try { value = JSON.parse(raw ?? ''); }
  catch { throw new Error('SOURCE_INTAKE_ENVELOPE_CORRUPT'); }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('SOURCE_INTAKE_ENVELOPE_CORRUPT');
  const envelope = value as Record<string, unknown>;
  const authority = envelope.authority;
  if (!authority || typeof authority !== 'object' || Array.isArray(authority))
    throw new Error('SOURCE_INTAKE_ENVELOPE_CORRUPT');
  const bound = authority as Record<string, unknown>;
  if (envelope.schemaVersion !== 'wiselink.document_delivery_intent.v2' ||
    typeof envelope.acquisitionId !== 'string' ||
    !validDelivery(envelope.documentDelivery) ||
    !['DOCUMENT_ONLY', 'AUTHORIZED_SCOPE'].includes(String(envelope.engineeringMode)) ||
    !['VERIFIED_UPLOAD', 'SOURCE_DELEGATION'].includes(String(bound.kind)) ||
    typeof bound.authorityRef !== 'string' ||
    typeof bound.policyRevision !== 'string' ||
    typeof bound.executorPrincipalId !== 'string') {
    throw new Error('SOURCE_INTAKE_ENVELOPE_CORRUPT');
  }
  return value as IntakeEnvelope;
}
