import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ReviewAilyService } from '../../server/modules/canonical-host/review-aily.service';
import type { ReviewAilyQueryRow } from '../../server/modules/canonical-host/review-aily-result-recovery';
import type { EngineeringMatterWorkingRepository } from '../../server/modules/canonical-host/engineering-matter-working.repository';
import { sealAilyUserGrant } from '../../server/modules/identity/aily-user-grant.codec';

describe('review Aily original-chat result recovery', () => {
  const env = { ...process.env };
  const originalFetch = globalThis.fetch;
  const actor = { actorId: 'actor-1', tenantId: 'tenant-1', sessionId: '11111111-1111-4111-8111-111111111111' };
  const queryRef = '22222222-2222-4222-8222-222222222222';
  const attemptRef = 'ATTEMPT';
  const dialect = new PgDialect();
  beforeEach(() => {
    process.env.FEISHU_OAUTH_CLIENT_ID = 'cli_test';
    process.env.FEISHU_OAUTH_CLIENT_SECRET = 'test-only-secret';
    process.env.WL_AILY_AGENT_ID = 'agent_test';
  });
  afterEach(() => {
    process.env = { ...env };
    globalThis.fetch = originalFetch;
  });

  function query(overrides: Partial<ReviewAilyQueryRow> = {}): ReviewAilyQueryRow {
    return {
      query_ref: queryRef, attempt_ref: attemptRef, tenant_id: actor.tenantId, actor_id: actor.actorId,
      session_id: actor.sessionId, agent_id: 'agent_test', request_key: 'original-request', query_text: 'original query',
      chat_id: '123', remote_session_id: 'original-session', status: 'UNKNOWN', answer_text: '部分',
      error_code: 'AILY_STREAM_INTERRUPTED', _created_at: new Date(Date.now() - 361_000), ...overrides,
    };
  }

  function harness(row: ReviewAilyQueryRow | null = query()) {
    const execute = jest.fn().mockResolvedValueOnce(row ? [row] : []);
    const grant = [{ sealed: sealAilyUserGrant('test-only-user-token', 'hash:mapping'), tokenHash: 'hash', mappingId: 'mapping' }];
    const limit = jest.fn().mockResolvedValue(grant);
    const lockQuery = jest.fn().mockResolvedValue(row ? [row] : []);
    const readGrant = jest.fn().mockResolvedValue(grant);
    const readValidGrant = jest.fn().mockResolvedValue([{ valid: 1 }]);
    const databaseExecute = jest.fn(async (statement: SQL) => {
      const text = dialect.sqlToQuery(statement).sql;
      if (text.includes('FOR UPDATE')) return lockQuery(statement);
      // Existing service policies grant identity SELECT only. A lock request
      // must fail this harness instead of silently granting identity UPDATE.
      if (text.includes('FOR SHARE')) throw new Error('IDENTITY_LOCK_NOT_PERMITTED');
      if (text.includes(' AS "sealed"')) return readGrant(statement);
      if (text.trimStart().startsWith('SELECT 1 FROM "identity_session"')) return readValidGrant(statement);
      return execute(statement);
    });
    const database = { execute: databaseExecute, select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit }) }) }) }) };
    const withActorTransaction = jest.fn(async (_actor: string, operation: (value: { database: typeof database }) => Promise<unknown>) =>
      operation({ database }));
    const service = new ReviewAilyService({ withActorTransaction } as unknown as EngineeringMatterWorkingRepository);
    return { service, execute, limit, withActorTransaction, databaseExecute, lockQuery, readGrant, readValidGrant };
  }

  function remote(status: string, text = '部分与完整快照', extra: Record<string, unknown> = {}): Response {
    return Response.json({ code: 0, data: { status, content: [{ type: 'text', text }], ...extra } });
  }

  it.each(['RUNNING', 'UNKNOWN'])('recovers %s from exactly its saved agent/chat and replaces the answer snapshot', async (status) => {
    const row = query({ status });
    const { service, execute, withActorTransaction, databaseExecute, lockQuery, readGrant } = harness(row);
    execute.mockResolvedValueOnce([{ ...row, status: 'COMPLETED', answer_text: '部分与完整快照', error_code: null }]);
    globalThis.fetch = jest.fn().mockResolvedValue(remote('Completed', undefined, {
      agent_chat_id: row.chat_id, session_id: row.remote_session_id,
    }));
    expect(await service.result(actor, attemptRef, queryRef)).toMatchObject({
      status: 'COMPLETED', answer: '部分与完整快照', incomplete: false, candidateOnly: true,
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://open.feishu.cn/open-apis/aily/v1/agents/agent_test/chats/123',
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
    const update = dialect.sqlToQuery(execute.mock.calls[1][0] as SQL);
    expect(update.sql).toContain("status IN ('STARTING','RUNNING','UNKNOWN') AND status=");
    expect(update.sql).toContain('remote_session_id IS NOT DISTINCT FROM');
    expect(update.sql).toContain('answer_text IS NOT DISTINCT FROM');
    expect(update.sql).toContain('request_key=');
    expect(update.sql).toContain('AND EXISTS (SELECT 1 FROM "identity_session"');
    expect(update.sql).toContain('"identity_session"."revoked_at" is null');
    expect(update.sql).toContain('"identity_session"."expires_at" > clock_timestamp()');
    expect(update.sql).toContain('"identity_session"."aily_access_token_expires_at" > clock_timestamp()');
    expect(update.sql).toContain('"identity_subject_mapping"."status" =');
    expect(update.sql).toContain('"identity_session"."session_token_hash" =');
    expect(update.sql).toContain('"identity_session"."aily_access_token_sealed" =');
    expect(update.sql).toContain('"identity_session"."subject_mapping_id" =');
    expect(update.params).toEqual(expect.arrayContaining([
      'original-request', 'original query', 'original-session', '123', actor.sessionId, actor.actorId, actor.tenantId, attemptRef,
    ]));
    expect(update.params).not.toContain('部分部分与完整快照');
    expect(withActorTransaction.mock.calls.every(([id]) => id === actor.actorId)).toBe(true);
    expect(lockQuery.mock.invocationCallOrder[0]).toBeLessThan(readGrant.mock.invocationCallOrder[0]);
    expect(readGrant.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[1]);
    expect(dialect.sqlToQuery(databaseExecute.mock.calls[2][0]).sql)
      .not.toMatch(/FOR (?:SHARE|UPDATE)/u);
  });

  it('does not refetch or duplicate an already recovered snapshot', async () => {
    const row = query();
    const recovered = { ...row, status: 'COMPLETED', answer_text: '完整快照', error_code: null };
    const { service, execute } = harness(row);
    execute.mockResolvedValueOnce([recovered]).mockResolvedValueOnce([recovered]);
    globalThis.fetch = jest.fn().mockResolvedValue(remote('Completed', '完整快照'));
    expect((await service.result(actor, attemptRef, queryRef)).answer).toBe('完整快照');
    expect((await service.result(actor, attemptRef, queryRef)).answer).toBe('完整快照');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('leaves UNKNOWN without a chat unchanged without a GET, session search or POST', async () => {
    const { service, execute } = harness(query({ chat_id: null }));
    globalThis.fetch = jest.fn();
    expect(await service.result(actor, attemptRef, queryRef)).toMatchObject({ status: 'UNKNOWN', answer: '部分' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each(['FuturePlatformStatus', 'Running', 'completed'])('does not infer completion from unverified remote status %s', async (remoteStatus) => {
    const row = query();
    const { service, execute } = harness(row);
    execute.mockResolvedValueOnce([{ ...row, answer_text: '公开快照', error_code: 'AILY_REMOTE_STATUS_UNCONFIRMED' }]);
    globalThis.fetch = jest.fn().mockResolvedValue(remote(remoteStatus, '公开快照', { finish_reason: 'stop' }));
    expect(await service.result(actor, attemptRef, queryRef)).toMatchObject({
      status: 'UNKNOWN', answer: '公开快照', error: 'AILY_REMOTE_STATUS_UNCONFIRMED', incomplete: true,
    });
    const update = dialect.sqlToQuery(execute.mock.calls[1][0] as SQL);
    expect(update.params[0]).toBe('UNKNOWN');
  });

  it.each(['Failed', 'Cancelled'])('retains explicit %s as failure rather than completed work', async (remoteStatus) => {
    const row = query();
    const { service, execute } = harness(row);
    execute.mockResolvedValueOnce([{ ...row, status: 'FAILED', error_code: 'AILY_QUERY_FAILED' }]);
    globalThis.fetch = jest.fn().mockResolvedValue(remote(remoteStatus, '部分'));
    expect(await service.result(actor, attemptRef, queryRef)).toMatchObject({ status: 'FAILED', incomplete: true });
  });

  it('keeps an active stream writable when its result GET is not terminal', async () => {
    const row = query({ status: 'RUNNING', _created_at: new Date(), error_code: null });
    const { service, execute } = harness(row);
    execute.mockResolvedValueOnce([{ ...row, error_code: 'AILY_REMOTE_STATUS_UNCONFIRMED' }]);
    globalThis.fetch = jest.fn().mockResolvedValue(remote('Running', '部分'));
    expect(await service.result(actor, attemptRef, queryRef)).toMatchObject({
      status: 'RUNNING', answer: '部分', incomplete: true, error: 'AILY_REMOTE_STATUS_UNCONFIRMED',
    });
    expect(dialect.sqlToQuery(execute.mock.calls[1][0] as SQL).params[0]).toBe('RUNNING');
  });

  it('keeps the saved partial answer and uncertainty when the result GET fails', async () => {
    const row = query();
    const { service, execute } = harness(row);
    execute.mockResolvedValueOnce([{ ...row, error_code: 'AILY_HTTP_403' }]);
    globalThis.fetch = jest.fn().mockResolvedValue(new Response('', { status: 403 }));
    expect(await service.result(actor, attemptRef, queryRef)).toMatchObject({
      status: 'UNKNOWN', answer: '部分', error: 'AILY_HTTP_403',
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not adopt an empty Completed answer or an echoed different session', async () => {
    const row = query();
    for (const [body, code] of [
      [remote('Completed', ''), 'AILY_EMPTY_RESPONSE'],
      [remote('Completed', 'wrong answer', { session_id: 'another-session' }), 'AILY_RESULT_SESSION_MISMATCH'],
    ] as const) {
      const { service, execute } = harness(row);
      execute.mockResolvedValueOnce([{ ...row, error_code: code }]);
      globalThis.fetch = jest.fn().mockResolvedValue(body);
      expect(await service.result(actor, attemptRef, queryRef)).toMatchObject({ status: 'UNKNOWN', answer: '部分', error: code });
      expect(dialect.sqlToQuery(execute.mock.calls[1][0] as SQL).params[1]).toBe('部分');
    }
  });

  it('rejects an unowned query or changed configured agent before any GET', async () => {
    const missing = harness(null);
    globalThis.fetch = jest.fn();
    await expect(missing.service.result(actor, 'OTHER', queryRef)).rejects.toThrow('AILY_QUERY_NOT_FOUND');
    const changed = harness(query({ agent_id: 'agent_other' }));
    await expect(changed.service.result(actor, attemptRef, queryRef)).rejects.toThrow('AILY_QUERY_BINDING_CHANGED');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects a grant revoked while the original GET is pending', async () => {
    const { service, execute, limit } = harness();
    globalThis.fetch = jest.fn().mockImplementation(async () => {
      limit.mockResolvedValue([]);
      return remote('Completed');
    });
    await expect(service.result(actor, attemptRef, queryRef)).rejects.toThrow('AILY_USER_REAUTHORIZATION_REQUIRED');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each(['COMPLETED', 'FAILED'])('does not replace %s that arrived while the result GET was pending', async (status) => {
    const row = query();
    const current = { ...row, status, answer_text: '较新终态', error_code: null };
    const { service, execute, lockQuery } = harness(row);
    lockQuery.mockResolvedValueOnce([current]);
    execute.mockResolvedValueOnce([]);
    globalThis.fetch = jest.fn().mockResolvedValue(remote('Completed', '迟到快照'));
    expect(await service.result(actor, attemptRef, queryRef)).toMatchObject({ status, answer: '较新终态' });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns newer stream progress instead of replacing it with an older GET snapshot', async () => {
    const row = query({ status: 'RUNNING', error_code: null });
    const { service, execute, lockQuery } = harness(row);
    lockQuery.mockResolvedValueOnce([{ ...row, answer_text: '更新的在途正文' }]);
    execute.mockResolvedValueOnce([]);
    globalThis.fetch = jest.fn().mockResolvedValue(remote('Running', '旧快照'));
    expect(await service.result(actor, attemptRef, queryRef)).toMatchObject({ status: 'RUNNING', answer: '更新的在途正文' });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('rejects a changed persisted chat/session binding after the GET', async () => {
    const row = query();
    const { service, lockQuery } = harness(row);
    lockQuery.mockResolvedValueOnce([{ ...row, remote_session_id: 'different-session' }]);
    globalThis.fetch = jest.fn().mockResolvedValue(remote('Completed'));
    await expect(service.result(actor, attemptRef, queryRef)).rejects.toThrow('AILY_QUERY_BINDING_CHANGED');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['session revoked', 'session expired', 'grant expired', 'mapping disabled'])(
    'rejects %s committed after the second grant check while the query lock was pending',
    async (_change) => {
      const row = query();
      const { service, execute, limit, lockQuery, readValidGrant } = harness(row);
      // Both original JS grant checks succeed. The identity change wins while
      // this transaction is acquiring its first (query) row lock.
      let delegationValid = true;
      lockQuery.mockImplementationOnce(async () => {
        delegationValid = false;
        return [row];
      });
      execute.mockImplementationOnce(async (statement: SQL) => {
        const update = dialect.sqlToQuery(statement);
        expect(limit).toHaveBeenCalledTimes(2);
        expect(update.sql).toContain('AND EXISTS (SELECT 1 FROM "identity_session"');
        expect(update.sql).toContain('clock_timestamp()');
        expect(delegationValid).toBe(false);
        return [];
      });
      readValidGrant.mockImplementationOnce(async () => delegationValid ? [{ valid: 1 }] : []);
      globalThis.fetch = jest.fn().mockResolvedValue(remote('Completed', '不得返回的新正文'));
      await expect(service.result(actor, attemptRef, queryRef)).rejects.toThrow('AILY_USER_REAUTHORIZATION_REQUIRED');
      expect(lockQuery.mock.invocationCallOrder[0]).toBeGreaterThan(limit.mock.invocationCallOrder[1]);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('checks real database time after waiting for the grant SELECT, not transaction start time', async () => {
    const row = query();
    const { service, execute, readGrant, readValidGrant } = harness(row);
    let grantExpired = false;
    const grant = [{ sealed: sealAilyUserGrant('test-only-user-token', 'hash:mapping'), tokenHash: 'hash', mappingId: 'mapping' }];
    readGrant.mockImplementationOnce(async () => {
      grantExpired = true;
      return grant;
    });
    execute.mockImplementationOnce(async (statement: SQL) => {
      const update = dialect.sqlToQuery(statement);
      expect(grantExpired).toBe(true);
      expect(update.sql.match(/clock_timestamp\(\)/gu)).toHaveLength(2);
      return [];
    });
    readValidGrant.mockResolvedValueOnce([]);
    globalThis.fetch = jest.fn().mockResolvedValue(remote('Completed', '过期后不得落库'));
    await expect(service.result(actor, attemptRef, queryRef)).rejects.toThrow('AILY_USER_REAUTHORIZATION_REQUIRED');
  });

  it('rejects a grant rotated before its transaction SELECT rather than adopting an old-token response', async () => {
    const { service, execute, readGrant } = harness();
    readGrant.mockResolvedValueOnce([{
      sealed: sealAilyUserGrant('replacement-user-token', 'hash:mapping'), tokenHash: 'hash', mappingId: 'mapping',
    }]);
    globalThis.fetch = jest.fn().mockResolvedValue(remote('Completed'));
    await expect(service.result(actor, attemptRef, queryRef)).rejects.toThrow('AILY_USER_REAUTHORIZATION_REQUIRED');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects token rotation between the grant SELECT and the actual UPDATE', async () => {
    const { service, execute, readGrant, readValidGrant } = harness();
    execute.mockImplementationOnce(async (statement: SQL) => {
      const update = dialect.sqlToQuery(statement);
      const selectedGrant = (await readGrant.mock.results[0].value)[0];
      expect(update.sql).toContain('"identity_session"."aily_access_token_sealed" =');
      expect(update.sql).toContain('"identity_session"."session_token_hash" =');
      expect(update.params).toEqual(expect.arrayContaining([
        selectedGrant.sealed, selectedGrant.tokenHash, selectedGrant.mappingId,
      ]));
      // Current metadata no longer matches the read grant. The atomic EXISTS
      // and the authorization recheck both reject this response's old token.
      return [];
    });
    readValidGrant.mockResolvedValueOnce([]);
    globalThis.fetch = jest.fn().mockResolvedValue(remote('Completed', '轮换后不可采用'));
    await expect(service.result(actor, attemptRef, queryRef)).rejects.toThrow('AILY_USER_REAUTHORIZATION_REQUIRED');
  });

  it('requires only identity SELECT and never requests identity UPDATE or row-lock permission', async () => {
    const row = query();
    const { service, execute, databaseExecute } = harness(row);
    execute.mockResolvedValueOnce([{ ...row, status: 'COMPLETED', answer_text: '原权限可恢复', error_code: null }]);
    globalThis.fetch = jest.fn().mockResolvedValue(remote('Completed', '原权限可恢复'));
    expect(await service.result(actor, attemptRef, queryRef)).toMatchObject({ status: 'COMPLETED', answer: '原权限可恢复' });
    const statements = databaseExecute.mock.calls.map(([statement]) => dialect.sqlToQuery(statement).sql);
    expect(statements.some(text => text.includes('FOR UPDATE'))).toBe(true);
    expect(statements.filter(text => text.trimStart().startsWith('SELECT') && text.includes('"identity_session"')))
      .toEqual([expect.not.stringMatching(/FOR (?:SHARE|UPDATE)/u)]);
    expect(statements.some(text => /UPDATE "identity_(?:session|subject_mapping)"/u.test(text))).toBe(false);
  });

  it('does not return a concurrently saved answer after authorization expires on a projection CAS miss', async () => {
    const row = query();
    const { service, execute, lockQuery, readValidGrant } = harness(row);
    lockQuery.mockResolvedValueOnce([{ ...row, status: 'COMPLETED', answer_text: '并发保存的正文' }]);
    execute.mockResolvedValueOnce([]);
    readValidGrant.mockResolvedValueOnce([]);
    globalThis.fetch = jest.fn().mockResolvedValue(remote('Completed', '迟到GET正文'));
    await expect(service.result(actor, attemptRef, queryRef)).rejects.toThrow('AILY_USER_REAUTHORIZATION_REQUIRED');
  });
});
