import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import postgres from 'postgres';
import { prepareHierarchicalWikiDdl } from '../../../scripts/prepare-hierarchical-wiki-ddl.mjs';

const require = createRequire(import.meta.url);

/** Constructed local sources only. Production repositories, SDK SQL context,
 * migrations, RLS, queue, member reads and SAVE transactions remain real. */
export async function runHierarchicalWikiPostgres(t, fixture) {
  const {
    admin,
    reset,
    seed,
    seedSemanticContext,
    semanticOriginal,
    nativeActor,
    databaseUrl,
  } = fixture;
  await reset(admin);
  await seed(admin);
  const { manifest } = await seedSemanticContext(admin);
  await admin.unsafe(`ALTER TABLE dm_document_version ADD COLUMN pdf_sha256 varchar DEFAULT '${'a'.repeat(64)}',
    ADD COLUMN byte_length bigint DEFAULT 100, ADD COLUMN source_artifact_id varchar DEFAULT 'SRC-summary';
    ALTER TABLE dm_publication_family ADD COLUMN canonical_document_number varchar DEFAULT 'Synthetic Wiki';
    ALTER TABLE engineering_matter ADD COLUMN default_family_id varchar,ADD COLUMN title text;
    ALTER TABLE engineering_matter_work_revision ADD COLUMN state_json text;
    CREATE TABLE dm_document_version_metadata(document_version_id varchar,metadata_revision integer,extracted_metadata jsonb);
    CREATE TABLE engineering_matter_material_link(matter_revision_id varchar,family_id varchar,document_version_id varchar,kind varchar,material_json text);
    CREATE TABLE engineering_matter_revision_work_item(matter_revision_id varchar,work_item_id varchar);
    UPDATE dm_publication_family SET current_document_version_id='DV-old';
    GRANT SELECT ON dm_document_version_metadata,engineering_matter,engineering_matter_work_revision,
      engineering_matter_material_link,engineering_matter_revision_work_item TO authenticated,service_role;`);
  await admin.unsafe(
    await readFile('migrations/0060_document_reading_run.sql', 'utf8'),
  );
  await admin.unsafe(
    await readFile('migrations/0061_document_reading_retraction.sql', 'utf8'),
  );
  await admin.unsafe(
    await readFile(
      'migrations/0076_derived_summary_document_reading.sql',
      'utf8',
    ),
  );
  const wikiTemplate = await readFile(
    'migrations/0077_hierarchical_wiki.sql',
    'utf8',
  );
  const snapshot = {
    ok: true,
    data: [
      { schema_probe: { schema: 'public', constraints: [], policies: [] } },
    ],
  };
  await admin.unsafe(
    prepareHierarchicalWikiDdl({
      template: wikiTemplate,
      devSnapshot: snapshot,
      onlineSnapshot: snapshot,
    }),
  );
  await admin.unsafe(`GRANT ALL ON hierarchical_wiki_scope,hierarchical_wiki_membership,hierarchical_wiki_change TO authenticated,service_role,anon;
    GRANT USAGE ON SEQUENCE hierarchical_wiki_change_seq_seq TO authenticated,service_role;
    GRANT SELECT,INSERT,UPDATE ON dm_document_reading_run TO authenticated,service_role;
    GRANT SELECT,INSERT ON dm_document_reading_retraction TO authenticated,service_role;
    CREATE POLICY platform_native_crud ON hierarchical_wiki_scope TO authenticated,service_role,anon USING(true) WITH CHECK(true);
    CREATE POLICY platform_native_crud ON hierarchical_wiki_membership TO authenticated,service_role,anon USING(true) WITH CHECK(true);
    CREATE POLICY platform_native_crud ON hierarchical_wiki_change TO authenticated,service_role,anon USING(true) WITH CHECK(true);`);
  if (fixture.configureUnclaimed) await fixture.configureUnclaimed(admin);
  const { drizzle } = require('drizzle-orm/postgres-js');
  const { sql } = require('drizzle-orm');
  const {
    SqlExecutionContextMiddleware,
  } = require('@lark-apaas/fullstack-nestjs-core');
  const {
    EngineeringMatterWorkingRepository,
  } = require('../../../server/modules/canonical-host/engineering-matter-working.repository.ts');
  const {
    JobAidWorkRepository,
  } = require('../../../server/modules/canonical-host/jobaid-work.repository.ts');
  const {
    CanonicalJobAidProblemService,
  } = require('../../../server/modules/canonical-host/canonical-jobaid-problem.service.ts');
  const {
    DerivedSummaryMembersService,
  } = require('../../../server/modules/canonical-host/derived-summary-members.service.ts');
  const {
    DerivedSummaryRepository,
  } = require('../../../server/modules/canonical-host/derived-summary.repository.ts');
  const {
    DerivedSummaryService,
  } = require('../../../server/modules/canonical-host/derived-summary.service.ts');
  const {
    DerivedSummaryRuntimeService,
  } = require('../../../server/modules/canonical-host/derived-summary-runtime.service.ts');
  const {
    HierarchicalWikiService,
  } = require('../../../server/modules/canonical-host/hierarchical-wiki.service.ts');
  const {
    HierarchicalWikiChanges,
  } = require('../../../server/modules/canonical-host/hierarchical-wiki-changes.ts');
  const {
    HierarchicalWikiCompletion,
  } = require('../../../server/modules/canonical-host/hierarchical-wiki-completion.ts');
  const {
    DocumentReadingRunRepository,
  } = require('../../../server/modules/canonical-host/document-reading-run.repository.ts');
  const {
    buildTranslationSourcePlan,
  } = require('../../../server/modules/canonical-host/canonical-translation-source-plan.ts');
  const {
    validateDocumentReading,
    materializeDocumentReading,
  } = require('../../../server/modules/canonical-host/document-reading-candidate.ts');
  const {
    taskModelSelection,
  } = require('../../../server/modules/model-settings/canonical-model-catalog.ts');
  const owner = { tenantId: 'tenant-summary', actorUserId: 'actor-summary' };
  const serviceScope = {
    ...owner,
    appId: 'app_17bzc551rsg',
    principalId: 'service-summary',
    authorizationFingerprint: 'configured',
  };
  const client = postgres(databaseUrl, { max: 1, onnotice() {}, debug: fixture.observeSql });
  t.after(() => client.end({ timeout: 5 }));
  const database = drizzle(client);
  const context = new SqlExecutionContextMiddleware({ roleSchema: 'public' });
  const run = (actorId, hosted, operation) =>
    new Promise((resolve, reject) =>
      context.use(
        {
          userContext: { userId: actorId, isSystemAccount: hosted, roles: [] },
        },
        {},
        () => Promise.resolve().then(operation).then(resolve, reject),
      ),
    );
  const browser = (operation) => run(owner.actorUserId, false, operation);
  const hosted = (operation) => run('-1', true, operation);
  const actors = new EngineeringMatterWorkingRepository(
    database,
    context,
    { roleSchema: 'public' },
    null,
  );
  const original = semanticOriginal();
  const originalReader = {
    readDocumentOriginal: async (documentVersionId, parseRunId, actor) => {
      await actors.withActorScope(actor.actorUserId, async () => {
        const rows = await database.execute(
          sql`SELECT engineering_matter_document_owned_by_actor(${actor.tenantId},${documentVersionId}) AS allowed`,
        );
        assert.equal(rows[0].allowed, true);
      });
      assert.equal(documentVersionId, original.binding.documentVersionId);
      assert.equal(parseRunId, original.binding.parseRunId);
      return {
        original: structuredClone(original),
        structuredSource: structuredClone(original.source),
        run: { manifestArtifact: manifest },
      };
    },
  };
  const changes = new HierarchicalWikiChanges(database);
  const readings = new DocumentReadingRunRepository(database, changes);
  const jobAid = new CanonicalJobAidProblemService(
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    new JobAidWorkRepository(database, actors, null),
  );
  const members = new DerivedSummaryMembersService(
    jobAid,
    actors,
    originalReader,
  );
  const repository = new DerivedSummaryRepository(database, actors, members);
  const models = fixture.modelSettings?.(database);
  const authorization = {
    authorizeOpenClawAutoWorkItemQueue: async () => serviceScope,
  };
  const completion = new HierarchicalWikiCompletion();
  const summaries = new DerivedSummaryService(
    repository,
    members,
    authorization,
    completion,
    models,
  );
  const runtime = new DerivedSummaryRuntimeService(
    repository,
    members,
    summaries,
    completion,
  );
  const wiki = new HierarchicalWikiService(
    database,
    repository,
    summaries,
    members,
    actors,
    {
      readLibraryCatalog: async () => ({
        status: 'AVAILABLE',
        families: [{ fleetFamily: 'B787', models: ['B787-9'] }],
      }),
    },
    authorization,
    undefined,
    models,
  );
  const concurrentClient = postgres(databaseUrl, { max: 1, onnotice() {}, debug: fixture.observeSql });
  t.after(() => concurrentClient.end({ timeout: 5 }));
  const concurrentDatabase = drizzle(concurrentClient);
  const concurrentActors = new EngineeringMatterWorkingRepository(
    concurrentDatabase,
    context,
    { roleSchema: 'public' },
    null,
  );
  const concurrentRepository = new DerivedSummaryRepository(
    concurrentDatabase,
    concurrentActors,
    members,
  );
  const concurrentWiki = new HierarchicalWikiService(
    concurrentDatabase,
    concurrentRepository,
    summaries,
    members,
    concurrentActors,
    {
      readLibraryCatalog: async () => ({
        status: 'AVAILABLE',
        families: [{ fleetFamily: 'B787', models: ['B787-9'] }],
      }),
    },
    authorization,
    undefined,
    models,
  );
  const deferred = () => {
    let resolve;
    const promise = new Promise((value) => {
      resolve = value;
    });
    return { promise, resolve };
  };
  const actor = nativeActor(owner.actorUserId, owner.tenantId);
  const plan = buildTranslationSourcePlan({
    documentVersionId: original.binding.documentVersionId,
    packageId: original.binding.parseRunId,
    title: '',
    source: original.source,
    parsedArtifact: {
      storeRole: 'UnifiedArtifactStoreCandidate',
      ref: 'synthetic-only',
      sha256: 'a'.repeat(64),
      byteLength: 100,
      mediaType: 'application/json',
    },
  });
  const anchor = plan.anchors[0];
  const producer = {
    skillVersion: 'synthetic-local-fixture',
    modelVersion: 'synthetic-not-called',
  };
  const readingContext = {
    sourceBinding: { original: original.binding, semanticRevision: 1 },
    sourceUnitIds: original.source.units.map((item) => item.unitId),
    sourceCoverage: original.coverage,
    deliveredAnchors: plan.anchors,
    delivered: [
      {
        offset: 0,
        unitIds: original.source.units.map((item) => item.unitId),
        anchorIds: plan.anchors.map((item) => item.anchorId),
        nextOffset: null,
      },
    ],
  };
  const statement = {
    text: 'Conditional synthetic reading; not an applicability decision.',
    quotes: [
      {
        anchorId: anchor.anchorId,
        start: 0,
        end: anchor.sourceText.length,
        text: anchor.sourceText,
      },
    ],
  };
  const candidate = validateDocumentReading(
    {
      schemaVersion: 'wiselink.document.reading.v1',
      headline: 'Synthetic saved Wiki',
      brief: statement,
      explanation: [statement],
      criticalConditions: [statement],
      limitations: ['Constructed source; not live OEM evidence.'],
    },
    readingContext,
  );
  const appendReading = (revision) =>
    hosted(() =>
      actors.withActorScope('other-actor', async () => {
        const scope = {
          tenantId: owner.tenantId,
          actorUserId: 'other-actor',
          documentVersionId: 'DV-old',
        };
        const run = await readings.begin(scope, {
          requestId: `wiki-reading-${revision}`,
          parseRunId: original.binding.parseRunId,
          parseRevision: 1,
          semanticRevision: 1,
          manifestSha256: manifest.sha256,
          expectedRevision: revision - 1,
          executionModel: taskModelSelection('miaoda/glm-5.3', new Date()),
        });
        const fence = await readings.claim(
          scope,
          run.runRef,
          'synthetic-reader',
        );
        assert.ok(fence);
        await readings.recordDelivery(
          scope,
          fence,
          readingContext.delivered[0],
        );
        return readings.save(
          scope,
          fence,
          { candidate, producer },
          (snapshot, next) =>
            materializeDocumentReading(candidate, {
              readingRunRef: snapshot.runRef,
              readingRevision: next,
              producer,
              savedAt: new Date().toISOString(),
            }),
        );
      }),
    );
  await admin`INSERT INTO summary_test_document_acl VALUES(${owner.tenantId},'other-actor','DV-old',true)`;
  const metadata = {
    source: 'ACTUAL_PDF_TEXT',
    sourceSha256: 'a'.repeat(64),
    sourceByteLength: 100,
    mentionedAircraftModels: {
      observations: [
        {
          value: 'B787-9',
          evidence: [{ quote: 'Constructed B787-9 mention.' }],
        },
      ],
    },
    ata: {
      observations: [
        { value: '46-00', evidence: [{ quote: 'Constructed ATA 46-00.' }] },
      ],
    },
  };
  await admin`INSERT INTO dm_document_version_metadata VALUES('DV-old',1,${admin.json(metadata)})`;
  const savedReading = await appendReading(1);
  if (fixture.verifyUnclaimed) {
    await fixture.verifyUnclaimed(t, {
      admin, run, owner, serviceScope, actor, nativeActor, database, client, actors,
      repository, members, summaries, runtime, wiki, concurrentClient, concurrentDatabase,
      concurrentActors, concurrentRepository, concurrentWiki, savedReading,
    });
    return;
  }
  let root;
  let ata4;
  let ata2;
  let saved4;
  const later = (hours) =>
    new Date(Date.now() + hours * 60 * 60_000).toISOString();
  const prepare = async (selected) => {
    const target = {
      summaryId: selected.summaryId,
      attemptRef: selected.attemptRef,
      scope: serviceScope,
    };
    const lease = await hosted(() => runtime.claim(target));
    const fence = {
      leaseToken: lease.leaseToken,
      leaseGeneration: lease.leaseGeneration,
    };
    const refs = lease.task.modelInput.members.map((item) => item.evidenceRef);
    await hosted(() =>
      runtime.readMemberWork({
        ...target,
        ...fence,
        evidenceRefs: refs,
        purpose: 'Synthetic exact members',
      }),
    );
    const sources = lease.task.modelInput.evidence.map(
      (item) => item.evidenceRef,
    );
    await hosted(() =>
      runtime.readSources({
        ...target,
        ...fence,
        evidenceRefs: sources,
        purpose: 'Synthetic original roots',
      }),
    );
    const input = {
      ...target,
      ...fence,
      requestId: lease.task.requestId,
      expectedSummaryRevision: lease.task.expectedSummaryRevision,
      contentJson: JSON.stringify({
        headline: 'Synthetic full Wiki',
        listBrief: 'Explicit constructed coverage',
        body: `Retain every selected member and original condition. ${[...refs, ...sources].map((ref) => `[[${ref}]]`).join(' ')}`,
        limitations: ['Constructed material; no live model invocation.'],
      }),
    };
    return { target, lease, input };
  };
  const save = async (selected) => {
    const prepared = await prepare(selected);
    const saved = await hosted(() => runtime.save(prepared.input));
    const exact = await browser(() =>
      summaries.readRevision(selected.summaryId, saved.summaryRef, actor),
    );
    assert.equal(
      exact.revision.coverage.every((item) => item.delivered && item.used),
      true,
    );
    await hosted(() =>
      runtime.finish({
        ...prepared.target,
        leaseToken: prepared.lease.leaseToken,
        leaseGeneration: prepared.lease.leaseGeneration,
        requestId: prepared.input.requestId,
      }),
    );
    return { saved, exact };
  };
  await t.test(
    'candidate mentions alone make zero attempts; confirmed private stable scopes deliver another producer reading',
    async () => {
      const first = await browser(() =>
        wiki.enable(
          {
            fleetFamilyId: 'B787',
            fleetModelId: 'B787-9',
            modelRef: 'miaoda/glm-5.3',
          },
          actor,
        ),
      );
      root = first.items.find((item) => item.scope.kind === 'FLEET');
      ata4 = first.items.find((item) => item.scope.kind === 'ATA4');
      ata2 = first.items.find((item) => item.scope.kind === 'ATA2');
      assert.equal(first.candidates.length, 1);
      assert.equal((await hosted(() => wiki.next(later(1)))).status, 'IDLE');
      assert.equal(
        (
          await admin`SELECT * FROM action_attempt WHERE subject_kind='DERIVED_SUMMARY'`
        ).length,
        0,
      );
      const again = await browser(() =>
        wiki.enable(
          {
            fleetFamilyId: 'B787',
            fleetModelId: 'B787-9',
            modelRef: 'miaoda/glm-5.3',
          },
          actor,
        ),
      );
      assert.equal(
        again.items.find((item) => item.scope.kind === 'FLEET').summaryId,
        root.summaryId,
      );
      await browser(() =>
        wiki.classify(
          root.summaryId,
          {
            sourceKind: 'DOCUMENT',
            sourceId: 'FAMILY-summary',
            ata: '46-00',
            included: true,
          },
          actor,
        ),
      );
      const [next, concurrent] = await Promise.all([
        hosted(() => wiki.next(later(1))),
        hosted(() => concurrentWiki.next(later(1))),
      ]);
      assert.equal(next.summaryId, ata4.summaryId);
      assert.equal(concurrent.attemptRef, next.attemptRef);
      const [admitted] =
        await admin`SELECT count(*)::int AS n FROM action_attempt WHERE summary_id=${ata4.summaryId}`;
      assert.equal(admitted.n, 1);
      saved4 = await save(next);
      assert.equal(
        saved4.exact.revision.members[0].member.readingRunRef,
        savedReading.readingRunRef,
      );
      assert.equal(
        saved4.exact.revision.members[0].member.kind,
        'DOCUMENT_READING',
      );
      assert.ok(
        saved4.exact.revision.members[0].body.includes(
          'Conditional synthetic reading',
        ),
      );
    },
  );
  await t.test(
    'actual SAVED ATA4→ATA2→model pointers propagate once, roots stay unique and empty tick creates zero work',
    async () => {
      const upper = await hosted(() => wiki.next(later(2)));
      assert.equal(upper.summaryId, ata2.summaryId);
      const saved2 = await save(upper);
      assert.equal(
        saved2.exact.revision.members[0].member.summaryRef,
        saved4.saved.summaryRef,
      );
      const fleet = await hosted(() => wiki.next(later(3)));
      assert.equal(fleet.summaryId, root.summaryId);
      const savedFleet = await save(fleet);
      assert.equal(
        savedFleet.exact.revision.members[0].member.summaryRef,
        saved2.saved.summaryRef,
      );
      const roots = savedFleet.exact.revision.coverage.flatMap(
        (item) => item.rootRefs,
      );
      assert.equal(new Set(roots).size, roots.length);
      assert.ok(roots.length);
      const [before] =
        await admin`SELECT count(*)::int AS n FROM action_attempt`;
      assert.equal((await hosted(() => wiki.next(later(4)))).status, 'IDLE');
      const [after] =
        await admin`SELECT count(*)::int AS n FROM action_attempt`;
      assert.equal(after.n, before.n);
    },
  );
  await t.test(
    'concurrent inventory holds the real root lock before reading classification; a later exclusion cannot be overwritten',
    async () => {
      const inventory = require('../../../server/modules/canonical-host/hierarchical-wiki-inventory.ts');
      const originalRead = inventory.readWikiInventory;
      const reached = deferred(),
        release = deferred();
      let pause = true;
      inventory.readWikiInventory = async (...args) => {
        const result = await originalRead(...args);
        if (pause) {
          pause = false;
          reached.resolve();
          await release.promise;
        }
        return result;
      };
      await admin`UPDATE hierarchical_wiki_scope SET last_inventory_at=CURRENT_TIMESTAMP-INTERVAL '2 days' WHERE wiki_id=${root.wikiId}`;
      const [{ pid: refreshPid }] =
        await client`SELECT pg_backend_pid() AS pid`;
      const [{ pid: classifyPid }] =
        await concurrentClient`SELECT pg_backend_pid() AS pid`;
      const refresh = browser(() => wiki.list(actor)).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      let exclusion;
      try {
        await Promise.race([
          reached.promise,
          refresh.then((result) => {
            throw result.error ?? new Error('Inventory missed its barrier');
          }),
        ]);
        exclusion = browser(() =>
          concurrentWiki.classify(
            root.summaryId,
            {
              sourceKind: 'DOCUMENT',
              sourceId: 'FAMILY-summary',
              ata: '46-00',
              included: false,
            },
            actor,
          ),
        ).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        let blocked = false;
        for (let index = 0; index < 100; index++) {
          const [lock] =
            await admin`SELECT ${refreshPid}::int=ANY(pg_blocking_pids(${classifyPid}::int)) AS blocked`;
          if (lock.blocked) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(
          blocked,
          true,
          'classifier must wait for the inventory root lock',
        );
        release.resolve();
        assert.equal((await refresh).error, undefined);
        assert.equal((await exclusion).error, undefined);
        const [row] =
          await admin`SELECT m.basis_json,w.state_json FROM hierarchical_wiki_membership m
        JOIN hierarchical_wiki_scope w ON w.wiki_id=m.wiki_id WHERE m.source_id='FAMILY-summary' AND w.wiki_id=${ata4.wikiId}`;
        assert.equal(row.basis_json.classificationStatus, 'EXCLUDED');
        assert.deepEqual(row.state_json.versions, {});
      } finally {
        release.resolve();
        await refresh;
        if (exclusion) await exclusion;
        inventory.readWikiInventory = originalRead;
      }
      await browser(() =>
        wiki.classify(
          root.summaryId,
          {
            sourceKind: 'DOCUMENT',
            sourceId: 'FAMILY-summary',
            ata: '46-00',
            included: true,
          },
          actor,
        ),
      );
    },
  );
  await t.test(
    'new reading during an admitted run rejects stale first SAVE and leaves its prior body intact',
    async () => {
      await appendReading(2);
      await browser(() => wiki.list(actor));
      const next = await hosted(() => wiki.next(later(5)));
      assert.equal(next.summaryId, ata4.summaryId);
      const pending = await prepare(next);
      await appendReading(3);
      await assert.rejects(
        hosted(() => runtime.save(pending.input)),
        /DERIVED_SUMMARY_CONTEXT_CHANGED/,
      );
      const head = await browser(() => summaries.read(ata4.summaryId, actor));
      assert.equal(head.currentSummaryRef, saved4.saved.summaryRef);
      assert.equal(head.currentRevision, 1);
    },
  );
  await t.test(
    'explicit removal persists, masks current parents and rejects in-flight old scope while authorized history survives',
    async () => {
      await hosted(() => wiki.next(later(6))); // Observe the exact terminal conflict, schedule a bounded successor.
      const next = await hosted(() => wiki.next(later(7)));
      assert.equal(next.summaryId, ata4.summaryId);
      const pending = await prepare(next);
      const originalLock = repository.lockContext;
      const locked = deferred(),
        release = deferred();
      let pause = true;
      repository.lockContext = async (...args) => {
        await originalLock.apply(repository, args);
        if (pause && args[3] === ata4.summaryId) {
          pause = false;
          locked.resolve();
          await release.promise;
        }
      };
      const saveOutcome = hosted(() => runtime.save(pending.input)).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      try {
        await Promise.race([
          locked.promise,
          saveOutcome.then((result) => {
            throw result.error ?? new Error('SAVE missed context barrier');
          }),
        ]);
        const list = await browser(() =>
          concurrentWiki.classify(
            root.summaryId,
            {
              sourceKind: 'DOCUMENT',
              sourceId: 'FAMILY-summary',
              ata: '46-00',
              included: false,
            },
            actor,
          ),
        );
        assert.equal(
          list.classifications.find(
            (item) => item.sourceId === 'FAMILY-summary',
          ).status,
          'EXCLUDED',
        );
        release.resolve();
        assert.match(
          (await saveOutcome).error?.message ?? '',
          /DERIVED_SUMMARY_CONTEXT_CHANGED/,
        );
      } finally {
        release.resolve();
        await saveOutcome;
        repository.lockContext = originalLock;
      }
      await browser(() =>
        wiki.update(ata4.summaryId, { immediately: true }, actor),
      );
      for (const page of [ata4, ata2, root]) {
        const head = await browser(() => summaries.read(page.summaryId, actor));
        assert.equal(head.current, null);
        assert.equal(head.currentBodyStatus, 'UPDATING_SCOPE');
      }
      assert.equal(
        (
          await browser(() =>
            summaries.readRevision(
              ata4.summaryId,
              saved4.saved.summaryRef,
              actor,
            ),
          )
        ).revision.revision,
        1,
      );
      const replay = await browser(() => wiki.list(actor));
      assert.equal(
        replay.classifications.find(
          (item) => item.sourceId === 'FAMILY-summary',
        ).status,
        'EXCLUDED',
      );
    },
  );
  await t.test(
    'source revocation permits only exact automatic cancellation metadata and never source/body reads',
    async () => {
      await browser(() =>
        wiki.classify(
          root.summaryId,
          {
            sourceKind: 'DOCUMENT',
            sourceId: 'FAMILY-summary',
            ata: '46-00',
            included: true,
          },
          actor,
        ),
      );
      await hosted(() => wiki.next(later(8)));
      const next = await hosted(() => wiki.next(later(9)));
      assert.equal(next.status, 'SUMMARY_PENDING');
      await admin`UPDATE summary_test_document_acl SET allowed=false WHERE actor_id=${owner.actorUserId} AND document_version_id='DV-old'`;
      await assert.rejects(
        browser(() =>
          summaries.readRevision(
            ata4.summaryId,
            saved4.saved.summaryRef,
            actor,
          ),
        ),
        /UNAVAILABLE/,
      );
      const receipt = await hosted(() =>
        wiki.cleanup({
          kind: 'SUMMARY',
          subjectId: next.summaryId,
          attemptRef: next.attemptRef,
          operation: 'CANCEL',
        }),
      );
      assert.equal(receipt.status, 'CANCELLED');
      assert.equal(Object.hasOwn(receipt, 'task'), false);
      await assert.rejects(
        hosted(() =>
          wiki.cleanup({
            kind: 'SUMMARY',
            subjectId: root.summaryId,
            attemptRef: next.attemptRef,
            operation: 'STATUS',
          }),
        ),
        (error) =>
          error.cause?.code === '42501' &&
          error.cause.message.includes('WIKI_ATTEMPT_UNAVAILABLE'),
      );
      await admin`UPDATE summary_test_document_acl SET allowed=true WHERE actor_id=${owner.actorUserId} AND document_version_id='DV-old'`;
    },
  );
  await t.test(
    'broad platform CRUD cannot expose other-owner registries, invoke private discovery, or truncate Wiki history',
    async () => {
      const rows = await run('other-actor', false, () =>
        database.execute(sql`SELECT wiki_id FROM hierarchical_wiki_scope`),
      );
      assert.equal(rows.length, 0);
      await assert.rejects(
        run(owner.actorUserId, false, () =>
          database.execute(
            sql`SELECT * FROM hierarchical_wiki_runtime_owners(${owner.tenantId},${serviceScope.principalId})`,
          ),
        ),
        (error) => error.cause?.code === '42501',
      );
      await assert.rejects(
        browser(() =>
          database.execute(sql`TRUNCATE hierarchical_wiki_scope CASCADE`),
        ),
        (error) => error.cause?.code === '42501',
      );
      await assert.rejects(
        browser(() => database.execute(sql`TRUNCATE hierarchical_wiki_change`)),
        (error) => error.cause?.code === '42501',
      );
    },
  );
  await t.test(
    'withdrawing the newest reading creates waiting instead of silently falling back to an older reading',
    async () => {
      const [latest] =
        await admin`SELECT run_ref FROM dm_document_reading_run WHERE reading_revision=3`;
      await hosted(() =>
        actors.withActorScope('other-actor', () =>
          readings.retract(
            {
              tenantId: owner.tenantId,
              actorUserId: 'other-actor',
              documentVersionId: 'DV-old',
            },
            {
              runRef: latest.run_ref,
              expectedReadingRevision: 3,
              requestId: 'wiki-retraction-3',
              reasonCode: 'SYNTHETIC_CORRECTION',
              reviewReference: 'synthetic-owned-review',
            },
          ),
        ),
      );
      const list = await browser(() => wiki.list(actor));
      const page = list.items.find((item) => item.summaryId === ata4.summaryId);
      assert.ok(
        page.waiting.some(
          (item) =>
            item.kind === 'DOCUMENT' && item.status === 'READING_NOT_READY',
        ),
      );
      const [row] =
        await admin`SELECT member_json FROM hierarchical_wiki_membership WHERE source_id='FAMILY-summary' AND wiki_id=${page.wikiId}`;
      assert.deepEqual(row.member_json, {});
      assert.equal(
        (await browser(() => summaries.read(ata4.summaryId, actor))).current,
        null,
      );
      assert.equal(
        (
          await browser(() =>
            readings.readSavedState(
              { ...owner, documentVersionId: 'DV-old' },
              original.binding.parseRunId,
              1,
              3,
            ),
          )
        ).status,
        'RETRACTED',
      );
    },
  );
  await t.test(
    '201 sources reconcile across independent inventory/event cursors and classification pages without claiming completeness early',
    async () => {
      await admin.unsafe(`INSERT INTO dm_document_version(document_version_id,family_id)
      SELECT 'DV-bulk-'||lpad(n::text,3,'0'),'FAMILY-bulk-'||lpad(n::text,3,'0') FROM generate_series(0,200) n;
      INSERT INTO dm_publication_family(family_id,current_document_version_id)
      SELECT 'FAMILY-bulk-'||lpad(n::text,3,'0'),'DV-bulk-'||lpad(n::text,3,'0') FROM generate_series(0,200) n;
      INSERT INTO summary_test_document_acl SELECT 'tenant-summary','actor-summary','DV-bulk-'||lpad(n::text,3,'0'),true FROM generate_series(0,200) n;`);
      await admin`INSERT INTO dm_document_version_metadata SELECT document_version_id,1,${admin.json(metadata)} FROM dm_document_version WHERE document_version_id LIKE 'DV-bulk-%'`;
      await admin`UPDATE hierarchical_wiki_scope SET last_inventory_at=CURRENT_TIMESTAMP-INTERVAL '2 days' WHERE scope_json->>'kind'='FLEET'`;
      const first = await browser(() => wiki.list(actor));
      assert.equal(
        first.items.find((item) => item.summaryId === root.summaryId)
          .inventoryComplete,
        false,
      );
      const [partial] =
        await admin`SELECT inventory_cursor,last_inventory_at FROM hierarchical_wiki_scope WHERE summary_id=${root.summaryId}`;
      assert.ok(partial.inventory_cursor);
      assert.ok(
        Date.now() - partial.last_inventory_at.getTime() > 24 * 60 * 60_000,
      );
      await browser(() => wiki.list(actor));
      const complete = await browser(() => wiki.list(actor));
      assert.equal(
        complete.items.find((item) => item.summaryId === root.summaryId)
          .inventoryComplete,
        true,
      );
      const keys = new Set();
      let cursor;
      do {
        const page = await browser(() => wiki.list(actor, cursor));
        for (const entry of page.classifications)
          if (entry.sourceId.startsWith('FAMILY-bulk-'))
            keys.add(entry.sourceId);
        cursor = page.nextClassificationCursor ?? undefined;
      } while (cursor);
      assert.equal(keys.size, 201);
      const [rows] =
        await admin`SELECT count(*)::int AS n FROM hierarchical_wiki_membership WHERE source_id LIKE 'FAMILY-bulk-%'
      AND basis_json->>'classificationStatus'='CANDIDATE'`;
      assert.equal(rows.n, 201);
    },
  );
  await t.test(
    '201 incremental changes preserve other pages of candidates and waiting, including after documentDone',
    async () => {
      const changes = Array.from({ length: 201 }, (_, n) => ({
        kind: 'DOCUMENT',
        subjectId: `DV-bulk-${String(n).padStart(3, '0')}`,
        important: false,
      }));
      const [{ state_json: state, last_event_seq: lastSeq }] =
        await admin`SELECT state_json,last_event_seq FROM hierarchical_wiki_scope WHERE wiki_id=${root.wikiId}`;
      // These are retained, confirmed missing-readings on later pages. Candidates
      // elsewhere remain candidates; neither may disappear on the first page.
      await admin`UPDATE hierarchical_wiki_membership SET basis_json=jsonb_set(basis_json,'{classificationStatus}','"CONFIRMED"'::jsonb)
      WHERE source_id IN ('FAMILY-bulk-150','FAMILY-bulk-200')`;
      const gaps = [150, 200].map((n) => ({
        kind: 'DOCUMENT',
        subjectId: `FAMILY-bulk-${n}`,
        documentVersionId: `DV-bulk-${n}`,
        requestId: null,
        status: 'READING_NOT_READY',
      }));
      await admin`UPDATE hierarchical_wiki_scope SET state_json=${admin.json({ ...state, pendingEvents: { untilSeq: String(lastSeq), changes, cursor: null } })} WHERE wiki_id=${root.wikiId}`;
      await admin`UPDATE hierarchical_wiki_scope SET state_json=jsonb_set(state_json,'{waiting}',${admin.json(gaps)}::jsonb) WHERE wiki_id=${ata4.wikiId}`;
      for (let index = 0; index < 3; index++) {
        const listed = await browser(() => wiki.list(actor));
        const [count] =
          await admin`SELECT count(*)::int AS n FROM hierarchical_wiki_membership WHERE source_id LIKE 'FAMILY-bulk-%'`;
        assert.equal(count.n, 201);
        assert.ok(
          listed.items
            .find((item) => item.wikiId === ata4.wikiId)
            .waiting.some((item) => item.subjectId === 'FAMILY-bulk-200'),
        );
      }
      const [rootState] =
        await admin`SELECT state_json FROM hierarchical_wiki_scope WHERE wiki_id=${root.wikiId}`;
      assert.equal(rootState.state_json.pendingEvents, null);
      // An event with no document work on this page must not clear a retained gap.
      await admin`UPDATE hierarchical_wiki_scope SET state_json=jsonb_set(state_json,'{pendingEvents}',${admin.json(
        {
          untilSeq: String(lastSeq),
          changes,
          cursor: JSON.stringify({
            document: 'DV-bulk-200',
            matter: null,
            documentDone: true,
            matterDone: false,
          }),
        },
      )}::jsonb) WHERE wiki_id=${root.wikiId}`;
      const listed = await browser(() => wiki.list(actor));
      assert.ok(
        listed.items
          .find((item) => item.wikiId === ata4.wikiId)
          .waiting.some((item) => item.subjectId === 'FAMILY-bulk-200'),
      );
      const [count] =
        await admin`SELECT count(*)::int AS n FROM hierarchical_wiki_membership WHERE source_id LIKE 'FAMILY-bulk-%'`;
      assert.equal(count.n, 201);
    },
  );
}
