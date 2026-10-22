import {
  canonical,
  identifier,
  object,
  strict,
} from './tdms-source.validation';
import {
  assertTdmsSourceActor,
  type TdmsSourceActor,
} from './tdms-runtime-delegation';
import { tdmsError } from './tdms-source.types';
import type { TdmsAction, TdmsImportMemberClaims } from './tdms-source.types';
import type {
  TdmsReceiverAction,
  TdmsReceiverAuthority,
  TdmsReceiverRow,
} from './tdms-receiver.types';

const ACTIONS: TdmsAction[] = [
  'IMPORT',
  'CATALOGUE',
  'READ_HISTORY',
  'READ_RECORD',
  'READ_RELATIONS',
];

export function receiverClaims(value: unknown): TdmsImportMemberClaims {
  const input = object(value);
  strict(input, [
    'records',
    'artifacts',
    'relationIds',
    'relatedDocumentVersionIds',
  ]);
  if (
    !Array.isArray(input.records) ||
    !Array.isArray(input.artifacts) ||
    !Array.isArray(input.relationIds) ||
    input.records.length > 10000 ||
    input.artifacts.length > 10000 ||
    input.relationIds.length > 10000 ||
    (input.relatedDocumentVersionIds !== undefined &&
      (!Array.isArray(input.relatedDocumentVersionIds) ||
        input.relatedDocumentVersionIds.length))
  )
    throw tdmsError('TDMS_RECEIVER_MEMBER_CONFIGURATION_INVALID', 503);
  const records = input.records.map((value: unknown) => {
    const row = object(value);
    strict(row, ['recordKind', 'sourceRecordId']);
    return {
      recordKind: identifier(row.recordKind),
      sourceRecordId: identifier(row.sourceRecordId),
    };
  });
  const artifacts = input.artifacts.map((value: unknown) => {
    const row = object(value);
    strict(row, [
      'memberId',
      'sourceAttachmentId',
      'sourceAttachmentVersion',
      'metadataOnly',
      'owners',
    ]);
    if (
      !Array.isArray(row.owners) ||
      !row.owners.length ||
      (row.metadataOnly !== undefined && row.metadataOnly !== true)
    )
      throw tdmsError('TDMS_RECEIVER_MEMBER_CONFIGURATION_INVALID', 503);
    const owners = row.owners.map((value: unknown) => {
      const owner = object(value);
      strict(owner, ['recordKind', 'sourceRecordId']);
      return {
        recordKind: identifier(owner.recordKind),
        sourceRecordId: identifier(owner.sourceRecordId),
      };
    });
    if (
      owners.length > 10000 ||
      new Set(owners.map(canonical)).size !== owners.length
    )
      throw tdmsError('TDMS_RECEIVER_MEMBER_CONFIGURATION_INVALID', 503);
    return {
      memberId: identifier(row.memberId),
      sourceAttachmentId:
        row.sourceAttachmentId === null
          ? null
          : identifier(row.sourceAttachmentId),
      sourceAttachmentVersion:
        row.sourceAttachmentVersion === null
          ? null
          : identifier(row.sourceAttachmentVersion),
      ...(row.metadataOnly === true ? { metadataOnly: true as const } : {}),
      owners,
    };
  });
  const relationIds = input.relationIds.map(identifier);
  for (const list of [records, artifacts, relationIds])
    if (new Set(list.map(canonical)).size !== list.length)
      throw tdmsError('TDMS_RECEIVER_MEMBER_CONFIGURATION_INVALID', 503);
  return {
    records,
    artifacts,
    relationIds,
    ...(input.relatedDocumentVersionIds === undefined
      ? {}
      : { relatedDocumentVersionIds: [] }),
  };
}

export function assertReceiverMembers(
  requested: TdmsImportMemberClaims,
  permitted: TdmsImportMemberClaims,
): void {
  const claims = receiverClaims(requested);
  const approved = receiverClaims(permitted);
  for (const key of ['records', 'relationIds'] as const) {
    const allowed = new Set(approved[key].map(canonical));
    if (claims[key].some((value) => !allowed.has(canonical(value))))
      throw tdmsError('TDMS_RECEIVER_EXACT_MEMBER_DENIED', 403);
  }
  for (const artifact of claims.artifacts) {
    const { owners, ...identity } = artifact;
    if (
      !approved.artifacts.some(
        ({ owners: allowedOwners, ...allowedIdentity }) =>
          canonical(identity) === canonical(allowedIdentity) &&
          owners.every((owner) =>
            allowedOwners.some(
              (allowed) => canonical(allowed) === canonical(owner),
            ),
          ),
      )
    )
      throw tdmsError('TDMS_RECEIVER_EXACT_MEMBER_DENIED', 403);
  }
}

function currentWindow(from: unknown, until: unknown, now: number): boolean {
  return (
    typeof from === 'string' &&
    typeof until === 'string' &&
    Number.isFinite(Date.parse(from)) &&
    Number.isFinite(Date.parse(until)) &&
    Date.parse(from) <= now &&
    Date.parse(until) > now
  );
}

/** All values originate in the controlled DB tables, never the imported package. */
export function receiverAuthority(
  row: TdmsReceiverRow,
  actor: TdmsSourceActor,
  action: TdmsAction,
  now = Date.now(),
): TdmsReceiverAuthority | null {
  assertTdmsSourceActor(actor);
  if (
    !ACTIONS.includes(action) ||
    row.tenantId !== actor.tenantId ||
    row.applicationScopeId !== actor.applicationScopeId ||
    row.actorSubjectId !== actor.canonicalSubject.id ||
    row.sourceKey !== 'TDMS' ||
    row.status !== 'ACTIVE' ||
    row.grantStatus !== 'ACTIVE' ||
    row.revokedAt !== null ||
    row.grantRevokedAt !== null ||
    !currentWindow(row.validFrom, row.validUntil, now) ||
    !currentWindow(row.grantValidFrom, row.grantValidUntil, now) ||
    row.sourceSubjectNamespace !== row.grantSourceSubjectNamespace ||
    row.sourceSubjectId !== row.grantSourceSubjectId
  )
    return null;
  for (const value of [
    row.receiverId,
    row.sourceInstanceId,
    row.scopeId,
    row.sourceSubjectNamespace,
    row.sourceSubjectId,
    row.authorityRef,
    row.authorityRevision,
    row.authorityEvidenceRef,
    row.approvedBySubject,
    row.permissionRevision,
    row.grantAuthorityEvidenceRef,
    row.grantApprovedBySubject,
  ])
    identifier(value);
  if (
    ![row.revision, row.grantRevision].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    !Number.isFinite(Date.parse(row.approvedAt)) ||
    Date.parse(row.approvedAt) > now ||
    !Number.isFinite(Date.parse(row.grantApprovedAt)) ||
    Date.parse(row.grantApprovedAt) > now
  )
    throw tdmsError('TDMS_RECEIVER_AUTHORITY_CONFIGURATION_INVALID', 503);
  const actions = object(row.actions);
  strict(actions, ACTIONS);
  if (!Object.hasOwn(actions, action)) return null;
  const value = object(actions[action]);
  strict(value, [
    'allowed',
    'authorityRef',
    'authorityRevision',
    'authorityEvidenceRef',
    'approvedBySubject',
    'validFrom',
    'validUntil',
    'purpose',
    'captureRetentionAllowed',
    'nativeProjectionAllowed',
    'retainedCaptureReadAllowed',
    'permittedMembers',
  ]);
  if (
    value.allowed !== true ||
    !currentWindow(value.validFrom, value.validUntil, now)
  )
    return null;
  for (const key of [
    'authorityRef',
    'authorityRevision',
    'authorityEvidenceRef',
    'approvedBySubject',
    'purpose',
  ])
    identifier(value[key]);
  if (
    action === 'IMPORT' &&
    (value.captureRetentionAllowed !== true ||
      value.nativeProjectionAllowed !== true)
  )
    return null;
  if (
    ['READ_RECORD', 'READ_HISTORY'].includes(action) &&
    value.retainedCaptureReadAllowed !== true
  )
    return null;
  const permittedMembers = receiverClaims(value.permittedMembers);
  const permissionRevision = canonical([
    'tdms-receiver-v1',
    row.receiverId,
    row.revision,
    row.authorityRevision,
    row.grantRevision,
    row.permissionRevision,
  ]);
  if (permissionRevision.length > 500)
    throw tdmsError('TDMS_RECEIVER_AUTHORITY_CONFIGURATION_INVALID', 503);
  return {
    row,
    action,
    scope: {
      tenantId: row.tenantId,
      sourceKey: 'TDMS',
      sourceInstanceId: row.sourceInstanceId,
      scopeId: row.scopeId,
    },
    permissionRevision,
    decision: { ...value, permittedMembers } as unknown as TdmsReceiverAction,
  };
}
