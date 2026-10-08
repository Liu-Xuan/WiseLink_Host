import { DocumentActivityRunRepository, type DocumentActivityRun } from '../../server/modules/canonical-host/document-activity-run.repository';
import { DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 } from '../../shared/document-activity.interface';
const scope = { tenantId: 't', actorUserId: 'reader', documentVersionId: 'DV-one' };
const contract = { promptVersion: 'v2-fixture', toolSchemaSha256: 'a'.repeat(64),
  sourceContextVersion: 'wiselink.document.activity-source-context.v1' as const, quoteTransportVersion: 'wiselink.document.activity-quote-offsets.v1' };
const input = { requestId: 'same-request', parseRunId: 'PR-one', parseRevision: 1, semanticRevision: 2,
  manifestSha256: 'b'.repeat(64), selection: { sectionIds: ['leaf'] }, expectedRevision: 3,
  candidateSchemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2, productionContract: contract };
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
