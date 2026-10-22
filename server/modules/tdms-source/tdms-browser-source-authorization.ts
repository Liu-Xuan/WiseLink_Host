import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import type { TdmsReadContext } from '@shared/tdms-source.interface';
import { assertPublicActor, sameScope } from './tdms-source.authorization';
import {
  assertReceiverMembers,
  receiverAuthority,
} from './tdms-receiver-authorization.validation';
import { TdmsReceiverIdentityProfile } from './tdms-receiver-identity-profile';
import { TdmsRuntimeReceiverRepository } from './tdms-runtime-receiver.repository';
import { MiaodaTdmsDocumentAccess } from './miaoda-tdms-document-access';
import type { TdmsReceiverAuthority } from './tdms-receiver.types';
import {
  tdmsError,
  type TdmsAction,
  type TdmsImportAdmission,
  type TdmsImportMemberClaims,
  type TdmsPublicActor,
  type TdmsReadMemberAdmission,
  type TdmsSourceAuthorization,
  type TdmsSourceGrant,
  type TdmsSourceScope,
} from './tdms-source.types';

/** Browser reads reuse current controlled Source decisions; this adapter issues no imports or grants. */
@Injectable()
export class TdmsBrowserSourceAuthorization implements TdmsSourceAuthorization {
  readonly available = true;
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly database: PostgresJsDatabase,
    private readonly profile: TdmsReceiverIdentityProfile,
    private readonly documents: MiaodaTdmsDocumentAccess,
  ) {}

  async authorizeImport(): Promise<TdmsImportAdmission> {
    throw tdmsError('TDMS_BROWSER_SOURCE_IMPORT_UNCONFIGURED', 503);
  }
  async catalogue(
    actor: TdmsPublicActor,
    context: TdmsReadContext,
  ): Promise<TdmsSourceGrant[]> {
    return this.read(actor, undefined, 'CATALOGUE', context);
  }
  async authorize(
    actor: TdmsPublicActor,
    scope: TdmsSourceScope,
    action: TdmsAction,
    context: TdmsReadContext,
  ): Promise<TdmsSourceGrant> {
    const grants = await this.read(actor, scope, action, context);
    if (grants.length !== 1) throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
    return grants[0]!;
  }
  async authorizeReadMembers(
    actor: TdmsPublicActor,
    scope: TdmsSourceScope,
    action: 'READ_RECORD' | 'READ_HISTORY',
    claims: TdmsImportMemberClaims,
  ): Promise<TdmsReadMemberAdmission> {
    const decisions = await this.decisions(actor, scope, action, {});
    if (decisions.length !== 1) throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
    const decision = decisions[0]!;
    assertReceiverMembers(claims, decision.decision.permittedMembers);
    return {
      ...this.grant(decision),
      authorityRef: decision.decision.authorityRef,
      retainedCaptureReadAllowed: true,
      permittedMembers: structuredClone(decision.decision.permittedMembers),
    };
  }
  private async read(
    actor: TdmsPublicActor,
    scope: TdmsSourceScope | undefined,
    action: TdmsAction,
    context: TdmsReadContext,
  ): Promise<TdmsSourceGrant[]> {
    return (await this.decisions(actor, scope, action, context)).map(
      (decision) => this.grant(decision),
    );
  }
  private grant(decision: TdmsReceiverAuthority): TdmsSourceGrant {
    return {
      scope: decision.scope,
      permissionRevision: decision.permissionRevision,
      permittedMembers: structuredClone(decision.decision.permittedMembers),
      validUntil: new Date(
        Math.min(
          ...[
            decision.row.validUntil,
            decision.row.grantValidUntil,
            decision.decision.validUntil,
          ].map((value) => Date.parse(value)),
        ),
      ).toISOString(),
    };
  }
  private async decisions(
    actor: TdmsPublicActor,
    scope: TdmsSourceScope | undefined,
    action: TdmsAction,
    context: TdmsReadContext,
  ): Promise<TdmsReceiverAuthority[]> {
    assertPublicActor(actor);
    if (action === 'IMPORT')
      throw tdmsError('TDMS_BROWSER_SOURCE_IMPORT_UNCONFIGURED', 503);
    if (context.matterId || context.workItemId || context.jobAidAttemptRef)
      throw tdmsError('TDMS_BROWSER_SOURCE_OBJECT_CONTEXT_UNCONFIGURED', 503);
    if (scope && scope.tenantId !== actor.tenantId)
      throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
    if (context.documentVersionId)
      await this.documents.assertRead(actor, context.documentVersionId);
    const decisions = await this.database.transaction(async (database) => {
      const [identity] = await database.execute<{ roleName: string }>(
        sql`SELECT current_user AS "roleName"`,
      );
      if (identity?.roleName !== 'authenticated_workspace_aadkpkjef3slu')
        throw tdmsError('TDMS_BROWSER_AUTHENTICATED_DATABASE_REQUIRED', 401);
      const repository = new TdmsRuntimeReceiverRepository(
        database as PostgresJsDatabase,
        this.profile,
      );
      const rows = await repository.authorities(actor, scope);
      const selected: TdmsReceiverAuthority[] = [];
      for (const row of rows) {
        const initial = receiverAuthority(row, actor, action);
        if (!initial) continue;
        // Catalogue discovery is not authority: take the same scoped lock and reread.
        const current = scope
          ? [row]
          : await repository.authorities(actor, initial.scope);
        const matches = current
          .map((value) => receiverAuthority(value, actor, action))
          .filter((value): value is TdmsReceiverAuthority => value !== null);
        if (
          matches.length !== 1 ||
          !sameScope(matches[0]!.scope, initial.scope)
        )
          throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
        if (selected.some((value) => sameScope(value.scope, initial.scope)))
          throw tdmsError('TDMS_SOURCE_SCOPE_AMBIGUOUS', 409);
        selected.push(matches[0]!);
      }
      // Locks cannot extend time-bounded grants.
      for (const selectedDecision of selected)
        if (!receiverAuthority(selectedDecision.row, actor, action))
          throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
      return selected;
    });
    if (context.documentVersionId)
      await this.documents.assertRead(actor, context.documentVersionId);
    // The object-policy wait can outlast the Source grant.
    for (const decision of decisions)
      if (!receiverAuthority(decision.row, actor, action))
        throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
    return decisions;
  }
}
