import {
  assertTdmsRuntimeTaskContext,
  type TdmsRuntimePrincipal,
  type TdmsRuntimeTaskContext,
} from '../tdms-source/tdms-runtime-reader.port';
import type { CanonicalVerifiedAutoWorkItemQueueScope } from './canonical-service-scope.authorization';
import type { CanonicalMiaodaFinalUserActorContext } from '../work-item/canonical-object-access.port';
import type { CanonicalHostActor } from './canonical-host.types';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type {
  AssessmentEvidence,
  AssessmentTdmsProcessingSetBinding,
} from '@shared/assessment-reading.interface';
import {
  parseAssessmentTdmsEvidence,
  type AssessmentTdmsNativeEvidence,
} from '@shared/assessment-tdms-evidence';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';

export const TDMS_NATIVE_EVIDENCE_VERIFIER = Symbol(
  'TDMS_NATIVE_EVIDENCE_VERIFIER',
);
export interface TdmsNativeEvidenceActor {
  tenantId: string;
  actorUserId: string;
}
export interface TdmsNativeRecoveryCaller {
  scope: CanonicalVerifiedAutoWorkItemQueueScope;
  workItemId: string;
  documentVersionId: string;
  attemptRef: string;
  taskInputHash: string;
  resultContentHash: string;
}
/** Authentic caller data passed by Host ingress, never synthesized from owner IDs. */
export type TdmsNativeSummaryCaller =
  | ({
      kind: 'RUNTIME';
      summaryId: string;
      attemptRef: string;
      scope: CanonicalVerifiedAutoWorkItemQueueScope;
    } & (
      | { purpose?: 'EXECUTION' }
      | { purpose: 'SAVED_RESULT'; requestId: string }
    ))
  | { kind: 'BROWSER'; actor: CanonicalHostActor };
export interface TdmsNativeTransactionInput {
  actor: TdmsNativeEvidenceActor;
  runtime?: {
    principal: TdmsRuntimePrincipal;
    context: TdmsRuntimeTaskContext;
    /** Admission verifies already-saved evidence before an attempt exists. */
    phase?: 'ADMISSION' | 'EXECUTION';
  };
  summaryCaller?: TdmsNativeSummaryCaller;
  /** Existing queue reconciliation before renewing an expired COMMITTING lease. */
  recoveryCaller?: TdmsNativeRecoveryCaller;
  /** Resolved browser identity and exact saved-work binding, never a service scope.
   * The provider must independently authenticate this caller and current permissions. */
  browserCaller?: {
    actor: CanonicalMiaodaFinalUserActorContext;
    action: 'REQUEST_OVERALL_REGENERATION' | 'READ_WORK_ITEM';
    workItemId: string;
    documentVersionId: string;
    workItemRevision: number;
    workRevisionRef: string;
    /** Exact saved revisions read and compared by this regeneration guard. */
    workRevisionRefs?: string[];
  };
  evidence: AssessmentEvidence[];
  database: PostgresJsDatabase;
}

export interface TdmsNativeEvidenceAuthorization {
  evidenceRef: string;
  sourceRevisionRef: string;
  processingSetBinding: AssessmentTdmsProcessingSetBinding;
  /** Current provider decision revision, not the historical saved READ revision. */
  permissionRevision: string;
  sourceAudienceAuthorized: true;
  selectedObjectAuthorized: true;
}
/** Provider contract. A plain actor is an identity binding, never runtime
 * authentication. The provider MUST resolve and verify the genuine authenticated
 * invocation/delegated owner and live lease, source audience, exact selected-object
 * rights, immutable set/member and original READ provenance; missing proof denies.
 * Concrete provider registration belongs to the Host composition root. */
export interface TdmsNativeEvidenceVerifier {
  /** Mandatory when native proof is checked while a transaction is held. This
   * capability must use ONLY the handed transaction, verify the genuine caller,
   * current invocation/lease (including metadata-only context), exact saved READ
   * receipts/body/set/cohort and current audience/object decisions, and hold the
   * supported proof/fences through that transaction's commit. It must deny if any
   * such proof is unavailable. No root-pool lookup or permissive fallback. */
  assertInTransaction?(
    input: Omit<TdmsNativeTransactionInput, 'evidence'> & {
      evidence: AssessmentTdmsNativeEvidence[];
    },
  ): Promise<void>;
  /** One decision per carrier in input order, including distinct READ receipts
   * for the same evidenceRef. Every exact receipt/lease must be independently checked. */
  authorize(
    evidence: AssessmentTdmsNativeEvidence[],
    actor: TdmsNativeEvidenceActor,
    database?: PostgresJsDatabase,
  ): Promise<TdmsNativeEvidenceAuthorization[]>;
  /** Reconstruct exact selected native fields from retained source bytes. Keep the
   * saved receipt unchanged, verifying it rather than minting a replacement. */
  readExactEvidence(
    evidence: AssessmentTdmsNativeEvidence[],
    actor: TdmsNativeEvidenceActor,
    database?: PostgresJsDatabase,
  ): Promise<AssessmentTdmsNativeEvidence[]>;
  /** Final coordinated provider assertion, not an ACL-only recheck: verify the
   * exact retained source bytes, set/member and saved READ receipts together with
   * these current permission revisions and the genuine live invocation/lease.
   * Provider must deny when it cannot establish this consistent snapshot. */
  assertCurrentEvidence(input: {
    evidence: AssessmentTdmsNativeEvidence[];
    actor: TdmsNativeEvidenceActor;
    authorization: TdmsNativeEvidenceAuthorization[];
    database?: PostgresJsDatabase;
  }): Promise<void>;
}

/** Fresh verification on every consumer invocation; no cache or currentness claim. */
export async function verifyTdmsNativeEvidence(
  evidence: AssessmentEvidence[],
  actor: TdmsNativeEvidenceActor,
  verifier?: TdmsNativeEvidenceVerifier,
  database?: PostgresJsDatabase,
): Promise<void> {
  const native = evidence.filter((item) => item.kind === 'TDMS_NATIVE_RECORD');
  if (!native.length) return;
  if (database !== undefined)
    return assertTdmsNativeInTransaction(
      { evidence, actor, database },
      verifier,
    );
  if (
    !verifier ||
    typeof verifier.authorize !== 'function' ||
    typeof verifier.readExactEvidence !== 'function' ||
    typeof verifier.assertCurrentEvidence !== 'function'
  )
    throw new Error('TDMS_NATIVE_EVIDENCE_VERIFIER_UNAVAILABLE');
  const selected = selectedNativeEvidence(native, actor);
  // Each provider receives a disposable copy: it cannot mutate expected saved bytes.
  const before = checkedAuthorization(
    await verifier.authorize(structuredClone(selected), { ...actor }, database),
    selected,
  );
  const actual = await verifier.readExactEvidence(
    structuredClone(selected),
    { ...actor },
    database,
  );
  const after = checkedAuthorization(
    await verifier.authorize(structuredClone(selected), { ...actor }, database),
    selected,
  );
  if (canonicalJson(before) !== canonicalJson(after))
    throw new Error('TDMS_NATIVE_EVIDENCE_PERMISSION_CHANGED');
  if (!Array.isArray(actual) || actual.length !== selected.length)
    throw new Error('TDMS_NATIVE_EVIDENCE_BODY_CHANGED');
  const restored = actual.map(parseAssessmentTdmsEvidence);
  if (
    new Set(restored.map((item) => item.nativeReadReceipt.receiptRef)).size !==
      restored.length ||
    canonicalJson(ordered(selected)) !== canonicalJson(ordered(restored))
  )
    throw new Error('TDMS_NATIVE_EVIDENCE_BODY_CHANGED');
  await verifier.assertCurrentEvidence({
    evidence: structuredClone(selected),
    actor: { ...actor },
    authorization: structuredClone(after),
    ...(database === undefined ? {} : { database }),
  });
}
/** No source IO is allowed through a root-pool verifier while this TX is held. */
export async function assertTdmsNativeInTransaction(
  input: TdmsNativeTransactionInput,
  verifier?: TdmsNativeEvidenceVerifier,
): Promise<void> {
  const native = input.evidence.filter(
    (item) => item.kind === 'TDMS_NATIVE_RECORD',
  );
  if (!native.length && input.runtime === undefined) return;
  if (
    !input.database ||
    !verifier ||
    typeof verifier.assertInTransaction !== 'function'
  )
    throw new Error('TDMS_NATIVE_TRANSACTION_AUTHORIZATION_NOT_CONNECTED');
  const selected = selectedNativeEvidence(native, input.actor);
  if (input.runtime) {
    const context = assertTdmsRuntimeTaskContext(input.runtime.context);
    const principal = input.runtime.principal,
      scope = principal.scope;
    if (
      (input.runtime.phase !== undefined &&
        input.runtime.phase !== 'ADMISSION' &&
        input.runtime.phase !== 'EXECUTION') ||
      (input.runtime.phase === 'ADMISSION' && 'attemptRef' in scope)
    )
      throw new Error('TDMS_NATIVE_EVIDENCE_ACTOR_INVALID');
    if (
      principal.actorUserId !== input.actor.actorUserId ||
      scope.tenantId !== input.actor.tenantId ||
      context.binding.actorUserId !== input.actor.actorUserId ||
      context.binding.tenantId !== input.actor.tenantId ||
      scope.appId !== 'app_17bzc551rsg' ||
      !scope.principalId?.trim() ||
      !scope.authorizationFingerprint?.trim() ||
      scope.workItemId !== context.binding.workItemId ||
      ('attemptRef' in scope &&
        scope.attemptRef !== context.binding.taskContextRef)
    )
      throw new Error('TDMS_NATIVE_EVIDENCE_ACTOR_INVALID');
    for (const item of selected) {
      const binding = item.nativeScope.processingSetBinding;
      const selection = context.selections.find(
        (value) =>
          canonicalJson(value.scope) === canonicalJson(binding.scope) &&
          value.setRevisionRef === binding.setRevisionRef &&
          value.generation === binding.generation &&
          value.processingFamilyRef === binding.processingFamilyRef,
      );
      const cohort = context.projection.cohorts.find(
        (value) =>
          canonicalJson(value.scope) === canonicalJson(binding.scope) &&
          value.setRevisionRef === binding.setRevisionRef &&
          value.cohortRef === binding.cohortRef &&
          value.processingObservationRef === binding.processingObservationRef,
      );
      const member = cohort?.members.find(
        (value) =>
          value.memberRef === binding.memberRef &&
          value.assessmentObservationRef === binding.assessmentObservationRef &&
          value.opinionRefs.includes(item.evidenceRef),
      );
      const opinion = context.projection.opinions.find(
        (value) =>
          value.evidenceRef === item.evidenceRef &&
          value.assessment.sourceRevisionRef ===
            item.nativeSource.sourceRevisionRef &&
          canonicalJson(value.scope) === canonicalJson(binding.scope),
      );
      const expectedIdentity = {
        recordRef: item.nativeSource.recordRef,
        sourceRevisionRef: item.nativeSource.sourceRevisionRef,
        sourceRecordId: item.nativeSource.sourceRecordId,
        sourceVersion: item.nativeSource.sourceVersion,
        businessVersion: item.nativeSource.businessVersion ?? null,
      };
      const expectedApproval = {
        captureRef: item.nativeScope.approval.captureRef,
        evidencePath: item.nativeScope.approval.evidencePath,
        mode: item.nativeScope.approval.mode,
      };
      if (
        !selection ||
        !member ||
        member.status !== 'APPROVED' ||
        !context.projection.selectedSetApprovedRefs.includes(
          item.evidenceRef,
        ) ||
        !opinion ||
        canonicalJson(opinion.assessment) !== canonicalJson(expectedIdentity) ||
        canonicalJson(opinion.approval) !== canonicalJson(expectedApproval) ||
        canonicalJson(item.nativeScope.fieldSelectors) !==
          canonicalJson([
            { fieldPath: opinion.fieldPath, selector: opinion.sourceSelector },
          ])
      )
        throw new Error('TDMS_NATIVE_EVIDENCE_RUNTIME_BINDING_INVALID');
    }
  }
  const caller = input.summaryCaller;
  const recovery = input.recoveryCaller;
  if (
    recovery &&
    (input.runtime !== undefined ||
      caller !== undefined ||
      input.browserCaller !== undefined ||
      recovery.scope.appId !== 'app_17bzc551rsg' ||
      recovery.scope.tenantId !== input.actor.tenantId ||
      !recovery.scope.principalId ||
      !recovery.scope.authorizationFingerprint ||
      !recovery.workItemId ||
      !recovery.documentVersionId ||
      !recovery.attemptRef ||
      !recovery.taskInputHash ||
      !recovery.resultContentHash)
  )
    throw new Error('TDMS_NATIVE_EVIDENCE_ACTOR_INVALID');
  if (
    caller &&
    (caller.kind === 'RUNTIME'
      ? caller.scope.tenantId !== input.actor.tenantId ||
        caller.scope.appId !== 'app_17bzc551rsg' ||
        !caller.scope.authorizationFingerprint?.trim() ||
        !caller.scope.principalId ||
        !caller.summaryId ||
        !caller.attemptRef ||
        (caller.purpose !== undefined &&
          caller.purpose !== 'EXECUTION' &&
          caller.purpose !== 'SAVED_RESULT') ||
        (caller.purpose === 'SAVED_RESULT' && !caller.requestId?.trim())
      : caller.actor.tenantId !== input.actor.tenantId ||
        caller.actor.userId !== input.actor.actorUserId ||
        caller.actor.appId !== 'app_17bzc551rsg')
  )
    throw new Error('TDMS_NATIVE_EVIDENCE_ACTOR_INVALID');
  const browser = input.browserCaller;
  if (
    browser &&
    (browser.actor.tenantId !== input.actor.tenantId ||
      browser.actor.canonicalSubject.id !== input.actor.actorUserId ||
      browser.actor.applicationScopeId !== 'app_17bzc551rsg' ||
      browser.actor.transport !== 'MIAODA_AUTHENTICATED_HTTP' ||
      !['REQUEST_OVERALL_REGENERATION', 'READ_WORK_ITEM'].includes(
        browser.action,
      ) ||
      !browser.workItemId?.trim() ||
      !browser.documentVersionId?.trim() ||
      !browser.workRevisionRef?.trim() ||
      (browser.workRevisionRefs !== undefined &&
        (!Array.isArray(browser.workRevisionRefs) ||
          !browser.workRevisionRefs.includes(browser.workRevisionRef) ||
          new Set(browser.workRevisionRefs).size !==
            browser.workRevisionRefs.length ||
          browser.workRevisionRefs.some(
            (ref) => typeof ref !== 'string' || !ref.trim(),
          ))) ||
      !Number.isSafeInteger(browser.workItemRevision) ||
      browser.workItemRevision < 1 ||
      input.runtime !== undefined ||
      caller !== undefined)
  )
    throw new Error('TDMS_NATIVE_EVIDENCE_ACTOR_INVALID');
  await verifier.assertInTransaction({
    actor: { ...input.actor },
    evidence: structuredClone(selected),
    database: input.database,
    ...(input.runtime === undefined
      ? {}
      : { runtime: structuredClone(input.runtime) }),
    ...(caller === undefined ? {} : { summaryCaller: structuredClone(caller) }),
    ...(recovery === undefined
      ? {}
      : { recoveryCaller: structuredClone(recovery) }),
    ...(browser === undefined
      ? {}
      : { browserCaller: structuredClone(browser) }),
  });
}

function selectedNativeEvidence(
  native: AssessmentEvidence[],
  actor: TdmsNativeEvidenceActor,
): AssessmentTdmsNativeEvidence[] {
  const selected: AssessmentTdmsNativeEvidence[] = [];
  const identities = new Map<string, string>();
  const receipts = new Map<string, string>();
  for (const item of native.map(parseAssessmentTdmsEvidence)) {
    const { nativeReadReceipt, ...body } = item;
    const bodyBytes = canonicalJson(body),
      carrierBytes = canonicalJson(item);
    if (
      (identities.has(item.evidenceRef) &&
        identities.get(item.evidenceRef) !== bodyBytes) ||
      (receipts.has(nativeReadReceipt.receiptRef) &&
        receipts.get(nativeReadReceipt.receiptRef) !== carrierBytes)
    )
      throw new Error('TDMS_NATIVE_EVIDENCE_IDENTITY_CONFLICT');
    identities.set(item.evidenceRef, bodyBytes);
    if (!receipts.has(nativeReadReceipt.receiptRef)) selected.push(item);
    receipts.set(nativeReadReceipt.receiptRef, carrierBytes);
  }
  if (
    !actor.tenantId?.trim() ||
    !actor.actorUserId?.trim() ||
    selected.some(
      (item) =>
        item.nativeScope.processingSetBinding.scope.tenantId !== actor.tenantId,
    )
  )
    throw new Error('TDMS_NATIVE_EVIDENCE_ACTOR_INVALID');
  return selected;
}
function ordered(
  items: AssessmentTdmsNativeEvidence[],
): AssessmentTdmsNativeEvidence[] {
  return [...items].sort((a, b) =>
    canonicalJson([
      a.evidenceRef,
      a.nativeReadReceipt.receiptRef,
    ]).localeCompare(
      canonicalJson([b.evidenceRef, b.nativeReadReceipt.receiptRef]),
    ),
  );
}
function checkedAuthorization(
  value: unknown,
  evidence: AssessmentTdmsNativeEvidence[],
): TdmsNativeEvidenceAuthorization[] {
  const fail = (): never => {
    throw new Error('TDMS_NATIVE_EVIDENCE_AUTHORIZATION_INVALID');
  };
  if (!Array.isArray(value) || value.length !== evidence.length) return fail();
  const result = value.map((input, index) => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return fail();
    const item = input as TdmsNativeEvidenceAuthorization;
    if (
      Object.keys(item).length !== 6 ||
      Object.keys(item).some(
        (key) =>
          ![
            'evidenceRef',
            'sourceRevisionRef',
            'processingSetBinding',
            'permissionRevision',
            'sourceAudienceAuthorized',
            'selectedObjectAuthorized',
          ].includes(key),
      )
    )
      fail();
    const expected = evidence[index];
    if (
      !expected ||
      item.evidenceRef !== expected.evidenceRef ||
      item.sourceRevisionRef !== expected.nativeSource.sourceRevisionRef ||
      canonicalJson(item.processingSetBinding) !==
        canonicalJson(expected.nativeScope.processingSetBinding) ||
      item.sourceAudienceAuthorized !== true ||
      item.selectedObjectAuthorized !== true ||
      typeof item.permissionRevision !== 'string' ||
      !item.permissionRevision.trim()
    )
      fail();
    return structuredClone(item);
  });
  return result;
}
