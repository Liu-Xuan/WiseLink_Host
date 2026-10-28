import { Injectable } from '@nestjs/common';
import {
  documentSourceReadRequest,
  type DocumentSourceReadInput,
  type DocumentSourceReadPort,
} from '../document-management/src/hosted/nest/document-source-read.port';
import type { TdmsDocumentUploadBinding } from '../document-management/src/hosted/nest/document-upload-authority';
import {
  SessionResolver,
  type ResolvedSession,
} from '../identity/session-resolver.service';
import { MiaodaTdmsSourceAuthorization } from './miaoda-tdms-source-authorization';
import { TdmsReceiverRepository } from './tdms-receiver.repository';
import { assertReadGrantsCurrent } from './tdms-read-member-scope';
import { assertPublicActor } from './tdms-source.authorization';
import {
  tdmsError,
  type TdmsImportMemberClaims,
  type TdmsPublicActor,
  type TdmsSourceGrant,
} from './tdms-source.types';

/** Current Source read rights for the real reader; historical upload pins are facts only. */
@Injectable()
export class TdmsDocumentSourceReadAdapter implements DocumentSourceReadPort {
  constructor(
    private readonly sessions: SessionResolver,
    private readonly receivers: TdmsReceiverRepository,
    private readonly authorization: MiaodaTdmsSourceAuthorization,
  ) {}

  async assertCurrent(input: DocumentSourceReadInput): Promise<void> {
    const provenance = input.provenance;
    if (
      !provenance ||
      provenance.documentVersionId !== input.documentVersionId ||
      !provenance.sourceArtifactId ||
      !/^[a-f0-9]{64}$/u.test(provenance.sha256) ||
      !Number.isSafeInteger(provenance.byteLength) ||
      provenance.byteLength < 1 ||
      typeof provenance.independentOrdinary !== 'boolean' ||
      !Array.isArray(provenance.sourceBindings)
    )
      throw tdmsError('DOCUMENT_SOURCE_READ_PROVENANCE_INVALID', 409);
    // The ordinary authorizer still checks the independent ordinary read path.
    if (provenance.independentOrdinary) return;
    if (!provenance.sourceBindings.length)
      throw tdmsError('DOCUMENT_SOURCE_READ_PROVENANCE_INVALID', 409);
    const request = documentSourceReadRequest(input.sourceReadContext);
    if (!request)
      throw tdmsError('DOCUMENT_SOURCE_READ_CONTEXT_REQUIRED', 403);
    const bindings = structuredClone(provenance.sourceBindings);
    await this.sessions.withNativeBrowserIdentity(request, async (identity) => {
      assertPublicActor(identity.actor);
      assertReader(input, identity.actor, identity.oauthSession);
      const admittedSession = identity.oauthSession;
      const grants = await this.sessions.withVerifiedNativeBrowserSql(() =>
        this.receivers.transaction(async (database) => {
          const current = await this.sessions.resolve(request, database);
          assertReader(input, identity.actor, current, admittedSession);
          for (const binding of bindings)
            assertBinding(input, binding, identity.actor);
          let authorized = false;
          const checkedGrants: TdmsSourceGrant[] = [];
          let lastDenial: unknown;
          for (const binding of bindings) {
            try {
              const admitted = await this.authorization.authorizeReadMembers(
                identity.actor,
                binding.scope,
                'READ_RECORD',
                exactClaims(binding),
              );
              assertReader(input, this.sessions.nativeBrowserIdentity(request).actor,
                await this.sessions.resolve(request, database), admittedSession);
              const current = await this.authorization.authorizeReadMembers(
                identity.actor, binding.scope, 'READ_RECORD', exactClaims(binding));
              if (current.permissionRevision !== admitted.permissionRevision ||
                  current.authorityRef !== admitted.authorityRef)
                throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
              assertReadGrantsCurrent([admitted, current]);
              checkedGrants.push(admitted, current);
              authorized = true;
              break;
            } catch (error: unknown) {
              if (!alternativeSourceDenial(error)) throw error;
              lastDenial = error;
            }
          }
          if (!authorized) throw lastDenial;
          // Revocation/expiry during the authorization work is not a successful check.
          assertReader(
            input,
            this.sessions.nativeBrowserIdentity(request).actor,
            await this.sessions.resolve(request, database),
            admittedSession,
          );
          assertReadGrantsCurrent(checkedGrants);
          return checkedGrants;
        }),
      );
      // A commit/SQL-context wait cannot extend the deadlines already checked.
      assertReader(input, this.sessions.nativeBrowserIdentity(request).actor,
        admittedSession, admittedSession);
      assertReadGrantsCurrent(grants);
    });
  }
}

/** Only an explicit denial of this path permits checking another verified path. */
function alternativeSourceDenial(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const failure = error as { code?: unknown; statusCode?: unknown };
  return (
    (failure.code === 'TDMS_SOURCE_NOT_FOUND' && failure.statusCode === 404) ||
    (failure.code === 'TDMS_RECEIVER_EXACT_MEMBER_DENIED' &&
      failure.statusCode === 403)
  );
}

function assertReader(
  input: DocumentSourceReadInput,
  gateway: TdmsPublicActor,
  session: ResolvedSession | null,
  admitted?: ResolvedSession | null,
): void {
  if ((session && session.session.expiresAt.getTime() <= Date.now()) ||
      (admitted && !session))
    throw tdmsError('DOCUMENT_SOURCE_READ_SESSION_REQUIRED', 401);
  if (
    gateway.canonicalSubject.id !== input.actorUserId ||
    gateway.tenantId !== input.tenantId ||
    (session && (session.actor.canonicalSubject.id !== gateway.canonicalSubject.id ||
      session.actor.tenantId !== gateway.tenantId ||
      session.actor.applicationScopeId !== gateway.applicationScopeId)) ||
    (admitted === null && session !== null) ||
    (admitted && session &&
      (session.session.id !== admitted.session.id ||
        session.session.revision !== admitted.session.revision))
  )
    throw tdmsError('DOCUMENT_SOURCE_READ_IDENTITY_MISMATCH', 403);
}

function assertBinding(
  input: DocumentSourceReadInput,
  binding: TdmsDocumentUploadBinding,
  reader: TdmsPublicActor,
): void {
  if (
    !binding ||
    !binding.scope ||
    binding.schemaVersion !== 'wiselink.tdms-formal-document-binding.v1' ||
    binding.scope.tenantId !== input.tenantId ||
    binding.scope.sourceKey !== 'TDMS' ||
    !binding.scope.sourceInstanceId ||
    !binding.scope.scopeId ||
    binding.applicationScopeId !== reader.applicationScopeId ||
    binding.sha256 !== input.provenance.sha256 ||
    binding.byteLength !== input.provenance.byteLength ||
    binding.mediaType !== 'application/pdf' ||
    !binding.sourceRecordId ||
    !binding.bindingId ||
    !binding.sourceAttachmentId ||
    binding.sourceAttachmentVersion !== null
  )
    throw tdmsError('DOCUMENT_SOURCE_READ_PROVENANCE_INVALID', 409);
}

function exactClaims(
  binding: TdmsDocumentUploadBinding,
): TdmsImportMemberClaims {
  const owner = {
    recordKind: 'MANUFACTURER_FILE',
    sourceRecordId: binding.sourceRecordId,
  };
  return {
    records: [owner],
    artifacts: [
      {
        memberId: binding.bindingId,
        sourceAttachmentId: binding.sourceAttachmentId,
        sourceAttachmentVersion: null,
        owners: [owner],
      },
    ],
    relationIds: [],
    relatedDocumentVersionIds: [],
  };
}
