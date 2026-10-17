import { createHash } from 'node:crypto';
import type { TdmsReceiverRow } from '../../../server/modules/tdms-source/tdms-receiver.types';
import { adaptTdmsDailySource } from '../../../server/modules/tdms-source/tdms-daily-source-adapter';
import {
  dailyIdentity,
  seal,
  sourceTime,
  syntheticFullDailyEnvelope,
} from './tdms-daily-source.fixture';
import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import { actor } from './tdms-fixtures';

/** All values are synthetic. A partial source and byte candidate, never a real complete sample. */
export function syntheticReceiverFixture() {
  const envelope = syntheticFullDailyEnvelope();
  const bytes = Buffer.from('%PDF-1.7\nsynthetic TDMS candidate only\n');
  const observation = {
    ownerSnapshotId: envelope.package.records[0]!.snapshotId,
    sourceAttachmentId: 'OR:wt.content.ApplicationData:401',
    role: 'primary',
    filename: 'synthetic.pdf',
    mediaType: 'application/pdf',
    blobSha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length,
    sourceVersion: envelope.package.records[0]!.sourceVersion,
    observedAt: sourceTime,
    evidenceLocator: '#synthetic-primary',
  };
  const binding = {
    bindingId: 'TDMSBIND-' + hash(dailyIdentity(observation)),
    ...observation,
  };
  envelope.package.artifactBindings.push(binding);
  seal(envelope);
  const prepared = adaptTdmsDailySource(envelope);
  const now = Date.now(),
    from = new Date(now - 60000).toISOString(),
    until = new Date(now + 3600000).toISOString();
  const actions = Object.fromEntries(
    [
      'IMPORT',
      'CATALOGUE',
      'READ_HISTORY',
      'READ_RECORD',
      'READ_RELATIONS',
    ].map((action) => [
      action,
      {
        allowed: true,
        authorityRef: 'synthetic-source-' + action,
        authorityRevision: 'source-rev-1',
        authorityEvidenceRef: 'synthetic-authority-proof',
        approvedBySubject: 'synthetic-source-approver',
        validFrom: from,
        validUntil: until,
        purpose: 'synthetic-local-acceptance',
        ...(action === 'IMPORT'
          ? { captureRetentionAllowed: true, nativeProjectionAllowed: true }
          : {}),
        ...(['READ_RECORD', 'READ_HISTORY'].includes(action)
          ? { retainedCaptureReadAllowed: true }
          : {}),
        permittedMembers: prepared.memberClaims,
      },
    ]),
  );
  const a = actor();
  const row: TdmsReceiverRow = {
    receiverId: 'synthetic-receiver',
    tenantId: a.tenantId,
    applicationScopeId: a.applicationScopeId,
    sourceKey: 'TDMS',
    sourceInstanceId: 'synthetic-instance',
    scopeId: 'synthetic-scope',
    sourceSubjectNamespace: 'TDMS_SOURCE_SUBJECT',
    sourceSubjectId: 'synthetic-source-user',
    authorityRef: 'synthetic-registration',
    authorityRevision: 'source-registration-1',
    authorityEvidenceRef: 'synthetic-registration-proof',
    approvedBySubject: 'synthetic-source-approver',
    approvedAt: from,
    validFrom: from,
    validUntil: until,
    status: 'ACTIVE',
    revokedAt: null,
    revision: 1,
    actorSubjectId: a.canonicalSubject.id,
    grantSourceSubjectNamespace: 'TDMS_SOURCE_SUBJECT',
    grantSourceSubjectId: 'synthetic-source-user',
    permissionRevision: 'synthetic-permission-1',
    grantAuthorityEvidenceRef: 'synthetic-grant-proof',
    grantApprovedBySubject: 'synthetic-source-approver',
    grantApprovedAt: from,
    grantValidFrom: from,
    grantValidUntil: until,
    grantStatus: 'ACTIVE',
    grantRevokedAt: null,
    grantRevision: 1,
    actions,
  };
  const bucket = 'synthetic-default-bucket';
  const selection = {
    bucketId: bucket,
    filePath:
      'tdms-source/uploads/' + envelope.requestId + '_' + binding.bindingId,
    expectedProviderObjectId: 'synthetic-upload-object-1',
  };
  const objects = new Map<string, { bytes: Buffer; metadata: any }>();
  objects.set(selection.filePath, {
    bytes,
    metadata: {
      bucketID: bucket,
      filePath: selection.filePath,
      id: selection.expectedProviderObjectId,
      name: 'synthetic.pdf',
      createdBy: { userID: a.canonicalSubject.id },
      updatedAt: 'synthetic-audit-time',
      metadata: { mimeType: 'application/pdf', contentLength: bytes.length },
    },
  });
  const activity = {
    uploads: 0,
    downloads: 0,
    acquisitions: 0,
    onDownload: undefined as undefined | (() => Promise<void>),
  };
  const pathKey = (path: string) => path.replace(/^\//u, '');
  const files = {
    getDefaultBucket: async () => bucket,
    from: () => ({
      getFileMetadata: async (path: string) =>
        structuredClone(objects.get(pathKey(path))?.metadata ?? null),
      download: (path: string) => ({
        asStream: async () => {
          activity.downloads++;
          if (activity.onDownload) await activity.onDownload();
          const object = objects.get(pathKey(path));
          if (!object) throw new Error('synthetic missing object');
          return {
            metadata: structuredClone(object.metadata),
            content: Buffer.from(object.bytes),
          };
        },
      }),
      upload: async (
        value: Buffer,
        options: {
          filePath: string;
          fileName: string;
          contentType: string;
          upsert: boolean;
        },
      ) => {
        activity.uploads++;
        if (options.upsert || objects.has(pathKey(options.filePath)))
          throw new Error('synthetic no overwrite');
        const metadata = {
          bucketID: bucket,
          filePath: pathKey(options.filePath),
          id: 'synthetic-candidate-' + activity.uploads,
          name: options.fileName,
          createdBy: { userID: a.canonicalSubject.id },
          metadata: {
            mimeType: options.contentType,
            contentLength: value.length,
          },
        };
        objects.set(metadata.filePath, { metadata, bytes: Buffer.from(value) });
        return metadata;
      },
    }),
  };
  const catalog = {
    readSourceArtifactByContent: async () => null,
    recordAcquisition: async (input: any) => {
      activity.acquisitions++;
      return {
        ...input.acquisition,
        documentVersionId: null,
        status: 'ACQUIRED_READBACK_VERIFIED',
      };
    },
  };
  return {
    envelope,
    prepared,
    row,
    actions,
    selection,
    bytes,
    binding,
    files,
    catalog,
    objects,
    activity,
  };
}
