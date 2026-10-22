import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, sql } from 'drizzle-orm';
import { actionAttempt } from '../../database/schema';
import type {
  TdmsRuntimeNativeEvidence,
  TdmsRuntimeTaskBinding,
  TdmsRuntimeTaskContext,
} from './tdms-runtime-reader.port';
import { assertTdmsRuntimeTaskContext } from './tdms-runtime-reader.port';
import { canonical, object } from './tdms-source.validation';
import { tdmsError } from './tdms-source.types';
import { parseAssessmentTdmsEvidence } from '@shared/assessment-tdms-evidence';

/** The genuine READ is committed before JobAid journals it in its own transaction.
 * Receipts are immutable audit facts, never a new current permission or a lease. */
export class TdmsRuntimeReceiptRepository {
  constructor(private readonly database: PostgresJsDatabase) {}

  async assertTaskContext(context: TdmsRuntimeTaskContext): Promise<void> {
    const row = await this.task(
      context.binding.taskContextRef,
      context.binding,
    );
    const stored = assertTdmsRuntimeTaskContext(decode(row.context));
    if (canonical(stored) !== canonical(context)) invalid();
  }

  async savedBinding(
    taskContextRef: string,
    expected: Omit<TdmsRuntimeTaskBinding, 'taskContextRef'>,
  ) {
    const row = await this.task(taskContextRef, expected);
    const context = assertTdmsRuntimeTaskContext(decode(row.context));
    const binding = { ...expected, taskContextRef };
    if (canonical(context.binding) !== canonical(binding)) invalid();
    return binding;
  }

  async assertReceipt(
    binding: TdmsRuntimeTaskBinding,
    evidence: TdmsRuntimeNativeEvidence,
    requireJournal = false,
  ): Promise<void> {
    parseAssessmentTdmsEvidence(evidence);
    const s = evidence.nativeScope.processingSetBinding.scope;
    const receipt = evidence.nativeReadReceipt;
    if (
      s.tenantId !== binding.tenantId ||
      receipt.taskContextRef !== binding.taskContextRef
    )
      invalid();
    const rows = await this.database.execute<{
      data: unknown;
      consistent: boolean;
    }>(sql`
      SELECT data, (data->'scope'=jsonb_build_object('tenantId',tenant_id,'sourceKey',source_key,
        'sourceInstanceId',source_instance_id,'scopeId',scope_id)
        AND data->>'actorId'=actor_id AND data#>>'{receipt,receiptRef}'=receipt_ref
        AND data#>>'{receipt,sourceRevisionRef}'=source_revision_ref) AS consistent
      FROM tdms_read_receipt WHERE tenant_id=${s.tenantId} AND source_key=${s.sourceKey}
        AND source_instance_id=${s.sourceInstanceId} AND scope_id=${s.scopeId}
        AND receipt_ref=${receipt.receiptRef} AND source_revision_ref=${receipt.sourceRevisionRef}
        AND actor_id=${binding.actorUserId}`);
    if (rows.length !== 1 || rows[0]!.consistent !== true) invalid();
    const stored = object(
      typeof rows[0]!.data === 'string'
        ? JSON.parse(rows[0]!.data)
        : rows[0]!.data,
    );
    if (
      canonical(stored) !==
      canonical({
        scope: s,
        actorId: binding.actorUserId,
        receipt,
        context: { workItemId: binding.workItemId },
      })
    )
      invalid();
    if (!requireJournal) return;
    const row = await this.task(binding.taskContextRef, binding);
    // Journal bytes are read only by an explicit post-approval saved verification.
    const [saved] = await this.database
      .select({ journal: actionAttempt.reviewActivityJson })
      .from(actionAttempt)
      .where(eq(actionAttempt.id, row.id))
      .limit(1);
    const journal: unknown = JSON.parse(saved?.journal ?? '[]');
    if (!Array.isArray(journal)) invalid();
    let savedBody = false,
      savedReceipt = false;
    const { nativeReadReceipt: _receipt, ...expectedBody } = evidence;
    for (const value of journal) {
      const entry = object(value);
      if (entry.kind !== 'ASSESSMENT_SOURCES_READ') continue;
      if (Array.isArray(entry.nativeReadReceipts))
        savedReceipt ||= entry.nativeReadReceipts.some(
          (value) => canonical(value) === canonical(receipt),
        );
      if (Array.isArray(entry.nativeEvidence))
        for (const raw of entry.nativeEvidence) {
          const item = parseAssessmentTdmsEvidence(raw);
          if (item.evidenceRef !== evidence.evidenceRef) continue;
          const { nativeReadReceipt: _firstReceipt, ...body } = item;
          if (canonical(body) !== canonical(expectedBody)) invalid();
          savedBody = true;
          // Older journals saved the first genuine carrier before the separate
          // receipt list existed. Later READs must still occur in that list.
          savedReceipt ||=
            canonical(item.nativeReadReceipt) === canonical(receipt);
        }
    }
    if (!savedBody || !savedReceipt) invalid();
  }

  private async task(
    taskContextRef: string,
    expected: Omit<TdmsRuntimeTaskBinding, 'taskContextRef'>,
  ) {
    const [row] = await this.database
      .select({
        id: actionAttempt.id,
        context: sql<unknown>`${actionAttempt.taskEnvelopeJson}::jsonb#>'{modelInput,tdmsContext}'`,
        owner: sql<string>`${actionAttempt.taskEnvelopeJson}::jsonb#>>'{modelInput,actorUserId}'`,
      })
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.tenantId, expected.tenantId),
          eq(actionAttempt.operationRef, taskContextRef),
          eq(actionAttempt.workItemId, expected.workItemId),
          eq(actionAttempt.documentVersionId, expected.documentVersionId),
          eq(actionAttempt.actorUserId, 'service:openclaw-main'),
        ),
      )
      .limit(1);
    if (!row || row.owner !== expected.actorUserId) invalid();
    return row;
  }
}
function invalid(): never {
  throw tdmsError('TDMS_RUNTIME_SAVED_RECEIPT_MISMATCH', 409);
}

function decode(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}
