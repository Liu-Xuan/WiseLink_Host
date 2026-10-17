import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  postgresCapability,
  startOwnedPostgres,
} from '../pg/owned-postgres-cluster.mjs';

const capability = await postgresCapability();
const filename = process.env.LCM_NATIVE_CLEANUP_SQL;
test(
  'precise administrative old-LCM cleanup: immutable triggers, new/other rows and external FK rollback',
  { skip: !capability.available || !filename },
  async () => {
    const sql = await readFile(filename, 'utf8');
    const owner = sql.match(/'([0-9]+)','([0-9]+)',item[.]table_name/u);
    const source = sql.match(/source_instance_id<>'([^']+)'/u)?.[1];
    const ids = [...sql.matchAll(/'([a-f0-9]{64})'/gu)].map(
      (match) => match[1],
    );
    assert.ok(owner && source);
    assert.equal(new Set(ids).size, 4);
    const tenant = owner[1],
      actor = owner[2],
      cluster = await startOwnedPostgres(capability);
    const evidence = {
      localOnly: true,
      platformCalls: 0,
      unchangedSource: true,
      checks: [],
    };
    try {
      await cluster.admin.unsafe('CREATE TYPE user_profile AS (user_id text)');
      await cluster.admin.unsafe(
        await readFile(
          new URL(
            '../../migrations/candidates/lcm_personal_import.hosted.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      await cluster.admin`INSERT INTO lcm_personal_source(application_scope_id,tenant_id,owner_actor_id,source_instance_id,created_from_sha256)
      VALUES('synthetic-cleanup-app',${tenant},${actor},${source},${'a'.repeat(64)})`;
      for (let index = 0; index < 4; index++) {
        const sha = String(index + 1).repeat(64),
          collection = 'synthetic-cleanup-' + index;
        await cluster.admin`INSERT INTO lcm_source_artifact(tenant_id,owner_actor_id,sha256,byte_length,artifact_ref)
        VALUES(${tenant},${actor},${sha},100,'synthetic retained original')`;
        await cluster.admin`INSERT INTO lcm_source_collection(tenant_id,owner_actor_id,source_instance_id,collection_id,
        request_id,request_hash,scope_key,context_json,source_time_precision,imported_at)
        VALUES(${tenant},${actor},${source},${collection},${collection},'synthetic-hash','synthetic-scope','{}'::jsonb,'unknown',now())`;
        await cluster.admin`INSERT INTO lcm_configuration_snapshot(tenant_id,owner_actor_id,snapshot_id,source_instance_id,
        collection_id,scope_key,artifact_sha256,original_file_name,local_source_path,imported_at,content_digest,
        record_count,coordinate_count,diagnostics_json)
        VALUES(${tenant},${actor},${ids[index]},${source},${collection},'synthetic-scope',${sha},'synthetic.xls',
          'synthetic-original',now(),'synthetic-digest',1,1,'[]'::jsonb)`;
      }
      await cluster.admin`INSERT INTO lcm_configuration_observation(tenant_id,owner_actor_id,snapshot_id,record_id,
      identity_key,aircraft_model,tail_number,semantic_basis,observation,record_json)
      SELECT ${tenant},${actor},${ids[0]},'synthetic-row-'||n,'synthetic-identity','MODEL','B-1001',
        'synthetic','unknown-blank','{}'::jsonb FROM generate_series(1,59848) n`;
      for (let index = 0; index < 5; index++)
        await cluster.admin`INSERT INTO lcm_personal_import_request
      (tenant_id,owner_actor_id,source_instance_id,request_id,payload_key,selection_bucket_id,selection_file_path,
        selection_provider_object_id,original_sha256,original_byte_length,snapshot_id)
      VALUES(${tenant},${actor},${source},${'synthetic-request-' + index},'synthetic-payload','synthetic-bucket','synthetic-path',
        'synthetic-provider',${'a'.repeat(64)},100,${ids[index] ?? null})`;
      await cluster.admin.unsafe(
        'CREATE TABLE unrelated_native_cleanup_guard(id int PRIMARY KEY); INSERT INTO unrelated_native_cleanup_guard VALUES(1)',
      );
      const before = await cluster.admin`SELECT * FROM lcm_personal_source`;
      const triggers =
        await cluster.admin`SELECT tgname,tgenabled FROM pg_trigger WHERE tgname LIKE 'lcm_%' ORDER BY tgname`;
      await assert.rejects(
        cluster.admin`DELETE FROM lcm_configuration_snapshot`,
        { code: '55000' },
      );
      const body = sql.replace(/^BEGIN;\n/mu, '').replace(/^COMMIT;\n/mu, '');
      const negative = async (other) => {
        await assert.rejects(
          cluster.admin.begin(async (tx) => {
            await tx`INSERT INTO lcm_source_artifact(tenant_id,owner_actor_id,sha256,byte_length,artifact_ref)
          VALUES(${other ? 'synthetic-other-tenant' : tenant},${other ? 'synthetic-other-actor' : actor},${'f'.repeat(64)},1,'synthetic-new-row')`;
            await tx.unsafe(body);
          }),
          (error) =>
            error.code === 'P0001' &&
            error.message.includes('LCM_CLEANUP_SCOPE_CHANGED'),
        );
        assert.equal(
          (
            await cluster.admin`SELECT count(*)::int AS count FROM lcm_configuration_snapshot`
          )[0].count,
          4,
        );
        assert.equal(
          (
            await cluster.admin`SELECT count(*)::int AS count FROM lcm_source_artifact`
          )[0].count,
          4,
        );
      };
      await negative(false);
      await negative(true);
      evidence.checks.push(
        'same-owner new row and other-owner row each reject and roll back before cleanup',
      );
      await cluster.admin.unsafe(
        'CREATE TABLE unrelated_native_cleanup_fk(tenant_id text,owner_actor_id text,snapshot_id text, FOREIGN KEY(tenant_id,owner_actor_id,snapshot_id) REFERENCES lcm_configuration_snapshot(tenant_id,owner_actor_id,snapshot_id))',
      );
      await assert.rejects(cluster.admin.unsafe(sql), { code: '0A000' });
      await cluster.admin.unsafe('ROLLBACK');
      assert.equal(
        (
          await cluster.admin`SELECT count(*)::int AS count FROM lcm_configuration_observation`
        )[0].count,
        59848,
      );
      await cluster.admin.unsafe('DROP TABLE unrelated_native_cleanup_fk');
      evidence.checks.push(
        'an external referencing FK blocks explicit TRUNCATE without CASCADE; all six-table data unchanged',
      );
      await cluster.admin.unsafe(sql);
      for (const table of [
        'lcm_source_artifact',
        'lcm_source_collection',
        'lcm_configuration_snapshot',
        'lcm_configuration_observation',
        'lcm_evidence_relation',
        'lcm_personal_import_request',
      ])
        assert.equal(
          (
            await cluster.admin.unsafe(
              'SELECT count(*)::int AS count FROM ' + table,
            )
          )[0].count,
          0,
        );
      assert.deepEqual(
        await cluster.admin`SELECT * FROM lcm_personal_source`,
        before,
      );
      assert.deepEqual(
        await cluster.admin`SELECT tgname,tgenabled FROM pg_trigger WHERE tgname LIKE 'lcm_%' ORDER BY tgname`,
        triggers,
      );
      assert.equal(
        (
          await cluster.admin`SELECT count(*)::int AS count FROM unrelated_native_cleanup_guard`
        )[0].count,
        1,
      );
      await cluster.admin.unsafe(
        await readFile(
          new URL(
            '../../migrations/candidates/lcm_native_matrix.hosted.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      evidence.checks.push(
        'exact six-table cleanup succeeds with immutable UPDATE/DELETE triggers unchanged, source and unrelated rows unchanged; additive native schema applies afterward',
      );
      if (process.env.LCM_NATIVE_EVIDENCE_DIR)
        await writeFile(
          join(
            process.env.LCM_NATIVE_EVIDENCE_DIR,
            'native-cleanup-postgres.actual.private.json',
          ),
          JSON.stringify(evidence, null, 2) + '\n',
        );
    } finally {
      await cluster.stop();
    }
  },
);
