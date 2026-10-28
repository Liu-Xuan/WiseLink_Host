import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type {
  TdmsFormalDocumentMapping,
  TdmsFormalDocumentRegistrationReceipt,
} from '@shared/tdms-receiver.interface';
import {
  DocumentManagementHostedService,
  type HostedRequestContext,
} from '../document-management/src/hosted/nest/document-management-hosted.service';
import {
  assertDocumentUploadAuthorityCurrent,
  assertDocumentUploadSourceIdentity,
  mintDocumentUploadAuthority,
  mintTdmsDocumentUploadAuthority,
  type TdmsDocumentUploadBinding,
} from '../document-management/src/hosted/nest/document-upload-authority';
import {
  TdmsReceiverService,
  type TdmsRegistrationSelection,
} from './tdms-receiver.service';
import { currentDocumentSourceReadContext, mintDocumentSourceReadContext } from '../document-management/src/hosted/nest/document-source-read.port';
import { receiverSelectionPackage } from './tdms-receiver-selection.validation';
import { isCompleteOwnedObservedEdge } from './tdms-complete-owned-source.validation';
import { canonical, object, strict } from './tdms-source.validation';
import {
  tdmsError,
  type TdmsFormalRegistrationPort,
  type TdmsPublicActor,
} from './tdms-source.types';

/** A separate ordinary upload. The immutable TDMS association/capture remain candidates. */
@Injectable()
export class TdmsFormalDocumentRegistrationService implements TdmsFormalRegistrationPort {
  constructor(
    private readonly receiver: TdmsReceiverService,
    private readonly documents: DocumentManagementHostedService,
  ) {}

  register(
    request: Request,
    requestId: string,
    bindingId: string,
    body: unknown,
  ) {
    const input = object(body);
    strict(input, ['package']);
    const { prepared, observation } = receiverSelectionPackage(
      requestId,
      bindingId,
      input.package,
    );
    const pkg = prepared.envelope.package;
    const owner = pkg.records[0];
    if (
      pkg.records.length !== 1 ||
      pkg.artifactBindings.length !== 1 ||
      pkg.edges.some((edge) => !isCompleteOwnedObservedEdge(edge, owner)) ||
      !Object.hasOwn(pkg.query, 'originalAcquisition') ||
      owner.kind !== 'MANUFACTURER_FILE' ||
      !['primary', 'PRIMARY'].includes(observation.role) ||
      observation.sourceAttachmentId === null ||
      observation.mediaType !== 'application/pdf' ||
      owner.snapshotId !== observation.ownerSnapshotId
    )
      throw tdmsError('TDMS_FORMAL_PRIMARY_REQUIRED', 400);
    return this.receiver.withRegistrationSelection(
      request,
      requestId,
      bindingId,
      async (selected) => {
        if (
          selected.stored.payloadDigest !== prepared.payloadDigest ||
          canonical(selected.stored.observation) !== canonical(observation)
        )
          throw tdmsError('TDMS_UPLOAD_ASSOCIATION_PACKAGE_CONFLICT', 409);
        const binding: TdmsDocumentUploadBinding = {
          schemaVersion: 'wiselink.tdms-formal-document-binding.v1',
          requestId,
          bindingId,
          payloadDigest: prepared.payloadDigest,
          scope: selected.stored.scope,
          receiverId: selected.stored.receiverId,
          receiverRevision: selected.stored.receiverRevision,
          grantRevision: selected.stored.grantRevision,
          permissionRevision: selected.stored.permissionRevision,
          applicationScopeId: selected.actor.applicationScopeId,
          actorSubjectId: selected.actor.canonicalSubject.id,
          ownerSnapshotId: owner.snapshotId,
          sourceRecordId: owner.sourceRecordId,
          number: owner.number,
          sourceVersion: owner.sourceVersion,
          businessVersion: owner.businessVersion,
          sourceAttachmentId: observation.sourceAttachmentId!,
          sourceAttachmentVersion: null,
          filename: observation.filename,
          mediaType: observation.mediaType,
          sha256: observation.blobSha256,
          byteLength: observation.byteLength,
          selection: selected.stored.artifact.selection,
        };
        const context = this.context(selected.actor, request);
        context.runtimeIngestAuthority = mintTdmsDocumentUploadAuthority(
          context,
          binding,
          selected.checkpoint,
        );
        // No documentDelivery is sent: registration cannot start reading/translation/model work.
        await this.documents.ingestDocumentLibraryUpload(
          this.uploadRequest(selected),
          context,
        );
        const result = await this.readSelected(selected, request);
        if (!result)
          throw tdmsError('TDMS_FORMAL_REGISTRATION_READBACK_MISSING', 409);
        return result;
      },
    );
  }

  read(request: Request, requestId: string, bindingId: string) {
    return this.receiver.withRegistrationSelection(
      request,
      requestId,
      bindingId,
      async (selected) => {
        const result = await this.readSelected(selected, request);
        if (!result)
          throw tdmsError('TDMS_FORMAL_REGISTRATION_UNAVAILABLE', 404);
        return result;
      },
    );
  }

  async project(
    actor: TdmsPublicActor,
    scope: Parameters<TdmsFormalRegistrationPort['project']>[1],
    envelope: Parameters<TdmsFormalRegistrationPort['project']>[2],
    receipt: Parameters<TdmsFormalRegistrationPort['project']>[3],
    read: Parameters<TdmsFormalRegistrationPort['project']>[4],
  ) {
    const projected = structuredClone(receipt);
    const mappings: TdmsFormalDocumentMapping[] = [
      ...projected.documentVersionMappings,
    ];
    for (const [
      index,
      observation,
    ] of envelope.package.artifactBindings.entries()) {
      if (
        !Object.hasOwn(envelope.package.query, 'originalAcquisition') ||
        observation.mediaType !== 'application/pdf' ||
        !read.bindingIds.includes(observation.bindingId)
      )
        continue;
      const selected = await this.receiver.registrationSelection(
        actor,
        scope,
        envelope.requestId,
        observation.bindingId,
        undefined,
        read,
      );
      if (!selected) continue;
      if (
        selected.stored.payloadDigest !== receipt.payloadDigest ||
        canonical(selected.stored.observation) !== canonical(observation)
      )
        throw tdmsError('TDMS_UPLOAD_ASSOCIATION_PACKAGE_CONFLICT', 409);
      const result = await this.readSelected(selected);
      if (result?.status !== 'COMMITTED') continue;
      mappings[index] = {
        requestId: receipt.requestId,
        bindingId: observation.bindingId,
        sourceRef: 'TDMS:ARTIFACT:' + observation.bindingId,
        status: 'COMMITTED',
        documentVersionId: result.documentVersionId,
        preflightId: result.preflightId,
        sha256: result.sha256,
        byteLength: result.byteLength,
        readbackVerified: true,
        mappedAt: result.mappedAt!,
      };
    }
    return { ...projected, documentVersionMappings: mappings };
  }

  private context(actor: TdmsPublicActor, request?: Request): HostedRequestContext {
    const sourceReadContext = request
      ? mintDocumentSourceReadContext(request)
      : currentDocumentSourceReadContext();
    return {
      actorUserId: actor.canonicalSubject.id,
      tenantId: actor.tenantId,
      roles: [...actor.platformRoles],
      appId: actor.applicationScopeId,
      env: actor.env,
      ...(sourceReadContext ? { sourceReadContext } : {}),
    };
  }

  private uploadRequest(selected: TdmsRegistrationSelection) {
    return {
      requestId:
        'tdms-primary-' +
        selected.stored.receipt.requestId.slice('TDMSIMPORT-'.length),
      selection: {
        bucketId: selected.stored.artifact.selection.bucketId,
        filePath: selected.stored.artifact.selection.filePath,
      },
    };
  }

  private async readSelected(
    selected: TdmsRegistrationSelection,
    request?: Request,
  ): Promise<TdmsFormalDocumentRegistrationReceipt | null> {
    await selected.checkpoint();
    const context = this.context(selected.actor, request);
    context.runtimeIngestAuthority = mintDocumentUploadAuthority(context);
    const upload = this.uploadRequest(selected);
    const lineage = await this.documents.readDocumentLibraryUpload(
      upload,
      context,
    );
    await selected.checkpoint();
    if (!lineage) return null; // Only a confirmed missing original lineage is absence.
    const base = {
      schemaVersion: 'wiselink.tdms-formal-document-registration.v1' as const,
      requestId: selected.stored.receipt.requestId,
      bindingId: selected.stored.receipt.bindingId,
      payloadDigest: selected.stored.payloadDigest,
      receiverId: selected.stored.receiverId,
      documentUploadRequestId: upload.requestId,
      sourceAttachmentId: selected.stored.artifact.sourceAttachmentId,
      sourceAttachmentVersion: null,
      documentVersionId: null,
      preflightId:
        typeof lineage.preflightId === 'string' ? lineage.preflightId : null,
      sha256: selected.stored.observation.blobSha256,
      byteLength: selected.stored.observation.byteLength,
      readbackVerified: false,
      mappedAt: null,
    };
    if (lineage.status !== 'COMMITTED') {
      if (
        lineage.status !== 'INCOMPLETE' &&
        lineage.status !== 'PENDING_HISTORICAL_IMPORT'
      )
        throw tdmsError('TDMS_FORMAL_REGISTRATION_LINEAGE_CONFLICT', 409);
      return {
        ...base,
        status:
          lineage.status === 'PENDING_HISTORICAL_IMPORT'
            ? 'REVIEW_REQUIRED'
            : 'PENDING',
      };
    }
    if (
      !lineage.tdmsRegistration ||
      typeof lineage.tdmsRegistration !== 'object' ||
      Array.isArray(lineage.tdmsRegistration)
    )
      throw tdmsError('TDMS_FORMAL_REGISTRATION_LINEAGE_CONFLICT', 409);
    const raw = object(lineage.tdmsRegistration);
    const binding = raw as unknown as TdmsDocumentUploadBinding;
    const stored = selected.stored;
    if (
      binding.schemaVersion !== 'wiselink.tdms-formal-document-binding.v1' ||
      binding.requestId !== base.requestId ||
      binding.bindingId !== base.bindingId ||
      binding.payloadDigest !== base.payloadDigest ||
      binding.receiverId !== stored.receiverId ||
      binding.receiverRevision !== stored.receiverRevision ||
      binding.grantRevision !== stored.grantRevision ||
      binding.permissionRevision !== stored.permissionRevision ||
      canonical(binding.scope) !== canonical(stored.scope) ||
      binding.applicationScopeId !== selected.actor.applicationScopeId ||
      binding.actorSubjectId !== selected.actor.canonicalSubject.id ||
      binding.ownerSnapshotId !== stored.observation.ownerSnapshotId ||
      binding.sourceAttachmentId !== stored.observation.sourceAttachmentId ||
      binding.sourceAttachmentVersion !== null ||
      binding.filename !== stored.observation.filename ||
      binding.mediaType !== stored.observation.mediaType ||
      canonical(binding.sourceVersion) !==
        canonical(stored.observation.sourceVersion) ||
      !stored.memberClaims.records.some(
        (record) => record.sourceRecordId === binding.sourceRecordId,
      ) ||
      canonical(binding.selection) !== canonical(stored.artifact.selection) ||
      binding.sha256 !== base.sha256 ||
      binding.byteLength !== base.byteLength ||
      lineage.sha256 !== base.sha256 ||
      lineage.byteLength !== base.byteLength ||
      lineage.selectionBucketId !== binding.selection.bucketId ||
      lineage.selectionFilePath !== binding.selection.filePath ||
      lineage.selectedProviderObjectId !==
        binding.selection.expectedProviderObjectId ||
      typeof lineage.documentVersionId !== 'string' ||
      !lineage.documentVersionId ||
      typeof lineage.preflightId !== 'string' ||
      !lineage.preflightId ||
      typeof lineage.committedAt !== 'string' ||
      !Number.isFinite(Date.parse(lineage.committedAt)) ||
      lineage.immutableReadbackVerified !== true ||
      lineage.catalogFreshReadVerified !== true
    )
      throw tdmsError('TDMS_FORMAL_REGISTRATION_LINEAGE_CONFLICT', 409);
    context.runtimeIngestAuthority = mintTdmsDocumentUploadAuthority(
      context,
      binding,
      selected.checkpoint,
    );
    const identity = object(lineage.identityReadback);
    assertDocumentUploadSourceIdentity(
      context.runtimeIngestAuthority,
      context,
      {
        documentCode:
          typeof identity.documentNumber === 'string'
            ? identity.documentNumber
            : undefined,
        documentFamily:
          typeof identity.documentFamily === 'string'
            ? identity.documentFamily
            : undefined,
        businessRevision:
          typeof identity.businessRevision === 'string'
            ? identity.businessRevision
            : undefined,
        issuer:
          typeof identity.issuerAuthority === 'string'
            ? identity.issuerAuthority
            : undefined,
      },
    );
    const originalIdentity = await this.documents.readDocumentOriginalIdentity(
      lineage.documentVersionId,
      context,
    );
    if (
      originalIdentity.sha256 !== base.sha256 ||
      originalIdentity.byteLength !== base.byteLength
    )
      throw tdmsError('TDMS_FORMAL_DOCUMENT_SOURCE_CONFLICT', 409);
    const original = await this.documents.readDocumentOriginal(
      lineage.documentVersionId,
      context,
    );
    if (
      original.bytes.length !== base.byteLength ||
      createHash('sha256').update(original.bytes).digest('hex') !== base.sha256
    )
      throw tdmsError('TDMS_FORMAL_DOCUMENT_SOURCE_CONFLICT', 409);
    await assertDocumentUploadAuthorityCurrent(
      context.runtimeIngestAuthority,
      context,
    );
    return {
      ...base,
      status: 'COMMITTED',
      documentVersionId: lineage.documentVersionId,
      preflightId: lineage.preflightId,
      readbackVerified: true,
      mappedAt: lineage.committedAt,
    };
  }
}
