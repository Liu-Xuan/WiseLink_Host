import { Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import type {
  TdmsNativeReceiverBinding,
  TdmsUploadSelectionAssociationReceipt,
  TdmsUploadSelectionPreflight,
} from '@shared/tdms-receiver.interface';
import {
  SessionResolver,
  type ResolvedSession,
} from '../identity/session-resolver.service';
import { MiaodaTdmsSourceAuthorization } from './miaoda-tdms-source-authorization';
import { MiaodaTdmsDailyArtifactStore } from './miaoda-tdms-daily-artifact-store';
import { TdmsReceiverRepository } from './tdms-receiver.repository';
import type { TdmsPublicActor, TdmsSourceScope } from './tdms-source.types';
import { tdmsError } from './tdms-source.types';
import { sameScope } from './tdms-source.authorization';
import type {
  TdmsReceiverAuthority,
  TdmsStoredSelection,
} from './tdms-receiver.types';
import { assertReceiverMembers } from './tdms-receiver-authorization.validation';
import {
  assertReceiverSelectionRevision,
  checkedReceiverSelection,
  receiverArtifact,
  receiverSelectionPackage,
} from './tdms-receiver-selection.validation';
import { identifier, object, strict } from './tdms-source.validation';
import { dailyRequestId } from './tdms-daily-metadata.readback';
import {
  assertExpectedTdmsReceiver,
  expectedTdmsReceiver,
} from './tdms-receiver-expectation';
import {
  assertTdmsReceiverScope,
  tdmsReceiverExpectedScope,
  withTdmsReceiverExpectation,
} from './tdms-receiver-sql-context';

@Injectable()
export class TdmsReceiverService {
  constructor(
    private readonly receivers: TdmsReceiverRepository,
    private readonly authorization: MiaodaTdmsSourceAuthorization,
    private readonly artifacts: MiaodaTdmsDailyArtifactStore,
    private readonly sessions: SessionResolver,
  ) {}

  /** Legacy ingress stays compatible; a supplied pin must resolve through real current authority. */
  assertExpected(request: Request): Promise<void> {
    return expectedTdmsReceiver(request) === null
      ? Promise.resolve()
      : this.verified(request, async () => undefined);
  }

  withExpected<T>(
    request: Request,
    operation: () => T | Promise<T>,
  ): Promise<T> {
    return this.verified(request, async () => operation());
  }

  binding(
    request: Request,
    receiverId?: string,
  ): Promise<TdmsNativeReceiverBinding> {
    if (receiverId !== undefined) identifier(receiverId);
    return this.verified(request, (actor, original) =>
      this.receivers.transaction(async (db) => {
        const session = await this.currentSession(request, db, actor, original);
        const expectedScope = await tdmsReceiverExpectedScope();
        const candidates = (await this.authorization.bindings(actor)).filter(
          (a) =>
            receiverId === undefined
              ? !expectedScope || sameScope(a.scope, expectedScope)
              : a.row.receiverId === receiverId,
        );
        if (!candidates.length) throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
        if (candidates.length !== 1)
          throw tdmsError('TDMS_DAILY_SOURCE_SCOPE_AMBIGUOUS', 409);
        const authority = await this.authorization.current(
          actor,
          candidates[0]!.scope,
          'IMPORT',
        );
        await assertTdmsReceiverScope(authority.scope);
        return this.bindingValue(authority, actor, session);
      }),
    );
  }

  preflight(
    request: Request,
    requestId: string,
    bindingId: string,
    body: unknown,
  ): Promise<TdmsUploadSelectionPreflight> {
    const input = object(body);
    strict(input, ['package']);
    const { prepared } = receiverSelectionPackage(
      requestId,
      bindingId,
      input.package,
    );
    return this.verified(request, (actor, session) =>
      this.receivers.transaction(async (db) => {
        await this.currentSession(request, db, actor, session);
        const authority = await this.scope(actor);
        await this.authorizePackage(actor, authority, prepared.memberClaims);
        return {
          requestId,
          bindingId,
          receiverId: authority.row.receiverId,
          payloadDigest: prepared.payloadDigest,
          status: 'AUTHORIZED_UPLOAD',
        };
      }),
    );
  }

  stage(
    request: Request,
    requestId: string,
    bindingId: string,
    body: unknown,
  ): Promise<TdmsUploadSelectionAssociationReceipt> {
    const input = object(body);
    strict(input, ['package', 'selection']);
    const { prepared, observation } = receiverSelectionPackage(
      requestId,
      bindingId,
      input.package,
    );
    const artifact = receiverArtifact(observation, input.selection);
    return this.verified(request, async (actor, session) => {
      const authority = await this.scope(actor);
      await this.authorizePackage(actor, authority, prepared.memberClaims);
      const expected = expectedTdmsReceiver(request);
      if (expected)
        await this.receivers.transaction((db) =>
          this.checkExpected(request, db, actor, session, expected),
        );
      // Source and session have been checked before any remote operation; no SQL lock is held.
      const candidate = await this.artifacts.acquireSelection({
        actor,
        scope: authority.scope,
        packageId: requestId,
        artifact,
      });
      if (
        candidate.memberId !== artifact.memberId ||
        candidate.sha256 !== artifact.sha256 ||
        candidate.byteLength !== artifact.byteLength ||
        candidate.fileName !== artifact.fileName ||
        candidate.mediaType !== artifact.mediaType ||
        candidate.immutableReadbackVerified !== true ||
        candidate.documentVersionId !== null
      )
        throw tdmsError('TDMS_CONTROLLED_ARTIFACT_BINDING_INVALID');
      return this.sessions.withVerifiedNativeBrowserServiceSql(() =>
        this.receivers.transaction(async (db) => {
          await this.currentSession(request, db, actor, session);
          const expected = expectedTdmsReceiver(request);
          if (expected)
            await this.checkExpected(request, db, actor, session, expected);
          const current = await this.authorization.current(
            actor,
            authority.scope,
            'IMPORT',
          );
          if (current.permissionRevision !== authority.permissionRevision)
            throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
          await this.authorizePackage(actor, current, prepared.memberClaims);
          const receipt: TdmsUploadSelectionAssociationReceipt = {
            schemaVersion: 'wiselink.tdms-upload-selection-association.v1',
            requestId,
            bindingId,
            receiverId: current.row.receiverId,
            packageId: prepared.envelope.package.packageId,
            payloadDigest: prepared.payloadDigest,
            status: 'STAGED_CANDIDATE',
            selection: artifact.selection,
            sourceAttachmentId: artifact.sourceAttachmentId,
            ownerSnapshotId: observation.ownerSnapshotId,
            sha256: artifact.sha256,
            byteLength: artifact.byteLength,
            readbackVerified: true,
            documentVersionId: null,
          };
          const stored: TdmsStoredSelection = {
            scope: current.scope,
            applicationScopeId: actor.applicationScopeId,
            actorSubjectId: actor.canonicalSubject.id,
            receiverId: current.row.receiverId,
            receiverRevision: current.row.revision,
            grantRevision: current.row.grantRevision,
            permissionRevision: current.permissionRevision,
            payloadDigest: prepared.payloadDigest,
            packageId: prepared.envelope.package.packageId,
            memberClaims: prepared.memberClaims,
            observation,
            artifact,
            receipt,
          };
          return (await this.receivers.insertSelection(actor, current, stored))
            .receipt;
        }),
      );
    });
  }

  read(
    request: Request,
    requestId: string,
    bindingId: string,
  ): Promise<TdmsUploadSelectionAssociationReceipt> {
    dailyRequestId(requestId);
    identifier(bindingId);
    return this.verified(request, (actor, session) =>
      this.receivers.transaction(async (db) => {
        await this.currentSession(request, db, actor, session);
        const authority = await this.scope(actor);
        // The lookup has no package body. Prove both scope rights first;
        // for a visible row prove exact stored members before returning any receipt.
        await this.authorization.current(actor, authority.scope, 'READ_RECORD');
        const stored = await this.receivers.selection(
          actor,
          authority.scope,
          requestId,
          bindingId,
        );
        if (!stored) {
          // The current view may have no row or hide one under exact-member RLS.
          // Unavailable never proves physical absence or authorizes an upload.
          throw tdmsError('TDMS_UPLOAD_SELECTION_UNAVAILABLE', 404);
        }
        checkedReceiverSelection(
          stored,
          actor,
          authority.scope,
          requestId,
          bindingId,
        );
        assertReceiverSelectionRevision(stored, authority);
        await this.authorizePackage(actor, authority, stored.memberClaims);
        return structuredClone(stored.receipt);
      }),
    );
  }

  private async scope(actor: TdmsPublicActor): Promise<TdmsReceiverAuthority> {
    const expectedScope = await tdmsReceiverExpectedScope();
    const candidates = (await this.authorization.bindings(actor)).filter(
      (value) => !expectedScope || sameScope(value.scope, expectedScope),
    );
    if (!candidates.length) throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
    if (candidates.length !== 1)
      throw tdmsError('TDMS_DAILY_SOURCE_SCOPE_AMBIGUOUS', 409);
    const authority = await this.authorization.current(
      actor,
      candidates[0]!.scope,
      'IMPORT',
    );
    await assertTdmsReceiverScope(authority.scope);
    return authority;
  }

  private async authorizePackage(
    actor: TdmsPublicActor,
    authority: TdmsReceiverAuthority,
    claims: TdmsStoredSelection['memberClaims'],
  ): Promise<void> {
    await assertTdmsReceiverScope(authority.scope);
    await this.authorization.authorizeImport(actor, authority.scope, claims);
    const read = await this.authorization.current(
      actor,
      authority.scope,
      'READ_RECORD',
    );
    if (read.permissionRevision !== authority.permissionRevision)
      throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
    assertReceiverMembers(claims, read.decision.permittedMembers);
    await assertTdmsReceiverScope(authority.scope);
  }

  private verified<T>(
    request: Request,
    operation: (actor: TdmsPublicActor, session: ResolvedSession) => Promise<T>,
  ): Promise<T> {
    const expected = expectedTdmsReceiver(request);
    return this.sessions
      .withNativeBrowserIdentity(request, ({ actor, oauthSession }) => {
        if (!oauthSession)
          throw tdmsError('OFFICIAL_OAUTH_SESSION_REQUIRED', 401);
        return this.sessions.withVerifiedNativeBrowserSql(() => {
          if (!expected) return operation(actor, oauthSession);
          return withTdmsReceiverExpectation(
            (db) =>
              db
                ? this.checkExpected(request, db, actor, oauthSession, expected)
                : this.receivers.transaction((current) =>
                    this.checkExpected(
                      request,
                      current,
                      actor,
                      oauthSession,
                      expected,
                    ),
                  ),
            async () => {
              await this.receivers.transaction(async (db) =>
                this.checkExpected(request, db, actor, oauthSession, expected),
              );
              const result = await operation(actor, oauthSession);
              await this.receivers.transaction(async (db) =>
                this.checkExpected(request, db, actor, oauthSession, expected),
              );
              return result;
            },
          );
        });
      })
      .catch((error) => {
        if (
          expected &&
          [
            'OFFICIAL_OAUTH_SESSION_REQUIRED',
            'TDMS_RECEIVER_SESSION_CHANGED',
            'DIALOGUE_BROWSER_IDENTITY_MISMATCH',
          ].includes(error?.code ?? error?.message)
        )
          throw tdmsError('TDMS_RECEIVER_IDENTITY_CHANGED', 409);
        throw error;
      });
  }

  private async checkExpected(
    request: Request,
    db: PostgresJsDatabase,
    actor: TdmsPublicActor,
    original: ResolvedSession,
    expected: TdmsNativeReceiverBinding,
  ): Promise<TdmsSourceScope> {
    const session = await this.currentSession(request, db, actor, original);
    const candidates = (await this.authorization.bindings(actor)).filter(
      (a) => a.row.receiverId === expected.receiverId,
    );
    if (candidates.length !== 1)
      throw tdmsError('TDMS_RECEIVER_IDENTITY_CHANGED', 409);
    let authority: TdmsReceiverAuthority;
    try {
      authority = await this.authorization.current(
        actor,
        candidates[0]!.scope,
        'IMPORT',
      );
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'TDMS_SOURCE_NOT_FOUND'
      )
        throw tdmsError('TDMS_RECEIVER_IDENTITY_CHANGED', 409);
      throw error;
    }
    assertExpectedTdmsReceiver(
      expected,
      this.bindingValue(authority, actor, session),
    );
    return authority.scope;
  }

  private bindingValue(
    authority: TdmsReceiverAuthority,
    actor: TdmsPublicActor,
    session: ResolvedSession,
  ): TdmsNativeReceiverBinding {
    return {
      schemaVersion: 'wiselink.tdms-native-host-receiver-binding.v1',
      receiverId: authority.row.receiverId,
      tenantRef: actor.tenantId,
      applicationRef: actor.applicationScopeId,
      principalRef: actor.canonicalSubject.id,
      sourceSystem: 'TDMS',
      sourceInstanceRef: authority.scope.sourceInstanceId,
      authorityRevision: authority.permissionRevision,
      authorityEvidenceRef: authority.row.authorityEvidenceRef,
      sessionEvidenceRef: `wiselink-session:${session.session.id}:${session.session.revision}`,
      observedAt: new Date().toISOString(),
    };
  }

  private async currentSession(
    request: Request,
    db: PostgresJsDatabase,
    actor: TdmsPublicActor,
    original: ResolvedSession,
  ): Promise<ResolvedSession> {
    const session = await this.sessions.resolve(request, db);
    if (!session) throw tdmsError('OFFICIAL_OAUTH_SESSION_REQUIRED', 401);
    if (
      session.actor.canonicalSubject.id !== actor.canonicalSubject.id ||
      session.actor.tenantId !== actor.tenantId ||
      session.actor.applicationScopeId !== actor.applicationScopeId ||
      session.session.id !== original.session.id ||
      session.session.revision !== original.session.revision
    )
      throw tdmsError('TDMS_RECEIVER_SESSION_CHANGED', 409);
    return session;
  }
}
