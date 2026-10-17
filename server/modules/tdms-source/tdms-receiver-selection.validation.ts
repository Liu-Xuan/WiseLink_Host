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
import type { TdmsPublicActor, TdmsSourceScope } from './tdms-source.types';
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
  return { prepared, observation };
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
  receiverClaims(value.memberClaims);
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
