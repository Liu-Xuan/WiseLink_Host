import { Inject, Injectable } from '@nestjs/common';
import type { TdmsProcessingRevisionSet } from '@shared/tdms-processing-set.interface';
import type { TdmsReadContext } from '@shared/tdms-source.interface';
import {
  DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
  type DocumentManagementIngestAuthorizer,
} from '../document-management/src/hosted/nest/document-management-hosted.tokens';
import { currentDocumentSourceReadContext } from '../document-management/src/hosted/nest/document-source-read.port';
import { MiaodaTdmsSourceAuthorization } from './miaoda-tdms-source-authorization';
import { TdmsBrowserSourceAuthorization } from './tdms-browser-source-authorization';
import { assertPublicActor, sameScope } from './tdms-source.authorization';
import { assertReadGrantsCurrent } from './tdms-read-member-scope';
import { assertReceiverMembers } from './tdms-receiver-authorization.validation';
import { assertTdmsReceiverScope } from './tdms-receiver-sql-context';
import { canonical } from './tdms-source.validation';
import {
  assertCaptureProof,
  assertCaptureRevisions,
  captureClaims,
  unresolvedProcessingSet,
  TDMS_PROCESSING_CAPTURE_LIMIT,
} from './tdms-processing-set-source-facts';
import type {
  TdmsProcessingSetAuthority,
  TdmsProcessingProducerTransaction,
  TdmsProcessingCaptureIndex,
  TdmsProcessingCaptureProof,
  TdmsStoredRevisionMetadata,
} from './tdms-processing-set.types';
import {
  tdmsError,
  type TdmsPublicActor,
  type TdmsSourceScope,
  type TdmsSourceGrant,
  type TdmsAction,
  type TdmsImportMemberClaims,
} from './tdms-source.types';

export interface TdmsBoundProcessingSetAuthority extends TdmsProcessingSetAuthority {
  admit(
    action: 'RETAIN' | 'READ',
    indices: readonly TdmsProcessingCaptureIndex[],
  ): Promise<void>;
  assertCurrent(): void;
}

/** Composes existing controlled decisions. It issues neither Source proof nor permission. */
@Injectable()
export class TdmsProcessingSetSourceAuthority {
  constructor(
    private readonly imports: MiaodaTdmsSourceAuthorization,
    private readonly reads: TdmsBrowserSourceAuthorization,
    @Inject(DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER)
    private readonly documents: DocumentManagementIngestAuthorizer,
  ) {}

  bind(
    actor: TdmsPublicActor,
    scope: TdmsSourceScope,
    tx: TdmsProcessingProducerTransaction,
    readAction: 'READ_RECORD' | 'READ_HISTORY' = 'READ_RECORD',
  ): TdmsBoundProcessingSetAuthority {
    const admitted = new Map<TdmsAction, TdmsSourceGrant>();
    const deadlines: TdmsSourceGrant[] = [];
    const current = (): void => {
      assertPublicActor(actor);
      assertReadGrantsCurrent(deadlines);
    };
    const accept = (action: TdmsAction, grant: TdmsSourceGrant): void => {
      if (
        !sameScope(scope, grant.scope) ||
        !grant.permissionRevision ||
        !grant.validUntil ||
        !grant.permittedMembers
      )
        throw tdmsError('TDMS_PROCESSING_CURRENT_AUTHORITY_REQUIRED', 403);
      const previous = admitted.get(action);
      if (previous && previous.permissionRevision !== grant.permissionRevision)
        throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
      admitted.set(action, grant);
      deadlines.push(grant);
      current();
    };
    const scopeAccess = async (action: 'RETAIN' | 'READ'): Promise<void> => {
      assertPublicActor(actor);
      if (actor.tenantId !== scope.tenantId)
        throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
      await assertTdmsReceiverScope(scope);
      const nativeAction: TdmsAction =
        action === 'RETAIN' ? 'IMPORT' : readAction;
      accept(
        nativeAction,
        await (action === 'RETAIN' ? this.imports : this.reads).authorize(
          actor,
          scope,
          nativeAction,
          {},
        ),
      );
    };
    const admit = async (
      action: 'RETAIN' | 'READ',
      indices: readonly TdmsProcessingCaptureIndex[],
    ): Promise<void> => {
      await scopeAccess(action);
      if (
        indices.some(
          (index) =>
            !sameScope(index.scope, scope) ||
            index.applicationScopeId !== actor.applicationScopeId,
        )
      )
        throw tdmsError('TDMS_PROCESSING_CAPTURE_INVALID', 409);
      const claims: TdmsImportMemberClaims = captureClaims(indices);
      if (action === 'RETAIN') {
        const grant = await this.imports.authorizeImport(actor, scope, claims);
        if (
          !grant.captureRetentionAllowed ||
          !grant.nativeProjectionAllowed ||
          !grant.authorityRef
        )
          throw tdmsError('TDMS_IMPORT_RIGHTS_ADMISSION_REQUIRED', 403);
        assertReceiverMembers(claims, grant.permittedMembers);
        accept('IMPORT', grant);
      } else {
        const grant = await this.reads.authorizeReadMembers(
          actor,
          scope,
          readAction,
          claims,
        );
        if (!grant.retainedCaptureReadAllowed)
          throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
        assertReceiverMembers(claims, grant.permittedMembers);
        accept(readAction, grant);
        if (claims.relationIds.length) {
          const relation = await this.reads.authorize(
            actor,
            scope,
            'READ_RELATIONS',
            {},
          );
          accept('READ_RELATIONS', relation);
          assertReceiverMembers(claims, relation.permittedMembers!);
        }
      }
      current();
    };
    return {
      available: true,
      admit,
      assertCurrent: current,
      assertScopeAccess: async (input): Promise<void> => {
        if (input.actor !== actor || !sameScope(input.scope, scope))
          throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
        await scopeAccess(input.action);
      },
      assertAccess: async ({
        actor: caller,
        action,
        set,
        revisions,
      }): Promise<void> => {
        if (
          caller !== actor ||
          !sameScope(set.scope, scope) ||
          !set.captureRefs.length ||
          set.captureRefs.length > TDMS_PROCESSING_CAPTURE_LIMIT
        )
          throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
        await scopeAccess(action);
        const indices: TdmsProcessingCaptureIndex[] = [];
        for (const ref of set.captureRefs) {
          const index = await tx.processingCaptureIndex(scope, ref);
          if (!index) throw tdmsError('TDMS_PROCESSING_CAPTURE_INVALID', 409);
          indices.push(index);
        }
        await admit(action, indices);
        assertCaptureRevisions(scope, indices, revisions);
        if (
          set.currentness !== 'UNKNOWN' ||
          set.cohortRef !== null ||
          set.familyIdentityEvidenceRefs.length ||
          set.cohortIdentityEvidenceRefs.length ||
          set.rosterEvidenceRefs.length ||
          set.currentnessEvidenceRefs.length ||
          set.successionEvidenceRefs.length ||
          set.members.some(
            (member) => member.membershipResolution === 'CONFIRMED',
          )
        )
          throw tdmsError('TDMS_PROCESSING_FACTS_UNSUPPORTED', 503);
        const proofs: TdmsProcessingCaptureProof[] = [];
        for (const index of indices) {
          const proof = await tx.processingCaptureProof(
            scope,
            index.captureRef,
          );
          if (!proof) throw tdmsError('TDMS_PROCESSING_CAPTURE_INVALID', 409);
          assertCaptureProof(index, proof, revisions);
          proofs.push(proof);
        }
        const reconstructed: TdmsProcessingRevisionSet | null =
          unresolvedProcessingSet(
            {
              scope,
              operationRef: set.setRevisionRef,
              captures: indices.map((index) => ({
                packageId: index.packageId,
                captureRef: index.captureRef,
              })),
              processingObservationRef: set.processingObservationRef,
              rootObservationRefs: set.rootBindings.map((root) => {
                if (root.endpoint.kind !== 'NATIVE_RECORD_REVISION')
                  throw tdmsError('TDMS_PROCESSING_CAPTURE_INVALID', 409);
                return root.endpoint.sourceRevisionRef;
              }),
              assessmentObservationRefs: set.members.map((member) => {
                if (!member.assessmentObservationRef)
                  throw tdmsError('TDMS_PROCESSING_CAPTURE_INVALID', 409);
                return member.assessmentObservationRef;
              }),
              expectedGeneration: null,
            },
            revisions,
            indices,
            proofs,
          );
        if (!reconstructed || canonical(reconstructed) !== canonical(set))
          throw tdmsError('TDMS_PROCESSING_CAPTURE_INVALID', 409);
        for (const row of revisions) await this.assertDocuments(actor, row, {});
        await admit(action, indices);
        current();
      },
      compare: async () => ({
        cohort: 'UNKNOWN',
        roster: 'UNKNOWN',
        evidenceRefs: [],
      }),
    };
  }
  private async assertDocuments(
    actor: TdmsPublicActor,
    row: TdmsStoredRevisionMetadata,
    context: TdmsReadContext,
  ): Promise<void> {
    for (const documentVersionId of row.record.relatedDocumentVersionIds) {
      await this.documents.assertCanRead({
        actorUserId: actor.canonicalSubject.id,
        tenantId: actor.tenantId,
        roles: [...actor.platformRoles],
        action: 'DOCUMENT_READ',
        documentVersionId,
        ...context,
        sourceReadContext: currentDocumentSourceReadContext(),
      });
    }
  }
}
