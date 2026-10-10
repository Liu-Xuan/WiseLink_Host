import { PgDialect } from 'drizzle-orm/pg-core';
import { DocumentReadingRunRepository } from '../../server/modules/canonical-host/document-reading-run.repository';

const scope = { tenantId: 'tenant', actorUserId: 'actor', documentVersionId: 'DV-one' };
const executionModel = { modelRef: 'provider/selected', displayName: 'Selected', providerKind: 'CUSTOM' as const,
  settingsRevision: 2, selectedAt: '2026-10-10T00:00:00Z' };
const row = { runRef: 'DRR-one', requestId: 'request-one', documentVersionId: 'DV-one', parseRunId: 'PR-one',
  parseRevision: 1, semanticRevision: 1, manifestSha256: 'a'.repeat(64), expectedRevision: 0, status: 'RUNNING', executionModel };
function fixture(results: unknown[][]) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const execute = jest.fn(async query => { queries.push(new PgDialect().sqlToQuery(query)); return results.shift() ?? []; });
  const repository = new DocumentReadingRunRepository({ execute, transaction: async fn => fn({ execute }) } as never);
  return { repository, queries };
}

it('persists the Host selection in producer_json on admission without fabricating actual model provenance', async () => {
  const f = fixture([[{}], [{}], [], [{ revision: 0 }], [row]]);
  await f.repository.begin(scope, row);
  const insert = f.queries.find(query => query.sql.startsWith('INSERT'))!;
  expect(insert.sql).toContain('producer_json');
  expect(insert.params).toContain(JSON.stringify({ executionModel }));
  expect(insert.params).not.toContain(JSON.stringify({ modelVersion: executionModel.modelRef }));
});

it('keeps the admission winner on replay even when central selection changed', async () => {
  const f = fixture([[{}], [{}], [row]]);
  expect(await f.repository.begin(scope, { ...row, executionModel: { ...executionModel, modelRef: 'provider/new' } })).toEqual(row);
  expect(f.queries.some(query => query.sql.startsWith('INSERT'))).toBe(false);
});

it('SAVE merges actual provenance and preserves the separate Host control snapshot', async () => {
  const f = fixture([[row], [{}], [{}], [row], [row], [{ revision: 0 }], [{ run_ref: row.runRef }]]);
  const producer = { skillVersion: 'fixture', modelVersion: 'provider-reported-version' };
  const result = { readingRunRef: row.runRef, readingRevision: 1,
    sourceBinding: { original: { documentVersionId: row.documentVersionId, parseRunId: row.parseRunId }, semanticRevision: 1 } };
  await f.repository.save(scope, { runRef: row.runRef, leaseOwner: 'owner', leaseToken: 'token', leaseGeneration: 1 },
    { candidate: {}, producer }, () => result as never);
  const update = f.queries.find(query => query.sql.startsWith('UPDATE'))!;
  expect(update.sql).toContain("producer_json=COALESCE(producer_json,'{}'::jsonb)||");
  expect(update.params).toContain(JSON.stringify(producer));
});

it('rejects a new admission without a frozen selection instead of silently using a runtime default', async () => {
  const f = fixture([[{}], [{}], [], [{ revision: 0 }]]);
  await expect(f.repository.begin(scope, { ...row, executionModel: undefined }))
    .rejects.toThrow('DOCUMENT_READING_EXECUTION_MODEL_REQUIRED');
  expect(f.queries.some(query => query.sql.startsWith('INSERT'))).toBe(false);
});

it('locks WI before document and rejects a pin changed after capture without an INSERT', async () => {
  const selected = { actorUserId: scope.actorUserId, documentVersionId: scope.documentVersionId,
    sourceArtifactId: 'SA-one', sourceSha256: 'b'.repeat(64), sourceByteLength: 10,
    executionModelJson: JSON.stringify({ ...executionModel, modelRef: 'provider/changed' }) };
  const f = fixture([[selected], [{}], [{}], []]);
  await expect(f.repository.begin(scope, { ...row, workItemBinding: { workItemId: 'WI-one',
    sourceArtifactId: selected.sourceArtifactId, sourceSha256: selected.sourceSha256,
    sourceByteLength: selected.sourceByteLength } } as never)).rejects.toThrow('DOCUMENT_READING_WORK_ITEM_MODEL_CHANGED');
  expect(f.queries[0].sql).toContain('work_item');
  expect(f.queries[0].sql).toContain('FOR UPDATE');
  expect(f.queries.some(query => query.sql.startsWith('INSERT'))).toBe(false);
});

it('replays the existing reading before comparing a changed WI pin', async () => {
  const f = fixture([[{ executionModelJson: JSON.stringify({ ...executionModel, modelRef: 'provider/changed' }) }], [{}], [{}], [row]]);
  expect(await f.repository.begin(scope, { ...row, workItemBinding: { workItemId: 'WI-one',
    sourceArtifactId: 'SA-one', sourceSha256: 'b'.repeat(64), sourceByteLength: 10 } })).toEqual(row);
  expect(f.queries.some(query => query.sql.startsWith('INSERT'))).toBe(false);
});

it.each(['actorUserId', 'documentVersionId', 'sourceArtifactId', 'sourceSha256', 'sourceByteLength', 'settingsRevision'])(
  'new WI admission rejects changed %s under the WI lock', async field => {
    const source = { sourceArtifactId: 'SA-one', sourceSha256: 'b'.repeat(64), sourceByteLength: 10 };
    const selected = { actorUserId: scope.actorUserId, documentVersionId: scope.documentVersionId, ...source,
      executionModelJson: JSON.stringify(field === 'settingsRevision' ? { ...executionModel, settingsRevision: 99 } : executionModel),
      ...(field === 'settingsRevision' ? {} : { [field]: field === 'sourceByteLength' ? 99 : 'changed' }) };
    const f = fixture([[selected], [{}], [{}], []]);
    await expect(f.repository.begin(scope, { ...row, workItemBinding: { workItemId: 'WI-one', ...source } }))
      .rejects.toThrow('DOCUMENT_READING_WORK_ITEM_MODEL_CHANGED');
    expect(f.queries.some(query => query.sql.startsWith('INSERT'))).toBe(false);
  });

it.each([10, '10'])('admits a matching WI pin with raw bigint %p and stores the exact frozen selection', async rawByteLength => {
  const source = { sourceArtifactId: 'SA-one', sourceSha256: 'b'.repeat(64), sourceByteLength: 10 };
  const selected = { actorUserId: scope.actorUserId, documentVersionId: scope.documentVersionId, ...source,
    executionModelJson: JSON.stringify(executionModel) };
  const f = fixture([[{ ...selected, sourceByteLength: rawByteLength }], [{}], [{}], [], [{ revision: 0 }], [row]]);
  expect(await f.repository.begin(scope, { ...row, workItemBinding: { workItemId: 'WI-one', ...source } })).toEqual(row);
  expect(f.queries[0].sql).toContain('FROM work_item');
  expect(f.queries[1].sql).toContain('FROM dm_document_version');
  expect(f.queries.at(-1)!.params).toContain(JSON.stringify({ executionModel }));
});
