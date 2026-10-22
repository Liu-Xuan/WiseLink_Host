import { assertProductionMiaodaBrowserIdentityAvailable } from '../../../../work-item/production-miaoda-browser-ingress';

export interface DocumentUploadAuthority {
  readonly mode: 'HOSTED_MIAODA_DOCUMENT_UPLOAD';
  readonly actorUserId: string;
  readonly tenantId: string;
  readonly appId: string;
  readonly identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT';
  readonly sessionProvenance: 'MIAODA_AUTHENTICATED_HTTP';
}

const minted = new WeakSet<object>();

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
