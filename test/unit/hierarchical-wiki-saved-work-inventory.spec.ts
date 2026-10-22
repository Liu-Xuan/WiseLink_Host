import { PgDialect } from 'drizzle-orm/pg-core';
import type { DerivedSummaryMember } from '@shared/derived-summary.interface';
import { readWikiInventory } from '@server/modules/canonical-host/hierarchical-wiki-inventory';
import { wikiDirectVersions } from '@server/modules/canonical-host/hierarchical-wiki-generation';

const owner = { tenantId: 'inventory-tenant', actorUserId: 'inventory-owner' };
const scope = { fleetFamilyId: 'B747', fleetModelId: '747-8' };
const documentReading: DerivedSummaryMember = {
  kind: 'DOCUMENT_READING',
  documentVersionId: 'DV-current',
  parseRunId: 'PR-current',
  semanticRevision: 1,
  readingRunRef: 'DR-current',
  readingRevision: 1,
};
const documentRow = () => ({
  familyId: 'F-selected',
  documentVersionId: 'DV-current',
  metadata: null,
  sourceSha256: 'a'.repeat(64),
  sourceByteLength: 100,
  member: documentReading,
});
const assignment = (ata: string | null = '31-00') => ({
  familyId: 'F-selected',
  documentVersionId: 'DV-current',
  ata,
  status: 'CONFIRMED',
});
const savedWork = () => ({
  familyId: 'F-selected',
  documentVersionId: 'DV-current',
  workItemId: 'WI-selected',
  workRef: 'JAWR-current',
  workRevision: 3,
  savedDocumentVersionId: 'DV-current',
  savedByOwner: true,
  requestId: 'request-current',
  attemptStatus: 'SUCCEEDED',
  roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
  overviewStatus: 'STALE',
  hasUnderstanding: true,
});

/** Real inventory/Drizzle SQL construction with metadata-only fixture responses.
 * No database, source body, runtime or model is invoked. The exact saved body is
 * still read and authorized by the existing DerivedSummaryMembersService. */
function setup(
  input: {
    documents?: ReturnType<typeof documentRow>[];
    assignments?: ReturnType<typeof assignment>[];
    works?: Array<{ workItemId: string; [key: string]: unknown }>;
    removed?: Array<{ kind: string; id: string }>;
    workReadError?: Error;
  } = {},
) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const dialect = new PgDialect();
  const database = {
    execute: jest.fn(
      async (statement: Parameters<PgDialect['sqlToQuery']>[0]) => {
        const query = dialect.sqlToQuery(statement);
        calls.push(query);
        if (query.sql.includes('SELECT DISTINCT m.source_id AS "familyId"'))
          return input.assignments ?? [assignment()];
        if (query.sql.includes('SELECT document_version_id AS id'))
          return [{ id: 'DV-current' }];
        if (query.sql.includes('SELECT d.family_id AS "familyId"'))
          return input.documents ?? [documentRow()];
        if (query.sql.includes('SELECT wi.work_item_id AS "workItemId"')) {
          if (input.workReadError) throw input.workReadError;
          return (input.works ?? [savedWork()]).map((work) => ({
            ...savedWork(),
            ...work,
          }));
        }
        if (query.sql.includes('SELECT DISTINCT m.source_kind AS kind'))
          return input.removed ?? [];
        if (query.sql.includes('w.state_json AS state FROM engineering_matter'))
          return [];
        throw new Error(
          'Unexpected inventory query: ' + query.sql.slice(0, 90),
        );
      },
    ),
  };
  const transactions = { authorizeRuntimeInputs: jest.fn() };
  return {
    calls,
    transactions,
    read: (
      changes: Array<{ kind: string; subjectId: string }> | null = null,
      cursor: string | null = null,
    ) =>
      readWikiInventory(
        database as never,
        owner,
        scope,
        changes,
        cursor,
        transactions as never,
      ),
  };
}
const workItems = (
  result: Awaited<ReturnType<ReturnType<typeof setup>['read']>>,
) => result.items.filter((item) => item.sourceKind === 'WORK_ITEM');

it('adds two exact saved WI leaves at each confirmed ATA4 without replacing the independent document reading', async () => {
  const f = setup({
    assignments: [assignment(), assignment('34-00')],
    works: [
      savedWork(),
      {
        ...savedWork(),
        workItemId: 'WI-second',
        workRef: 'JAWR-second',
        workRevision: 6,
      },
    ],
  });
  const result = await f.read([
    { kind: 'WORK_ITEM', subjectId: 'WI-selected' },
  ]);
  const leaves = workItems(result);
  expect(leaves).toHaveLength(4);
  for (const ata of ['31-00', '34-00']) {
    expect(
      leaves.filter((item) => item.ata === ata).map((item) => item.memberKey),
    ).toEqual(['WORK_ITEM:WI-selected', 'WORK_ITEM:WI-second']);
    expect(
      result.items.find(
        (item) =>
          item.ata === ata && item.memberKey === 'DOCUMENT_FAMILY:F-selected',
      ),
    ).toMatchObject({
      sourceKind: 'DOCUMENT',
      sourceId: 'F-selected',
      member: documentReading,
    });
  }
  expect(leaves[0]).toMatchObject({
    sourceId: 'WI-selected',
    member: {
      kind: 'WORK_ITEM_WORK',
      workItemId: 'WI-selected',
      documentVersionId: 'DV-current',
      workRef: 'JAWR-current',
      workRevision: 3,
      issueKeys: [],
    },
    basis: {
      kind: 'CONFIRMED_MEMBER_FAMILY',
      classificationStatus: 'CONFIRMED',
      familyId: 'F-selected',
      documentVersionId: 'DV-current',
    },
  });
  expect(result.removed).toEqual(
    expect.arrayContaining([
      { kind: 'DOCUMENT', id: 'F-selected' },
      { kind: 'WORK_ITEM', id: 'WI-selected' },
      { kind: 'WORK_ITEM', id: 'WI-second' },
    ]),
  );
  // Only memberships from the exact scope are passed to this projection.
  expect(
    wikiDirectVersions(
      'ATA4',
      leaves.map((item) => ({ key: item.memberKey, member: item.member! })),
    ),
  ).not.toEqual({});
  expect(
    wikiDirectVersions(
      'FLEET',
      leaves.map((item) => ({ key: item.memberKey, member: item.member! })),
    ),
  ).toEqual({});
});

it('does not require a new DocumentReading, an updated Overall, or resolution of open questions', async () => {
  const f = setup({ documents: [{ ...documentRow(), member: null as never }] });
  const result = await f.read();
  expect(workItems(result)[0]?.member).toMatchObject({
    kind: 'WORK_ITEM_WORK',
    workRef: 'JAWR-current',
  });
  expect(result.waiting).toContainEqual(
    expect.objectContaining({ status: 'READING_NOT_READY' }),
  );
  const query = f.calls.find((item) =>
    item.sql.includes('SELECT wi.work_item_id AS "workItemId"'),
  )!;
  expect(query.sql).not.toMatch(
    /overallSynthesis|based_on_work_item_revision/u,
  );
  // Ordinary JobAid attempts use service:openclaw-main; the real owner is
  // verified through WI.requested_by and the latest immutable JAWR creator.
  expect(query.sql).not.toContain('a.actor_user_id=');
  expect(query.sql).toContain('r.created_by_user_id=');
  expect(query.sql).toContain(
    "a.action_type IN ('OPENCLAW_DYNAMIC_EVALUATION'",
  );
  expect(query.params).toContain(owner.tenantId);
  expect(query.params).toContain(owner.actorUserId);
  expect(query.params).toContain(JSON.stringify(['DV-current']));
});

it.each([
  ['a mere candidate', [{ ...assignment(), status: 'CANDIDATE' }]],
  [
    'an explicit exclusion even beside a confirmed duplicate',
    [assignment(), { ...assignment(), status: 'EXCLUDED' }],
  ],
  ['a family-only classification', [assignment(null)]],
])(
  'does not promote %s into a saved work leaf',
  async (_label, assignments) => {
    const result = await setup({ assignments }).read();
    expect(workItems(result)).toEqual([]);
  },
);

it('keeps ATA2-only saved assessment and independent document reading at their confirmed chapter', async () => {
  const result = await setup({ assignments: [assignment('31')] }).read([
    { kind: 'WORK_ITEM', subjectId: 'WI-selected' },
  ]);
  expect(result.items.map(item => item.ata)).toEqual(['31', '31']);
  expect(workItems(result)[0]?.member).toEqual({ kind: 'WORK_ITEM_WORK', workItemId: 'WI-selected',
    documentVersionId: 'DV-current', workRef: 'JAWR-current', workRevision: 3, issueKeys: [] });
  expect(wikiDirectVersions('ATA2', result.items.map(item => ({ key: item.memberKey, member: item.member! }))))
    .toEqual({ 'DOCUMENT_FAMILY:F-selected': documentReading, 'WORK_ITEM:WI-selected': workItems(result)[0]!.member });
  const pending = await setup({ assignments: [assignment('31')], works: [{ ...savedWork(), attemptStatus: 'RUNNING' }] }).read();
  expect(workItems(pending)).toEqual([]);
  expect(pending.waiting).toContainEqual(expect.objectContaining({ ata: '31', status: 'SAVED_ASSESSMENT_NOT_READY' }));
});

it('does not convert an aircraft mention, including another model, into confirmed assessment membership', async () => {
  const documents = [
    {
      ...documentRow(),
      metadata: {
        source: 'ACTUAL_PDF_TEXT',
        sourceSha256: 'a'.repeat(64),
        sourceByteLength: 100,
        mentionedAircraftModels: {
          observations: [
            { value: '747-8', evidence: ['original'] },
            { value: '787-9', evidence: ['comparison-only'] },
          ],
        },
        ata: { observations: [{ value: '31-00', evidence: ['original'] }] },
      } as never,
    },
  ];
  const result = await setup({ documents, assignments: [] }).read();
  expect(result.items).toContainEqual(
    expect.objectContaining({
      sourceKind: 'DOCUMENT',
      basis: expect.objectContaining({ classificationStatus: 'CANDIDATE' }),
    }),
  );
  expect(workItems(result)).toEqual([]);
});

it.each([
  ['a partial latest save', { roundCompletion: 'IN_PROGRESS' }],
  ['a failed attempt', { attemptStatus: 'FAILED' }],
  ['a timed out attempt', { attemptStatus: 'TIMED_OUT' }],
  ['a cancelled attempt', { attemptStatus: 'CANCELLED' }],
  ['a saved attempt still committing', { attemptStatus: 'COMMITTING' }],
  ['missing understanding', { hasUnderstanding: false }],
  [
    'the schema-defined nonempty understanding placeholder',
    { overviewStatus: 'NOT_AVAILABLE' },
  ],
  ['a missing saved revision', { workRef: null, workRevision: null }],
  ['a latest revision by another actor', { savedByOwner: false }],
  [
    'a saved revision for a different DVI',
    { savedDocumentVersionId: 'DV-old' },
  ],
])(
  'keeps %s out and retries metadata through existing family/DVI waiting',
  async (_label, change) => {
    const f = setup({ works: [{ ...savedWork(), ...change }] });
    const result = await f.read([
      { kind: 'WORK_ITEM', subjectId: 'WI-selected' },
    ]);
    expect(workItems(result)).toEqual([]);
    expect(result.waiting).toContainEqual({
      kind: 'DOCUMENT',
      subjectId: 'F-selected',
      documentVersionId: 'DV-current',
      requestId: 'request-current',
      ata: '31-00',
      status: 'SAVED_ASSESSMENT_NOT_READY',
    });
    expect(result.removed).toContainEqual({
      kind: 'WORK_ITEM',
      id: 'WI-selected',
    });
  },
);

it('selects latest-any before readiness and does not fall back to an older complete work', async () => {
  const f = setup({
    works: [
      {
        ...savedWork(),
        workRef: 'JAWR-new-partial',
        workRevision: 4,
        roundCompletion: 'IN_PROGRESS',
      },
    ],
  });
  expect(workItems(await f.read())).toEqual([]);
  const query = f.calls.find((item) =>
    item.sql.includes('SELECT wi.work_item_id AS "workItemId"'),
  )!.sql;
  const latest = query.match(/LEFT JOIN LATERAL \(([\s\S]*?)\) r ON true/u)![1];
  expect(latest).toContain('ORDER BY w.work_revision DESC LIMIT 1');
  expect(latest).not.toMatch(/roundCompletion|SUCCEEDED|created_by_user_id=/u);
  expect(query).toContain(
    'f.current_document_version_id=d.document_version_id',
  );
  expect(query).toContain('wi.requested_by_user_id=');
  expect(query).toContain('a.document_version_id=wi.document_version_id');
  expect(query).toContain('engineering_matter_work_item_owned_by_actor');
});

it('retains a family waiting check while classification advances to the exact current DVI, then admits the saved work', async () => {
  const first = await setup({
    assignments: [{ ...assignment(), documentVersionId: 'DV-old' }],
  }).read();
  expect(workItems(first)).toEqual([]);
  expect(first.waiting).toContainEqual(
    expect.objectContaining({
      kind: 'DOCUMENT',
      subjectId: 'F-selected',
      documentVersionId: 'DV-current',
      status: 'ASSESSMENT_CLASSIFICATION_PENDING',
    }),
  );
  expect(first.removed).toContainEqual({ kind: 'DOCUMENT', id: 'F-selected' });
  const next = await setup().read([
    { kind: 'DOCUMENT', subjectId: 'DV-current' },
  ]);
  expect(workItems(next)[0]?.member).toMatchObject({ workRef: 'JAWR-current' });
  expect(next.waiting).toEqual([]);
});

it('replaces an old current-DVI work without deleting the retained user document classification or another family page', async () => {
  const f = setup({ removed: [{ kind: 'WORK_ITEM', id: 'WI-old-version' }] });
  const result = await f.read([{ kind: 'DOCUMENT', subjectId: 'DV-current' }]);
  expect(result.removed).toContainEqual({
    kind: 'WORK_ITEM',
    id: 'WI-old-version',
  });
  expect(
    result.items.find(
      (item) => item.memberKey === 'DOCUMENT_FAMILY:F-selected',
    ),
  ).toMatchObject({
    basis: {
      kind: 'USER_WIKI_CLASSIFICATION',
      classificationStatus: 'CONFIRMED',
    },
  });
  expect(
    result.items.some((item) => item.memberKey === 'WORK_ITEM:WI-old-version'),
  ).toBe(false);
  const cleanup = f.calls.find((item) =>
    item.sql.includes('SELECT DISTINCT m.source_kind AS kind'),
  )!;
  expect(cleanup.sql).toContain("WHEN 'WORK_ITEM' THEN");
  expect(cleanup.sql).toContain('wi.work_item_id IS NULL');
  expect(cleanup.sql).toContain(
    'p.current_document_version_id=d.document_version_id',
  );
  expect(cleanup.params).toContain(JSON.stringify(['F-selected']));
  expect(result.removed).not.toContainEqual({
    kind: 'WORK_ITEM',
    id: 'WI-other-page',
  });
  expect(
    f.calls.every((item) => !/\b(?:UPDATE|INSERT|DELETE)\b/u.test(item.sql)),
  ).toBe(true);
});

it('removes vanished or revoked retained WI memberships even when authorized discovery cannot return that DVI', async () => {
  const f = setup({
    documents: [],
    removed: [{ kind: 'WORK_ITEM', id: 'WI-revoked' }],
  });
  const result = await f.read();
  expect(workItems(result)).toEqual([]);
  expect(result.removed).toContainEqual({
    kind: 'WORK_ITEM',
    id: 'WI-revoked',
  });
  expect(
    f.calls.some((item) =>
      item.sql.includes('SELECT wi.work_item_id AS "workItemId"'),
    ),
  ).toBe(false);
  const cleanup = f.calls.find((item) =>
    item.sql.includes('SELECT DISTINCT m.source_kind AS kind'),
  )!.sql;
  expect(cleanup).toContain('engineering_matter_work_item_owned_by_actor');
  expect(cleanup).toContain('engineering_matter_document_owned_by_actor');
  expect(cleanup).toContain(
    "m.basis_json->>'documentVersionId' IS DISTINCT FROM wi.document_version_id",
  );
});

it('keeps the existing document cursor while work discovery is restricted to that exact page', async () => {
  const documents = Array.from({ length: 100 }, (_, index) => ({
    ...documentRow(),
    familyId: 'F-' + index,
    documentVersionId: 'DV-' + String(index).padStart(3, '0'),
  }));
  const f = setup({ documents, works: [] });
  const result = await f.read(
    null,
    JSON.stringify({
      document: 'DV-before',
      matter: null,
      documentDone: false,
      matterDone: false,
    }),
  );
  expect(result.complete).toBe(false);
  expect(JSON.parse(result.cursor!)).toMatchObject({
    document: 'DV-099',
    documentDone: false,
    matterDone: true,
  });
  const workQuery = f.calls.find((item) =>
    item.sql.includes('SELECT wi.work_item_id AS "workItemId"'),
  )!;
  expect(workQuery.params).toContain(
    JSON.stringify(documents.map((item) => item.documentVersionId)),
  );
  expect(result.removed).toHaveLength(100);
});

it('propagates a failed metadata read instead of converting it into an empty successful inventory', async () => {
  const error = new Error('SOURCE_AUTHORIZATION_CHANGED');
  await expect(setup({ workReadError: error }).read()).rejects.toBe(error);
});
