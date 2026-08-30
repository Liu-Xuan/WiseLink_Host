import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'migrations/0016_batch_applicability_host.sql',
);

describe('R09 batch applicability Host migration', () => {
  let migration: string;

  beforeAll(async () => {
    migration = await readFile(migrationPath, 'utf8');
  });

  it('persists immutable candidate runs and append-only confirmation receipts', () => {
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS batch_applicability_run',
    );
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS batch_applicability_confirmation',
    );
    expect(migration).toContain('BATCH_APPLICABILITY_RUN_APPEND_ONLY');
    expect(migration).toContain('BATCH_APPLICABILITY_CONFIRMATION_APPEND_ONLY');
    expect(migration).toContain('UNIQUE (tenant_id, work_item_id, request_id)');
    expect(migration).toContain('UNIQUE (run_id, candidate_cluster_id)');
  });

  it('requires the same current WorkItem and Fleet head at both insert boundaries', () => {
    expect(migration).toContain('BATCH_APPLICABILITY_RUN_BINDING_NOT_CURRENT');
    expect(migration).toContain(
      'BATCH_APPLICABILITY_CONFIRMATION_RUN_NOT_CURRENT',
    );
    expect(migration).toContain(
      'fleet_head.current_source_snapshot_id =\n        NEW.fleet_source_snapshot_id',
    );
    expect(migration).toContain("run.host_binding_status = 'CURRENT'");
    expect(migration).toContain(
      'owned_work_item.requested_by_user_id = NEW.actor_id',
    );
    expect(migration).toContain(
      'owned_work_item.package_id = NEW.source_package_id',
    );
  });

  it('allows tenant-mapped owners to select/insert but exposes no update/delete policy', () => {
    expect(migration.match(/ENABLE ROW LEVEL SECURITY/gu)).toHaveLength(2);
    expect(migration.match(/FOR SELECT TO authenticated/gu)).toHaveLength(2);
    expect(migration.match(/FOR INSERT TO authenticated/gu)).toHaveLength(2);
    expect(migration).not.toMatch(
      /FOR\s+(?:UPDATE|DELETE|ALL)\s+TO\s+authenticated/iu,
    );
    expect(migration).toContain("expected_client_id = 'cli_aadde8b579f95bc9'");
    expect(migration).not.toMatch(/DISABLE ROW LEVEL SECURITY/iu);
  });

  it('contains no final applicability, ReviewAction, approval, or publication write', () => {
    const executable = migration.replace(/--.*$/gmu, '');
    expect(executable).not.toMatch(/\b(?:GRANT|REVOKE)\b/iu);
    expect(executable).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:work_item_applicability|review_action|canonical_fleet_configuration_fact_version)/iu,
    );
    expect(migration).not.toContain('engineering_approval');
    expect(migration).not.toContain('publication_status');
  });
});
