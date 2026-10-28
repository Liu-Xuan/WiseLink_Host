import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type {
  TdmsProcessingSetFromRetainedResponse,
  TdmsProcessingSetFrozenReadResponse,
  TdmsProcessingSetSelectedReadResponse,
} from '@shared/tdms-processing-set.interface';
import {
  SessionResolver,
  type NativeBrowserIdentity,
} from '../identity/session-resolver.service';
import { miaodaHostedFinalUserActor } from '../work-item/production-miaoda-browser-ingress';
import { withDocumentSourceReadRequest } from '../document-management/src/hosted/nest/document-source-read.port';
import { TdmsReceiverService } from './tdms-receiver.service';
import { TdmsReceiverRepository } from './tdms-receiver.repository';
import { expectedTdmsReceiver } from './tdms-receiver-expectation';
import { TdmsProcessingSetService } from './tdms-processing-set.service';
import { SqlTdmsProcessingSetTransaction } from './tdms-processing-set.repository';
import {
  TdmsProcessingSetSourceAuthority,
  type TdmsBoundProcessingSetAuthority,
} from './tdms-processing-set-source-authority';
import {
  assertCaptureProof,
  assertCaptureRevisions,
  processingFromRetainedRequest,
  processingScope,
  producerDiagnostic,
  unresolvedProcessingSet,
} from './tdms-processing-set-source-facts';
import type {
  TdmsProcessingCaptureIndex,
  TdmsProcessingCaptureProof,
  TdmsStoredRevisionMetadata,
} from './tdms-processing-set.types';
import {
  canonical,
  identifier,
  object,
  strict,
} from './tdms-source.validation';
import { tdmsError, type TdmsPublicActor } from './tdms-source.types';

@Injectable()
export class TdmsProcessingSetProducerService {
  constructor(
    private readonly receivers: TdmsReceiverRepository,
    private readonly receiver: TdmsReceiverService,
    private readonly sessions: SessionResolver,
    private readonly authority: TdmsProcessingSetSourceAuthority,
  ) {}

  fromRetained(
    request: Request,
    value: unknown,
  ): Promise<TdmsProcessingSetFromRetainedResponse> {
    const input = processingFromRetainedRequest(value);
    return this.withRequest(request, true, async (identity, database, bind) => {
      const tx = new SqlTdmsProcessingSetTransaction(database);
      const gate = this.authority.bind(identity.actor, input.scope, tx);
      bind(gate);
      await gate.assertScopeAccess({
        actor: identity.actor,
        scope: input.scope,
        action: 'RETAIN',
        context: {},
      });
      const indices: TdmsProcessingCaptureIndex[] = [];
      for (const capture of input.captures) {
        const index = await tx.processingCaptureIndex(
          input.scope,
          capture.captureRef,
          capture.packageId,
        );
        if (!index) throw tdmsError('TDMS_PROCESSING_CAPTURE_INVALID', 409);
        indices.push(index);
      }
      await gate.admit('RETAIN', indices);
      const revisions: TdmsStoredRevisionMetadata[] = [];
      for (const ref of indices.flatMap((index) => index.recordRevisionRefs)) {
        const row = await tx.revisionMetadata(input.scope.tenantId, ref);
        if (!row) throw tdmsError('TDMS_PROCESSING_CAPTURE_INVALID', 409);
        revisions.push(row);
      }
      assertCaptureRevisions(input.scope, indices, revisions);
      if (
        !revisions.some(
          (row) =>
            row.record.sourceRevisionRef === input.processingObservationRef &&
            row.record.recordKind === 'PROCESSING_SHEET',
        )
      ) {
        await gate.admit('RETAIN', indices);
        return {
          status: 'NOT_RETAINED',
          receipt: null,
          diagnostic: producerDiagnostic(false),
        };
      }
      const proofs: TdmsProcessingCaptureProof[] = [];
      for (const index of indices) {
        const proof = await tx.processingCaptureProof(
          input.scope,
          index.captureRef,
        );
        if (!proof) throw tdmsError('TDMS_PROCESSING_CAPTURE_INVALID', 409);
        assertCaptureProof(index, proof, revisions);
        proofs.push(proof);
      }
      const set = unresolvedProcessingSet(input, revisions, indices, proofs);
      if (!set) throw tdmsError('TDMS_PROCESSING_CAPTURE_INVALID', 409);
      // Existing save/facts/CAS execute on exactly this handed transaction; never nest a new write transaction.
      const service = new TdmsProcessingSetService(
        { transaction: (operation) => operation(tx) },
        gate,
      );
      const receipt = await service.save(
        identity.actor,
        set,
        input.expectedGeneration,
      );
      await gate.admit('RETAIN', indices);
      return {
        status: 'RETAINED_UNRESOLVED',
        receipt,
        diagnostic: producerDiagnostic(true),
      };
    });
  }
  readFrozen(
    request: Request,
    value: unknown,
  ): Promise<TdmsProcessingSetFrozenReadResponse> {
    const input = object(value);
    strict(input, ['scope', 'setRevisionRef']);
    const scope = processingScope(input.scope),
      ref = identifier(input.setRevisionRef);
    return this.withRequest(
      request,
      false,
      async (identity, database, bind) => {
        const tx = new SqlTdmsProcessingSetTransaction(database);
        const gate = this.authority.bind(
          identity.actor,
          scope,
          tx,
          'READ_HISTORY',
        );
        bind(gate);
        const service = new TdmsProcessingSetService(
          { transaction: (operation) => operation(tx) },
          gate,
        );
        return { set: await service.readFrozen(identity.actor, scope, ref) };
      },
    );
  }
  readSelected(
    request: Request,
    value: unknown,
  ): Promise<TdmsProcessingSetSelectedReadResponse> {
    const input = object(value);
    strict(input, ['scope', 'processingFamilyRef']);
    const scope = processingScope(input.scope),
      family = identifier(input.processingFamilyRef);
    return this.withRequest(
      request,
      false,
      async (identity, database, bind) => {
        const tx = new SqlTdmsProcessingSetTransaction(database);
        const gate = this.authority.bind(identity.actor, scope, tx);
        bind(gate);
        const service = new TdmsProcessingSetService(
          { transaction: (operation) => operation(tx) },
          gate,
        );
        return {
          selection: await service.readSelected(identity.actor, scope, family),
        };
      },
    );
  }
  private async withRequest<T>(
    request: Request,
    retaining: boolean,
    operation: (
      identity: NativeBrowserIdentity,
      database: PostgresJsDatabase,
      bind: (authority: TdmsBoundProcessingSetAuthority) => void,
    ) => Promise<T>,
  ): Promise<T> {
    let release: (() => void) | undefined;
    const run = async (): Promise<T> => {
      const identity = this.sessions.nativeBrowserIdentity(request);
      const actorPin = stableActor(identity.actor);
      const deadline = identity.oauthSession?.session.expiresAt.getTime();
      let gate: TdmsBoundProcessingSetAuthority | undefined;
      const current = (): void => {
        const actual = miaodaHostedFinalUserActor(request.userContext);
        if (
          stableActor(actual) !== actorPin ||
          (deadline !== undefined && deadline <= Date.now())
        )
          throw tdmsError('TDMS_PROCESSING_REQUEST_IDENTITY_CHANGED', 409);
        gate?.assertCurrent();
      };
      release = current;
      const result = await this.receivers.transaction(async (database) => {
        await this.assertSession(request, identity, database);
        const value = await operation(identity, database, (value) => {
          gate = value;
        });
        await this.assertSession(request, identity, database);
        current();
        return value;
      });
      // Commit/receiver waits never extend the admitted request, Source or OAuth deadline.
      current();
      return result;
    };
    const result = await withDocumentSourceReadRequest(request, () =>
      retaining || expectedTdmsReceiver(request)
        ? this.receiver.withExpected(request, run)
        : this.sessions.withNativeBrowserIdentity(request, () =>
            this.sessions.withVerifiedNativeBrowserSql(run),
          ),
    );
    release?.();
    return result;
  }
  private async assertSession(
    request: Request,
    original: NativeBrowserIdentity,
    database: PostgresJsDatabase,
  ): Promise<void> {
    const current = await this.sessions.resolve(request, database);
    if (
      canonical(current?.actor ?? null) !==
        canonical(original.oauthSession?.actor ?? null) ||
      current?.session.id !== original.oauthSession?.session.id ||
      current?.session.revision !== original.oauthSession?.session.revision ||
      (current && current.session.expiresAt.getTime() <= Date.now())
    )
      throw tdmsError('TDMS_PROCESSING_REQUEST_IDENTITY_CHANGED', 409);
  }
}
function stableActor(actor: TdmsPublicActor): string {
  // Gateway reconstruction records a fresh diagnostic time; that time is not an identity pin.
  const { decidedAt, ...decision } = actor.subjectDecision;
  void decidedAt;
  return canonical({ ...actor, subjectDecision: decision });
}
