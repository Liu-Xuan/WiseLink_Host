import { and, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { identitySession, identitySubjectMapping } from '../../database/schema';
import { ailyAgentId, openAilyUserGrant } from '../identity/aily-user-grant.codec';
import { readAilyChatResult } from './aily-chat-client';
import type { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';

export interface ReviewAilyQueryRow extends Record<string, unknown> {
  query_ref: string;
  message_ref?: string | null;
  request_key: string;
  query_text: string;
  session_id: string;
  agent_id: string;
  chat_id: string | null;
  status: string;
  answer_text: string | null;
  error_code: string | null;
  _created_at: string | Date;
  remote_session_id?: string | null;
}

interface RecoveryInput {
  actors: Pick<EngineeringMatterWorkingRepository, 'withActorTransaction'>;
  actor: { actorId: string; tenantId: string; sessionId?: string };
  attemptRef: string;
  row: ReviewAilyQueryRow;
  accessToken: string;
  assertReadAuthorized: () => Promise<void>;
}

/** One authorized read of the original chat, never a dispatch or session search. */
export async function recoverReviewAilyResult(input: RecoveryInput): Promise<ReviewAilyQueryRow> {
  const { row, actor, attemptRef } = input;
  if (!['STARTING', 'RUNNING', 'UNKNOWN'].includes(row.status)) return row;
  // An unconfirmed GET must not close a still-running stream's write window.
  // Keep its existing RUNNING state until a known terminal result is obtained.
  let status = row.status === 'RUNNING' ? 'RUNNING' : 'UNKNOWN';
  let answer = row.answer_text;
  let error: string | null = 'AILY_STREAM_RESULT_UNCONFIRMED';
  if (row.chat_id) {
    if (row.agent_id !== ailyAgentId()) throw new Error('AILY_QUERY_BINDING_CHANGED');
    try {
      const snapshot = await readAilyChatResult({
        agentId: row.agent_id,
        accessToken: input.accessToken,
        chatId: row.chat_id,
        remoteSessionId: row.remote_session_id ?? undefined,
      });
      if (snapshot.remoteStatus === 'Completed' && !snapshot.answer.trim())
        throw new Error('AILY_EMPTY_RESPONSE');
      answer = snapshot.answer || null;
      if (snapshot.remoteStatus === 'Completed') {
        status = 'COMPLETED';
        error = null;
      } else if (snapshot.remoteStatus === 'Failed' || snapshot.remoteStatus === 'Cancelled') {
        status = 'FAILED';
        error = 'AILY_QUERY_FAILED';
      } else {
        // The result API does not document a complete status enum. A public
        // answer or finish_reason alone cannot establish successful completion.
        error = 'AILY_REMOTE_STATUS_UNCONFIRMED';
      }
    } catch (cause) {
      error = cause instanceof Error && /^AILY_[A-Z0-9_]+$/u.test(cause.message)
        ? cause.message : 'AILY_UPSTREAM_UNAVAILABLE';
    }
    // A GET may outlive the user's grant or a configuration change. Do not
    // persist or return its private answer under the old delegation.
    await input.assertReadAuthorized();
    if (row.agent_id !== ailyAgentId()) throw new Error('AILY_QUERY_BINDING_CHANGED');
  } else {
    const createdAt = new Date(row._created_at).getTime();
    if (row.status === 'UNKNOWN' || (Number.isFinite(createdAt) && Date.now() - createdAt <= 360_000))
      return row;
    status = 'UNKNOWN';
  }
  return input.actors.withActorTransaction(actor.actorId, async ({ database }) => {
    // Acquire the query lock before checking delegation. Waiting for another
    // query writer must not consume the remaining lifetime of a checked grant.
    const current = await database.execute<ReviewAilyQueryRow>(sql`
      SELECT * FROM review_aily_query WHERE query_ref=${row.query_ref}::uuid AND attempt_ref=${attemptRef}
        AND tenant_id=${actor.tenantId} AND actor_id=${actor.actorId} AND session_id=${actor.sessionId ?? ''}::uuid
      FOR UPDATE`);
    const selected = current[0];
    if (!selected) throw new Error('AILY_QUERY_NOT_FOUND');
    if (selected.agent_id !== row.agent_id || selected.chat_id !== row.chat_id ||
        (selected.remote_session_id ?? null) !== (row.remote_session_id ?? null) ||
        selected.request_key !== row.request_key || selected.query_text !== row.query_text)
      throw new Error('AILY_QUERY_BINDING_CHANGED');
    // These identity tables permit this service's existing SELECT delegation,
    // not row locks requiring UPDATE policies. The write predicate below is the
    // authoritative check of the exact grant read here, including rotation.
    const grants = await database.execute<{
      sealed: string | null; tokenHash: string; mappingId: string;
    }>(sql`
      SELECT ${identitySession.ailyAccessTokenSealed} AS "sealed",
        ${identitySession.sessionTokenHash} AS "tokenHash", ${identitySession.subjectMappingId} AS "mappingId"
      FROM ${identitySession} JOIN ${identitySubjectMapping}
        ON ${identitySession.subjectMappingId}=${identitySubjectMapping.id}
      WHERE ${identitySession.id}=${actor.sessionId ?? ''}::uuid`);
    const grant = grants[0];
    if (!grant?.sealed) throw new Error('AILY_USER_REAUTHORIZATION_REQUIRED');
    try {
      if (openAilyUserGrant(grant.sealed, `${grant.tokenHash}:${grant.mappingId}`) !== input.accessToken)
        throw new Error();
    } catch {
      throw new Error('AILY_USER_REAUTHORIZATION_REQUIRED');
    }
    const validGrant = and(
      eq(identitySession.id, actor.sessionId!),
      eq(identitySession.subjectMappingId, grant.mappingId),
      eq(identitySession.sessionTokenHash, grant.tokenHash),
      eq(identitySession.ailyAccessTokenSealed, grant.sealed),
      eq(identitySubjectMapping.miaodaUserId, actor.actorId),
      eq(identitySubjectMapping.miaodaTenantId, actor.tenantId),
      eq(identitySubjectMapping.status, 'ACTIVE'),
      eq(identitySubjectMapping.expectedClientId, process.env.FEISHU_OAUTH_CLIENT_ID ?? ''),
      isNull(identitySession.revokedAt),
      isNotNull(identitySession.ailyAccessTokenSealed),
      // Unlike CURRENT_TIMESTAMP, this advances after connection/query-lock waits.
      gt(identitySession.expiresAt, sql`clock_timestamp()`),
      gt(identitySession.ailyAccessTokenExpiresAt, sql`clock_timestamp()`),
    );
    // Compare the observed projection as well as its immutable dispatch binding.
    // This cannot replace a terminal answer or newer concurrent stream progress.
    const updated = await database.execute<ReviewAilyQueryRow>(sql`
      UPDATE review_aily_query SET status=${status},answer_text=${answer},error_code=${error},_updated_at=CURRENT_TIMESTAMP
      WHERE query_ref=${row.query_ref}::uuid AND attempt_ref=${attemptRef}
        AND tenant_id=${actor.tenantId} AND actor_id=${actor.actorId} AND session_id=${actor.sessionId ?? ''}::uuid
        AND agent_id=${row.agent_id} AND chat_id IS NOT DISTINCT FROM ${row.chat_id}
        AND remote_session_id IS NOT DISTINCT FROM ${row.remote_session_id ?? null}
        AND request_key=${row.request_key} AND query_text=${row.query_text}
        AND status IN ('STARTING','RUNNING','UNKNOWN') AND status=${row.status}
        AND answer_text IS NOT DISTINCT FROM ${row.answer_text} AND error_code IS NOT DISTINCT FROM ${row.error_code}
        AND EXISTS (SELECT 1 FROM ${identitySession} JOIN ${identitySubjectMapping}
          ON ${identitySession.subjectMappingId}=${identitySubjectMapping.id} WHERE ${validGrant})
      RETURNING *`);
    if (updated[0]) return updated[0];
    // A projection CAS miss may return the locked current query only while the
    // same exact grant is valid. Expiry/revocation/rotation never returns GET text.
    const authorized = await database.execute(sql`
      SELECT 1 FROM ${identitySession} JOIN ${identitySubjectMapping}
        ON ${identitySession.subjectMappingId}=${identitySubjectMapping.id} WHERE ${validGrant}`);
    if (!authorized[0]) throw new Error('AILY_USER_REAUTHORIZATION_REQUIRED');
    return selected;
  });
}
