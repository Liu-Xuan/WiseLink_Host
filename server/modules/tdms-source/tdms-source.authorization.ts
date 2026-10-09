import { Injectable } from '@nestjs/common';
import type { TdmsReadContext } from '@shared/tdms-source.interface';
import type {
  TdmsAction,
  TdmsImportAdmission,
  TdmsImportMemberClaims,
  TdmsDocumentAccess,
  TdmsPublicActor,
  TdmsSourceAuthorization,
  TdmsSourceGrant,
  TdmsSourceScope,
} from './tdms-source.types';
import { tdmsError } from './tdms-source.types';

@Injectable()
export class UnconfiguredTdmsSourceAuthorization implements TdmsSourceAuthorization {
  readonly available = false;
  async authorizeImport(): Promise<TdmsImportAdmission> {
    throw tdmsError('TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED', 503);
  }
  async catalogue(): Promise<TdmsSourceGrant[]> {
    return [];
  }
  async authorize(): Promise<TdmsSourceGrant> {
    throw tdmsError('TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED', 503);
  }
}
@Injectable()
export class UnconfiguredTdmsDocumentAccess implements TdmsDocumentAccess {
  async assertRead(): Promise<void> {
    throw tdmsError('TDMS_EXACT_DOCUMENT_ACCESS_UNCONFIGURED', 503);
  }
}
/** A narrow, server-bound decision reader. No env/package ACL fallback and no inferred audience.
 * Binding this adapter requires an actual current Host object/source decision provider. */
export class HostDecisionTdmsSourceAuthorization implements TdmsSourceAuthorization {
  readonly available = true;
  constructor(
    private readonly read: (input: {
      actor: TdmsPublicActor;
      scope?: TdmsSourceScope;
      action: TdmsAction;
      context: TdmsReadContext;
    }) => Promise<TdmsSourceGrant[]>,
    private readonly readImportMembers?: (input: {
      actor: TdmsPublicActor;
      scope: TdmsSourceScope;
      claims: TdmsImportMemberClaims;
      grant: TdmsSourceGrant;
    }) => Promise<TdmsImportAdmission>,
  ) {}
  async authorizeImport(
    actor: TdmsPublicActor,
    scope: TdmsSourceScope,
    claims: TdmsImportMemberClaims,
  ): Promise<TdmsImportAdmission> {
    const grant = await this.authorize(actor, scope, 'IMPORT', {});
    if (!this.readImportMembers)
      throw tdmsError('TDMS_IMPORT_MEMBER_ADMISSION_UNCONFIGURED', 503);
    return this.readImportMembers({ actor, scope, claims, grant });
  }
  async catalogue(actor: TdmsPublicActor, context: TdmsReadContext) {
    return this.read({ actor, action: 'CATALOGUE', context });
  }
  async authorize(
    actor: TdmsPublicActor,
    scope: TdmsSourceScope,
    action: TdmsAction,
    context: TdmsReadContext,
  ) {
    const result = await this.read({ actor, scope, action, context });
    const match = result.find((g) => sameScope(g.scope, scope));
    if (!match || !match.permissionRevision)
      throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
    return match;
  }
}
export function sameScope(a: TdmsSourceScope, b: TdmsSourceScope): boolean {
  return (
    a.tenantId === b.tenantId &&
    a.sourceKey === b.sourceKey &&
    a.sourceInstanceId === b.sourceInstanceId &&
    a.scopeId === b.scopeId
  );
}
export function assertPublicActor(actor: TdmsPublicActor): void {
  if (
    !actor ||
    actor.principalKind !== 'FINAL_USER' ||
    actor.transport !== 'MIAODA_AUTHENTICATED_HTTP' ||
    actor.identityProvenance !== 'MIAODA_GATEWAY_USER_CONTEXT' ||
    actor.canonicalSubject?.namespace !== 'MIAODA_USER_ID' ||
    !actor.canonicalSubject.id ||
    actor.canonicalSubject.id === '-1' ||
    actor.canonicalSubject.id.startsWith('service:') ||
    !actor.tenantId ||
    actor.subjectDecision?.tenantId !== actor.tenantId ||
    actor.applicationScopeId !== actor.subjectDecision.applicationScopeId
  )
    throw tdmsError('TDMS_VERIFIED_PUBLIC_ACTOR_REQUIRED', 401);
}
