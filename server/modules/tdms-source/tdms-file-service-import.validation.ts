import type {
  TdmsFileServiceImport,
  TdmsArtifactSelection,
} from '@shared/tdms-file-service-import.interface';
import {
  assertOpinionCollectionIngress,
  identifier,
  object,
  sourcePackage,
  strict,
  TDMS_SMALL_PACKAGE_MAX_BYTES,
} from './tdms-source.validation';
import { tdmsError } from './tdms-source.types';
/** Existing FileService reader budget, not a promise about real browser/provider upload capacity. */
export const TDMS_ARTIFACT_READ_MAX_BYTES = 100 * 1024 * 1024;
export function tdmsUploadPath(value: unknown): string {
  const path = identifier(value).replace(/^\//u, '');
  if (
    !/^tdms-source\/uploads\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$/u.test(path)
  )
    throw tdmsError('TDMS_UPLOAD_SELECTION_PATH_INVALID');
  return path;
}
export function fileServiceImport(value: unknown): TdmsFileServiceImport {
  const serialized = JSON.stringify(value);
  if (
    !serialized ||
    Buffer.byteLength(serialized) > TDMS_SMALL_PACKAGE_MAX_BYTES
  )
    throw tdmsError('TDMS_SMALL_PACKAGE_LIMIT');
  const envelope = object(value);
  strict(envelope, [
    'sourceKey',
    'sourceInstanceId',
    'scopeId',
    'package',
    'artifactSelections',
  ]);
  for (const key of ['sourceKey', 'sourceInstanceId', 'scopeId'])
    identifier(envelope[key]);
  const packet = sourcePackage(envelope.package);
  if (
    packet.artifacts.length ||
    packet.records.some((r) => r.artifactMemberIds.length)
  )
    throw tdmsError('TDMS_FILE_SELECTION_INLINE_ARTIFACTS_FORBIDDEN');
  if (
    !Array.isArray(envelope.artifactSelections) ||
    !envelope.artifactSelections.length ||
    envelope.artifactSelections.length > 200
  )
    throw tdmsError('TDMS_FILE_SELECTION_LIST_INVALID');
  const itemIds = new Set(packet.records.map((r) => r.itemId));
  const memberIds = new Set<string>();
  let totalBytes = 0;
  const artifactSelections = envelope.artifactSelections.map(
    (value): TdmsArtifactSelection => {
      const a = object(value);
      strict(a, [
        'memberId',
        'sourceAttachmentId',
        'sourceAttachmentVersion',
        'fileName',
        'mediaType',
        'sha256',
        'byteLength',
        'selection',
        'ownerItemIds',
      ]);
      for (const key of [
        'memberId',
        'sourceAttachmentId',
        'fileName',
        'mediaType',
      ])
        identifier(a[key]);
      const memberId = identifier(a.memberId);
      if (memberIds.has(memberId)) throw tdmsError('TDMS_ARTIFACT_DUPLICATE');
      memberIds.add(memberId);
      if (a.sourceAttachmentVersion !== null)
        identifier(a.sourceAttachmentVersion);
      if (
        typeof a.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(a.sha256) ||
        !Number.isSafeInteger(a.byteLength) ||
        Number(a.byteLength) < 1 ||
        Number(a.byteLength) > TDMS_ARTIFACT_READ_MAX_BYTES
      )
        throw tdmsError('TDMS_FILE_SELECTION_IDENTITY_INVALID');
      totalBytes += Number(a.byteLength);
      if (totalBytes > TDMS_ARTIFACT_READ_MAX_BYTES)
        throw tdmsError('TDMS_FILE_SELECTION_READ_BUDGET');
      if (
        !Array.isArray(a.ownerItemIds) ||
        !a.ownerItemIds.length ||
        a.ownerItemIds.length > 200
      )
        throw tdmsError('TDMS_ARTIFACT_OWNER_INVALID');
      const owners = a.ownerItemIds.map(identifier);
      if (
        new Set(owners).size !== owners.length ||
        owners.some((id) => !itemIds.has(id))
      )
        throw tdmsError('TDMS_ARTIFACT_OWNER_INVALID');
      const selection = object(a.selection);
      strict(selection, ['bucketId', 'filePath', 'expectedProviderObjectId']);
      return {
        ...a,
        ownerItemIds: owners,
        selection: {
          bucketId: identifier(selection.bucketId),
          filePath: tdmsUploadPath(selection.filePath),
          expectedProviderObjectId: identifier(
            selection.expectedProviderObjectId,
          ),
        },
      } as TdmsArtifactSelection;
    },
  );
  assertOpinionCollectionIngress({
    ...packet,
    records: packet.records.map((r) => ({
      ...r,
      artifactMemberIds: artifactSelections
        .filter((a) => a.ownerItemIds.includes(r.itemId))
        .map((a) => a.memberId),
    })),
    artifacts: artifactSelections,
  });
  return {
    sourceKey: String(envelope.sourceKey),
    sourceInstanceId: String(envelope.sourceInstanceId),
    scopeId: String(envelope.scopeId),
    package: packet,
    artifactSelections,
  };
}
