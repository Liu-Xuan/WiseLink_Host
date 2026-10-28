import type { TdmsArtifactSelection } from '@shared/tdms-file-service-import.interface';
import { adaptTdmsDailySource } from './tdms-daily-source-adapter';
import { dailyRequestId } from './tdms-daily-metadata.readback';
import { tdmsUploadPath } from './tdms-file-service-import.validation';
import {
  canonical,
  identifier,
  object,
  strict,
} from './tdms-source.validation';
import { tdmsError } from './tdms-source.types';
import type { TdmsImportMemberClaims, TdmsPublicActor, TdmsSourceScope } from './tdms-source.types';
import type {
  TdmsReceiverAuthority,
  TdmsStoredSelection,
} from './tdms-receiver.types';
import { receiverClaims } from './tdms-receiver-authorization.validation';

export function receiverSelectionPackage(
  requestId: string,
  bindingId: string,
  pkg: unknown,
) {
  dailyRequestId(requestId);
  identifier(bindingId);
  const prepared = adaptTdmsDailySource({ requestId, package: pkg });
  const matches = prepared.envelope.package.artifactBindings.filter(
    (a) => a.bindingId === bindingId,
  );
  if (matches.length !== 1)
    throw tdmsError('TDMS_UPLOAD_SELECTION_BINDING_NOT_FOUND', 404);
  const observation = matches[0]!;
  if (observation.sourceAttachmentId === null)
    throw tdmsError('TDMS_DAILY_ARTIFACT_IDENTITY_UNCONFIRMED', 503);
  const owners = prepared.envelope.package.records.filter(
    (record) => record.snapshotId === observation.ownerSnapshotId,
  );
  if (owners.length !== 1)
    throw tdmsError('TDMS_UPLOAD_ASSOCIATION_INTEGRITY_CONFLICT', 409);
  const ownerRecord: TdmsStoredSelection['ownerRecord'] = {
    snapshotId: owners[0]!.snapshotId,
    recordKind: owners[0]!.kind,
    sourceRecordId: owners[0]!.sourceRecordId,
  };
  return { prepared, observation, ownerRecord,
    memberClaims: receiverSelectionClaims(ownerRecord, observation) };
}

/** The association retains exactly its selected attachment and its actual owner. */
export function receiverSelectionClaims(
  ownerRecord: TdmsStoredSelection['ownerRecord'],
  observation: TdmsStoredSelection['observation'],
): TdmsImportMemberClaims {
  const owner = object(ownerRecord);
  strict(owner, ['snapshotId', 'recordKind', 'sourceRecordId']);
  if (identifier(owner.snapshotId) !== observation.ownerSnapshotId)
    throw tdmsError('TDMS_UPLOAD_ASSOCIATION_INTEGRITY_CONFLICT', 409);
  const record = {
    recordKind: identifier(owner.recordKind),
    sourceRecordId: identifier(owner.sourceRecordId),
  };
  return {
    records: [record],
    artifacts: [{
      memberId: identifier(observation.bindingId),
      sourceAttachmentId: identifier(observation.sourceAttachmentId),
      sourceAttachmentVersion: null,
      owners: [{ ...record }],
    }],
    relationIds: [],
    relatedDocumentVersionIds: [],
  };
}

export function receiverArtifact(
  observation: ReturnType<typeof receiverSelectionPackage>['observation'],
  value: unknown,
): TdmsArtifactSelection {
  const s = object(value);
  strict(s, ['bucketId', 'filePath', 'expectedProviderObjectId']);
  const selection = {
    bucketId: identifier(s.bucketId),
    filePath: tdmsUploadPath(s.filePath),
    expectedProviderObjectId: identifier(s.expectedProviderObjectId),
  };
  if (observation.sourceAttachmentId === null)
    throw tdmsError('TDMS_DAILY_ARTIFACT_IDENTITY_UNCONFIRMED', 503);
  return {
    memberId: observation.bindingId,
    sourceAttachmentId: observation.sourceAttachmentId,
    sourceAttachmentVersion: null,
    fileName: observation.filename,
    mediaType: observation.mediaType,
    sha256: observation.blobSha256,
    byteLength: observation.byteLength,
    ownerItemIds: [observation.ownerSnapshotId],
    selection,
  };
}

/** Reconstruct facts from exact fields; a stored success flag is never an authorization. */
export function checkedReceiverSelection(
  value: TdmsStoredSelection,
  actor: TdmsPublicActor,
  scope: TdmsSourceScope,
  requestId: string,
  bindingId: string,
): TdmsStoredSelection {
  const s = object(value);
  strict(s, [
    'scope',
    'applicationScopeId',
    'actorSubjectId',
    'receiverId',
    'receiverRevision',
    'grantRevision',
    'permissionRevision',
    'payloadDigest',
    'packageId',
    'memberClaims',
    'ownerRecord',
    'observation',
    'artifact',
    'receipt',
  ]);
  const receipt = object(s.receipt);
  const observation = value.observation;
  const expectedArtifact = receiverArtifact(
    observation,
    value.artifact.selection,
  );
  const expectedClaims = receiverSelectionClaims(value.ownerRecord, observation);
  const expectedReceipt = {
    schemaVersion: 'wiselink.tdms-upload-selection-association.v1',
    requestId,
    bindingId,
    receiverId: value.receiverId,
    packageId: value.packageId,
    payloadDigest: value.payloadDigest,
    status: 'STAGED_CANDIDATE',
    selection: expectedArtifact.selection,
    sourceAttachmentId: observation.sourceAttachmentId,
    ownerSnapshotId: observation.ownerSnapshotId,
    sha256: observation.blobSha256,
    byteLength: observation.byteLength,
    readbackVerified: true,
    documentVersionId: null,
  };
  if (
    canonical(value.scope) !== canonical(scope) ||
    value.applicationScopeId !== actor.applicationScopeId ||
    value.actorSubjectId !== actor.canonicalSubject.id ||
    observation.bindingId !== bindingId ||
    canonical(value.artifact) !== canonical(expectedArtifact) ||
    canonical(receipt) !== canonical(expectedReceipt) ||
    canonical(receiverClaims(value.memberClaims)) !== canonical(expectedClaims) ||
    !/^[a-f0-9]{64}$/u.test(value.payloadDigest) ||
    !Number.isSafeInteger(observation.byteLength) ||
    observation.byteLength <= 0 ||
    !/^[a-f0-9]{64}$/u.test(observation.blobSha256) ||
    !Number.isSafeInteger(value.receiverRevision) ||
    value.receiverRevision < 1 ||
    !Number.isSafeInteger(value.grantRevision) ||
    value.grantRevision < 1
  )
    throw tdmsError('TDMS_UPLOAD_ASSOCIATION_INTEGRITY_CONFLICT', 409);
  return value;
}

export function assertReceiverSelectionRevision(
  stored: TdmsStoredSelection,
  current: TdmsReceiverAuthority,
): void {
  if (
    stored.receiverId !== current.row.receiverId ||
    stored.receiverRevision !== current.row.revision ||
    stored.grantRevision !== current.row.grantRevision ||
    stored.permissionRevision !== current.permissionRevision
  )
    throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
}
