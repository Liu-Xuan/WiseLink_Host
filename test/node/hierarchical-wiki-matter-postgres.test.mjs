import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import postgres from 'postgres';
import { prepareDerivedSummaryDdl } from '../../scripts/prepare-derived-summary-ddl.mjs';
import { prepareHierarchicalWikiDdl } from '../../scripts/prepare-hierarchical-wiki-ddl.mjs';
import { loadEngineeringFixture } from './helpers/load-engineering-fixture.mjs';

const databaseUrl = process.env.HIERARCHICAL_WIKI_TEST_DATABASE_URL;
test(
  'real Matter SOURCE_CHANGE prerequisites and Wiki saved propagation keep separate analysis consent',
  { skip: !databaseUrl, timeout: 120000 },
  async (t) => {
    const url = new URL(databaseUrl);
    assert.equal(url.hostname, '127.0.0.1');
    assert.match(url.pathname, /^\/derived_summary_test_[a-z0-9_]+$/u);
    assert.equal(
      url.pathname.slice(1),
      process.env.HIERARCHICAL_WIKI_OWNED_TEST_DATABASE_NAME,
    );
    const fixture = await loadEngineeringFixture(t, databaseUrl);
    const require = createRequire(import.meta.url);
    const { sql } = require('drizzle-orm');
    const {
      SqlExecutionContextMiddleware,
    } = require('@lark-apaas/fullstack-nestjs-core');
    const {
      EngineeringMatterWorkingRepository,
    } = require('../../server/modules/canonical-host/engineering-matter-working.repository.ts');
    const {
      EngineeringSearchProjectionWriter,
    } = require('../../server/modules/canonical-host/engineering-search-projection.ts');
    const {
      MatterActionAttemptService,
    } = require('../../server/modules/canonical-host/matter-action-attempt.service.ts');
    const {
      CanonicalModelSettingsService,
    } = require('../../server/modules/model-settings/canonical-model-settings.service.ts');
    const {
      CanonicalModelSettingsRepository,
    } = require('../../server/modules/model-settings/canonical-model-settings.repository.ts');
    const {
      sealMatterResultEnvelope,
    } = require('../../server/modules/action-attempt/action-attempt-envelope.ts');
    const {
      ActionAttemptRepository,
    } = require('../../server/modules/action-attempt/action-attempt.repository.ts');
    const {
      DerivedSummaryMembersService,
    } = require('../../server/modules/canonical-host/derived-summary-members.service.ts');
    const {
      DerivedSummaryRepository,
    } = require('../../server/modules/canonical-host/derived-summary.repository.ts');
    const {
      DerivedSummaryService,
    } = require('../../server/modules/canonical-host/derived-summary.service.ts');
    const {
      DerivedSummaryRuntimeService,
    } = require('../../server/modules/canonical-host/derived-summary-runtime.service.ts');
    const {
      HierarchicalWikiService,
    } = require('../../server/modules/canonical-host/hierarchical-wiki.service.ts');
    const { fixedModelSettings } = require('../support/fixed-model-settings.ts');
    const {
      HierarchicalWikiChanges,
    } = require('../../server/modules/canonical-host/hierarchical-wiki-changes.ts');
    const {
      HierarchicalWikiCompletion,
    } = require('../../server/modules/canonical-host/hierarchical-wiki-completion.ts');
    const admin = postgres(databaseUrl, { max: 1, onnotice() {} });
    t.after(() => admin.end({ timeout: 5 }));
    await fixture.resetDatabase(admin);
    const synthetic = (prefix, workItemId, sha) => ({
      workItemId,
      documentId: `WIKI-DOC-${prefix}`,
      documentVersionId: `WIKI-DV-${prefix}`,
      sourceArtifactId: `WIKI-SRC-${prefix}`,
      sourceFileSha256: sha.repeat(64),
      sourceByteLength: 100,
      packageId: `WIKI-PACKAGE-${prefix}`,
      sourceRefCount: 1,
    });
    await fixture.seedRealDocumentWorkItems(admin, {
      ftd: synthetic('A', fixture.FTD_WORK_ITEM_ID, 'a'),
      sb: synthetic('B', fixture.SB_WORK_ITEM_ID, 'b'),
    });
    const [initialWorkItems] =
      await admin`SELECT count(*)::int AS n FROM work_item`;
    await admin`UPDATE dm_publication_family SET canonical_identity_key='tenant:tenant-A:family:'||canonical_identity_key`;
    await admin.unsafe(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon_public') THEN CREATE ROLE anon_public NOLOGIN IN ROLE anon; END IF; END $$;
      GRANT USAGE ON SCHEMA public TO anon;`);
    await admin.unsafe(
      'ALTER POLICY action_attempt_matter_subject_boundary ON action_attempt TO authenticated_public,service_role_public',
    );
    const template = await readFile(
      'server/database/derived-summary.ddl.sql',
      'utf8',
    );
    const [snapshot] =
      await admin`SELECT json_build_object('schema',current_schema(),
      'constraints',(SELECT json_agg(json_build_object('name',conname,'table','action_attempt','definition',pg_get_constraintdef(oid))) FROM pg_constraint WHERE conrelid='action_attempt'::regclass),
      'policies',(SELECT json_agg(json_build_object('name',polname,'table','action_attempt','using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid),
        'command',polcmd,'restrictive',NOT polpermissive,'roles',(SELECT json_agg(pg_get_userbyid(role_oid)) FROM unnest(polroles) AS role_oid))) FROM pg_policy WHERE polrelid='action_attempt'::regclass))::text AS schema_probe`;
    const official = { ok: true, data: [snapshot] };
    const derived = prepareDerivedSummaryDdl({
      template,
      devSnapshot: official,
      onlineSnapshot: official,
    }).replace(
      /(\$[a-z_]*\$)[\s\S]*?\1|CREATE POLICY[^;]+;/giu,
      (statement, quoted) =>
        quoted
          ? statement
          : statement.replace(
              /\bTO (authenticated|service_role|anon)\b/gu,
              (_, role) => `TO ${role}_public`,
            ),
    );
    await admin.unsafe(derived);
    await admin.unsafe(
      await readFile('migrations/0060_document_reading_run.sql', 'utf8'),
    );
    await admin.unsafe(
      await readFile('migrations/0061_document_reading_retraction.sql', 'utf8'),
    );
    await admin.unsafe(
      prepareHierarchicalWikiDdl({
        template: await readFile(
          'migrations/0077_hierarchical_wiki.sql',
          'utf8',
        ),
        devSnapshot: official,
        onlineSnapshot: official,
      }),
    );
    await admin.unsafe(`GRANT ALL ON hierarchical_wiki_scope,hierarchical_wiki_membership,hierarchical_wiki_change TO authenticated,service_role;
      CREATE TABLE dm_document_version_metadata(document_version_id varchar,metadata_revision integer,extracted_metadata jsonb);
      GRANT SELECT ON dm_document_version_metadata TO authenticated,service_role;
      GRANT USAGE ON SEQUENCE hierarchical_wiki_change_seq_seq TO authenticated,service_role;
      GRANT SELECT,INSERT,UPDATE ON derived_summary,derived_summary_revision TO authenticated,service_role;
      GRANT SELECT ON dm_document_reading_run,dm_document_reading_retraction TO authenticated,service_role;
      GRANT UPDATE ON dm_document_version TO authenticated,service_role;`);
    // Keep the older fixture aligned with the current browser read predicates;
    // Hosted Matter admission still uses the actual owner/delegation RLS.
    const nativeRead = await readFile('migrations/0078_native_tenant_shared_read.sql', 'utf8');
    for (const name of ['native_app_shared_read_allowed', 'native_app_work_item_readable',
      'native_app_document_readable', 'native_app_matter_revision_readable']) {
      const definition = nativeRead.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\$\\$;`, 'u'))?.[0];
      assert.ok(definition);
      await admin.unsafe(definition.replaceAll('workspace_aadkpkjef3slu', 'public').replaceAll("'63849986'", "'tenant-A'"));
    }
    const owner = await fixture.reserveActorService('actor-A');
    t.after(() => owner.release());
    const scope = {
      tenantId: 'tenant-A',
      principalId: 'wiki-matter-service',
      appId: 'app_17bzc551rsg',
      authorizationFingerprint: 'synthetic-configured',
    };
    const context = new SqlExecutionContextMiddleware({ roleSchema: 'public' });
    const run = (hosted, operation) =>
      new Promise((resolve, reject) =>
        context.use(
          {
            userContext: {
              userId: hosted ? '-1' : 'actor-A',
              isSystemAccount: hosted,
              roles: [],
            },
          },
          {},
          () => Promise.resolve().then(operation).then(resolve, reject),
        ),
      );
    const browser = (operation) => run(false, operation),
      hosted = (operation) => run(true, operation);
    const changes = new HierarchicalWikiChanges(owner.database);
    const working = new EngineeringMatterWorkingRepository(
      owner.database,
      context,
      { roleSchema: 'public' },
      new EngineeringSearchProjectionWriter(owner.database),
      changes,
    );
    const writer = new MatterActionAttemptService(
      working,
      new CanonicalModelSettingsService(
        new CanonicalModelSettingsRepository(owner.database),
      ),
    );
    const members = new DerivedSummaryMembersService({}, working),
      repository = new DerivedSummaryRepository(
        owner.database,
        working,
        members,
      );
    const models = fixedModelSettings('miaoda/glm-5.3');
    const completion = new HierarchicalWikiCompletion(),
      authorization = { authorizeOpenClawAutoWorkItemQueue: async () => scope };
    const summaries = new DerivedSummaryService(
        repository,
        members,
        authorization,
        completion,
        models,
      ),
      runtime = new DerivedSummaryRuntimeService(
        repository,
        members,
        summaries,
        completion,
      );
    const wiki = new HierarchicalWikiService(
      owner.database,
      repository,
      summaries,
      members,
      working,
      {
        readLibraryCatalog: async () => ({
          status: 'AVAILABLE',
          families: [{ fleetFamily: 'B787', models: ['B787-9'] }],
        }),
      },
      authorization,
      writer,
      models,
    );
    const created = await owner.service.create(
      {
        requestId: 'wiki-matter-create',
        title: 'Synthetic Wiki source prerequisite',
        primaryWorkItemId: fixture.FTD_WORK_ITEM_ID,
      },
      owner.actor,
    );
    const matterId = created.matter.matterId;
    const directory = await browser(() =>
      wiki.enable(
        {
          fleetFamilyId: 'B787',
          fleetModelId: 'B787-9',
          modelRef: 'miaoda/glm-5.3',
        },
        owner.actor,
      ),
    );
    const root = directory.items.find((item) => item.scope.kind === 'FLEET');
    const classified = await browser(() =>
      wiki.classify(
        root.summaryId,
        {
          sourceKind: 'MATTER',
          sourceId: matterId,
          ata: '46-00',
          included: true,
        },
        owner.actor,
      ),
    );
    const ata4 = classified.items.find((item) => item.scope.kind === 'ATA4');
    await t.test(
      'no work or attempt still waits on actual currentInputs; classification creates zero engineering attempts',
      async () => {
        assert.ok(
          classified.items
            .find((item) => item.scope.kind === 'ATA4')
            .waiting.some(
              (item) =>
                item.status === 'NOT_ADMITTED' && item.subjectId === matterId,
            ),
        );
        assert.equal((await hosted(() => wiki.next())).status, 'IDLE');
        const [count] =
          await admin`SELECT count(*)::int AS n FROM action_attempt WHERE matter_id=${matterId}`;
        assert.equal(count.n, 0);
        await assert.rejects(
          hosted(() => wiki.authorizeMatter({ matterId })),
          /WIKI_MATTER_DELEGATION_UNAVAILABLE/,
        );
      },
    );
    let next;
    let saved;
    await t.test(
      'explicit engineering consent admits the existing SOURCE_CHANGE key and resumes that exact Matter',
      async () => {
        const receipt = await browser(() =>
          wiki.delegateMatter(
            root.summaryId,
            { matterId, enabled: true },
            owner.actor,
          ),
        );
        assert.equal(receipt.enabled, true);
        next = await hosted(() => wiki.next());
        assert.equal(next.status, 'MATTER_PENDING');
        assert.equal(next.matterId, matterId);
        const repeated = await hosted(() => wiki.next());
        assert.equal(repeated.attemptRef, next.attemptRef);
        const [row] =
          await admin`SELECT idempotency_key,task_envelope_json FROM action_attempt WHERE operation_ref=${next.attemptRef}`;
        assert.match(row.idempotency_key, /^matter-auto:/);
        assert.equal(
          JSON.parse(row.task_envelope_json).trigger.kind,
          'SOURCE_CHANGE',
        );
        assert.equal(
          (
            await hosted(() =>
              wiki.authorizeMatter({
                matterId,
                attemptRef: next.attemptRef,
                operation: 'CLAIM',
              }),
            )
          ).actorUserId,
          'actor-A',
        );
        await assert.rejects(
          hosted(() =>
            wiki.authorizeMatter({
              matterId,
              attemptRef: 'AQ-foreign',
              operation: 'CLAIM',
            }),
          ),
          /DELEGATION_UNAVAILABLE/,
        );
        const target = {
          tenantId: scope.tenantId,
          actorUserId: 'actor-A',
          principalId: scope.principalId,
          matterId,
          attemptRef: next.attemptRef,
        };
        const lease = await hosted(() => writer.claim(target));
        const fence = {
          ...target,
          leaseToken: lease.leaseToken,
          leaseGeneration: lease.leaseGeneration,
        };
        const task = lease.task,
          documentVersionId = task.workingBasis.inputs[0].documentVersionId;
        const rootRef = `DOCUMENT_VERSION:${documentVersionId}:page:1`;
        const evidence = {
          kind: 'DOCUMENT_PASSAGE',
          evidenceRef: rootRef,
          sourceRefId: rootRef,
          documentVersionId,
          workItemId: null,
          title: 'Synthetic owned original',
          versionLabel: null,
          locator: 'Page 1',
          excerpt: 'Unknown conditions require rechecking.',
        };
        await hosted(() =>
          writer.readSourcePages(
            {
              ...fence,
              documentVersionId,
              pageStart: 1,
              purpose: 'Read constructed original',
            },
            async () => ({
              documentVersionId,
              sourceSha256: 'a'.repeat(64),
              sourceByteLength: 100,
              pageCount: 1,
              extractionScope: 'NATIVE_TEXT_LAYER',
              pages: [
                {
                  page: 1,
                  sourceRefId: rootRef,
                  text: evidence.excerpt,
                  textLayerStatus: 'PRESENT',
                  visualContentVerified: false,
                  evidence,
                },
              ],
            }),
          ),
        );
        const method = task.modelInput.sourceCatalog.find(
          (item) => item.kind === 'METHOD_CLAUSE',
        );
        assert.ok(method);
        await hosted(() =>
          writer.readRegisteredSources({
            ...fence,
            sourceRefs: [method.evidenceRef],
            purpose: 'Read exact method',
          }),
        );
        const proposal = {
          schemaVersion: 'wiselink.jobaid-problem-work.v3',
          overview: 'Constructed initial context',
          headline: 'Conditional candidate',
          listBrief: 'Unknown conditions retained',
          roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
          completionReason: 'Constructed only',
          changeSummary: 'Synthetic',
          issues: [
            {
              issueKey: 'dependency',
              question: 'Which condition applies?',
              body: `Unknown conditions require rechecking. [[${rootRef}]]`,
              requirementHandling: [
                {
                  methodRef: method.evidenceRef,
                  requirement: 'Check the condition',
                  conditions: [],
                  treatment: 'CONDITIONS_UNCONFIRMED',
                  basisRefs: [rootRef],
                  explanation: 'Unknown retained.',
                },
              ],
              openQuestions: [
                {
                  question: 'Which condition applies?',
                  affects: 'Unknown applicability',
                  nextEvidence: 'Constructed configuration',
                  reason: 'Unknown.',
                },
              ],
            },
          ],
        };
        saved = await hosted(() =>
          writer.saveJobAidWork({
            ...fence,
            requestId: 'wiki-real-matter-save',
            expectedWorkRevision: 0,
            workJson: JSON.stringify(proposal),
          }),
        );
        const { contentHash: _hash, ...result } = fixture.matterResult(task);
        result.modelOutput = JSON.stringify({
          workRevisionRef: saved.workRevisionRef,
        });
        await hosted(() =>
          writer.finishJobAid({
            ...fence,
            result: sealMatterResultEnvelope(result),
          }),
        );
        const [event] =
          await admin`SELECT kind,subject_id,version_ref FROM hierarchical_wiki_change WHERE version_ref=${saved.workRevisionRef}`;
        assert.deepEqual(event, {
          kind: 'MATTER',
          subject_id: matterId,
          version_ref: saved.workRevisionRef,
        });
      },
    );
    await t.test(
      'real saved Matter releases waiting, produces ATA4 then ATA2 then model without fake WorkItems',
      async () => {
        await browser(() => wiki.list(owner.actor));
        let childRef;
        for (const [index, kind] of ['ATA4', 'ATA2', 'FLEET'].entries()) {
          const queued = await hosted(() =>
            wiki.next(
              new Date(Date.now() + (index + 1) * 60 * 60_000).toISOString(),
            ),
          );
          assert.equal(queued.status, 'SUMMARY_PENDING');
          const target = {
            summaryId: queued.summaryId,
            attemptRef: queued.attemptRef,
            scope,
          };
          const claim = await hosted(() => runtime.claim(target));
          assert.equal(claim.task.modelInput.scope.kind, kind);
          if (kind === 'ATA4') {
            assert.equal(
              claim.task.modelInput.members[0].member.kind,
              'MATTER_WORK',
            );
            assert.equal(
              claim.task.modelInput.members[0].member.workRef,
              saved.workRevisionRef,
            );
          } else
            assert.equal(
              claim.task.modelInput.members[0].member.summaryRef,
              childRef,
            );
          const fence = {
              leaseToken: claim.leaseToken,
              leaseGeneration: claim.leaseGeneration,
            },
            refs = claim.task.modelInput.members.map(
              (item) => item.evidenceRef,
            );
          await hosted(() =>
            runtime.readMemberWork({
              ...target,
              ...fence,
              evidenceRefs: refs,
              purpose: 'Constructed saved members',
            }),
          );
          const sourceRefs = claim.task.modelInput.evidence.map(item => item.evidenceRef);
          await hosted(() => runtime.readSources({ ...target, ...fence,
            evidenceRefs: sourceRefs, purpose: 'Constructed exact Matter sources' }));
          const value = await hosted(() =>
            runtime.save({
              ...target,
              ...fence,
              requestId: claim.task.requestId,
              expectedSummaryRevision: claim.task.expectedSummaryRevision,
              contentJson: JSON.stringify({
                headline: 'Constructed comprehensive Wiki',
                listBrief: 'Exact source coverage',
                body: `## 事项: ${matterId}\n${[...refs, ...sourceRefs].map((ref) => `[[${ref}]]`).join(' ')}`,
                limitations: ['Synthetic; no live model.'],
              }),
            }),
          );
          await hosted(() =>
            runtime.finish({
              ...target,
              ...fence,
              requestId: claim.task.requestId,
            }),
          );
          childRef = value.summaryRef;
        }
        const [count] = await admin`SELECT count(*)::int AS n FROM work_item`;
        assert.equal(count.n, initialWorkItems.n);
        assert.equal(
          (
            await hosted(() =>
              wiki.next(new Date(Date.now() + 4 * 60 * 60_000).toISOString()),
            )
          ).status,
          'IDLE',
        );
      },
    );
    await t.test(
      'a saved due condition wakes an explicitly delegated fully covered Matter through Wiki polling',
      async () => {
        const target = { tenantId: scope.tenantId, actorUserId: 'actor-A', matterId };
        const saveCondition = async (at, requestId) => {
          const basis = await hosted(() => working.withActorTransaction('actor-A', async (executor) => ({
            current: await executor.loadCurrent(target),
            inputs: (await executor.authorizeRuntimeInputs(target)).currentInputs,
          })));
          return browser(() => working.commit({ ...target, source: null, currentInputs: basis.inputs, command: {
            requestId, expectedWorkingRevision: basis.current.workingRevision,
            basedOnMatterRevisionId: basis.current.basedOnMatterRevisionId,
            updateKind: 'CORRECTION', changeSummary: 'Save an explicit synthetic revisit time.',
            nextFocus: null, claimDelta: null, openQuestionDelta: null,
            reviewConditionDelta: { upserts: [{ itemId: 'wiki-explicit-due', text: 'Recheck the unresolved condition.',
              basisRefs: [], when: { kind: 'DUE_AT', at } }], retirements: [], explicitlyUnchangedItemIds: [] },
            nextSubstantiveResult: null, substantiveInputs: [], coverageUpdates: [],
          } }));
        };
        const attemptCount = async () => (await admin`SELECT count(*)::int AS n FROM action_attempt WHERE matter_id=${matterId}`)[0].n;
        const before = await attemptCount();
        await saveCondition('2099-01-01T00:00:00Z', 'wiki-future-condition');
        assert.equal((await hosted(() => wiki.next())).status, 'IDLE');
        assert.equal(await attemptCount(), before, 'future conditions do not admit engineering work');

        const dueWork = await saveCondition('2000-01-01T00:00:00Z', 'wiki-due-condition');
        const list = await browser(() => wiki.list(owner.actor));
        assert.equal(list.items.some(item => item.waiting.some(waiting => waiting.subjectId === matterId)), false,
          'all current Matter inputs are already covered: the due condition alone must wake it');

        await browser(() => wiki.delegateMatter(root.summaryId, { matterId, enabled: false }, owner.actor));
        assert.notEqual((await hosted(() => wiki.next())).status, 'MATTER_PENDING');
        assert.equal(await attemptCount(), before, 'a disabled delegation does not admit a due condition');
        await browser(() => wiki.delegateMatter(root.summaryId, { matterId, enabled: true }, owner.actor));

        await browser(() => wiki.classify(root.summaryId,
          { sourceKind: 'MATTER', sourceId: matterId, ata: '46-00', included: false }, owner.actor));
        assert.notEqual((await hosted(() => wiki.next())).status, 'MATTER_PENDING');
        await assert.rejects(hosted(() => wiki.authorizeMatter({ matterId })), /WIKI_MATTER_DELEGATION_UNAVAILABLE/u);
        assert.equal(await attemptCount(), before, 'a non-CONFIRMED membership does not admit a due condition');
        await browser(() => wiki.classify(root.summaryId,
          { sourceKind: 'MATTER', sourceId: matterId, ata: '46-00', included: true }, owner.actor));

        await admin`UPDATE identity_subject_mapping SET status='REVOKED' WHERE miaoda_user_id='actor-A'`;
        assert.equal((await hosted(() => wiki.next())).status, 'IDLE');
        await assert.rejects(hosted(() => wiki.authorizeMatter({ matterId })), /WIKI_MATTER_DELEGATION_UNAVAILABLE/u);
        assert.equal(await attemptCount(), before, 'an inactive mapped owner does not admit a due condition');
        await admin`UPDATE identity_subject_mapping SET status='ACTIVE' WHERE miaoda_user_id='actor-A'`;

        const due = await hosted(() => wiki.next());
        assert.equal(due.status, 'MATTER_PENDING');
        assert.equal(due.matterId, matterId);
        const [attempt] = await admin`SELECT idempotency_key,task_envelope_json FROM action_attempt WHERE operation_ref=${due.attemptRef}`;
        assert.match(attempt.idempotency_key, /^matter-revisit:/u);
        assert.deepEqual(JSON.parse(attempt.task_envelope_json).trigger, {
          kind: 'REVISIT', workRef: dueWork.revision.matterWorkRevisionId, conditionIds: ['wiki-explicit-due'],
        });
        assert.equal((await hosted(() => wiki.next())).attemptRef, due.attemptRef);
        assert.equal(await attemptCount(), before + 1, 'repeated polling reuses the original persisted occurrence');
        await hosted(() => writer.cancel({ ...target, principalId: scope.principalId, attemptRef: due.attemptRef,
          reason: 'Constructed due condition and duplicate polling verified.' }));
        assert.notEqual((await hosted(() => wiki.next())).status, 'MATTER_PENDING');
        assert.equal(await attemptCount(), before + 1, 'the same overdue condition does not rearm a terminal attempt');
      },
    );
    await t.test(
      'new real WorkItem input makes the same Matter pending; removal survives inheritance and revoked-source cleanup remains private',
      async () => {
        await admin`UPDATE work_item SET revision=revision+1 WHERE work_item_id=${fixture.FTD_WORK_ITEM_ID}`;
        await hosted(() =>
          working.withActorScope('actor-A', () =>
            changes.record({
              tenantId: scope.tenantId,
              actorUserId: 'actor-A',
              kind: 'WORK_ITEM',
              subjectId: fixture.FTD_WORK_ITEM_ID,
              versionRef: 'synthetic-input-r2',
            }),
          ),
        );
        const fresh = await hosted(() => wiki.next());
        assert.equal(fresh.status, 'MATTER_PENDING');
        assert.notEqual(fresh.attemptRef, next.attemptRef);
        await browser(() =>
          wiki.classify(
            root.summaryId,
            {
              sourceKind: 'MATTER',
              sourceId: matterId,
              ata: '46-00',
              included: false,
            },
            owner.actor,
          ),
        );
        const list = await browser(() => wiki.list(owner.actor));
        assert.equal(
          list.classifications.find((item) => item.sourceId === matterId)
            .status,
          'EXCLUDED',
        );
        await assert.rejects(
          hosted(() =>
            wiki.authorizeMatter({
              matterId,
              attemptRef: fresh.attemptRef,
              operation: 'CLAIM',
            }),
          ),
          /DELEGATION_UNAVAILABLE/,
        );
        await admin`UPDATE work_item SET requested_by_user_id='actor-B' WHERE work_item_id=${fixture.FTD_WORK_ITEM_ID}`;
        const disabled = await browser(() =>
          wiki.delegateMatter(
            root.summaryId,
            { matterId, enabled: false },
            owner.actor,
          ),
        );
        assert.equal(disabled.enabled, false);
        const receipt = await hosted(() =>
          wiki.cleanup({
            kind: 'MATTER',
            subjectId: matterId,
            attemptRef: fresh.attemptRef,
            operation: 'CANCEL',
          }),
        );
        assert.equal(receipt.status, 'CANCELLED');
        assert.equal(Object.hasOwn(receipt, 'task'), false);
        await assert.rejects(
          hosted(() =>
            wiki.authorizeMatter({
              matterId,
              attemptRef: fresh.attemptRef,
              operation: 'READ_SAVED_WORK',
            }),
          ).then((auth) =>
            hosted(() =>
              writer.readSavedWork({
                ...auth,
                requestId: 'wiki-real-matter-save',
              }),
            ),
          ),
          /AUTHORIZATION|UNAVAILABLE|Failed query/,
        );
      },
    );
    await t.test(
      'metadata cancellation preserves the real native COMMITTING cutoff and recoverable lease/result after revocation',
      async () => {
        await admin`UPDATE work_item SET requested_by_user_id='actor-A',revision=revision+1 WHERE work_item_id=${fixture.FTD_WORK_ITEM_ID}`;
        await browser(() =>
          wiki.classify(
            root.summaryId,
            {
              sourceKind: 'MATTER',
              sourceId: matterId,
              ata: '46-00',
              included: true,
            },
            owner.actor,
          ),
        );
        await browser(() =>
          wiki.delegateMatter(
            root.summaryId,
            { matterId, enabled: true },
            owner.actor,
          ),
        );
        const fresh = await hosted(() => wiki.next());
        assert.equal(fresh.status, 'MATTER_PENDING');
        const target = {
          tenantId: scope.tenantId,
          actorUserId: 'actor-A',
          principalId: scope.principalId,
          matterId,
          attemptRef: fresh.attemptRef,
        };
        const lease = await hosted(() => writer.claim(target));
        const [attempt] =
          await admin`SELECT attempt_id FROM action_attempt WHERE operation_ref=${fresh.attemptRef}`;
        const marked = await hosted(() =>
          working.withActorTransaction('actor-A', ({ database }) =>
            new ActionAttemptRepository(database).markCommitting({
              attemptId: attempt.attempt_id,
              leaseToken: lease.leaseToken,
              leaseGeneration: lease.leaseGeneration,
              result: fixture.matterResult(lease.task),
              now: new Date(),
              recoveryLeaseMs: 60000,
            }),
          ),
        );
        assert.equal(marked.status, 'COMMITTING');
        const [before] =
          await admin`SELECT status,lease_token,lease_generation,lease_expires_at,commit_started_at,result_envelope_json,projection_applied
        FROM action_attempt WHERE operation_ref=${fresh.attemptRef}`;
        await admin`UPDATE work_item SET requested_by_user_id='actor-B' WHERE work_item_id=${fixture.FTD_WORK_ITEM_ID}`;
        const receipt = await hosted(() =>
          wiki.cleanup({
            kind: 'MATTER',
            subjectId: matterId,
            attemptRef: fresh.attemptRef,
            operation: 'CANCEL',
          }),
        );
        assert.equal(receipt.status, 'COMMITTING');
        assert.equal(receipt.cancelResult, 'TOO_LATE');
        assert.equal(Object.hasOwn(receipt, 'task'), false);
        const [after] =
          await admin`SELECT status,lease_token,lease_generation,lease_expires_at,commit_started_at,result_envelope_json,projection_applied
        FROM action_attempt WHERE operation_ref=${fresh.attemptRef}`;
        assert.deepEqual(after, before);
      },
    );
  },
);
