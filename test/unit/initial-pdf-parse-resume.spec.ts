import { readFile } from 'node:fs/promises';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import { actionAttempt, dmDocumentVersion, workItem } from '../../server/database/schema';
import { CanonicalHostVerticalService } from '../../server/modules/canonical-host/canonical-host-vertical.service';
import { OrdinaryCanonicalAuthorizationAdapter, OrdinaryCanonicalPermissionSnapshotAdapter,
  canonicalAuthorizationDecisionFromGrant } from '../../server/modules/canonical-host/ordinary-canonical-authorization.adapter';
import { MiaodaCanonicalWorkItemRegistrarAdapter } from '../../server/modules/work-item/miaoda-canonical-work-item-registrar.adapter';
import { MiaodaHostedCanonicalObjectAccessAdapter, initializedParseSeedGrantFacts } from '../../server/modules/work-item/miaoda-hosted-canonical-object-access.adapter';
import { MiaodaWorkItemRepository } from '../../server/modules/work-item/miaoda-work-item.repository';
import { MiaodaDocumentVersionSourceResolver } from '../../server/modules/work-item/miaoda-document-version-source.resolver';
import { OrdinaryWorkItemService } from '../../server/modules/work-item/ordinary-work-item.service';
import { buildActorContextFromVerifiedIdentity } from '../../server/modules/identity/actor-context.builder';

const token = '00000000-0000-4000-8000-000000000001';
const oauth = buildActorContextFromVerifiedIdentity({ miaodaUserId: 'owner', tenantId: 'tenant',
  feishuOpenId: 'verified-open-id', feishuUserId: null, verifiedAt: '2026-01-01T00:00:00Z' } as never,
{ sessionId: 'verified-session', sessionRevision: 1 }, 'app_17bzc551rsg', 'preview');
const gateway = { ...oauth, identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT' as const,
  subjectDecision: { ...oauth.subjectDecision, source: 'MIAODA_GATEWAY_USER_CONTEXT' as const,
    version: 'miaoda-hosted-native-sso.v1' }, applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT' as const,
  env: 'runtime', platformRoles: ['wiselink_development'], feishuOpenId: null,
  feishuIdentityProvenance: 'UNAVAILABLE' as const, sessionId: null, sessionRevision: null,
  sessionProvenance: 'UNAVAILABLE' as const };
const dialect = new PgDialect();
const camel = (value: string) => value.replace(/_([a-z])/gu, (_match, char: string) => char.toUpperCase());

/** SQL/transaction fixture: real Host services, hash rules and CAS predicates;
 * external DB, source storage, producer and Reader remain isolated doubles. */
function fixture() {
  const row: Record<string, unknown> = { workItemId: 'WI-initial', requestId: 'REQ-initial', tenantId: 'tenant',
    requestedByUserId: 'owner', documentId: 'DOC', documentVersionId: 'DV', sourceArtifactId: 'SOURCE',
    sourceFileSha256: 'a'.repeat(64), sourceByteLength: 64, normalizedFamily: 'SL', runKey: `dev:${token}`,
    actionType: 'PARSE_PDF', status: 'RESERVED', revision: 0, projectionJson: null, analysisModelJson: null,
    packageId: null, packageArtifactRef: null, packageArtifactSha256: null, failureCode: null,
    failureArtifactRef: null, failureArtifactSha256: null };
  const attempt: Record<string, unknown> = { attemptId: 'ATT-initial', workItemId: 'WI-initial', attemptNo: 1,
    actionType: 'PARSE_PDF', triggerRequestId: 'REQ-initial', actorUserId: 'owner', tenantId: 'tenant',
    requestOrigin: 'MIAODA', status: 'PENDING', claimCount: 0, retryCount: 0, leaseGeneration: 0 };
  for (const field of ['startedAt', 'completedAt', 'producerRunId', 'packageArtifactRef', 'packageArtifactSha256',
    'failureArtifactRef', 'failureArtifactSha256', 'errorCode', 'errorMessage', 'executionModelJson',
    'taskEnvelopeJson', 'resultEnvelopeJson', 'leaseOwner', 'leaseToken', 'leaseExpiresAt',
    'cancelRequestedAt', 'commitStartedAt']) attempt[field] = null;
  const source = { version: { documentId: 'DOC', documentVersionId: 'DV', sourceArtifactId: 'SOURCE',
    pdfSha256: 'a'.repeat(64), byteLength: 64, lifecycleStatus: 'COMMITTED_IMMUTABLE', committedBy: 'owner' },
    family: { documentFamily: 'SL', issuerAuthority: 'BOEING', familyId: 'FAMILY',
      currentDocumentVersionId: 'DV', currentGeneration: 1 },
    artifact: { sha256: 'a'.repeat(64), byteLength: 64, readbackVerified: true,
      providerObjectId: 'OBJECT', providerVersionId: 'OBJECT' }, acquisition: { acquiredBy: 'owner' },
    preflight: { normalizedDescriptorJson: JSON.stringify({ adapterRelease: {
      adapterId: 'issuer.boeing.service_letter.v1', adapterVersion: 'v8.4-document-family-adapter.v1' } }) },
    currentness: { familyId: 'FAMILY', nextDocumentVersionId: 'DV', nextGeneration: 1 } };
  const state = { failFirstParsingCas: true, inTransaction: false, revokeInTransaction: false,
    failAttemptUpdate: false, staleSnapshotInTransaction: false };
  let transactionalAclReads = 0;
  const writes: { table: unknown; values: Record<string, unknown>; transaction: boolean; where: SQL }[] = [];
  function matches(value: Record<string, unknown>, where?: SQL): boolean {
    if (!where) return true;
    const query = dialect.sqlToQuery(where);
    for (const match of query.sql.matchAll(/"(?:work_item|action_attempt)"\."([^"]+)" = \$(\d+)/gu)) {
      if (value[camel(match[1])] !== query.params[Number(match[2]) - 1]) return false;
    }
    for (const match of query.sql.matchAll(/"(?:work_item|action_attempt)"\."([^"]+)" is null/giu)) {
      if (value[camel(match[1])] !== null) return false;
    }
    return true;
  }
  function select(fields?: Record<string, unknown>) {
    let table: unknown; let condition: SQL | undefined;
    const query = {
      from(value: unknown) { table = value; return query; },
      innerJoin() { return query; }, leftJoin() { return query; }, orderBy() { return query; },
      where(value: SQL) { condition = value; return query; }, limit() { return query; }, for() { return query; },
      then(resolve: (values: unknown[]) => unknown, reject: (error: unknown) => unknown) {
        let result: unknown[] = [];
        if (table === dmDocumentVersion) result = [structuredClone(source)];
        else {
          const value = table === workItem ? row : attempt;
          const aclRead = state.inTransaction && table === workItem && fields?.requestedByUserId !== undefined;
          if (aclRead) {
            transactionalAclReads += 1;
            if (state.staleSnapshotInTransaction && transactionalAclReads === 2) row.revision = 2;
          }
          if (!(aclRead && state.revokeInTransaction) && matches(value, condition)) {
            result = [fields ? Object.fromEntries(Object.keys(fields).map(key => [key, value[key]])) : structuredClone(value)];
          }
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return query;
  }
  const update = jest.fn((table: unknown) => ({ set: (values: Record<string, unknown>) => ({
    where: (condition: SQL) => ({ returning: async () => {
      writes.push({ table, values, transaction: state.inTransaction, where: condition });
      const target = table === workItem ? row : attempt;
      if (!matches(target, condition) || (table === actionAttempt && state.failAttemptUpdate)) return [];
      if (table === workItem && values.status === 'PARSING' && state.failFirstParsingCas) {
        state.failFirstParsingCas = false; throw new Error('POSTGRES_42601_FIRST_CAS');
      }
      const materialized = { ...values };
      if (typeof values.projectionJson !== 'string' && values.projectionJson) {
        materialized.projectionJson = dialect.sqlToQuery(values.projectionJson as SQL).params[0];
      }
      Object.assign(target, materialized);
      return [{ workItemId: row.workItemId, attemptId: attempt.attemptId }];
    }, then: (resolve: (value: unknown) => unknown) => {
      if (matches(table === workItem ? row : attempt, condition)) Object.assign(table === workItem ? row : attempt, values);
      return Promise.resolve(undefined).then(resolve);
    } }),
  }) }));
  let tail = Promise.resolve();
  const database = { select, update, insert: jest.fn(() => { throw new Error('NO_NEW_ROW_ALLOWED'); }),
    transaction: async <T>(operation: (db: unknown) => Promise<T>): Promise<T> => {
      const previous = tail; let release = () => {};
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous; const before = structuredClone({ row, attempt }); state.inTransaction = true;
      try { return await operation(database); }
      catch (error) { Object.assign(row, before.row); Object.assign(attempt, before.attempt); throw error; }
      finally { state.inTransaction = false; release(); }
    } };
  const repository = new MiaodaWorkItemRepository(database as never);
  const reserve = jest.spyOn(repository, 'reserve').mockImplementation(async input => {
    if (input.tenantId !== row.tenantId || input.actorUserId !== row.requestedByUserId
      || input.runKey !== row.runKey || input.documentVersionId !== row.documentVersionId) throw new Error('RESERVATION_IDENTITY_CONFLICT');
    return { workItemId: 'WI-initial', requestId: 'REQ-initial', attemptId: 'ATT-initial', created: row.projectionJson === null };
  });
  const access = new MiaodaHostedCanonicalObjectAccessAdapter(repository);
  const authorization = new OrdinaryCanonicalAuthorizationAdapter(access);
  const snapshots = new OrdinaryCanonicalPermissionSnapshotAdapter(access);
  const resolver = new MiaodaDocumentVersionSourceResolver(database as never);
  const producer = { producePdf: jest.fn(async () => ({ kind: 'PACKAGE',
    packageId: `urn:techpub:package:v1:sha256:${'b'.repeat(64)}`, contractId: 'techpub.parsed-package.v1',
    contractRevision: 'frozen.2', bytes: Uint8Array.of(1), strictReaderValidated: true, executionRoute: 'isolated-test' })) };
  const readback = { package: { packageId: `urn:techpub:package:v1:sha256:${'b'.repeat(64)}` },
    artifact: { ref: 'isolated-package', sha256: 'b'.repeat(64) }, receipt: { readerReceiptId: 'reader' }, fullValidatorProof: {} };
  const reader = { persistAndReadback: jest.fn(async () => readback),
    readAndQuery: jest.fn(async () => readback) };
  const vertical = new CanonicalHostVerticalService(new MiaodaCanonicalWorkItemRegistrarAdapter(repository),
    producer as never, authorization, snapshots, {} as never, reader as never,
    { status: jest.fn(() => ({})) } as never, {} as never, null,
    undefined, undefined, undefined, undefined, repository);
  const claim = jest.spyOn(repository, 'claimInitializedParseRequest');
  const service = new OrdinaryWorkItemService({} as never, resolver, repository, vertical, {} as never,
    { organizeWorkItemIntake: jest.fn(async () => ({})) } as never,
    { withVerifiedServiceSql: (operation: () => Promise<unknown>) => operation() } as never);
  const submit = (actor = oauth, native = gateway) => service.createOauthSessionDevelopmentRun({
    documentVersionId: 'DV', developmentRunToken: token, query: 'applicability' }, actor, native);
  const initialized = async () => {
    await expect(submit()).rejects.toThrow('POSTGRES_42601_FIRST_CAS');
    expect(row.revision).toBe(1); expect(row.status).toBe('PARSE_REQUESTED');
    expect(attempt.status).toBe('PENDING'); expect(producer.producePdf).not.toHaveBeenCalled();
  };
  return { row, attempt, source, state, writes, database, repository, reserve, claim, producer, reader,
    submit, initialized, projection: () => JSON.parse(String(row.projectionJson)) as CanonicalWorkItemProjection };
}

describe('same-request recovery after initial projection partial commit', () => {
  it('proves the old seed, atomically rebinds and starts the same WI/attempt exactly once', async () => {
    const f = fixture(); await f.initialized(); const old = f.projection().parseAuthorization;
    await expect(f.submit()).resolves.toMatchObject({ workItemCreated: false, workItemReused: true,
      result: { status: 'CANDIDATE_VERTICAL_VERIFIED', workItem: { workItemId: 'WI-initial', requestId: 'REQ-initial' } } });
    expect(f.projection().revision).toBe(3); expect(f.projection().parseAuthorization.actorFingerprint).toBe(old.actorFingerprint);
    expect(f.projection().parseAuthorization.decisionHash).not.toBe(old.decisionHash);
    expect(f.attempt.attemptId).toBe('ATT-initial'); expect(f.attempt.attemptNo).toBe(1);
    expect(f.producer.producePdf).toHaveBeenCalledTimes(1); expect(f.database.insert).not.toHaveBeenCalled();
    const resumed = f.writes.find(write => write.transaction && write.table === workItem);
    expect(resumed?.values).toMatchObject({ status: 'PARSING', revision: 2 });
    expect(dialect.sqlToQuery(resumed!.where).params).toContain(1);
    expect(f.writes.some(write => write.transaction && write.table === actionAttempt && write.values.status === 'PARSING')).toBe(true);
  });

  it.each(['decisionHash', 'decisionId', 'permissionSnapshotVersion', 'actorFingerprint'])('refuses a frozen revision0 %s mismatch', async field => {
    const f = fixture(); await f.initialized(); const saved = f.projection();
    (saved.parseAuthorization as unknown as Record<string, string>)[field] = 'changed';
    f.row.projectionJson = JSON.stringify(saved);
    await expect(f.submit()).rejects.toThrow('WORK_ITEM_AUTHORIZATION_IDEMPOTENCY_COLLISION');
    expect(f.row.revision).toBe(1); expect(f.producer.producePdf).not.toHaveBeenCalled();
  });

  it('fails fresh owner authorization inside the transaction without changing the residue', async () => {
    const f = fixture(); await f.initialized(); f.state.revokeInTransaction = true;
    await expect(f.submit()).rejects.toThrow('CANONICAL_WORK_ITEM_NOT_FOUND');
    expect(f.row.revision).toBe(1); expect(f.attempt.status).toBe('PENDING'); expect(f.producer.producePdf).not.toHaveBeenCalled();
  });

  it('rejects a stale second permission read within the recovery transaction', async () => {
    const f = fixture(); await f.initialized(); f.state.staleSnapshotInTransaction = true;
    await expect(f.submit()).rejects.toThrow('AUTHORIZATION_STALE_PERMISSION_SNAPSHOT');
    expect(f.row.revision).toBe(1); expect(f.attempt.status).toBe('PENDING'); expect(f.producer.producePdf).not.toHaveBeenCalled();
  });

  it.each(['provider', 'hash', 'current', 'owner'])('refuses fresh source %s changes', async field => {
    const f = fixture(); await f.initialized();
    if (field === 'provider') f.source.artifact.providerObjectId = 'changed';
    if (field === 'hash') { f.source.version.pdfSha256 = 'c'.repeat(64); f.source.artifact.sha256 = 'c'.repeat(64); }
    if (field === 'current') f.source.family.currentDocumentVersionId = 'changed';
    if (field === 'owner') f.source.acquisition.acquiredBy = 'changed';
    await expect(f.submit()).rejects.toThrow();
    expect(f.row.revision).toBe(1); expect(f.producer.producePdf).not.toHaveBeenCalled();
  });

  it.each(['model', 'started', 'producer', 'attempt2', 'phase', 'revision'])('does not broaden recovery to %s state', async field => {
    const f = fixture(); await f.initialized();
    if (field === 'model') f.row.analysisModelJson = JSON.stringify({ modelRef: 'kept-model' });
    if (field === 'started') f.attempt.startedAt = new Date();
    if (field === 'producer') f.attempt.producerRunId = 'already-produced';
    if (field === 'attempt2') f.attempt.attemptNo = 2;
    if (field === 'phase' || field === 'revision') {
      const saved = f.projection();
      if (field === 'phase') saved.phase = 'PARSING'; else { saved.revision = 2; f.row.revision = 2; }
      f.row.projectionJson = JSON.stringify(saved);
    }
    await expect(f.submit()).rejects.toThrow(); expect(f.producer.producePdf).not.toHaveBeenCalled();
  });

  it('rolls back the authorization/phase CAS if the original attempt cannot be started', async () => {
    const f = fixture(); await f.initialized(); f.state.failAttemptUpdate = true;
    const before = f.row.projectionJson;
    await expect(f.submit()).rejects.toThrow('WORK_ITEM_CAS_CONFLICT');
    expect(f.row.projectionJson).toBe(before); expect(f.row.revision).toBe(1);
    expect(f.attempt.status).toBe('PENDING'); expect(f.producer.producePdf).not.toHaveBeenCalled();
  });

  it('serializes concurrent same-request recovery so only one producer can start', async () => {
    const f = fixture(); await f.initialized();
    const results = await Promise.allSettled([f.submit(), f.submit()]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(f.producer.producePdf).toHaveBeenCalledTimes(1);
    expect(f.database.insert).not.toHaveBeenCalled(); expect(f.attempt.attemptNo).toBe(1);
  });

  it('rejects actor or tenant changes on the retained request', async () => {
    for (const field of ['actor', 'tenant']) {
      const f = fixture(); await f.initialized();
      const actor = field === 'actor' ? { ...oauth, canonicalSubject: { ...oauth.canonicalSubject, id: 'other' } }
        : { ...oauth, tenantId: 'other' };
      const native = { ...gateway, canonicalSubject: actor.canonicalSubject, tenantId: actor.tenantId };
      await expect(f.submit(actor, native)).rejects.toThrow(); expect(f.producer.producePdf).not.toHaveBeenCalled();
    }
  });
});

const realBindingPath = process.env.WL31_REAL_SL_BINDING_PATH?.trim();
(realBindingPath ? it : it.skip)('reproduces the exact frozen authorization from the actual read-only SL row', async () => {
  const row = JSON.parse(await readFile(realBindingPath as string, 'utf8')).data[0];
  const projection = JSON.parse(row.projection);
  const actor = buildActorContextFromVerifiedIdentity({ miaodaUserId: row.requested_by_user_id,
    tenantId: row.tenant_id, feishuOpenId: 'unconsumed-fixture', feishuUserId: null,
    verifiedAt: row.created_at } as never, { sessionId: 'unconsumed-fixture', sessionRevision: 1 }, 'app_17bzc551rsg', 'preview');
  const binding = { workItemId: row.work_item_id, revision: row.revision, tenantId: row.tenant_id,
    requestId: row.request_id, documentId: row.document_id, documentVersionId: row.document_version_id,
    requestedByUserId: row.requested_by_user_id, runKey: row.run_key };
  const decision = canonicalAuthorizationDecisionFromGrant('PARSE_PDF', initializedParseSeedGrantFacts(actor, binding));
  expect(decision.actorFingerprint).toBe(projection.parseAuthorization.actorFingerprint);
  expect(decision.decisionHash).toBe(projection.parseAuthorization.decisionHash);
  expect(decision.permissionSnapshotVersion).toBe(projection.permissionSnapshotVersion);
  expect(row.analysis_model_json).toBeNull(); expect(projection.revision).toBe(1); expect(projection.phase).toBe('PARSE_REQUESTED');
});
