import { DocumentActivityRunRepository, type DocumentActivityRun } from '../../server/modules/canonical-host/document-activity-run.repository';
import { DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 } from '../../shared/document-activity.interface';
import { PgDialect } from 'drizzle-orm/pg-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const scope = { tenantId: 't', actorUserId: 'reader', documentVersionId: 'DV-one' };
const contract = { promptVersion: 'v2-fixture', toolSchemaSha256: 'a'.repeat(64),
  sourceContextVersion: 'wiselink.document.activity-source-context.v1' as const, quoteTransportVersion: 'wiselink.document.activity-quote-offsets.v1' };
const input = { requestId: 'same-request', parseRunId: 'PR-one', parseRevision: 1, semanticRevision: 2,
  manifestSha256: 'b'.repeat(64), selection: { sectionIds: ['leaf'] }, expectedRevision: 3,
  candidateSchemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2, productionContract: contract };
const executionModel = { modelRef: 'miaoda/glm-5.3', displayName: 'GLM5.3', providerKind: 'BUILT_IN' as const,
  settingsRevision: 1, selectedAt: '2026-10-12T00:00:00.000Z' };
function row(): DocumentActivityRun { return { ...input, documentVersionId: scope.documentVersionId,
  runRef: 'DAR-original', candidateRevision: null, status: 'RUNNING', deadline: '2026-10-06T02:00:00Z',
  deliveredRanges: [], result: null, saveCommand: null, errorCode: null }; }
function beginHarness(prior: DocumentActivityRun) {
  const execute = jest.fn().mockResolvedValueOnce([{ document_version_id: scope.documentVersionId }])
    .mockResolvedValueOnce([{ parse_run_id: input.parseRunId }]).mockResolvedValueOnce([prior]);
  const db = { execute: jest.fn(), transaction: jest.fn(async callback => callback({ execute })) };
  return { repository: new DocumentActivityRunRepository(db as never), execute, db };
}
describe('activity immutable versioned request contracts (SQL doubles, not PostgreSQL)', () => {
  it('persists a validated Host control snapshot without another column or a producer claim', async () => {
    const current = { ...row(), executionModel };
    const execute = jest.fn().mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([{ revision: input.expectedRevision }]).mockResolvedValueOnce([current]);
    const db = { transaction: jest.fn(async callback => callback({ execute })) };
    await expect(new DocumentActivityRunRepository(db as never).begin(scope, { ...input, executionModel })).resolves.toBe(current);
    const statement = new PgDialect().sqlToQuery(execute.mock.calls[4][0]);
    expect(statement.sql).toContain('producer_json');
    expect(statement.sql).toContain("CURRENT_TIMESTAMP+interval '1 hour'");
    expect(statement.params).toContain(JSON.stringify({ executionModel }));
    expect(JSON.stringify(statement.params)).not.toContain('skillVersion');
  });

  it.each([undefined, { ...executionModel, settingsRevision: -1 }])('refuses a new admission with missing or invalid model selection', async pin => {
    const execute = jest.fn().mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([{ revision: input.expectedRevision }]);
    const db = { transaction: jest.fn(async callback => callback({ execute })) };
    await expect(new DocumentActivityRunRepository(db as never).begin(scope, { ...input, executionModel: pin })).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it('preserves the winning original snapshot or historical absence on an idempotent replay', async () => {
    for (const pin of [executionModel, undefined]) {
      const prior = { ...row(), executionModel: pin }, h = beginHarness(prior);
      await expect(h.repository.begin(scope, { ...input, executionModel: { ...executionModel, settingsRevision: 2 } })).resolves.toBe(prior);
      expect(prior.executionModel).toEqual(pin);
      expect(h.execute).toHaveBeenCalledTimes(3);
    }
  });

  it('SAVE merges actual provenance while retaining the Host snapshot under the existing source/fence/CAS guards', async () => {
    const current = { ...row(), executionModel };
    const results = [[current], [{}], [{}], [current], [current], [{ revision: input.expectedRevision }], [{ run_ref: current.runRef }]];
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const execute = jest.fn(async query => { queries.push(new PgDialect().sqlToQuery(query)); return results.shift() ?? []; });
    const db = { execute, transaction: jest.fn(async callback => callback({ execute })) };
    const producer = { skillVersion: 'synthetic', modelVersion: 'actual-provider-reported-version' };
    const result = { schemaVersion: current.candidateSchemaVersion, runRef: current.runRef, candidateRevision: input.expectedRevision + 1,
      sourceBinding: { original: { documentVersionId: scope.documentVersionId, parseRunId: current.parseRunId }, semanticRevision: current.semanticRevision },
      producer: { ...producer, executionModel } };
    await new DocumentActivityRunRepository(db as never).save(scope,
      { runRef: current.runRef, leaseOwner: 'owner', leaseToken: '0f23e82b-2b1e-46ba-b62b-9e9a2ec62ca0', leaseGeneration: 1 },
      { candidate: { schemaVersion: current.candidateSchemaVersion }, producer }, () => result as never);
    const update = queries.find(query => query.sql.startsWith('UPDATE'))!;
    expect(update.sql).toContain("producer_json=COALESCE(producer_json,'{}'::jsonb)||");
    expect(update.sql).toContain('lease_generation=');
    expect(update.sql).toContain('lease_expires_at>CURRENT_TIMESTAMP');
    expect(update.params).toContain(JSON.stringify(producer));
    expect(current.executionModel).toEqual(executionModel);
  });
  it('returns the same v2 run only for exact schema/producer/source/request replay', async () => {
    const prior = row(), h = beginHarness(prior); await expect(h.repository.begin(scope,input)).resolves.toBe(prior);
    expect(h.execute).toHaveBeenCalledTimes(3);
  });
  it.each(['schema','prompt','tool','context','transport','parse-revision'] as const)('rejects changed %s on the same requestId', async kind => {
    const prior = row(), changed = structuredClone(input);
    if (kind==='schema') changed.candidateSchemaVersion = DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA as never;
    if (kind==='prompt') changed.productionContract.promptVersion = 'changed';
    if (kind==='tool') changed.productionContract.toolSchemaSha256 = 'c'.repeat(64);
    if (kind==='context') changed.productionContract.sourceContextVersion = 'changed' as never;
    if (kind==='transport') changed.productionContract.quoteTransportVersion = 'changed';
    if (kind==='parse-revision') changed.parseRevision++;
    await expect(beginHarness(prior).repository.begin(scope,changed)).rejects.toThrow('REQUEST_CONFLICT');
  });
  it('does not invent provenance for a legacy v1 replay and rejects unpinned v2 before a transaction', async () => {
    const prior = row(); prior.candidateSchemaVersion = DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA; prior.productionContract = null;
    const { candidateSchemaVersion: _schema, productionContract: _contract, ...legacy } = input;
    await expect(beginHarness(prior).repository.begin(scope,legacy)).resolves.toBe(prior);
    const h = beginHarness(row());
    await expect(h.repository.begin(scope,{...input,productionContract:null})).rejects.toThrow('PRODUCTION_CONTRACT_REQUIRED');
    expect(h.db.transaction).not.toHaveBeenCalled();
  });
});

const actualProducer = { skillVersion: 'synthetic', modelVersion: 'actual-native-version' };
function saveHarness(pin: DocumentActivityRun['executionModel'] = executionModel) {
  const current = { ...row(), executionModel: pin };
  const result = { schemaVersion: current.candidateSchemaVersion, runRef: current.runRef,
    candidateRevision: input.expectedRevision + 1, producer: { ...actualProducer, ...(pin ? { executionModel: pin } : {}) },
    sourceBinding: { original: { documentVersionId: scope.documentVersionId, parseRunId: current.parseRunId }, semanticRevision: current.semanticRevision } };
  const replies = [[current], [{}], [{}], [current], [current], [{ revision: input.expectedRevision }], [{ run_ref: current.runRef }]];
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const execute = jest.fn(async query => { queries.push(new PgDialect().sqlToQuery(query)); return replies.shift() ?? []; });
  const db = { execute, transaction: jest.fn(async callback => callback({ execute })) };
  const command = { candidate: { schemaVersion: current.candidateSchemaVersion }, producer: actualProducer };
  const save = (materialized = result) => new DocumentActivityRunRepository(db as never).save(scope,
    { runRef: current.runRef, leaseOwner: 'owner', leaseToken: '0f23e82b-2b1e-46ba-b62b-9e9a2ec62ca0', leaseGeneration: 1 },
    command, () => materialized as never);
  return { current, result, replies, queries, execute, command, save };
}

it('Host frozen producer satisfies the deployed full JSONB equality without subtracting control metadata', async () => {
  const ddl = readFileSync(resolve(__dirname, '../../server/database/derived-summary.ddl.sql'), 'utf8');
  expect(ddl).toContain("a.result_json->'producer'=to_jsonb(a)->'producer_json'");
  expect(ddl).not.toContain("- 'executionModel'");
  for (const pin of [executionModel, null]) {
    const h = saveHarness(pin);
    await expect(h.save()).resolves.toBe(h.result);
    const update = h.queries.find(query => query.sql.startsWith('UPDATE'))!;
    const actual = JSON.parse(update.params.find(value => value === JSON.stringify(actualProducer)) as string);
    const saved = JSON.parse(update.params.find(value => value === JSON.stringify(h.result)) as string);
    expect(saved.producer).toEqual({ ...(pin ? { executionModel: pin } : {}), ...actual });
    expect(update.sql).toContain('lease_generation=');
    expect(update.sql).toContain('lease_expires_at>CURRENT_TIMESTAMP');
  }
});

it.each(['missing', 'different', 'invalid', 'actual-skill', 'actual-model', 'extra'] as const)('Host frozen producer rejects %s materialized provenance without UPDATE', async kind => {
  const h = saveHarness();
  const producer: Record<string, unknown> = structuredClone(h.result.producer);
  if (kind === 'missing') delete producer.executionModel;
  if (kind === 'different') producer.executionModel = { ...executionModel, settingsRevision: 2 };
  if (kind === 'invalid') producer.executionModel = null;
  if (kind === 'actual-skill') producer.skillVersion = 'different';
  if (kind === 'actual-model') producer.modelVersion = executionModel.modelRef;
  if (kind === 'extra') producer.extra = 'unapproved';
  await expect(h.save({ ...h.result, producer } as never)).rejects.toThrow('RESULT_PRODUCER_MISMATCH');
  expect(h.queries.some(query => query.sql.startsWith('UPDATE'))).toBe(false);
});

it('Host frozen producer rejects a pin appearing between source snapshot and locked run', async () => {
  const h = saveHarness(null);
  h.replies[3] = [{ ...h.current, executionModel }];
  await expect(h.save()).rejects.toThrow('EXECUTION_MODEL_BINDING_MISMATCH');
  expect(h.queries.some(query => query.sql.startsWith('UPDATE'))).toBe(false);
});

it('Host frozen producer never invents a pin for an original legacy completed result or replay', async () => {
  const h = saveHarness(null);
  await expect(h.save({ ...h.result, producer: { ...actualProducer, executionModel } } as never)).rejects.toThrow('RESULT_PRODUCER_MISMATCH');
  expect(h.queries.some(query => query.sql.startsWith('UPDATE'))).toBe(false);
  const legacy = saveHarness(null);
  legacy.current.status = 'SAVED'; legacy.current.result = legacy.result as never; legacy.current.saveCommand = legacy.command;
  await expect(legacy.save()).resolves.toBe(legacy.result);
  expect(legacy.queries.some(query => query.sql.startsWith('UPDATE'))).toBe(false);
  expect(legacy.result.producer).toEqual(actualProducer);
});
