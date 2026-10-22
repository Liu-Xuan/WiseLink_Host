import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Request, Response } from 'express';
import { ForbiddenException } from '@nestjs/common';
import { SqlExecutionContextMiddleware } from '@lark-apaas/fullstack-nestjs-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import type { DocumentTranslationTaskEnvelope } from '../../../server/modules/action-attempt/document-translation-task-envelope';
import type { TranslationGenerationRequestV2 } from '@shared/canonical-translation-v2.interface';
import { canonicalJson } from '../../../server/modules/action-attempt/action-attempt-envelope';
import { DocumentTranslationAttemptRepository } from '../../../server/modules/action-attempt/document-translation-attempt.repository';
import { DocumentTranslationBrowserController } from '../../../server/modules/canonical-host/document-translation-browser.controller';
import { DocumentTranslationBrowserService } from '../../../server/modules/canonical-host/document-translation-browser.service';
import { DocumentTranslationRuntimeService } from '../../../server/modules/canonical-host/document-translation-runtime.service';
import { EngineeringMatterWorkingRepository } from '../../../server/modules/canonical-host/engineering-matter-working.repository';
import { ConfiguredDevelopmentCanonicalServiceScopeAuthorization } from '../../../server/modules/canonical-host/configured-development-service-scope.authorization';
import { CanonicalTranslationWorkspaceRepository } from '../../../server/modules/canonical-host/canonical-translation-workspace.repository';
import { MiaodaHostedDocumentCatalog } from '../../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog';
import { SessionResolver } from '../../../server/modules/identity/session-resolver.service';

interface Fixture {
  root: DocumentTranslationTaskEnvelope;
  prior: DocumentTranslationTaskEnvelope;
  modelInput: DocumentTranslationTaskEnvelope['modelInput'];
  generations: TranslationGenerationRequestV2[];
}

/** Real SDK SQL contexts, service guard, catalog reads, RLS and reservations.
 * Source bytes/ACL rows and semantic/model dependencies are isolated fixtures;
 * this test never invokes a model or claims a production browser session. */
export async function verifyBrowserTranslationPostgres(admin: ReturnType<typeof postgres>,
  databaseUrl: string, data: Fixture, actorUserId: string) {
  const schema = `bt_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const serviceRole = `service_role_${schema}`, browserRole = `authenticated_${schema}`;
  const scope = { tenantId: data.prior.tenantId, actorUserId, documentVersionId: data.prior.documentVersionId };
  const parseRunId = data.prior.parseRunId;
  const pg = postgres(databaseUrl, { max: 4, onnotice() {}, connection: { search_path: `${schema},public` } });
  const environment: Record<string, string | undefined> = {
    SANDBOX_ID: 'isolated-browser-translation-test', MIAODA_LOCAL_DEV: undefined,
    WL_OPENCLAW_SERVICE_SCOPE_ENABLED: '1', WL_OPENCLAW_GATEWAY_AUTH_MODE: 'API_KEY',
    WL_OPENCLAW_SERVICE_SCOPE_ENV: 'DEV', WL_OPENCLAW_SERVICE_PRINCIPAL_ID: 'service:browser-test',
    WL_OPENCLAW_SERVICE_TENANT_ID: scope.tenantId, WL_OPENCLAW_SERVICE_AUTO_QUEUE_ENABLED: '1',
  };
  const savedEnvironment = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try {
    await admin.unsafe(`CREATE SCHEMA ${schema};
      CREATE ROLE ${serviceRole} NOLOGIN NOSUPERUSER NOBYPASSRLS IN ROLE service_role;
      CREATE ROLE ${browserRole} NOLOGIN NOSUPERUSER NOBYPASSRLS IN ROLE authenticated;`);
    for (const table of ['dm_document_version', 'dm_document_parse_run', 'dm_document_reading_run',
      'action_attempt', 'translation_workspace', 'translation_block_revision']) {
      await admin.unsafe(`CREATE TABLE ${schema}.${table} (LIKE pg_temp.${table} INCLUDING ALL);
        INSERT INTO ${schema}.${table} SELECT * FROM pg_temp.${table}`);
    }
    await admin.unsafe(`ALTER TABLE ${schema}.dm_document_version ADD COLUMN family_id text,
      ADD COLUMN source_artifact_id text;
      CREATE TABLE ${schema}.dm_publication_family(family_id text,canonical_identity_key text);
      CREATE TABLE ${schema}.dm_acquisition(acquisition_id text,document_version_id text,source_artifact_id text,
        acquired_by text,source_channel text,status text,idempotency_key text);
      CREATE TABLE ${schema}.auto_document_delivery_authorization(acquisition_id text,actor_user_id text,
        tenant_key text,document_version_id text,source_artifact_id text,reading boolean,translation text);
      CREATE TABLE ${schema}.browser_source_access(tenant_id text,actor_user_id text,
        document_version_id text,parse_run_id text,allowed boolean);`);
    const source = data.modelInput.source.originalBinding;
    await admin.unsafe(`UPDATE ${schema}.dm_document_version SET family_id=$1,source_artifact_id=$2`,
      ['F-browser', source.sourceArtifactId]);
    await admin.unsafe(`INSERT INTO ${schema}.dm_publication_family VALUES ($1,$2)`,
      ['F-browser', `tenant:${encodeURIComponent(scope.tenantId)}:family:browser`]);
    await admin.unsafe(`INSERT INTO ${schema}.dm_acquisition VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      ['ACQ-browser', scope.documentVersionId, source.sourceArtifactId, actorUserId,
        'document_library_upload', 'COMMITTED_CANONICAL', `tenant:${encodeURIComponent(scope.tenantId)}:request:browser`]);
    await admin.unsafe(`INSERT INTO ${schema}.auto_document_delivery_authorization VALUES ($1,$2,$3,$4,$5,false,'ZH_FULL')`,
      ['ACQ-browser', actorUserId, encodeURIComponent(scope.tenantId), scope.documentVersionId, source.sourceArtifactId]);
    for (const id of [actorUserId, 'other-reader']) await admin.unsafe(
      `INSERT INTO ${schema}.browser_source_access VALUES ($1,$2,$3,$4,true)`,
      [scope.tenantId, id, scope.documentVersionId, parseRunId]);
    await admin.unsafe(`SET search_path TO ${schema},pg_temp,public;
      CREATE FUNCTION ${schema}.engineering_matter_actor_has_tenant(t varchar) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT EXISTS(SELECT 1 FROM browser_source_access WHERE tenant_id=t
          AND actor_user_id=current_setting('app.user_id',true) AND allowed) $$;
      CREATE FUNCTION ${schema}.engineering_matter_document_owned_by_actor(t varchar,dv varchar)
        RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM browser_source_access
          WHERE tenant_id=t AND document_version_id=dv
            AND actor_user_id=current_setting('app.user_id',true) AND allowed) $$;`);
    const migration = (name: string) => readFileSync(resolve(process.cwd(), `migrations/${name}`), 'utf8');
    const install = async (sourceSql: string, kind: 'FUNCTION' | 'POLICY', name: string) => {
      const pattern = kind === 'FUNCTION' ? `CREATE FUNCTION ${name}\\([\\s\\S]*?\\$\\$;`
        : `CREATE POLICY ${name}[\\s\\S]*?;`;
      const statement = sourceSql.match(new RegExp(pattern, 'u'))?.[0];
      if (!statement) throw new Error(`BROWSER_TRANSLATION_MIGRATION_MISSING_${name}`);
      await admin.unsafe(statement.replaceAll('service_role_workspace_aadkpkjef3slu', serviceRole)
        .replaceAll('authenticated_workspace_aadkpkjef3slu', browserRole)
        .replaceAll('anon_workspace_aadkpkjef3slu', 'anon'));
    };
    const attemptMigration = migration('0048_document_translation_attempt_subject.sql');
    for (const name of ['action_attempt_check_document_original', 'action_attempt_preserve_document_subject',
      'document_translation_attempt_owned']) await install(attemptMigration, 'FUNCTION', name);
    await admin.unsafe(`CREATE TRIGGER action_attempt_check_document_original
      BEFORE INSERT OR UPDATE ON action_attempt FOR EACH ROW EXECUTE FUNCTION action_attempt_check_document_original();
      CREATE TRIGGER action_attempt_preserve_document_subject
      BEFORE UPDATE ON action_attempt FOR EACH ROW EXECUTE FUNCTION action_attempt_preserve_document_subject();`);
    for (const name of ['action_attempt_document_subject_boundary', 'action_attempt_document_read',
      'action_attempt_document_actor', 'action_attempt_document_no_native_insert',
      'action_attempt_document_no_native_update', 'action_attempt_document_no_native_delete'])
      await install(attemptMigration, 'POLICY', name);
    const uploadMigration = migration('0067_document_upload_delivery_authorization.sql');
    for (const name of ['auto_document_delivery_no_browser', 'auto_document_delivery_service_read'])
      await install(uploadMigration, 'POLICY', name);
    const workspaceMigration = migration('0047_document_translation_workspace_subject.sql');
    for (const name of ['translation_workspace_document_read', 'translation_block_document_read',
      'translation_workspace_document_boundary', 'translation_block_document_boundary'])
      await install(workspaceMigration, 'POLICY', name);
    for (const table of ['translation_workspace', 'translation_block_revision'])
      await admin.unsafe(`CREATE POLICY fixture_service ON ${table} FOR ALL TO ${serviceRole} USING(true) WITH CHECK(true)`);
    for (const table of ['action_attempt', 'auto_document_delivery_authorization',
      'translation_workspace', 'translation_block_revision'])
      await admin.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await admin.unsafe(`GRANT USAGE ON SCHEMA ${schema} TO ${serviceRole},${browserRole};
      GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA ${schema} TO ${serviceRole},${browserRole};`);

    const db = drizzle(pg);
    const middleware = new SqlExecutionContextMiddleware({ roleSchema: schema } as never);
    const sessions = new SessionResolver({ validate: jest.fn() } as never,
      { applicationScopeId: 'app_17bzc551rsg' } as never, middleware);
    const actors = new EngineeringMatterWorkingRepository(db as never, middleware, { roleSchema: schema }, {} as never);
    const catalog = new MiaodaHostedDocumentCatalog(db as never, sessions);
    const attempts = new DocumentTranslationAttemptRepository(db as never);
    const workspaces = new CanonicalTranslationWorkspaceRepository(db as never);
    const sourceRoles: string[] = [];
    const authorizeSource = async (documentVersionId: string, requestedRun: string,
      actor: { tenantId: string; actorUserId: string }) => {
      const [allowed] = await db.execute<{ role: string }>(sql`SELECT current_user AS role
        FROM browser_source_access WHERE tenant_id=${actor.tenantId} AND actor_user_id=${actor.actorUserId}
          AND actor_user_id=current_setting('app.user_id',true) AND document_version_id=${documentVersionId}
          AND parse_run_id=${requestedRun} AND allowed`);
      if (!allowed) throw new ForbiddenException('SOURCE_ACCESS_DENIED');
      sourceRoles.push(allowed.role);
    };
    const reader = { readDocumentOriginal: async (version: string, run: string,
      actor: { tenantId: string; actorUserId: string }) => {
      await authorizeSource(version, run, actor);
      return { original: { binding: source }, run: { manifestArtifact: { ...data.modelInput.source.parsedArtifact,
        relativePath: 'original/manifest.json', readback: 'VERIFIED' } } };
    } };
    const parsing = { status: async (version: string, actor: { tenantId: string; actorUserId: string }) => {
      await authorizeSource(version, parseRunId, actor);
      return { documentVersionId: version, publishedRun: { parseRunId } };
    } };
    const authorization = new ConfiguredDevelopmentCanonicalServiceScopeAuthorization(undefined,
      { readDocumentDeliveryIntents: async () => [] } as never, catalog);
    const runtime = new DocumentTranslationRuntimeService(authorization, actors, reader as never,
      { prepareOriginal: async ({ assertAuthorized }: { assertAuthorized: () => Promise<void> }) => {
        await assertAuthorized(); return {};
      }, taskInput: () => data.modelInput } as never,
      attempts, { read: async () => ({}) } as never, parsing as never, {} as never, {} as never);
    const service = new DocumentTranslationBrowserService(catalog, reader as never, parsing as never,
      attempts, workspaces, runtime, authorization, sessions);
    const controller = new DocumentTranslationBrowserController(service, sessions);
    const request = (actor = actorUserId, tenant = scope.tenantId) => ({ headers: {}, userContext: {
      userId: actor, tenantId: tenant, appId: 'app_17bzc551rsg', env: 'runtime', isSystemAccount: false, roles: [],
    } } as unknown as Request);
    const asBrowser = <T>(req: Request, operation: () => Promise<T>) => new Promise<T>((done, fail) =>
      middleware.use(req, {} as Response, () => { void operation().then(done, fail); }));
    const input = { parseRunId, expectedAttemptRef: data.prior.operationRef, action: 'RESUME_KNOWN_FAILURE' as const };
    const req = request();
    await asBrowser(req, async () => {
      // The unchanged RLS and guard reject direct browser SQL before the bridge.
      expect(await catalog.readDocumentUploadDeliveryIntents(scope)).toEqual([]);
      await expect(actors.withActorScope(actorUserId, async () => undefined)).rejects.toThrow('RUNTIME_AUTHORIZATION_UNAVAILABLE');
      expect(await controller.prepare(scope.documentVersionId, parseRunId, req)).toMatchObject({
        state: 'READY', action: input.action });
      expect(sourceRoles[0]).toBe(browserRole);
      const [identity] = await db.execute<{ role: string; actor: string }>(sql`SELECT current_user AS role,
        current_setting('app.user_id',true) AS actor`);
      expect(identity).toEqual({ role: browserRole, actor: actorUserId });
      expect(await catalog.readDocumentUploadDeliveryIntents(scope)).toEqual([]);
    });
    const other = request('other-reader');
    await asBrowser(other, async () => {
      expect(await controller.prepare(scope.documentVersionId, parseRunId, other)).toMatchObject({ state: 'UNSUPPORTED' });
      await expect(controller.continue(scope.documentVersionId, input, other)).rejects.toThrow('OWN_UPLOAD_REQUIRED');
    });
    const foreign = request(actorUserId, 'other-tenant');
    await asBrowser(foreign, async () => {
      await expect(controller.prepare(scope.documentVersionId, parseRunId, foreign)).rejects.toThrow('SOURCE_ACCESS_DENIED');
      await expect(controller.continue(scope.documentVersionId, input, foreign)).rejects.toThrow('SOURCE_ACCESS_DENIED');
    });
    await asBrowser(req, async () => {
      await expect(controller.continue('DV-other', input, req)).rejects.toThrow('SOURCE_ACCESS_DENIED');
      await expect(controller.continue(scope.documentVersionId, { ...input, parseRunId: 'PR-other' }, req))
        .rejects.toThrow('SOURCE_ACCESS_DENIED');
    });
    await admin.unsafe(`UPDATE browser_source_access SET allowed=false WHERE actor_user_id=$1`, [actorUserId]);
    await asBrowser(req, async () => {
      await expect(controller.continue(scope.documentVersionId, input, req)).rejects.toThrow('SOURCE_ACCESS_DENIED');
    });
    await admin.unsafe(`UPDATE browser_source_access SET allowed=true`);
    for (const unsettled of ['COMMITTING', 'UNKNOWN']) {
      if (unsettled === 'COMMITTING') await admin.unsafe(`UPDATE action_attempt SET status='COMMITTING' WHERE attempt_id=$1`,
        [data.prior.actionAttemptId]);
      else await admin.unsafe(`UPDATE translation_workspace SET generation_requests_json=$1`,
        [canonicalJson([...data.generations, { ...data.generations[0], status: 'REGISTERED' }])]);
      await asBrowser(req, async () => {
        expect(await controller.prepare(scope.documentVersionId, parseRunId, req)).toMatchObject({ action: null });
        await expect(controller.continue(scope.documentVersionId, input, req)).rejects.toThrow();
      });
      await admin.unsafe(`UPDATE action_attempt SET status='FAILED' WHERE attempt_id=$1`, [data.prior.actionAttemptId]);
      await admin.unsafe(`UPDATE translation_workspace SET generation_requests_json=$1`, [canonicalJson(data.generations)]);
    }
    const [before] = await admin.unsafe<{ count: number }[]>(`SELECT count(*)::int AS count FROM action_attempt`);
    expect(before.count).toBe(2);
    const [first, concurrent] = await Promise.all([0, 1].map(() => {
      const current = request();
      return asBrowser(current, () => controller.continue(scope.documentVersionId, input, current));
    }));
    expect(first.attemptRef).toBe(concurrent.attemptRef);
    await asBrowser(req, async () => {
      expect(await controller.continue(scope.documentVersionId, input, req)).toMatchObject({
        attemptRef: first.attemptRef, reused: true });
      expect(await controller.prepare(scope.documentVersionId, parseRunId, req)).toMatchObject({ state: 'ACTIVE' });
    });
    const [after] = await admin.unsafe<{ count: number; forged: number }[]>(`SELECT count(*)::int AS count,
      count(*) FILTER(WHERE work_item_id IS NOT NULL)::int AS forged FROM action_attempt`);
    expect(after).toEqual({ count: 3, forged: 0 });
    expect(req.userContext.isSystemAccount).toBe(false);
    await asBrowser(req, async () => {
      expect(await catalog.readDocumentUploadDeliveryIntents(scope)).toEqual([]);
      await expect(db.execute(sql`UPDATE action_attempt SET status='CANCELLED' WHERE operation_ref=${first.attemptRef}`))
        .resolves.toHaveLength(0);
    });
  } finally {
    await pg.end();
    await admin.unsafe('RESET ROLE; SET search_path TO pg_temp,public');
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE;
      DROP ROLE IF EXISTS ${serviceRole}; DROP ROLE IF EXISTS ${browserRole};`);
    for (const [key, value] of savedEnvironment) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
