import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { MiaodaHostedDocumentCatalog } from '../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog';

const databaseUrl = process.env.DOCUMENT_DELIVERY_TEST_DATABASE_URL;
const describePg = databaseUrl ? describe : describe.skip;
const actorUserId = 'actor-new';
const tenantId = 't1';

describePg('0067 new-version Catalog transaction on isolated PostgreSQL', () => {
  let client: ReturnType<typeof postgres>;
  let catalog: MiaodaHostedDocumentCatalog;
  let sessions: { withVerifiedServiceSql: jest.Mock };
  let expectedServiceActor = actorUserId;

  beforeAll(async () => {
    expect(new URL(databaseUrl!).pathname).toMatch(/^\/wl_delivery_test(?:_[a-z0-9_]+)?$/u);
    client = postgres(databaseUrl!, { max: 1, onnotice() {} });
    await client.unsafe('CREATE SCHEMA IF NOT EXISTS workspace_aadkpkjef3slu; SET search_path TO workspace_aadkpkjef3slu, public');
    await client.unsafe(`
      DROP TABLE IF EXISTS auto_document_delivery_authorization,action_attempt,work_item,
        dm_document_version_metadata,dm_currentness_decision,dm_ingress_preflight,
        dm_document_version,dm_document,dm_publication_family,dm_acquisition,
        dm_source_artifact CASCADE;
      DROP FUNCTION IF EXISTS auto_document_delivery_register_upload() CASCADE;
      DROP FUNCTION IF EXISTS auto_document_delivery_freeze_upload() CASCADE;
      DROP FUNCTION IF EXISTS auto_document_delivery_freeze_upload_preflight() CASCADE;
      DROP FUNCTION IF EXISTS auto_document_delivery_preserve() CASCADE;
        DROP FUNCTION IF EXISTS auto_document_delivery_reject_browser_truncate() CASCADE;
        DROP FUNCTION IF EXISTS auto_document_delivery_reject_truncate() CASCADE;
      DROP FUNCTION IF EXISTS dm_reject_immutable_row_mutation() CASCADE;
      DROP TYPE IF EXISTS user_profile CASCADE;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
          CREATE ROLE service_role NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated_workspace_aadkpkjef3slu') THEN
          CREATE ROLE authenticated_workspace_aadkpkjef3slu NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role_workspace_aadkpkjef3slu') THEN
          CREATE ROLE service_role_workspace_aadkpkjef3slu NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon_workspace_aadkpkjef3slu') THEN
          CREATE ROLE anon_workspace_aadkpkjef3slu NOLOGIN;
        END IF;
      END $$;
      CREATE TYPE user_profile AS (user_id text);
      CREATE TABLE action_attempt (action_type text NOT NULL, task_envelope_json text);
      CREATE TABLE work_item (work_item_id text PRIMARY KEY);
      ALTER TABLE action_attempt ENABLE ROW LEVEL SECURITY;
      CREATE POLICY old_action_actor ON action_attempt FOR ALL TO authenticated
        USING (true) WITH CHECK (true);
      CREATE POLICY old_action_workspace_actor ON action_attempt FOR ALL TO authenticated_workspace_aadkpkjef3slu
        USING (true) WITH CHECK (true);
      CREATE POLICY service_action ON action_attempt FOR ALL TO service_role
        USING (true) WITH CHECK (true);
      CREATE POLICY workspace_service_action ON action_attempt FOR ALL TO service_role_workspace_aadkpkjef3slu
        USING (true) WITH CHECK (true);
      GRANT USAGE ON SCHEMA workspace_aadkpkjef3slu TO authenticated,service_role,
        authenticated_workspace_aadkpkjef3slu,service_role_workspace_aadkpkjef3slu;
      GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON action_attempt TO authenticated;
      GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON action_attempt TO authenticated_workspace_aadkpkjef3slu;
      GRANT SELECT,INSERT,UPDATE,DELETE ON work_item TO authenticated;
      GRANT SELECT,INSERT,UPDATE,DELETE ON work_item TO authenticated_workspace_aadkpkjef3slu;
      GRANT SELECT,INSERT ON action_attempt,work_item TO service_role;
      GRANT SELECT,INSERT ON action_attempt,work_item TO service_role_workspace_aadkpkjef3slu;
    `);
    await client.unsafe(await readFile(resolve('migrations/0001_document_management_hosted_catalog.sql'), 'utf8'));
    await client.unsafe(`GRANT SELECT,INSERT,UPDATE,DELETE ON
      dm_source_artifact,dm_acquisition,dm_publication_family,dm_document,
      dm_document_version,dm_ingress_preflight,dm_currentness_decision
      TO service_role,service_role_workspace_aadkpkjef3slu;
      DO $$ DECLARE table_name text; BEGIN
        FOREACH table_name IN ARRAY ARRAY[
          'dm_source_artifact','dm_acquisition','dm_publication_family','dm_document',
          'dm_document_version','dm_ingress_preflight','dm_currentness_decision'] LOOP
          EXECUTE format('CREATE POLICY fixture_hosted_service ON %I FOR ALL TO service_role_workspace_aadkpkjef3slu USING (true) WITH CHECK (true)', table_name);
        END LOOP;
      END $$;
      GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON dm_acquisition,dm_ingress_preflight TO authenticated;
      GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON dm_acquisition,dm_ingress_preflight TO authenticated_workspace_aadkpkjef3slu;
      GRANT SELECT ON dm_source_artifact,dm_publication_family,dm_document_version TO authenticated;`);
    await client.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA workspace_aadkpkjef3slu
      GRANT ALL ON TABLES TO service_role,authenticated,
        service_role_workspace_aadkpkjef3slu,authenticated_workspace_aadkpkjef3slu,
        anon_workspace_aadkpkjef3slu`);
    await client.unsafe(await readFile(resolve('migrations/0067_document_upload_delivery_authorization.sql'), 'utf8'));
    for (const choice of [
      { suffix: 'selected', sha: 'a'.repeat(64), byteLength: 100,
        actorUserId, tenantId, delivery: { reading: true, translation: 'ZH_FULL' } },
      { suffix: 'none', sha: 'b'.repeat(64), byteLength: 101,
        actorUserId, tenantId, delivery: { reading: false, translation: 'NONE' } },
      { suffix: 'other-tenant', sha: 'c'.repeat(64), byteLength: 102,
        actorUserId: 'actor-other', tenantId: 't2',
        delivery: { reading: true, translation: 'NONE' } },
    ]) {
      await client`INSERT INTO dm_source_artifact(source_artifact_id,sha256,byte_length,
        media_type,bucket_id,file_path,provider_object_id,provider_version_id,
        readback_verified,created_at)
        VALUES (${`SRC-${choice.suffix}`},${choice.sha},${choice.byteLength},
          'application/pdf','bucket',${`/${choice.suffix}.pdf`},
          ${`object-${choice.suffix}`},'v1',true,CURRENT_TIMESTAMP)`;
      await client`INSERT INTO dm_acquisition(acquisition_id,source_artifact_id,
        source_channel,source_ref,selection_bucket_id,selection_file_path,
        provider_object_id,provider_version_id,acquired_by,acquired_at,
        idempotency_key,source_descriptor_json,status)
        VALUES (${`ACQ-${choice.suffix}`},${`SRC-${choice.suffix}`},
          'document_library_upload',${`DOCUMENT_UPLOAD:${choice.actorUserId}:${choice.suffix}`},
          'bucket',${`/${choice.suffix}.pdf`},${`object-${choice.suffix}`},'v1',
          ${choice.actorUserId},CURRENT_TIMESTAMP,
          ${`tenant:${choice.tenantId}:request:document-upload:${choice.actorUserId}:${choice.suffix}`},
          ${JSON.stringify({ documentDeliveryIntent: choice.delivery })},
          'ACQUIRED_READBACK_VERIFIED')`;
      await client`INSERT INTO dm_ingress_preflight(preflight_id,acquisition_id,
        decision,branch,execution_authorized,observed_current_generation,
        normalized_descriptor_json,decision_payload_json,status,created_at)
        VALUES (${`PF-${choice.suffix}`},${`ACQ-${choice.suffix}`},
          'INGEST_NEW_FAMILY','NEW_FAMILY',false,0,
          ${JSON.stringify({
            identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
            pageCount: 1, sha256: choice.sha, sizeBytes: choice.byteLength,
            documentCode: `DOC-${choice.suffix}`, canonicalDocumentFamily: 'SB',
            issuer: 'BOEING', businessRevision: 'R1', revisionDate: '2026-09-28',
            sourceGeneratedDate: '',
          })},
          '{}','READY',CURRENT_TIMESTAMP)`;
    }
    await client.unsafe('SET ROLE service_role_workspace_aadkpkjef3slu');
    await client`SELECT set_config('app.user_id',${actorUserId},false)`;
    sessions = {
      withVerifiedServiceSql: jest.fn((operation: () => Promise<unknown>, expectedActorId: string) => {
        expect(expectedActorId).toBe(expectedServiceActor);
        return operation();
      }),
    };
    catalog = new MiaodaHostedDocumentCatalog(drizzle(client) as never, sessions as never);
  });

  afterAll(async () => {
    if (client) {
      await client.unsafe('RESET ROLE');
      await client.end();
    }
  });

  function command(choice: { suffix: string; sha: string; byteLength: number;
    actorUserId?: string; tenantId?: string;
    delivery: { reading: boolean; translation: 'ZH_FULL' | 'NONE' } }) {
    const actor = choice.actorUserId ?? actorUserId;
    const tenant = choice.tenantId ?? tenantId;
    const now = '2026-09-28T00:00:00.000Z';
    const familyId = `FAM-${choice.suffix}`;
    const documentVersionId = `DV-${choice.suffix}`;
    const acquisitionId = `ACQ-${choice.suffix}`;
    const sourceArtifactId = `SRC-${choice.suffix}`;
    const preflightId = `PF-${choice.suffix}`;
    return {
      idempotencyKey: `catalog:${acquisitionId}`,
      preflightId, preflightDecision: 'INGEST_NEW_FAMILY',
      observedCurrentGeneration: 0, observedCurrentDocumentVersionId: null,
      uploadCommit: {
        actorUserId: actor, tenantId: tenant,
        selection: { bucketId: 'bucket', filePath: `/${choice.suffix}.pdf` },
        sourceArtifactId, sha256: choice.sha, byteLength: choice.byteLength,
        decision: 'INGEST_NEW_FAMILY', documentDelivery: choice.delivery,
      },
      family: {
        familyId, canonicalIdentityKey: `tenant:${tenant}:family:${choice.suffix}`,
        documentFamily: 'SB', issuerAuthority: 'BOEING',
        canonicalDocumentNumber: `DOC-${choice.suffix}`,
        status: 'ACTIVE', createdAt: now,
      },
      document: { documentId: `DOCID-${choice.suffix}`, familyId,
        documentFamily: 'SB', status: 'ACTIVE', createdAt: now },
      documentVersion: {
        documentVersionId, documentId: `DOCID-${choice.suffix}`,
        familyId, revisionId: `REV-${choice.suffix}`,
        canonicalRevisionIdentity: 'DATE:2026-09-28',
        businessRevision: 'R1', revisionDate: '2026-09-28',
        sourceGeneratedDate: '', originalFilename: `${choice.suffix}.pdf`,
        extractedMetadata: null, sourceArtifactId, acquisitionId,
        pdfSha256: choice.sha, byteLength: choice.byteLength,
        mediaType: 'application/pdf', committedAt: now, committedBy: actor,
      },
      currentnessDecision: {
        currentnessDecisionId: `CD-${choice.suffix}`, familyId,
        reason: 'INGEST_NEW_FAMILY', decidedAt: now,
        decidedBy: actor, preflightId,
      },
    };
  }

  it('rejects an actor-created READY decision that differs from the Host decision', async () => {
    const choice = { suffix: 'selected', sha: 'a'.repeat(64), byteLength: 100,
      delivery: { reading: true, translation: 'ZH_FULL' as const } };
    await client`UPDATE dm_ingress_preflight SET decision='REUSE_EXACT'
      WHERE preflight_id='PF-selected'`;
    await expect(catalog.commitNewVersion(command(choice)))
      .rejects.toMatchObject({ code: 'DOCUMENT_UPLOAD_NEW_VERSION_SCOPE_MISMATCH' });
    expect((await client`SELECT count(*)::int AS count FROM dm_document_version`)[0].count).toBe(0);
    expect((await client`SELECT count(*)::int AS count
      FROM auto_document_delivery_authorization`)[0].count).toBe(0);
    await client`UPDATE dm_ingress_preflight SET decision='INGEST_NEW_FAMILY'
      WHERE preflight_id='PF-selected'`;
  });

  it.each([
    { suffix: 'selected', sha: 'a'.repeat(64), byteLength: 100,
      delivery: { reading: true, translation: 'ZH_FULL' as const }, expectedAuthorizations: 1 },
    { suffix: 'none', sha: 'b'.repeat(64), byteLength: 101,
      delivery: { reading: false, translation: 'NONE' as const }, expectedAuthorizations: 0 },
  ])('commits $suffix once and replays without new version or authorization', async (choice) => {
    const input = command(choice);
    const first = await catalog.commitNewVersion(input);
    expect(first).toMatchObject({ documentVersionId: `DV-${choice.suffix}`,
      currentnessChanged: true, currentGeneration: 1 });
    const replay = await catalog.commitNewVersion(input);
    expect(replay).toMatchObject({ disposition: 'IDEMPOTENT_REPLAY',
      documentVersionId: `DV-${choice.suffix}`, currentnessChanged: false,
      currentGeneration: 1 });
    const replayRequest = {
      idempotencyKey: `tenant:t1:request:document-upload:${actorUserId}:${choice.suffix}`,
      expectedAcquisitionId: `ACQ-${choice.suffix}`, tenantId, actorUserId,
      sourceChannel: 'document_library_upload',
      sourceRef: `DOCUMENT_UPLOAD:${actorUserId}:${choice.suffix}`,
      selection: { bucketId: 'bucket', filePath: `/${choice.suffix}.pdf` },
      documentDeliveryIntent: choice.delivery,
    };
    const recovered = await catalog.findIngestionByIdempotency(replayRequest);
    expect(recovered).toMatchObject({ status: 'COMMITTED',
      acquisitionId: `ACQ-${choice.suffix}`, documentVersionId: `DV-${choice.suffix}`,
      preflightId: `PF-${choice.suffix}`, catalogFreshReadVerified: true });
    expect(await catalog.findIngestionByIdempotency(replayRequest)).toEqual(recovered);
    await expect(catalog.findIngestionByIdempotency({
      ...replayRequest, documentDeliveryIntent: { reading: !choice.delivery.reading,
        translation: choice.delivery.translation },
    })).rejects.toMatchObject({ code: 'ACQUISITION_IDEMPOTENCY_CONFLICT' });
    const [counts] = await client`SELECT
      (SELECT count(*)::int FROM dm_document_version
        WHERE acquisition_id=${`ACQ-${choice.suffix}`}) AS versions,
      (SELECT count(*)::int FROM dm_currentness_decision
        WHERE preflight_id=${`PF-${choice.suffix}`}) AS decisions,
      (SELECT count(*)::int FROM auto_document_delivery_authorization
        WHERE acquisition_id=${`ACQ-${choice.suffix}`}) AS authorizations`;
    expect(counts).toEqual({ versions: 1, decisions: 1,
      authorizations: choice.expectedAuthorizations });
    const [binding] = await client`SELECT a.status AS acquisition_status,
      p.status AS preflight_status,p.commit_idempotency_key,
      a.document_version_id AS acquisition_version,p.document_version_id AS preflight_version
      FROM dm_acquisition a JOIN dm_ingress_preflight p ON p.acquisition_id=a.acquisition_id
      WHERE a.acquisition_id=${`ACQ-${choice.suffix}`}`;
    expect(binding).toEqual({ acquisition_status: 'COMMITTED_CANONICAL',
      preflight_status: 'COMMITTED', commit_idempotency_key: `catalog:ACQ-${choice.suffix}`,
      acquisition_version: `DV-${choice.suffix}`, preflight_version: `DV-${choice.suffix}` });
  });
  it('selects only the trusted tenant candidates despite service SELECT visibility', async () => {
    const other = { suffix: 'other-tenant', sha: 'c'.repeat(64), byteLength: 102,
      actorUserId: 'actor-other', tenantId: 't2',
      delivery: { reading: true, translation: 'NONE' as const } };
    expectedServiceActor = other.actorUserId;
    await client`SELECT set_config('app.user_id',${other.actorUserId},false)`;
    const committed = await catalog.commitNewVersion(command(other));
    expect(committed.documentVersionId).toBe('DV-other-tenant');
    const all = await client`SELECT acquisition_id,tenant_key,actor_user_id
      FROM auto_document_delivery_authorization ORDER BY acquisition_id`;
    expect(all).toEqual([
      { acquisition_id: 'ACQ-other-tenant', tenant_key: 't2', actor_user_id: 'actor-other' },
      { acquisition_id: 'ACQ-selected', tenant_key: 't1', actor_user_id: actorUserId },
    ]);
    expect(await catalog.listDocumentUploadDeliveryCandidates({ tenantId: 't1', limit: 10 }))
      .toEqual([{ acquisitionId: 'ACQ-selected', documentVersionId: 'DV-selected',
        actorUserId, status: 'WAITING' }]);
    expect(await catalog.listDocumentUploadDeliveryCandidates({ tenantId: 't2', limit: 10 }))
      .toEqual([{ acquisitionId: 'ACQ-other-tenant', documentVersionId: 'DV-other-tenant',
        actorUserId: other.actorUserId, status: 'WAITING' }]);
    expect(await catalog.listDocumentUploadDeliveryCandidates({ tenantId: 'wrong', limit: 10 }))
      .toEqual([]);
    expect(await catalog.listDocumentUploadDeliveryCandidates({ tenantId: 't1',
      afterAcquisitionId: 'ACQ-other-tenant', limit: 10 })).toEqual([]);
  });

  it('links an exact deduplicated version while keeping the new selection and canonical source distinct', async () => {
    expectedServiceActor = actorUserId;
    await client`SELECT set_config('app.user_id',${actorUserId},false)`;
    await client`INSERT INTO dm_acquisition(acquisition_id,source_artifact_id,
      source_channel,source_ref,selection_bucket_id,selection_file_path,
      provider_object_id,provider_version_id,acquired_by,acquired_at,
      idempotency_key,source_descriptor_json,status)
      VALUES ('ACQ-exact','SRC-selected','document_library_upload',
        'DOCUMENT_UPLOAD:actor-new:exact','bucket','/new-upload.pdf',
        'object-new-upload','version-new-upload','actor-new',CURRENT_TIMESTAMP,
        'tenant:t1:request:document-upload:actor-new:exact',
        ${JSON.stringify({ documentDeliveryIntent: { reading: true, translation: 'ZH_FULL' },
          sourceStorageKey: 'bucket:/selected.pdf' })},'ACQUIRED_READBACK_VERIFIED')`;
    await client`INSERT INTO dm_ingress_preflight(preflight_id,acquisition_id,
      decision,branch,execution_authorized,observed_current_generation,
      observed_current_document_version_id,normalized_descriptor_json,
      decision_payload_json,status,created_at)
      VALUES ('PF-exact','ACQ-exact','REUSE_EXACT','EXACT_MATCH',false,1,
        'DV-selected',${JSON.stringify({ sha256: 'a'.repeat(64), sizeBytes: 100 })},
        '{}','READY',CURRENT_TIMESTAMP)`;
    const input = {
      acquisitionId: 'ACQ-exact', documentVersionId: 'DV-selected',
      preflightId: 'PF-exact', idempotencyKey: 'catalog:ACQ-exact',
      uploadCommit: {
        actorUserId, tenantId, selection: { bucketId: 'bucket', filePath: '/new-upload.pdf' },
        selectedProviderObjectId: 'object-new-upload',
        selectedProviderVersionId: 'version-new-upload',
        immutableSource: { bucketId: 'bucket', filePath: '/selected.pdf',
          providerObjectId: 'object-selected', providerVersionId: 'v1' },
        sourceArtifactId: 'SRC-selected', sha256: 'a'.repeat(64), byteLength: 100,
        decision: 'REUSE_EXACT', documentDelivery: { reading: true, translation: 'ZH_FULL' },
      },
    };
    for (const uploadCommit of [
      { ...input.uploadCommit, selectedProviderObjectId: 'other-object' },
      { ...input.uploadCommit, immutableSource: { ...input.uploadCommit.immutableSource,
        filePath: '/wrong-canonical.pdf' } },
      { ...input.uploadCommit, tenantId: 't2' },
      { ...input.uploadCommit, sha256: 'b'.repeat(64) },
      { ...input.uploadCommit, decision: 'RESUME_EXISTING_PROCESS' },
    ]) {
      await expect(catalog.linkAcquisitionToVersion({ ...input, uploadCommit }))
        .rejects.toMatchObject({ code: 'DOCUMENT_UPLOAD_EXACT_COMMIT_SCOPE_MISMATCH' });
    }
    expect((await client`SELECT status FROM dm_acquisition WHERE acquisition_id='ACQ-exact'`)[0].status)
      .toBe('ACQUIRED_READBACK_VERIFIED');
    await catalog.linkAcquisitionToVersion(input);
    const [linked] = await client`SELECT a.status AS acquisition_status,
      a.document_version_id,p.status AS preflight_status,
      p.commit_idempotency_key,auth.status AS authorization_status
      FROM dm_acquisition a JOIN dm_ingress_preflight p ON p.acquisition_id=a.acquisition_id
      JOIN auto_document_delivery_authorization auth ON auth.acquisition_id=a.acquisition_id
      WHERE a.acquisition_id='ACQ-exact'`;
    expect(linked).toEqual({ acquisition_status: 'LINKED_EXACT_DOCUMENT_VERSION',
      document_version_id: 'DV-selected', preflight_status: 'COMMITTED',
      commit_idempotency_key: 'catalog:ACQ-exact', authorization_status: 'WAITING' });
  });

});
