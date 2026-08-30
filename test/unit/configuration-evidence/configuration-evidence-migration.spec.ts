import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'migrations/0017_configuration_evidence_persistence.sql',
);

describe('R09 finite configuration-evidence persistence migration', () => {
  let migration: string;

  beforeAll(async () => {
    migration = await readFile(migrationPath, 'utf8');
  });

  it('creates only the six finite WorkItem persistence objects', () => {
    expect(migration.match(/CREATE TABLE IF NOT EXISTS/gu)).toHaveLength(6);
    expect(migration).toContain('configuration_evidence_snapshot_version');
    expect(migration).toContain('configuration_evidence_event_version');
    expect(migration).toContain('configuration_evidence_fact_version');
    expect(migration).toContain(
      'configuration_evidence_predicate_trace_version',
    );
    expect(migration).toContain('configuration_evidence_trace_staleness');
    expect(migration).toContain('configuration_evidence_work_item_head');
    expect(migration).not.toMatch(/CREATE TABLE[^;]*(?:node|edge|graph)/iu);
  });

  it('binds immutable history and current head to the exact WorkItem revision', () => {
    expect(migration).toMatch(
      /work_item_revision_after = work_item_revision_before \+ 1/iu,
    );
    expect(migration).toMatch(
      /UNIQUE \(work_item_id, work_item_revision_after\)/iu,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \(work_item_id\) REFERENCES work_item\(work_item_id\)/iu,
    );
    expect(migration).toMatch(
      /uk_configuration_evidence_snapshot_revision_binding[\s\S]*?UNIQUE \([\s\S]*?snapshot_id,[\s\S]*?configuration_revision[\s\S]*?\)/iu,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \([\s\S]*?tenant_id,[\s\S]*?work_item_id,[\s\S]*?current_snapshot_id,[\s\S]*?configuration_revision[\s\S]*?\)[\s\S]*?REFERENCES configuration_evidence_snapshot_version\([\s\S]*?snapshot_id,[\s\S]*?configuration_revision/iu,
    );
  });

  it('keeps version rows append-only and owner-scoped while allowing only head movement', () => {
    const executableSql = migration.replace(/--.*$/gmu, '');
    const appendOnlyTables = [
      'configuration_evidence_snapshot_version',
      'configuration_evidence_event_version',
      'configuration_evidence_fact_version',
      'configuration_evidence_predicate_trace_version',
      'configuration_evidence_trace_staleness',
    ];

    expect(migration.match(/ENABLE ROW LEVEL SECURITY/gu)).toHaveLength(6);
    for (const tableName of appendOnlyTables) {
      expect(executableSql).not.toMatch(
        new RegExp(
          `CREATE POLICY\\s+\\S+\\s+ON\\s+${tableName}\\s+FOR\\s+(?:UPDATE|DELETE)`,
          'iu',
        ),
      );
    }
    expect(migration).toMatch(
      /configuration_evidence_head_authenticated_update[\s\S]*?FOR UPDATE TO authenticated/iu,
    );
    expect(migration).toContain('configuration_evidence_actor_owns_work_item');
    expect(migration).toContain(
      "scoped_actor_id = current_setting('app.user_id', true)",
    );
    expect(migration).toMatch(
      /owned_work_item\.requested_by_user_id = scoped_actor_id/iu,
    );
    expect(executableSql).not.toMatch(
      /CREATE POLICY\s+\S*service_role[\s\S]*?USING\s*\(\s*true\s*\)/iu,
    );
  });

  it('stores UNKNOWN/CONFLICT and dependency STALE without a second evaluator contract', () => {
    expect(migration).toContain(
      "truth IN ('TRUE', 'FALSE', 'UNKNOWN', 'CONFLICT')",
    );
    expect(migration).toContain(
      "status IN ('EVALUATED', 'WAITING_INPUT', 'CONFLICT', 'STALE')",
    );
    expect(migration).toContain('stale_reason_json text NOT NULL');
    expect(migration).not.toMatch(/applicability_(?:result|decision|truth)/iu);
    expect(migration).not.toMatch(/tdms|openclaw|aily/iu);
  });
});
