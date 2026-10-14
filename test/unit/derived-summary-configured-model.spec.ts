import { PgDialect } from 'drizzle-orm/pg-core';
import type { RequestDerivedSummaryUpdate, DerivedSummaryContextBasis } from '@shared/derived-summary.interface';
import { canonicalJson } from '../../server/modules/action-attempt/action-attempt-envelope';
import { CanonicalModelSettingsService } from '../../server/modules/model-settings/canonical-model-settings.service';
import { DerivedSummaryService, checkedSummaryTask, type DerivedSummaryRuntimeTask } from '../../server/modules/canonical-host/derived-summary.service';
import type { SummaryAttempt, SummaryHead } from '../../server/modules/canonical-host/derived-summary.repository';
import { contextMemberNotices } from '../../server/modules/canonical-host/derived-summary-current-context';
import { HierarchicalWikiService } from '../../server/modules/canonical-host/hierarchical-wiki.service';
import type { WikiRow } from '../../server/modules/canonical-host/hierarchical-wiki.persistence';
import { emptyWikiDemand } from '../../server/modules/canonical-host/hierarchical-wiki-demand';
import { parseSummaryRequest } from '../../server/modules/canonical-host/derived-summary.validation';
import { summaryRevision } from './fixtures/derived-summary';

const dialect = new PgDialect();
const owner = { tenantId: 'tenant-model', actorUserId: 'actor-model' };
const runtimeScope = { appId: 'app_17bzc551rsg', tenantId: owner.tenantId, principalId: 'service-model' };
const reading = summaryRevision().members[0]!;
const scope = { ...summaryRevision().scope, kind: 'FLEET' as const, ata2: null, ata4: null };
const command = (requestId: string, modelRef?: string): RequestDerivedSummaryUpdate => ({
  requestId, expectedSummaryRevision: 0, scope, members: [reading.member], instruction: '完整综合选定保存材料',
  ...(modelRef === undefined ? {} : { modelRef }),
});

/** Exercises real reserve/next/checked-task code and its inserted envelopes.
 * Context authorization, inventory and storage are deterministic transaction doubles;
 * this fixture dispatches no native model, HTTP request or physical database operation. */
function setup() {
  const attempts = new Map<string, SummaryAttempt>();
  let setting = { tenantId: owner.tenantId, modelRef: 'miaoda/glm-5.3', revision: 1, updatedAt: new Date() };
  const settingsRepository = { read: jest.fn(async () => ({ ...setting })) };
  const models = new CanonicalModelSettingsService(settingsRepository as never);
  const head = { summaryId: 'DS-model', ...owner, currentRevision: 0, currentSummaryRef: null } as SummaryHead;
  const basis: DerivedSummaryContextBasis = { schemaVersion: 'wiselink.derived-summary-context.v1',
    memberNotices: contextMemberNotices([reading]), sources: [], workItems: [], matters: [], summaries: [],
    uncoordinatedDependencies: ['OFFLINE_TRANSACTION_DOUBLE'] };
  let wikiRow: WikiRow | null = { wikiId: 'WIKI-model', summaryId: head.summaryId, ...owner,
    scope, parentWikiId: null, principalId: runtimeScope.principalId, modelRef: 'miaoda/minimax-m3', enabled: true,
    lastEventSeq: '0', lastInventoryAt: null, inventoryCursor: null, upstreamDelegations: {},
    state: { ...emptyWikiDemand(), desiredGeneration: 1, firstDirtyAt: '2026-10-13T00:00:00Z',
      dueAt: '2026-10-13T00:00:00Z', versions: { selected: reading.member } } };
  let serializedPrior: SummaryAttempt | null = null;
  let priorReads = 0;
  const database = {
    select: jest.fn(() => ({ from: () => ({ where: (predicate: Parameters<PgDialect['sqlToQuery']>[0]) => ({
      limit: async () => {
        const { params } = dialect.sqlToQuery(predicate);
        const key = params.find(value => typeof value === 'string' && value.startsWith('derived-summary:'));
        if (key) {
          priorReads++;
          const rows = [...attempts.values()].filter(item => item.idempotencyKey === key);
          if (serializedPrior && priorReads === 2) {
            attempts.set(serializedPrior.operationRef!, serializedPrior);
            return [{ attemptRef: serializedPrior.operationRef }];
          }
          return rows.map(item => ({ attemptRef: item.operationRef }));
        }
        return [...attempts.values()].filter(item => ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(item.status))
          .map(item => ({ ref: item.operationRef }));
      },
    }) }) })),
    execute: jest.fn(async (statement: Parameters<PgDialect['sqlToQuery']>[0]) => {
      const query = dialect.sqlToQuery(statement);
      const objects = query.params.flatMap(value => {
        if (typeof value !== 'string') return [];
        try { return [JSON.parse(value)]; } catch { return []; }
      });
      if (query.sql.includes('INSERT INTO action_attempt')) {
        const task = objects.find(value => value.schemaVersion === 'wiselink.derived-summary-task.v1') as DerivedSummaryRuntimeTask;
        const input = objects.find(value => value.requestId === task.requestId && value.instruction) as RequestDerivedSummaryUpdate;
        if (!task || !input) throw new Error('OFFLINE_INSERT_NOT_RECOGNIZED');
        const attempt = { attemptId: task.actionAttemptId, operationRef: task.operationRef, summaryId: task.subject.summaryId,
          ...owner, status: 'QUEUED', triggerRequestId: task.requestId, inputRevision: task.expectedSummaryRevision,
          baseRevision: task.expectedSummaryRevision, deadlineAt: new Date(task.deadlineAt),
          taskEnvelopeJson: canonicalJson(task), taskInputHash: task.taskInputHash,
          executionModelJson: canonicalJson(task.executionModel), requestCommandJson: canonicalJson(input),
          idempotencyKey: `derived-summary:${task.subject.summaryId}:${task.requestId}`,
          delegatedPrincipalId: runtimeScope.principalId } as SummaryAttempt;
        attempts.set(task.operationRef, attempt);
        return [];
      }
      if (query.sql.includes('hierarchical_wiki_runtime_owners')) return [{ actorUserId: owner.actorUserId }];
      if (query.sql.includes('INSERT INTO hierarchical_wiki_scope')) {
        const state = objects.find(value => value.schemaVersion === 1);
        const savedScope = objects.find(value => value.fleetFamilyId);
        wikiRow = { wikiId: query.params.find(value => typeof value === 'string' && value.startsWith('WIKI-')),
          summaryId: query.params.find(value => typeof value === 'string' && value.startsWith('DS-')), ...owner,
          scope: savedScope, parentWikiId: null, principalId: runtimeScope.principalId,
          modelRef: query.params[8], enabled: true, state, lastEventSeq: '0', lastInventoryAt: null,
          inventoryCursor: null, upstreamDelegations: {} } as WikiRow;
        return [structuredClone(wikiRow)];
      }
      if (query.sql.includes('FROM hierarchical_wiki_scope')) return wikiRow ? [structuredClone(wikiRow)] : [];
      if (query.sql.includes('UPDATE hierarchical_wiki_scope SET state_json')) {
        const state = objects.find(value => value.schemaVersion === 1);
        if (!wikiRow || !state) throw new Error('OFFLINE_WIKI_STATE_NOT_RECOGNIZED');
        wikiRow.state = state;
      }
      return [];
    }),
  };
  const repository = { head: jest.fn(async () => head), attempt: jest.fn(async (_id: string, ref: string) => {
    const saved = attempts.get(ref); if (!saved) throw new Error('OFFLINE_ATTEMPT_MISSING'); return saved;
  }), contextBasis: jest.fn(async () => structuredClone(basis)), lockContext: jest.fn(async () => undefined),
    browser: jest.fn(async (_actor: unknown, operation: Function) => operation(database, owner)) };
  const members = { readAll: jest.fn(async () => [structuredClone(reading)]),
    authorizeActor: jest.fn(async () => undefined),
    withNativeTransaction: jest.fn(async (_actor: unknown, _db: unknown, _authority: unknown, operation: Function) => operation()) };
  const authorization = { authorizeOpenClawAutoWorkItemQueue: jest.fn(async () => runtimeScope) };
  const summaries = new DerivedSummaryService(repository as never, members as never, authorization as never, undefined, models);
  const transactions = { withActorTransaction: jest.fn(async (_actor: string, operation: Function) => operation({ database })) };
  const fleet = { readLibraryCatalog: jest.fn(async () => ({ status: 'AVAILABLE',
    families: [{ fleetFamily: scope.fleetFamilyId, models: scope.fleetModelIds }] })) };
  const wiki = new HierarchicalWikiService(database as never, repository as never, summaries, members as never,
    transactions as never, fleet as never, authorization as never, undefined, models);
  // No inventory or source discovery is run by this model-selection test.
  Object.assign(wiki, { refresh: jest.fn(async () => undefined), readList: jest.fn(async () => ({ items: [] })) });
  return { attempts, database, repository, members, models, settingsRepository, summaries, wiki, head,
    setSetting: (modelRef: string, revision: number) => { setting = { ...setting, modelRef, revision }; },
    row: () => wikiRow!, removeWiki: () => { wikiRow = null; },
    injectSerializedReplay: (saved: SummaryAttempt) => { serializedPrior = saved; priorReads = 0; },
    reserve: (input: RequestDerivedSummaryUpdate) => summaries.reserve(input, owner, head, database as never),
    task: (ref: string) => checkedSummaryTask(attempts.get(ref)!),
  };
}

describe('configured model captured only for new summary/Wiki reservations', () => {
  it('captures real settings revision in a new reservation, then uses a changed setting for the next new request', async () => {
    const f = setup();
    const first = await f.reserve(command('configured-one'));
    expect(f.task(first.attemptRef).modelInput).not.toHaveProperty('wikiLevel');
    expect(f.task(first.attemptRef).executionModel).toMatchObject({ modelRef: 'miaoda/glm-5.3', settingsRevision: 1 });
    expect(f.settingsRepository.read).toHaveBeenCalledWith(owner.tenantId, f.database);
    expect(JSON.parse(f.attempts.get(first.attemptRef)!.requestCommandJson!)).not.toHaveProperty('modelRef');
    f.attempts.get(first.attemptRef)!.status = 'SUCCEEDED';
    f.setSetting('miaoda/minimax-m3', 2);
    const next = await f.reserve(command('configured-two'));
    expect(f.task(next.attemptRef).executionModel).toMatchObject({ modelRef: 'miaoda/minimax-m3', settingsRevision: 2 });
    expect(f.task(first.attemptRef).executionModel).toMatchObject({ modelRef: 'miaoda/glm-5.3', settingsRevision: 1 });
  });

  it.each(['QUEUED', 'RUNNING', 'CANCELLED', 'FAILED', 'SUCCEEDED'])('replays %s with original hash/model/deadline and no new capture or attempt', async status => {
    const f = setup(), input = command('same-configured');
    const first = await f.reserve(input), saved = f.attempts.get(first.attemptRef)!;
    saved.status = status as SummaryAttempt['status'];
    const before = structuredClone(saved);
    f.setSetting('miaoda/miaoda-model-flash', 9); f.settingsRepository.read.mockClear();
    const replay = await f.reserve(input);
    expect(replay).toMatchObject({ attemptRef: first.attemptRef, created: false, status });
    expect(saved).toEqual(before); expect(f.attempts.size).toBe(1); expect(f.settingsRepository.read).not.toHaveBeenCalled();
  });

  it('a request past its frozen deadline does not acquire a new deadline or model on replay', async () => {
    const f = setup(), input = command('expired-original');
    const first = await f.reserve(input), saved = f.attempts.get(first.attemptRef)!, before = structuredClone(saved);
    f.setSetting('miaoda/miaoda-model-flash', 9); f.settingsRepository.read.mockClear();
    jest.useFakeTimers({ now: saved.deadlineAt!.getTime() + 60_000 });
    try {
      expect(await f.reserve(input)).toMatchObject({ attemptRef: first.attemptRef, created: false });
      expect(saved).toEqual(before); expect(f.attempts.size).toBe(1); expect(f.settingsRepository.read).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
  });

  it('keeps explicit single-request selection and rejects omitted-model replay of an old explicit command', async () => {
    const f = setup(), original = command('explicit-one', 'miaoda/minimax-m3');
    const first = await f.reserve(original);
    expect(f.task(first.attemptRef).executionModel).toMatchObject({ modelRef: 'miaoda/minimax-m3', settingsRevision: 0 });
    expect(f.settingsRepository.read).not.toHaveBeenCalled();
    f.setSetting('miaoda/miaoda-model-flash', 2);
    await expect(f.reserve(command(original.requestId))).rejects.toMatchObject({ code: 'DERIVED_SUMMARY_REQUEST_ID_REUSED' });
    await expect(f.reserve({ ...original, modelRef: 'miaoda/glm-5.3' })).rejects.toMatchObject({ code: 'DERIVED_SUMMARY_REQUEST_ID_REUSED' });
    expect((await f.reserve(original)).attemptRef).toBe(first.attemptRef);
    expect(f.attempts.size).toBe(1); expect(f.settingsRepository.read).not.toHaveBeenCalled();
  });

  it('serialized replay after the target lock never captures a newer configuration', async () => {
    const first = setup(), input = command('serialized');
    const receipt = await first.reserve(input), saved = first.attempts.get(receipt.attemptRef)!;
    const f = setup(); f.setSetting('miaoda/miaoda-model-flash', 12); f.injectSerializedReplay(saved);
    expect(await f.reserve(input)).toMatchObject({ attemptRef: receipt.attemptRef, created: false });
    expect(f.settingsRepository.read).not.toHaveBeenCalled(); expect(f.database.execute).not.toHaveBeenCalled();
  });

  it.each(['retired/model', 'settings-error', 'denied-members', 'active', 'revision'])('fails %s without a fallback or new attempt', async condition => {
    const f = setup();
    if (condition === 'retired/model') f.setSetting(condition, 3);
    if (condition === 'settings-error') f.settingsRepository.read.mockRejectedValue(new Error('settings failed'));
    if (condition === 'denied-members') f.members.readAll.mockRejectedValue(new Error('member denied'));
    if (condition === 'active') {
      const receipt = await f.reserve(command('existing')); f.settingsRepository.read.mockClear();
      expect(f.attempts.get(receipt.attemptRef)!.status).toBe('QUEUED');
    }
    if (condition === 'revision') f.head.currentRevision = 1;
    const before = f.attempts.size;
    await expect(f.reserve(command('rejected'))).rejects.toThrow();
    expect(f.attempts.size).toBe(before);
    if (['denied-members', 'active', 'revision'].includes(condition)) expect(f.settingsRepository.read).not.toHaveBeenCalled();
  });

  it('an existing Wiki with a stale registration model admits current configured model and resumes the same active snapshot', async () => {
    const f = setup(), legacy = f.row().modelRef;
    // This selected leaf is an ATA4 generation, not a direct fleet member.
    f.row().scope = summaryRevision().scope;
    const result = await f.wiki.next('2026-10-14T00:00:00Z');
    expect(result.status).toBe('SUMMARY_PENDING');
    if (result.status !== 'SUMMARY_PENDING') throw new Error('EXPECTED_OFFLINE_SUMMARY');
    const task = f.task(result.attemptRef);
    expect(task.modelInput.wikiLevel).toBe('ATA4');
    expect(task.executionModel).toMatchObject({ modelRef: 'miaoda/glm-5.3', settingsRevision: 1 });
    expect(JSON.parse(f.attempts.get(result.attemptRef)!.requestCommandJson!)).not.toHaveProperty('modelRef');
    expect(f.row().modelRef).toBe(legacy);
    f.setSetting('miaoda/miaoda-model-flash', 2); f.settingsRepository.read.mockClear();
    expect(await f.wiki.next('2026-10-14T00:01:00Z')).toEqual(result);
    expect(f.task(result.attemptRef)).toEqual(task); expect(f.settingsRepository.read).not.toHaveBeenCalled();
    expect(f.attempts.size).toBe(1);
  });

  it('seals a parent Wiki with exact saved child identity while ordinary callers cannot request the internal marker', async () => {
    const f = setup();
    const child = { ...structuredClone(reading), member: { kind: 'DERIVED_SUMMARY' as const,
      summaryId: 'DS-child-exact', summaryRef: 'DSR-child-exact', summaryRevision: 2 },
      body: '完整的已保存子层正文', issues: [] };
    f.members.readAll.mockResolvedValue([child]);
    const basis = await f.repository.contextBasis();
    f.repository.contextBasis.mockResolvedValue({ ...basis, memberNotices: contextMemberNotices([child]) });
    const input = { ...command('wiki-parent'), members: [child.member] };
    const receipt = await f.summaries.reserve(input, owner, f.head, f.database as never, 'FLEET');
    expect(f.task(receipt.attemptRef).modelInput).toMatchObject({ wikiLevel: 'FLEET', members: [child] });
    expect(JSON.parse(f.attempts.get(receipt.attemptRef)!.requestCommandJson!)).not.toHaveProperty('wikiLevel');
    expect(() => parseSummaryRequest({ ...input, wikiLevel: 'FLEET' }, true)).toThrow('DERIVED_SUMMARY_INPUT_INVALID');
  });

  it('does not reserve or capture a model when a marked parent directly selects leaf work', async () => {
    const f = setup();
    await expect(f.summaries.reserve(command('mixed-parent'), owner, f.head, f.database as never, 'FLEET'))
      .rejects.toThrow('WIKI_LAYER_MEMBERS_INVALID');
    expect(f.attempts.size).toBe(0); expect(f.settingsRepository.read).not.toHaveBeenCalled();
  });

  it('new Wiki registration inherits available configured model without a GLM-only exception', async () => {
    const f = setup(); f.removeWiki(); f.setSetting('miaoda/miaoda-model-flash', 4);
    await f.wiki.enable({ fleetFamilyId: scope.fleetFamilyId, fleetModelId: null }, { tenantId: owner.tenantId } as never);
    expect(f.row().modelRef).toBe('miaoda/miaoda-model-flash');
    expect(f.settingsRepository.read).toHaveBeenCalledWith(owner.tenantId, f.database);
    expect(f.attempts.size).toBe(0);
  });

  it('rejects a differing explicit legacy registration model rather than silently replacing it', async () => {
    const f = setup(), before = structuredClone(f.row());
    await expect(f.wiki.enable({ fleetFamilyId: scope.fleetFamilyId, fleetModelId: null,
      modelRef: 'miaoda/minimax-m3' }, { tenantId: owner.tenantId } as never)).rejects
      .toMatchObject({ code: 'WIKI_AUTOMATIC_MODEL_CONFIGURATION_MISMATCH' });
    expect(f.row()).toEqual(before); expect(f.attempts.size).toBe(0);
  });

  it.each([null, '', 1, undefined])('rejects explicit malformed modelRef %s while omission means inherit', modelRef => {
    expect(() => parseSummaryRequest({ ...command('bad-model'), modelRef }, true)).toThrow('DERIVED_SUMMARY_INPUT_INVALID');
    expect(parseSummaryRequest(command('inherit'), true)).not.toHaveProperty('modelRef');
  });
});
