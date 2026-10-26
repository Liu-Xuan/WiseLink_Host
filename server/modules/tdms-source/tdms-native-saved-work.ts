import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import type { AssessmentTdmsNativeEvidence } from '@shared/assessment-tdms-evidence';
import type { CanonicalObjectAccessPort } from '../work-item/canonical-object-access.port';
import type { TdmsNativeTransactionInput } from '../canonical-host/tdms-native-evidence-verifier.port';
import {
  assertTdmsRuntimeTaskContext,
  type TdmsRuntimeTaskContext,
} from './tdms-runtime-reader.port';
import type { TdmsSourceActor } from './tdms-runtime-delegation';
import { canonical, identifier } from './tdms-source.validation';
import { tdmsError } from './tdms-source.types';
import { tdmsReviewBinding, type TdmsReviewNativeMetadata } from './tdms-review-delegation';
import { storedTdmsRuntimeContext } from './tdms-stored-runtime-context';

/** Original READ ownership is resolved from its saved task, not the current
 * browser reader. Shared readers keep their own current Source/object grants. */
export async function tdmsSavedNativeContext(input: {
  database: PostgresJsDatabase;
  evidence: AssessmentTdmsNativeEvidence | TdmsReviewNativeMetadata;
  actor: TdmsSourceActor;
  caller: Pick<
    TdmsNativeTransactionInput,
    'browserCaller' | 'summaryCaller' | 'recoveryCaller' | 'reviewCaller'
  >;
  objectAccess: CanonicalObjectAccessPort;
}): Promise<TdmsRuntimeTaskContext> {
  const { database, evidence, actor, caller, objectAccess } = input;
  const readTask=()=>storedTdmsRuntimeContext(database,{tenantId:actor.tenantId,
    taskContextRef:evidence.nativeReadReceipt.taskContextRef});
  const row=await readTask();
  const context=assertTdmsRuntimeTaskContext(row.context);
  const binding = context.binding;
  if (
    binding.tenantId !== actor.tenantId ||
    binding.taskContextRef !== evidence.nativeReadReceipt.taskContextRef ||
    binding.actorUserId !== row.owner
  )
    invalid();
  const work = await database.execute<{
    documentVersionId: string;
    owner: string;
    revision: number;
  }>(sql`
    SELECT document_version_id AS "documentVersionId",requested_by_user_id AS owner,revision FROM work_item
    WHERE tenant_id=${actor.tenantId} AND work_item_id=${binding.workItemId} FOR SHARE`);
  if (
    work.length !== 1 ||
    work[0]!.documentVersionId !== binding.documentVersionId ||
    work[0]!.owner !== binding.actorUserId
  )
    invalid();
  // Keep the existing WorkItem -> attempt lock order. Only finite metadata is
  // looked up before the WorkItem lock, then checked again under the task lock.
  await database.execute(sql`SELECT 1 FROM action_attempt WHERE tenant_id=${actor.tenantId}
    AND operation_ref=${binding.taskContextRef} FOR SHARE`);
  const locked=await readTask();
  if (canonical(locked) !== canonical(row)) invalid();
  const browser = caller.browserCaller;
  const review = caller.reviewCaller && tdmsReviewBinding(caller.reviewCaller);
  if (review && (review.workItemId !== binding.workItemId ||
    review.documentVersionId !== binding.documentVersionId ||
    review.actorUserId !== binding.actorUserId || review.workItemRevision !== work[0]!.revision ||
    !review.nativeMetadata.some((item) => item.evidenceRef === evidence.evidenceRef &&
      item.nativeReadReceipt.receiptRef === evidence.nativeReadReceipt.receiptRef &&
      canonical(item.nativeScope.processingSetBinding) === canonical(evidence.nativeScope.processingSetBinding)))) invalid();
  if (
    browser &&
    (browser.workItemId !== binding.workItemId ||
      browser.documentVersionId !== binding.documentVersionId ||
      browser.workItemRevision !== work[0]!.revision ||
      !['REQUEST_OVERALL_REGENERATION', 'READ_WORK_ITEM'].includes(
        browser.action,
      ))
  )
    invalid();
  if (actor.principalKind === 'FINAL_USER') {
    const action = browser?.action ?? 'READ_WORK_ITEM';
    const grant = await objectAccess.freshRead(
      {
        actor,
        action,
        accessRoot: { kind: 'WORK_ITEM', id: binding.workItemId },
      },
      database,
    );
    if (
      !grant.allowed ||
      grant.action !== action ||
      grant.actorUserId !== actor.canonicalSubject.id ||
      grant.tenantId !== actor.tenantId ||
      grant.applicationScopeId !== actor.applicationScopeId ||
      grant.workItemId !== binding.workItemId ||
      grant.documentVersionId !== binding.documentVersionId ||
      grant.workItemRevision !== work[0]!.revision
    )
      denied();
  } else if (
    !['SUMMARY_SERVICE_DELEGATE', 'RECOVERY_SERVICE_DELEGATE', 'REVIEW_SERVICE_DELEGATE'].includes(
      actor.principalKind,
    ) ||
    (['RECOVERY_SERVICE_DELEGATE', 'REVIEW_SERVICE_DELEGATE'].includes(actor.principalKind) &&
      'workItemId' in actor &&
      actor.workItemId !== binding.workItemId) ||
    work[0]!.owner !== actor.canonicalSubject.id
  )
    denied();
  if (browser?.programAttemptId) {
    identifier(browser.programAttemptId);
    // Only membership leaves SQL before the existing current Source/receiver/own-approval
    // checks. An input journal is not a saved work or a newly authenticated runtime caller.
    const [prepared] = await database.execute<{retained:boolean}>(sql`SELECT EXISTS (
      SELECT 1 FROM action_attempt a WHERE a.tenant_id=${actor.tenantId}
        AND a.work_item_id=${binding.workItemId} AND a.document_version_id=${binding.documentVersionId}
        AND a.attempt_id=${browser.programAttemptId} AND a.actor_user_id='service:openclaw-main'
        AND a.task_envelope_json::jsonb#>>'{modelInput,actorUserId}'=${binding.actorUserId}
        AND a.action_type='OPENCLAW_DYNAMIC_EVALUATION'
        AND a.task_input_hash=a.task_envelope_json::jsonb->>'inputHash'
        AND a.task_envelope_json::jsonb#>>'{modelInput,executionMode}'
          IN ('PROGRAM_CONTROLLED_V1','PROGRAM_AGENT_V1')
        AND a.task_envelope_json::jsonb#>>'{modelInput,modelInput,executionMode}'
          =a.task_envelope_json::jsonb#>>'{modelInput,executionMode}'
        AND a.task_envelope_json::jsonb#>>'{modelInput,modelInput,purpose}'='INITIAL_PROBLEM_ASSESSMENT'
        AND (
          EXISTS (SELECT 1 FROM jsonb_array_elements(a.task_envelope_json::jsonb#>'{modelInput,sourceCatalog}') e
            WHERE e=${canonical(evidence)}::jsonb)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(a.review_activity_json::jsonb,'[]'::jsonb)) o,
            jsonb_array_elements(CASE WHEN jsonb_typeof(o->'nativeEvidence')='array' THEN o->'nativeEvidence' ELSE '[]'::jsonb END) e
            WHERE o->>'kind'='ASSESSMENT_SOURCES_READ' AND e=${canonical(evidence)}::jsonb)
        )
    ) AS retained`);
    if (prepared?.retained !== true) invalid();
    return context;
  }
  const savedRefs = browser
    ? (browser.workRevisionRefs ?? [browser.workRevisionRef])
    : review ? [review.workRevisionRef] : undefined;
  if (browser) {
    if (
      !savedRefs?.length ||
      !savedRefs.includes(browser.workRevisionRef) ||
      new Set(savedRefs).size !== savedRefs.length
    )
      invalid();
    for (const ref of savedRefs) identifier(ref);
    const selected = await database.execute<{ ref: string }>(sql`
      SELECT assessment_work_revision_id AS ref FROM assessment_work_revision
      WHERE tenant_id=${actor.tenantId} AND work_item_id=${binding.workItemId}
        AND document_version_id=${binding.documentVersionId}
        AND created_by_user_id=${browser.action === 'REQUEST_OVERALL_REGENERATION' ? actor.canonicalSubject.id : binding.actorUserId}
        AND assessment_work_revision_id=${browser.workRevisionRef}`);
    if (selected.length !== 1) invalid();
  }
  // This is a boolean membership test in immutable saved work. It never returns
  // saved bodies or journals before the independent current own-approval gate.
  const saved = await database.execute<{
    retained: boolean;
  }>(sql`SELECT EXISTS (
    SELECT 1 FROM assessment_work_revision r
    WHERE r.tenant_id=${actor.tenantId} AND r.work_item_id=${binding.workItemId}
      AND r.document_version_id=${binding.documentVersionId} AND r.created_by_user_id=${binding.actorUserId}
      ${
        savedRefs
          ? sql`AND r.assessment_work_revision_id IN (${sql.join(
              savedRefs.map((ref) => sql`${ref}`),
              sql`, `,
            )})`
          : sql``
      }
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE
        WHEN jsonb_typeof(r.content_json::jsonb->'evidence')='array' THEN r.content_json::jsonb->'evidence'
        ELSE '[]'::jsonb END) AS item WHERE ${'nativeSource' in evidence
          ? sql`item=${canonical(evidence)}::jsonb`
          : sql`item->>'kind'='TDMS_NATIVE_RECORD' AND item->>'evidenceRef'=${evidence.evidenceRef}
            AND item#>>'{nativeReadReceipt,taskContextRef}'=${evidence.nativeReadReceipt.taskContextRef}
            AND item#>>'{nativeReadReceipt,receiptRef}'=${evidence.nativeReadReceipt.receiptRef}
            AND item#>'{nativeScope,processingSetBinding}'=${canonical(evidence.nativeScope.processingSetBinding)}::jsonb`})
  ) AS retained`);
  if (saved.length !== 1 || saved[0]!.retained !== true) invalid();
  return context;
}
function invalid(): never {
  throw tdmsError('TDMS_NATIVE_SAVED_WORK_BINDING_MISMATCH', 409);
}
function denied(): never {
  throw tdmsError('TDMS_NATIVE_CURRENT_OBJECT_DENIED', 403);
}
