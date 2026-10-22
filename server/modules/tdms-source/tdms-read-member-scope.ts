import { sourceBodyReadingProjection } from './tdms-assessment-body-policy';
import type { TdmsRecordSummary } from '@shared/tdms-source.interface';
import { assertReceiverMembers } from './tdms-receiver-authorization.validation';
import {
  tdmsError,
  type TdmsSourceGrant,
  type TdmsStoredRevision,
} from './tdms-source.types';

/** A scope-only provider remains scope-wide. Receiver providers always return bounded members. */
export function assertReadRecordMember(
  grant: TdmsSourceGrant,
  record: TdmsRecordSummary,
): void {
  if (grant.permittedMembers === undefined) return;
  assertReceiverMembers(
    {
      records: [
        {
          recordKind: record.recordKind,
          sourceRecordId: record.sourceRecordId,
        },
      ],
      artifacts: [],
      relationIds: [],
    },
    grant.permittedMembers,
  );
}

export function assertReadStoredMembers(
  grant: TdmsSourceGrant,
  stored: TdmsStoredRevision,
): void {
  assertReadRecordMember(grant, stored.record);
  if (
    grant.permittedMembers === undefined ||
    sourceBodyReadingProjection(stored.record).bodyReadPolicy.kind ===
      'METADATA_ONLY'
  )
    return;
  const owner = {
    recordKind: stored.record.recordKind,
    sourceRecordId: stored.record.sourceRecordId,
  };
  const artifacts = stored.record.artifacts.map((binding) => {
    const identity = stored.artifactIdentities?.find(
      (item) => item.memberId === binding.memberId,
    );
    if (
      !identity ||
      identity.sha256 !== binding.sha256 ||
      identity.byteLength !== binding.byteLength
    )
      throw tdmsError('TDMS_READ_ARTIFACT_IDENTITY_UNAVAILABLE', 503);
    return {
      memberId: identity.memberId,
      sourceAttachmentId: identity.sourceAttachmentId,
      sourceAttachmentVersion: identity.sourceAttachmentVersion,
      owners: [owner],
    };
  });
  // Acquisitions are only returned alongside the exact controlled binding checked above.
  if (
    stored.attachmentAcquisitions?.some(
      (fact) =>
        !stored.record.artifacts.some(
          (binding) =>
            binding.memberId === fact.memberId &&
            binding.acquisitionId === fact.acquisitionId &&
            stored.artifactIdentities?.some(
              (identity) =>
                identity.memberId === fact.memberId &&
                identity.sourceAttachmentId === fact.sourceAttachmentId &&
                identity.sourceAttachmentVersion ===
                  fact.sourceAttachmentVersion,
            ),
        ),
    )
  )
    throw tdmsError('TDMS_READ_ARTIFACT_IDENTITY_UNAVAILABLE', 503);
  assertReceiverMembers(
    { records: [owner], artifacts, relationIds: [] },
    grant.permittedMembers,
  );
}

export function assertReadRelationMember(
  grant: TdmsSourceGrant,
  sourceRelationId: string,
): void {
  if (grant.permittedMembers === undefined) return;
  assertReceiverMembers(
    { records: [], artifacts: [], relationIds: [sourceRelationId] },
    grant.permittedMembers,
  );
}

export function assertReadGrantsCurrent(
  grants: readonly TdmsSourceGrant[],
): void {
  const now = Date.now();
  for (const grant of grants) {
    if (grant.validUntil === undefined) continue;
    if (
      !Number.isFinite(Date.parse(grant.validUntil)) ||
      Date.parse(grant.validUntil) <= now
    )
      throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
  }
}
