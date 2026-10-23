import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, sql } from 'drizzle-orm';
import { actionAttempt, workItem } from '../../database/schema';
import { JobAidWorkRepository } from '../canonical-host/jobaid-work.repository';
import {
  CANONICAL_OBJECT_ACCESS,
  type CanonicalObjectAccessPort,
} from '../work-item/canonical-object-access.port';
import {
  CANONICAL_EXECUTOR_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
} from '../canonical-host/canonical-service-scope.authorization';
import type {
  TdmsNativeEvidenceActor,
  TdmsNativeEvidenceAuthorization,
  TdmsNativeEvidenceVerifier,
  TdmsNativeTransactionInput,
} from '../canonical-host/tdms-native-evidence-verifier.port';
import { parseAssessmentTdmsEvidence, type AssessmentTdmsNativeEvidence } from '@shared/assessment-tdms-evidence';
import { TdmsReceiverIdentityProfile } from './tdms-receiver-identity-profile';
import { TdmsRuntimeSession } from './tdms-runtime-session';
import { TdmsBrowserNativeVerifier } from './tdms-browser-native-verifier';
import { tdmsRuntimeDocumentBindings, tdmsRuntimeDocumentHasMarker } from './tdms-runtime-document-roots';
import { authenticateTdmsPrincipal } from './tdms-runtime-delegation';
import type {
  TdmsRuntimeReaderPort,
  TdmsRuntimePrincipal,
  TdmsRuntimeTaskBinding,
  TdmsRuntimeTaskContext,
  TdmsRuntimeReadRequest,
  TdmsRuntimeSavedNativeEvidence,
} from './tdms-runtime-reader.port';
import { canonical } from './tdms-source.validation';
import { tdmsError } from './tdms-source.types';
import { storedTdmsRuntimeContext } from './tdms-stored-runtime-context';
import { admitTdmsReviewCaller, tdmsReviewBinding, type TdmsReviewIngress, type TdmsReviewCaller } from './tdms-review-delegation';

/** Host production adapter. No controller or request may select an actor, source
 * scope or processing set. Ordinary acquisitions opt out before Source/profile IO. */
@Injectable()
export class TdmsProductionRuntimeReader
  implements TdmsRuntimeReaderPort, TdmsNativeEvidenceVerifier
{
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly database: PostgresJsDatabase,
    @Inject(CANONICAL_EXECUTOR_SERVICE_SCOPE_AUTHORIZATION)
    private readonly authorization: CanonicalServiceScopeAuthorizationPort,
    private readonly work: JobAidWorkRepository,
    private readonly identityProfile: TdmsReceiverIdentityProfile,
    @Inject(CANONICAL_OBJECT_ACCESS)
    private readonly objectAccess: CanonicalObjectAccessPort,
  ) {}

  async admitReview(ingress: TdmsReviewIngress): Promise<TdmsReviewCaller | null> {
    const subject=await this.reviewSubject(this.database,ingress);
    if(!subject) return null;
    return this.work.withActorTransaction(subject.owner,database=>this.admitReviewInTransaction({ingress,database}));
  }

  async admitReviewInTransaction(input:{ingress:TdmsReviewIngress;database:PostgresJsDatabase}):Promise<TdmsReviewCaller|null> {
    const {ingress,database}=input,subject=await this.reviewSubject(database,ingress);
    if(!subject) return null;
    const caller = await admitTdmsReviewCaller({ database, authorization: this.authorization, ingress });
    const binding = tdmsReviewBinding(caller);
    if (!binding.nativeMetadata.length && !(await tdmsRuntimeDocumentHasMarker(database, binding))) {
      if(subject.nativeTask) throw tdmsError('TDMS_RUNTIME_DOCUMENT_ACCESS_UNAVAILABLE',403);
      return null;
    }
    await new TdmsBrowserNativeVerifier(this.authorization, this.identityProfile, this.objectAccess)
      .assertReviewMetadata({ database, reviewCaller: caller, evidence: [],
        actor: { tenantId: binding.tenantId, actorUserId: binding.actorUserId } });
    return caller;
  }

  private async reviewSubject(database:PostgresJsDatabase,ingress:TdmsReviewIngress) {
    // The real Host ingress has already authorized this exact WorkItem. Only
    // finite owner/native-presence columns are read before its Source gate.
    const [subject] = await database.execute<{ owner: string; nativeTask: boolean; update: boolean }>(sql`
      SELECT requested_by_user_id AS owner, EXISTS (SELECT 1 FROM review_turn t
        WHERE t.tenant_id=w.tenant_id AND t.work_item_id=w.work_item_id AND t.actor_id=w.requested_by_user_id
          AND t.review_conversation_id=coalesce(${ingress.reviewConversationRef ?? null},
            (SELECT task_envelope_json::jsonb#>>'{modelInput,reviewConversationRef}' FROM action_attempt
              WHERE tenant_id=w.tenant_id AND work_item_id=w.work_item_id AND operation_ref=${ingress.attemptRef ?? ''}))
          AND t.request_id=coalesce(${ingress.requestId ?? null},
            (SELECT task_envelope_json::jsonb#>>'{modelInput,requestId}' FROM action_attempt
              WHERE tenant_id=w.tenant_id AND work_item_id=w.work_item_id AND operation_ref=${ingress.attemptRef ?? ''}))
          AND t.review_scope_json IS NULL AND CASE WHEN left(t.user_message,5)='WLR7:'
            THEN substring(t.user_message from 6)::jsonb->>'purpose'='UPDATE_ASSESSMENT' ELSE false END) AS "update",
      EXISTS (SELECT 1 FROM action_attempt a WHERE a.tenant_id=w.tenant_id AND a.work_item_id=w.work_item_id
        AND a.operation_ref=${ingress.attemptRef ?? ''} AND (
          a.task_envelope_json::jsonb#>'{modelInput,jobAidContext,tdmsReviewContext}' IS NOT NULL OR
          (${!!ingress.successorOverall} AND a.task_envelope_json::jsonb#>'{modelInput,tdmsContext}' IS NOT NULL))) AS "nativeTask"
      FROM work_item w WHERE w.tenant_id=${ingress.scope.tenantId} AND w.work_item_id=${ingress.scope.workItemId}`);
    if (!subject) throw tdmsError('TDMS_REVIEW_DELEGATION_REJECTED', 403);
    if (!subject.update) {
      if(subject.nativeTask || ingress.successorOverall) throw tdmsError('TDMS_REVIEW_DELEGATION_REJECTED',403);
      return null;
    }
    return subject;
  }

  async discover(
    principal: TdmsRuntimePrincipal,
    binding: TdmsRuntimeTaskBinding,
  ): Promise<TdmsRuntimeTaskContext | null> {
    if(principal.reviewCaller && ['COMMITTING','SUCCEEDED'].includes(tdmsReviewBinding(principal.reviewCaller).attempt?.status??''))
      throw tdmsError('TDMS_RUNTIME_EXECUTION_REQUIRED',403);
    return this.work.withActorTransaction(
      principal.actorUserId,
      async (database) => {
        if(principal.reviewCaller) await authenticateTdmsPrincipal({database,authorization:this.authorization,
          principal,binding,stage:'METADATA'});
        // Existing Host admission owns this ordinary read. Native delegation and
        // deployment/profile requirements apply only after an explicit TDMS marker.
        if (!(await tdmsRuntimeDocumentBindings(database, binding)).length)
          return null;
        await authenticateTdmsPrincipal({
          database,
          authorization: this.authorization,
          principal,
          binding,
          stage: 'METADATA',
        });
        return this.session(database, principal, binding).reader.discover(
          principal,
          binding,
        );
      },
    );
  }
  async assertAuthorized(
    principal: TdmsRuntimePrincipal,
    context: TdmsRuntimeTaskContext,
  ): Promise<void> {
    await this.run(principal, context.binding, (session) =>
      session.reader.assertAuthorized(principal, context),
    );
  }
  async read(principal: TdmsRuntimePrincipal, request: TdmsRuntimeReadRequest) {
    // Admission is metadata-only. READ cannot infer execution from an owner ID.
    if (principal.reviewCaller && tdmsReviewBinding(principal.reviewCaller).attempt?.status!=='RUNNING')
      throw tdmsError('TDMS_RUNTIME_EXECUTION_REQUIRED',403);
    if (
      !('attemptRef' in principal.scope) ||
      principal.scope.attemptRef !== request.taskContextRef ||
      request.context.binding.taskContextRef !== request.taskContextRef
    )
      throw tdmsError('TDMS_RUNTIME_EXECUTION_REQUIRED', 403);
    return this.run(
      principal,
      request.context.binding,
      async (session) => {
        await session.receipts.assertTaskContext(request.context);
        return session.reader.read(principal, request);
      },
      'EXECUTION',
    );
  }
  async verifyEvidence(
    principal: TdmsRuntimePrincipal,
    evidence: TdmsRuntimeSavedNativeEvidence[],
  ): Promise<void> {
    if (!evidence.length) return;
    if(principal.reviewCaller) {
      // A successor can consume exact saved Review carriers and its own READs.
      // Keep their original receipt identities; the delegated verifier separates
      // historical membership from this attempt's current context and journal.
      return this.work.withActorTransaction(principal.actorUserId,database=>
        this.assertReviewInTransaction({database,reviewCaller:principal.reviewCaller,
          actor:{tenantId:principal.scope.tenantId,actorUserId:principal.actorUserId},
          evidence:evidence.map(parseAssessmentTdmsEvidence)}));
    }
    await this.run(
      principal,
      undefined,
      (session) => session.reader.verifyEvidence(principal, evidence),
      'SAVED_VERIFICATION',
    );
  }
  async assertInTransaction(
    input: Omit<TdmsNativeTransactionInput, 'evidence'> & {
      evidence: AssessmentTdmsNativeEvidence[];
    },
  ): Promise<void> {
    if (input.reviewCaller) return this.assertReviewInTransaction(input);
    if (!input.runtime)
      return new TdmsBrowserNativeVerifier(
        this.authorization,
        this.identityProfile,
        this.objectAccess,
      ).assertInTransaction(input);
    if (input.summaryCaller || input.browserCaller || input.recoveryCaller || input.reviewCaller)
      throw tdmsError('TDMS_NATIVE_AUTHENTIC_CALLER_REQUIRED', 403);
    const { principal, context } = input.runtime;
    const admission = input.runtime.phase === 'ADMISSION';
    if (
      admission
        ? 'attemptRef' in principal.scope
        : !('attemptRef' in principal.scope) ||
          principal.scope.attemptRef !== context.binding.taskContextRef
    )
      throw tdmsError('TDMS_RUNTIME_EXECUTION_REQUIRED', 403);
    if (
      input.actor.actorUserId !== principal.actorUserId ||
      input.actor.tenantId !== principal.scope.tenantId
    )
      throw tdmsError('TDMS_RUNTIME_PRINCIPAL_BINDING_MISMATCH', 403);
    // The service-role assertion uses this same connection; no root-pool call is
    // permitted while JobAid holds WorkItem, grant, attempt and CAS locks.
    await this.work.withActorScope(
      principal.actorUserId,
      async () => {
        await authenticateTdmsPrincipal({
          database: input.database,
          authorization: this.authorization,
          principal,
          binding: context.binding,
          stage: admission ? 'SAVED_VERIFICATION' : 'EXECUTION',
        });
        const session = this.session(
          input.database,
          principal,
          context.binding,
          !admission,
          admission ? 'SAVED_VERIFICATION' : 'EXECUTION',
        );
        if (!admission) await session.receipts.assertTaskContext(context);
        await session.reader.assertAuthorized(principal, context);
        await session.reader.verifyEvidence(principal, input.evidence);
        await session.reader.assertAuthorized(principal, context);
      },
      input.database,
    );
  }
  async readReviewAndJournal(
    principal: TdmsRuntimePrincipal, request: TdmsRuntimeReadRequest,
    journal: Parameters<NonNullable<TdmsRuntimeReaderPort['readReviewAndJournal']>>[2],
  ) {
    if(!principal.reviewCaller) throw tdmsError('TDMS_REVIEW_DELEGATION_REJECTED',403);
    const result=await this.read(principal,request);
    // Keep the original independently of disposable callback data. The capability
    // verifies only these real receipts and cannot bless another carrier.
    const observed=structuredClone(result);
    await journal(structuredClone(observed),async database=>{
      await this.assertReviewInTransaction({database,reviewCaller:principal.reviewCaller,
        actor:{tenantId:request.context.binding.tenantId,actorUserId:principal.actorUserId},
        evidence:observed.evidence},new Set(observed.receipts.map(receipt=>receipt.receiptRef)));
    });
    await this.verifyEvidence(principal,observed.evidence);
    return observed;
  }

  private async assertReviewInTransaction(
    input: Omit<TdmsNativeTransactionInput,'evidence'> & {evidence:AssessmentTdmsNativeEvidence[]},
    justRead?: ReadonlySet<string>,
  ) {
    if(!input.reviewCaller||input.runtime||input.browserCaller||input.summaryCaller||input.recoveryCaller)
      throw tdmsError('TDMS_NATIVE_AUTHENTIC_CALLER_REQUIRED',403);
    const caller=input.reviewCaller,binding=tdmsReviewBinding(caller);
    const verifier=new TdmsBrowserNativeVerifier(this.authorization,this.identityProfile,this.objectAccess);
    await verifier.assertReviewMetadata({...input,evidence:[]});
    const fresh=input.evidence.filter(item=>item.nativeReadReceipt.taskContextRef===binding.attempt?.attemptRef);
    const historical=input.evidence.filter(item=>!fresh.includes(item));
    if(historical.length) await verifier.assertInTransaction({...input,evidence:historical});
    if(!binding.attempt || binding.attempt.phase==='PREPARATION') {
      if(fresh.length||justRead) throw tdmsError('TDMS_RUNTIME_EXECUTION_REQUIRED',403);
      return;
    }
    const [mode]=await input.database.execute<{schema:string|null}>(sql`SELECT
      task_envelope_json::jsonb#>>'{modelInput,jobAidContext,tdmsReviewContext,schemaVersion}' AS schema
      FROM action_attempt WHERE tenant_id=${binding.tenantId} AND work_item_id=${binding.workItemId}
        AND operation_ref=${binding.attempt.attemptRef}`);
    if(mode?.schema==='wiselink.tdms-review-saved-context.v1') {
      if(fresh.length||justRead) throw tdmsError('TDMS_RUNTIME_EXECUTION_REQUIRED',403);
      return;
    }
    const stored=await storedTdmsRuntimeContext(input.database,{taskContextRef:binding.attempt.attemptRef,
      tenantId:binding.tenantId,workItemId:binding.workItemId,documentVersionId:binding.documentVersionId,
      actorUserId:binding.actorUserId});
    const principal={scope:binding.scope,actorUserId:binding.actorUserId,reviewCaller:caller};
    const session=this.session(input.database,principal,stored.context.binding,!!justRead,'SAVED_VERIFICATION');
    await session.receipts.assertTaskContext(stored.context);
    await session.reader.assertAuthorized(principal,stored.context);
    if(justRead && fresh.some(item=>!justRead.has(item.nativeReadReceipt.receiptRef)))
      throw tdmsError('TDMS_RUNTIME_RECEIPT_BINDING_MISMATCH',409);
    await session.reader.verifyEvidence(principal,fresh);
    await session.reader.assertAuthorized(principal,stored.context);
  }

  async authorize(
    evidence: AssessmentTdmsNativeEvidence[],
    actor: TdmsNativeEvidenceActor,
    database?: PostgresJsDatabase,
  ): Promise<TdmsNativeEvidenceAuthorization[]> {
    await this.verifySaved(evidence, actor, database);
    return evidence.map((item) => ({
      evidenceRef: item.evidenceRef,
      sourceRevisionRef: item.nativeSource.sourceRevisionRef,
      processingSetBinding: structuredClone(
        item.nativeScope.processingSetBinding,
      ),
      permissionRevision: item.nativeReadReceipt.permissionRevision,
      sourceAudienceAuthorized: true,
      selectedObjectAuthorized: true,
    }));
  }
  async readExactEvidence(
    evidence: AssessmentTdmsNativeEvidence[],
    actor: TdmsNativeEvidenceActor,
    database?: PostgresJsDatabase,
  ) {
    await this.verifySaved(evidence, actor, database);
    // verifyEvidence reconstructs and compares exact retained fields and the
    // original receipt. It never rebinds saved fields or creates another READ.
    return structuredClone(evidence);
  }
  async assertCurrentEvidence(input: {
    evidence: AssessmentTdmsNativeEvidence[];
    actor: TdmsNativeEvidenceActor;
    authorization: TdmsNativeEvidenceAuthorization[];
    database?: PostgresJsDatabase;
  }) {
    const actual = await this.authorize(
      input.evidence,
      input.actor,
      input.database,
    );
    if (canonical(actual) !== canonical(input.authorization))
      throw tdmsError('TDMS_SOURCE_PERMISSION_CHANGED', 409);
  }
  private async verifySaved(
    evidence: AssessmentTdmsNativeEvidence[],
    actor: TdmsNativeEvidenceActor,
    database?: PostgresJsDatabase,
  ) {
    if (!evidence.length) return;
    if (database)
      throw tdmsError('TDMS_NATIVE_TRANSACTION_CALLER_REQUIRED', 503);
    // Generic saved readers have no caller-supplied service scope. Resolve each
    // existing task, then request a genuine fresh Host admission BEFORE opening
    // the verification transaction. Browser roles cannot enter withActorScope.
    const bindings = await this.work.withActorScope(
      actor.actorUserId,
      async () => {
        const output = new Map<string, { workItemId: string }>();
        for (const item of evidence) {
          const [task] = await this.database
            .select({
              workItemId: actionAttempt.workItemId,
              ownerUserId: sql<string>`${actionAttempt.taskEnvelopeJson}::jsonb#>>'{modelInput,actorUserId}'`,
            })
            .from(actionAttempt)
            .where(
              and(
                eq(actionAttempt.tenantId, actor.tenantId),
                eq(actionAttempt.actorUserId, 'service:openclaw-main'),
                eq(
                  actionAttempt.operationRef,
                  item.nativeReadReceipt.taskContextRef,
                ),
              ),
            )
            .limit(1);
          if (!task?.workItemId || task.ownerUserId !== actor.actorUserId)
            throw tdmsError('TDMS_RUNTIME_SAVED_RECEIPT_MISMATCH', 409);
          output.set(item.nativeReadReceipt.taskContextRef, {
            workItemId: task.workItemId,
          });
        }
        return output;
      },
    );
    const workItems = [
      ...new Set([...bindings.values()].map((value) => value.workItemId)),
    ];
    for (const workItemId of workItems) {
      const scope = await this.authorization.authorizeOpenClawWorkItem({
        operation: 'BEGIN_DYNAMIC',
        workItemId,
      });
      if (scope.tenantId !== actor.tenantId)
        throw tdmsError('TDMS_RUNTIME_DELEGATION_REJECTED', 403);
      await this.verifyEvidence(
        { scope, actorUserId: actor.actorUserId },
        evidence.filter(
          (item) =>
            bindings.get(item.nativeReadReceipt.taskContextRef)?.workItemId ===
            workItemId,
        ),
      );
    }
  }
  private session(
    database: PostgresJsDatabase,
    principal: TdmsRuntimePrincipal,
    binding: TdmsRuntimeTaskBinding,
    allowUnjournaledReceipts = false,
    stage: 'METADATA' | 'EXECUTION' | 'SAVED_VERIFICATION' = 'METADATA',
  ) {
    return new TdmsRuntimeSession(
      database,
      this.authorization,
      this.identityProfile,
      principal,
      binding,
      allowUnjournaledReceipts,
      stage,
    );
  }
  private run<T>(
    principal: TdmsRuntimePrincipal,
    binding: TdmsRuntimeTaskBinding | undefined,
    operation: (
      session: TdmsRuntimeSession,
      database: PostgresJsDatabase,
    ) => Promise<T>,
    stage: 'METADATA' | 'EXECUTION' | 'SAVED_VERIFICATION' = 'METADATA',
  ): Promise<T> {
    return this.work.withActorTransaction(
      principal.actorUserId,
      async (database) => {
        let invocation = binding;
        if (!invocation) {
          const [owner] = await database
            .select({
              workItemId: workItem.workItemId,
              documentVersionId: workItem.documentVersionId,
            })
            .from(workItem)
            .where(
              and(
                eq(workItem.tenantId, principal.scope.tenantId),
                eq(workItem.workItemId, principal.scope.workItemId),
                eq(workItem.requestedByUserId, principal.actorUserId),
              ),
            )
            .limit(1);
          if (!owner?.documentVersionId)
            throw tdmsError('TDMS_RUNTIME_DELEGATION_REJECTED', 403);
          invocation = {
            tenantId: principal.scope.tenantId,
            workItemId: owner.workItemId,
            documentVersionId: owner.documentVersionId,
            actorUserId: principal.actorUserId,
            taskContextRef:
              'attemptRef' in principal.scope
                ? String(principal.scope.attemptRef)
                : 'TDMS_SAVED_VERIFICATION',
          };
        }
        await authenticateTdmsPrincipal({
          database,
          authorization: this.authorization,
          principal,
          binding: invocation,
          stage,
        });
        return operation(
          this.session(database, principal, invocation, false, stage),
          database,
        );
      },
    );
  }
}
