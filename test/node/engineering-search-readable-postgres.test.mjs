// Owned loopback PostgreSQL only. The reused fixture DROPs its own public schema.
// No URL is accepted; no platform, model or business SAVE is called. Immutable
// synthetic histories are arranged through the owned admin connection, then
// searched/read through the actual non-BYPASSRLS browser repositories/services.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { startCoreP1HostFixture } from './helpers/core-p1-host-postgres.fixture.mjs';
import { initialProjection } from './helpers/q1-review-postgres.fixture.mjs';

const require = createRequire(import.meta.url);
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql } = require('drizzle-orm');
const { PgDialect } = require('drizzle-orm/pg-core');
const { SqlExecutionContextMiddleware } = require('@lark-apaas/fullstack-nestjs-core');
const schema = require('../../server/database/schema.ts');
const { dmDocumentParseRun } = require('../../server/database/document-parsing.schema.ts');
const load = name => require(`../../server/modules/canonical-host/${name}.ts`);
const { EngineeringIssueSearchService } = load('engineering-issue-search.service');
const { EngineeringSearchProjectionWriter } = load('engineering-search-projection');
const { buildEngineeringSearchText, prepareEngineeringSearchQuery } = load('engineering-search-text');
const { EngineeringMatterRepository } = load('engineering-matter.repository');
const { EngineeringMatterWorkingRepository } = load('engineering-matter-working.repository');
const { EngineeringMatterWorkingService } = load('engineering-matter-working.service');
const { materializeJobAidWork } = load('jobaid-problem-work');
const { materializeMatterJobAidCommand } = load('matter-jobaid-save');
const { materializeEngineeringMatterWorkingState, parseEngineeringMatterWorkingCommand,
  parseEngineeringMatterWorkingState } = load('engineering-matter-working-state');
const { JOBAID_METHOD_BINDING } = load('jobaid-method-pack');
const { OrdinaryCanonicalAuthorizationAdapter, OrdinaryCanonicalPermissionSnapshotAdapter } =
  load('ordinary-canonical-authorization.adapter');
const { MiaodaHostedCanonicalObjectAccessAdapter } =
  require('../../server/modules/work-item/miaoda-hosted-canonical-object-access.adapter.ts');
const { sourceIdentityQuery, assertSourceIdentity } =
  require('../../server/modules/work-item/document-version-source-identity.ts');
const { sealTaskEnvelope } = require('../../server/modules/action-attempt/action-attempt-envelope.ts');

const history = { required: false, priorAssessmentRefs: [], engineeringDocumentRefs: [],
  coverage: 'NOT_REQUIRED', limitation: null };
const creator = 'synthetic-other-author';
function material(workItemId, issues, source, overview = 'sharedcontext') {
  const evidence = [{ ...source, workItemId: source.workItemId ?? workItemId }];
  const proposal = { schemaVersion: 'wiselink.jobaid-problem-work.v3', headline: 'Synthetic work',
    listBrief: 'Unresolved candidate.', overview, issues, roundCompletion: 'IN_PROGRESS',
    completionReason: 'Further investigation required.', changeSummary: 'Synthetic saved history.' };
  return { proposal, evidence, readSourceRefs: [source.evidenceRef], capabilities: [], history,
    methodBinding: JOBAID_METHOD_BINDING };
}
const identities = result => result.hits.map(hit => [hit.subjectKind, hit.subjectId, hit.workRef, hit.issueKey]
  .join('|')).sort();

test('owned PG readable discovery: exact readers, source boundaries, paging and indexed/direct corpus parity',
  { timeout: 180000 }, async t => {
    const priorFlag = process.env.WL_ENGINEERING_SEARCH_PROJECTION;
    let f;
    try {
      f = await startCoreP1HostFixture({ browser: true, matter: true });
      const originalBinding = f.original.binding;
      const unit = f.original.source.units.find(unit => unit.kind === 'paragraph');
      assert.ok(unit && unit.sourceRefIds.length && typeof unit.payload.text === 'string');
      const sourceRef = `DOCUMENT_ORIGINAL:${originalBinding.documentVersionId}:${originalBinding.parseRunId}:${unit.unitId}`;
      const source = { evidenceRef: sourceRef, kind: 'DOCUMENT_PASSAGE',
        documentVersionId: originalBinding.documentVersionId, sourceRefId: unit.sourceRefIds[0],
        locator: 'page 1', title: 'Constructed fixture original',
        versionLabel: String(originalBinding.parseRevision), excerpt: unit.payload.text };
      const issue = (issueKey, text, extra = {}) => ({ issueKey, question: `Question ${issueKey}`,
        body: `${text} [[${sourceRef}]]`, ...extra });
      const admin = drizzle(f.sql);
      const writer = new EngineeringSearchProjectionWriter(admin);
      const nativeAccess = new MiaodaHostedCanonicalObjectAccessAdapter(f.workItems);
      const denied = new Set(), accessCalls = [];
      // A synthetic external object-permission denial, not a fake exact reader.
      // Every allowed read still passes the real native adapter, source checks
      // and PostgreSQL RLS. This is not evidence about live Feishu permissions.
      const access = { freshRead: async (input, database) => {
        accessCalls.push(input.accessRoot.id);
        if (denied.has(input.accessRoot.id)) return { allowed: false, action: input.action,
          accessRoot: input.accessRoot, denialSource: 'MIAODA_OBJECT_ACCESS',
          code: 'CANONICAL_WORK_ITEM_NOT_FOUND', statusCode: 404 };
        return nativeAccess.freshRead(input, database);
      } };
      f.problem.authorization = new OrdinaryCanonicalAuthorizationAdapter(access);
      f.problem.permissionSnapshots = new OrdinaryCanonicalPermissionSnapshotAdapter(access);
      const working = new EngineeringMatterWorkingRepository(f.db,
        new SqlExecutionContextMiddleware({ roleSchema: 'wiselink_jobaid_test' }),
        { roleSchema: 'wiselink_jobaid_test' }, new EngineeringSearchProjectionWriter(f.db));
      const matters = new EngineeringMatterWorkingService(new EngineeringMatterRepository(f.db),
        working, f.workItems, access);
      const queries = [];
      const database = { execute: query => {
        queries.push(new PgDialect().sqlToQuery(query));
        return f.db.execute(query);
      } };
      const search = new EngineeringIssueSearchService(database, f.problem, matters);
      async function find(query, indexed = false, scope = 'CURRENT') {
        process.env.WL_ENGINEERING_SEARCH_PROJECTION = indexed ? '1' : '0';
        return f.withBrowser(() => search.search(query, f.actor, scope));
      }
      async function saveFixture(workItemId, revision, issues, options = {}) {
        if (revision === 1) await f.seed(workItemId);
        const tenantId = f.tenantId;
        const [workItem] = await f.sql`SELECT revision,document_version_id,tenant_id FROM work_item
          WHERE work_item_id=${workItemId}`;
        assert.equal(workItem.tenant_id, tenantId);
        assert.equal(workItem.document_version_id, source.documentVersionId);
        const previous = revision === 1 ? null : await f.withBrowser(() =>
          f.problem.readBrowserRevision(workItemId, `${workItemId}-r${revision - 1}`, f.actor));
        assert.equal(revision, (previous?.workRevision ?? 0) + 1);
        const [attempt] = await f.sql`SELECT attempt_id FROM action_attempt WHERE work_item_id=${workItemId}`;
        const context = material(workItemId, issues, options.retainedSource ?? source, options.overview);
        const content = materializeJobAidWork(context.proposal, { ...context, workItemId, previous: previous?.content ?? null });
        const ref = `${workItemId}-r${revision}`;
        await admin.insert(schema.assessmentWorkRevision).values({
          assessmentWorkRevisionId: ref, tenantId, workItemId, workRevision: revision,
          requestId: `${ref}-request`, actionAttemptId: attempt.attempt_id,
          basedOnWorkItemRevision: workItem.revision, documentVersionId: workItem.document_version_id,
          previousWorkRevisionId: previous?.workRevisionRef ?? null,
          commandJson: JSON.stringify(context.proposal), contentJson: JSON.stringify(content),
          createdByUserId: creator,
        });
        // Actual projection builder/writer and generated PG vector, fixture
        // arrangement only; a browser never receives this admin executor.
        await writer.indexJobAidRevision({ tenantId, ownerId: creator, subjectId: workItemId,
          revisionRef: ref, content });
        return { ref, content, context, workItemRevision: workItem.revision };
      }

      const wi = 'WI-search-visible';
      const saved = await saveFixture(wi, 1, [
        issue('ABC-01', 'ＰＵＭＰ hydraulic pressure', { measures: [{ text: 'Inspect', addresses: 'Configuration',
          limitations: ['limitationneedle'], status: 'PROPOSED', basisRefs: [sourceRef] }],
          riskScenarios: [{ scenario: 'Synthetic uncertain scenario', conditions: ['Unverified configuration'],
            method: 'JA_AC_R01', severity: null, likelihood: null,
            limitations: ['No observed frequency'], controlComparison: 'controlneedle' }],
          openQuestions: [{ question: 'Open?', affects: 'Scope', nextEvidence: 'nextneedle', reason: 'Not known' }] }),
        issue('ABC-010', 'leak siblingneedle'),
        issue('SW_2_3_4', 'Chinese 油泵检查'),
      ]);
      const baseMatter = await f.seedMatter(wi, 'search-matter-seed');
      const matterId = baseMatter.matter.matterId;
      const matterRevisionId = baseMatter.matter.currentRevision.matterRevisionId;
      assert.ok(typeof matterRevisionId === 'string' && matterRevisionId.length > 0);
      const matterRef = 'MATTER-search-r1';
      async function saveMatterFixture(revision, text) {
        const basis = await f.withBrowser(() => matters.resolveWorkingBasis(matterId, f.actor));
        assert.equal(basis.snapshot.currentMatterRevisionId, matterRevisionId);
        assert.equal(basis.snapshot.currentRevisionNo, baseMatter.matter.currentRevision.revisionNo);
        const previous = basis.working;
        const expectedWorkingRevision = previous?.workingRevision ?? 0;
        assert.equal(revision, expectedWorkingRevision + 1);
        if (previous) assert.equal(previous.matterWorkRevisionId, `MATTER-search-r${revision - 1}`);
        assert.equal(basis.currentInputs.length, 1);
        const input = basis.currentInputs[0];
        assert.equal(input.workItemId, wi);
        assert.equal(input.workItemRevision, saved.workItemRevision);
        assert.equal(input.documentVersionId, originalBinding.documentVersionId);
        assert.equal(input.original?.parseRunId, originalBinding.parseRunId);
        assert.equal(input.original?.parseRevision, originalBinding.parseRevision);
        const command = materializeMatterJobAidCommand({
          ...material(wi, [issue('MAT-READ', text)], source, 'mattercontext'), matterId,
          matterRevisionId, attemptRef: `AQ-synthetic-read-${revision}`,
          requestId: `search-matter-work-${revision}`, expectedWorkRevision: expectedWorkingRevision, previous,
          inputs: basis.currentInputs });
        assert.equal(command.basedOnMatterRevisionId, matterRevisionId);
        assert.equal(command.expectedWorkingRevision, expectedWorkingRevision);
        assert.deepEqual(parseEngineeringMatterWorkingCommand(JSON.stringify(command)), command);
        const state = materializeEngineeringMatterWorkingState({ matterId, current: previous?.state ?? null, command }).state;
        assert.deepEqual(parseEngineeringMatterWorkingState(JSON.stringify(state), matterId), state);
        const ref = `MATTER-search-r${revision}`;
        await admin.insert(schema.engineeringMatterWorkRevision).values({
          matterWorkRevisionId: ref, tenantId: f.tenantId, matterId, workingRevision: revision,
          requestId: command.requestId, basedOnMatterRevisionId: command.basedOnMatterRevisionId,
          updateKind: command.updateKind, commandJson: JSON.stringify(command), stateJson: JSON.stringify(state),
          substantiveResultRef: state.substantiveResult.resultRef,
          substantiveResultRevision: state.substantiveResult.resultRevision,
          changeSummary: command.changeSummary, createdByUserId: creator,
        });
        await writer.indexMatterRevision({ tenantId: f.tenantId, ownerId: creator,
          subjectId: matterId, revisionRef: ref, content: state.problemWork });
        return { ref, state };
      }
      const { state } = await saveMatterFixture(1, 'matterneedle oldmatterrevisionneedle');

      // A separate legal tenant graph, not an UPDATE of an existing parent with
      // live composite-FK children. All rows are new synthetic fixture data.
      async function seedForeignFixture() {
        const tenantId = 'tenant-other-synthetic', actorId = 'actor-other-synthetic';
        const workItemId = 'WI-search-foreign', documentId = 'doc-search-foreign';
        const documentVersionId = 'dv-search-foreign', familyId = 'fam-search-foreign';
        const artifactId = 'ART-search-foreign', acquisitionId = 'acq-search-foreign';
        const parseRunId = 'PR-search-foreign', ref = `${workItemId}-r1`;
        // A distinct synthetic artifact identity, not a duplicate content row.
        const hash = 'b'.repeat(64), bytes = originalBinding.sourceByteLength;
        const foreignSource = { ...source, documentVersionId,
          evidenceRef: `DOCUMENT_ORIGINAL:${documentVersionId}:${parseRunId}:${unit.unitId}` };
        const context = material(workItemId, [{ issueKey: 'FOREIGN', question: 'Foreign candidate',
          body: `foreignneedle [[${foreignSource.evidenceRef}]]` }], foreignSource, 'foreigncontext');
        const content = materializeJobAidWork(context.proposal, { ...context, workItemId, previous: null });
        const projection = initialProjection(workItemId);
        projection.source = { documentId, documentVersionId, sourceArtifactId: artifactId,
          sourceFileSha256: hash, sourceByteLength: bytes };
        projection.package.contentHash = hash;
        const attemptId = `ATT-foreign-${randomUUID()}`;
        const task = sealTaskEnvelope({ schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
          actionAttemptId: attemptId, operationRef: `AQ-${randomUUID().replaceAll('-', '')}`,
          taskType: 'OPENCLAW_APPLICABILITY_EVALUATION', priority: 50, tenantId, workItemId,
          inputRevision: projection.revision, baseRevision: projection.revision, documentVersionId,
          sourceRefs: [], allowedConnectors: [], hostResolvedMissingInputs: [],
          modelInput: { modelInput: { documentOverview: { original: { binding: {
            ...originalBinding, documentVersionId, sourceArtifactId: artifactId, parseRunId,
            sourceSha256: hash, sourceByteLength: bytes } } } } },
          deadline: new Date(Date.now() + 3600000).toISOString(), idempotencyKey: `fixture-app-${workItemId}` });
        await admin.transaction(async tx => {
          await tx.execute(sql`INSERT INTO identity_subject_mapping(miaoda_user_id,miaoda_tenant_id,expected_client_id,status)
            VALUES(${actorId},${tenantId},'cli_aadde8b579f95bc9','ACTIVE')`);
          await tx.insert(schema.dmPublicationFamily).values({ id: randomUUID(), familyId,
            canonicalIdentityKey: `tenant:${tenantId}:family:synthetic`, documentFamily: 'SB',
            currentDocumentVersionId: documentVersionId, currentGeneration: 1 });
          await tx.insert(schema.dmSourceArtifact).values({ id: randomUUID(), sourceArtifactId: artifactId,
            sha256: hash, byteLength: bytes, readbackVerified: true });
          await tx.insert(schema.dmAcquisition).values({ id: randomUUID(), acquisitionId, documentVersionId,
            sourceArtifactId: artifactId, acquiredBy: actorId, status: 'COMMITTED_CANONICAL',
            idempotencyKey: `tenant:${tenantId}:request:search-foreign` });
          await tx.insert(schema.dmDocumentVersion).values({ id: randomUUID(), documentVersionId, documentId,
            familyId, sourceArtifactId: artifactId, acquisitionId, pdfSha256: hash, byteLength: bytes,
            lifecycleStatus: 'COMMITTED_IMMUTABLE', committedBy: actorId });
          await tx.insert(schema.dmIngressPreflight).values({ id: randomUUID(), acquisitionId, documentVersionId,
            status: 'COMMITTED' });
          await tx.insert(schema.dmCurrentnessDecision).values({ id: randomUUID(), familyId,
            nextDocumentVersionId: documentVersionId, nextGeneration: 1 });
          await tx.insert(dmDocumentParseRun).values({ parseRunId, documentVersionId, tenantId,
            actorUserId: actorId, requestId: 'parse-search-foreign', parseRevision: originalBinding.parseRevision,
            expectedPublishedRevision: 0, status: 'PUBLISHED', bucketId: 'fixture',
            sourceBinding: { documentVersionId, sourceArtifactId: artifactId, pdfSha256: hash, byteLength: bytes },
            manifestArtifact: { role: 'MANIFEST', readback: 'VERIFIED', relativePath: 'original/manifest.json' },
            deadlineAt: new Date(task.deadline), completedAt: new Date() });
          await tx.insert(schema.workItem).values({ workItemId, tenantId, requestId: projection.requestId,
            requestedByUserId: actorId, actionType: 'PARSE_PDF', runKey: 'canonical', status: projection.phase,
            documentId, documentVersionId, sourceArtifactId: artifactId, sourceFileSha256: hash,
            sourceByteLength: bytes, revision: projection.revision, packageId: projection.package.packageId,
            projectionJson: JSON.stringify(projection) });
          await tx.insert(schema.actionAttempt).values({ attemptId, operationRef: task.operationRef, workItemId,
            tenantId, actionType: task.taskType, attemptNo: 1, requestOrigin: 'OPENCLAW_MCP_V1',
            status: 'SUCCEEDED', actorUserId: actorId, inputRevision: task.inputRevision, baseRevision: task.baseRevision,
            documentVersionId, taskEnvelopeJson: JSON.stringify(task), taskInputHash: task.inputHash,
            idempotencyKey: task.idempotencyKey, triggerRequestId: `REQ-${attemptId}`, claimCount: 1,
            retryCount: 0, leaseGeneration: 1, projectionApplied: true,
            createdAt: new Date(), updatedAt: new Date(), completedAt: new Date() });
          await tx.execute(sql`INSERT INTO auto_work_item_authorization(tenant_id,work_item_id,request_id,
            actor_user_id,document_id,document_version_id,source_artifact_id,source_file_sha256,source_byte_length,grant_kind,status)
            VALUES(${tenantId},${workItemId},${projection.requestId},${actorId},${documentId},${documentVersionId},
              ${artifactId},${hash},${bytes},'MIAODA_CANONICAL_PARSE_REQUEST','WAITING')`);
          await tx.insert(schema.assessmentWorkRevision).values({ assessmentWorkRevisionId: ref, tenantId, workItemId,
            workRevision: 1, requestId: `${ref}-request`, actionAttemptId: attemptId,
            basedOnWorkItemRevision: projection.revision, documentVersionId, previousWorkRevisionId: null,
            commandJson: JSON.stringify(context.proposal), contentJson: JSON.stringify(content), createdByUserId: actorId });
          await writer.indexJobAidRevision({ tenantId, ownerId: actorId, subjectId: workItemId,
            revisionRef: ref, content, database: tx });
          const [identity] = await sourceIdentityQuery(tx, documentVersionId);
          assert.ok(identity); assertSourceIdentity(identity);
          const [grant] = await tx.execute(sql`SELECT a.tenant_id,a.actor_user_id FROM auto_work_item_authorization a
            JOIN work_item w ON (a.tenant_id,a.work_item_id)=(w.tenant_id,w.work_item_id)
              AND a.request_id=w.request_id AND a.document_version_id=w.document_version_id
            WHERE a.work_item_id=${workItemId}`);
          assert.deepEqual(grant, { tenant_id: tenantId, actor_user_id: actorId });
        });
        return { ref, workItemId, tenantId, actorId, source: { ...foreignSource, workItemId } };
      }

      await t.test('different work creator is visible only after actual browser exact reads under RLS', async () => {
        const before = JSON.stringify(await f.snapshot());
        const projectionBefore = JSON.stringify(await f.sql`SELECT * FROM engineering_search_projection ORDER BY entry_id`);
        const [role] = await f.withBrowser(() => f.db.execute(sql`SELECT current_user AS role,
          r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user`));
        assert.equal(role.role, 'authenticated_wiselink_jobaid_test');
        assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
        assert.notEqual(creator, f.actorUserId);
        for (const indexed of [false, true]) {
          const workHits = await find('sharedcontext', indexed);
          assert.equal(workHits.hits.length, 3); assert.equal(workHits.hasMore, false);
          assert.ok(workHits.hits.every(hit => hit.workRef === saved.ref && hit.subjectId === wi));
          const matterHits = await find('matterneedle', indexed);
          assert.deepEqual(identities(matterHits), [`ENGINEERING_MATTER|${matterId}|${matterRef}|MAT-READ`]);
        }
        const actualWork = await f.withBrowser(() => f.problem.readBrowserRevision(wi, saved.ref, f.actor));
        assert.equal(actualWork.workRevisionRef, saved.ref);
        assert.deepEqual(actualWork.content, saved.content);
        const actualMatter = await f.withBrowser(() => matters.readWorkingRevision(matterId, matterRef, f.actor));
        assert.equal(actualMatter.matterWorkRevisionId, matterRef);
        assert.deepEqual(actualMatter.state.problemWork, state.problemWork);
        assert.equal(JSON.stringify(await f.snapshot()), before, 'search/exact reads never save, enqueue or maintain work');
        assert.equal(JSON.stringify(await f.sql`SELECT * FROM engineering_search_projection ORDER BY entry_id`), projectionBefore);
      });

      await t.test('same corpus uses the actual ICU/simple/plain predicate and exact identifier OR', async () => {
        // Dots/slashes are legal general engineering identifiers, but are not
        // legal JobAid issue keys. Test their shared normalization separately;
        // actual saved-work discovery below uses a valid underscore key.
        const software = buildEngineeringSearchText('Synthetic version', ['sw/2.3_4']);
        assert.deepEqual(software.identifiers, ['SW/2.3_4']);
        assert.ok(prepareEngineeringSearchQuery('check SW/2.3_4').exactIdentifierCandidates
          .includes(software.identifiers[0]));
        for (const [query, keys] of [
          ['sharedcontext', ['ABC-01', 'ABC-010', 'SW_2_3_4']],
          ['limitationneedle', ['ABC-01']], ['controlneedle', ['ABC-01']], ['nextneedle', ['ABC-01']],
          ['pump', ['ABC-01']], ['ＰＵＭＰ', ['ABC-01']],
          ['pump leak', []], ['siblingneedle', ['ABC-010']],
          ['riskScenarios', []], ['sourceDependencies', []],
          ['check ABC-01', ['ABC-01']], ['check ABC-0', []],
          ['check SW_2_3_4', ['SW_2_3_4']], ['油泵检查', ['SW_2_3_4']],
        ]) {
          const direct = await find(query), indexed = await find(query, true);
          assert.deepEqual(identities(direct), identities(indexed), query);
          assert.deepEqual(direct.hits.map(hit => hit.issueKey).sort(), keys.sort(), query);
          if (query.startsWith('check ') && keys.length)
            assert.ok(direct.hits.every(hit => hit.reason === 'EXACT_IDENTIFIER'));
        }
      });

      await t.test('history is exact and CURRENT never substitutes or returns the prior revision', async () => {
        const old = await saveFixture('WI-search-history', 1, [issue('HIST-1', 'oldrevisionneedle')],
          { overview: 'historycontext' });
        const latest = await saveFixture('WI-search-history', 2, [issue('HIST-1', 'newrevisionneedle')],
          { overview: 'historycontext' });
        for (const indexed of [false, true]) {
          assert.equal((await find('oldrevisionneedle', indexed)).hits.length, 0);
          assert.deepEqual((await find('oldrevisionneedle', indexed, 'HISTORY')).hits.map(hit => hit.workRef), [old.ref]);
          assert.deepEqual((await find('newrevisionneedle', indexed)).hits.map(hit => hit.workRef), [latest.ref]);
        }
        const exact = await f.withBrowser(() => f.problem.readBrowserRevision('WI-search-history', old.ref, f.actor));
        assert.equal(exact.workRevision, 1); assert.deepEqual(exact.content, old.content);
        const matterLatest = await saveMatterFixture(2, 'matterneedle newmatterrevisionneedle');
        for (const indexed of [false, true]) {
          assert.equal((await find('oldmatterrevisionneedle', indexed)).hits.length, 0);
          assert.deepEqual((await find('oldmatterrevisionneedle', indexed, 'HISTORY')).hits.map(hit => hit.workRef), [matterRef]);
          assert.deepEqual((await find('newmatterrevisionneedle', indexed)).hits.map(hit => hit.workRef), [matterLatest.ref]);
        }
        const oldMatter = await f.withBrowser(() => matters.readWorkingRevision(matterId, matterRef, f.actor));
        assert.equal(oldMatter.workingRevision, 1); assert.deepEqual(oldMatter.state.problemWork, state.problemWork);
      });

      await t.test('object permission revocation is rechecked; damaged source identity fails explicitly and is restored', async () => {
        denied.add(wi);
        try {
          for (const indexed of [false, true]) {
            assert.equal((await find('sharedcontext', indexed)).hits.length, 0);
            assert.equal((await find('matterneedle', indexed)).hits.length, 0);
          }
          await assert.rejects(f.withBrowser(() => f.problem.readBrowserRevision(wi, saved.ref, f.actor)),
            /CANONICAL_WORK_ITEM_NOT_FOUND/);
        } finally {
          denied.delete(wi);
        }
        assert.equal((await find('sharedcontext')).hits.length, 3);
        const [artifact] = await f.sql`SELECT readback_verified FROM dm_source_artifact WHERE source_artifact_id='ART-TEST'`;
        assert.equal(artifact.readback_verified, true);
        try {
          // Integrity corruption is not an ACL change. Never swallow this
          // technical identity error or mislabel it as ordinary no-matches.
          await f.sql`UPDATE dm_source_artifact SET readback_verified=false WHERE source_artifact_id='ART-TEST'`;
          for (const indexed of [false, true]) await assert.rejects(find('matterneedle', indexed),
            error => error.message === 'DOCUMENT_VERSION_SOURCE_IDENTITY_INVALID' && error.statusCode === undefined);
        } finally {
          await f.sql`UPDATE dm_source_artifact SET readback_verified=${artifact.readback_verified}
            WHERE source_artifact_id='ART-TEST'`;
        }
        for (const indexed of [false, true])
          assert.equal((await find('sharedcontext', indexed)).hits.length, 3, 'fresh reads after restoration');
      });

      let foreign;
      await t.test('another tenant is absent at SQL discovery and the exact reader', async () => {
        foreign = await seedForeignFixture();
        for (const indexed of [false, true]) assert.equal((await find('foreignneedle', indexed)).hits.length, 0);
        await assert.rejects(f.withBrowser(() => f.problem.readBrowserRevision(foreign.workItemId, foreign.ref, f.actor)),
          error => error.code === 'CANONICAL_WORK_ITEM_NOT_FOUND' && error.statusCode === 404);
        const rows = await f.withBrowser(() => f.db.execute(sql`SELECT assessment_work_revision_id
          FROM assessment_work_revision WHERE assessment_work_revision_id=${foreign.ref}`));
        assert.equal(rows.length, 0, 'actual saved-history RLS, not just a service tenant filter');
      });

      await t.test('visible saved work retaining a currently unauthorized valid source is withheld by the real predicate', async () => {
        assert.ok(foreign, 'the separate tenant graph must have been constructed successfully');
        const retainedWi = 'WI-search-retained-foreign';
        const retained = await saveFixture(retainedWi, 1, [{ issueKey: 'RETAINED', question: 'Retained source',
          body: `retainedforeignneedle [[${foreign.source.evidenceRef}]]` }],
          { retainedSource: foreign.source, overview: 'retainedcontext' });
        const grant = await f.withBrowser(() => nativeAccess.freshRead({ actor: f.actor.objectAccessActor,
          action: 'READ_DOCUMENT_PARSING', accessRoot: { kind: 'WORK_ITEM', id: retainedWi } }));
        assert.equal(grant.allowed, true, 'the primary object itself is authorized');
        const visible = await f.withBrowser(() => f.db.execute(sql`SELECT assessment_work_revision_id
          FROM assessment_work_revision WHERE assessment_work_revision_id=${retained.ref}`));
        assert.equal(visible.length, 1, 'saved-row RLS alone does not authorize its retained source');
        const [sourceAccess] = await f.withBrowser(() => f.db.execute(sql`SELECT
          native_app_work_item_readable(${f.tenantId},${foreign.workItemId}) AS work,
          native_app_document_readable(${f.tenantId},${foreign.source.documentVersionId}) AS document`));
        assert.deepEqual(sourceAccess, { work: false, document: false });
        await assert.rejects(f.withBrowser(() => f.problem.readBrowserRevision(retainedWi, retained.ref, f.actor)),
          error => error.code === 'CANONICAL_WORK_ITEM_NOT_FOUND' && error.statusCode === 404);
        for (const indexed of [false, true]) {
          assert.equal((await find('retainedforeignneedle', indexed)).hits.length, 0);
          assert.equal((await find('sharedcontext', indexed)).hits.length, 3, 'unrelated authorized work remains visible');
        }
        // These admin-arranged histories prove current source denial, not a
        // past lawful grant, a real SAVE, or independent source-grant revocation.
      });

      await t.test('denied 51/101 windows continue; only authorized matches fill fifty plus hasMore', async () => {
        const blockedWi = 'WI-aaa-search-denied', visibleWi = 'WI-zzz-search-page';
        await saveFixture(blockedWi, 1, Array.from({ length: 105 }, (_, i) =>
          issue(`DEN-${String(i).padStart(3, '0')}`, 'pagingneedle')));
        await saveFixture(visibleWi, 1, Array.from({ length: 51 }, (_, i) =>
          issue(`OK-${String(i).padStart(3, '0')}`, 'pagingneedle')));
        denied.add(blockedWi);
        try {
          for (const indexed of [false, true]) {
            queries.length = 0; accessCalls.length = 0;
            const found = await find('pagingneedle', indexed);
            assert.equal(found.hits.length, 50); assert.equal(found.hasMore, true);
            assert.ok(found.hits.every(hit => hit.subjectId === visibleWi));
            assert.ok(accessCalls.includes(blockedWi), 'denial came from the exact permission chain');
            const windows = queries.filter(query => indexed
              ? query.sql.includes('FROM engineering_search_projection')
              : query.sql.includes('WITH works AS'));
            assert.ok(windows.length >= (indexed ? 2 : 3), 'continued past a completely denied SQL window');
            assert.ok(windows.slice(1).every(query => query.sql.includes(' > ')), 'keyset cursor advances');
          }
          denied.add(visibleWi);
          for (const indexed of [false, true]) {
            const deniedResult = await find('pagingneedle', indexed);
            assert.equal(deniedResult.hits.length, 0); assert.equal(deniedResult.hasMore, false);
          }
        } finally {
          denied.delete(blockedWi); denied.delete(visibleWi);
        }
      });
    } finally {
      if (f) await f.close();
      if (priorFlag === undefined) delete process.env.WL_ENGINEERING_SEARCH_PROJECTION;
      else process.env.WL_ENGINEERING_SEARCH_PROJECTION = priorFlag;
    }
  });
