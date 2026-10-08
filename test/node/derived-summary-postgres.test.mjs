import { prepareDerivedSummaryDdl } from '../../scripts/prepare-derived-summary-ddl.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import postgres from 'postgres';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql: querySql } = require('drizzle-orm');
const { SqlExecutionContextMiddleware } = require('@lark-apaas/fullstack-nestjs-core');
const { EngineeringMatterWorkingRepository } = require('../../server/modules/canonical-host/engineering-matter-working.repository.ts');
const { JobAidWorkRepository } = require('../../server/modules/canonical-host/jobaid-work.repository.ts');
const { CanonicalJobAidProblemService } = require('../../server/modules/canonical-host/canonical-jobaid-problem.service.ts');
const { ReviewConversationRepository } = require('../../server/modules/review-persistence/review-conversation.repository.ts');
const { DerivedSummaryMembersService } = require('../../server/modules/canonical-host/derived-summary-members.service.ts');
const { DerivedSummaryRepository } = require('../../server/modules/canonical-host/derived-summary.repository.ts');
const { DerivedSummaryService } = require('../../server/modules/canonical-host/derived-summary.service.ts');
const { DerivedSummaryRuntimeService } = require('../../server/modules/canonical-host/derived-summary-runtime.service.ts');
const { DocumentSemanticRevisionRepository } = require('../../server/modules/canonical-host/document-semantic-revision.repository.ts');
const { DocumentParsingRepository } = require('../../server/modules/document-management/src/hosted/nest/document-parsing.repository.ts');
const { DocumentStepLeaseRepository } = require('../../server/modules/document-management/src/hosted/nest/document-step-lease.repository.ts');
const { DocumentSemanticService } = require('../../server/modules/canonical-host/document-semantic.service.ts');
const { EngineeringMatterRepository } = require('../../server/modules/canonical-host/engineering-matter.repository.ts');
const { EngineeringMatterService } = require('../../server/modules/canonical-host/engineering-matter.service.ts');
const { PgDialect } = require('drizzle-orm/pg-core');
const { buildDocumentSemanticMap } = require('../../server/modules/document-management/src/hosted/nest/document-semantic-map.ts');
const { GENERIC_SEMANTIC_PROFILE } = require('../../server/modules/document-management/src/hosted/nest/document-semantic-profile.ts');
const { originalFixture } = require('../unit/document-parsing/fixtures/document-original.fixture.ts');
const { EngineeringSearchProjectionWriter } = require('../../server/modules/canonical-host/engineering-search-projection.ts');
const { workItem, actionAttempt } = require('../../server/database/schema.ts');
const { eq } = require('drizzle-orm');
const { JOBAID_METHOD_BINDING } = require('../../server/modules/canonical-host/jobaid-method-pack.ts');

const databaseUrl = process.env.DERIVED_SUMMARY_TEST_DATABASE_URL;
// The SDK roleSchema is the actual fixed schema used by the functions.
const roleSchema = 'public';
const owner = { tenantId: 'tenant-summary', actorUserId: 'actor-summary' };
const scope = { tenantId: owner.tenantId, principalId: 'service-summary', appId: 'app_17bzc551rsg', authorizationFingerprint: 'configured' };
const source = { kind: 'DOCUMENT_PASSAGE', evidenceRef: 'SOURCE-DV-old-para1', title: 'Synthetic old publication',
  versionLabel: 'R1', excerpt: 'Monitoring remains incomplete; no applicability decision is made.',
  workItemId: 'WI-summary', documentVersionId: 'DV-old', sourceRefId: 'SR-1', locator: 'paragraph 1' };
const member = { kind: 'WORK_ITEM_WORK', workItemId: 'WI-summary', documentVersionId: 'DV-old',
  workRef: 'JA-summary23', workRevision: 23, issueKeys: ['tls-cause', 'tls-measure'] };
const request = { requestId: 'ATA4-request', scope: { kind: 'ATA4', title: 'B787 selected ATA46-00 materials',
  fleetFamilyId: 'B787', fleetModelIds: [], ata2: '46', ata4: '46-00', selectionReason: 'Explicit candidate selection, unconfirmed membership' },
  members: [member], instruction: 'Explain the selected saved work and retain old/new publication gaps', modelRef: 'miaoda/glm-5.3' };

test('real saved aggregate/upper consumer preserves exact work, pool1, CAS, lease and revocation',
  { skip: !databaseUrl, timeout: 180000 }, async t => {
    const url = new URL(databaseUrl);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
    assert.match(url.pathname, /^\/derived_summary_test_[a-z0-9_]+$/u);
    const admin = postgres(databaseUrl, { max: 1, onnotice() {} });
    let connection;
    let semanticConnection;
    try {
      await t.test('exact SDK SQL roles survive PUBLIC serializer conversion, upgrade and replay', () => reset(admin));
      await seed(admin);
      connection = postgres(databaseUrl, { max: 1, onnotice() {} });
      const database = drizzle(connection);
      const sqlContext = new SqlExecutionContextMiddleware({ roleSchema });
      const transactions = new EngineeringMatterWorkingRepository(database, sqlContext, { roleSchema }, null);
      const works = new JobAidWorkRepository(database, transactions, null);
      const jobAid = new CanonicalJobAidProblemService(null, null, null, null, null, null, null,
        new ReviewConversationRepository(database), null, works);
      const members = new DerivedSummaryMembersService(jobAid, transactions);
      const repository = new DerivedSummaryRepository(database, transactions, members);
      const authorization = { authorizeOpenClawAutoWorkItemQueue: async () => scope };
      const summaries = new DerivedSummaryService(repository, members, authorization);
      const runtime = new DerivedSummaryRuntimeService(repository, members, summaries);
      const context = (actorId, hosted, operation) => new Promise((resolve, reject) => sqlContext.use({
        userContext: { userId: actorId, isSystemAccount: hosted, roles: [] } }, {},
      () => Promise.resolve().then(operation).then(resolve, reject)));
      const browser = operation => context(owner.actorUserId, false, operation);
      const hosted = operation => context('-1', true, operation);
      const actor = nativeActor(owner.actorUserId, owner.tenantId);
      // Exercise an external reader needing this same max=1 pool. It must run
      // outside the save transaction; the original source registry remains unchanged.
      const verify = members.verifyOriginalEvidence.bind(members);
      members.verifyOriginalEvidence = async (evidence, actor) => {
        await verify(evidence, actor);
        await transactions.withActorScope(actor.actorUserId, () => database.execute(querySql`SELECT pg_backend_pid()`));
      };
      const semanticFixtures = await seedSemanticContext(admin);
      semanticConnection = postgres(databaseUrl, { max: 1, onnotice() {} });
      const semanticDatabase = drizzle(semanticConnection);
      const semanticTransactions = new EngineeringMatterWorkingRepository(semanticDatabase, sqlContext, { roleSchema }, null);
      const semanticScope = { ...owner, documentVersionId: 'DV-old' };
      const appendSemantic = (revision, writer = semanticDatabase) => hosted(() =>
        semanticTransactions.withActorScope(owner.actorUserId, () => new DocumentSemanticRevisionRepository(writer).append(
          semanticScope, semanticOriginal(), buildDocumentSemanticMap({ original: semanticOriginal(),
            semanticRevision: revision, profile: GENERIC_SEMANTIC_PROFILE }), revision - 1, semanticFixtures.manifest.sha256)));
      const [saveSession] = await connection`SELECT pg_backend_pid() AS pid`;
      const [writerSession] = await semanticConnection`SELECT pg_backend_pid() AS pid`;
      assert.notEqual(saveSession.pid, writerSession.pid, 'SAVE and semantic append use different physical connections');
      const prepared = async (requestId, summaryId, selected = [member]) => {
        const chosen = { ...request, requestId, members: selected };
        const receipt = await browser(() => summaryId
          ? summaries.request(summaryId, { ...chosen, expectedSummaryRevision: 0 }, actor) : summaries.create(chosen, actor));
        const target = { summaryId: receipt.summaryId, attemptRef: receipt.attemptRef, scope };
        const lease = await hosted(() => runtime.claim(target));
        const ref = lease.task.modelInput.members[0].evidenceRef;
        await hosted(() => runtime.readMemberWork({ ...target, ...claimFence(lease), evidenceRefs: [ref], purpose: 'Read exact saved member' }));
        return { receipt, target, lease, input: { ...target, ...claimFence(lease), requestId, expectedSummaryRevision: 0,
          contentJson: JSON.stringify({ headline: 'Semantic candidate', listBrief: 'Selected work only',
            body: `Retained candidate. [[${ref}]]`, limitations: ['Constructed material only'] }) } };
      };
      await t.test('real organizeDocumentIntake and summary context use compatible family/matter lock order', async () => {
        await admin.unsafe(`ALTER TABLE dm_document_version ADD COLUMN lifecycle_status varchar NOT NULL DEFAULT 'COMMITTED_IMMUTABLE';
          ALTER TABLE dm_publication_family ADD COLUMN canonical_document_number varchar NOT NULL DEFAULT 'SYNTHETIC-SUMMARY',
            ADD COLUMN document_family varchar NOT NULL DEFAULT 'UNKNOWN', ADD COLUMN issuer_authority varchar NOT NULL DEFAULT 'UNKNOWN';
          ALTER TABLE engineering_matter ADD COLUMN default_family_id varchar;
          CREATE TABLE engineering_matter_material_link(matter_revision_id varchar,family_id varchar,kind varchar,material_json text);
          GRANT SELECT,UPDATE ON engineering_matter TO authenticated,service_role;
          GRANT SELECT ON engineering_matter_material_link TO authenticated,service_role;`);
        const p = await prepared('summary-intake-lock-order');
        const basis = structuredClone(p.lease.task.contextBasis);
        basis.matters = [{ matterId: 'MAT-summary-lock', currentMatterRevisionId: 'MREV-summary-lock',
          currentWorkRef: null, currentWorkRevision: null, selectedWork: [] }];
        await admin`INSERT INTO engineering_matter(tenant_id,matter_id,current_matter_revision_id,created_by_user_id,default_family_id)
          VALUES(${owner.tenantId},'MAT-summary-lock','MREV-summary-lock',${owner.actorUserId},'FAMILY-summary')`;
        const familyLocked = deferred(); const continueIntake = deferred();
        const intakeMatters = new EngineeringMatterRepository(semanticDatabase);
        const ensureFamilyMatter = intakeMatters.ensureFamilyMatter.bind(intakeMatters);
        // Pause the actual writer after its family NO KEY UPDATE lock has been acquired.
        // Its normal browser transaction and nested repository transaction remain real.
        intakeMatters.ensureFamilyMatter = (input, executor) => ensureFamilyMatter(input, {
          transaction: callback => executor.transaction(tx => callback(new Proxy(tx, {
            get(target, property) {
              if (property === 'execute') return async statement => {
                const rows = await target.execute(statement);
                if (new PgDialect().sqlToQuery(statement).sql.includes('FOR NO KEY UPDATE OF f')) {
                  familyLocked.resolve(); await continueIntake.promise;
                }
                return rows;
              };
              const value = Reflect.get(target, property);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          }))),
        });
        const intake = new EngineeringMatterService(intakeMatters, null, null, null, semanticTransactions);
        const intakeOutcome = browser(() => intake.organizeDocumentIntake(semanticScope))
          .then(value => ({ value }), error => ({ error }));
        let summaryOutcome;
        try {
          await Promise.race([familyLocked.promise, intakeOutcome.then(result => {
            throw result.error ?? new Error('Intake returned before family lock barrier');
          })]);
          // Exercise the exact production lockContext consumed by reservation/SAVE,
          // with real owned source and Matter rows, rather than handwritten lock SQL.
          summaryOutcome = browser(() => repository.browser(actor, tx => repository.lockContext(basis, owner, tx, p.receipt.summaryId)))
            .then(value => ({ value }), error => ({ error }));
          await waitForBlocked(admin, saveSession.pid, writerSession.pid, 'summary-waits-for-intake-family', 'dm_publication_family');
          continueIntake.resolve();
          const [summaryResult, intakeResult] = await Promise.all([summaryOutcome, intakeOutcome]);
          const errors = [summaryResult.error, intakeResult.error].filter(Boolean).map(error => {
            const chain = []; for (let item = error; item; item = item.cause)
              chain.push({ code: item.code, message: item.message, detail: item.detail });
            return chain;
          });
          console.log(JSON.stringify({ SummaryIntakeLockOutcome: { errors, intake: intakeResult.value,
            summaryConnection: saveSession.pid, intakeConnection: writerSession.pid } }));
          assert.equal(summaryResult.error, undefined, 'the real summary lock path must not deadlock with document intake');
          assert.equal(intakeResult.error, undefined, 'the real family/matter writer must not deadlock with the summary lock path');
          assert.deepEqual(intakeResult.value, { matterId: 'MAT-summary-lock', created: false });
        } finally {
          continueIntake.resolve(); if (summaryOutcome) await summaryOutcome; await intakeOutcome;
          await hosted(() => runtime.cancel({ ...p.target, reason: 'Isolated lock order test cleanup' }));
        }
      });
      await t.test('production ensure creates first semantic revision: SAVE waits, rejects the empty basis, and a fresh round succeeds', async () => {
        const original = semanticOriginal();
        original.binding = { ...original.binding, documentVersionId: 'DV-new', parseRunId: 'PR-summary-new',
          sourceArtifactId: 'SRC-new', sourceSha256: 'b'.repeat(64), sourceByteLength: 101 };
        const manifest = { ...semanticFixtures.manifest, sha256: 'e'.repeat(64) };
        await admin`INSERT INTO dm_document_parse_run VALUES(${owner.tenantId},'DV-new','PR-summary-new',1,'PUBLISHED',
          ${admin.json(manifest)}::jsonb,${admin.json({ documentVersionId: 'DV-new', sourceArtifactId: 'SRC-new',
            pdfSha256: 'b'.repeat(64), byteLength: 101 })}::jsonb)`;
        const newMember = { ...member, workItemId: 'WI-new', documentVersionId: 'DV-new', workRef: 'JA-new1', workRevision: 1 };
        const p = await prepared('semantic-ensure-first', undefined, [newMember]);
        assert.deepEqual(p.lease.task.contextBasis.sources[0].semanticRevisions, []);
        assert.equal((await admin`SELECT * FROM dm_document_semantic_revision WHERE document_version_id='DV-new'`).length, 0);
        const reached = deferred(); const resume = deferred(); const inserted = deferred(); const commit = deferred();
        const oldVerify = members.verifyOriginalEvidence; let writerOutcome;
        members.verifyOriginalEvidence = async (...args) => { await oldVerify.apply(members, args); reached.resolve(); await resume.promise; };
        const outcome = hosted(() => runtime.save(p.input)).then(value => ({ value }), error => ({ error }));
        try {
          await reached.promise;
          const revisions = new DocumentSemanticRevisionRepository({
            execute: statement => semanticDatabase.execute(statement),
            transaction: callback => semanticDatabase.transaction(async tx => {
              const value = await callback(tx); inserted.resolve(); await commit.promise; return value;
            }),
          });
          const ensure = new DocumentSemanticService(semanticDatabase, revisions);
          writerOutcome = hosted(() => semanticTransactions.withActorScope(owner.actorUserId, () => ensure.ensure(
            { ...owner, documentVersionId: 'DV-new', roles: [] },
            { original, run: { tenantId: owner.tenantId, parseRunId: original.binding.parseRunId, manifestArtifact: manifest } })))
            .then(value => ({ value }), error => ({ error }));
          await Promise.race([inserted.promise, writerOutcome.then(result => {
            throw result.error ?? new Error('ensure returned before its INSERT barrier');
          })]);
          resume.resolve();
          await waitForBlocked(admin, saveSession.pid, writerSession.pid, 'ensure-first-revision');
          commit.resolve();
          const writerResult = await writerOutcome; assert.equal(writerResult.error, undefined);
          assert.equal(writerResult.value.semanticRevision, 1);
          const savedResult = await outcome;
          const [head] = await admin`SELECT current_revision,current_summary_ref FROM derived_summary WHERE summary_id=${p.receipt.summaryId}`;
          console.log(JSON.stringify({ SemanticEnsureFirstSaveOutcome: { before: [], semanticRevision: writerResult.value.semanticRevision,
            saved: Boolean(savedResult.value), errorCode: savedResult.error?.message ?? null, head } }));
          assert.match(savedResult.error?.message ?? '', /DERIVED_SUMMARY_CONTEXT_CHANGED/u);
          assert.deepEqual(head, { current_revision: 0, current_summary_ref: null });
          assert.equal((await admin`SELECT * FROM derived_summary_revision WHERE summary_id=${p.receipt.summaryId}`).length, 0);
          const [attempt] = await admin`SELECT status,error_code FROM action_attempt WHERE operation_ref=${p.receipt.attemptRef}`;
          assert.deepEqual(attempt, { status: 'CONFLICT', error_code: 'DERIVED_SUMMARY_CONTEXT_CHANGED' });
        } finally {
          resume.resolve(); commit.resolve(); await outcome; if (writerOutcome) await writerOutcome;
          members.verifyOriginalEvidence = oldVerify;
        }
        const fresh = await prepared('semantic-ensure-new-observation', p.receipt.summaryId, [newMember]);
        assert.deepEqual(fresh.lease.task.contextBasis.sources[0].semanticRevisions,
          [{ parseRunId: 'PR-summary-new', parseRevision: 1, semanticRevision: 1 }]);
        assert.equal((await hosted(() => runtime.save(fresh.input))).revision, 1);
        await hosted(() => runtime.finish({ ...fresh.target, ...claimFence(fresh.lease), requestId: fresh.input.requestId }));
      });
      await t.test('semantic writer commits between SAVE checks: old first SAVE rejects without advancing head', async () => {
        const chosen = { ...request, requestId: 'semantic-first-save' };
        const receipt = await browser(() => summaries.create(chosen, actor));
        const target = { summaryId: receipt.summaryId, attemptRef: receipt.attemptRef, scope };
        const lease = await hosted(() => runtime.claim(target));
        const ref = lease.task.modelInput.members[0].evidenceRef;
        await hosted(() => runtime.readMemberWork({ ...target, ...claimFence(lease), evidenceRefs: [ref], purpose: 'Read exact saved member' }));
        const input = { ...target, ...claimFence(lease), requestId: chosen.requestId, expectedSummaryRevision: 0,
          contentJson: JSON.stringify({ headline: 'Semantic candidate', listBrief: 'Selected work only',
            body: `Retained candidate. [[${ref}]]`, limitations: ['Constructed material only'] }) };
        const reached = deferred(); const resume = deferred();
        const originalVerify = members.verifyOriginalEvidence;
        members.verifyOriginalEvidence = async (...args) => { await originalVerify.apply(members, args); reached.resolve(); await resume.promise; };
        const save = hosted(() => runtime.save(input));
        // Attach the rejection handler immediately while SAVE is paused outside its DB transaction.
        const outcome = save.then(value => ({ value }), error => ({ error }));
        try {
          await reached.promise;
          await appendSemantic(2);
          resume.resolve();
          const result = await outcome;
          const [head] = await admin`SELECT current_revision,current_summary_ref FROM derived_summary WHERE summary_id=${receipt.summaryId}`;
          console.log(JSON.stringify({ SemanticFirstSaveOutcome: { saved: Boolean(result.value), savedRevision: result.value?.revision,
            errorCode: result.error?.message ?? null, head } }));
          assert.match(result.error?.message ?? '', /DERIVED_SUMMARY_CONTEXT_CHANGED/u,
            'a real semantic append after initial SAVE validation must reject the first SAVE');
          assert.deepEqual(head, { current_revision: 0, current_summary_ref: null });
          const rows = await admin`SELECT summary_ref FROM derived_summary_revision WHERE summary_id=${receipt.summaryId}`;
          assert.equal(rows.length, 0);
          const [attempt] = await admin`SELECT status,error_code FROM action_attempt WHERE operation_ref=${receipt.attemptRef}`;
          assert.deepEqual(attempt, { status: 'CONFLICT', error_code: 'DERIVED_SUMMARY_CONTEXT_CHANGED' });
        } finally {
          resume.resolve(); await outcome;
          members.verifyOriginalEvidence = originalVerify;
          await hosted(() => runtime.cancel({ ...target, reason: 'Independent semantic test cleanup' }));
        }
      });
      await t.test('semantic writer holds document lock: SAVE waits, rejects, and the next round observes the new revision', async () => {
        const p = await prepared('semantic-writer-wins');
        const reached = deferred(); const resume = deferred(); const inserted = deferred(); const commit = deferred();
        const oldVerify = members.verifyOriginalEvidence;
        const versions = await admin`SELECT * FROM dm_document_version ORDER BY document_version_id`;
        const firstSemantic = await admin`SELECT * FROM dm_document_semantic_revision WHERE semantic_revision=1`;
        members.verifyOriginalEvidence = async (...args) => { await oldVerify.apply(members, args); reached.resolve(); await resume.promise; };
        const outcome = hosted(() => runtime.save(p.input)).then(value => ({ value }), error => ({ error }));
        let writerOutcome;
        try {
          await reached.promise;
          writerOutcome = appendSemantic(3, { transaction: callback => semanticDatabase.transaction(async tx => {
            const value = await callback(tx); inserted.resolve(); await commit.promise; return value;
          }) }).then(value => ({ value }), error => ({ error }));
          await inserted.promise; resume.resolve();
          await waitForBlocked(admin, saveSession.pid, writerSession.pid, 'writer-first');
          commit.resolve(); assert.equal((await writerOutcome).value.semanticRevision, 3);
          assert.match((await outcome).error?.message ?? '', /DERIVED_SUMMARY_CONTEXT_CHANGED/u);
          const [head] = await admin`SELECT current_revision,current_summary_ref FROM derived_summary WHERE summary_id=${p.receipt.summaryId}`;
          assert.deepEqual(head, { current_revision: 0, current_summary_ref: null });
          assert.equal((await admin`SELECT summary_ref FROM derived_summary_revision WHERE summary_id=${p.receipt.summaryId}`).length, 0);
        } finally {
          resume.resolve(); commit.resolve(); await outcome; if (writerOutcome) await writerOutcome;
          members.verifyOriginalEvidence = oldVerify;
        }
        const fresh = await prepared('semantic-new-observation', p.receipt.summaryId);
        assert.deepEqual(fresh.lease.task.contextBasis.sources[0].semanticRevisions,
          [{ parseRunId: 'PR-summary-source', parseRevision: 1, semanticRevision: 3 }]);
        const saved = await hosted(() => runtime.save(fresh.input));
        assert.equal(saved.revision, 1, 'an unchanged new observation remains eligible for SAVE');
        await hosted(() => runtime.finish({ ...fresh.target, ...claimFence(fresh.lease), requestId: fresh.input.requestId }));
        const [before] = await admin`SELECT content_json FROM derived_summary_revision WHERE summary_ref=${saved.summaryRef}`;
        await appendSemantic(4);
        const history = await browser(() => summaries.readRevision(fresh.target.summaryId, saved.summaryRef, actor));
        assert.equal(history.contextStatus.state, 'RECHECK_REQUIRED');
        assert.ok(history.contextStatus.reasons.includes('CHANGED_SOURCES'));
        assert.equal((await hosted(() => runtime.save(fresh.input))).replay, true, 'a durable historical save remains replayable');
        await admin`UPDATE summary_test_document_acl SET allowed=false WHERE document_version_id='DV-old'`;
        try {
          await assert.rejects(browser(() => summaries.readRevision(fresh.target.summaryId, saved.summaryRef, actor)), /UNAVAILABLE/u);
          await assert.rejects(hosted(() => runtime.readSaved({ ...fresh.target, requestId: fresh.input.requestId })), /UNAVAILABLE/u);
        } finally { await admin`UPDATE summary_test_document_acl SET allowed=true WHERE document_version_id='DV-old'`; }
        const [after] = await admin`SELECT content_json FROM derived_summary_revision WHERE summary_ref=${saved.summaryRef}`;
        assert.deepEqual(after, before, 'semantic changes and authorized/denied reads do not rewrite historical content or basis');
        assert.deepEqual(await admin`SELECT * FROM dm_document_version ORDER BY document_version_id`, versions);
        assert.deepEqual(await admin`SELECT * FROM dm_document_semantic_revision WHERE semantic_revision=1`, firstSemantic);
      });
      await t.test('SAVE holds document lock through final comparison and CAS: real semantic writer waits until SAVE commits', async () => {
        const p = await prepared('semantic-save-wins');
        const reached = deferred(); const commit = deferred();
        const oldVerify = members.verifyOriginalEvidence; const oldBasis = repository.contextBasis;
        let finalPhase = false; let writerOutcome;
        members.verifyOriginalEvidence = async (...args) => { await oldVerify.apply(members, args); finalPhase = true; };
        repository.contextBasis = async (...args) => {
          const basis = await oldBasis.apply(repository, args);
          if (finalPhase) { finalPhase = false; reached.resolve(); await commit.promise; }
          return basis;
        };
        const outcome = hosted(() => runtime.save(p.input)).then(value => ({ value }), error => ({ error }));
        try {
          await reached.promise;
          writerOutcome = appendSemantic(5).then(value => ({ value }), error => ({ error }));
          await waitForBlocked(admin, writerSession.pid, saveSession.pid, 'save-first');
          commit.resolve(); const result = await outcome; assert.equal(result.value.revision, 1);
          assert.equal((await writerOutcome).value.semanticRevision, 5);
          const [saved] = await admin`SELECT content_json FROM derived_summary_revision WHERE summary_ref=${result.value.summaryRef}`;
          assert.equal(saved.content_json.contextBasis.sources[0].semanticRevisions[0].semanticRevision, 4);
          assert.equal((await browser(() => summaries.readRevision(p.target.summaryId, result.value.summaryRef, actor))).contextStatus.state, 'RECHECK_REQUIRED');
          await hosted(() => runtime.finish({ ...p.target, ...claimFence(p.lease), requestId: p.input.requestId }));
        } finally {
          commit.resolve(); await outcome; if (writerOutcome) await writerOutcome;
          members.verifyOriginalEvidence = oldVerify; repository.contextBasis = oldBasis;
        }
      });
      await t.test('published parse writer is fenced without semantic append; historical reads and legacy bases remain authorized', async () => {
        // Expand only this disposable fixture to exercise the real reserve/lease/
        // stage/progress/publish repository; no production DDL or RLS is changed.
        await admin.unsafe(`ALTER TABLE dm_document_version ADD COLUMN document_id varchar,
          ADD COLUMN source_artifact_id varchar, ADD COLUMN pdf_sha256 varchar, ADD COLUMN byte_length bigint;
          ALTER TABLE dm_document_parse_run ADD COLUMN id uuid DEFAULT gen_random_uuid(),
          ADD COLUMN actor_user_id varchar, ADD COLUMN request_id varchar, ADD COLUMN expected_published_revision integer,
          ADD COLUMN bucket_id varchar, ADD COLUMN artifact_progress jsonb NOT NULL DEFAULT '[]', ADD COLUMN pending_object jsonb,
          ADD COLUMN lease_owner varchar, ADD COLUMN lease_token varchar, ADD COLUMN lease_generation integer NOT NULL DEFAULT 0,
          ADD COLUMN lease_expires_at timestamptz, ADD COLUMN cancel_requested_at timestamptz,
          ADD COLUMN error_code varchar, ADD COLUMN error_message text, ADD COLUMN started_at timestamptz DEFAULT now(),
          ADD COLUMN deadline_at timestamptz, ADD COLUMN completed_at timestamptz;
          CREATE UNIQUE INDEX summary_test_parse_revision ON dm_document_parse_run(tenant_id,document_version_id,parse_revision);
          CREATE UNIQUE INDEX summary_test_parse_active ON dm_document_parse_run(tenant_id,document_version_id) WHERE status IN ('RUNNING','STAGING');
          CREATE TABLE engineering_search_projection_pending(id uuid DEFAULT gen_random_uuid(),tenant_id varchar,exact_revision_ref varchar,
            owner_kind varchar,owner_id varchar,subject_id varchar,last_error text,attempts integer,source_next_offset integer DEFAULT 0,
            UNIQUE(tenant_id,exact_revision_ref));
          GRANT INSERT ON dm_document_parse_run TO authenticated,service_role;
          GRANT SELECT,INSERT ON engineering_search_projection_pending TO authenticated,service_role;`);
        await admin`UPDATE dm_document_version SET document_id='DOC-summary',source_artifact_id='SRC-summary',
          pdf_sha256=${'a'.repeat(64)},byte_length=100 WHERE document_version_id='DV-old'`;
        const parseScope = { ...owner, documentVersionId: 'DV-old' };
        const leases = new DocumentStepLeaseRepository(semanticDatabase);
        const parser = new DocumentParsingRepository(semanticDatabase, leases);
        const asWriter = operation => hosted(() => semanticTransactions.withActorScope(owner.actorUserId, operation));
        const prepareParse = async (requestId, expectedPublishedRevision) => asWriter(async () => {
          const { row } = await parser.reserve(parseScope, { requestId, expectedPublishedRevision, bucketId: 'summary-test-bucket',
            sourceBinding: { documentVersionId: 'DV-old', documentId: 'DOC-summary', familyId: 'FAMILY-summary',
              sourceArtifactId: 'SRC-summary', pdfSha256: 'a'.repeat(64), byteLength: 100 } });
          const fence = await leases.claim(parseScope, row.parseRunId, 'SUMMARY-PARSE-TEST');
          assert.ok(fence); await parser.stage(parseScope, row.parseRunId, fence);
          const manifest = { role: 'MANIFEST', relativePath: 'manifest.json', bucketId: row.bucketId,
            filePath: `wiselink/parsed/DV-old/${row.parseRunId}/manifest.json`, providerObjectId: 'synthetic-file',
            mediaType: 'application/json', byteLength: 321, sha256: 'f'.repeat(64), readback: 'VERIFIED' };
          await parser.progress(parseScope, row.parseRunId, [manifest], fence);
          return { row, fence, manifest };
        });
        const semanticBefore = await admin`SELECT * FROM dm_document_semantic_revision ORDER BY document_version_id,parse_revision,semantic_revision`;
        const exactParseBefore = await admin`SELECT * FROM dm_document_parse_run WHERE parse_run_id='PR-summary-source'`;
        const versionsBefore = await admin`SELECT * FROM dm_document_version ORDER BY document_version_id`;
        const p = await prepared('published-parse-writer-first');
        const next = await prepareParse('published-parse-two', 1);
        const reached = deferred(); const resume = deferred(); const published = deferred(); const commit = deferred();
        const oldVerify = members.verifyOriginalEvidence; let writerOutcome;
        members.verifyOriginalEvidence = async (...args) => { await oldVerify.apply(members, args); reached.resolve(); await resume.promise; };
        const outcome = hosted(() => runtime.save(p.input)).then(value => ({ value }), error => ({ error }));
        try {
          await reached.promise;
          const writer = new DocumentParsingRepository({ transaction: callback => semanticDatabase.transaction(async tx => {
            const value = await callback(tx); published.resolve(); await commit.promise; return value;
          }) }, leases);
          writerOutcome = asWriter(() => writer.publish(parseScope, next.row.parseRunId, next.manifest, next.fence))
            .then(value => ({ value }), error => ({ error }));
          await Promise.race([published.promise, writerOutcome.then(result => {
            throw result.error ?? new Error('publish returned before its commit barrier');
          })]);
          resume.resolve();
          await waitForBlocked(admin, saveSession.pid, writerSession.pid, 'published-parse-writer-first');
          commit.resolve(); const writerResult = await writerOutcome; assert.equal(writerResult.error, undefined);
          const savedResult = await outcome;
          const [head] = await admin`SELECT current_revision,current_summary_ref FROM derived_summary WHERE summary_id=${p.receipt.summaryId}`;
          console.log(JSON.stringify({ PublishedParseWriterFirst: { parseRunId: writerResult.value.parseRunId,
            parseRevision: writerResult.value.parseRevision, saved: Boolean(savedResult.value), errorCode: savedResult.error?.message ?? null, head } }));
          assert.match(savedResult.error?.message ?? '', /DERIVED_SUMMARY_CONTEXT_CHANGED/u,
            'a real published parse change without semantic append must reject the first SAVE');
          assert.deepEqual(head, { current_revision: 0, current_summary_ref: null });
          assert.equal((await admin`SELECT * FROM derived_summary_revision WHERE summary_id=${p.receipt.summaryId}`).length, 0);
          const [attempt] = await admin`SELECT status,error_code FROM action_attempt WHERE operation_ref=${p.receipt.attemptRef}`;
          assert.deepEqual(attempt, { status: 'CONFLICT', error_code: 'DERIVED_SUMMARY_CONTEXT_CHANGED' });
        } finally {
          resume.resolve(); commit.resolve(); await outcome; if (writerOutcome) await writerOutcome;
          members.verifyOriginalEvidence = oldVerify;
        }
        const fresh = await prepared('published-parse-fresh', p.receipt.summaryId);
        assert.deepEqual(fresh.lease.task.contextBasis.sources[0].publishedParse,
          { parseRunId: next.row.parseRunId, parseRevision: 2 });
        const saved = await hosted(() => runtime.save(fresh.input)); assert.equal(saved.revision, 1);
        await hosted(() => runtime.finish({ ...fresh.target, ...claimFence(fresh.lease), requestId: fresh.input.requestId }));
        const [historyBefore] = await admin`SELECT content_json FROM derived_summary_revision WHERE summary_ref=${saved.summaryRef}`;
        // A newer active or cancelled parse is not the current published identity.
        const cancelled = await prepareParse('published-parse-cancelled', 2);
        const saveFirst = await prepared('published-parse-save-first');
        assert.deepEqual(saveFirst.lease.task.contextBasis.sources[0].publishedParse,
          { parseRunId: next.row.parseRunId, parseRevision: 2 });
        await asWriter(() => leases.cancel(parseScope, cancelled.row.parseRunId));
        await asWriter(() => leases.cancel(parseScope, next.row.parseRunId));
        assert.equal((await asWriter(() => parser.read(parseScope, next.row.parseRunId))).status, 'PUBLISHED',
          'cancellation only changes active parses, never the published identity');
        const later = await prepareParse('published-parse-four', 2);
        const locked = deferred(); const saveCommit = deferred(); const oldBasis = repository.contextBasis;
        let finalPhase = false; let laterOutcome;
        members.verifyOriginalEvidence = async (...args) => { await oldVerify.apply(members, args); finalPhase = true; };
        repository.contextBasis = async (...args) => {
          const basis = await oldBasis.apply(repository, args);
          if (finalPhase) { finalPhase = false; locked.resolve(); await saveCommit.promise; }
          return basis;
        };
        const saveOutcome = hosted(() => runtime.save(saveFirst.input)).then(value => ({ value }), error => ({ error }));
        try {
          await Promise.race([locked.promise, saveOutcome.then(result => {
            throw result.error ?? new Error('SAVE returned before its final locked comparison');
          })]);
          laterOutcome = asWriter(() => parser.publish(parseScope, later.row.parseRunId, later.manifest, later.fence))
            .then(value => ({ value }), error => ({ error }));
          await waitForBlocked(admin, writerSession.pid, saveSession.pid, 'published-parse-save-first');
          saveCommit.resolve(); const result = await saveOutcome; assert.equal(result.error, undefined);
          assert.equal(result.value.revision, 1); assert.equal((await laterOutcome).value.parseRevision, 4);
          const [row] = await admin`SELECT content_json FROM derived_summary_revision WHERE summary_ref=${result.value.summaryRef}`;
          assert.deepEqual(row.content_json.contextBasis.sources[0].publishedParse,
            { parseRunId: next.row.parseRunId, parseRevision: 2 });
          console.log(JSON.stringify({ PublishedParseSaveFirst: { savedRevision: result.value.revision,
            savedPublishedParse: row.content_json.contextBasis.sources[0].publishedParse, laterPublishedRevision: 4 } }));
          await hosted(() => runtime.finish({ ...saveFirst.target, ...claimFence(saveFirst.lease), requestId: saveFirst.input.requestId }));
        } finally {
          saveCommit.resolve(); await saveOutcome; if (laterOutcome) await laterOutcome;
          members.verifyOriginalEvidence = oldVerify; repository.contextBasis = oldBasis;
        }
        const history = await browser(() => summaries.readRevision(fresh.target.summaryId, saved.summaryRef, actor));
        assert.equal(history.contextStatus.state, 'RECHECK_REQUIRED');
        assert.ok(history.contextStatus.reasons.includes('CHANGED_SOURCES'));
        assert.equal(history.contextStatus.sourceCurrentness, 'UNKNOWN');
        assert.ok(history.contextStatus.reasons.includes('DOCUMENT_LIFECYCLE_NOT_FENCED'));
        assert.ok(!history.contextStatus.reasons.includes('PARSE_CURRENTNESS_NOT_FENCED'));
        assert.equal((await hosted(() => runtime.save(fresh.input))).replay, true);
        await admin`UPDATE summary_test_document_acl SET allowed=false WHERE document_version_id='DV-old'`;
        try {
          await assert.rejects(browser(() => summaries.readRevision(fresh.target.summaryId, saved.summaryRef, actor)), /UNAVAILABLE/u);
          await assert.rejects(hosted(() => runtime.readSaved({ ...fresh.target, requestId: fresh.input.requestId })), /UNAVAILABLE/u);
        } finally { await admin`UPDATE summary_test_document_acl SET allowed=true WHERE document_version_id='DV-old'`; }
        assert.deepEqual((await admin`SELECT content_json FROM derived_summary_revision WHERE summary_ref=${saved.summaryRef}`)[0], historyBefore);
        assert.deepEqual(await admin`SELECT * FROM dm_document_semantic_revision ORDER BY document_version_id,parse_revision,semantic_revision`, semanticBefore);
        assert.deepEqual(await admin`SELECT * FROM dm_document_parse_run WHERE parse_run_id='PR-summary-source'`, exactParseBefore);
        assert.deepEqual(await admin`SELECT * FROM dm_document_version ORDER BY document_version_id`, versionsBefore);
        // Simulate an old durable basis with no publishedParse observation. Its
        // exact saved body stays readable, but comparison never treats it as null.
        const legacy = { ...structuredClone(historyBefore.content_json), summaryRef: 'DSR-summary-legacy-parse', revision: 2 };
        delete legacy.contextBasis.sources[0].publishedParse;
        await admin`INSERT INTO derived_summary_revision(summary_ref,summary_id,tenant_id,actor_user_id,revision,request_id,attempt_id,content_json)
          SELECT ${legacy.summaryRef},summary_id,tenant_id,actor_user_id,2,'summary-legacy-parse-fixture',attempt_id,${admin.json(legacy)}
          FROM derived_summary_revision WHERE summary_ref=${saved.summaryRef}`;
        const legacyRead = await browser(() => summaries.readRevision(fresh.target.summaryId, legacy.summaryRef, actor));
        assert.equal(legacyRead.contextStatus.state, 'RECHECK_REQUIRED');
        assert.equal(typeof legacyRead.revision.content.body, 'string');
        assert.equal(legacyRead.revision.content.body, history.revision.content.body);
        assert.equal(legacyRead.revision.content.body, historyBefore.content_json.content.body);
        await admin`UPDATE summary_test_document_acl SET allowed=false WHERE document_version_id='DV-old'`;
        try {
          await assert.rejects(browser(() => summaries.readRevision(fresh.target.summaryId, legacy.summaryRef, actor)), /UNAVAILABLE/u);
        } finally { await admin`UPDATE summary_test_document_acl SET allowed=true WHERE document_version_id='DV-old'`; }
        assert.deepEqual((await admin`SELECT content_json FROM derived_summary_revision WHERE summary_ref=${legacy.summaryRef}`)[0].content_json, legacy);
        assert.deepEqual((await admin`SELECT content_json FROM derived_summary_revision WHERE summary_ref=${saved.summaryRef}`)[0], historyBefore);
        console.log(JSON.stringify({ PublishedParseHistory: { currentPublishedRevision: 4, semanticRowsUnchanged: true,
          oldParseUnchanged: true, savedBodyUnchanged: true, permissionRechecked: true, legacyBasisReadable: true } }));
      });
      let accepted;
      await t.test('native actor admits a fixed work and explicit GLM route; replay does not create another task', async () => {
        accepted = await browser(() => summaries.create(request, actor));
        assert.equal(accepted.status, 'QUEUED');
        assert.equal((await browser(() => summaries.create(request, actor))).created, false);
        await assert.rejects(browser(() => summaries.create({ ...request, instruction: 'changed' }, actor)), /REQUEST_ID_REUSED/u);
        assert.throws(() => summaries.create(request, { ...actor, objectAccessActor: undefined }), /IDENTITY_HANDOFF/u);
        await assert.rejects(context('other-actor', false, () => summaries.read(accepted.summaryId,
          nativeActor('other-actor', owner.tenantId))), /UNAVAILABLE/u);
        const rows = await admin`SELECT subject_kind,work_item_id,matter_id,summary_id,execution_model_json FROM action_attempt WHERE operation_ref=${accepted.attemptRef}`;
        assert.equal(rows[0].subject_kind, 'DERIVED_SUMMARY');
        assert.equal(rows[0].work_item_id, null); assert.equal(rows[0].matter_id, null);
        assert.equal(JSON.parse(rows[0].execution_model_json).modelRef, 'miaoda/glm-5.3');
      });
      await t.test('DB CHECK rejects a fake WI summary action while retaining ordinary WI and real summary subjects', async () => {
        const insert = (attemptId, actionType) => admin`INSERT INTO action_attempt(attempt_id,work_item_id,subject_kind,attempt_no,
          tenant_id,actor_user_id,action_type,trigger_request_id,request_origin,status)
          VALUES (${attemptId},'WI-summary','WORK_ITEM',2,${owner.tenantId},${owner.actorUserId},${actionType},
            ${attemptId},'OPENCLAW_MCP_V1','SUCCEEDED')`;
        await assert.rejects(insert('ATT-fake-summary-WI', 'OPENCLAW_DERIVED_SUMMARY'),
          error => databaseCode(error) === '23514' && databaseConstraint(error) === 'ck_action_attempt_summary_identity');
        await insert('ATT-ordinary-WI', 'OPENCLAW_DYNAMIC_EVALUATION');
        await assert.rejects(admin`INSERT INTO action_attempt(attempt_id,summary_id,subject_kind,work_item_id,attempt_no,
          tenant_id,actor_user_id,action_type,trigger_request_id,request_origin,status,input_revision,base_revision,
          summary_request_command_json,summary_delegated_principal_id) VALUES ('ATT-no-summary-head','DS-absent','DERIVED_SUMMARY',NULL,1,
            ${owner.tenantId},${owner.actorUserId},'OPENCLAW_DERIVED_SUMMARY','missing-parent','OPENCLAW_MCP_V1','SUCCEEDED',0,0,'{}',${scope.principalId})`,
        error => databaseCode(error) === '23503' && databaseConstraint(error) === 'fk_action_attempt_summary_head');
        await assert.rejects(admin`INSERT INTO derived_summary(summary_id,tenant_id,actor_user_id,create_request_id,scope_json,
          members_json,current_revision,current_summary_ref) VALUES ('DS-no-saved-pointer',${owner.tenantId},${owner.actorUserId},
            'missing-pointer',${JSON.stringify(request.scope)}::jsonb,'[]'::jsonb,1,'DSR-absent')`,
        error => databaseCode(error) === '23503' && databaseConstraint(error) === 'fk_derived_summary_saved_pointer');
        const rows = await admin`SELECT subject_kind,action_type,summary_id FROM action_attempt
          WHERE attempt_id='ATT-ordinary-WI' OR operation_ref=${accepted.attemptRef}`;
        assert.equal(rows.length, 2);
        assert.ok(rows.some(row => row.subject_kind === 'WORK_ITEM' && row.action_type === 'OPENCLAW_DYNAMIC_EVALUATION' && row.summary_id === null));
        assert.ok(rows.some(row => row.subject_kind === 'DERIVED_SUMMARY' && row.action_type === 'OPENCLAW_DERIVED_SUMMARY' && row.summary_id === accepted.summaryId));
      });
      await t.test('platform ACLs cannot expose the service resolver to ordinary roles, forged claims or TRUNCATE', async () => {
        const resolver = querySql`SELECT derived_summary_runtime_actor(${owner.tenantId},${accepted.summaryId},
          ${accepted.attemptRef},${scope.principalId}) AS actor`;
        const [privilege] = await admin`SELECT has_function_privilege('authenticated_public',
          'derived_summary_runtime_actor(varchar,varchar,varchar,varchar)','EXECUTE') AS allowed`;
        assert.equal(privilege.allowed, true, 'ordinary invocation is possible under platform ACLs, so the function must reject it itself');
        await assert.rejects(browser(() => database.execute(resolver)), serviceRoleDenied);
        await assert.rejects(browser(() => database.execute(querySql`WITH claims AS MATERIALIZED (SELECT
          set_config('request.jwt.claims', ${JSON.stringify({ role: 'service_role', sub: owner.actorUserId, tenantId: owner.tenantId })}, true),
          set_config('request.jwt.claim.role','service_role',true),set_config('app.role_ids','service_role_public',true))
          SELECT derived_summary_runtime_actor(${owner.tenantId},${accepted.summaryId},${accepted.attemptRef},${scope.principalId}) FROM claims`)), serviceRoleDenied);
        await assert.rejects(context(undefined, false, () => database.execute(resolver)), serviceRoleDenied);
        const [binding] = await hosted(() => database.execute(resolver));
        assert.equal(binding.actor, owner.actorUserId);
        const [wrongTenant] = await hosted(() => database.execute(querySql`SELECT derived_summary_runtime_actor('other-tenant',
          ${accepted.summaryId},${accepted.attemptRef},${scope.principalId}) AS actor`));
        assert.equal(wrongTenant.actor, null);
        const [anon] = await context(undefined, false, () => database.execute(querySql`WITH forged_actor AS MATERIALIZED (
          SELECT set_config('app.user_id',${owner.actorUserId},true)) SELECT
          derived_summary_attempt_owned(${owner.tenantId},${owner.actorUserId},${accepted.summaryId}) AS allowed,
          derived_summary_reading_sources_owned(${owner.tenantId},${owner.actorUserId},'{"members":[],"evidence":[]}'::jsonb) AS sources
          FROM forged_actor`));
        assert.equal(anon.allowed, false); assert.equal(anon.sources, false);
        await browser(() => database.execute(querySql`INSERT INTO derived_summary(summary_id,tenant_id,actor_user_id,
          create_request_id,scope_json,members_json) VALUES ('DS-native-draft',${owner.tenantId},${owner.actorUserId},'native-draft',
          ${JSON.stringify(request.scope)}::jsonb,'[]'::jsonb)`));
        const deleteDraft = () => database.execute(querySql`DELETE FROM derived_summary WHERE summary_id='DS-native-draft' RETURNING summary_id`);
        assert.equal((await browser(deleteDraft)).length, 0, 'ordinary head DELETE remains unavailable under broad CRUD');
        assert.equal((await hosted(() => transactions.withActorScope(owner.actorUserId, deleteDraft))).length, 0,
          'service head DELETE remains unavailable under broad CRUD');
        assert.equal((await context(undefined, false, () => database.execute(querySql`SELECT summary_id FROM derived_summary`))).length, 0);
        for (const run of [browser, hosted]) await assert.rejects(run(() => database.execute(querySql`
          TRUNCATE derived_summary,derived_summary_revision CASCADE`)),
        error => databaseCode(error) === '42501' && databaseMessageIncludes(error, 'DERIVED_SUMMARY_TRUNCATE_DENIED'));
        // Unlike a custom JWT/app claim GUC, PostgreSQL validates its special
        // role setting against the session user's actual role memberships.
        const loginUrl = new URL(databaseUrl); loginUrl.username = 'summary_ordinary_login'; loginUrl.password = '';
        const ordinary = postgres(loginUrl.toString(), { max: 1, onnotice() {} });
        try {
          await assert.rejects(ordinary.begin(async sql => {
            await sql.unsafe('SET LOCAL ROLE authenticated_public');
            await sql`SELECT set_config('role','service_role_public',true)`;
          }), error => databaseCode(error) === '42501');
        } finally { await ordinary.end({ timeout: 5 }); }
      });
      const target = () => ({ summaryId: accepted.summaryId, attemptRef: accepted.attemptRef, scope });
      let claim;
      await t.test('exact service delegation claims shared lease; fake service, missing save and stale fence fail', async () => {
        await assert.rejects(hosted(() => runtime.claim({ ...target(), scope: { ...scope, principalId: 'different-service' } })), /UNAVAILABLE/u);
        await assert.rejects(browser(() => runtime.claim(target())), error => databaseCode(error) === '42501');
        claim = await hosted(() => runtime.claim(target()));
        assert.equal(claim.task.taskType, 'OPENCLAW_DERIVED_SUMMARY');
        assert.equal(claim.task.subject.summaryId, accepted.summaryId);
        assert.equal(claim.task.modelInput.members[0].member.workRef, 'JA-summary23');
        assert.match(claim.task.modelInput.members[0].limitations.join(' '), /DV-old.*本地目录当前选择DV-new.*未被本成员覆盖.*发布方现行有效状态未核/u);
        assert.equal(claim.task.executionModel.modelRef, 'miaoda/glm-5.3');
        const sourceCopy = { members: claim.task.modelInput.members, evidence: claim.task.modelInput.evidence };
        const [eligible] = await browser(() => database.execute(querySql`SELECT
          derived_summary_reading_sources_owned(${owner.tenantId},${owner.actorUserId},${JSON.stringify(sourceCopy)}::jsonb) AS sources,
          EXISTS(SELECT 1 FROM action_attempt WHERE operation_ref=${accepted.attemptRef} AND status='RUNNING'
            AND lease_token IS NOT NULL AND lease_expires_at>CURRENT_TIMESTAMP) AS active`));
        assert.equal(eligible.sources, true); assert.equal(eligible.active, true);
        await assert.rejects(browser(() => database.execute(querySql`INSERT INTO derived_summary_revision(summary_ref,summary_id,
          tenant_id,actor_user_id,revision,request_id,attempt_id,content_json) VALUES ('DSR-native-forged',${accepted.summaryId},
          ${owner.tenantId},${owner.actorUserId},1,${request.requestId},${claim.task.actionAttemptId},${JSON.stringify(sourceCopy)}::jsonb)`)),
        error => databaseCode(error) === '42501');
        await assert.rejects(hosted(() => runtime.finish({ ...target(), ...claimFence(claim), requestId: request.requestId })), /REQUIRES_SAVED/u);
        await assert.rejects(hosted(() => runtime.heartbeat({ ...target(), ...claimFence(claim), leaseGeneration: 0 })), /LEASE_FENCE/u);
      });
      await t.test('registered source-only support saves without direct member coverage; delivery and unknown-ref checks remain', async () => {
        const sourceRequest = { ...request, requestId: 'ATA4-source-only-request' };
        const receipt = await browser(() => summaries.create(sourceRequest, actor));
        const sourceTarget = { summaryId: receipt.summaryId, attemptRef: receipt.attemptRef, scope };
        const lease = await hosted(() => runtime.claim(sourceTarget));
        const ref = lease.task.modelInput.members[0].evidenceRef;
        const body = { headline: 'Candidate supported by the selected original', listBrief: 'Limited selected material',
          body: `The original requirement remains conditional. [[${source.evidenceRef}]]`,
          limitations: [`The saved member was delivered, without a direct body citation. [[${ref}]]`] };
        const input = { ...sourceTarget, ...claimFence(lease), requestId: sourceRequest.requestId,
          expectedSummaryRevision: 0, contentJson: JSON.stringify(body) };
        await assert.rejects(hosted(() => runtime.save(input)), /MEMBER_READ_REQUIRED/u);
        await hosted(() => runtime.readMemberWork({ ...sourceTarget, ...claimFence(lease),
          evidenceRefs: [ref], purpose: 'Deliver exact saved member before summarizing originals' }));
        for (const content of [
          { ...body, body: 'No body citation' },
          { ...body, body: `Registered [[${source.evidenceRef}]] and unknown [[foreign]]` },
          { ...body, limitations: ['Unknown limitation [[foreign]]'] },
        ]) await assert.rejects(hosted(() => runtime.save({ ...input, contentJson: JSON.stringify(content) })), /CITATION_INVALID/u);
        const savedSource = await hosted(() => runtime.save(input));
        const readback = await hosted(() => runtime.readSaved({ ...sourceTarget, requestId: sourceRequest.requestId }));
        assert.equal(readback.receipt.summaryRef, savedSource.summaryRef);
        assert.equal(readback.summary.content.body, body.body);
        assert.equal(readback.summary.coverage[0].delivered, true);
        assert.equal(readback.summary.coverage[0].used, false);
        assert.deepEqual(readback.summary.coverage[0].rootRefs, [source.evidenceRef]);
        assert.deepEqual(readback.summary.usedEvidenceRefs, [source.evidenceRef, ref]);
        assert.equal((await hosted(() => runtime.save(input))).replay, true);
        assert.equal((await hosted(() => runtime.finish({ ...sourceTarget, ...claimFence(lease),
          requestId: sourceRequest.requestId }))).status, 'SUCCEEDED');
        const exact = await browser(() => summaries.readRevision(sourceTarget.summaryId, savedSource.summaryRef, actor));
        assert.equal(exact.revision.content.body, body.body);
        assert.equal(exact.revision.coverage[0].used, false);
      });
      let saved;
      let content;
      await t.test('actual member/source reads precede atomic save, exact readback and durable FINISH', async () => {
        const ref = claim.task.modelInput.members[0].evidenceRef;
        content = { headline: 'Selected TLS candidate', listBrief: 'One selected old publication; newer version not covered',
          body: `Monitoring and measures remain conditional. [[${ref}]] [[${source.evidenceRef}]]`,
          limitations: ['The newer formal publication is not a selected member.'] };
        const saveInput = { ...target(), ...claimFence(claim), requestId: request.requestId,
          expectedSummaryRevision: 0, contentJson: JSON.stringify(content), provenanceJson: JSON.stringify({
            configuredModelRef: 'miaoda/glm-5.3', actualModel: null, promptVersion: 'summary-test-v1',
            skillVersion: 'test', toolVersions: { derived_summary_attempt: 'v1' } }) };
        await assert.rejects(hosted(() => runtime.save(saveInput)), /MEMBER_READ_REQUIRED/u);
        const read = await hosted(() => runtime.readMemberWork({ ...target(), ...claimFence(claim), evidenceRefs: [ref], purpose: 'Read complete saved work' }));
        assert.equal(read.members[0].issues.length, 2); assert.match(read.members[0].body, /Saved cause/u);
        await assert.rejects(hosted(() => runtime.readSources({ ...target(), ...claimFence(claim), evidenceRefs: ['invented'], purpose: 'invalid' })), /NOT_REGISTERED/u);
        const sources = await hosted(() => runtime.readSources({ ...target(), ...claimFence(claim), evidenceRefs: [source.evidenceRef], purpose: 'Verify exact paragraph' }));
        assert.deepEqual(sources.evidence, [source]);
        saved = await hosted(() => runtime.save(saveInput));
        assert.equal(saved.revision, 1);
        assert.equal((await hosted(() => runtime.save(saveInput))).replay, true);
        const readback = await hosted(() => runtime.readSaved({ ...target(), requestId: request.requestId }));
        assert.equal(readback.summary.summaryRef, saved.summaryRef);
        assert.deepEqual(readback.summary.members[0].rootRefs, [source.evidenceRef]);
        assert.equal(readback.summary.coverage[0].used, true);
        assert.equal(readback.summary.candidateOnly, true);
        assert.equal((await hosted(() => runtime.finish({ ...target(), ...claimFence(claim), requestId: request.requestId }))).status, 'SUCCEEDED');
        assert.equal((await browser(() => summaries.read(accepted.summaryId, actor))).currentSummaryRef, saved.summaryRef);
        for (const run of [browser, operation => hosted(() => transactions.withActorScope(owner.actorUserId, operation))]) {
          const changed = await run(() => database.execute(querySql`UPDATE derived_summary_revision SET content_json='{}'::jsonb
            WHERE summary_ref=${saved.summaryRef} RETURNING summary_ref`));
          const deleted = await run(() => database.execute(querySql`DELETE FROM derived_summary_revision
            WHERE summary_ref=${saved.summaryRef} RETURNING summary_ref`));
          assert.equal(changed.length, 0); assert.equal(deleted.length, 0, 'revision mutations remain unavailable under broad CRUD');
        }
        assert.equal((await context(undefined, false, () => database.execute(querySql`SELECT summary_ref FROM derived_summary_revision`))).length, 0);
        await assert.rejects(browser(() => summaries.request(accepted.summaryId,
          { ...request, requestId: 'stale-request', expectedSummaryRevision: 0 }, actor)), /REVISION_CONFLICT/u);
        await assert.rejects(admin`UPDATE action_attempt SET summary_delegated_principal_id='other' WHERE operation_ref=${accepted.attemptRef}`,
          error => databaseCode(error) === '23514');
        await assert.rejects(admin`UPDATE action_attempt SET operation_ref='AQ-forged' WHERE operation_ref=${accepted.attemptRef}`,
          error => databaseCode(error) === '23514');
        await assert.rejects(admin`UPDATE derived_summary_revision SET request_id='other' WHERE summary_ref=${saved.summaryRef}`,
          error => databaseCode(error) === '23514');
      });
      let upper;
      let upperSaved;
      await t.test('upper ATA2 consumes one exact saved ATA4 and preserves converged roots/limited coverage', async () => {
        upper = await browser(() => summaries.create({ ...request, requestId: 'ATA2-request',
          scope: { ...request.scope, kind: 'ATA2', title: 'Selected ATA46 aggregate', ata4: null },
          members: [{ kind: 'DERIVED_SUMMARY', summaryId: accepted.summaryId, summaryRef: saved.summaryRef, summaryRevision: 1 }] }, actor));
        const upperTarget = { summaryId: upper.summaryId, attemptRef: upper.attemptRef, scope };
        const lease = await hosted(() => runtime.claim(upperTarget));
        const ref = lease.task.modelInput.members[0].evidenceRef;
        const readings = await hosted(() => runtime.readMemberWork({ ...upperTarget, ...claimFence(lease), evidenceRefs: [ref], purpose: 'Read exact child summary' }));
        assert.equal(readings.members[0].leaves[0].workRef, 'JA-summary23');
        assert.deepEqual(readings.members[0].rootRefs, [source.evidenceRef]);
        upperSaved = await hosted(() => runtime.save({ ...upperTarget, ...claimFence(lease), requestId: 'ATA2-request', expectedSummaryRevision: 0,
          contentJson: JSON.stringify({ headline: 'Selected ATA46 subset', listBrief: 'Only one selected ATA4',
            body: `The parent covers only its explicit ATA46-00 child. [[${ref}]]`, limitations: ['Other ATA4 nodes are not covered.'] }) }));
        await hosted(() => runtime.finish({ ...upperTarget, ...claimFence(lease), requestId: 'ATA2-request' }));
        const { revision: reading } = await browser(() => summaries.readRevision(upper.summaryId, upperSaved.summaryRef, actor));
        assert.equal(reading.evidence.length, 1); assert.equal(reading.coverage.length, 1);
        assert.equal(reading.members[0].member.summaryRef, saved.summaryRef);
        assert.match(reading.content.limitations.join(' '), /未覆盖|not covered/u);
      });
      await t.test('historical read remains authorized when V2 adds a later revoked member; metadata list remains discoverable', async () => {
        const laterMember = { ...member, workItemId: 'WI-new', documentVersionId: 'DV-new', workRef: 'JA-new1', workRevision: 1 };
        const receipt = await browser(() => summaries.request(accepted.summaryId, { ...request, requestId: 'ATA4-V2-request',
          expectedSummaryRevision: 1, members: [member, laterMember] }, actor));
        const updatedTarget = { summaryId: accepted.summaryId, attemptRef: receipt.attemptRef, scope };
        const lease = await hosted(() => runtime.claim(updatedTarget));
        const refs = lease.task.modelInput.members.map(item => item.evidenceRef);
        await hosted(() => runtime.readMemberWork({ ...updatedTarget, ...claimFence(lease), evidenceRefs: refs, purpose: 'Read V2 selected members' }));
        const second = await hosted(() => runtime.save({ ...updatedTarget, ...claimFence(lease), requestId: 'ATA4-V2-request', expectedSummaryRevision: 1,
          contentJson: JSON.stringify({ headline: 'V2 selected work', listBrief: 'Later selected source added',
            body: `The original selected work remains a candidate. [[${refs[0]}]]`, limitations: ['Second member was read but is not used in this body.'] }) }));
        await hosted(() => runtime.finish({ ...updatedTarget, ...claimFence(lease), requestId: 'ATA4-V2-request' }));
        await admin`UPDATE summary_test_document_acl SET allowed=false WHERE document_version_id='DV-new'`;
        await assert.rejects(browser(() => summaries.read(accepted.summaryId, actor)), /UNAVAILABLE/u);
        const old = await browser(() => summaries.readRevision(accepted.summaryId, saved.summaryRef, actor));
        assert.equal(old.revision.summaryRef, saved.summaryRef);
        assert.equal(old.currentSummaryRef, second.summaryRef);
        assert.equal(old.currentRevision, 2);
        assert.equal(old.memberNotices.length, 1);
        const catalogue = await browser(() => summaries.list(actor));
        assert.ok(catalogue.some(item => item.summaryId === accepted.summaryId && item.currentSummaryRef === second.summaryRef));
        assert.equal(catalogue.some(item => 'current' in item || 'members' in item), false, 'metadata directory contains no member/source bodies');
      });
      await t.test('new saved work produces exact fresh notices without swapping members; root revocation denies ATA4 and parent', async () => {
        await admin`INSERT INTO assessment_work_revision (assessment_work_revision_id,tenant_id,work_item_id,work_revision,request_id,
          action_attempt_id,based_on_work_item_revision,document_version_id,command_json,content_json,created_by_user_id)
          SELECT 'JA-summary24',tenant_id,work_item_id,24,'JA-save24',action_attempt_id,based_on_work_item_revision,
            document_version_id,command_json,content_json,created_by_user_id FROM assessment_work_revision WHERE assessment_work_revision_id='JA-summary23'`;
        const read = await browser(() => summaries.readRevision(accepted.summaryId, saved.summaryRef, actor));
        assert.equal(read.revision.members[0].member.workRef, 'JA-summary23');
        assert.equal(read.memberNotices[0].current, false);
        await admin`UPDATE summary_test_document_acl SET allowed=false WHERE document_version_id='DV-old'`;
        await assert.rejects(browser(() => summaries.read(accepted.summaryId, actor)), /UNAVAILABLE/u);
        await assert.rejects(browser(() => summaries.readRevision(upper.summaryId, upperSaved.summaryRef, actor)), /UNAVAILABLE/u);
        await assert.rejects(hosted(() => runtime.readSaved({ ...target(), requestId: request.requestId })), /UNAVAILABLE/u);
        const hidden = await browser(() => database.execute(querySql`SELECT summary_ref FROM derived_summary_revision`));
        assert.equal(hidden.length, 0, 'ordinary RLS hides saved bodies after root permission is revoked');
      });
      // All following mutations stay in the fresh owned fixture; restore its ACL
      // after the retained revocation regression before independent writer pairs.
      await admin`UPDATE summary_test_document_acl SET allowed=true`;
      const inWriterScope = operation => hosted(() => semanticTransactions.withActorScope(owner.actorUserId, operation));
      const pauseFinalSave = p => {
        const locked = deferred(); const release = deferred(); const oldVerify = members.verifyOriginalEvidence;
        const oldBasis = repository.contextBasis; let final = false;
        members.verifyOriginalEvidence = async (...args) => { await oldVerify.apply(members, args); final = true; };
        repository.contextBasis = async (...args) => {
          const basis = await oldBasis.apply(repository, args);
          if (final) { final = false; locked.resolve(); await release.promise; } return basis;
        };
        const outcome = hosted(() => runtime.save(p.input)).then(value => ({ value }), error => ({ error }));
        return { locked, release, outcome, async cleanup() { release.resolve(); await outcome;
          members.verifyOriginalEvidence = oldVerify; repository.contextBasis = oldBasis; } };
      };
      const assertUnsavedConflict = async p => {
        assert.deepEqual((await admin`SELECT current_revision,current_summary_ref FROM derived_summary WHERE summary_id=${p.receipt.summaryId}`)[0],
          { current_revision: 0, current_summary_ref: null });
        assert.equal((await admin`SELECT * FROM derived_summary_revision WHERE summary_id=${p.receipt.summaryId}`).length, 0);
        assert.deepEqual((await admin`SELECT status,error_code FROM action_attempt WHERE operation_ref=${p.receipt.attemptRef}`)[0],
          { status: 'CONFLICT', error_code: 'DERIVED_SUMMARY_CONTEXT_CHANGED' });
      };
      await t.test('same-work projection mutation waits on actual SAVE work_item SHARE and later invalidates the exact saved basis', async () => {
        const p = await prepared('projection-save-first'); const paused = pauseFinalSave(p); let writer;
        try {
          await Promise.race([paused.locked.promise, paused.outcome.then(result => { throw result.error ?? new Error('SAVE missed final barrier'); })]);
          const [oldRow] = await admin`SELECT projection_json FROM work_item WHERE work_item_id='WI-summary'`;
          const changed = { ...JSON.parse(oldRow.projection_json), integratedAssessment: { status: 'PARTIAL', engineerReviews: { revision: 1 } } };
          writer = inWriterScope(() => semanticDatabase.update(workItem).set({ projectionJson: JSON.stringify(changed) })
            .where(eq(workItem.workItemId, 'WI-summary')).returning({ id: workItem.workItemId })).then(value => ({ value }), error => ({ error }));
          await waitForBlocked(admin, writerSession.pid, saveSession.pid, 'projection-save-first', 'work_item');
          paused.release.resolve(); const result = await paused.outcome; assert.equal(result.error, undefined);
          assert.equal((await writer).error, undefined);
          assert.equal(result.value.revision, 1);
          await hosted(() => runtime.heartbeat({ ...p.target, ...claimFence(p.lease) }));
          const exact = await browser(() => summaries.readRevision(p.target.summaryId, result.value.summaryRef, actor));
          assert.ok(exact.contextStatus.reasons.includes('CHANGED_WORKITEMS')); assert.equal(exact.contextStatus.sourceCurrentness, 'UNKNOWN');
          await hosted(() => runtime.finish({ ...p.target, ...claimFence(p.lease), requestId: p.input.requestId }));
        } finally { await paused.cleanup(); if (writer) await writer; }
      });
      await t.test('same-work projection committed after artifact validation rejects old first SAVE and preserves read ledger', async () => {
        const p = await prepared('projection-writer-first'); const reached = deferred(); const resume = deferred();
        const oldVerify = members.verifyOriginalEvidence; members.verifyOriginalEvidence = async (...args) => {
          await oldVerify.apply(members, args); reached.resolve(); await resume.promise; };
        const [before] = await admin`SELECT review_activity_json,task_input_hash,task_envelope_json FROM action_attempt WHERE operation_ref=${p.receipt.attemptRef}`;
        const outcome = hosted(() => runtime.save(p.input)).then(value => ({ value }), error => ({ error }));
        try {
          await Promise.race([reached.promise, outcome.then(result => { throw result.error ?? new Error('SAVE missed artifact barrier'); })]);
          await inWriterScope(() => semanticDatabase.execute(querySql`UPDATE work_item SET projection_json=jsonb_set(projection_json::jsonb,
            '{integratedAssessment,engineerReviews,revision}','2'::jsonb)::text WHERE work_item_id='WI-summary'`));
          resume.resolve(); assert.match((await outcome).error?.message ?? '', /CONTEXT_CHANGED/u); await assertUnsavedConflict(p);
          const [after] = await admin`SELECT review_activity_json,task_input_hash,task_envelope_json FROM action_attempt WHERE operation_ref=${p.receipt.attemptRef}`;
          assert.deepEqual(after, before);
        } finally { resume.resolve(); await outcome; members.verifyOriginalEvidence = oldVerify; }
      });
      await t.test('actual JobAid work save waits on summary work_item SHARE before its attempt and exact revision append', async () => {
        await admin`INSERT INTO action_attempt(attempt_id,work_item_id,tenant_id,actor_user_id,action_type,trigger_request_id,request_origin,
          status,document_version_id,base_revision,task_input_hash,lease_owner,lease_token,lease_generation,lease_expires_at,deadline_at,attempt_no)
          VALUES('ATT-S3-work','WI-summary',${owner.tenantId},${owner.actorUserId},'OPENCLAW_DYNAMIC_EVALUATION','S3-work','OPENCLAW_MCP_V1',
            'RUNNING','DV-old',7,${'7'.repeat(64)},${scope.principalId},'s3-work-lease',1,now()+interval '1 hour',now()+interval '1 hour',3)`;
        const [contentRow] = await admin`SELECT content_json FROM assessment_work_revision WHERE assessment_work_revision_id='JA-summary23'`;
        const writerWorks = new JobAidWorkRepository(semanticDatabase, semanticTransactions, new EngineeringSearchProjectionWriter(semanticDatabase));
        const workSaveInput = expectedWorkRevision => ({ row: { attemptId: 'ATT-S3-work', workItemId: 'WI-summary',
          tenantId: owner.tenantId, taskInputHash: '7'.repeat(64), baseRevision: 7, documentVersionId: 'DV-old' },
          actorUserId: owner.actorUserId, fence: { principalId: scope.principalId, leaseToken: 's3-work-lease', leaseGeneration: 1 },
          sourceBindings: [{ kind: 'SOURCE_FILE', workItemId: 'WI-summary', documentVersionId: 'DV-old', artifactRef: 'SRC-summary', artifactSha256: 'a'.repeat(64) }],
          requestId: `S3-real-work-save-${expectedWorkRevision}`, expectedWorkRevision, command: { fixture: 'S3 physical work writer', expectedWorkRevision },
          content: JSON.parse(contentRow.content_json) });
        const p = await prepared('work-save-summary-first'); const paused = pauseFinalSave(p); let writer;
        try {
          await Promise.race([paused.locked.promise, paused.outcome.then(result => { throw result.error ?? new Error('SAVE missed final barrier'); })]);
          writer = hosted(() => writerWorks.save(workSaveInput(24))).then(value => ({ value }), error => ({ error }));
          await waitForBlocked(admin, writerSession.pid, saveSession.pid, 'jobaid-work-save-summary-first', 'work_item');
          paused.release.resolve(); assert.equal((await paused.outcome).error, undefined);
          const result = await writer; assert.equal(result.error, undefined); assert.equal(result.value.revision.workRevision, 25);
          await hosted(() => runtime.finish({ ...p.target, ...claimFence(p.lease), requestId: p.input.requestId }));
        } finally { await paused.cleanup(); if (writer) await writer; }
        const next = await prepared('work-save-writer-first'); const reached = deferred(); const resume = deferred();
        const inserted = deferred(); const commit = deferred(); const oldVerify = members.verifyOriginalEvidence;
        const oldTransaction = semanticTransactions.withActorTransaction.bind(semanticTransactions);
        semanticTransactions.withActorTransaction = (id, callback) => oldTransaction(id, async executor => {
          const value = await callback(executor); inserted.resolve(); await commit.promise; return value; });
        members.verifyOriginalEvidence = async (...args) => { await oldVerify.apply(members, args); reached.resolve(); await resume.promise; };
        const outcome = hosted(() => runtime.save(next.input)).then(value => ({ value }), error => ({ error })); let writerFirst;
        try {
          await Promise.race([reached.promise, outcome.then(result => { throw result.error ?? new Error('SAVE missed artifact barrier'); })]);
          writerFirst = hosted(() => writerWorks.save(workSaveInput(25))).then(value => ({ value }), error => ({ error }));
          await Promise.race([inserted.promise, writerFirst.then(result => { throw result.error ?? new Error('Work writer missed INSERT barrier'); })]);
          resume.resolve(); await waitForBlocked(admin, saveSession.pid, writerSession.pid, 'jobaid-work-writer-first', 'work_item');
          commit.resolve(); assert.equal((await writerFirst).value.revision.workRevision, 26);
          assert.match((await outcome).error?.message ?? '', /CONTEXT_CHANGED/u); await assertUnsavedConflict(next);
        } finally { resume.resolve(); commit.resolve(); await outcome; if (writerFirst) await writerFirst;
          members.verifyOriginalEvidence = oldVerify; semanticTransactions.withActorTransaction = oldTransaction; }
      });
      await t.test('opposing A to B-old and B to A-old reservations and SAVEs share one physical lock order; same-request admission is unique', async () => {
        const repo2 = new DerivedSummaryRepository(semanticDatabase, semanticTransactions, members);
        const service2 = new DerivedSummaryService(repo2, members, authorization);
        const runtime2 = new DerivedSummaryRuntimeService(repo2, members, service2);
        const initialA = await prepared('opposing-A-seed'); const savedA = await hosted(() => runtime.save(initialA.input));
        await hosted(() => runtime.finish({ ...initialA.target, ...claimFence(initialA.lease), requestId: initialA.input.requestId }));
        const initialB = await prepared('opposing-B-seed'); const savedB = await hosted(() => runtime.save(initialB.input));
        await hosted(() => runtime.finish({ ...initialB.target, ...claimFence(initialB.lease), requestId: initialB.input.requestId }));
        const child = (p, saved) => ({ kind: 'DERIVED_SUMMARY', summaryId: p.receipt.summaryId, summaryRef: saved.summaryRef, summaryRevision: saved.revision });
        const aInput = { ...request, requestId: 'opposing-A-next', expectedSummaryRevision: 1, members: [child(initialB, savedB)] };
        const bInput = { ...request, requestId: 'opposing-B-next', expectedSummaryRevision: 1, members: [child(initialA, savedA)] };
        const locked = deferred(); const release = deferred(); const oldLock = repository.lockContext;
        repository.lockContext = async (...args) => { await oldLock.apply(repository, args); if (args[3] === initialA.receipt.summaryId) { locked.resolve(); await release.promise; } };
        const first = browser(() => summaries.request(initialA.receipt.summaryId, aInput, actor)).then(value => ({ value }), error => ({ error })); let second;
        try {
          await Promise.race([locked.promise, first.then(result => { throw result.error ?? new Error('Reserve missed lock barrier'); })]);
          second = browser(() => service2.request(initialB.receipt.summaryId, bInput, actor)).then(value => ({ value }), error => ({ error }));
          await waitForBlocked(admin, writerSession.pid, saveSession.pid, 'opposing-reservations', 'derived_summary');
          release.resolve(); const [a, b] = await Promise.all([first, second]); assert.equal(a.error, undefined); assert.equal(b.error, undefined);
          const aTarget = { summaryId: initialA.receipt.summaryId, attemptRef: a.value.attemptRef, scope };
          const bTarget = { summaryId: initialB.receipt.summaryId, attemptRef: b.value.attemptRef, scope };
          const aClaim = await hosted(() => runtime.claim(aTarget)); const bClaim = await hosted(() => runtime2.claim(bTarget));
          const saveInput = (target, lease, input) => ({ ...target, ...claimFence(lease), requestId: input.requestId, expectedSummaryRevision: 1,
            contentJson: JSON.stringify({ headline: 'Opposing context', listBrief: 'Selected historical child', body: `[[${lease.task.modelInput.members[0].evidenceRef}]]`, limitations: [] }) });
          for (const [adapter, target, lease] of [[runtime, aTarget, aClaim], [runtime2, bTarget, bClaim]])
            await hosted(() => adapter.readMemberWork({ ...target, ...claimFence(lease), evidenceRefs: [lease.task.modelInput.members[0].evidenceRef], purpose: 'Read exact old child' }));
          const p = { target: aTarget, lease: aClaim, input: saveInput(aTarget, aClaim, aInput) }; const paused = pauseFinalSave(p); let bSave;
          try {
            await Promise.race([paused.locked.promise, paused.outcome.then(result => { throw result.error ?? new Error('SAVE missed final barrier'); })]);
            bSave = hosted(() => runtime2.save(saveInput(bTarget, bClaim, bInput))).then(value => ({ value }), error => ({ error }));
            await waitForBlocked(admin, writerSession.pid, saveSession.pid, 'opposing-saves', 'derived_summary');
            paused.release.resolve(); assert.equal((await paused.outcome).value.revision, 2);
            assert.match((await bSave).error?.message ?? '', /CONTEXT_CHANGED/u);
            assert.equal((await admin`SELECT current_revision FROM derived_summary WHERE summary_id=${bTarget.summaryId}`)[0].current_revision, 1);
            assert.equal((await admin`SELECT status FROM action_attempt WHERE operation_ref=${bTarget.attemptRef}`)[0].status, 'CONFLICT');
            await hosted(() => runtime.finish({ ...aTarget, ...claimFence(aClaim), requestId: aInput.requestId }));
          } finally { await paused.cleanup(); if (bSave) await bSave; }
        } finally { release.resolve(); await first; if (second) await second; repository.lockContext = oldLock; }
        const same = { ...request, requestId: 'same-concurrent-reservation', expectedSummaryRevision: 1 };
        const [one, two] = await Promise.all([browser(() => summaries.request(initialB.receipt.summaryId, same, actor)),
          browser(() => service2.request(initialB.receipt.summaryId, same, actor))]);
        assert.equal(one.attemptRef, two.attemptRef); assert.equal(Number(one.created) + Number(two.created), 1);
        const [count] = await admin`SELECT count(*)::int AS n FROM action_attempt WHERE summary_id=${initialB.receipt.summaryId} AND trigger_request_id=${same.requestId}`;
        assert.equal(count.n, 1); await hosted(() => runtime.cancel({ summaryId: initialB.receipt.summaryId, attemptRef: one.attemptRef, scope, reason: 'Owned fixture cleanup' }));
      });
    } finally {
      if (semanticConnection) await semanticConnection.end({ timeout: 5 });
      if (connection) await connection.end({ timeout: 5 });
      await admin.end({ timeout: 5 });
    }
  });

function claimFence(claim) { return { leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration }; }
function deferred() {
  let resolve; const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function semanticOriginal() {
  const original = originalFixture();
  original.binding = { documentVersionId: 'DV-old', parseRunId: 'PR-summary-source', parseRevision: 1,
    sourceArtifactId: 'SRC-summary', sourceSha256: 'a'.repeat(64), sourceByteLength: 100 };
  return original;
}
async function waitForBlocked(admin, waitingPid, blockingPid, stage, table = 'dm_document_version') {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await admin`SELECT pg_blocking_pids(${waitingPid}) AS blockers,wait_event_type,wait_event,query
      FROM pg_stat_activity WHERE pid=${waitingPid}`;
    if (row.blockers.includes(blockingPid)) {
      assert.equal(row.wait_event_type, 'Lock');
      assert.ok(row.query.includes(table), `the actual waiter must be locking ${table}`);
      console.log(JSON.stringify({ SemanticLockWait: { stage, table, waitingPid, blockingPid, ...row } }));
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`No real PostgreSQL ${table} lock wait observed: ${stage}`);
}
function databaseCode(error) { for (let current = error; current; current = current.cause) if (current.code) return current.code; return null; }
function databaseConstraint(error) { for (let current = error; current; current = current.cause) if (current.constraint_name) return current.constraint_name; return null; }
function databaseMessageIncludes(error, message) { for (let current = error; current; current = current.cause) if (current.message?.includes(message)) return true; return false; }
function serviceRoleDenied(error) { return databaseCode(error) === '42501' && databaseMessageIncludes(error, 'DERIVED_SUMMARY_SERVICE_ROLE_REQUIRED'); }
function nativeActor(userId, tenantId) {
  return { userId, tenantId, appId: 'app_17bzc551rsg', roles: [], env: 'runtime', objectAccessActor: {
    principalKind: 'FINAL_USER', transport: 'MIAODA_AUTHENTICATED_HTTP', canonicalSubject: { namespace: 'MIAODA_USER_ID', id: userId },
    subjectDecision: { source: 'MIAODA_GATEWAY_USER_CONTEXT', applicationScopeId: 'app_17bzc551rsg', tenantId,
      version: 'miaoda-hosted-native-sso.v1', decidedAt: new Date().toISOString() }, tenantId,
    applicationScopeId: 'app_17bzc551rsg', applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT', workspaceId: null,
    workspaceProvenance: 'UNAVAILABLE', env: 'runtime', platformRoles: [], identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
    feishuUserId: null, feishuOpenId: null, feishuIdentityProvenance: 'UNAVAILABLE', sessionId: null,
    sessionRevision: null, sessionProvenance: 'UNAVAILABLE' } };
}

// Only these eight new narrowing policies target the exact SDK SQL scopes.
// Existing Matter policy roles continue to be preserved separately.
const baseBoundaries = [
  ['action_attempt_summary_subject_boundary', 'action_attempt', '*'],
  ['derived_summary_owner_boundary', 'derived_summary', '*'],
  ['derived_summary_no_delete', 'derived_summary', 'd'],
  ['derived_summary_revision_sources', 'derived_summary_revision', '*'],
  ['derived_summary_revision_real_attempt', 'derived_summary_revision', 'a'],
  ['derived_summary_revision_hosted_insert', 'derived_summary_revision', 'a'],
  ['derived_summary_revision_no_update', 'derived_summary_revision', 'w'],
  ['derived_summary_revision_no_delete', 'derived_summary_revision', 'd'],
];
const sqlBoundaries = baseBoundaries.flatMap(([name, table, command]) =>
  ['authenticated', 'service_role', 'anon'].map(scope => [`${name}_${scope}`, table, command, scope]));

function rewriteTopLevelPublicPolicies(ddl) {
  // Model the observed platform transform on parsed top-level CREATE POLICY
  // statements. Dollar-quoted DO/function bodies remain untouched, as in the
  // actual prior dynamic old-policy extension accepted by the platform.
  return ddl.replace(/(\$[a-z_]*\$)[\s\S]*?\1|CREATE POLICY[^;]+;/giu,
    (statement, quoted) => quoted ? statement : statement.replace(/\bTO (authenticated|service_role|anon)\b/gu, (_, scope) => `TO ${scope}_${roleSchema}`).replace(/\bTO PUBLIC\b/gu, `TO authenticated_${roleSchema}`));
}

async function sqlBoundaryRows(admin) {
  return admin`SELECT p.polname,c.relname,p.polcmd,p.polpermissive,
    p.polroles=ARRAY[0]::oid[] AS all_roles,
    p.polroles AS role_oids,
    p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname=${`authenticated_${roleSchema}`})]::oid[] AS ordinary_only
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    WHERE p.polname=ANY(${sqlBoundaries.map(([name]) => name)}) ORDER BY p.polname`;
}

async function assertSqlBoundaries(admin) {
  const rows = await sqlBoundaryRows(admin);
  assert.equal(rows.length, sqlBoundaries.length);
  for (const [name, table, command, scope] of sqlBoundaries) {
    const row = rows.find(policy => policy.polname === name);
    assert.equal(row.relname, table); assert.equal(row.polcmd, command);
    const [role] = await admin`SELECT oid FROM pg_roles WHERE rolname=${`${scope}_${roleSchema}`}`;
    assert.equal(row.polpermissive, false); assert.deepEqual(row.role_oids, [role.oid], `${name} must retain exactly its SDK SQL role OID`);
    assert.equal(row.all_roles, false);
    assert.equal(row.ordinary_only, scope === 'authenticated');
  }
}

async function reset(admin) {
  await admin.unsafe('DROP SCHEMA public CASCADE');
  await admin.unsafe('CREATE SCHEMA public');
  await admin.unsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated_${roleSchema}') THEN CREATE ROLE authenticated_${roleSchema} NOLOGIN IN ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role_${roleSchema}') THEN CREATE ROLE service_role_${roleSchema} NOLOGIN IN ROLE service_role; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon_${roleSchema}') THEN CREATE ROLE anon_${roleSchema} NOLOGIN IN ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='summary_ordinary_login') THEN CREATE ROLE summary_ordinary_login LOGIN IN ROLE authenticated_${roleSchema}; END IF;
  END $$`);
  await admin.unsafe('CREATE TYPE user_profile AS (user_id text)');
  const originalDdl = await readFile('server/database/work-item.ddl.sql', 'utf8');
  await admin.unsafe(originalDdl.match(/CREATE TABLE work_item \([\s\S]*?\n\);/u)[0]);
  await admin.unsafe(originalDdl.match(/CREATE TABLE action_attempt \([\s\S]*?\n\);/u)[0]);
  await admin.unsafe('ALTER TABLE work_item ADD COLUMN analysis_model_json text, ADD COLUMN initial_aily_session_id uuid');
  await admin.unsafe(await readFile('migrations/0003_action_attempt_openclaw_v1.sql', 'utf8'));
  await admin.unsafe(`ALTER TABLE action_attempt ALTER COLUMN work_item_id DROP NOT NULL,
    ADD COLUMN subject_kind varchar(32) NOT NULL DEFAULT 'WORK_ITEM', ADD COLUMN matter_id varchar(96),
    ADD COLUMN matter_revision_id varchar(96),ADD COLUMN review_activity_json text,ADD COLUMN execution_model_json text;
    ALTER TABLE action_attempt ADD CONSTRAINT ck_action_attempt_subject CHECK
      (subject_kind IN ('WORK_ITEM','DOCUMENT_VERSION','ENGINEERING_MATTER','ACQUISITION'));
    CREATE TABLE identity_subject_mapping (id uuid DEFAULT gen_random_uuid(),miaoda_user_id varchar(255),miaoda_tenant_id varchar(128),expected_client_id varchar(128),status varchar(32));
    CREATE TABLE summary_test_document_acl (tenant_id varchar,actor_id varchar,document_version_id varchar,allowed boolean);
    CREATE TABLE dm_document_version (document_version_id varchar,family_id varchar);
    CREATE TABLE dm_publication_family (family_id varchar,current_document_version_id varchar,
      current_generation integer NOT NULL DEFAULT 1,status varchar NOT NULL DEFAULT 'ACTIVE');
    CREATE TABLE engineering_matter (tenant_id varchar,matter_id varchar,current_matter_revision_id varchar,created_by_user_id varchar);
    CREATE TABLE engineering_matter_work_revision (tenant_id varchar,matter_id varchar,matter_work_revision_id varchar,working_revision integer,
      created_by_user_id varchar,based_on_matter_revision_id varchar);
    CREATE UNIQUE INDEX uk_work_item_tenant ON work_item(tenant_id,work_item_id);
    CREATE FUNCTION engineering_matter_actor_has_tenant(t varchar) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
      SELECT EXISTS (SELECT 1 FROM identity_subject_mapping m WHERE m.miaoda_user_id=current_setting('app.user_id',true)
        AND m.miaoda_tenant_id=t AND m.expected_client_id='cli_aadde8b579f95bc9' AND m.status='ACTIVE') $$;
    CREATE FUNCTION engineering_matter_work_item_owned_by_actor(t varchar,w varchar) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
      SELECT EXISTS (SELECT 1 FROM work_item x WHERE x.tenant_id=t AND x.work_item_id=w AND x.requested_by_user_id=current_setting('app.user_id',true)) $$;
    CREATE FUNCTION engineering_matter_document_owned_by_actor(t varchar,d varchar) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
      SELECT EXISTS (SELECT 1 FROM summary_test_document_acl a WHERE a.tenant_id=t AND a.document_version_id=d
        AND a.actor_id=current_setting('app.user_id',true) AND a.allowed) $$;
    CREATE FUNCTION engineering_matter_owned_by_actor(t varchar,m varchar) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION engineering_matter_all_links_owned_by_actor(t varchar,m varchar) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    ALTER TABLE action_attempt ENABLE ROW LEVEL SECURITY;
    CREATE POLICY legacy_attempt_access ON action_attempt TO authenticated,service_role USING (true);
    CREATE POLICY action_attempt_matter_or_document_subject_boundary ON action_attempt AS RESTRICTIVE FOR ALL TO authenticated_${roleSchema},service_role_${roleSchema}
      USING (subject_kind IN ('WORK_ITEM','DOCUMENT_VERSION') OR subject_kind='ACQUISITION' OR
        (subject_kind='ENGINEERING_MATTER' AND engineering_matter_owned_by_actor(tenant_id,matter_id)));
    ALTER TABLE work_item ENABLE ROW LEVEL SECURITY;
    CREATE POLICY work_owner ON work_item TO authenticated,service_role USING
      (requested_by_user_id=current_setting('app.user_id',true) AND engineering_matter_actor_has_tenant(tenant_id));
    GRANT USAGE ON SCHEMA public TO authenticated,service_role,anon;
    GRANT SELECT ON identity_subject_mapping TO authenticated,service_role;
    GRANT SELECT,UPDATE ON dm_document_version,dm_publication_family TO authenticated,service_role;
    GRANT SELECT,INSERT,UPDATE ON action_attempt TO authenticated,service_role;
    GRANT SELECT,UPDATE ON work_item TO authenticated,service_role;`);
  await admin.unsafe(await readFile('migrations/0026_assessment_work_revision.sql', 'utf8'));
  await admin.unsafe('GRANT SELECT,INSERT ON assessment_work_revision TO authenticated,service_role');
  const template = await readFile('server/database/derived-summary.ddl.sql', 'utf8');
  const [snapshot] = await admin`SELECT json_build_object('schema',current_schema(),
    'constraints',(SELECT json_agg(json_build_object('name',conname,'table','action_attempt','definition',pg_get_constraintdef(oid))) FROM pg_constraint WHERE conrelid='action_attempt'::regclass),
    'policies',(SELECT json_agg(json_build_object('name',polname,'table','action_attempt','using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid),
      'command',polcmd,'restrictive',NOT polpermissive,'roles',(SELECT json_agg(pg_get_userbyid(role_oid)) FROM unnest(polroles) AS role_oid))) FROM pg_policy WHERE polrelid='action_attempt'::regclass))::text AS schema_probe`;
  const official = { ok: true, data: [snapshot] };
  const summaryDdl = prepareDerivedSummaryDdl({ template, devSnapshot: official, onlineSnapshot: official });
  await assert.rejects(admin.unsafe(template), error => databaseMessageIncludes(error, 'DERIVED_SUMMARY_PREPARE_REQUIRED'));
  await admin.unsafe('ROLLBACK');
  assert.doesNotMatch(summaryDdl, /\b(?:GRANT|REVOKE)\b/iu, 'production DDL leaves ACL administration to the platform');
  // Start with the prior weaker summary-only constraint, then prove the same
  // additive DDL upgrades it and remains reapplicable without altering legacy branches.
  const [oldPolicy] = await admin`SELECT polroles FROM pg_policy WHERE polrelid='action_attempt'::regclass
    AND polname='action_attempt_matter_or_document_subject_boundary'`;
  await admin.unsafe(rewriteTopLevelPublicPolicies(summaryDdl.replace(" AND action_type<>'OPENCLAW_DERIVED_SUMMARY'", '')));
  // Reproduce the observed physical omissions after a managed migration
  // claimed it had applied DO mutations: new CHECK/FKs disappear and the
  // original legacy subject policy/constraint remains. Prepared top-level
  // SQL must repair these existing tables without replacing any data.
  const captured = JSON.parse(snapshot.schema_probe);
  const originalCheck = captured.constraints.find(item => item.name === 'ck_action_attempt_subject');
  const originalBoundary = captured.policies.find(item => item.name === 'action_attempt_matter_or_document_subject_boundary');
  await admin.unsafe(`ALTER TABLE action_attempt DROP CONSTRAINT ck_action_attempt_summary_subject,
    DROP CONSTRAINT ck_action_attempt_summary_identity,DROP CONSTRAINT fk_action_attempt_summary_head;
    ALTER TABLE derived_summary DROP CONSTRAINT fk_derived_summary_saved_pointer;
    ALTER TABLE action_attempt ADD CONSTRAINT ck_action_attempt_subject ${originalCheck.definition};
    DROP POLICY action_attempt_summary_legacy_authenticated ON action_attempt;
    DROP POLICY action_attempt_summary_legacy_service_role ON action_attempt;
    CREATE POLICY action_attempt_matter_or_document_subject_boundary ON action_attempt AS RESTRICTIVE FOR ALL
      TO authenticated_${roleSchema},service_role_${roleSchema} USING (${originalBoundary.using});`);
  await admin.unsafe(rewriteTopLevelPublicPolicies(summaryDdl));
  const repairedLegacy = await admin`SELECT polname FROM pg_policy WHERE polrelid='action_attempt'::regclass
    AND polname='action_attempt_matter_or_document_subject_boundary'`;
  assert.equal(repairedLegacy.length, 0, 'the physically retained denying legacy policy is actually removed');
  // Dev already has the earlier DO/PUBLIC apply. Reproduce its OID 0
  // metadata before the migration-compatible three-scope upgrade.
  for (const [name, table] of sqlBoundaries) await admin.unsafe(`ALTER POLICY ${name} ON ${table} TO PUBLIC`);
  const priorPublic = await sqlBoundaryRows(admin);
  assert.ok(priorPublic.every(row => row.all_roles && row.role_oids.length === 1));
  await admin.unsafe(rewriteTopLevelPublicPolicies(summaryDdl));
  await assertSqlBoundaries(admin);
  // Also support the older authenticated-only dev apply without new tables
  // or data migration. Only actual restrictive policy role targets change.
  for (const [name, table] of sqlBoundaries) {
    await admin.unsafe(`ALTER POLICY ${name} ON ${table} TO authenticated_${roleSchema}`);
  }
  const narrowed = await sqlBoundaryRows(admin);
  assert.equal(narrowed.length, sqlBoundaries.length);
  assert.ok(narrowed.every(row => row.ordinary_only && !row.all_roles && !row.polpermissive));
  // A bypass role cannot be treated as an RLS-constrained SDK scope.
  await admin.unsafe(`ALTER ROLE anon_${roleSchema} BYPASSRLS`);
  try {
    await assert.rejects(admin.unsafe(summaryDdl), error => databaseCode(error) === '42501'
      && databaseMessageIncludes(error, 'DERIVED_SUMMARY_SQL_ROLE_RLS_REQUIRED'));
  } finally {
    await admin.unsafe('ROLLBACK');
    await admin.unsafe(`ALTER ROLE anon_${roleSchema} NOBYPASSRLS`);
  }
  assert.deepEqual(await sqlBoundaryRows(admin), narrowed, 'bypass-role upgrade leaves prior policy roles intact');
  // Missing actual SQL scopes cannot become a smaller accepted target set.
  await admin.unsafe(`ALTER ROLE anon_${roleSchema} RENAME TO summary_missing_anon`);
  try {
    await assert.rejects(admin.unsafe(summaryDdl), error => databaseCode(error) === '42501'
      && databaseMessageIncludes(error, 'DERIVED_SUMMARY_SQL_ROLES_REQUIRED'));
  } finally {
    await admin.unsafe('ROLLBACK');
    await admin.unsafe(`ALTER ROLE summary_missing_anon RENAME TO anon_${roleSchema}`);
  }
  assert.deepEqual(await sqlBoundaryRows(admin), narrowed, 'missing-role upgrade rolls back without replacing any policy');
  // If a serializer ever drops a scope from an explicit target list, the
  // checked transaction must reject the change rather than commit it.
  await assert.rejects(admin.unsafe(rewriteTopLevelPublicPolicies(summaryDdl.replaceAll('TO service_role', 'TO authenticated').replaceAll('TO anon', 'TO authenticated'))),
  error => databaseCode(error) === '42501' && databaseMessageIncludes(error, 'DERIVED_SUMMARY_SQL_BOUNDARY_REQUIRED'));
  await admin.unsafe('ROLLBACK');
  assert.deepEqual(await sqlBoundaryRows(admin), narrowed, 'rejected target conversion rolls back the whole upgrade');
  await admin.unsafe(rewriteTopLevelPublicPolicies(summaryDdl));
  await assertSqlBoundaries(admin);
  const legacyPolicies = await admin`SELECT polroles,pg_get_expr(polqual,polrelid) AS predicate FROM pg_policy WHERE polrelid='action_attempt'::regclass
    AND polname IN ('action_attempt_summary_legacy_authenticated','action_attempt_summary_legacy_service_role')`;
  assert.deepEqual(legacyPolicies.flatMap(item => item.polroles).sort((a,b) => a-b), [...oldPolicy.polroles].sort((a,b) => a-b),
    'top-level single-scope legacy policies preserve the original actual role set');
  assert.ok(legacyPolicies.every(item => item.predicate.includes('ACQUISITION') && item.predicate.includes('DERIVED_SUMMARY')));
  const constraints = await admin`SELECT conname FROM pg_constraint WHERE conname IN
    ('ck_action_attempt_summary_subject','ck_action_attempt_summary_identity','fk_action_attempt_summary_head','fk_derived_summary_saved_pointer')`;
  assert.equal(constraints.length, 4, 'all previously omitted DO boundaries now have fresh top-level constraint names');
  await admin.unsafe(rewriteTopLevelPublicPolicies(summaryDdl));
  await assertSqlBoundaries(admin);
  // Simulate the documented broad platform-managed ACLs locally, including
  // TRUNCATE. These fixture-only statements are never part of deployed DDL.
  await admin.unsafe('GRANT ALL ON derived_summary,derived_summary_revision TO authenticated,service_role,anon');
  await admin.unsafe('GRANT TRUNCATE ON ALL TABLES IN SCHEMA public TO authenticated,service_role,anon');
  await admin.unsafe(`CREATE POLICY platform_native_crud ON derived_summary TO authenticated,service_role,anon USING(true) WITH CHECK(true);
    CREATE POLICY platform_native_crud ON derived_summary_revision TO authenticated,service_role,anon USING(true) WITH CHECK(true);`);
}

async function seed(admin) {
  await admin`INSERT INTO identity_subject_mapping(miaoda_user_id,miaoda_tenant_id,expected_client_id,status)
    VALUES (${owner.actorUserId},${owner.tenantId},'cli_aadde8b579f95bc9','ACTIVE'),('other-actor',${owner.tenantId},'cli_aadde8b579f95bc9','ACTIVE')`;
  await admin`INSERT INTO summary_test_document_acl VALUES (${owner.tenantId},${owner.actorUserId},'DV-old',true),
    (${owner.tenantId},${owner.actorUserId},'DV-new',true)`;
  await admin`INSERT INTO dm_document_version VALUES ('DV-old','FAMILY-summary'),('DV-new','FAMILY-summary')`;
  await admin`INSERT INTO dm_publication_family(family_id,current_document_version_id) VALUES ('FAMILY-summary','DV-new')`;
  await admin`INSERT INTO work_item(work_item_id,tenant_id,action_type,document_id,document_version_id,source_artifact_id,source_file_sha256,
    source_byte_length,normalized_family,request_id,status,revision,requested_by_user_id,projection_json)
    VALUES ('WI-summary',${owner.tenantId},'PARSE_PDF','DOC-summary','DV-old','SRC-summary',${'a'.repeat(64)},100,'FTD','intake','complete',7,
      ${owner.actorUserId},${JSON.stringify({ source: { documentVersionId: 'DV-old', sourceArtifactId: 'SRC-summary', sourceFileSha256: 'a'.repeat(64) } })})`;
  await admin`INSERT INTO action_attempt(attempt_id,work_item_id,tenant_id,actor_user_id,action_type,trigger_request_id,request_origin,status)
    VALUES ('ATT-work23','WI-summary',${owner.tenantId},${owner.actorUserId},'OPENCLAW_DYNAMIC_EVALUATION','initial','OPENCLAW_MCP_V1','SUCCEEDED')`;
  const issues = ['tls-cause','tls-measure'].map(issueKey => ({ issueKey, issueRef: `issue:${issueKey}`,question: issueKey,
    body: `Saved cause and measure retain uncertainty. [[${source.evidenceRef}]]`,riskScenarios: [],measures: [],otherClassifications: [],
    openQuestions: [],requirementHandling: [],sourceDependencies: [source.evidenceRef],premiseRefs: [source.evidenceRef] }));
  const content = { schemaVersion: 'wiselink.jobaid-problem-work.v3',headline: 'TLS work23',listBrief: 'Saved synthetic work',
    understanding: 'Conditional TLS overview',decisiveIssueKeys: issues.map(item => item.issueKey),overviewStatus: 'CURRENT',issues,
    roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',completionReason: 'Scope uncertainty retained',changeSummary: 'Synthetic fixture',
    unchangedExplanation: '',methodBinding: JOBAID_METHOD_BINDING,evidence: [source],readSourceRefs: [source.evidenceRef],capabilities: [],
    historyReview: { required: false,priorAssessmentRefs: [],engineeringDocumentRefs: [],coverage: 'NOT_REQUIRED',limitation: null } };
  await admin`INSERT INTO assessment_work_revision(assessment_work_revision_id,tenant_id,work_item_id,work_revision,request_id,
    action_attempt_id,based_on_work_item_revision,document_version_id,command_json,content_json,created_by_user_id)
    VALUES ('JA-summary23',${owner.tenantId},'WI-summary',23,'JA-save23','ATT-work23',7,'DV-old','{}',${JSON.stringify(content)},${owner.actorUserId})`;
  await admin`INSERT INTO work_item(work_item_id,tenant_id,action_type,document_id,document_version_id,source_artifact_id,source_file_sha256,
    source_byte_length,normalized_family,request_id,status,revision,requested_by_user_id,projection_json)
    VALUES ('WI-new',${owner.tenantId},'PARSE_PDF','DOC-summary','DV-new','SRC-new',${'b'.repeat(64)},101,'FTD','intake-new','complete',1,
      ${owner.actorUserId},${JSON.stringify({ source: { documentVersionId: 'DV-new', sourceArtifactId: 'SRC-new', sourceFileSha256: 'b'.repeat(64) } })})`;
  const newerContent = JSON.parse(JSON.stringify(content).replaceAll('SOURCE-DV-old-para1','SOURCE-DV-new-para1')
    .replaceAll('DV-old','DV-new').replaceAll('WI-summary','WI-new'));
  await admin`INSERT INTO assessment_work_revision(assessment_work_revision_id,tenant_id,work_item_id,work_revision,request_id,
    action_attempt_id,based_on_work_item_revision,document_version_id,command_json,content_json,created_by_user_id)
    VALUES ('JA-new1',${owner.tenantId},'WI-new',1,'JA-save-new','ATT-work23',1,'DV-new','{}',${JSON.stringify(newerContent)},${owner.actorUserId})`;
}

async function seedSemanticContext(admin) {
  await admin.unsafe(`CREATE TABLE dm_document_parse_run(tenant_id varchar,document_version_id varchar,parse_run_id varchar,
    parse_revision integer,status varchar,manifest_artifact jsonb,source_binding jsonb,
    UNIQUE(tenant_id,document_version_id,parse_run_id));
    CREATE FUNCTION document_translation_attempt_owned(t varchar,reader varchar,d varchar,p varchar,r integer)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
      SELECT reader=current_setting('app.user_id',true) AND engineering_matter_document_owned_by_actor(t,d)
        AND EXISTS(SELECT 1 FROM dm_document_parse_run x WHERE x.tenant_id=t AND x.document_version_id=d
          AND x.parse_run_id=p AND x.parse_revision=r AND x.status='PUBLISHED') $$;`);
  await admin.unsafe(await readFile('migrations/0055_document_semantic_revision.sql', 'utf8'));
  await admin.unsafe('GRANT SELECT,UPDATE ON dm_document_parse_run TO authenticated,service_role');
  await admin.unsafe('GRANT SELECT,INSERT ON dm_document_semantic_revision TO authenticated,service_role');
  const sha = 'c'.repeat(64);
  const manifest = { sha256: sha, relativePath: 'original/manifest.json', role: 'MANIFEST', readback: 'VERIFIED' };
  const parseBinding = { documentVersionId: 'DV-old', sourceArtifactId: 'SRC-summary', pdfSha256: 'a'.repeat(64), byteLength: 100 };
  const fixtures = { manifest, parseBinding, candidates: [] };
  await admin`INSERT INTO dm_document_parse_run VALUES(${owner.tenantId},'DV-old','PR-summary-source',1,'PUBLISHED',
    ${admin.json(manifest)}::jsonb,${admin.json(parseBinding)}::jsonb)`;
  const original = semanticOriginal();
  const semantic = buildDocumentSemanticMap({ original, semanticRevision: 1, profile: GENERIC_SEMANTIC_PROFILE });
  await admin`INSERT INTO dm_document_semantic_revision
    (tenant_id,document_version_id,parse_run_id,parse_revision,semantic_revision,original_manifest_sha256,actor_user_id,profile_ref,map_json)
    VALUES(${owner.tenantId},'DV-old','PR-summary-source',1,1,${sha},
    ${owner.actorUserId},${semantic.profileRef},${admin.json(semantic)})`;
  return fixtures;
}


// Validation helper module is generated from pinned f771 AST only; it never
// registers the original engineering test suite or reads real PDF fixtures.
test('actual browser correction admission and existing receipt updates are fenced by selected Matter and notice locks',
  { skip: !databaseUrl || !process.env.S3_ENGINEERING_FIXTURE_MODULE, timeout: 60000 }, async t => {
    const url = new URL(databaseUrl); assert.equal(url.hostname, '127.0.0.1'); assert.match(url.pathname, /^\/derived_summary_test_[a-z0-9_]+$/u);
    const fixturePath = process.env.S3_ENGINEERING_FIXTURE_MODULE;
    assert.ok(fixturePath.endsWith('/validation/s3-context-candidate/engineering-fixture.mjs'));
    const fixture = await import(fixturePath);
    const { MatterActionAttemptService } = require('../../server/modules/canonical-host/matter-action-attempt.service.ts');
    const { CanonicalModelSettingsService } = require('../../server/modules/model-settings/canonical-model-settings.service.ts');
    const { CanonicalModelSettingsRepository } = require('../../server/modules/model-settings/canonical-model-settings.repository.ts');
    const { sealMatterResultEnvelope } = require('../../server/modules/action-attempt/action-attempt-envelope.ts');
    const { ActionAttemptRepository } = require('../../server/modules/action-attempt/action-attempt.repository.ts');
    const { assertSummaryContextUnchanged } = require('../../server/modules/canonical-host/derived-summary-current-context.ts');
    const admin = postgres(databaseUrl, { max: 1, onnotice() {} }); let one, two;
    try {
      await fixture.resetDatabase(admin);
      const synthetic = (prefix, workItemId, sha) => ({ workItemId, documentId: 'S3-DOC-'+prefix,
        documentVersionId: 'S3-DV-'+prefix, sourceArtifactId: 'S3-SRC-'+prefix, sourceFileSha256: sha.repeat(64),
        sourceByteLength: 100, packageId: 'S3-PACKAGE-'+prefix, sourceRefCount: 1 });
      await fixture.seedRealDocumentWorkItems(admin, { ftd: synthetic('A', fixture.FTD_WORK_ITEM_ID, 'a'), sb: synthetic('B', fixture.SB_WORK_ITEM_ID, 'b') });
      await admin`UPDATE dm_publication_family SET canonical_identity_key='tenant:tenant-A:family:' || canonical_identity_key`;
      one = await fixture.reserveActorService('actor-A'); two = await fixture.reserveActorService('actor-A');
      const created = await one.service.create({ requestId: 'S3-correction-matter', title: 'Synthetic S3 context correction', primaryWorkItemId: fixture.FTD_WORK_ITEM_ID }, one.actor);
      const basis = await one.workingService.resolveWorkingBasis(created.matter.matterId, one.actor);
      const actorScope = { tenantId: 'tenant-A', actorUserId: 'actor-A', matterId: created.matter.matterId };
      const models = new CanonicalModelSettingsService(new CanonicalModelSettingsRepository(one.database));
      const writer = new MatterActionAttemptService(one.working, models); const otherWriter = new MatterActionAttemptService(two.working, models);
      const reserve = { ...actorScope, expectedMatterRevisionId: basis.snapshot.currentMatterRevisionId,
        expectedMatterRevision: basis.snapshot.currentRevisionNo, expectedWorkingRevision: 0,
        idempotencyKey: 'S3-correction-initial', trigger: { kind: 'USER_REQUEST', requestId: 'S3-local-fixture', instruction: 'Synthetic only' } };
      const initial = await one.runtime(() => writer.reserveJobAid(reserve));
      const target = { ...actorScope, attemptRef: initial.task.operationRef, principalId: 'hosted-test' };
      const lease = await one.runtime(() => writer.claim(target)); const fence = { ...target, ...claimFence(lease) };
      const documentVersionId = initial.task.workingBasis.inputs[0].documentVersionId;
      const rootRef = `DOCUMENT_VERSION:${documentVersionId}:page:1`;
      const sourceEvidence = { kind: 'DOCUMENT_PASSAGE', evidenceRef: rootRef, sourceRefId: rootRef,
        documentVersionId, workItemId: null, title: 'Synthetic owned source', versionLabel: null,
        locator: 'Page 1', excerpt: 'Unknown conditions require rechecking.' };
      await one.runtime(() => writer.readSourcePages({ ...fence, documentVersionId, pageStart: 1, purpose: 'Read synthetic source' },
        async () => ({ documentVersionId, sourceSha256: 'a'.repeat(64), sourceByteLength: 100, pageCount: 1,
          extractionScope: 'NATIVE_TEXT_LAYER', pages: [{ page: 1, sourceRefId: rootRef, text: sourceEvidence.excerpt,
            textLayerStatus: 'PRESENT', visualContentVerified: false, evidence: sourceEvidence }] })));
      const method = initial.task.modelInput.sourceCatalog.find(item => item.kind === 'METHOD_CLAUSE'); assert.ok(method);
      await one.runtime(() => writer.readRegisteredSources({ ...fence, sourceRefs: [method.evidenceRef], purpose: 'Read exact method' }));
      const proposal = { schemaVersion: 'wiselink.jobaid-problem-work.v3', overview: 'Synthetic initial context.', headline: 'Conditional candidate',
        listBrief: 'Unconfirmed conditions retained', roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS', completionReason: 'Fixture only', changeSummary: 'Synthetic fixture',
        issues: [{ issueKey: 'dependency', question: 'Which condition applies?', body: `Unknown conditions require rechecking. [[${rootRef}]]`,
          requirementHandling: [{ methodRef: method.evidenceRef, requirement: 'Check the condition', conditions: [], treatment: 'CONDITIONS_UNCONFIRMED',
            basisRefs: [rootRef], explanation: 'Unknown is retained.' }], openQuestions: [{ question: 'Which condition applies?', affects: 'Unconfirmed applicability',
              nextEvidence: 'Owned synthetic configuration', reason: 'Condition unknown.' }] }] };
      const saved = await one.runtime(() => writer.saveJobAidWork({ ...fence, requestId: 'S3-initial-matter-save', expectedWorkRevision: 0, workJson: JSON.stringify(proposal) }));
      const { contentHash: _hash, ...result } = fixture.matterResult(initial.task); result.modelOutput = JSON.stringify({ workRevisionRef: saved.workRevisionRef });
      await one.runtime(() => writer.finishJobAid({ ...fence, result: sealMatterResultEnvelope(result) }));
      const selected = [{ kind: 'MATTER_WORK', matterId: actorScope.matterId, workRef: saved.workRevisionRef, workRevision: saved.workRevision, issueKeys: ['dependency'] }];
      const members = new DerivedSummaryMembersService({} , one.working);
      const repository = new DerivedSummaryRepository(one.database, one.working, members);
      const capture = () => one.runtime(() => one.working.withActorTransaction('actor-A', async ({ database }) => {
        const readings = await members.readAll(selected, actorScope, database); return repository.contextBasis(readings, actorScope, database); }));
      const [readerPid] = await one.database.execute(querySql`SELECT pg_backend_pid() AS pid`);
      const [writerPid] = await two.database.execute(querySql`SELECT pg_backend_pid() AS pid`); assert.notEqual(readerPid.pid, writerPid.pid);
      const correction = { ...reserve, expectedWorkingRevision: saved.workRevision, idempotencyKey: 'S3-new-correction',
        correction: { kind: 'ENGINEERING_ISSUE_CORRECTION', expectedWorkRef: saved.workRevisionRef,
          issueKey: 'dependency', correctionReason: 'Recheck the unconfirmed source condition.', evidenceRefs: [rootRef, method.evidenceRef] } };
      let reserved;
      await t.test('new real browser correction admission waits on parent Matter SHARE; fresh vector records the notice', async () => {
        const frozen = await capture(); const locked = deferred(); const release = deferred(); let writerOutcome;
        const readOutcome = one.runtime(() => one.working.withActorTransaction('actor-A', async ({ database }) => {
          await repository.lockContext(frozen, actorScope, database); locked.resolve(); await release.promise;
          const current = await repository.contextBasis(await members.readAll(selected, actorScope, database), actorScope, database);
          assertSummaryContextUnchanged(frozen, current); return current;
        })).then(value => ({ value }), error => ({ error }));
        try {
          await Promise.race([locked.promise, readOutcome.then(outcome => { throw outcome.error ?? new Error('Reader missed Matter barrier'); })]);
          writerOutcome = otherWriter.reserveJobAidForBrowser(correction, two.actor).then(value => ({ value }), error => ({ error }));
          await waitForBlocked(admin, writerPid.pid, readerPid.pid, 'new-browser-correction', 'engineering_matter');
          release.resolve(); assert.equal((await readOutcome).error, undefined);
          const written = await writerOutcome; assert.equal(written.error, undefined); reserved = written.value;
          const fresh = await capture(); assert.throws(() => assertSummaryContextUnchanged(frozen, fresh), /CONTEXT_CHANGED/u);
          assert.ok(fresh.matters[0].selectedWork[0].correctionNotices.some(notice => notice.attemptRef === reserved.task.operationRef));
          const exact = await one.working.readByRef({ ...actorScope, workRef: saved.workRevisionRef });
          assert.deepEqual(JSON.parse((await admin`SELECT state_json FROM engineering_matter_work_revision WHERE matter_work_revision_id=${saved.workRevisionRef}`)[0].state_json), exact.state);
        } finally { release.resolve(); await readOutcome; if (writerOutcome) await writerOutcome; }
      });
      await t.test('existing correction status writer waits on exact action_attempt SHARE and changes the full notice vector', async () => {
        const frozen = await capture(); const locked = deferred(); const release = deferred(); let statusOutcome;
        const readOutcome = one.runtime(() => one.working.withActorTransaction('actor-A', async ({ database }) => {
          await repository.lockContext(frozen, actorScope, database); locked.resolve(); await release.promise;
          assertSummaryContextUnchanged(frozen, await repository.contextBasis(await members.readAll(selected, actorScope, database), actorScope, database));
        })).then(value => ({ value }), error => ({ error }));
        try {
          await Promise.race([locked.promise, readOutcome.then(outcome => { throw outcome.error ?? new Error('Reader missed attempt barrier'); })]);
          statusOutcome = two.runtime(() => two.working.withActorScope('actor-A', () => new ActionAttemptRepository(two.database)
            .requestCancel({ attemptId: reserved.row.attemptId, reason: 'Synthetic explicit cancellation', now: new Date() })))
            .then(value => ({ value }), error => ({ error }));
          await waitForBlocked(admin, writerPid.pid, readerPid.pid, 'existing-correction-status', 'action_attempt');
          release.resolve(); assert.equal((await readOutcome).error, undefined); assert.equal((await statusOutcome).error, undefined);
          const fresh = await capture(); assert.throws(() => assertSummaryContextUnchanged(frozen, fresh), /CONTEXT_CHANGED/u);
          assert.ok(fresh.matters[0].selectedWork[0].correctionNotices.some(notice => notice.attemptRef === reserved.task.operationRef && notice.attemptStatus === 'CANCELLED'));
        } finally { release.resolve(); await readOutcome; if (statusOutcome) await statusOutcome; }
      });
      await t.test('a real correction commit between artifact checks and first SAVE persists CONFLICT, preserves old ledger, and permits a new explicit task', async () => {
        // Install the unchanged accepted Derived schema/preparer in this fresh
        // engineering fixture. Fixture-only ACLs model the existing SDK roles.
        await admin.unsafe(`DO $$ BEGIN
          IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
          IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated_public') THEN CREATE ROLE authenticated_public NOLOGIN IN ROLE authenticated; END IF;
          IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role_public') THEN CREATE ROLE service_role_public NOLOGIN IN ROLE service_role; END IF;
          IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon_public') THEN CREATE ROLE anon_public NOLOGIN IN ROLE anon; END IF;
        END $$`);
        // Adapt the engineering fixture's alternate SDK role suffix to the
        // actual public role scopes accepted by the unchanged DDL preparer.
        await admin.unsafe('GRANT authenticated_public TO authenticated_wiselink_r10_test; GRANT service_role_public TO service_role_wiselink_r10_test');
        const alternatePolicies = await admin`SELECT polname,polpermissive,ARRAY(SELECT pg_get_userbyid(id) FROM unnest(polroles) id) AS roles FROM pg_policy WHERE polrelid='action_attempt'::regclass`;
        for (const row of alternatePolicies) if (!row.polpermissive && row.roles.some(role => ['authenticated','service_role','anon'].includes(role) || role.endsWith('_wiselink_r10_test'))) {
          const roles = row.roles.map(role => ['authenticated','service_role','anon'].includes(role) ? role+'_public' : role.replace('_wiselink_r10_test', '_public'));
          await admin.unsafe(`ALTER POLICY ${row.polname} ON action_attempt TO ${roles.join(',')}`);
        }
        const template = await readFile('server/database/derived-summary.ddl.sql', 'utf8');
        const [snapshot] = await admin`SELECT json_build_object('schema',current_schema(),
          'constraints',(SELECT json_agg(json_build_object('name',conname,'table','action_attempt','definition',pg_get_constraintdef(oid))) FROM pg_constraint WHERE conrelid='action_attempt'::regclass),
          'policies',(SELECT json_agg(json_build_object('name',polname,'table','action_attempt','using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid),
            'command',polcmd,'restrictive',NOT polpermissive,'roles',(SELECT json_agg(pg_get_userbyid(role_oid)) FROM unnest(polroles) AS role_oid))) FROM pg_policy WHERE polrelid='action_attempt'::regclass))::text AS schema_probe`;
        const official = { ok: true, data: [snapshot] };
        await admin.unsafe(rewriteTopLevelPublicPolicies(prepareDerivedSummaryDdl({ template, devSnapshot: official, onlineSnapshot: official })));
        await admin.unsafe('GRANT USAGE ON SCHEMA public TO anon; GRANT SELECT,INSERT,UPDATE ON derived_summary,derived_summary_revision TO authenticated,service_role; GRANT UPDATE ON dm_document_version TO authenticated');
        const sqlContext = new SqlExecutionContextMiddleware({ roleSchema: 'public' });
        const transactions = new EngineeringMatterWorkingRepository(one.database, sqlContext, { roleSchema: 'public' }, null);
        const repo = new DerivedSummaryRepository(one.database, transactions, members);
        const summaryScope = { tenantId: 'tenant-A', principalId: 'S3-summary-service', appId: 'app_17bzc551rsg', authorizationFingerprint: 'synthetic-fixed' };
        const summaryService = new DerivedSummaryService(repo, members, { authorizeOpenClawAutoWorkItemQueue: async () => summaryScope });
        const summaryRuntime = new DerivedSummaryRuntimeService(repo, members, summaryService);
        const run = (hosted, operation) => new Promise((resolve, reject) => sqlContext.use({ userContext: {
          userId: hosted ? '-1' : 'actor-A', isSystemAccount: hosted, roles: [] } }, {}, () => Promise.resolve().then(operation).then(resolve, reject)));
        const prepare = async requestId => {
          const receipt = await run(false, () => summaryService.create({ ...request, requestId, members: selected }, one.actor));
          const target = { summaryId: receipt.summaryId, attemptRef: receipt.attemptRef, scope: summaryScope };
          const lease = await run(true, () => summaryRuntime.claim(target)); const ref = lease.task.modelInput.members[0].evidenceRef;
          await run(true, () => summaryRuntime.readMemberWork({ ...target, ...claimFence(lease), evidenceRefs: [ref], purpose: 'Read exact selected Matter work' }));
          return { target, lease, input: { ...target, ...claimFence(lease), requestId, expectedSummaryRevision: 0,
            contentJson: JSON.stringify({ headline: 'Exact matter candidate', listBrief: 'Selected member only', body: `[[${ref}]]`, limitations: [] }) } };
        };
        const p = await prepare('S3-correction-durable-conflict'); const reached = deferred(); const resume = deferred();
        const oldVerify = members.verifyOriginalEvidence; members.verifyOriginalEvidence = async (...args) => { await oldVerify.apply(members, args); reached.resolve(); await resume.promise; };
        const [before] = await admin`SELECT task_envelope_json,task_input_hash,review_activity_json FROM action_attempt WHERE operation_ref=${p.target.attemptRef}`;
        const finishTerminal = ActionAttemptRepository.prototype.finishTerminal; let rejectedConflictCas = false;
        // A narrowly scoped stale-CAS failure injection still executes the real
        // production UPDATE. PostgreSQL returns zero rows; the runtime must
        // expose that recording failure rather than report a durable CONFLICT.
        ActionAttemptRepository.prototype.finishTerminal = async function(input) {
          if (!rejectedConflictCas && input.attemptId === p.lease.task.actionAttemptId && input.status === 'CONFLICT') {
            rejectedConflictCas = true;
            const result = await finishTerminal.call(this, { ...input, leaseGeneration: input.leaseGeneration + 1000 });
            assert.equal(result, false); return result;
          }
          return finishTerminal.call(this, input);
        };
        const outcome = run(true, () => summaryRuntime.save(p.input)).then(value => ({ value }), error => ({ error }));
        let nextCorrection;
        try {
          await Promise.race([reached.promise, outcome.then(result => { throw result.error ?? new Error('Summary SAVE missed artifact barrier'); })]);
          nextCorrection = await otherWriter.reserveJobAidForBrowser({ ...correction, idempotencyKey: 'S3-correction-after-artifacts' }, two.actor);
          resume.resolve(); assert.match((await outcome).error?.message ?? '', /CONTEXT_CONFLICT_NOT_RECORDED/u);
          assert.equal(rejectedConflictCas, true); ActionAttemptRepository.prototype.finishTerminal = finishTerminal;
          const [failedCas] = await admin`SELECT task_envelope_json,task_input_hash,review_activity_json,status FROM action_attempt WHERE operation_ref=${p.target.attemptRef}`;
          const { status: failedStatus, ...failedImmutable } = failedCas;
          assert.equal(failedStatus, 'RUNNING'); assert.deepEqual(failedImmutable, before);
          assert.deepEqual((await admin`SELECT current_revision,current_summary_ref FROM derived_summary WHERE summary_id=${p.target.summaryId}`)[0], { current_revision: 0, current_summary_ref: null });
          await assert.rejects(run(true, () => summaryRuntime.save(p.input)), /CONTEXT_CHANGED/u);
          const [after] = await admin`SELECT task_envelope_json,task_input_hash,review_activity_json,status,error_code FROM action_attempt WHERE operation_ref=${p.target.attemptRef}`;
          assert.equal(after.status, 'CONFLICT'); assert.equal(after.error_code, 'DERIVED_SUMMARY_CONTEXT_CHANGED');
          const { status: _status, error_code: _error, ...immutable } = after; assert.deepEqual(immutable, before);
          assert.deepEqual((await admin`SELECT current_revision,current_summary_ref FROM derived_summary WHERE summary_id=${p.target.summaryId}`)[0], { current_revision: 0, current_summary_ref: null });
          assert.equal((await admin`SELECT * FROM derived_summary_revision WHERE summary_id=${p.target.summaryId}`).length, 0);
        } finally { resume.resolve(); await outcome; members.verifyOriginalEvidence = oldVerify; ActionAttemptRepository.prototype.finishTerminal = finishTerminal; }
        await two.runtime(() => two.working.withActorScope('actor-A', () => new ActionAttemptRepository(two.database)
          .requestCancel({ attemptId: nextCorrection.row.attemptId, reason: 'Synthetic explicit cleanup', now: new Date() })));
        const fresh = await prepare('S3-correction-fresh-task');
        const savedSummary = await run(true, () => summaryRuntime.save(fresh.input)); assert.equal(savedSummary.revision, 1);
        // Saved recovery remains bound to its exact body and lease/actor checks.
        await admin`UPDATE action_attempt SET lease_expires_at=now()-interval '1 second' WHERE operation_ref=${fresh.target.attemptRef}`;
        await assert.rejects(run(true, () => summaryRuntime.heartbeat({ ...fresh.target, ...claimFence(fresh.lease) })), /LEASE_FENCE_REJECTED/u);
        assert.equal((await admin`SELECT status FROM action_attempt WHERE operation_ref=${fresh.target.attemptRef}`)[0].status, 'RUNNING');
        await admin`UPDATE action_attempt SET lease_expires_at=now()+interval '10 minutes' WHERE operation_ref=${fresh.target.attemptRef}`;
        await admin`UPDATE identity_subject_mapping SET status='REVOKED' WHERE miaoda_user_id='actor-A'`;
        try { await assert.rejects(run(true, () => summaryRuntime.heartbeat({ ...fresh.target, ...claimFence(fresh.lease) })), /UNAVAILABLE|AUTHORIZATION/u); }
        finally { await admin`UPDATE identity_subject_mapping SET status='ACTIVE' WHERE miaoda_user_id='actor-A'`; }
        await run(true, () => summaryRuntime.finish({ ...fresh.target, ...claimFence(fresh.lease), requestId: fresh.input.requestId }));
        const legacyReceipt = await run(false, () => summaryService.create({ ...request, requestId: 'S3-legacy-no-basis', members: selected }, one.actor));
        const [legacy] = await admin`SELECT task_envelope_json FROM action_attempt WHERE operation_ref=${legacyReceipt.attemptRef}`;
        // Simulate an old queued task at INSERT, respecting the real immutable
        // subject trigger. The modern fixture request is explicitly cancelled;
        // no sealed task is edited or trigger/policy disabled.
        await run(true, () => transactions.withActorScope('actor-A', () => new ActionAttemptRepository(one.database)
          .requestCancel({ attemptId: JSON.parse(legacy.task_envelope_json).actionAttemptId, reason: 'Synthetic legacy seed replaces a cancelled fixture request', now: new Date() })));
        const legacyAttemptId = 'ATT-S3-legacy-no-basis'; const legacyAttemptRef = 'AQ-S3-legacy-no-basis';
        const task = JSON.parse(legacy.task_envelope_json); delete task.contextBasis; delete task.taskInputHash;
        task.actionAttemptId = legacyAttemptId; task.operationRef = legacyAttemptRef;
        const { canonicalSha256, canonicalJson } = require('../../server/modules/action-attempt/action-attempt-envelope.ts');
        task.taskInputHash = canonicalSha256(task); const legacyJson = canonicalJson(task);
        await admin`INSERT INTO action_attempt SELECT (jsonb_populate_record(NULL::action_attempt,
          to_jsonb(a) || jsonb_build_object('id',gen_random_uuid(),'attempt_id',${legacyAttemptId}::text,
            'operation_ref',${legacyAttemptRef}::text,'idempotency_key','S3-legacy-insert-fixture',
            'attempt_no',a.attempt_no+1,'status','QUEUED','completed_at',NULL,'cancel_requested_at',NULL,
            'cancel_reason',NULL,'terminal_reason',NULL,'task_envelope_json',${legacyJson}::text,
            'task_input_hash',${task.taskInputHash}::text))).* FROM action_attempt a WHERE a.operation_ref=${legacyReceipt.attemptRef}`;
        const legacyTarget = { summaryId: legacyReceipt.summaryId, attemptRef: legacyAttemptRef, scope: summaryScope };
        await assert.rejects(run(true, () => summaryRuntime.claim(legacyTarget)), /CONTEXT_BASIS_REQUIRED/u);
        const [legacyAfter] = await admin`SELECT task_envelope_json,status,error_code FROM action_attempt WHERE operation_ref=${legacyAttemptRef}`;
        assert.equal(legacyAfter.task_envelope_json, legacyJson); assert.equal(legacyAfter.status, 'CONFLICT');
        assert.equal(legacyAfter.error_code, 'DERIVED_SUMMARY_CONTEXT_BASIS_REQUIRED');
        console.log(JSON.stringify({ CorrectionSummaryRuntimeProof: { conflictPersisted: true, staleConflictCasRanRealSqlAndRejected: true, ledgerPreserved: true,
          freshExplicitSave: true, expiredSavedHeartbeatRejected: true, revokedSavedHeartbeatRejected: true, legacyBasisNotBackfilled: true } }));
      });
      await t.test('a referenced-work correction receipt is collected from exact saved lineage and physically fenced on its existing attempt', async () => {
        const createdB = await one.service.create({ requestId: 'S3-reference-B', title: 'Synthetic reference context B', primaryWorkItemId: fixture.SB_WORK_ITEM_ID }, one.actor);
        const basisB = await one.workingService.resolveWorkingBasis(createdB.matter.matterId, one.actor);
        const authorizeReferenceMatter = async id => { assert.equal(id, actorScope.matterId, 'the synthetic service scope admits only its exact owned source Matter'); };
        const bScope = { ...actorScope, matterId: createdB.matter.matterId, authorizeReferenceMatter };
        const bInput = { ...bScope, expectedMatterRevisionId: basisB.snapshot.currentMatterRevisionId,
          expectedMatterRevision: basisB.snapshot.currentRevisionNo, expectedWorkingRevision: 0, idempotencyKey: 'S3-reference-B-initial',
          trigger: { kind: 'USER_REQUEST', requestId: 'S3-reference-B', instruction: 'Compare exact prior without inheriting target facts.' },
          referenceWorks: [{ matterId: actorScope.matterId, workRef: saved.workRevisionRef, issueKey: 'dependency', purpose: 'Compare the retained unconfirmed condition.' }] };
        const bReserved = await one.runtime(() => writer.reserveJobAid(bInput));
        const bTarget = { ...bScope, attemptRef: bReserved.task.operationRef, principalId: 'hosted-test' };
        const bLease = await one.runtime(() => writer.claim(bTarget)); const bFence = { ...bTarget, ...claimFence(bLease) };
        const prior = bReserved.task.modelInput.sourceCatalog.find(item => item.kind === 'PRIOR_RESULT'); assert.ok(prior?.sourceWork);
        await one.runtime(() => writer.readRegisteredSources({ ...bFence, sourceRefs: [prior.evidenceRef], purpose: 'Read exact source work reference' }));
        const bProposal = { schemaVersion: 'wiselink.jobaid-problem-work.v3', headline: 'Synthetic referenced conditions remain unknown',
          listBrief: 'The target has no confirmed configuration evidence', overview: 'Selected prior is not a target fact.',
          issues: [{ issueKey: 'reference-condition', question: 'What does the selected prior establish?',
            body: `The selected prior requires separate target checks. [[${prior.evidenceRef}]]` }],
          roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS', completionReason: 'Target evidence unavailable', changeSummary: 'Synthetic reference only' };
        const bSaved = await one.runtime(() => writer.saveJobAidWork({ ...bFence, requestId: 'S3-reference-B-save', expectedWorkRevision: 0, workJson: JSON.stringify(bProposal) }));
        const { contentHash: _hash, ...bResult } = fixture.matterResult(bReserved.task); bResult.modelOutput = JSON.stringify({ workRevisionRef: bSaved.workRevisionRef });
        await one.runtime(() => writer.finishJobAid({ ...bFence, result: sealMatterResultEnvelope(bResult) }));
        const sourceCorrection = await otherWriter.reserveJobAidForBrowser({ ...correction, idempotencyKey: 'S3-reference-source-notice' }, two.actor);
        const selectedB = [{ kind: 'MATTER_WORK', matterId: bScope.matterId, workRef: bSaved.workRevisionRef, workRevision: bSaved.workRevision, issueKeys: ['reference-condition'] }];
        const captureB = () => one.runtime(() => one.working.withActorTransaction('actor-A', async ({ database }) => {
          return repository.contextBasis(await members.readAll(selectedB, bScope, database), bScope, database); }));
        const frozen = await captureB(); const referenced = frozen.matters.find(item => item.matterId === bScope.matterId).selectedWork[0].referenceWorkNotices;
        assert.ok(referenced.some(notice => notice.sourceWork.workRef === saved.workRevisionRef &&
          notice.correctionNotices.some(c => c.attemptRef === sourceCorrection.task.operationRef)));
        const [before] = await admin`SELECT state_json FROM engineering_matter_work_revision WHERE matter_work_revision_id=${bSaved.workRevisionRef}`;
        const locked = deferred(); const release = deferred(); let statusOutcome;
        const readOutcome = one.runtime(() => one.working.withActorTransaction('actor-A', async ({ database }) => {
          await repository.lockContext(frozen, bScope, database); locked.resolve(); await release.promise;
          assertSummaryContextUnchanged(frozen, await repository.contextBasis(await members.readAll(selectedB, bScope, database), bScope, database));
        })).then(value => ({ value }), error => ({ error }));
        try {
          await Promise.race([locked.promise, readOutcome.then(outcome => { throw outcome.error ?? new Error('Reference reader missed lock barrier'); })]);
          statusOutcome = two.runtime(() => two.working.withActorScope('actor-A', () => new ActionAttemptRepository(two.database)
            .requestCancel({ attemptId: sourceCorrection.row.attemptId, reason: 'Synthetic referenced notice update', now: new Date() })))
            .then(value => ({ value }), error => ({ error }));
          await waitForBlocked(admin, writerPid.pid, readerPid.pid, 'referenced-correction-status', 'action_attempt');
          release.resolve(); assert.equal((await readOutcome).error, undefined); assert.equal((await statusOutcome).error, undefined);
          const fresh = await captureB(); assert.throws(() => assertSummaryContextUnchanged(frozen, fresh), /CONTEXT_CHANGED/u);
          const referenceNotices = fresh.matters.find(item => item.matterId === bScope.matterId).selectedWork[0].referenceWorkNotices;
          assert.ok(referenceNotices.some(notice => notice.correctionNotices.some(c => c.attemptRef === sourceCorrection.task.operationRef && c.attemptStatus === 'CANCELLED')));
          assert.deepEqual((await admin`SELECT state_json FROM engineering_matter_work_revision WHERE matter_work_revision_id=${bSaved.workRevisionRef}`)[0], before);
        } finally { release.resolve(); await readOutcome; if (statusOutcome) await statusOutcome; }
      });
      await t.test('actual hosted Catalog family CAS serializes both schedules and a synthetic head return is detected by generation', async () => {
        const { MiaodaHostedDocumentCatalog } = require('../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog.ts');
        const { getTableName } = require('drizzle-orm');
        // These privileges belong only to this disposable owned fixture. No
        // production policy, grant or schema change is part of the S3 delta.
        await admin.unsafe('GRANT SELECT,INSERT,UPDATE ON dm_source_artifact,dm_acquisition,dm_document_version,dm_ingress_preflight,dm_currentness_decision TO authenticated,service_role; GRANT UPDATE ON dm_publication_family TO authenticated,service_role');
        const frozen = await capture(); const familyId = frozen.sources.find(row => row.documentVersionId === 'S3-DV-A').familyId;
        const seedCommand = async (suffix, expectedGeneration, expectedHead) => {
          const [family] = await admin`SELECT * FROM dm_publication_family WHERE family_id=${familyId}`;
          const sourceId = 'S3-CATALOG-SRC-'+suffix; const acquisitionId = 'S3-CATALOG-ACQ-'+suffix; const preflightId = 'S3-CATALOG-PF-'+suffix;
          const versionId = 'S3-CATALOG-DV-'+suffix; const now = new Date().toISOString(); const hash = (suffix === 'B' ? 'c' : 'd').repeat(64);
          await admin`INSERT INTO dm_source_artifact (source_artifact_id,sha256,byte_length,media_type,bucket_id,file_path,
            provider_object_id,provider_version_id,readback_verified,created_at)
            VALUES (${sourceId},${hash},100,'application/pdf','synthetic-owned-catalog',${sourceId},${sourceId},${suffix},TRUE,now())`;
          await admin`INSERT INTO dm_acquisition (acquisition_id,source_artifact_id,source_channel,source_ref,
            selection_bucket_id,selection_file_path,provider_object_id,provider_version_id,acquired_by,acquired_at,
            idempotency_key,source_descriptor_json,status)
            VALUES (${acquisitionId},${sourceId},'synthetic_owned_fixture',${sourceId},'synthetic-owned-catalog',${sourceId},
              ${sourceId},${suffix},'actor-A',now(),${'S3-CATALOG-IDEMP-'+suffix},'{}','ACQUIRED_READBACK_VERIFIED')`;
          await admin`INSERT INTO dm_ingress_preflight (preflight_id,acquisition_id,decision,branch,execution_authorized,
            observed_current_generation,observed_current_document_version_id,normalized_descriptor_json,decision_payload_json,status,created_at)
            VALUES (${preflightId},${acquisitionId},'INGEST_NEW_VERSION','CREATE',FALSE,${expectedGeneration},${expectedHead},'{}','{}','READY',now())`;
          return { idempotencyKey: 'catalog:'+acquisitionId, preflightId, preflightDecision: 'INGEST_NEW_VERSION',
            observedCurrentGeneration: expectedGeneration, observedCurrentDocumentVersionId: expectedHead,
            family: { familyId, canonicalIdentityKey: family.canonical_identity_key, documentFamily: family.document_family,
              issuerAuthority: family.issuer_authority, canonicalDocumentNumber: family.canonical_document_number, status: 'ACTIVE', createdAt: now },
            document: { documentId: 'S3-DOC-A', familyId, documentFamily: 'FTD', status: 'ACTIVE', createdAt: now },
            documentVersion: { documentVersionId: versionId, documentId: 'S3-DOC-A', familyId, revisionId: 'S3-CATALOG-REV-'+suffix,
              canonicalRevisionIdentity: 'S3-SYNTHETIC:'+suffix, businessRevision: suffix, revisionDate: '2026-10-08', sourceGeneratedDate: '2026-10-08',
              originalFilename: 'synthetic-owned.pdf', sourceArtifactId: sourceId, acquisitionId, pdfSha256: hash,
              byteLength: 100, mediaType: 'application/pdf', committedAt: now, committedBy: 'actor-A' },
            currentnessDecision: { currentnessDecisionId: 'S3-CATALOG-CURRENTNESS-'+suffix, familyId,
              reason: 'SYNTHETIC_LOCAL_CATALOG_HEAD', decidedAt: now, decidedBy: 'actor-A', preflightId } };
        };
        const baseSource = frozen.sources.find(row => row.familyId === familyId);
        const firstCommand = await seedCommand('B', baseSource.currentGeneration, baseSource.selectedHead);
        const reached = deferred(); const commit = deferred(); let writerOutcome; let readerOutcome;
        // Pause after the real production UPDATE ... RETURNING. The builder and
        // all transaction SQL execute normally; no rows/CAS result are stubbed.
        const pausedDatabase = new Proxy(two.database, { get(target, key) {
          if (key === 'transaction') return (callback, ...args) => target.transaction(tx => callback(new Proxy(tx, { get(transaction, property) {
            if (property === 'update') return table => {
              const observe = builder => new Proxy(builder, { get(query, part) {
                const value = Reflect.get(query, part);
                if (part === 'returning') return async (...args) => { const rows = await value.apply(query, args);
                  if (getTableName(table) === 'dm_publication_family') { assert.equal(rows.length, 1); reached.resolve(); await commit.promise; }
                  return rows; };
                return typeof value === 'function' ? (...args) => { const next = value.apply(query, args);
                  return next && typeof next.returning === 'function' ? observe(next) : next; } : value;
              } });
              return observe(transaction.update(table));
            };
            const value = Reflect.get(transaction, property); return typeof value === 'function' ? value.bind(transaction) : value;
          } })), ...args);
          const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
        } });
        try {
          writerOutcome = two.runtime(() => two.working.withActorScope('actor-A', () => new MiaodaHostedDocumentCatalog(pausedDatabase).commitNewVersion(firstCommand)))
            .then(value => ({ value }), error => ({ error }));
          await Promise.race([reached.promise, writerOutcome.then(outcome => { throw outcome.error ?? new Error('Catalog missed family CAS barrier'); })]);
          readerOutcome = one.runtime(() => one.working.withActorTransaction('actor-A', async ({ database }) => {
            await repository.lockContext(frozen, actorScope, database);
            const fresh = await repository.contextBasis(await members.readAll(selected, actorScope, database), actorScope, database);
            assert.throws(() => assertSummaryContextUnchanged(frozen, fresh), /CONTEXT_CHANGED/u); return fresh;
          })).then(value => ({ value }), error => ({ error }));
          await waitForBlocked(admin, readerPid.pid, writerPid.pid, 'actual-catalog-CAS-first', 'dm_publication_family');
          commit.resolve(); const written = await writerOutcome; assert.equal(written.error, undefined); assert.equal(written.value.currentGeneration, 2);
          const read = await readerOutcome; assert.equal(read.error, undefined); assert.equal(read.value.sources.find(row => row.familyId === familyId).selectedHead, firstCommand.documentVersion.documentVersionId);
        } finally { commit.resolve(); if (writerOutcome) await writerOutcome; if (readerOutcome) await readerOutcome; }
        const secondFrozen = await capture(); const secondCommand = await seedCommand('C', 2, firstCommand.documentVersion.documentVersionId);
        const held = deferred(); const release = deferred(); let secondWriter;
        const secondReader = one.runtime(() => one.working.withActorTransaction('actor-A', async ({ database }) => {
          await repository.lockContext(secondFrozen, actorScope, database); held.resolve(); await release.promise;
          assertSummaryContextUnchanged(secondFrozen, await repository.contextBasis(await members.readAll(selected, actorScope, database), actorScope, database));
        })).then(value => ({ value }), error => ({ error }));
        try {
          await Promise.race([held.promise, secondReader.then(outcome => { throw outcome.error ?? new Error('Summary missed family SHARE'); })]);
          secondWriter = two.runtime(() => two.working.withActorScope('actor-A', () => new MiaodaHostedDocumentCatalog(two.database).commitNewVersion(secondCommand)))
            .then(value => ({ value }), error => ({ error }));
          await waitForBlocked(admin, writerPid.pid, readerPid.pid, 'actual-catalog-reader-first', 'dm_publication_family');
          release.resolve(); assert.equal((await secondReader).error, undefined); const written = await secondWriter; assert.equal(written.error, undefined); assert.equal(written.value.currentGeneration, 3);
        } finally { release.resolve(); await secondReader; if (secondWriter) await secondWriter; }
        // commitNewVersion admits new immutable versions; returning to an old
        // existing version is not that API's inverse operation. This narrowly
        // labelled fixture CAS models a local head return with a new generation.
        const restored = await admin`UPDATE dm_publication_family SET current_document_version_id=${baseSource.selectedHead},current_generation=4
          WHERE family_id=${familyId} AND current_generation=3 AND current_document_version_id=${secondCommand.documentVersion.documentVersionId} RETURNING family_id`;
        assert.equal(restored.length, 1); const returned = await capture(); const returnedSource = returned.sources.find(row => row.familyId === familyId);
        assert.equal(returnedSource.selectedHead, baseSource.selectedHead); assert.equal(returnedSource.currentGeneration, 4);
        assert.throws(() => assertSummaryContextUnchanged(frozen, returned), /CONTEXT_CHANGED/u);
        console.log(JSON.stringify({ CatalogWriterProof: { actualCommitNewVersionBothSchedules: true, headReturnedByFixtureCAS: true,
          originalGeneration: baseSource.currentGeneration, returnedGeneration: returnedSource.currentGeneration, publisherCurrentness: 'UNKNOWN' } }));
      });
    } finally { if (one) await one.release(); if (two) await two.release(); await admin.end({ timeout: 5 }); }
  });
