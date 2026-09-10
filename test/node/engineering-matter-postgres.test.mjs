import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

import postgres from 'postgres';

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql: drizzleSql } = require('drizzle-orm');
const {
  SqlExecutionContextMiddleware,
} = require('@lark-apaas/fullstack-nestjs-core');
const {
  EngineeringMatterRepository,
} = require('../../server/modules/canonical-host/engineering-matter.repository.ts');
const {
  EngineeringMatterService,
} = require('../../server/modules/canonical-host/engineering-matter.service.ts');
const {
  EngineeringMatterWorkingRepository,
} = require('../../server/modules/canonical-host/engineering-matter-working.repository.ts');
const {
  EngineeringMatterWorkingService,
} = require('../../server/modules/canonical-host/engineering-matter-working.service.ts');
const {
  MiaodaDocumentVersionSourceResolver,
} = require('../../server/modules/work-item/miaoda-document-version-source.resolver.ts');
const {
  MiaodaHostedCanonicalObjectAccessAdapter,
} = require('../../server/modules/work-item/miaoda-hosted-canonical-object-access.adapter.ts');
const {
  MiaodaWorkItemRepository,
} = require('../../server/modules/work-item/miaoda-work-item.repository.ts');

const {
  materializeJobAidWork,
} = require('../../server/modules/canonical-host/jobaid-problem-work.ts');

const {
  materializeEngineeringMatterWorkingState,
} = require('../../server/modules/canonical-host/engineering-matter-working-state.ts');

const {
  MatterActionAttemptService,
} = require('../../server/modules/canonical-host/matter-action-attempt.service.ts');
const {
  CANONICAL_INITIAL_MODEL_REF,
  taskModelSelection,
} = require('../../server/modules/model-settings/canonical-model-catalog.ts');
const {
  sealMatterResultEnvelope,
} = require('../../server/modules/action-attempt/action-attempt-envelope.ts');
const databaseUrl = process.env.ENGINEERING_MATTER_TEST_DATABASE_URL;
const FTD_WORK_ITEM_ID = 'WI-DM-FTD-FD88DCB9CF64CF3B';
const SB_WORK_ITEM_ID = 'WI-LOCAL-737-34-3830-ASSESSMENT';
const REQUEST_REUSE_WORK_ITEM_ID = 'WI-DM-FTD-FD88DCB9CF64CF3B-RERUN';

test(
  'v5 direct family materials preserve scope, expectations, replay and full-source authorization',
  { skip: !databaseUrl, concurrency: false },
  async () => {
    assertSafeIsolatedDatabase(databaseUrl);
    const sql = postgres(databaseUrl, { max: 8, onnotice() {} });
    const connections = [];
    try {
      const fixtures = await loadRealDocumentFixtures();
      await resetDatabase(sql);
      await seedRealDocumentWorkItems(sql, fixtures);
      // The new path must authorize an acquired document even with no owned WI.
      await sql`UPDATE work_item SET requested_by_user_id = 'actor-B' WHERE document_version_id = ${fixtures.ftd.documentVersionId}`;
      await sql`UPDATE dm_publication_family SET canonical_identity_key = 'tenant:tenant-A:family:direct-ftd'
        WHERE family_id = 'family_real_ftd_31_21002'`;
      await sql`UPDATE dm_acquisition SET idempotency_key = 'tenant:tenant-A:request:direct-ftd', status = 'COMMITTED_CANONICAL'
        WHERE document_version_id = ${fixtures.ftd.documentVersionId}`;
      assert.equal(
        (
          await sql`SELECT engineering_matter_uri_component('租户 A/!') AS encoded`
        )[0].encoded,
        encodeURIComponent('租户 A/!'),
      );
      const owner = await reserveActorService('actor-A');
      const second = await reserveActorService('actor-A');
      const outsider = await reserveActorService('actor-B');
      connections.push(owner, second, outsider);
      const before = (await sql`SELECT count(*) AS n FROM work_item`)[0].n;
      const binding = {
        tenantId: 'tenant-A',
        actorUserId: 'actor-A',
        documentVersionId: fixtures.ftd.documentVersionId,
      };
      const results = await Promise.all([
        owner.runtime(() =>
          owner.working.withActorTransaction('actor-A', ({ database }) =>
            owner.matters.ensureFamilyMatter(binding, database),
          ),
        ),
        second.matters.ensureFamilyMatter(binding),
      ]);
      assert.equal(results.filter((x) => x.created).length, 1);
      assert.equal(results[0].matterId, results[1].matterId);
      const scope = { tenantId: 'tenant-A', matterId: results[0].matterId };
      const original = await owner.matters.readMaterials(scope);
      assert.equal(original.materials[0].kind, 'MEMBER');
      assert.equal(
        original.materials[0].documentVersionId,
        fixtures.ftd.documentVersionId,
      );
      assert.equal((await owner.matters.loadCurrent(scope)).links.length, 0);
      const pending = await owner.workingService.readWorking(
        scope.matterId,
        owner.actor,
      );
      assert.equal(pending.pendingInputs.length, 1);
      assert.equal(pending.pendingInputs[0].current.kind, 'DOCUMENT_VERSION');
      assert.equal(pending.pendingInputs[0].current.workItemId, null);
      assert.equal(
        (await sql`SELECT count(*) AS n FROM work_item`)[0].n,
        before,
      );
      const independent = await owner.matters.ensureFamilyMatter({
        ...binding,
        documentVersionId: fixtures.sb.documentVersionId,
      });
      assert.notEqual(
        independent.matterId,
        scope.matterId,
        'different families do not merge by classifier or similarity',
      );
      const expected = {
        materialId: 'expected-followup',
        kind: 'EXPECTED',
        familyId: null,
        documentVersionId: null,
        scope: '构造测试：后续冷启动措施',
        contribution: '核对措施范围',
        basis: [
          {
            documentVersionId: fixtures.ftd.documentVersionId,
            sourceRefId: 'synthetic-scope-source',
          },
        ],
        origin: 'ENGINEER',
        disposition: 'INCLUDED',
        expected: {
          issuer: 'OEM',
          documentNumber: null,
          description: '后续工程资料，未提供文号',
          expectedContribution: '核对是否覆盖持续告警',
          expectedDate: null,
          sourceAsOf: '2026-09-11',
          publicationStatus: 'PLANNED',
          acquisitionStatus: 'NOT_ACQUIRED',
          fulfilledBy: [],
        },
      };
      const command = {
        requestId: 'expected-1',
        expectedMatterRevision: 1,
        changeSummary: '构造预期资料协议，不代表真实文件内容。',
        upserts: [expected],
      };
      const revision = await owner.matters.reviseMaterials({
        ...scope,
        actorUserId: 'actor-A',
        command,
      });
      assert.equal(revision.materials.matterRevision, 2);
      assert.equal(revision.materials.materials.length, 2);
      const fulfilled = {
        ...expected,
        expected: {
          ...expected.expected,
          acquisitionStatus: 'PARTIALLY_ACQUIRED',
          fulfilledBy: [
            {
              familyId: 'family_58068371edd11c2b3c8aecf0',
              documentVersionId: fixtures.sb.documentVersionId,
              scope: '仅所核对范围',
            },
          ],
        },
      };
      await owner.matters.reviseMaterials({
        ...scope,
        actorUserId: 'actor-A',
        command: {
          requestId: 'expected-2',
          expectedMatterRevision: 2,
          changeSummary: '构造部分匹配。',
          upserts: [fulfilled],
        },
      });
      const replay = await owner.matters.reviseMaterials({
        ...scope,
        actorUserId: 'actor-A',
        command,
      });
      assert.equal(replay.replayed, true);
      assert.deepEqual(
        replay.materials,
        revision.materials,
        'response-loss recovery returns the same historical composition',
      );
      await assert.rejects(
        owner.matters.reviseMaterials({
          ...scope,
          actorUserId: 'actor-A',
          command: {
            ...command,
            changeSummary: 'changed replay',
          },
        }),
        /reused with new input/u,
      );
      await assert.rejects(
        outsider.matters.readMaterials(scope),
        /not available/u,
      );
      // A manually organized MEMBER remains authoritative without a default marker.
      await sql`UPDATE engineering_matter SET default_family_id = NULL WHERE matter_id = ${scope.matterId}`;
      const reusedExplicit = await owner.matters.ensureFamilyMatter(binding);
      assert.equal(reusedExplicit.matterId, scope.matterId);
      assert.equal(reusedExplicit.created, false);
      const relatedScope = {
        tenantId: 'tenant-A',
        matterId: independent.matterId,
      };
      await owner.matters.reviseMaterials({
        ...relatedScope,
        actorUserId: 'actor-A',
        command: {
          requestId: 'related-family',
          expectedMatterRevision: 1,
          changeSummary: '构造跨事项相关材料，保留其范围。',
          upserts: [
            {
              ...original.materials[0],
              materialId: 'related-ftd',
              kind: 'RELATED',
              origin: 'ENGINEER',
              scope: '限定相关范围',
            },
          ],
        },
      });
      const newerVersionId = 'document_version_constructed_r2';
      await sql`INSERT INTO dm_document_version
        SELECT (jsonb_populate_record(NULL::dm_document_version, to_jsonb(v) || jsonb_build_object(
          'id', gen_random_uuid(), 'document_version_id', ${newerVersionId}::text,
          'revision_id', 'constructed-r2', 'canonical_revision_identity', 'CONSTRUCTED:R2',
          'business_revision', 'CONSTRUCTED R2', 'acquisition_id', 'acquisition_constructed_r2'))).*
        FROM dm_document_version v WHERE v.document_version_id = ${fixtures.ftd.documentVersionId}`;
      await sql`INSERT INTO dm_acquisition
        SELECT (jsonb_populate_record(NULL::dm_acquisition, to_jsonb(a) || jsonb_build_object(
          'id', gen_random_uuid(), 'acquisition_id', 'acquisition_constructed_r2',
          'document_version_id', ${newerVersionId}::text, 'idempotency_key', 'tenant:tenant-A:request:constructed-r2'))).*
        FROM dm_acquisition a WHERE a.document_version_id = ${fixtures.ftd.documentVersionId}`;
      await sql`UPDATE dm_publication_family SET current_document_version_id = ${newerVersionId}, current_generation = 2
        WHERE family_id = 'family_real_ftd_31_21002'`;
      const continued = await owner.runtime(() =>
        owner.working.withActorTransaction('actor-A', ({ database }) =>
          owner.matters.ensureFamilyMatter(
            {
              ...binding,
              documentVersionId: newerVersionId,
            },
            database,
          ),
        ),
      );
      assert.equal(continued.matterId, scope.matterId);
      assert.equal(continued.created, false);
      const changed = await owner.matters.readMaterials(scope);
      assert.equal(changed.matterRevision, 4);
      assert.equal(
        changed.materials.find((x) => x.kind === 'MEMBER').documentVersionId,
        newerVersionId,
      );
      const relatedChanged = await owner.matters.readMaterials(relatedScope);
      assert.equal(relatedChanged.matterRevision, 3);
      const relatedMaterial = relatedChanged.materials.find(
        (x) => x.kind === 'RELATED',
      );
      assert.equal(relatedMaterial.documentVersionId, newerVersionId);
      assert.equal(relatedMaterial.scope, '限定相关范围');
      await owner.matters.ensureFamilyMatter(binding);
      assert.deepEqual(
        await owner.matters.readMaterials(scope),
        changed,
        'late older intake does not roll back the selected material version',
      );
      // A real Matter attempt has no WorkItem/document identity and remains
      // bound to the exact composition even when later inputs become pending.
      await sql`INSERT INTO action_attempt (
        attempt_id, tenant_id, actor_user_id, subject_kind, matter_id,
        matter_revision_id, action_type, status, input_revision, base_revision
      ) VALUES ('ATT-MATTER-SUBJECT', 'tenant-A', 'actor-A', 'ENGINEERING_MATTER',
        ${scope.matterId}, ${changed.matterRevisionId}, 'OPENCLAW_MATTER_ASSESSMENT', 'QUEUED', 4, 0)`;
      const readAttempt = (connection) =>
        connection.database.execute(drizzleSql`
        SELECT attempt_id, work_item_id FROM action_attempt
        WHERE attempt_id = 'ATT-MATTER-SUBJECT'`);
      assert.equal((await readAttempt(owner)).length, 1);
      assert.equal((await readAttempt(owner))[0].work_item_id, null);
      assert.equal((await readAttempt(outsider)).length, 0);
      const readHostedAttempt = (connection) =>
        connection.runtime(() =>
          connection.working.withActorTransaction(
            connection.actor.userId,
            ({ database }) =>
              database.execute(
                drizzleSql`SELECT attempt_id FROM action_attempt WHERE attempt_id = 'ATT-MATTER-SUBJECT'`,
              ),
          ),
        );
      assert.equal((await readHostedAttempt(owner)).length, 1);
      assert.equal((await readHostedAttempt(outsider)).length, 0);
      await assert.rejects(
        sql`UPDATE action_attempt SET subject_kind = 'WORK_ITEM', matter_id = NULL,
          matter_revision_id = NULL, work_item_id = ${FTD_WORK_ITEM_ID}, action_type = 'OPENCLAW_INTERACTIVE_REVIEW'
          WHERE attempt_id = 'ATT-MATTER-SUBJECT'`,
        /ACTION_ATTEMPT_SUBJECT_IMMUTABLE/u,
      );

      await assert.rejects(
        owner.database
          .execute(drizzleSql`UPDATE action_attempt SET actor_user_id = 'actor-B'
          WHERE attempt_id = 'ATT-MATTER-SUBJECT'`),
        (error) => error.cause?.message === 'ACTION_ATTEMPT_SUBJECT_IMMUTABLE',
      );
      await assert.rejects(
        sql`UPDATE action_attempt SET work_item_id = ${FTD_WORK_ITEM_ID} WHERE attempt_id = 'ATT-MATTER-SUBJECT'`,
        /ACTION_ATTEMPT_SUBJECT_IMMUTABLE/u,
      );
      await assert.rejects(
        sql`UPDATE action_attempt SET tenant_id = 'tenant-B' WHERE attempt_id = 'ATT-MATTER-SUBJECT'`,
        /ACTION_ATTEMPT_SUBJECT_IMMUTABLE/u,
      );
      for (const [patch, constraint] of [
        [{ tenant_id: 'tenant-B' }, 'fk_action_attempt_matter_basis'],
        [{ work_item_id: FTD_WORK_ITEM_ID }, 'ck_action_attempt_subject'],
        [
          { document_version_id: fixtures.ftd.documentVersionId },
          'ck_action_attempt_subject',
        ],
        [{ matter_revision_id: null }, 'ck_action_attempt_subject'],
      ]) {
        await assert.rejects(
          sql`INSERT INTO action_attempt
          SELECT (jsonb_populate_record(NULL::action_attempt, to_jsonb(a) ||
            ${sql.json({ ...patch, id: randomUUID(), attempt_id: 'ATT-MATTER-INVALID', attempt_no: 2, status: 'SUCCEEDED' })}::jsonb)).*
          FROM action_attempt a WHERE attempt_id = 'ATT-MATTER-SUBJECT'`,
          (error) => error.constraint_name === constraint,
        );
      }
      await assert.rejects(
        sql`INSERT INTO action_attempt
          SELECT (jsonb_populate_record(NULL::action_attempt, to_jsonb(a) || jsonb_build_object(
            'id', gen_random_uuid(), 'attempt_id', 'ATT-MATTER-CONCURRENT', 'attempt_no', 2))).*
          FROM action_attempt a WHERE attempt_id = 'ATT-MATTER-SUBJECT'`,
        /uk_action_attempt_active_matter_task/u,
      );
      await sql`UPDATE work_item SET requested_by_user_id = 'actor-B' WHERE work_item_id = ${SB_WORK_ITEM_ID}`;
      await assert.rejects(
        owner.matters.readMaterials(scope),
        /not available/u,
        'a revoked fulfilled source hides the whole current composition',
      );
      assert.equal(
        (await readAttempt(owner)).length,
        0,
        'revoking a material also hides its attempt',
      );
      assert.equal((await readHostedAttempt(owner)).length, 0);
      assert.equal(
        (await sql`SELECT count(*) AS n FROM work_item`)[0].n,
        before,
      );
    } finally {
      for (const connection of connections) await connection.release();
      await sql.end();
    }
  },
);

test(
  'R09 Engineering Matter creates, revises and reads two real-document WorkItems with fresh ACL/currentness',
  { skip: !databaseUrl, concurrency: false },
  async () => {
    assertSafeIsolatedDatabase(databaseUrl);
    const sql = postgres(databaseUrl, { max: 8, onnotice: () => {} });
    try {
      const fixtures = await loadRealDocumentFixtures();
      await resetDatabase(sql);
      await seedRealDocumentWorkItems(sql, fixtures);

      const owner = await reserveActorService('actor-A');
      try {
        const created = await owner.service.create(
          {
            requestId: 'REQ-MATTER-REAL-DOCUMENTS-1',
            title: 'AIMS-2 and 737 FMC engineering matter',
            primaryWorkItemId: FTD_WORK_ITEM_ID,
          },
          owner.actor,
        );
        assert.equal(created.created, true);
        assert.equal(created.matter.currentRevision.revisionNo, 1);
        assert.deepEqual(
          created.matter.catalog.entries.map((entry) => entry.workItemId),
          [FTD_WORK_ITEM_ID],
        );

        const createReplay = await owner.service.create(
          {
            requestId: 'REQ-MATTER-REAL-DOCUMENTS-1',
            title: 'AIMS-2 and 737 FMC engineering matter',
            primaryWorkItemId: FTD_WORK_ITEM_ID,
          },
          owner.actor,
        );
        assert.equal(createReplay.created, false);
        assert.equal(createReplay.matter.matterId, created.matter.matterId);

        const linked = await owner.service.linkWorkItem(
          created.matter.matterId,
          {
            requestId: 'REQ-MATTER-LINK-REAL-SB-1',
            expectedMatterRevision: 1,
            workItemId: SB_WORK_ITEM_ID,
            changeSummary: 'Link actual 737-34-3830 Service Bulletin evidence.',
          },
          owner.actor,
        );
        assert.equal(linked.linked, true);
        assert.equal(linked.replayed, false);
        assert.equal(linked.matter.currentRevision.revisionNo, 2);
        assert.deepEqual(
          linked.matter.catalog.entries.map((entry) => ({
            workItemId: entry.workItemId,
            relationRole: entry.relationRole,
            sourceRefCount: entry.sourceNavigation.sourceRefCount,
            documentCode: entry.document.documentCode,
          })),
          [
            {
              workItemId: FTD_WORK_ITEM_ID,
              relationRole: 'PRIMARY',
              sourceRefCount: fixtures.ftd.sourceRefCount,
              documentCode: '777-FTD-31-21002',
            },
            {
              workItemId: SB_WORK_ITEM_ID,
              relationRole: 'RELATED',
              sourceRefCount: fixtures.sb.sourceRefCount,
              documentCode: '737-34-3830',
            },
          ],
        );

        const linkReplay = await owner.service.linkWorkItem(
          created.matter.matterId,
          {
            requestId: 'REQ-MATTER-LINK-REAL-SB-1',
            expectedMatterRevision: 1,
            workItemId: SB_WORK_ITEM_ID,
            changeSummary: 'Link actual 737-34-3830 Service Bulletin evidence.',
          },
          owner.actor,
        );
        assert.equal(linkReplay.linked, false);
        assert.equal(linkReplay.replayed, true);
        assert.equal(linkReplay.matter.currentRevision.revisionNo, 2);

        await assertWorkingRevisionFlow(
          sql,
          owner,
          created.matter.matterId,
          linked.matter.currentRevision.matterRevisionId,
        );

        await assertRealMatterAttemptSave(sql, owner, created.matter.matterId);
        await assertMatterLeaseLifecycle(sql, owner, created.matter.matterId);

        await assertLinkReplayMismatchAndCasConflict(
          owner,
          created.matter.matterId,
        );
        await advanceOwnerWorkItemCurrent(sql);
        const fresh = await owner.service.read(
          created.matter.matterId,
          owner.actor,
        );
        const ftd = fresh.catalog.entries.find(
          (entry) => entry.workItemId === FTD_WORK_ITEM_ID,
        );
        assert.equal(ftd.workItemChangedSinceLink, true);
        assert.equal(ftd.linkedAtWorkItemRevision, 4);
        assert.equal(ftd.currentWorkItemRevision, 5);
        assert.equal(ftd.documentCurrentness.selectedVersionIsCurrent, true);
        assert.equal(
          ftd.documentCurrentness.currentDocumentVersionId,
          'document_version_fd88dcb9cf64cf3ba21033ef',
        );
        const workingAfterInputAdvance = await owner.workingService.readWorking(
          created.matter.matterId,
          owner.actor,
        );
        assert.deepEqual(
          workingAfterInputAdvance.pendingInputs.map((pending) => ({
            inputId: pending.inputId,
            reasons: pending.reasons,
          })),
          [
            {
              inputId: FTD_WORK_ITEM_ID,
              reasons: ['WORK_ITEM_REVISION_CHANGED'],
            },
          ],
        );
        assertBrowserSafe(fresh);

        await assertUnauthorizedLinkRollsBack(
          sql,
          owner,
          created.matter.matterId,
        );
        await assertAlreadyLinkedRequestReuse(
          sql,
          owner,
          created.matter.matterId,
        );
      } finally {
        await owner.release();
      }

      const outsider = await reserveActorService('actor-B');
      try {
        const [matter] = await sql`
          SELECT matter_id FROM engineering_matter LIMIT 1
        `;
        await assert.rejects(
          outsider.service.read(matter.matter_id, outsider.actor),
          (error) => error?.code === 'ENGINEERING_MATTER_NOT_FOUND',
        );
      } finally {
        await outsider.release();
      }

      const [matter] = await sql`
        SELECT matter_id FROM engineering_matter LIMIT 1
      `;
      await assertSecurityDefinerAndDirectRlsDenials(sql, matter.matter_id);

      const crossTenant = await reserveActorService('actor-C', 'tenant-B');
      try {
        await assert.rejects(
          crossTenant.service.read(matter.matter_id, crossTenant.actor),
          (error) => error?.code === 'ENGINEERING_MATTER_NOT_FOUND',
        );
      } finally {
        await crossTenant.release();
      }

      await assertMatterHistory(sql);
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);

test(
  'R10 Engineering Matter working revisions enforce CAS, replay, pending and runtime ownership',
  { skip: !databaseUrl, concurrency: false },
  async () => {
    assertSafeIsolatedDatabase(databaseUrl);
    const sql = postgres(databaseUrl, { max: 8, onnotice: () => {} });
    try {
      const fixtures = await loadRealDocumentFixtures();
      await resetDatabase(sql);
      await seedRealDocumentWorkItems(sql, fixtures);
      const owner = await reserveActorService('actor-A');
      try {
        const created = await owner.service.create(
          {
            requestId: 'REQ-MATTER-R10-WORKING',
            title: 'R10 working-state integration',
            primaryWorkItemId: FTD_WORK_ITEM_ID,
          },
          owner.actor,
        );
        await assertReviewScopeIsImmutable(sql);
        const linked = await owner.service.linkWorkItem(
          created.matter.matterId,
          {
            requestId: 'REQ-MATTER-R10-WORKING-LINK',
            expectedMatterRevision: 1,
            workItemId: SB_WORK_ITEM_ID,
          },
          owner.actor,
        );
        await assertWorkingRevisionFlow(
          sql,
          owner,
          created.matter.matterId,
          linked.matter.currentRevision.matterRevisionId,
        );
        const runtimeBasis = await owner.runtime(() =>
          owner.workingService.authorizeRuntimeWorkingBasis({
            matterId: created.matter.matterId,
            tenantId: 'tenant-A',
            actorId: 'actor-A',
            basedOnMatterRevisionId:
              linked.matter.currentRevision.matterRevisionId,
          }),
        );
        assert.equal(runtimeBasis.working.workingRevision, 1);
        assert.equal(runtimeBasis.currentInputs.length, 2);
        await owner.runtime(async () => {
          const before = await owner.database.execute(
            drizzleSql`SELECT current_setting('app.user_id', true) AS actor`,
          );
          assert.equal(before[0].actor, '-1');
          await owner.working.withActorTransaction(
            'actor-A',
            async ({ database }) => {
              for (let index = 0; index < 2; index++) {
                const rows = await database.execute(
                  drizzleSql`SELECT current_setting('app.user_id', true) AS actor, current_user AS role`,
                );
                assert.equal(rows[0].actor, 'actor-A');
                assert.equal(rows[0].role, 'service_role_wiselink_r10_test');
              }
              // Row locks are permitted, but the runtime cannot mutate the
              // parent Matter (its new UPDATE policy has WITH CHECK false).
              await database.execute(
                drizzleSql`SELECT matter_id FROM engineering_matter WHERE matter_id=${created.matter.matterId} FOR UPDATE`,
              );
            },
          );
          const after = await owner.database.execute(
            drizzleSql`SELECT current_setting('app.user_id', true) AS actor`,
          );
          assert.equal(
            after[0].actor,
            '-1',
            'the original system SQL identity is restored',
          );
          await assert.rejects(
            owner.working.withActorTransaction('actor-A', ({ database }) =>
              database.execute(
                drizzleSql`UPDATE engineering_matter SET title='forbidden runtime mutation' WHERE matter_id=${created.matter.matterId}`,
              ),
            ),
            (error) =>
              error?.cause?.code === '42501' || error?.code === '42501',
          );
          await assert.rejects(
            owner.working.withActorTransaction("actor-A'; RESET ROLE; --", () =>
              assert.fail('must not execute'),
            ),
            /RUNTIME_AUTHORIZATION_UNAVAILABLE/u,
          );
        });
        await assert.rejects(
          owner.working.withActorTransaction('actor-A', () =>
            assert.fail('browser scope must not become a service account'),
          ),
          /RUNTIME_AUTHORIZATION_UNAVAILABLE/u,
        );
        await assertHostedCandidateRls(sql, owner, created.matter.matterId);

        await advanceOwnerWorkItemCurrent(sql);
        const pending = await owner.workingService.readWorking(
          created.matter.matterId,
          owner.actor,
        );
        assert.deepEqual(
          pending.pendingInputs.map((item) => ({
            inputId: item.inputId,
            reasons: item.reasons,
          })),
          [
            {
              inputId: FTD_WORK_ITEM_ID,
              reasons: ['WORK_ITEM_REVISION_CHANGED'],
            },
          ],
        );

        const outsider = await reserveActorService('actor-B');
        try {
          await assert.rejects(
            outsider.runtime(() =>
              outsider.workingService.authorizeRuntimeWorkingBasis({
                matterId: created.matter.matterId,
                tenantId: 'tenant-A',
                actorId: 'actor-B',
              }),
            ),
            (error) =>
              error?.code ===
              'ENGINEERING_MATTER_RUNTIME_AUTHORIZATION_UNAVAILABLE',
          );
        } finally {
          await outsider.release();
        }
      } finally {
        await owner.release();
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);

function assertSafeIsolatedDatabase(value) {
  const parsed = new URL(value);
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname),
    'PostgreSQL integration test must use localhost',
  );
  assert.equal(
    parsed.pathname,
    '/wiselink_engineering_matter_test',
    'PostgreSQL integration test requires the exact isolated database name',
  );
}

async function loadRealDocumentFixtures() {
  const [ftdRequest, ftdPackage, sbPackage] = await Promise.all([
    readJson('test/fixtures/real-ftd-canonical-vertical.request.json'),
    readJson('test/fixtures/real-ftd-frozen2.unified-package.json'),
    readJson(
      'server/runtime-assets/assessment-host/real-sb/737-34-3830-original-issue/unified-package.frozen-2.json',
    ),
  ]);
  assert.equal(ftdRequest.workItemId, FTD_WORK_ITEM_ID);
  assert.equal(ftdRequest.source.documentVersionId.length > 0, true);
  assert.equal(ftdPackage.sourceRefs.length, 239);
  assert.equal(sbPackage.sourceRefs.length, 76);
  return {
    ftd: {
      ...ftdRequest.source,
      workItemId: ftdRequest.workItemId,
      packageId: ftdPackage.packageId,
      sourceRefCount: ftdPackage.sourceRefs.length,
    },
    sb: {
      workItemId: SB_WORK_ITEM_ID,
      documentId: 'document_10085d27e5c05266403bb74c',
      documentVersionId: 'document_version_f4813607b91ee1a20e754e2d',
      sourceArtifactId: 'source_artifact_phase5_local_actual_bytes',
      sourceFileSha256:
        'sha256:add32c7d4192d35c59162f15eb57f08247427135d5912438501ec9267fa4d41a',
      sourceByteLength: 1_060_204,
      packageId: sbPackage.packageId,
      sourceRefCount: sbPackage.sourceRefs.length,
    },
  };
}

test(
  'Matter commits frozen inputs while later material remains pending',
  { skip: !databaseUrl, concurrency: false },
  async () => {
    assertSafeIsolatedDatabase(databaseUrl);
    const sql = postgres(databaseUrl, { max: 8, onnotice() {} });
    let owner;
    try {
      const fixtures = await loadRealDocumentFixtures();
      await resetDatabase(sql);
      await seedRealDocumentWorkItems(sql, fixtures);
      owner = await reserveActorService('actor-A');
      const created = await owner.matters.ensureFamilyMatter({
        tenantId: 'tenant-A',
        actorUserId: 'actor-A',
        documentVersionId: fixtures.ftd.documentVersionId,
      });
      const scope = {
        tenantId: 'tenant-A',
        actorUserId: 'actor-A',
        matterId: created.matterId,
      };
      const initial = await owner.matters.loadCurrent(scope);
      await assertWorkingRevisionFlow(
        sql,
        owner,
        scope.matterId,
        initial.currentMatterRevisionId,
      );
      const [priorRow] =
        await sql`SELECT matter_work_revision_id, state_json FROM engineering_matter_work_revision
        WHERE matter_id = ${scope.matterId} ORDER BY working_revision DESC LIMIT 1`;
      const [retained] =
        await sql`SELECT revision, document_version_id, requested_by_user_id FROM work_item
        WHERE work_item_id = ${REQUEST_REUSE_WORK_ITEM_ID}`;
      const priorState = JSON.parse(priorRow.state_json);
      priorState.coverage.push({
        ...structuredClone(priorState.coverage[0]),
        binding: {
          inputId: REQUEST_REUSE_WORK_ITEM_ID,
          workItemId: REQUEST_REUSE_WORK_ITEM_ID,
          workItemRevision: retained.revision,
          documentVersionId: retained.document_version_id,
          resultRef: null,
          resultRevision: null,
        },
      });
      await sql`UPDATE engineering_matter_work_revision SET state_json = ${JSON.stringify(priorState)}
        WHERE matter_work_revision_id = ${priorRow.matter_work_revision_id}`;
      const basis = await owner.workingService.resolveWorkingBasis(
        scope.matterId,
        owner.actor,
      );
      const service = new MatterActionAttemptService(owner.working, {
        captureForNewTask: async (_tenant, now) =>
          taskModelSelection(CANONICAL_INITIAL_MODEL_REF, now),
      });
      const reserved = await owner.runtime(() =>
        service.reserve({
          ...scope,
          idempotencyKey: 'frozen-input-task',
          expectedMatterRevisionId: initial.currentMatterRevisionId,
          expectedMatterRevision: initial.currentRevisionNo,
          expectedWorkingRevision: basis.working.workingRevision,
          trigger: {
            kind: 'USER_REQUEST',
            requestId: 'frozen-input-request',
            instruction: '复核现有来源',
          },
          modelInput: { fixture: 'frozen input' },
          sourceRefs: [],
        }),
      );
      assert.deepEqual(reserved.task.workingBasis.inputs, basis.currentInputs);
      assert.equal(
        reserved.task.workingBasis.priorWorkRef,
        basis.working.matterWorkRevisionId,
      );
      const claimInput = {
        ...scope,
        attemptRef: reserved.task.operationRef,
        principalId: 'hosted-test',
      };
      try {
        await sql`UPDATE work_item SET requested_by_user_id = 'actor-B' WHERE work_item_id = ${REQUEST_REUSE_WORK_ITEM_ID}`;
        await assert.rejects(
          owner.runtime(() => service.read(claimInput)),
          /RUNTIME_AUTHORIZATION_UNAVAILABLE/u,
          'exact prior work authorization includes retained sources outside current composition',
        );
        await assert.rejects(
          owner.runtime(() => service.claim(claimInput)),
          /RUNTIME_AUTHORIZATION_UNAVAILABLE/u,
        );
      } finally {
        await sql`UPDATE work_item SET requested_by_user_id = ${retained.requested_by_user_id} WHERE work_item_id = ${REQUEST_REUSE_WORK_ITEM_ID}`;
      }
      const lease = await owner.runtime(() => service.claim(claimInput));
      const [family] =
        await sql`SELECT family_id FROM dm_document_version WHERE document_version_id = ${fixtures.sb.documentVersionId}`;
      const changed = await owner.matters.reviseMaterials({
        ...scope,
        command: {
          requestId: 'ADD-MATERIAL-WHILE-RUNNING',
          expectedMatterRevision: initial.currentRevisionNo,
          changeSummary: '运行中补入另一份实际已取得材料。',
          upserts: [
            {
              materialId: 'late-sb',
              kind: 'RELATED',
              familyId: family.family_id,
              documentVersionId: fixtures.sb.documentVersionId,
              scope: '后继待调查范围',
              contribution: '核查是否改变当前判断',
              basis: [],
              origin: 'ENGINEER',
              disposition: 'INCLUDED',
            },
          ],
        },
      });
      assert.notEqual(
        changed.materials.matterRevisionId,
        reserved.task.subject.matterRevisionId,
      );
      const fence = {
        ...claimInput,
        leaseToken: lease.leaseToken,
        leaseGeneration: lease.leaseGeneration,
      };
      const prepared = await owner.runtime(() =>
        service.prepareCommit({ ...fence, result: matterResult(lease.task) }),
      );
      const command = {
        requestId: prepared.row.triggerRequestId,
        expectedWorkingRevision: prepared.task.baseRevision,
        basedOnMatterRevisionId: prepared.task.subject.matterRevisionId,
        updateKind: 'CORRECTION',
        changeSummary: '完成已冻结范围，新材料留待后继。',
        nextFocus: {
          ...basis.working.state.focus,
          question: '冻结范围的候选复核。',
        },
        claimDelta: null,
        openQuestionDelta: null,
        reviewConditionDelta: null,
        nextSubstantiveResult: null,
        substantiveInputs: [],
        coverageUpdates: [],
      };
      const save = (inputs) =>
        owner.runtime(() =>
          owner.working.withActorTransaction(scope.actorUserId, (executor) =>
            executor.appendWorkingRevision({
              ...scope,
              command,
              currentInputs: inputs,
              source: {
                kind: 'ENGINEERING_MATTER',
                actionAttemptId: prepared.row.attemptId,
                reviewTurnId: null,
              },
            }),
          ),
        );
      const current = await owner.workingService.resolveWorkingBasis(
        scope.matterId,
        owner.actor,
      );
      await assert.rejects(
        save(current.currentInputs),
        /WORKING_INPUT/u,
        'latest inputs cannot replace frozen input bindings',
      );
      const saved = await save(prepared.task.workingBasis.inputs);
      assert.equal(
        saved.revision.basedOnMatterRevisionId,
        initial.currentMatterRevisionId,
      );
      assert.deepEqual(
        saved.revision.state.problemWork,
        basis.working.state.problemWork,
      );
      await owner.runtime(() => service.finish(fence));
      const visible = await owner.workingService.readWorking(
        scope.matterId,
        owner.actor,
      );
      assert(
        visible.pendingInputs.some(
          (input) =>
            input.current.documentVersionId === fixtures.sb.documentVersionId,
        ),
      );
      assert.equal(
        (await owner.runtime(() => service.read(claimInput))).taskInputHash,
        reserved.task.inputHash,
      );
    } finally {
      if (owner) await owner.release();
      await sql.end();
    }
  },
);

async function readJson(path) {
  return JSON.parse(await readFile(resolve(process.cwd(), path), 'utf8'));
}

async function resetDatabase(sql) {
  await sql.unsafe('DROP SCHEMA public CASCADE');
  await sql.unsafe('CREATE SCHEMA public');
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
      THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
      THEN CREATE ROLE service_role NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role_wiselink_r10_test')
      THEN CREATE ROLE service_role_wiselink_r10_test NOLOGIN IN ROLE service_role; END IF;
    END $$
  `);
  await sql.unsafe('CREATE TYPE user_profile AS (user_id text)');
  await sql.unsafe(`
    CREATE TABLE identity_subject_mapping (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      miaoda_user_id varchar(255) NOT NULL,
      miaoda_tenant_id varchar(128) NOT NULL,
      expected_client_id varchar(128) NOT NULL,
      status varchar(32) NOT NULL
    )
  `);
  await sql.unsafe(`
    CREATE TABLE work_item (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      work_item_id varchar(96) NOT NULL UNIQUE,
      tenant_id varchar(128) NOT NULL,
      action_type varchar(64) NOT NULL,
      document_id varchar(96) NOT NULL,
      document_version_id varchar(96) NOT NULL,
      source_artifact_id varchar(96) NOT NULL,
      source_file_sha256 varchar(64) NOT NULL,
      source_byte_length bigint NOT NULL,
      normalized_family varchar(64) NOT NULL,
      request_id varchar(96) NOT NULL,
      status varchar(64) NOT NULL,
      revision integer NOT NULL,
      projection_json text,
      package_id text,
      package_artifact_ref text,
      package_artifact_sha256 varchar(64),
      failure_code varchar(160),
      failure_artifact_ref text,
      failure_artifact_sha256 varchar(64),
      requested_by_user_id varchar(255) NOT NULL,
      created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      run_key varchar(96) NOT NULL DEFAULT 'canonical',
      analysis_model_json text,
      _created_by user_profile,
      _updated_by user_profile,
      CONSTRAINT uk_work_item_tenant_parse
        UNIQUE (tenant_id, action_type, document_version_id, run_key)
    )
  `);
  const attemptDdl = await readFile(
    resolve(process.cwd(), 'server/database/work-item.ddl.sql'),
    'utf8',
  );
  await sql.unsafe(
    attemptDdl.match(/CREATE TABLE action_attempt \([\s\S]*?\n\);/u)[0],
  );
  await sql.unsafe(`ALTER TABLE action_attempt
    ALTER COLUMN trigger_request_id SET DEFAULT 'REQ-ISOLATED-FIXTURE',
    ALTER COLUMN request_origin SET DEFAULT 'OPENCLAW_MCP_V1',
    ADD COLUMN review_activity_json text,
    ADD COLUMN execution_model_json text`);
  await applyMigration(sql, 'migrations/0003_action_attempt_openclaw_v1.sql');
  await sql.unsafe(`
    CREATE TABLE review_turn (
      review_turn_id varchar(96) PRIMARY KEY,
      tenant_id varchar(128), actor_id varchar(255), work_item_id varchar(96),
      action_attempt_id varchar(96), review_conversation_id varchar(96),
      input_revision integer
    )
  `);
  await applyMigration(
    sql,
    'migrations/0001_document_management_hosted_catalog.sql',
  );
  await applyMigration(sql, 'migrations/0014_engineering_matter_catalog.sql');
  await sql.unsafe(
    'ALTER TABLE work_item ADD COLUMN initial_aily_session_id uuid',
  );
  await applyMigration(sql, 'migrations/0032_engineering_matter_material.sql');
  await applyMigration(
    sql,
    'migrations/0033_engineering_matter_explicit_material_runtime.sql',
  );
  await applyMigration(
    sql,
    'migrations/0023_engineering_matter_working_state.sql',
  );
  await applyMigration(
    sql,
    'migrations/0024_engineering_matter_hosted_runtime_actor.sql',
  );
  await applyMigration(
    sql,
    'migrations/0034_action_attempt_matter_subject.sql',
  );
  await applyMigration(
    sql,
    'migrations/0035_engineering_matter_attempt_work.sql',
  );
  await applyMigration(
    sql,
    'migrations/0036_matter_jobaid_save_before_finish.sql',
  );
  await sql.unsafe('ALTER TABLE action_attempt ENABLE ROW LEVEL SECURITY');
  // Emulate existing platform permissive policies: the new restrictive policy
  // must hold even when a legacy policy allows all rows.
  await sql.unsafe(
    'CREATE POLICY legacy_attempt_access ON action_attempt TO authenticated, service_role USING (true)',
  );
  await sql.unsafe(
    'GRANT SELECT, INSERT, UPDATE ON action_attempt TO authenticated, service_role',
  );
  await sql.unsafe('ALTER TABLE work_item ENABLE ROW LEVEL SECURITY');
  await sql.unsafe(`
    CREATE POLICY work_item_owner ON work_item TO authenticated
    USING (
      requested_by_user_id = current_setting('app.user_id', true)
      AND tenant_id = 'tenant-A'
    )
  `);
  await sql.unsafe('GRANT USAGE ON SCHEMA public TO authenticated');
  await sql.unsafe('GRANT SELECT ON identity_subject_mapping TO authenticated');
  await sql.unsafe('GRANT SELECT ON work_item TO authenticated');
  await sql.unsafe(`
    GRANT SELECT ON dm_source_artifact, dm_acquisition,
      dm_publication_family, dm_document_version, dm_ingress_preflight,
      dm_currentness_decision
    TO authenticated
  `);
  await sql.unsafe(`
    GRANT SELECT, INSERT, UPDATE
    ON engineering_matter, engineering_matter_revision,
      engineering_matter_revision_work_item
    TO authenticated
  `);
  await sql.unsafe(`
    GRANT SELECT, INSERT ON engineering_matter_work_revision TO authenticated
  `);
  // PostgreSQL row-locking SELECT also requires UPDATE privilege. The same
  // owner RLS policy continues to apply; only this isolated fixture grants it.
  await sql.unsafe('GRANT UPDATE ON work_item TO authenticated');
  await sql.unsafe('GRANT UPDATE ON dm_publication_family TO authenticated');
  await sql.unsafe(
    'GRANT SELECT, INSERT ON engineering_matter_material_link TO authenticated, service_role',
  );
  // Isolated equivalents of the platform's existing table privileges and
  await sql.unsafe(
    'GRANT SELECT ON dm_document_version, dm_publication_family TO service_role',
  );
  await sql.unsafe('GRANT UPDATE ON dm_publication_family TO service_role');
  await sql.unsafe(
    'GRANT INSERT ON engineering_matter, engineering_matter_revision, engineering_matter_revision_work_item TO service_role',
  );
  // Hosted actor policies. No production GRANT is introduced by migration 24.
  await sql.unsafe('GRANT USAGE ON SCHEMA public TO service_role');
  await sql.unsafe(
    'GRANT SELECT ON identity_subject_mapping, action_attempt, review_turn, work_item, engineering_matter, engineering_matter_revision, engineering_matter_revision_work_item, engineering_matter_work_revision TO service_role',
  );
  await sql.unsafe(
    'GRANT UPDATE ON engineering_matter, work_item TO service_role',
  );
  await sql.unsafe(
    'GRANT INSERT ON engineering_matter_work_revision TO service_role',
  );
  await sql.unsafe(
    'ALTER TABLE identity_subject_mapping ENABLE ROW LEVEL SECURITY',
  );
  await sql.unsafe(
    `CREATE POLICY identity_browser_read ON identity_subject_mapping FOR SELECT TO authenticated USING (true)`,
  );
  await sql.unsafe(
    `CREATE POLICY identity_hosted_read ON identity_subject_mapping FOR SELECT TO service_role USING (miaoda_user_id=current_setting('app.user_id', true) AND expected_client_id='cli_aadde8b579f95bc9' AND status='ACTIVE')`,
  );
  await sql.unsafe(
    `CREATE POLICY work_item_hosted_read ON work_item FOR SELECT TO service_role USING (requested_by_user_id=current_setting('app.user_id', true))`,
  );
  await sql.unsafe(
    `CREATE POLICY work_item_hosted_lock ON work_item FOR UPDATE TO service_role USING (requested_by_user_id=current_setting('app.user_id', true)) WITH CHECK (false)`,
  );
  const policyHelpers = await sql`
    SELECT oid::regprocedure::text AS signature FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND (proname LIKE 'engineering_matter_%_by_actor'
        OR proname = 'engineering_matter_actor_has_tenant')
  `;
  for (const { signature } of policyHelpers) {
    // The platform owns these privileges. Emulate them only in the isolated
    // database, since production migrations intentionally contain no GRANT.
    await sql.unsafe(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`);
    await sql.unsafe(
      `GRANT EXECUTE ON FUNCTION ${signature} TO authenticated, service_role`,
    );
  }
}

async function applyMigration(sql, path) {
  const migration = await readFile(resolve(process.cwd(), path), 'utf8');
  const reserved = await sql.reserve();
  try {
    // Migration 14 captures the platform's current workspace search_path.
    // Give this isolated public schema its corresponding explicit path.
    await reserved.unsafe('SET search_path = public');
    await reserved.unsafe(migration);
  } catch (error) {
    await reserved.unsafe('ROLLBACK');
    throw error;
  } finally {
    await reserved.unsafe('RESET search_path');
    reserved.release();
  }
}

async function assertHostedCandidateRls(sql, owner, matterId) {
  const [stored] = await sql`
    SELECT command_json FROM engineering_matter_work_revision
    WHERE matter_id = ${matterId} AND working_revision = 1
  `;
  const command = JSON.parse(stored.command_json);
  command.requestId = 'review-turn:RT-R10-HOSTED';
  command.expectedWorkingRevision = 1;
  command.updateKind = 'CORRECTION';
  command.changeSummary =
    'Correct the candidate reading through Hosted Review.';
  command.nextSubstantiveResult.resultRevision = 2;
  command.nextSubstantiveResult.content.claims[0].text =
    'The corrected condition remains candidate-only.';
  command.nextProblemWork.issues[0].statements = structuredClone(
    command.nextSubstantiveResult.content.claims,
  );
  command.nextProblemWork.changeSummary = command.changeSummary;
  command.claimDelta = {
    changedBecause: 'The engineer corrected the test premise.',
    additions: [],
    replacements: structuredClone(command.nextSubstantiveResult.content.claims),
    retirements: [],
    explicitlyUnchangedClaimIds: [],
  };
  const source = {
    actionAttemptId: 'ATT-R10-HOSTED',
    reviewTurnId: 'RT-R10-HOSTED',
  };
  const exactKey = 'openclaw-v1:review:RC-R10-HOSTED:RT-R10-HOSTED:4';
  await sql`
    INSERT INTO action_attempt (
      attempt_id, tenant_id, actor_user_id, work_item_id, action_type,
      status, request_origin, input_revision, idempotency_key
    ) VALUES (
      ${source.actionAttemptId}, 'tenant-A', 'actor-A', ${FTD_WORK_ITEM_ID},
      'OPENCLAW_INTERACTIVE_REVIEW', 'COMMITTING', 'OPENCLAW_MCP_V1', 4, ${exactKey}
    )
  `;
  for (const turnId of [source.reviewTurnId, 'RT-R10-UNRELATED']) {
    await sql`
      INSERT INTO review_turn (
        review_turn_id, tenant_id, actor_id, work_item_id,
        review_conversation_id, input_revision, review_scope_json
      ) VALUES (
        ${turnId}, 'tenant-A', 'actor-A', ${FTD_WORK_ITEM_ID}, 'RC-R10-HOSTED', 4,
        ${sql.json({ kind: 'ENGINEERING_MATTER', matterId, basedOnMatterRevisionId: command.basedOnMatterRevisionId })}
      )
    `;
  }
  const input = {
    tenantId: 'tenant-A',
    actorUserId: 'actor-A',
    matterId,
    command,
    currentInputs: command.substantiveInputs,
    source,
  };
  const commit = (patch = {}, afterAppend) =>
    owner.runtime(() =>
      owner.working.withActorTransaction('actor-A', async (executor) => {
        await executor.authorizeRuntimeInputs({
          tenantId: 'tenant-A',
          actorUserId: 'actor-A',
          matterId,
        });
        const result = await executor.appendWorkingRevision({
          ...input,
          ...patch,
        });
        if (afterAppend) await afterAppend(executor);
        return result;
      }),
    );
  const rejected = (operation) =>
    assert.rejects(operation, (error) => databaseCode(error) === '42501');
  await rejected(commit({ source: null }));
  await rejected(
    commit({ source: { ...source, reviewTurnId: 'RT-R10-UNRELATED' } }),
  );
  await sql`UPDATE action_attempt SET status = 'RUNNING' WHERE attempt_id = ${source.actionAttemptId}`;
  await rejected(commit());
  await sql`UPDATE action_attempt SET status = 'COMMITTING', idempotency_key = 'wrong-turn' WHERE attempt_id = ${source.actionAttemptId}`;
  await rejected(commit());
  await sql`UPDATE action_attempt SET idempotency_key = ${exactKey} WHERE attempt_id = ${source.actionAttemptId}`;
  const rollback = new Error('CANDIDATE_PERSISTENCE_FAILED');
  await assert.rejects(
    commit({}, async () => {
      throw rollback;
    }),
    (error) => error === rollback,
  );
  const [before] =
    await sql`SELECT count(*)::int AS count FROM engineering_matter_work_revision WHERE matter_id = ${matterId}`;
  assert.equal(
    before.count,
    1,
    'failed authorization or candidate persistence must append nothing',
  );
  const result = await commit();
  assert.equal(result.revision.workingRevision, 2);
  assert.deepEqual(result.revision.source, source);
  assert.equal(result.revision.state.substantiveResult.candidateOnly, true);
  const replay = await commit();
  assert.equal(replay.replayed, true);
  assert.equal(
    replay.revision.matterWorkRevisionId,
    result.revision.matterWorkRevisionId,
  );
  const [turn] =
    await sql`SELECT action_attempt_id FROM review_turn WHERE review_turn_id = ${source.reviewTurnId}`;
  assert.equal(
    turn.action_attempt_id,
    null,
    'append uses exact Turn binding before candidate persistence sets this field',
  );
}

async function seedRealDocumentWorkItems(sql, fixtures) {
  await sql`
    INSERT INTO identity_subject_mapping (
      miaoda_user_id, miaoda_tenant_id, expected_client_id, status
    ) VALUES
      ('actor-A', 'tenant-A', 'cli_aadde8b579f95bc9', 'ACTIVE'),
      ('actor-B', 'tenant-A', 'cli_aadde8b579f95bc9', 'ACTIVE'),
      ('actor-C', 'tenant-B', 'cli_aadde8b579f95bc9', 'ACTIVE')
  `;
  await seedDocument(sql, {
    fixture: fixtures.ftd,
    familyId: 'family_real_ftd_31_21002',
    documentFamily: 'FTD',
    documentCode: '777-FTD-31-21002',
    businessRevision: '2025-09-26',
    revisionDate: '2025-09-26',
    actor: 'actor-A',
    workItemRevision: 4,
  });
  await seedDocument(sql, {
    fixture: fixtures.sb,
    familyId: 'family_58068371edd11c2b3c8aecf0',
    documentFamily: 'SB',
    documentCode: '737-34-3830',
    businessRevision: 'Original Issue',
    revisionDate: '2026-05-13',
    actor: 'actor-A',
    workItemRevision: 6,
  });
  await sql`
    INSERT INTO work_item (
      work_item_id, tenant_id, action_type, document_id,
      document_version_id, source_artifact_id, source_file_sha256,
      source_byte_length, normalized_family, request_id, status, revision,
      projection_json, package_id, requested_by_user_id, run_key
    )
    SELECT
      ${REQUEST_REUSE_WORK_ITEM_ID}, tenant_id, action_type, document_id,
      document_version_id, source_artifact_id, source_file_sha256,
      source_byte_length, normalized_family, 'REQ-FTD-REAL-RERUN', status,
      revision,
      jsonb_set(
        projection_json::jsonb,
        '{workItemId}',
        to_jsonb(${REQUEST_REUSE_WORK_ITEM_ID}::text)
      )::text,
      package_id, requested_by_user_id, 'matter-request-regression'
    FROM work_item
    WHERE work_item_id = ${FTD_WORK_ITEM_ID}
  `;
  await sql`
    INSERT INTO work_item (
      work_item_id, tenant_id, action_type, document_id,
      document_version_id, source_artifact_id, source_file_sha256,
      source_byte_length, normalized_family, request_id, status, revision,
      requested_by_user_id
    ) VALUES (
      'WI-OTHER-ACTOR', 'tenant-A', 'PARSE_PDF', 'document_other_actor',
      'document_version_other_actor', 'source_other_actor',
      repeat('c', 64), 1, 'SB', 'REQ-OTHER-ACTOR', 'reserved', 0, 'actor-B'
    )
  `;
}

async function seedDocument(sql, input) {
  const rawSha = input.fixture.sourceFileSha256.replace(/^sha256:/u, '');
  const acquisitionId = `acquisition_${input.documentFamily.toLowerCase()}`;
  const preflightId = `preflight_${input.documentFamily.toLowerCase()}`;
  await sql`
    INSERT INTO dm_source_artifact (
      source_artifact_id, sha256, byte_length, media_type, bucket_id,
      file_path, provider_object_id, provider_version_id,
      readback_verified, created_at
    ) VALUES (
      ${input.fixture.sourceArtifactId}, ${rawSha},
      ${input.fixture.sourceByteLength}, 'application/pdf',
      'repository-real-fixtures', ${input.fixture.workItemId},
      ${input.fixture.workItemId}, 'accepted-real-fixture', TRUE, NOW()
    )
  `;
  await sql`
    INSERT INTO dm_acquisition (
      acquisition_id, source_artifact_id, document_version_id,
      source_channel, source_ref, selection_bucket_id, selection_file_path,
      provider_object_id, provider_version_id, acquired_by, acquired_at,
      idempotency_key, source_descriptor_json, status
    ) VALUES (
      ${acquisitionId}, ${input.fixture.sourceArtifactId},
      ${input.fixture.documentVersionId}, 'repository_real_fixture',
      ${input.fixture.workItemId}, 'repository-real-fixtures',
      ${input.fixture.workItemId}, ${input.fixture.workItemId},
      'accepted-real-fixture', ${input.actor}, NOW(),
      ${`IDEMP-${input.documentFamily}`}, '{}', 'COMMITTED'
    )
  `;
  await sql`
    INSERT INTO dm_publication_family (
      family_id, canonical_identity_key, document_family, issuer_authority,
      canonical_document_number, current_document_version_id,
      current_generation, status, created_at, updated_at
    ) VALUES (
      ${input.familyId}, ${`BOEING:${input.documentCode}`},
      ${input.documentFamily}, 'BOEING', ${input.documentCode},
      ${input.fixture.documentVersionId}, 1, 'ACTIVE', NOW(), NOW()
    )
  `;
  await sql`
    INSERT INTO dm_document_version (
      document_version_id, document_id, family_id, revision_id,
      canonical_revision_identity, business_revision, revision_date,
      source_generated_date, original_filename, source_artifact_id,
      acquisition_id, pdf_sha256, byte_length, media_type,
      lifecycle_status, committed_at, committed_by
    ) VALUES (
      ${input.fixture.documentVersionId}, ${input.fixture.documentId},
      ${input.familyId}, ${`revision_${input.documentFamily.toLowerCase()}`},
      ${`DATE:${input.revisionDate}`}, ${input.businessRevision},
      ${input.revisionDate}, ${input.revisionDate},
      ${`${input.documentCode}.pdf`}, ${input.fixture.sourceArtifactId},
      ${acquisitionId}, ${rawSha}, ${input.fixture.sourceByteLength},
      'application/pdf', 'COMMITTED_IMMUTABLE', NOW(), ${input.actor}
    )
  `;
  await sql`
    INSERT INTO dm_ingress_preflight (
      preflight_id, acquisition_id, decision, branch,
      execution_authorized, observed_current_generation,
      normalized_descriptor_json, decision_payload_json, status,
      document_version_id, commit_idempotency_key, created_at, committed_at
    ) VALUES (
      ${preflightId}, ${acquisitionId}, 'CREATE_FIRST_VERSION', 'CREATE',
      FALSE, 0, '{}', '{}', 'COMMITTED',
      ${input.fixture.documentVersionId},
      ${`COMMIT-${input.documentFamily}`}, NOW(), NOW()
    )
  `;
  await sql`
    INSERT INTO dm_currentness_decision (
      currentness_decision_id, family_id, next_document_version_id,
      previous_generation, next_generation, reason, decided_at,
      decided_by, preflight_id
    ) VALUES (
      ${`currentness_${input.documentFamily.toLowerCase()}`},
      ${input.familyId}, ${input.fixture.documentVersionId}, 0, 1,
      'INITIAL_VERSION', NOW(), ${input.actor}, ${preflightId}
    )
  `;
  const projection = {
    workItemId: input.fixture.workItemId,
    revision: input.workItemRevision,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    source: {
      documentId: input.fixture.documentId,
      documentVersionId: input.fixture.documentVersionId,
    },
    package: {
      packageId: input.fixture.packageId,
      sourceRefCount: input.fixture.sourceRefCount,
    },
  };
  await sql`
    INSERT INTO work_item (
      work_item_id, tenant_id, action_type, document_id,
      document_version_id, source_artifact_id, source_file_sha256,
      source_byte_length, normalized_family, request_id, status, revision,
      projection_json, package_id, requested_by_user_id
    ) VALUES (
      ${input.fixture.workItemId}, 'tenant-A', 'PARSE_PDF',
      ${input.fixture.documentId}, ${input.fixture.documentVersionId},
      ${input.fixture.sourceArtifactId}, ${rawSha},
      ${input.fixture.sourceByteLength}, ${input.documentFamily},
      ${`REQ-${input.documentFamily}-REAL`}, 'candidate_readback_verified',
      ${input.workItemRevision}, ${JSON.stringify(projection)},
      ${input.fixture.packageId}, ${input.actor}
    )
  `;
}

async function reserveActorService(actorId, tenantId = 'tenant-A') {
  const connection = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await connection.unsafe('SET ROLE authenticated');
    await connection`SELECT set_config('app.user_id', ${actorId}, false)`;
    const db = drizzle(connection);
    const workItems = new MiaodaWorkItemRepository(db);
    const objectAccess = new MiaodaHostedCanonicalObjectAccessAdapter(
      workItems,
    );
    const service = new EngineeringMatterService(
      new EngineeringMatterRepository(db),
      workItems,
      new MiaodaDocumentVersionSourceResolver(db),
      objectAccess,
    );
    const matters = new EngineeringMatterRepository(db);
    const sqlContext = new SqlExecutionContextMiddleware({
      roleSchema: 'wiselink_r10_test',
    });
    const working = new EngineeringMatterWorkingRepository(db, sqlContext, {
      roleSchema: 'wiselink_r10_test',
    });
    const workingService = new EngineeringMatterWorkingService(
      matters,
      working,
      workItems,
      new MiaodaDocumentVersionSourceResolver(db),
      objectAccess,
    );
    return {
      service,
      matters,
      working,
      workingService,
      database: db,
      // Hosted MCP does not guarantee an HTTP RequestContextService store.
      // Exercise the actual SDK SQL context without manufacturing that flag.
      runtime: (operation) =>
        new Promise((resolve, reject) => {
          sqlContext.use(
            {
              userContext: {
                userId: '-1',
                isSystemAccount: true,
                roles: [],
              },
            },
            {},
            () => {
              Promise.resolve().then(operation).then(resolve, reject);
            },
          );
        }),
      actor: actor(actorId, tenantId),
      async release() {
        await connection.unsafe('RESET ROLE');
        await connection.end({ timeout: 5 });
      },
    };
  } catch (error) {
    await connection.unsafe('RESET ROLE');
    await connection.end({ timeout: 5 });
    throw error;
  }
}

async function assertWorkingRevisionFlow(
  sql,
  owner,
  matterId,
  matterRevisionId,
) {
  const basis = await owner.workingService.resolveWorkingBasis(
    matterId,
    owner.actor,
  );
  const evidence = {
    evidenceRef: 'E-WORKING-1',
    title: 'FTD source passage',
    versionLabel: '2025-09-26',
    excerpt: 'The source-bound condition.',
    kind: 'DOCUMENT_PASSAGE',
    workItemId: basis.currentInputs[0].workItemId,
    documentVersionId: basis.currentInputs[0].documentVersionId,
    sourceRefId: 'SRC-WORKING-1',
    locator: 'page 1',
  };
  const claim = {
    claimId: `${matterId}:issue:source:claim:condition`,
    text: 'The engineering condition remains candidate-only.',
    basis: 'SOURCE_FACT',
    premises: [
      {
        evidenceRef: evidence.evidenceRef,
        role: 'SUPPORTS',
        explanation: 'Bound passage supports the claim.',
        limitation: null,
      },
    ],
  };
  const command = {
    requestId: 'REQ-MATTER-WORKING-INITIAL-1',
    expectedWorkingRevision: 0,
    basedOnMatterRevisionId: matterRevisionId,
    updateKind: 'INITIAL_SYNTHESIS',
    changeSummary: 'Create the initial candidate Matter reading.',
    nextFocus: {
      question: 'What does the linked evidence require?',
      targetRefs: ['candidate-engineering-scope'],
    },
    claimDelta: {
      changedBecause: 'Initial synthesis from the bounded source read.',
      additions: [claim],
      replacements: [],
      retirements: [],
      explicitlyUnchangedClaimIds: [],
    },
    openQuestionDelta: {
      upserts: [],
      retirements: [],
      explicitlyUnchangedItemIds: [],
    },
    reviewConditionDelta: {
      upserts: [],
      retirements: [],
      explicitlyUnchangedItemIds: [],
    },
    nextSubstantiveResult: {
      resultRef: 'MATTER-READING-1',
      resultRevision: 1,
      scope: { kind: 'ENGINEERING_MATTER', matterId },
      content: {
        schemaVersion: 'wiselink.3_1.assessment_reading.v1',
        headline: 'Candidate Matter reading',
        listBrief: 'Candidate finding',
        lead: 'A source-bound, non-adopted engineering reading.',
        claims: [claim],
        decisiveClaimIds: [claim.claimId],
      },
      evidence: [evidence],
      candidateOnly: true,
    },
    substantiveInputs: basis.currentInputs,
    coverageUpdates: basis.currentInputs.map((binding, index) => ({
      binding,
      contribution: 'SUBSTANTIVE',
      checkedSourceRefIds: [`SRC-WORKING-${index + 1}`],
      checkedScope: `bounded member source set ${index + 1}`,
      reason: 'Contributed to the candidate Matter reading.',
    })),
  };
  command.nextProblemWork = materializeJobAidWork(
    {
      schemaVersion: 'wiselink.jobaid-problem-work.v2',
      headline: command.nextSubstantiveResult.content.headline,
      listBrief: command.nextSubstantiveResult.content.listBrief,
      understanding: command.nextSubstantiveResult.content.lead,
      decisiveIssueKeys: ['source'],
      roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
      completionReason: '完成本轮来源核查，实际措施状态待确认。',
      changeSummary: command.changeSummary,
      unchangedExplanation: '保留完整条件。',
      issues: [
        {
          issueKey: 'source',
          question: '源条件意味着什么？',
          understanding: claim.text,
          statements: [
            {
              claimKey: 'condition',
              text: claim.text,
              basis: claim.basis,
              premises: claim.premises,
            },
          ],
          riskScenarios: [
            {
              scenario: '未确认条件下的风险',
              conditions: ['对象状态尚未确认'],
              method: 'JA_AC_R01',
              severity: null,
              likelihood: null,
              importantEvent: null,
              limitations: ['缺少对象数据'],
              controlComparison: '尚无法比较措施效果',
            },
          ],
          measures: [
            {
              text: '补充对象记录',
              addresses: '确认前提是否成立',
              limitations: ['尚未实施'],
              status: 'PROPOSED',
              basisRefs: [evidence.evidenceRef],
            },
          ],
          otherClassifications: [],
          openQuestions: [
            {
              question: '对象状态是什么？',
              affects: '适用范围',
              nextEvidence: '对象记录',
              reason: '当前尚未取得',
            },
          ],
          requirementHandling: [],
          sourceDependencies: [evidence.evidenceRef],
          premiseRefs: [],
        },
      ],
    },
    {
      matterId,
      previous: null,
      evidence: [evidence],
      readSourceRefs: [evidence.evidenceRef],
      capabilities: [],
      history: {
        required: false,
        priorAssessmentRefs: [],
        engineeringDocumentRefs: [],
        coverage: 'NOT_REQUIRED',
        limitation: null,
      },
    },
  );
  const uncoveredCommand = structuredClone(command);
  uncoveredCommand.nextProblemWork.evidence.push({
    ...structuredClone(evidence),
    evidenceRef: 'EVIDENCE-UNCOVERED-RISK',
    sourceRefId: 'SRC-UNCOVERED-RISK',
  });
  uncoveredCommand.nextProblemWork.readSourceRefs.push(
    'EVIDENCE-UNCOVERED-RISK',
  );
  await assert.rejects(
    owner.working.commit({
      tenantId: owner.actor.tenantId,
      actorUserId: owner.actor.userId,
      matterId,
      command: uncoveredCommand,
      currentInputs: basis.currentInputs,
      source: null,
    }),
    /ENGINEERING_MATTER_WORKING_PROBLEM_EVIDENCE_NOT_COVERED/u,
  );
  const commit = await owner.working.withTransaction(async (executor) => {
    const result = await executor.appendWorkingRevision({
      tenantId: owner.actor.tenantId,
      actorUserId: owner.actor.userId,
      matterId,
      command,
      currentInputs: basis.currentInputs,
      source: null,
    });
    // A separate real connection must be blocked even after append has
    // returned: member versions and owners stay pinned until COMMIT.
    for (const binding of basis.currentInputs.filter(
      (item) => item.workItemId !== null,
    )) {
      for (const mutation of ['revision', 'owner']) {
        await assert.rejects(
          attemptConcurrentMemberUpdate(sql, binding, mutation),
          (error) => error?.code === '55P03',
          `${binding.workItemId} ${mutation} must remain locked`,
        );
      }
    }
    return result;
  });
  const committed = {
    mutated: true,
    commit,
    working: await owner.workingService.readWorking(matterId, owner.actor),
  };
  // After COMMIT the same writes are allowed; each probe rolls back so the
  // replay/pending assertions below keep their original fixture identities.
  for (const binding of basis.currentInputs.filter(
    (item) => item.workItemId !== null,
  )) {
    await attemptConcurrentMemberUpdate(sql, binding, 'revision');
    await attemptConcurrentMemberUpdate(sql, binding, 'owner');
  }
  assert.equal(committed.mutated, true);
  assert.equal(committed.commit.replayed, false);
  assert.equal(committed.working.currentWorkingRevision, 1);
  assert.equal(
    committed.working.current.substantiveResultRef,
    'MATTER-READING-1',
  );
  assert.deepEqual(committed.working.pendingInputs, []);
  const exactInput = {
    tenantId: owner.actor.tenantId,
    matterId,
    actorUserId: owner.actor.userId,
    workRef: commit.revision.matterWorkRevisionId,
  };
  const exact = await owner.runtime(() =>
    owner.working.readByRefForRuntime(exactInput),
  );
  assert.deepEqual(exact.state.problemWork, command.nextProblemWork);
  const coverageOnly = materializeEngineeringMatterWorkingState({
    matterId,
    current: exact.state,
    command: {
      ...structuredClone(command),
      requestId: 'coverage-only-retained-full-work',
      expectedWorkingRevision: 1,
      updateKind: 'MATERIAL_INCORPORATION',
      nextFocus: null,
      nextSubstantiveResult: null,
      nextProblemWork: null,
      claimDelta: null,
      substantiveInputs: [],
      coverageUpdates: command.coverageUpdates.map((item) => ({
        ...structuredClone(item),
        checkedSourceRefIds: ['SRC-NEW-BOUNDED-READ'],
        contribution: 'NO_MATERIAL_CHANGE',
      })),
    },
  });
  assert.deepEqual(coverageOnly.state.problemWork, exact.state.problemWork);

  assert.equal(exact.state.problemWork.issues[0].riskScenarios[0].score, null);
  assert.deepEqual(
    await owner.workingService.readWorkingRevision(
      matterId,
      exactInput.workRef,
      owner.actor,
    ),
    exact,
  );
  assert.equal(
    await owner.runtime(() =>
      owner.working.readByRefForRuntime({
        ...exactInput,
        workRef: 'MWR-missing',
      }),
    ),
    null,
  );
  await assert.rejects(
    owner.runtime(() =>
      owner.working.readByRefForRuntime({
        ...exactInput,
        actorUserId: 'actor-B',
      }),
    ),
    /RUNTIME_AUTHORIZATION_UNAVAILABLE/u,
  );
  await assert.rejects(
    owner.runtime(() =>
      owner.working.readByRefForRuntime({
        ...exactInput,
        tenantId: 'tenant-B',
      }),
    ),
    /RUNTIME_AUTHORIZATION_UNAVAILABLE/u,
  );

  // A retained input can outlive its composition membership. Revoking that
  // input must reject the selected saved work, even when current links remain visible.
  const [storedWork] =
    await sql`SELECT state_json FROM engineering_matter_work_revision
    WHERE matter_work_revision_id = ${exactInput.workRef}`;
  const retainedState = JSON.parse(storedWork.state_json);
  const [retainedOwner] =
    await sql`SELECT requested_by_user_id, revision, document_version_id FROM work_item
    WHERE work_item_id = ${REQUEST_REUSE_WORK_ITEM_ID}`;
  retainedState.coverage.push({
    ...structuredClone(retainedState.coverage[0]),
    binding: {
      inputId: REQUEST_REUSE_WORK_ITEM_ID,
      workItemId: REQUEST_REUSE_WORK_ITEM_ID,
      workItemRevision: retainedOwner.revision,
      documentVersionId: retainedOwner.document_version_id,
      resultRef: null,
      resultRevision: null,
    },
  });
  await sql`UPDATE engineering_matter_work_revision SET state_json = ${JSON.stringify(retainedState)}
    WHERE matter_work_revision_id = ${exactInput.workRef}`;
  try {
    await sql`UPDATE work_item SET requested_by_user_id = 'actor-B'
      WHERE work_item_id = ${REQUEST_REUSE_WORK_ITEM_ID}`;
    await assert.rejects(
      owner.working.loadCurrent({ tenantId: owner.actor.tenantId, matterId }),
      /RUNTIME_AUTHORIZATION_UNAVAILABLE/u,
    );
    await assert.rejects(
      owner.workingService.readWorkingRevision(
        matterId,
        exactInput.workRef,
        owner.actor,
      ),
      /RUNTIME_AUTHORIZATION_UNAVAILABLE/u,
    );
    await assert.rejects(
      owner.runtime(() => owner.working.readByRefForRuntime(exactInput)),
      /RUNTIME_AUTHORIZATION_UNAVAILABLE/u,
    );
  } finally {
    await sql`UPDATE work_item SET requested_by_user_id = ${retainedOwner.requested_by_user_id}
      WHERE work_item_id = ${REQUEST_REUSE_WORK_ITEM_ID}`;
    await sql`UPDATE engineering_matter_work_revision SET state_json = ${storedWork.state_json}
      WHERE matter_work_revision_id = ${exactInput.workRef}`;
  }

  const replay = await owner.workingService.applyWorkingUpdate(
    matterId,
    command,
    owner.actor,
  );
  assert.equal(replay.commit.replayed, true);
  assert.equal(
    replay.commit.revision.matterWorkRevisionId,
    committed.commit.revision.matterWorkRevisionId,
  );

  await assert.rejects(
    owner.workingService.applyWorkingUpdate(
      matterId,
      { ...command, changeSummary: 'Mismatched replay.' },
      owner.actor,
    ),
    (error) =>
      error?.code === 'ENGINEERING_MATTER_WORKING_REQUEST_REPLAY_MISMATCH',
  );
  await assert.rejects(
    owner.workingService.applyWorkingUpdate(
      matterId,
      {
        ...command,
        requestId: 'REQ-MATTER-WORKING-LATE-1',
      },
      owner.actor,
    ),
    (error) => error?.code === 'ENGINEERING_MATTER_WORKING_CAS_CONFLICT',
  );
  const [rows] = await sql`
    SELECT count(*)::int AS revision_count
    FROM engineering_matter_work_revision
    WHERE matter_id = ${matterId}
  `;
  assert.equal(rows.revision_count, 1);
}

async function assertMatterLeaseLifecycle(sql, owner, matterId) {
  const service = new MatterActionAttemptService(owner.working, {
    captureForNewTask: async (_tenant, now) =>
      taskModelSelection(CANONICAL_INITIAL_MODEL_REF, now),
  });
  const scope = { tenantId: 'tenant-A', actorUserId: 'actor-A', matterId };
  const basis = await owner.workingService.resolveWorkingBasis(
    matterId,
    owner.actor,
  );
  const input = {
    ...scope,
    idempotencyKey: 'matter-lease-test',
    expectedMatterRevisionId: basis.snapshot.currentMatterRevisionId,
    expectedMatterRevision: basis.snapshot.currentRevisionNo,
    expectedWorkingRevision: basis.working.workingRevision,
    trigger: {
      kind: 'USER_REQUEST',
      requestId: 'request-lease',
      instruction: '复核边界',
    },
    modelInput: { testOnly: 'lease transaction fixture' },
    sourceRefs: [],
  };
  const reservation = await owner.runtime(() => service.reserve(input));
  assert.equal(reservation.row.workItemId, null);
  assert.equal(reservation.created, true);
  const replay = await owner.runtime(() => service.reserve(input));
  assert.equal(replay.created, false);
  assert.equal(replay.task.operationRef, reservation.task.operationRef);
  await assert.rejects(
    owner.runtime(() =>
      service.reserve({ ...input, modelInput: { changed: true } }),
    ),
    /IDEMPOTENCY_REPLAY_MISMATCH/u,
  );
  const claimInput = {
    ...scope,
    attemptRef: reservation.task.operationRef,
    principalId: 'hosted-test',
  };
  // Occupy slot zero with an existing WorkItem execution, exercising the
  // same tenant-wide pool and rollback-to-savepoint behavior.
  await sql`INSERT INTO action_attempt (attempt_id, work_item_id, action_type,
    actor_user_id, tenant_id, status, lease_slot, lease_token)
    VALUES ('ATT-SLOT-ZERO', ${FTD_WORK_ITEM_ID}, 'OPENCLAW_TRANSLATE', 'actor-A', 'tenant-A', 'RUNNING', 0, 'slot-zero')`;
  const lease = await owner.runtime(() => service.claim(claimInput));
  assert.equal(lease.status, 'RUNNING');
  const read = await owner.runtime(() => service.read(claimInput));
  assert.equal(read.leaseSlot, 1);
  assert.equal(read.claimCount, 1);
  assert.equal(
    (await owner.runtime(() => service.claim(claimInput))).leaseToken,
    lease.leaseToken,
  );
  await assert.rejects(
    owner.runtime(() =>
      service.claim({ ...claimInput, actorUserId: 'actor-B' }),
    ),
  );
  await assert.rejects(
    owner.runtime(() =>
      service.heartbeat({ ...claimInput, ...lease, leaseGeneration: 99 }),
    ),
    /LEASE_FENCE_REJECTED/u,
  );
  await owner.runtime(() => service.heartbeat({ ...claimInput, ...lease }));
  const cancelled = await owner.runtime(() =>
    service.cancel({ ...claimInput, reason: 'fixture cancelled' }),
  );
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.leaseSlot, null);
  await assert.rejects(
    owner.runtime(() => service.claim(claimInput)),
    /CANCELLED/u,
  );
  assert.equal(
    (await owner.runtime(() => service.reserve(input))).created,
    false,
    'cancelled exact request is not silently re-created',
  );
  const successor = await owner.runtime(() =>
    service.reserve({ ...input, idempotencyKey: 'matter-lease-successor' }),
  );
  await sql`UPDATE action_attempt SET deadline_at = now() - interval '1 minute'
    WHERE attempt_id = ${successor.row.attemptId}`;
  await assert.rejects(
    owner.runtime(() =>
      service.claim({ ...claimInput, attemptRef: successor.task.operationRef }),
    ),
    /TIMED_OUT/u,
  );
  assert.equal(
    (
      await owner.runtime(() =>
        service.read({
          ...claimInput,
          attemptRef: successor.task.operationRef,
        }),
      )
    ).status,
    'TIMED_OUT',
    'planned terminalization survives the caller-facing error',
  );
  const retriable = await owner.runtime(() =>
    service.reserve({ ...input, idempotencyKey: 'matter-lease-recovery' }),
  );
  const retryInput = { ...claimInput, attemptRef: retriable.task.operationRef };
  const oldLease = await owner.runtime(() => service.claim(retryInput));
  await sql`UPDATE action_attempt SET lease_expires_at = now() - interval '1 minute'
    WHERE attempt_id = ${retriable.row.attemptId}`;
  const newLease = await owner.runtime(() => service.claim(retryInput));
  assert.equal(newLease.leaseGeneration, oldLease.leaseGeneration + 1);
  assert.notEqual(newLease.leaseToken, oldLease.leaseToken);
  await assert.rejects(
    owner.runtime(() => service.heartbeat({ ...retryInput, ...oldLease })),
    /LEASE_FENCE_REJECTED/u,
  );
  await sql`UPDATE action_attempt SET deadline_at = now() - interval '1 minute'
    WHERE attempt_id = ${retriable.row.attemptId}`;
  await assert.rejects(
    owner.runtime(() => service.claim(retryInput)),
    /TIMED_OUT/u,
  );
  assert.equal(
    (await owner.runtime(() => service.read(retryInput))).status,
    'TIMED_OUT',
  );
  await assertMatterCommitRecovery(sql, owner, service, input);
  await assertSaveBeforeFinish(sql, owner, service, input);
}

async function assertRealMatterAttemptSave(sql, owner, matterId) {
  const basis = await owner.workingService.resolveWorkingBasis(
    matterId,
    owner.actor,
  );
  const source = {
    kind: 'ENGINEERING_MATTER',
    actionAttemptId: 'ATT-REAL-MATTER-SAVE',
    reviewTurnId: null,
  };
  const command = {
    requestId: 'REQ-REAL-MATTER-SAVE',
    expectedWorkingRevision: basis.working.workingRevision,
    basedOnMatterRevisionId: basis.snapshot.currentMatterRevisionId,
    updateKind: 'CORRECTION',
    changeSummary: '保留完整问题工作，更新本轮关注范围。',
    nextFocus: {
      ...basis.working.state.focus,
      question: '复核保存的事项工作与适用边界。',
    },
    claimDelta: null,
    openQuestionDelta: null,
    reviewConditionDelta: null,
    nextSubstantiveResult: null,
    substantiveInputs: [],
    coverageUpdates: [],
  };
  const attempts = new MatterActionAttemptService(owner.working, {
    captureForNewTask: async (_tenant, now) =>
      taskModelSelection(CANONICAL_INITIAL_MODEL_REF, now),
  });
  const reserved = await owner.runtime(() =>
    attempts.reserveJobAid({
      tenantId: 'tenant-A',
      matterId,
      actorUserId: owner.actor.userId,
      idempotencyKey: 'real-matter-save-binding',
      expectedMatterRevisionId: command.basedOnMatterRevisionId,
      expectedMatterRevision: basis.snapshot.currentRevisionNo,
      expectedWorkingRevision: command.expectedWorkingRevision,
      trigger: {
        kind: 'USER_REQUEST',
        requestId: 'real-matter-save-binding',
        instruction: '测试真实来源保存',
      },
    }),
  );
  assert.equal(reserved.task.modelInput.schemaVersion, 'wiselink.matter-jobaid-task.v2');
  assert.equal(reserved.task.modelInput.modelInput.subject.matterId, matterId);
  assert.equal(reserved.task.modelInput.modelInput.previousWork.workRevisionRef, basis.working.matterWorkRevisionId);
  assert.deepEqual(reserved.task.modelInput.modelInput.availableDocuments.map(item => item.documentVersionId).sort(),
    [...new Set(reserved.task.workingBasis.inputs.map(item => item.documentVersionId))].sort());
  assert.equal('workItemId' in reserved.task.modelInput.modelInput.subject, false);
  source.actionAttemptId = reserved.row.attemptId;
  command.requestId = reserved.row.triggerRequestId;
  const save = (candidate = command, candidateSource = source) =>
    owner.runtime(() =>
      owner.working.withActorTransaction(
        owner.actor.userId,
        async (executor) => {
          await executor.authorizeRuntimeInputs({
            tenantId: 'tenant-A',
            matterId,
            actorUserId: owner.actor.userId,
          });
          return executor.appendWorkingRevision({
            tenantId: 'tenant-A',
            matterId,
            actorUserId: owner.actor.userId,
            command: candidate,
            currentInputs: basis.currentInputs,
            source: candidateSource,
          });
        },
      ),
    );
  const rlsDenied = (error) =>
    error.cause?.code === '42501' ||
    error.code === '42501' ||
    error.code === 'ENGINEERING_MATTER_WORKING_SOURCE_INVALID';
  await assert.rejects(save(), rlsDenied, 'QUEUED is not a durable commit');
  await sql`UPDATE action_attempt SET status = 'COMMITTING' WHERE attempt_id = ${source.actionAttemptId}`;
  await assert.rejects(
    save(),
    rlsDenied,
    'status alone is not a durable result',
  );
  await sql`UPDATE action_attempt SET commit_started_at = now(), result_content_hash = ${'a'.repeat(64)},
    result_envelope_json = ${JSON.stringify({ schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v2', status: 'SUCCEEDED' })}
    WHERE attempt_id = ${source.actionAttemptId}`;
  await assert.rejects(
    save({ ...command, requestId: 'REQ-WRONG-MATTER-SAVE' }),
    rlsDenied,
  );
  await sql`UPDATE action_attempt SET base_revision = 0 WHERE attempt_id = ${source.actionAttemptId}`;
  await assert.rejects(
    save(),
    rlsDenied,
    'Matter working CAS belongs to this attempt',
  );
  await sql`UPDATE action_attempt SET base_revision = ${command.expectedWorkingRevision} WHERE attempt_id = ${source.actionAttemptId}`;
  await sql`INSERT INTO review_turn(review_turn_id) VALUES ('RT-FAKE-MATTER-SAVE')`;
  await assert.rejects(
    owner.workingService.applyWorkingUpdate(matterId, command, owner.actor, {
      source: {
        actionAttemptId: source.actionAttemptId,
        reviewTurnId: 'RT-FAKE-MATTER-SAVE',
      },
    }),
    rlsDenied,
    'native broad policy cannot disguise a real Matter attempt as a ReviewTurn',
  );
  const saved = await save();
  assert.equal(saved.replayed, false);
  assert.deepEqual(saved.revision.source, source);
  assert.deepEqual(
    saved.revision.state.problemWork,
    basis.working.state.problemWork,
  );
  const readBySource = await owner.working.findBySource({
    tenantId: 'tenant-A',
    matterId,
    source,
  });
  assert.equal(
    readBySource.matterWorkRevisionId,
    saved.revision.matterWorkRevisionId,
  );
  await sql`UPDATE action_attempt SET status = 'SUCCEEDED' WHERE attempt_id = ${source.actionAttemptId}`;
  const recovered = await save();
  assert.equal(recovered.replayed, true);
  assert.equal(
    recovered.revision.matterWorkRevisionId,
    saved.revision.matterWorkRevisionId,
  );
}

async function assertReviewScopeIsImmutable(sql) {
  await sql`
    INSERT INTO review_turn (review_turn_id, review_scope_json)
    VALUES (
      'RT-R10-SCOPE-GUARD',
      ${sql.json({ kind: 'ENGINEERING_MATTER', matterId: 'MAT-SCOPE' })}
    )
  `;
  await assert.rejects(
    sql`
      UPDATE review_turn
      SET review_scope_json = ${sql.json({
        kind: 'ENGINEERING_MATTER',
        matterId: 'MAT-CHANGED',
      })}
      WHERE review_turn_id = 'RT-R10-SCOPE-GUARD'
    `,
    (error) => error?.message?.includes('REVIEW_TURN_R10_SCOPE_IMMUTABLE'),
  );
}

async function attemptConcurrentMemberUpdate(sql, binding, mutation) {
  const rollbackProbe = new Error('ROLLBACK_MEMBER_LOCK_PROBE');
  try {
    await sql.begin(async (transaction) => {
      await transaction.unsafe("SET LOCAL lock_timeout = '150ms'");
      const rows =
        mutation === 'revision'
          ? await transaction`
            UPDATE work_item SET revision = revision + 1
            WHERE work_item_id = ${binding.workItemId}
              AND revision = ${binding.workItemRevision}
            RETURNING work_item_id
          `
          : await transaction`
            UPDATE work_item SET requested_by_user_id = 'actor-B'
            WHERE work_item_id = ${binding.workItemId}
              AND requested_by_user_id = 'actor-A'
            RETURNING work_item_id
          `;
      assert.equal(rows.length, 1);
      throw rollbackProbe;
    });
  } catch (error) {
    if (error !== rollbackProbe) throw error;
  }
}

function actor(userId, tenantId = 'tenant-A') {
  const objectAccessActor = {
    principalKind: 'FINAL_USER',
    transport: 'MIAODA_AUTHENTICATED_HTTP',
    canonicalSubject: { namespace: 'MIAODA_USER_ID', id: userId },
    subjectDecision: {
      source: 'MIAODA_GATEWAY_USER_CONTEXT',
      applicationScopeId: 'app_17bzc551rsg',
      tenantId,
      version: 'miaoda-hosted-native-sso.v1',
      decidedAt: '2026-08-30T00:00:00.000Z',
    },
    tenantId,
    applicationScopeId: 'app_17bzc551rsg',
    applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
    workspaceId: null,
    workspaceProvenance: 'UNAVAILABLE',
    env: 'runtime',
    platformRoles: [],
    identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
    feishuUserId: null,
    feishuOpenId: null,
    feishuIdentityProvenance: 'UNAVAILABLE',
    sessionId: null,
    sessionRevision: null,
    sessionProvenance: 'UNAVAILABLE',
  };
  return {
    userId,
    tenantId,
    appId: 'app_17bzc551rsg',
    roles: [],
    env: 'runtime',
    objectAccessActor,
  };
}

async function assertLinkReplayMismatchAndCasConflict(owner, matterId) {
  await assert.rejects(
    owner.service.linkWorkItem(
      matterId,
      {
        requestId: 'REQ-MATTER-LINK-REAL-SB-1',
        expectedMatterRevision: 1,
        workItemId: SB_WORK_ITEM_ID,
        changeSummary: 'Same request id but different summary.',
      },
      owner.actor,
    ),
    (error) => error?.code === 'ENGINEERING_MATTER_REQUEST_REPLAY_MISMATCH',
  );
  await assert.rejects(
    owner.service.linkWorkItem(
      matterId,
      {
        requestId: 'REQ-MATTER-STALE-CAS',
        expectedMatterRevision: 1,
        workItemId: REQUEST_REUSE_WORK_ITEM_ID,
      },
      owner.actor,
    ),
    (error) => error?.code === 'ENGINEERING_MATTER_CAS_CONFLICT',
  );
}

async function assertAlreadyLinkedRequestReuse(sql, owner, matterId) {
  const requestId = 'REQ-MATTER-ALREADY-LINKED-THEN-NEW';
  await assert.rejects(
    owner.service.linkWorkItem(
      matterId,
      {
        requestId,
        expectedMatterRevision: 2,
        workItemId: SB_WORK_ITEM_ID,
      },
      owner.actor,
    ),
    (error) =>
      error?.code === 'ENGINEERING_MATTER_WORK_ITEM_ALREADY_LINKED' &&
      error?.statusCode === 409,
  );
  const [failedReadback] = await sql`
    SELECT
      matter.current_revision_no,
      count(revision.matter_revision_id)::int AS request_revision_count
    FROM engineering_matter AS matter
    LEFT JOIN engineering_matter_revision AS revision
      ON revision.matter_id = matter.matter_id
      AND revision.request_id = ${requestId}
    WHERE matter.matter_id = ${matterId}
    GROUP BY matter.current_revision_no
  `;
  assert.deepEqual(failedReadback, {
    current_revision_no: 2,
    request_revision_count: 0,
  });

  const input = {
    requestId,
    expectedMatterRevision: 2,
    workItemId: REQUEST_REUSE_WORK_ITEM_ID,
    changeSummary: 'Link the request-id regression WorkItem.',
  };
  const linked = await owner.service.linkWorkItem(matterId, input, owner.actor);
  assert.equal(linked.linked, true);
  assert.equal(linked.replayed, false);
  assert.equal(linked.matter.currentRevision.revisionNo, 3);

  const replayed = await owner.service.linkWorkItem(
    matterId,
    input,
    owner.actor,
  );
  assert.equal(replayed.linked, false);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.matter.currentRevision.revisionNo, 3);

  await assert.rejects(
    owner.service.linkWorkItem(
      matterId,
      { ...input, changeSummary: 'Changed after successful request.' },
      owner.actor,
    ),
    (error) => error?.code === 'ENGINEERING_MATTER_REQUEST_REPLAY_MISMATCH',
  );
  const [successfulReadback] = await sql`
    SELECT revision_no, changed_work_item_id, change_summary
    FROM engineering_matter_revision
    WHERE matter_id = ${matterId} AND request_id = ${requestId}
  `;
  assert.deepEqual(successfulReadback, {
    revision_no: 3,
    changed_work_item_id: REQUEST_REUSE_WORK_ITEM_ID,
    change_summary: input.changeSummary,
  });
}

async function advanceOwnerWorkItemCurrent(sql) {
  await sql`
    UPDATE work_item
    SET revision = 5,
        projection_json = jsonb_set(
          projection_json::jsonb,
          '{revision}',
          '5'::jsonb
        )::text
    WHERE work_item_id = ${FTD_WORK_ITEM_ID}
  `;
}

async function assertUnauthorizedLinkRollsBack(sql, owner, matterId) {
  await assert.rejects(
    owner.service.linkWorkItem(
      matterId,
      {
        requestId: 'REQ-MATTER-UNAUTHORIZED-LINK',
        expectedMatterRevision: 2,
        workItemId: 'WI-OTHER-ACTOR',
      },
      owner.actor,
    ),
    (error) => error?.code === 'CANONICAL_WORK_ITEM_NOT_FOUND',
  );
  const [readback] = await sql`
    SELECT
      current_revision_no,
      (SELECT count(*)::int FROM engineering_matter_revision
        WHERE matter_id = ${matterId}) AS revision_count
    FROM engineering_matter WHERE matter_id = ${matterId}
  `;
  assert.deepEqual(readback, { current_revision_no: 2, revision_count: 2 });
}

async function assertSecurityDefinerAndDirectRlsDenials(sql, matterId) {
  const functions = await sql`
    SELECT
      procedure.proname,
      procedure.prosecdef,
      pg_get_userbyid(procedure.proowner) AS function_owner,
      pg_get_userbyid(relation.relowner) AS table_owner,
      procedure.prorettype = 'boolean'::regtype AS returns_boolean,
      procedure.proconfig,
      coalesce(procedure.proacl::text, '') AS acl
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_class AS relation
      ON relation.relname = 'engineering_matter'
      AND relation.relnamespace = namespace.oid
    WHERE namespace.nspname = 'public'
      AND (
        procedure.proname LIKE 'engineering_matter_%_by_actor'
        OR procedure.proname = 'engineering_matter_actor_has_tenant'
      )
    ORDER BY procedure.proname
  `;
  assert.equal(functions.length, 7);
  for (const fn of functions) {
    assert.equal(fn.prosecdef, true, fn.proname);
    assert.equal(fn.returns_boolean, true, fn.proname);
    assert.equal(fn.function_owner, fn.table_owner, fn.proname);
    assert.deepEqual(fn.proconfig, ['search_path=public']);
    assert.equal(/(?:^\{|,)=X\//u.test(fn.acl), false, fn.proname);
    assert.equal(fn.acl.includes('authenticated=X/'), true, fn.proname);
  }

  const [current] = await sql`
    SELECT current_matter_revision_id
    FROM engineering_matter WHERE matter_id = ${matterId}
  `;
  await asActorSql('actor-A', async (actorSql) => {
    const [denials] = await actorSql`
      SELECT
        engineering_matter_actor_has_tenant('tenant-B') AS cross_tenant,
        engineering_matter_work_item_owned_by_actor(
          'tenant-A', 'WI-OTHER-ACTOR'
        ) AS third_work_item
    `;
    assert.deepEqual(denials, {
      cross_tenant: false,
      third_work_item: false,
    });
    await assert.rejects(
      actorSql`
        INSERT INTO engineering_matter_revision_work_item (
          matter_revision_id, matter_id, tenant_id, work_item_id,
          ordinal, relation_role, linked_at_work_item_revision
        ) VALUES (
          ${current.current_matter_revision_id}, ${matterId}, 'tenant-A',
          'WI-OTHER-ACTOR', 99, 'RELATED', 0
        )
      `,
      (error) => databaseCode(error) === '42501',
    );
  });

  await asActorSql('actor-B', async (actorSql) => {
    const [denials] = await actorSql`
      SELECT
        engineering_matter_owned_by_actor(
          'tenant-A', ${matterId}
        ) AS matter_owner,
        engineering_matter_work_item_owned_by_actor(
          'tenant-A', ${FTD_WORK_ITEM_ID}
        ) AS primary_work_item,
        engineering_matter_all_links_owned_by_actor(
          'tenant-A', ${current.current_matter_revision_id}
        ) AS all_links,
        (SELECT count(*)::int FROM engineering_matter) AS visible_matters
    `;
    assert.deepEqual(denials, {
      matter_owner: false,
      primary_work_item: false,
      all_links: false,
      visible_matters: 0,
    });
    const [workingVisibility] = await actorSql`
      SELECT count(*)::int AS visible_work_revisions
      FROM engineering_matter_work_revision
      WHERE matter_id = ${matterId}
    `;
    assert.deepEqual(workingVisibility, { visible_work_revisions: 0 });
  });

  await asActorSql('actor-C', async (actorSql) => {
    const [denials] = await actorSql`
      SELECT
        engineering_matter_actor_has_tenant('tenant-A') AS tenant_a,
        engineering_matter_actor_has_tenant('tenant-B') AS tenant_b
    `;
    assert.deepEqual(denials, { tenant_a: false, tenant_b: true });
  });
}

async function asActorSql(actorId, action) {
  const actorSql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await actorSql.unsafe('SET ROLE authenticated');
    await actorSql`SELECT set_config('app.user_id', ${actorId}, false)`;
    return await action(actorSql);
  } finally {
    await actorSql.unsafe('RESET ROLE');
    await actorSql.end({ timeout: 5 });
  }
}

function databaseCode(error) {
  return String(error?.code ?? error?.cause?.code ?? '');
}

function assertBrowserSafe(readModel) {
  assert.equal(
    readModel.schemaVersion,
    'wiselink.3_1.engineering_matter_catalog.v1',
  );
  assert.deepEqual(readModel.authorization, {
    policy: 'ALL_LINKED_WORK_ITEMS_REQUIRED',
    authorizedWorkItemCount: 2,
  });
  assert.deepEqual(readModel.authority, {
    workItemCurrentRemainsAuthoritative: true,
    documentManagementRemainsAuthoritative: true,
    sourceRefsRemainWorkItemScoped: true,
    matterCreatesAssessmentCurrent: false,
  });
  const serialized = JSON.stringify(readModel);
  for (const forbidden of [
    'tenant-A',
    'actor-A',
    'tenantId',
    'actorUserId',
    'packageId',
    'artifactRef',
    'artifactSha256',
    'sourceArtifactId',
    'sourceFileSha256',
    'packageArtifactSha256',
    'bucketId',
    'filePath',
    'permissionSnapshotVersion',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(/sha256:[0-9a-f]{64}/u.test(serialized), false, 'sha256');
}

async function assertMatterHistory(sql) {
  const revisions = await sql`
    SELECT revision_no, change_kind, changed_work_item_id
    FROM engineering_matter_revision ORDER BY revision_no
  `;
  assert.deepEqual(
    [...revisions],
    [
      {
        revision_no: 1,
        change_kind: 'CREATED',
        changed_work_item_id: FTD_WORK_ITEM_ID,
      },
      {
        revision_no: 2,
        change_kind: 'WORK_ITEM_LINKED',
        changed_work_item_id: SB_WORK_ITEM_ID,
      },
      {
        revision_no: 3,
        change_kind: 'WORK_ITEM_LINKED',
        changed_work_item_id: REQUEST_REUSE_WORK_ITEM_ID,
      },
    ],
  );
  const snapshots = await sql`
    SELECT revision_no, count(*)::int AS linked_work_item_count
    FROM engineering_matter_revision AS revision
    JOIN engineering_matter_revision_work_item AS link
      ON link.matter_revision_id = revision.matter_revision_id
    GROUP BY revision_no ORDER BY revision_no
  `;
  assert.deepEqual(
    [...snapshots],
    [
      { revision_no: 1, linked_work_item_count: 1 },
      { revision_no: 2, linked_work_item_count: 2 },
      { revision_no: 3, linked_work_item_count: 3 },
    ],
  );
}

async function assertMatterCommitRecovery(sql, owner, service, baseInput) {
  const reserved = await owner.runtime(() =>
    service.reserve({ ...baseInput, idempotencyKey: 'matter-durable-commit' }),
  );
  const scope = {
    tenantId: baseInput.tenantId,
    matterId: baseInput.matterId,
    actorUserId: baseInput.actorUserId,
  };
  const claimInput = {
    ...scope,
    attemptRef: reserved.task.operationRef,
    principalId: 'hosted-test',
  };
  const lease = await owner.runtime(() => service.claim(claimInput));
  const fence = {
    ...claimInput,
    leaseToken: lease.leaseToken,
    leaseGeneration: lease.leaseGeneration,
  };
  const result = matterResult(lease.task);
  await assert.rejects(
    owner.runtime(() =>
      service.prepareCommit({ ...fence, leaseGeneration: 99, result }),
    ),
    /LEASE_FENCE_REJECTED/u,
  );
  const prepared = await owner.runtime(() =>
    service.prepareCommit({ ...fence, result }),
  );
  assert.equal(prepared.row.status, 'COMMITTING');
  assert.equal(prepared.recovery, false);
  assert.equal(
    (await owner.runtime(() => service.prepareCommit({ ...fence, result })))
      .recovery,
    true,
  );
  const { contentHash: _hash, ...body } = result;
  await assert.rejects(
    owner.runtime(() =>
      service.prepareCommit({
        ...fence,
        result: sealMatterResultEnvelope({
          ...body,
          modelOutput: '{"different":true}',
        }),
      }),
    ),
    /REPLAY_MISMATCH/u,
  );
  const recovery = await owner.runtime(() => service.claim(claimInput));
  assert.equal(recovery.status, 'COMMITTING');
  assert.deepEqual(recovery.recoveryResult, result);
  await assert.rejects(
    owner.runtime(() =>
      service.claim({ ...claimInput, principalId: 'other-principal' }),
    ),
    /LEASE_OWNER_MISMATCH/u,
  );
  await assert.rejects(
    owner.runtime(() => service.cancel({ ...claimInput, reason: 'too late' })),
    /CANCEL_TOO_LATE/u,
  );
  await assert.rejects(
    owner.runtime(() => service.finish(fence)),
    /WORK_NOT_SAVED/u,
  );
  await sql`UPDATE action_attempt SET lease_expires_at = now() - interval '1 minute', deadline_at = now() - interval '1 minute'
    WHERE attempt_id = ${prepared.row.attemptId}`;
  assert.equal(
    (await owner.runtime(() => service.claim(claimInput))).status,
    'COMMITTING',
  );
  const basis = await owner.workingService.resolveWorkingBasis(
    scope.matterId,
    owner.actor,
  );
  const command = {
    requestId: prepared.row.triggerRequestId,
    expectedWorkingRevision: prepared.task.baseRevision,
    basedOnMatterRevisionId: prepared.task.subject.matterRevisionId,
    updateKind: 'CORRECTION',
    changeSummary: '隔离测试：持久结果恢复保存。',
    nextFocus: {
      ...basis.working.state.focus,
      question: '核对候选持久化后的读取。',
    },
    claimDelta: null,
    openQuestionDelta: null,
    reviewConditionDelta: null,
    nextSubstantiveResult: null,
    substantiveInputs: [],
    coverageUpdates: [],
  };
  const saved = await owner.runtime(() =>
    owner.working.withActorTransaction(scope.actorUserId, (executor) =>
      executor.appendWorkingRevision({
        ...scope,
        command,
        currentInputs: basis.currentInputs,
        source: {
          kind: 'ENGINEERING_MATTER',
          actionAttemptId: prepared.row.attemptId,
          reviewTurnId: null,
        },
      }),
    ),
  );
  const finished = await owner.runtime(() => service.finish(fence));
  assert.equal(finished.row.status, 'SUCCEEDED');
  assert.equal(finished.row.projectionApplied, false);
  assert.equal(finished.row.leaseSlot, null);
  assert.equal(
    finished.work.matterWorkRevisionId,
    saved.revision.matterWorkRevisionId,
  );
  const replay = await owner.runtime(() => service.finish(fence));
  assert.equal(replay.recovered, true);
  assert.equal(
    replay.work.matterWorkRevisionId,
    finished.work.matterWorkRevisionId,
  );
  assert.equal(
    (await owner.runtime(() => service.prepareCommit({ ...fence, result }))).row
      .status,
    'SUCCEEDED',
  );
  for (const status of ['WAITING_INPUT', 'FAILED']) {
    const next = await owner.runtime(() =>
      service.reserve({
        ...baseInput,
        expectedWorkingRevision: finished.work.workingRevision,
        idempotencyKey: `matter-terminal-${status}`,
      }),
    );
    const nextScope = { ...claimInput, attemptRef: next.task.operationRef };
    const claimed = await owner.runtime(() => service.claim(nextScope));
    const terminal = await owner.runtime(() =>
      service.prepareCommit({
        ...nextScope,
        leaseToken: claimed.leaseToken,
        leaseGeneration: claimed.leaseGeneration,
        result: matterResult(claimed.task, status),
      }),
    );
    assert.equal(terminal.row.status, status);
    assert.equal(terminal.row.leaseSlot, null);
    assert.equal(
      (await owner.working.loadCurrent(scope)).workingRevision,
      finished.work.workingRevision,
    );
  }
  const racing = await owner.runtime(() =>
    service.reserve({
      ...baseInput,
      expectedWorkingRevision: finished.work.workingRevision,
      idempotencyKey: 'matter-working-cas-race',
    }),
  );
  const racingScope = { ...claimInput, attemptRef: racing.task.operationRef };
  const racingLease = await owner.runtime(() => service.claim(racingScope));
  await owner.workingService.applyWorkingUpdate(
    scope.matterId,
    {
      ...command,
      requestId: 'REQ-MANUAL-WORK-BEFORE-MATTER-COMMIT',
      expectedWorkingRevision: finished.work.workingRevision,
      nextFocus: {
        ...command.nextFocus,
        question: '用户更新后的事项关注范围。',
      },
    },
    owner.actor,
  );
  await assert.rejects(
    owner.runtime(() =>
      service.prepareCommit({
        ...racingScope,
        leaseToken: racingLease.leaseToken,
        leaseGeneration: racingLease.leaseGeneration,
        result: matterResult(racingLease.task),
      }),
    ),
    /MATTER_WORKING_REVISION_CHANGED_BEFORE_COMMIT/u,
  );
  assert.equal(
    (await owner.runtime(() => service.read(racingScope))).status,
    'CONFLICT',
  );
  assert.equal(
    (await owner.working.loadCurrent(scope)).workingRevision,
    finished.work.workingRevision + 1,
  );
}

function matterResult(task, status = 'SUCCEEDED') {
  return sealMatterResultEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v2',
    actionAttemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    taskType: task.taskType,
    subject: task.subject,
    baseRevision: task.baseRevision,
    status,
    businessOutcome:
      status === 'SUCCEEDED'
        ? 'CANDIDATE_READY'
        : status === 'WAITING_INPUT'
          ? 'WAITING_INPUT'
          : 'NOT_PRODUCED',
    candidateStatus: status === 'WAITING_INPUT' ? 'WAITING_INPUT' : null,
    modelOutput: status === 'SUCCEEDED' ? '{"isolatedCandidate":true}' : null,
    outputArtifactRefs: [],
    sourceRefs: task.sourceRefs,
    factsConsidered: [],
    missingInputs:
      status === 'WAITING_INPUT'
        ? [{ code: 'MISSING_RECORD', message: '缺少对象记录。' }]
        : [],
    conflicts: [],
    warnings: [],
    modelVersion: 'isolated-fixture',
    promptVersion: 'isolated-fixture',
    skillVersion: 'isolated-fixture',
    toolVersions: {},
    runMetrics: { durationMs: 1, inputUnits: 1, outputUnits: 1 },
    errorCode: status === 'FAILED' ? 'FIXTURE_FAILED' : null,
    errorDetail: status === 'FAILED' ? 'isolated failure' : null,
  });
}

async function assertSaveBeforeFinish(sql, owner, service, baseInput) {
  const basis = await owner.workingService.resolveWorkingBasis(
    baseInput.matterId,
    owner.actor,
  );
  const scope = {
    tenantId: baseInput.tenantId,
    matterId: baseInput.matterId,
    actorUserId: baseInput.actorUserId,
  };
  const reserved = await owner.runtime(() =>
    service.reserve({
      ...baseInput,
      expectedWorkingRevision: basis.working.workingRevision,
      idempotencyKey: 'save-before-finish',
    }),
  );
  const claimInput = {
    ...scope,
    attemptRef: reserved.task.operationRef,
    principalId: 'hosted-test',
  };
  const firstLease = await owner.runtime(() => service.claim(claimInput));
  let fence = {
    ...claimInput,
    leaseToken: firstLease.leaseToken,
    leaseGeneration: firstLease.leaseGeneration,
  };
  const command = {
    requestId: 'SAVE-DRAFT-FIRST',
    expectedWorkingRevision: basis.working.workingRevision,
    basedOnMatterRevisionId: reserved.task.subject.matterRevisionId,
    updateKind: 'CORRECTION',
    changeSummary: '保存本轮第一份工作。',
    nextFocus: {
      ...basis.working.state.focus,
      question: '第一份候选工作关注范围。',
    },
    claimDelta: null,
    openQuestionDelta: null,
    reviewConditionDelta: null,
    nextSubstantiveResult: null,
    substantiveInputs: [],
    coverageUpdates: [],
  };
  await assert.rejects(
    owner.runtime(() =>
      service.saveWorkingDraft({ ...fence, leaseGeneration: 99, command }),
    ),
    /LEASE_FENCE_REJECTED/u,
  );
  const first = await owner.runtime(() =>
    service.saveWorkingDraft({ ...fence, command }),
  );
  assert.equal(
    (await owner.runtime(() => service.read(claimInput))).status,
    'RUNNING',
  );
  assert.equal(
    (
      await owner.runtime(() =>
        service.readSavedWork({ ...claimInput, requestId: command.requestId }),
      )
    ).matterWorkRevisionId,
    first.revision.matterWorkRevisionId,
  );
  await sql`UPDATE action_attempt SET lease_expires_at = now() - interval '1 minute' WHERE attempt_id = ${reserved.row.attemptId}`;
  const resumed = await owner.runtime(() => service.claim(claimInput));
  assert.equal(resumed.status, 'RUNNING');
  assert.equal(
    resumed.savedWork.matterWorkRevisionId,
    first.revision.matterWorkRevisionId,
  );
  fence = {
    ...claimInput,
    leaseToken: resumed.leaseToken,
    leaseGeneration: resumed.leaseGeneration,
  };
  const secondCommand = {
    ...command,
    requestId: 'SAVE-DRAFT-SECOND',
    expectedWorkingRevision: first.revision.workingRevision,
    nextFocus: { ...command.nextFocus, question: '继续保存的第二份候选工作。' },
  };
  const second = await owner.runtime(() =>
    service.saveWorkingDraft({ ...fence, command: secondCommand }),
  );
  assert.equal(
    second.revision.workingRevision,
    first.revision.workingRevision + 1,
  );
  const repeated = await owner.runtime(() =>
    service.saveWorkingDraft({ ...fence, command }),
  );
  assert.equal(repeated.replayed, true);
  assert.equal(
    repeated.revision.matterWorkRevisionId,
    first.revision.matterWorkRevisionId,
    'lost first response resolves to the first save even after another save',
  );
  await assert.rejects(
    owner.runtime(() =>
      service.saveWorkingDraft({
        ...fence,
        command: { ...command, changeSummary: 'different' },
      }),
    ),
    /REPLAY_MISMATCH/u,
  );
  const { contentHash: _hash, ...resultBody } = matterResult(reserved.task);
  const finishResult = (ref) =>
    sealMatterResultEnvelope({
      ...resultBody,
      modelOutput: JSON.stringify({ workRevisionRef: ref }),
    });
  await assert.rejects(
    owner.runtime(() =>
      service.prepareCommit({
        ...fence,
        result: finishResult(first.revision.matterWorkRevisionId),
      }),
    ),
    /JOBAID_FINISH_EXACT_COMPLETED_WORK_REQUIRED/u,
  );
  const prepared = await owner.runtime(() =>
    service.prepareCommit({
      ...fence,
      result: finishResult(second.revision.matterWorkRevisionId),
    }),
  );
  assert.equal(prepared.row.status, 'COMMITTING');
  const finished = await owner.runtime(() => service.finish(fence));
  assert.equal(
    finished.work.matterWorkRevisionId,
    second.revision.matterWorkRevisionId,
  );
  assert.equal(finished.row.status, 'SUCCEEDED');
  assert.equal(
    (
      await owner.runtime(() =>
        service.readSavedWork({ ...claimInput, requestId: command.requestId }),
      )
    ).matterWorkRevisionId,
    first.revision.matterWorkRevisionId,
  );
  await assert.rejects(
    owner.runtime(() =>
      service.saveWorkingDraft({
        ...fence,
        command: {
          ...secondCommand,
          requestId: 'SAVE-AFTER-FINISH',
          expectedWorkingRevision: second.revision.workingRevision,
        },
      }),
    ),
    /LEASE_FENCE_REJECTED|SAVE_FENCE_REJECTED/u,
  );
}
