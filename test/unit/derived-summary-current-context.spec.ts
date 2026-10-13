import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { spawnSync } from 'node:child_process';
import type { DerivedSummaryContextBasis, DerivedSummaryMember, DerivedSummaryMemberReading,
  RequestDerivedSummaryUpdate } from '../../shared/derived-summary.interface';
import type { AssessmentEvidence } from '../../shared/assessment-reading.interface';
import { canonicalJson, canonicalSha256 } from '../../server/modules/action-attempt/action-attempt-envelope';
import { taskModelSelection } from '../../server/modules/model-settings/canonical-model-catalog';
import { DerivedSummaryRepository } from '../../server/modules/canonical-host/derived-summary.repository';
import { DerivedSummaryService, checkedSummaryTask } from '../../server/modules/canonical-host/derived-summary.service';
import { ActionAttemptRepository } from '../../server/modules/action-attempt/action-attempt.repository';
import { DerivedSummaryRuntimeService } from '../../server/modules/canonical-host/derived-summary-runtime.service';
import { assertSummaryContextBasis, assertSummaryContextUnchanged, summaryContextStatus } from '../../server/modules/canonical-host/derived-summary-current-context';
import { buildSummaryRevisionContext } from '../../server/modules/canonical-host/derived-summary-revision-context';

const owner = { tenantId: 'tenant-one', actorUserId: 'actor-one' };
const scope = { kind: 'ATA4' as const, title: 'Explicit selection', fleetFamilyId: 'B787',
  fleetModelIds: ['B787-9'], ata2: '46', ata4: '46-00', selectionReason: 'Selected by user' };
const work: DerivedSummaryMember = { kind: 'WORK_ITEM_WORK', workItemId: 'W-one',
  documentVersionId: 'DV-A', workRef: 'WR-one', workRevision: 1, issueKeys: ['issue-one'] };
const source: AssessmentEvidence = { kind: 'DOCUMENT_PASSAGE', evidenceRef: 'source-one', title: 'Selected source',
  versionLabel: 'R1', excerpt: 'Stable source passage', workItemId: 'W-one', documentVersionId: 'DV-A',
  sourceRefId: 'SR-one', locator: 'page one' };
const reading: DerivedSummaryMemberReading = { member: work, evidenceRef: 'member-W-one', headline: 'Saved work',
  body: 'Stable authorized member body', issues: [{ issueKey: 'issue-one' }] as DerivedSummaryMemberReading['issues'],
  evidence: [source], rootRefs: [], limitations: ['candidate only'], current: true, overviewStatus: 'CURRENT', leaves: [work] };
const request = (requestId: string, revision: number): RequestDerivedSummaryUpdate => ({ requestId,
  expectedSummaryRevision: revision, scope, members: [work],
  instruction: 'Synthesize the selected saved work', modelRef: 'miaoda/glm-5.3' });
const copy = <T>(value: T): T => structuredClone(value);
const dialect = new PgDialect();

/** A deterministic transaction double: SELECT sees committed rows and FOR SHARE records
 * the exact Host head locks. It does not assert physical PostgreSQL isolation. */
function hostRows() {
  const state = { family: { familyId: 'F-one', selectedHead: 'DV-A', currentGeneration: 1, status: 'ACTIVE' },
    projection: { integratedAssessment: { status: 'CURRENT', baseRules: { sourceResultId: 'BASE-one', revision: 1,
      artifact: { sha256: 'a'.repeat(64) } }, overallSynthesis: { sourceResultId: 'OVERALL-one', revision: 1,
      artifact: { sha256: 'b'.repeat(64) }, status: 'CURRENT', staleReason: null, basedOnJobAidWorkRevisionRef: 'WR-one' },
      engineerReviews: { revision: 1 } } },
    available: true, locks: [] as string[], revisionRows: [] as Array<Record<string, unknown>>,
    publishedParse: null as DerivedSummaryContextBasis['sources'][number]['publishedParse'],
    semanticRevisions: [] as NonNullable<DerivedSummaryContextBasis['sources'][number]['semanticRevisions']> };
  const database = {
    execute: jest.fn(async (statement: Parameters<PgDialect['sqlToQuery']>[0]) => {
      expect(dialect.sqlToQuery(statement).sql).toContain('dm_document_semantic_revision');
      return copy(state.semanticRevisions);
    }),
    select: jest.fn((_fields?: unknown) => ({ from: (table: unknown) => {
      const name = getTableName(table as Parameters<typeof getTableName>[0]);
      let params: unknown[] = [];
      const rows = () => {
        if (name === 'dm_document_version') return [{ ...state.family }];
        if (name === 'dm_document_parse_run') return state.publishedParse ? [copy(state.publishedParse)] : [];
        if (name === 'work_item') return state.available ? [{ workItemId: 'W-one', documentVersionId: 'DV-A', revision: 1,
          projectionJson: JSON.stringify(state.projection) }] : [];
        if (name === 'assessment_work_revision') return [{ ref: 'WR-one', revision: 1 }];
        if (name === 'derived_summary_revision') return state.revisionRows.filter(row =>
          params.includes(row.requestId) || params.includes(row.summaryRef) || params.includes(row.revision));
        return [];
      };
      const query = { innerJoin: (_table: unknown, _on: unknown) => query,
        where: (predicate: Parameters<PgDialect['sqlToQuery']>[0]) => {
          params = dialect.sqlToQuery(predicate).params; return query;
        }, orderBy: (_order: unknown) => query, limit: async (_n: number) => rows(),
        for: async (mode: string) => { state.locks.push(`${mode}:${name}`); return rows(); },
        then: (resolve: (value: unknown[]) => void) => resolve(rows()) };
      return query;
    } })),
  };
  return { state, database };
}

describe('derived summary current-context Host observations', () => {
  it('captures source family head/generation and result state; A→B→A and same work revision/result correction both fence', async () => {
    const h = hostRows();
    const repository = new DerivedSummaryRepository({} as never, {} as never, {} as never);
    const captured = await repository.contextBasis([reading], owner, h.database as never);
    expect(captured).toMatchObject({ sources: [{ documentVersionId: 'DV-A', familyId: 'F-one',
      selectedHead: 'DV-A', currentGeneration: 1 }], workItems: [{ workItemId: 'W-one',
      currentWorkRef: 'WR-one', currentWorkRevision: 1, resultState: { overallResultRef: 'OVERALL-one' } }] });
    await repository.lockContext(captured, owner, h.database as never);
    expect(h.state.locks).toEqual(['share:dm_publication_family', 'share:dm_document_version', 'share:work_item']);
    h.state.family.selectedHead = 'DV-B'; h.state.family.currentGeneration = 2;
    expect(() => assertSummaryContextUnchanged(captured, { ...captured,
      sources: [{ ...captured.sources[0]!, ...h.state.family }] })).toThrow('DERIVED_SUMMARY_CONTEXT_CHANGED');
    h.state.family.selectedHead = 'DV-A'; h.state.family.currentGeneration = 3;
    const returned = await repository.contextBasis([reading], owner, h.database as never);
    expect(returned.sources[0]).toMatchObject({ selectedHead: 'DV-A', currentGeneration: 3 });
    expect(() => assertSummaryContextUnchanged(captured, returned)).toThrow('DERIVED_SUMMARY_CONTEXT_CHANGED');
    h.state.family.currentGeneration = 1;
    h.state.projection.integratedAssessment.overallSynthesis.sourceResultId = 'OVERALL-corrected';
    const corrected = await repository.contextBasis([reading], owner, h.database as never);
    expect(corrected.workItems[0]).toMatchObject({ currentWorkRef: 'WR-one', currentWorkRevision: 1,
      resultState: { overallResultRef: 'OVERALL-corrected' } });
    expect(() => assertSummaryContextUnchanged(captured, corrected)).toThrow('DERIVED_SUMMARY_CONTEXT_CHANGED');
  });

  it('fences the first semantic registration and later revisions on the same document without claiming lifecycle/publisher currentness', async () => {
    const h = hostRows();
    const repository = new DerivedSummaryRepository({} as never, {} as never, {} as never);
    const absent = await repository.contextBasis([reading], owner, h.database as never);
    h.state.semanticRevisions = [{ parseRunId: 'PR-one', parseRevision: 1, semanticRevision: 1 }];
    const registered = await repository.contextBasis([reading], owner, h.database as never);
    expect(() => assertSummaryContextUnchanged(absent, registered)).toThrow('DERIVED_SUMMARY_CONTEXT_CHANGED');
    h.state.semanticRevisions[0]!.semanticRevision = 2;
    const revised = await repository.contextBasis([reading], owner, h.database as never);
    expect(() => assertSummaryContextUnchanged(registered, revised)).toThrow('DERIVED_SUMMARY_CONTEXT_CHANGED');
    expect(registered.sources[0]?.semanticRevisions?.[0]?.semanticRevision).toBe(1);
    expect(revised.uncoordinatedDependencies).toEqual(['DOCUMENT_LIFECYCLE_NOT_FENCED']);
    expect(summaryContextStatus(registered, revised)).toMatchObject({ state: 'RECHECK_REQUIRED', sourceCurrentness: 'UNKNOWN' });
  });

  it('retains old saved bases for authorized history, rejects their first SAVE, and rejects malformed semantic observations', async () => {
    const h = hostRows();
    const repository = new DerivedSummaryRepository({} as never, {} as never, {} as never);
    const fresh = await repository.contextBasis([reading], owner, h.database as never);
    const legacy = copy(fresh); delete legacy.sources[0]!.semanticRevisions;
    expect(() => assertSummaryContextBasis(legacy)).not.toThrow();
    expect(summaryContextStatus(legacy, fresh).state).toBe('RECHECK_REQUIRED');
    expect(() => assertSummaryContextUnchanged(legacy, fresh)).toThrow('DERIVED_SUMMARY_CONTEXT_CHANGED');
    const malformed = copy(fresh);
    malformed.sources[0]!.semanticRevisions = [{ parseRunId: 'PR-one', parseRevision: 1, semanticRevision: 0 }];
    expect(() => assertSummaryContextBasis(malformed)).toThrow('DERIVED_SUMMARY_CONTEXT_INVALID');
  });

  it('fences published parse identity independently of semantic revisions, distinguishing absent from unobserved legacy', async () => {
    const h = hostRows();
    const repository = new DerivedSummaryRepository({} as never, {} as never, {} as never);
    const absent = await repository.contextBasis([reading], owner, h.database as never);
    expect(absent.sources[0]?.publishedParse).toBeNull();
    h.state.publishedParse = { parseRunId: 'PR-one', parseRevision: 1 };
    const first = await repository.contextBasis([reading], owner, h.database as never);
    expect(() => assertSummaryContextUnchanged(absent, first)).toThrow('DERIVED_SUMMARY_CONTEXT_CHANGED');
    h.state.publishedParse = { parseRunId: 'PR-two', parseRevision: 3 };
    const later = await repository.contextBasis([reading], owner, h.database as never);
    expect(first.sources[0]?.semanticRevisions).toEqual(later.sources[0]?.semanticRevisions);
    expect(first.sources[0]?.publishedParse).toEqual({ parseRunId: 'PR-one', parseRevision: 1 });
    expect(() => assertSummaryContextUnchanged(first, later)).toThrow('DERIVED_SUMMARY_CONTEXT_CHANGED');
    expect(summaryContextStatus(first, later)).toMatchObject({ state: 'RECHECK_REQUIRED', sourceCurrentness: 'UNKNOWN',
      reasons: expect.arrayContaining(['CHANGED_SOURCES', 'DOCUMENT_LIFECYCLE_NOT_FENCED', 'PUBLISHER_CURRENTNESS_UNKNOWN']) });
    expect(() => assertSummaryContextUnchanged(later, copy(later))).not.toThrow();
    for (const observed of [absent, first]) {
      const legacy = copy(observed); delete legacy.sources[0]!.publishedParse;
      expect(() => assertSummaryContextBasis(legacy)).not.toThrow();
      expect(summaryContextStatus(legacy, observed).state).toBe('RECHECK_REQUIRED');
      expect(() => assertSummaryContextUnchanged(legacy, observed)).toThrow('DERIVED_SUMMARY_CONTEXT_CHANGED');
    }
    for (const invalid of [{ parseRunId: '', parseRevision: 1 }, { parseRunId: 5, parseRevision: 1 },
      { parseRunId: 'PR-one', parseRevision: 0 }, { parseRunId: 'PR-one', parseRevision: 1.5 },
      { parseRunId: 'PR-one', parseRevision: '1' }, [], true]) {
      const malformed = copy(first);
      malformed.sources[0]!.publishedParse = invalid as never;
      expect(() => assertSummaryContextBasis(malformed)).toThrow('DERIVED_SUMMARY_CONTEXT_INVALID');
    }
  });

  it('includes a saved statement carrier document even when there is no separate document passage', async () => {
    const h = hostRows();
    const repository = new DerivedSummaryRepository({} as never, {} as never, {} as never);
    const statement: AssessmentEvidence = { kind: 'PRIOR_RESULT', evidenceRef: 'statement-one', title: 'Saved source statement',
      versionLabel: null, excerpt: 'Exact selected statement', resultRef: 'DAR-one', resultRevision: 1, originalEvidenceRefs: [],
      sourceStatement: { reference: { runRef: 'DAR-one', candidateRevision: 1, statementId: 'S-one' },
        sourceBinding: { original: { documentVersionId: 'DV-statement', parseRunId: 'PR-statement', parseRevision: 1,
          sourceArtifactId: 'SRC-statement', sourceSha256: 'a'.repeat(64), sourceByteLength: 100 }, semanticRevision: 1 } } };
    const basis = await repository.contextBasis([{ ...reading, evidence: [statement] }], owner, h.database as never);
    expect(basis.sources.map(item => item.documentVersionId)).toEqual(['DV-A', 'DV-statement']);
    await repository.lockContext(basis, owner, h.database as never);
    expect(h.state.locks.filter(item => item === 'share:dm_document_version')).toHaveLength(2);
  });

  it('reports selected catalog authority only, and fails closed when an old task has no basis', () => {
    const basis: DerivedSummaryContextBasis = { schemaVersion: 'wiselink.derived-summary-context.v1',
      memberNotices: [{ member: work, current: true, overviewStatus: 'CURRENT', limitations: [] }],
      sources: [{ documentVersionId: 'DV-A', familyId: 'F-one', selectedHead: 'DV-A', currentGeneration: 1,
        status: 'ACTIVE' }], workItems: [], matters: [], summaries: [], uncoordinatedDependencies: [] };
    expect(summaryContextStatus(basis, basis)).toMatchObject({ state: 'UNCHANGED_HOST_CONTEXT',
      sourceAuthority: 'CATALOG_SELECTED', sourceCurrentness: 'UNKNOWN', coverage: 'SELECTED_MEMBERS_ONLY' });
    expect(summaryContextStatus(undefined)).toMatchObject({ state: 'LEGACY_UNCHECKED', sourceCurrentness: 'UNKNOWN' });
    expect(() => assertSummaryContextUnchanged(undefined, basis)).toThrow('DERIVED_SUMMARY_CONTEXT_BASIS_REQUIRED');
  });

  it('captures Matter membership and correction notices, then locks head before notice attempts', async () => {
    const member: DerivedSummaryMember = { kind: 'MATTER_WORK', matterId: 'M-one', workRef: 'MW-one',
      workRevision: 4, issueKeys: ['issue-one'] };
    const selected = { ...reading, member, leaves: [member], evidence: [] };
    const notice = { attemptRef: 'AQ-correction', issueKey: 'issue-one', reason: 'Review the retained result',
      attemptStatus: 'RUNNING', correctedWorkRef: null };
    let currentMatterRevisionId = 'MR-one';
    let membership = true;
    let correctionNotices: DerivedSummaryContextBasis['matters'][number]['selectedWork'][number]['correctionNotices'] = [notice];
    let overviewCorrectionNotices: DerivedSummaryContextBasis['matters'][number]['selectedWork'][number]['overviewCorrectionNotices'] = [];
    const locks: string[] = [];
    const database = { select: jest.fn((_fields?: unknown) => ({ from: (table: unknown) => {
      const name = getTableName(table as Parameters<typeof getTableName>[0]);
      const rows = () => {
        if (name === 'engineering_matter') return [{ currentMatterRevisionId }];
        if (name === 'engineering_matter_work_revision') return [{ ref: 'MW-one', revision: 4 }];
        return [];
      };
      const query = { where: (_predicate: unknown) => query, orderBy: (_order: unknown) => query,
        limit: async (_n: number) => rows(), for: async (mode: string) => {
          locks.push(`${mode}:${name}`); return rows();
        } };
      return query;
    } })) };
    const transactions = { readByRef: jest.fn(async () => membership ? {
      basedOnMatterRevisionId: 'MR-one', substantiveResultRef: 'RESULT-one', substantiveResultRevision: 2,
      state: { problemWork: { overviewStatus: 'CURRENT' } }, correctionNotices,
      overviewCorrectionNotices, referenceWorkNotices: [],
    } : null) };
    const repository = new DerivedSummaryRepository({} as never, transactions as never, {} as never);
    const frozen = await repository.contextBasis([selected], owner, database as never);
    expect(frozen.matters).toEqual([expect.objectContaining({ matterId: 'M-one',
      selectedWork: [expect.objectContaining({ workRef: 'MW-one', correctionNotices: [notice] })] })]);
    await repository.lockContext(frozen, owner, database as never);
    expect(locks).toEqual(['share:engineering_matter', 'share:action_attempt']);
    currentMatterRevisionId = 'MR-two';
    expect(() => assertSummaryContextUnchanged(frozen,
      { ...frozen, matters: [{ ...frozen.matters[0]!, currentMatterRevisionId }] }))
      .toThrow('DERIVED_SUMMARY_CONTEXT_CHANGED');
    currentMatterRevisionId = 'MR-one';
    correctionNotices = [{ ...notice, attemptStatus: 'SUCCEEDED', correctedWorkRef: 'MW-two' }];
    const corrected = await repository.contextBasis([selected], owner, database as never);
    expect(corrected.matters[0]?.selectedWork[0]?.correctionNotices).toEqual(correctionNotices);
    expect(() => assertSummaryContextUnchanged(frozen, corrected)).toThrow('DERIVED_SUMMARY_CONTEXT_CHANGED');
    // Equal-time SQL notice rows may arrive in either order. Their identities,
    // not arrival order, determine the frozen basis and eventual member notices.
    correctionNotices = [{ ...notice, attemptRef: 'AQ-z' }, { ...notice, attemptRef: 'AQ-a' }];
    overviewCorrectionNotices = [
      { attemptRef: 'AQ-overview-z', targetWorkRef: 'MW-one', reason: 'Overview review',
        attemptStatus: 'QUEUED', savedWorkRef: null, savedWorkingRevision: null },
      { attemptRef: 'AQ-overview-a', targetWorkRef: 'MW-one', reason: 'Overview review',
        attemptStatus: 'QUEUED', savedWorkRef: null, savedWorkingRevision: null },
    ];
    const firstOrder = await repository.contextBasis([selected], owner, database as never);
    correctionNotices = [...correctionNotices].reverse();
    overviewCorrectionNotices = [...overviewCorrectionNotices].reverse();
    const secondOrder = await repository.contextBasis([selected], owner, database as never);
    expect(secondOrder).toEqual(firstOrder);
    expect(secondOrder.matters[0]?.selectedWork[0]?.correctionNotices.map(item => item.attemptRef))
      .toEqual(['AQ-a', 'AQ-z']);
    expect(secondOrder.matters[0]?.selectedWork[0]?.overviewCorrectionNotices.map(item => item.attemptRef))
      .toEqual(['AQ-overview-a', 'AQ-overview-z']);
    membership = false;
    await expect(repository.contextBasis([selected], owner, database as never))
      .rejects.toThrow('DERIVED_SUMMARY_MEMBER_UNAVAILABLE');
  });

  it('models the final-read versus source-family insert interleavings with a deterministic lock double', async () => {
    const h = hostRows();
    const repository = new DerivedSummaryRepository({} as never, {} as never, {} as never);
    const frozen = await repository.contextBasis([reading], owner, h.database as never);
    // Writer wins first: the final read under the acquired family lock sees its new generation.
    h.state.family.currentGeneration = 2;
    await repository.lockContext(frozen, owner, h.database as never);
    expect(() => assertSummaryContextUnchanged(frozen,
      { ...frozen, sources: [{ ...frozen.sources[0]!, ...h.state.family }] }))
      .toThrow('DERIVED_SUMMARY_CONTEXT_CHANGED');
    // Reader wins first: simulate the writer waiting for the held family head lock.
    h.state.family.currentGeneration = 1;
    let releaseWriter: (() => void) | undefined;
    const writerGate = new Promise<void>(resolve => { releaseWriter = resolve; });
    const writer = (async () => {
      if (h.state.locks.includes('share:dm_publication_family')) await writerGate;
      h.state.family.currentGeneration = 2;
    })();
    const finalRead = await repository.contextBasis([reading], owner, h.database as never);
    expect(() => assertSummaryContextUnchanged(frozen, finalRead)).not.toThrow();
    expect(h.state.family.currentGeneration).toBe(1);
    releaseWriter?.(); await writer;
    expect(h.state.family.currentGeneration).toBe(2);
  });

  it('uses one global summary order for opposing target/dependency operations', async () => {
    const h = hostRows();
    const repository = new DerivedSummaryRepository({} as never, {} as never, {} as never);
    const basis = await repository.contextBasis([reading], owner, h.database as never);
    basis.sources = []; basis.workItems = [];
    basis.summaries = [
      { summaryId: 'DS-B', currentSummaryRef: 'DSR-B', currentRevision: 1 },
      { summaryId: 'DS-A', currentSummaryRef: 'DSR-A', currentRevision: 1 },
    ];
    const locks: string[] = [];
    const database = { select: jest.fn((_fields?: unknown) => ({ from: (table: unknown) => {
      expect(getTableName(table as Parameters<typeof getTableName>[0])).toBe('derived_summary');
      let params: unknown[] = [];
      const query = { where: (predicate: Parameters<PgDialect['sqlToQuery']>[0]) => {
        params = dialect.sqlToQuery(predicate).params; return query;
      }, for: async (mode: string) => {
        locks.push(`${mode}:${params.find(value => value === 'DS-A' || value === 'DS-B')}`); return [];
      } };
      return query;
    } })) };
    await repository.lockContext(basis, owner, database as never, 'DS-A');
    expect(locks).toEqual(['update:DS-A', 'share:DS-B']);
    locks.length = 0;
    await repository.lockContext(basis, owner, database as never, 'DS-B');
    expect(locks).toEqual(['share:DS-A', 'update:DS-B']);
  });
});

function taskFor(id: string, revision: number, basis?: DerivedSummaryContextBasis) {
  const input = request(id, revision);
  const fields = { schemaVersion: 'wiselink.derived-summary-task.v1' as const,
    taskType: 'OPENCLAW_DERIVED_SUMMARY' as const, subject: { kind: 'DERIVED_SUMMARY' as const, summaryId: 'DS-one' },
    expectedSummaryRevision: revision, requestId: id, actionAttemptId: `ATT-${id}`, operationRef: `AQ-${id}`,
    deadlineAt: '2099-01-01T00:00:00.000Z', executionModel: taskModelSelection(input.modelRef,
      new Date('2026-10-06T00:00:00.000Z')), ...(basis ? { contextBasis: basis } : {}),
    modelInput: { scope, classificationStatus: 'CANDIDATE' as const,
      instruction: input.instruction, members: [reading], evidence: [source], limitations: [] } };
  return { ...fields, taskInputHash: canonicalSha256(fields) };
}

function runningAttempt(task: ReturnType<typeof taskFor>) {
  return { summaryId: 'DS-one', attemptId: task.actionAttemptId, operationRef: task.operationRef,
    triggerRequestId: task.requestId, baseRevision: task.expectedSummaryRevision,
    inputRevision: task.expectedSummaryRevision, deadlineAt: new Date(task.deadlineAt),
    taskEnvelopeJson: canonicalJson(task), taskInputHash: task.taskInputHash,
    executionModelJson: canonicalJson(task.executionModel), requestCommandJson: canonicalJson(request(task.requestId,
      task.expectedSummaryRevision)), status: 'RUNNING', actorUserId: owner.actorUserId, tenantId: owner.tenantId,
    leaseOwner: 'service-one', leaseToken: 'lease-one', leaseGeneration: 1,
    leaseExpiresAt: new Date('2099-01-01T00:00:00.000Z'), reviewActivityJson: '[]' };
}

describe('derived summary runtime freshness fence (transaction-double proof, not physical PostgreSQL)', () => {
  it('keeps S0/pointer/read ledger on S1 conflict, releases admission, and saves a freshly selected S2', async () => {
    const h = hostRows();
    const repo = new DerivedSummaryRepository({} as never, {} as never, {} as never);
    const basis0 = await repo.contextBasis([reading], owner, h.database as never);
    const saved0 = { summaryId: 'DS-one', summaryRef: 'DSR-zero', revision: 1, scope,
      classificationStatus: 'CANDIDATE' as const, members: [reading], content: { headline: 'S0', listBrief: 'S0',
      body: 'Stable S0 body', limitations: [] }, evidence: [source], usedEvidenceRefs: [], coverage: [],
      requestId: 'S0', attemptRef: 'AQ-S0', createdAt: '2026-10-06T00:00:00.000Z', candidateOnly: true as const,
      contextBasis: basis0 };
    const head = { summaryId: 'DS-one', actorUserId: owner.actorUserId,
      currentRevision: 1, currentSummaryRef: 'DSR-zero', scopeJson: scope,
      membersJson: [work] };
    const attempts = new Map<string, ReturnType<typeof runningAttempt>>();
    const saved = [saved0];
    let sourceReadable = true;
    const members = { readAll: jest.fn(async (selection: DerivedSummaryMember[]) => {
      if (!sourceReadable) throw new Error('DERIVED_SUMMARY_MEMBER_UNAVAILABLE');
      return selection.map(() => copy(reading));
    }), verifyOriginalEvidence: jest.fn().mockResolvedValue(undefined) };
    const database = { ...h.database,
      select: jest.fn((fields?: unknown) => ({ from: (table: unknown) => {
        const name = getTableName(table as Parameters<typeof getTableName>[0]);
        if (!['derived_summary_revision', 'action_attempt'].includes(name)) return h.database.select(fields).from(table as never);
        let params: unknown[] = [];
        const rows = () => name === 'derived_summary_revision'
          ? saved.filter(item => params.includes(item.requestId) || params.includes(item.summaryRef))
            .map(item => ({ summaryRef: item.summaryRef, revision: item.revision, contentJson: item,
              attemptId: attempts.get(item.attemptRef)?.attemptId ?? `ATT-${item.requestId}`,
              requestId: item.requestId, ref: item.summaryRef }))
          : params.includes('derived-summary:DS-one:S1') ? [{ attemptRef: 'AQ-S1' }]
            : params.includes('QUEUED') ? [...attempts.values()].filter(item =>
              ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(item.status))
              .map(item => ({ ref: item.operationRef })) : [];
        const query = { where: (predicate: Parameters<PgDialect['sqlToQuery']>[0]) => {
          params = dialect.sqlToQuery(predicate).params; return query; }, limit: async (_n: number) => rows(),
          for: async (_mode: string) => rows(), then: (resolve: (value: unknown[]) => void) => resolve(rows()) };
        return query;
      } })),
      insert: jest.fn((_table: unknown) => ({ values: async (value: { contentJson: typeof saved0 }) => {
        saved.push(value.contentJson); return []; } })),
      execute: jest.fn(async (statement: Parameters<PgDialect['sqlToQuery']>[0]) => {
        if (dialect.sqlToQuery(statement).sql.includes('dm_document_semantic_revision')) return h.database.execute(statement);
        const task = dialect.sqlToQuery(statement).params.filter((value): value is string => typeof value === 'string')
          .flatMap(value => { try { return [JSON.parse(value) as ReturnType<typeof taskFor>]; } catch { return []; } })
          .find(value => value.schemaVersion === 'wiselink.derived-summary-task.v1');
        if (!task) throw new Error('TEST_TASK_NOT_INSERTED');
        const queued = Object.assign(runningAttempt(task), { status: 'QUEUED', claimCount: 0,
          leaseOwner: null, leaseToken: null, leaseGeneration: 0, leaseExpiresAt: null,
          startedAt: null, nextAttemptAt: null, cancelRequestedAt: null });
        attempts.set(task.operationRef, queued);
        return [];
      }),
      transaction: jest.fn(async (operation: (transaction: unknown) => Promise<unknown>) => operation(database)),
      update: jest.fn((table: unknown) => ({ set: (values: Record<string, unknown>) => ({
        where: (predicate: Parameters<PgDialect['sqlToQuery']>[0]) => {
          const params = dialect.sqlToQuery(predicate).params;
          const apply = async () => {
          if (getTableName(table as Parameters<typeof getTableName>[0]) === 'derived_summary') {
            head.currentRevision = Number(values.currentRevision);
            head.currentSummaryRef = String(values.currentSummaryRef); return [{ id: 'DS-one' }];
          }
          const row = [...attempts.values()].find(item => params.includes(item.attemptId));
          if (row && values.reviewActivityJson) {
            const eventJson = dialect.sqlToQuery(values.reviewActivityJson as Parameters<PgDialect['sqlToQuery']>[0])
              .params.find(value => {
                if (typeof value !== 'string') return false;
                try { const parsed = JSON.parse(value); return Array.isArray(parsed) &&
                  typeof parsed[0]?.kind === 'string' && parsed[0].kind.startsWith('DERIVED_SUMMARY_'); }
                catch { return false; }
              });
            if (typeof eventJson !== 'string') throw new Error('TEST_LEDGER_APPEND_UNRECOGNIZED');
            row.reviewActivityJson = JSON.stringify([...JSON.parse(row.reviewActivityJson), ...JSON.parse(eventJson)]);
          }
          if (row && values.status) Object.assign(row, values);
          return values.status === 'RUNNING' ? [row] : [{ attemptId: row?.attemptId }];
          };
          return { then: (resolve: (value: unknown[]) => void, reject: (error: unknown) => void) =>
            apply().then(resolve, reject), returning: apply };
        },
      }) })),
    };
    const runtimeRepo = { runtime: jest.fn(async (target: { attemptRef: string }, operation: Function) =>
      operation(database, owner, head, attempts.get(target.attemptRef))),
      attempt: jest.fn(async (_summaryId: string, ref: string) => attempts.get(ref)),
      head: jest.fn(async () => head),
      contextBasis: repo.contextBasis.bind(repo), lockContext: repo.lockContext.bind(repo),
      saved: jest.fn(async (_summaryId: string, ref: string) => saved.find(item => item.summaryRef === ref)),
      browser: jest.fn(async (_actor: unknown, operation: Function) => operation(database, owner)),
      readBrowser: jest.fn(async (_actor: unknown, operation: Function) => operation(database, owner)) };
    const summaries = new DerivedSummaryService(runtimeRepo as never, members as never,
      { authorizeOpenClawAutoWorkItemQueue: jest.fn().mockResolvedValue({ appId: 'app_17bzc551rsg',
        tenantId: owner.tenantId, principalId: 'service-one' }) } as never);
    const runtime = new DerivedSummaryRuntimeService(runtimeRepo as never, members as never, summaries);
    const task1 = taskFor('S1', 1, basis0); attempts.set(task1.operationRef, runningAttempt(task1));
    const target = (id: string, revision: number, attemptRef = `AQ-${id}`) => ({ summaryId: 'DS-one', attemptRef,
      scope: { appId: 'app_17bzc551rsg', tenantId: owner.tenantId, principalId: 'service-one' },
      leaseToken: 'lease-one', leaseGeneration: 1, requestId: id, expectedSummaryRevision: revision,
      contentJson: JSON.stringify({ headline: id, listBrief: id, body: `Based on [[${reading.evidenceRef}]]`,
        limitations: [] }) });
    await expect(runtime.readMemberWork({ ...target('S1', 1), evidenceRefs: [reading.evidenceRef],
      purpose: 'Read the explicitly selected member' } as never)).resolves.toMatchObject({ members: [reading] });
    await expect(runtime.readSources({ ...target('S1', 1), evidenceRefs: [source.evidenceRef],
      purpose: 'Read the member original' } as never)).resolves.toMatchObject({ evidence: [source] });
    expect(members.verifyOriginalEvidence).toHaveBeenCalledWith([source], owner);
    const s1Ledger = JSON.parse(attempts.get('AQ-S1')!.reviewActivityJson) as Array<{ kind: string }>;
    expect(s1Ledger.map(item => item.kind)).toEqual(['DERIVED_SUMMARY_MEMBERS_READ', 'DERIVED_SUMMARY_SOURCES_READ']);
    h.state.family.selectedHead = 'DV-B'; h.state.family.currentGeneration = 2;
    h.state.family.selectedHead = 'DV-A'; h.state.family.currentGeneration = 3;
    const failedConflictCas = jest.spyOn(ActionAttemptRepository.prototype, 'finishTerminal').mockResolvedValueOnce(false);
    await expect(runtime.save(target('S1', 1) as never)).rejects.toThrow('DERIVED_SUMMARY_CONTEXT_CONFLICT_NOT_RECORDED');
    expect(attempts.get('AQ-S1')?.status).toBe('RUNNING');
    expect(head).toMatchObject({ currentRevision: 1, currentSummaryRef: 'DSR-zero' });
    expect(JSON.parse(attempts.get('AQ-S1')!.reviewActivityJson)).toEqual(s1Ledger);
    failedConflictCas.mockRestore();
    await expect(runtime.save(target('S1', 1) as never)).rejects.toThrow('DERIVED_SUMMARY_CONTEXT_CHANGED');
    expect(attempts.get('AQ-S1')?.status).toBe('CONFLICT');
    expect(head).toMatchObject({ currentRevision: 1, currentSummaryRef: 'DSR-zero' });
    expect(saved).toEqual([saved0]);
    expect(JSON.parse(attempts.get('AQ-S1')!.reviewActivityJson)).toEqual(s1Ledger);
    const receipt2 = await summaries.request('DS-one', request('S2', 1), {} as never);
    expect(receipt2).toMatchObject({ created: true, status: 'QUEUED' });
    const task2 = checkedSummaryTask(attempts.get(receipt2.attemptRef) as never);
    const basis2 = task2.contextBasis!;
    expect(basis2.sources[0]).toMatchObject({ selectedHead: 'DV-A', currentGeneration: 3 });
    const modelScript = `import { validateDerivedSummaryTask } from './openclaw/skills/wiselink-research-and-synthesize/scripts/derived-summary-shape.mjs';
      import { derivedSummaryModelMessages } from './openclaw/skills/wiselink-research-and-synthesize/scripts/invoke-hosted-derived-summary-model.mjs';
      let body = ''; for await (const chunk of process.stdin) body += chunk;
      const task = JSON.parse(body); validateDerivedSummaryTask(task, { summaryId: task.subject.summaryId, attemptRef: task.operationRef });
      process.stdout.write(JSON.stringify(derivedSummaryModelMessages(task.modelInput)));`;
    const modelView = spawnSync(process.execPath, ['--input-type=module', '-e', modelScript], {
      cwd: process.cwd(), input: JSON.stringify(task2), encoding: 'utf8' });
    expect(modelView.status).toBe(0);
    expect(modelView.stdout).not.toContain('contextBasis');
    expect(modelView.stdout).not.toContain('selectedHead');
    expect(modelView.stdout).not.toContain('currentGeneration');
    expect(task2.taskInputHash).toBe(canonicalSha256((({ taskInputHash: _hash, ...fields }) => fields)(task2)));
    const claim2 = await runtime.claim(target('S2', 1, receipt2.attemptRef) as never);
    expect(claim2).toMatchObject({ status: 'RUNNING', task: task2, leaseGeneration: 1 });
    expect(database.transaction).toHaveBeenCalledTimes(1);
    const target2 = { ...target('S2', 1, receipt2.attemptRef), leaseToken: claim2.leaseToken,
      leaseGeneration: claim2.leaseGeneration };
    await runtime.readMemberWork({ ...target2, evidenceRefs: [reading.evidenceRef],
      purpose: 'Read the fresh explicitly selected member' } as never);
    await runtime.readSources({ ...target2, evidenceRefs: [source.evidenceRef],
      purpose: 'Read its original again' } as never);
    expect(JSON.parse(attempts.get(receipt2.attemptRef)!.reviewActivityJson)).toEqual([
      expect.objectContaining({ kind: 'DERIVED_SUMMARY_MEMBERS_READ', evidenceRefs: [reading.evidenceRef] }),
      expect.objectContaining({ kind: 'DERIVED_SUMMARY_SOURCES_READ', evidenceRefs: [source.evidenceRef] }),
    ]);
    await expect(runtime.save(target2 as never)).resolves.toMatchObject({ revision: 2,
      contextStatus: { sourceAuthority: 'CATALOG_SELECTED', sourceCurrentness: 'UNKNOWN' } });
    expect(head.currentRevision).toBe(2);
    expect(saved).toHaveLength(2);
    expect(saved[0]).toEqual(saved0);
    expect(saved[1]).toMatchObject({ requestId: 'S2', candidateOnly: true, contextBasis: basis2 });
    const history = await summaries.readRevision('DS-one', 'DSR-zero', {} as never);
    expect(history).toMatchObject({ revision: { content: { body: 'Stable S0 body' } },
      contextStatus: { state: 'RECHECK_REQUIRED', sourceCurrentness: 'UNKNOWN' } });
    expect(history.revision).not.toHaveProperty('contextBasis');
    expect(JSON.stringify(history)).not.toContain('selectedHead');
    const publicHead = await summaries.read('DS-one', {} as never);
    expect(publicHead.current).not.toHaveProperty('contextBasis');
    await expect(summaries.status('DS-one', 'AQ-S1', {} as never)).resolves.toMatchObject({
      status: 'CONFLICT', savedSummaryRefs: [] });
    const legacy = taskFor('legacy', 2);
    attempts.set(legacy.operationRef, runningAttempt(legacy));
    await expect(runtime.heartbeat(target('legacy', 2) as never))
      .rejects.toThrow('DERIVED_SUMMARY_CONTEXT_BASIS_REQUIRED');
    expect(attempts.get(legacy.operationRef)?.status).toBe('CONFLICT');
    await expect(runtime.status(target('legacy', 2) as never)).resolves.toMatchObject({ status: 'CONFLICT' });
    await expect(runtime.save({ ...target2, contentJson: JSON.stringify({ headline: 'Different',
      listBrief: 'Different', body: 'Conflicting bytes', limitations: [] }) } as never))
      .rejects.toThrow('DERIVED_SUMMARY_SAVE_REQUEST_ID_REUSED');
    const saved2Bytes = canonicalJson(saved[1]);
    const hiddenHead = 'DV-UNREADABLE-HEAD';
    h.state.family.selectedHead = hiddenHead;
    h.state.family.currentGeneration = 4;
    await expect(runtime.heartbeat(target2 as never)).resolves.toMatchObject({ status: 'RUNNING' });
    await expect(runtime.heartbeat({ ...target2, leaseToken: 'wrong-saved-lease' } as never))
      .rejects.toThrow('JOBAID_WORK_LEASE_FENCE_REJECTED');
    await expect(runtime.heartbeat({ ...target2, leaseGeneration: 0 } as never))
      .rejects.toThrow('JOBAID_WORK_LEASE_FENCE_REJECTED');
    expect(attempts.get(receipt2.attemptRef)?.status).toBe('RUNNING');
    // Simulate an already saved legacy request without manufacturing a basis.
    const legacySavedTask = taskFor('legacy-saved', 2);
    attempts.set(legacySavedTask.operationRef, runningAttempt(legacySavedTask));
    const { contextBasis: _basis, ...legacySavedBody } = saved[1]!;
    saved.push({ ...legacySavedBody, requestId: 'legacy-saved', attemptRef: legacySavedTask.operationRef,
      summaryRef: 'DSR-legacy-saved', revision: 3 } as typeof saved0);
    await expect(runtime.heartbeat(target('legacy-saved', 2) as never)).resolves.toMatchObject({ status: 'RUNNING' });
    await expect(runtime.heartbeat({ ...target('legacy-saved', 2), leaseToken: 'wrong' } as never))
      .rejects.toThrow('JOBAID_WORK_LEASE_FENCE_REJECTED');
    expect(checkedSummaryTask(attempts.get(legacySavedTask.operationRef) as never)).not.toHaveProperty('contextBasis');
    saved.pop(); attempts.delete(legacySavedTask.operationRef);
    const historicalSaved = await runtime.readSaved(target2 as never);
    expect(historicalSaved).toMatchObject({
      receipt: { summaryRef: saved[1]!.summaryRef, revision: 2, replay: true },
      summary: { content: { body: `Based on [[${reading.evidenceRef}]]` } },
      contextStatus: { state: 'RECHECK_REQUIRED', sourceCurrentness: 'UNKNOWN' },
    });
    expect(historicalSaved.summary).not.toHaveProperty('contextBasis');
    const savedReplay = await runtime.save(target2 as never);
    expect(savedReplay).toMatchObject({ summaryRef: saved[1]!.summaryRef, revision: 2, replay: true,
      contextStatus: { state: 'RECHECK_REQUIRED', sourceCurrentness: 'UNKNOWN' } });
    const hiddenHistory = await summaries.readRevision('DS-one', 'DSR-zero', {} as never);
    const hiddenPublicHead = await summaries.read('DS-one', {} as never);
    for (const visible of [historicalSaved, hiddenHistory, hiddenPublicHead]) {
      expect(JSON.stringify(visible)).not.toContain(hiddenHead);
      expect(JSON.stringify(visible)).not.toContain('contextBasis');
    }
    expect(canonicalJson(saved[1])).toBe(saved2Bytes);
    expect(saved).toHaveLength(2);
    sourceReadable = false;
    await expect(summaries.readRevision('DS-one', 'DSR-zero', {} as never))
      .rejects.toThrow('DERIVED_SUMMARY_MEMBER_UNAVAILABLE');
    await expect(summaries.status('DS-one', 'AQ-S1', {} as never))
      .rejects.toThrow('DERIVED_SUMMARY_MEMBER_UNAVAILABLE');
    await expect(summaries.request('DS-one', request('S1', 1), {} as never))
      .rejects.toThrow('DERIVED_SUMMARY_MEMBER_UNAVAILABLE');
    await expect(runtime.readSaved({ ...target2 } as never))
      .rejects.toThrow('DERIVED_SUMMARY_MEMBER_UNAVAILABLE');
    expect(checkedSummaryTask(attempts.get('AQ-S1') as never)).toEqual(task1);
  });
});

describe('R1 sealed command/task binding', () => {
  const reseal = (task: ReturnType<typeof taskFor>) => {
    const { taskInputHash: _old, ...fields } = task;
    return { ...fields, taskInputHash: canonicalSha256(fields) };
  };
  it('validates a legacy real command without rewriting its omitted fields or hash', () => {
    const task = taskFor('legacy-binding', 1); const row = runningAttempt(task);
    expect(checkedSummaryTask(row as never)).toEqual(task);
    expect(Object.hasOwn(checkedSummaryTask(row as never).modelInput, 'purpose')).toBe(false);
    expect(row.taskEnvelopeJson).toBe(canonicalJson(task));
  });
  it.each(['requestId', 'expectedSummaryRevision', 'scope', 'members', 'instruction', 'modelRef', 'purpose'])
    ('rejects command %s drift even while task/hash remain valid', key => {
      const task = taskFor('command-binding', 1); const row = runningAttempt(task);
      const command = { ...request(task.requestId, 1), [key]: key === 'expectedSummaryRevision' ? 2 :
        key === 'scope' ? { ...scope, title: 'Other selection' } : key === 'members' ? [{ ...work, workRef: 'other' }] :
          key === 'purpose' ? 'SYNTHESIZE' : 'Other command' };
      row.requestCommandJson = canonicalJson(command);
      expect(() => checkedSummaryTask(row as never)).toThrow('DERIVED_SUMMARY_TASK_INVALID');
    });
  it.each([{}, null, { ...request('command-binding', 1), purpose: null }])('rejects malformed full command %s', command => {
    const row = runningAttempt(taskFor('command-binding', 1)); row.requestCommandJson = canonicalJson(command);
    expect(() => checkedSummaryTask(row as never)).toThrow('DERIVED_SUMMARY_TASK_INVALID');
  });
  it.each(['purpose', 'revisionContext'])('rejects forbidden task-level %s even if the new hash is self-consistent', key => {
    const task = { ...taskFor('top-level-binding', 1), [key]: 'SYNTHESIZE' }; const sealed = reseal(task);
    expect(() => checkedSummaryTask(runningAttempt(sealed) as never)).toThrow('DERIVED_SUMMARY_TASK_INVALID');
  });
  it('rejects purpose/context pairing drift after an otherwise valid hash seal', () => {
    const task = taskFor('context-pair', 1);
    const withContext = { ...task, modelInput: { ...task.modelInput, revisionContext: {} } };
    expect(() => checkedSummaryTask(runningAttempt(reseal(withContext as never)) as never)).toThrow('DERIVED_SUMMARY_TASK_INVALID');
  });
  it.each(['REVERSED', 'BODY', 'MISSING', 'MEMBER'] as const)('binds each fresh prior in saved order: %s', drift => {
    const secondWork = { ...work, workItemId: 'W-two', workRef: 'WR-two' };
    const second = { ...copy(reading), member: secondWork, leaves: [secondWork], evidenceRef: 'member-W-two', body: 'Second immutable saved body', evidence: [] };
    const saved = { summaryId: 'DS-one', summaryRef: 'DSR-prior', revision: 1, scope,
      classificationStatus: 'CANDIDATE' as const, members: [copy(reading), second], content: { headline: 'Prior',
        listBrief: 'Limited', body: 'Old candidate', limitations: [] }, evidence: [source], usedEvidenceRefs: [], coverage: [],
      requestId: 'prior', attemptRef: 'AQ-prior', createdAt: '2026-10-06T00:00:00.000Z', candidateOnly: true as const };
    const task = taskFor('prior-bind', 1);
    const input = { ...request(task.requestId, 1), purpose: 'REVISE_SAVED_SUMMARY' as const };
    const revisionContext = buildSummaryRevisionContext(input, saved, copy(saved.members), [reading], '2026-10-06T00:00:00.000Z');
    const fresh = copy(saved.members);
    if (drift === 'REVERSED') fresh.reverse();
    if (drift === 'BODY') fresh[1]!.body = 'Different body under old ref';
    if (drift === 'MISSING') fresh.pop();
    if (drift === 'MEMBER') fresh[1]!.member = work;
    const repository = new DerivedSummaryRepository({} as never, {} as never, {} as never);
    jest.spyOn(repository, 'savedRevision').mockResolvedValue(saved);
    const members = { readAll: jest.fn(async (selected: DerivedSummaryMember[]) => selected.length === 1 ? [copy(reading)] : fresh) };
    const service = new DerivedSummaryService(repository, members as never, {} as never);
    return expect(service.checkTaskAccess({ ...task, modelInput: { ...task.modelInput, purpose: input.purpose, revisionContext } },
      owner, {} as never)).rejects.toThrow(drift === 'MISSING' ? 'DERIVED_SUMMARY_PERSISTENCE_INVALID' : 'DERIVED_SUMMARY_MEMBER_CONTENT_CHANGED');
  });
  it('rejects an invented current evidence registry before prior lookup or source IO', () => {
    const task = taskFor('registry-bind', 1);
    const members = { readAll: jest.fn(async () => [copy(reading)]) };
    const repository = new DerivedSummaryRepository({} as never, {} as never, {} as never);
    const service = new DerivedSummaryService(repository, members as never, {} as never);
    return expect(service.checkTaskAccess({ ...task, modelInput: { ...task.modelInput,
      evidence: [{ ...source, evidenceRef: 'invented-registry' }] } }, owner, {} as never))
      .rejects.toThrow('DERIVED_SUMMARY_PERSISTENCE_INVALID');
  });
});
