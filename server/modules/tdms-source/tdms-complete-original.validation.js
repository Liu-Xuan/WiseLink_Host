import {
  assertKeys,
  fail,
  plainData,
  stable,
  COMPLETE_OWN_MODE,
  COMPLETE_PRIMARY_METADATA_REVISION,
} from './tdms-complete-owned-source.validation';
import { nativeOriginalFormat } from './tdms-native-original-formats';

// A source declaration only. The independent FileService resolver and current
// object/byte verification remain mandatory before materialization.
export function completeOriginalMetadata(raw, record) {
  const marker = plainData(raw);
  assertKeys(marker, [
    'contentMode',
    'originalRevision',
    'operationId',
    'ownOperationId',
    'receiptSha256',
    'sourceAttachmentId',
    'bytesSha256',
    'byteLength',
    'mediaType',
  ]);
  const proof = record?.rawFields?.completeOwnedSource;
  const attachments = proof?.reads?.[1]?.attachments;
  const primary = Array.isArray(attachments)
    ? attachments.filter((a) => a?.role === 'PRIMARY' && a.state === 'VALUE')
    : [];
  const metadata = primary[0]?.primaryMetadata;
  const format = nativeOriginalFormat(metadata?.format);
  if (
    marker.contentMode !== COMPLETE_OWN_MODE ||
    marker.originalRevision !== 'tdms-complete-primary-bytes@1' ||
    proof?.mode !== COMPLETE_OWN_MODE ||
    !['SB', 'SIL', 'SB-IN', 'SL', 'MT', 'AD'].includes(proof.scopeId) ||
    !['operationId', 'ownOperationId'].every((k) =>
      /^TDMSOP-[A-F0-9]{8}(?:-[A-F0-9]{4}){3}-[A-F0-9]{12}$/u.test(
        marker[k] || '',
      ),
    ) ||
    !['receiptSha256', 'bytesSha256'].every((k) =>
      /^[a-f0-9]{64}$/u.test(marker[k] || ''),
    ) ||
    !Number.isSafeInteger(marker.byteLength) ||
    marker.byteLength < 1 ||
    marker.byteLength > 100 * 1024 * 1024 ||
    primary.length !== 1 ||
    metadata?.metadataRevision !== COMPLETE_PRIMARY_METADATA_REVISION ||
    metadata.metadataState !== 'VALUE' ||
    metadata.metadataGapCodes?.length !== 0 ||
    metadata.bytesCollected !== false ||
    typeof metadata.filename !== 'string' ||
    !metadata.filename ||
    metadata.filename.length > 200 ||
    /[\\/\0]/u.test(metadata.filename) ||
    !format ||
    format.mediaType !== marker.mediaType ||
    record.sourceVersion?.confirmation !== 'SOURCE_DECLARED' ||
    stable(metadata.ownerTechnicalVersion) !== stable(record.sourceVersion) ||
    stable(metadata.ownerBusinessVersion) !== stable(record.businessVersion) ||
    primary[0].sourceAttachmentId !== marker.sourceAttachmentId ||
    metadata.sourceAttachmentId !== marker.sourceAttachmentId ||
    !/^OR:wt\.content\.ApplicationData:\d{1,24}$/u.test(
      marker.sourceAttachmentId || '',
    )
  )
    fail('TDMS_COMPLETE_ORIGINAL_PACKAGE_MARKER_INVALID');
  return { marker, primary: primary[0], metadata, format };
}

export function validateCompleteOriginalPackageMarker(pkg) {
  if (
    !Array.isArray(pkg.records) ||
    !Array.isArray(pkg.artifactBindings) ||
    pkg.records.length !== 1 ||
    pkg.artifactBindings.length !== 1
  )
    fail('TDMS_COMPLETE_ORIGINAL_PACKAGE_MARKER_INVALID');
  const owner = pkg.records[0],
    binding = pkg.artifactBindings[0];
  assertKeys(binding, [
    'bindingId',
    'ownerSnapshotId',
    'sourceAttachmentId',
    'role',
    'filename',
    'mediaType',
    'blobSha256',
    'byteLength',
    'sourceVersion',
    'observedAt',
    'evidenceLocator',
  ]);
  const { marker, primary } = completeOriginalMetadata(
    pkg.query.originalAcquisition,
    owner,
  );
  if (
    binding.ownerSnapshotId !== owner.snapshotId ||
    binding.sourceAttachmentId !== marker.sourceAttachmentId ||
    binding.filename !== primary.filename ||
    !['primary', 'PRIMARY'].includes(binding.role) ||
    binding.blobSha256 !== marker.bytesSha256 ||
    binding.byteLength !== marker.byteLength ||
    binding.mediaType !== marker.mediaType ||
    stable(binding.sourceVersion) !== stable(owner.sourceVersion)
  )
    fail('TDMS_COMPLETE_ORIGINAL_PACKAGE_MARKER_INVALID');
  return true;
}

export function assertCompleteOriginalNativeArtifacts(pkg) {
  if (!Object.hasOwn(pkg.query || {}, 'originalAcquisition')) return false;
  if (pkg.records.length !== 1)
    fail('TDMS_COMPLETE_ORIGINAL_PACKAGE_MARKER_INVALID');
  const owner = pkg.records[0];
  const { marker, primary } = completeOriginalMetadata(
    pkg.query.originalAcquisition,
    owner,
  );
  // The adapter's first projection has no materialized artifacts. Only the
  // subsequent controlled selection path may attach this exact declaration.
  if (!pkg.artifacts.length && !owner.artifactMemberIds.length) return true;
  const artifact = pkg.artifacts[0];
  if (
    !artifact ||
    Object.hasOwn(artifact, 'bytesBase64') ||
    !artifact.selection ||
    !Array.isArray(artifact.ownerItemIds)
  )
    fail('TDMS_COMPLETE_ORIGINAL_FILE_SELECTION_REQUIRED');
  if (
    pkg.artifacts.length !== 1 ||
    owner.artifactMemberIds.length !== 1 ||
    owner.artifactMemberIds[0] !== artifact.memberId ||
    artifact.sourceAttachmentId !== marker.sourceAttachmentId ||
    artifact.sourceAttachmentVersion !== null ||
    artifact.fileName !== primary.filename ||
    artifact.mediaType !== marker.mediaType ||
    artifact.sha256 !== marker.bytesSha256 ||
    artifact.byteLength !== marker.byteLength ||
    stable(artifact.ownerItemIds) !== stable([owner.itemId])
  )
    fail('TDMS_COMPLETE_ORIGINAL_PACKAGE_MARKER_INVALID');
  return true;
}
