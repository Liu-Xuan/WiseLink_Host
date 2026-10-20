import { assertProductionMiaodaBrowserIdentityAvailable } from '../../../../work-item/production-miaoda-browser-ingress';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type { TdmsSourceVersion } from '@shared/tdms-source.interface';

export interface DocumentUploadAuthority {
  readonly mode: 'HOSTED_MIAODA_DOCUMENT_UPLOAD';
  readonly actorUserId: string;
  readonly tenantId: string;
  readonly appId: string;
  readonly identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT';
  readonly sessionProvenance: 'MIAODA_AUTHENTICATED_HTTP';
}

const minted = new WeakSet<object>();
type UploadActor = { actorUserId: string; tenantId: string };

/** Observed Source pins, never a grant or caller-supplied document identity. */
export interface TdmsDocumentUploadBinding {
  schemaVersion: 'wiselink.tdms-formal-document-binding.v1';
  requestId: string;
  bindingId: string;
  payloadDigest: string;
  scope: {
    tenantId: string;
    sourceKey: string;
    sourceInstanceId: string;
    scopeId: string;
  };
  receiverId: string;
  receiverRevision: number;
  grantRevision: number;
  permissionRevision: string;
  applicationScopeId: string;
  actorSubjectId: string;
  ownerSnapshotId: string;
  sourceRecordId: string;
  number: string;
  sourceVersion: TdmsSourceVersion;
  businessVersion: TdmsSourceVersion | null;
  sourceAttachmentId: string;
  sourceAttachmentVersion: null;
  filename: string;
  mediaType: string;
  sha256: string;
  byteLength: number;
  selection: {
    bucketId: string;
    filePath: string;
    expectedProviderObjectId: string;
  };
}

const sourceUploads = new WeakMap<
  object,
  {
    binding: TdmsDocumentUploadBinding;
    checkpoint: (database?: PostgresJsDatabase) => Promise<void>;
  }
>();

/** Only a server caller which has checked the retained association can mint this scope. */
export function mintTdmsDocumentUploadAuthority(
  context: Parameters<typeof mintDocumentUploadAuthority>[0],
  binding: TdmsDocumentUploadBinding,
  checkpoint: (database?: PostgresJsDatabase) => Promise<void>,
): DocumentUploadAuthority {
  const authority = mintDocumentUploadAuthority(context);
  if (
    binding.scope.tenantId !== context.tenantId ||
    binding.actorSubjectId !== context.actorUserId ||
    binding.applicationScopeId !== context.appId ||
    binding.mediaType !== 'application/pdf' ||
    !/\.pdf$/iu.test(binding.filename) ||
    /[\\/\0]/u.test(binding.filename) ||
    !/^[a-f0-9]{64}$/u.test(binding.sha256) ||
    !Number.isSafeInteger(binding.byteLength) ||
    binding.byteLength < 1
  )
    throw Object.assign(new Error('TDMS formal upload scope is invalid.'), {
      code: 'TDMS_FORMAL_UPLOAD_SCOPE_INVALID',
      statusCode: 409,
    });
  sourceUploads.set(authority, {
    binding: structuredClone(binding),
    checkpoint,
  });
  return authority;
}

export function tdmsDocumentUploadBinding(
  value: unknown,
  actor: UploadActor,
): TdmsDocumentUploadBinding | null {
  if (!isMintedDocumentUploadAuthority(value, actor)) return null;
  const source = sourceUploads.get(value);
  return source ? structuredClone(source.binding) : null;
}

/** The same callback is checked inside the actual Catalog commit transaction. */
export async function assertDocumentUploadAuthorityCurrent(
  value: unknown,
  actor: UploadActor,
  database?: PostgresJsDatabase,
): Promise<void> {
  if (!isMintedDocumentUploadAuthority(value, actor))
    throw Object.assign(
      new Error('Document upload authority is unavailable.'),
      { code: 'DOCUMENT_ACTION_FORBIDDEN', statusCode: 403 },
    );
  await sourceUploads.get(value)?.checkpoint(database);
}

/** Compare the DM-owned actual PDF observation before creating/linking a DVI. */
export function assertDocumentUploadSourceIdentity(
  authority: unknown,
  actor: UploadActor,
  identity: {
    documentCode?: string;
    documentFamily?: string;
    businessRevision?: string;
    issuer?: string;
  },
): void {
  const binding = tdmsDocumentUploadBinding(authority, actor);
  if (!binding) return;
  const business = binding.businessVersion;
  const exactBusiness =
    business?.confirmation === 'SOURCE_DECLARED' &&
    business.rawIteration === null;
  const comacSl =
    identity.issuer === 'COMAC' &&
    identity.documentFamily === 'SL' &&
    /^SL-\d{2}-\d{4}$/u.test(identity.documentCode ?? '') &&
    /^R\d{2}$/u.test(identity.businessRevision ?? '') &&
    binding.number ===
      `${identity.documentCode}-${identity.businessRevision}` &&
    exactBusiness &&
    identity.businessRevision === `R${business.rawRevision}`;
  const exact =
    binding.number === identity.documentCode &&
    exactBusiness &&
    business.rawRevision === identity.businessRevision;
  if (!comacSl && !exact)
    throw Object.assign(
      new Error(
        'Actual PDF identity does not match the selected Source owner/business version.',
      ),
      {
        code: 'TDMS_FORMAL_DOCUMENT_IDENTITY_CONFLICT',
        statusCode: 409,
      },
    );
}

/** Process-local capability; a copied request object cannot recreate its authority. */
export function mintDocumentUploadAuthority(context: {
  actorUserId: string;
  tenantId: string;
  appId: string;
  env: string;
}): DocumentUploadAuthority {
  assertProductionMiaodaBrowserIdentityAvailable({
    userId: context.actorUserId,
    tenantId: context.tenantId,
    appId: context.appId,
    env: context.env,
  });
  const authority: DocumentUploadAuthority = Object.freeze({
    mode: 'HOSTED_MIAODA_DOCUMENT_UPLOAD',
    actorUserId: context.actorUserId,
    tenantId: context.tenantId,
    appId: context.appId,
    identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
    sessionProvenance: 'MIAODA_AUTHENTICATED_HTTP',
  });
  minted.add(authority);
  return authority;
}

export function isMintedDocumentUploadAuthority(
  value: unknown,
  actor: {
    actorUserId: string;
    tenantId: string;
  },
): value is DocumentUploadAuthority {
  if (!value || typeof value !== 'object' || !minted.has(value)) return false;
  const authority = value as DocumentUploadAuthority;
  return (
    authority.actorUserId === actor.actorUserId &&
    authority.tenantId === actor.tenantId
  );
}
