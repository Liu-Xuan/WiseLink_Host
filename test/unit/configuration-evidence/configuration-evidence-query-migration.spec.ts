import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'migrations/0020_configuration_evidence_candidate_query.sql',
);

describe('R09 supervised configuration-evidence query migration', () => {
  let migration: string;

  beforeAll(async () => {
    migration = await readFile(migrationPath, 'utf8');
  });

  it('adds one WorkItem-scoped attempt table instead of a second evidence store', () => {
    expect(migration.match(/CREATE TABLE IF NOT EXISTS/gu)).toHaveLength(1);
    expect(migration).toContain('configuration_evidence_query_attempt');
    expect(migration).toContain('candidate_evidence_ref');
    expect(migration).toContain('candidate_snapshot_json');
    expect(migration).not.toMatch(/CREATE TABLE[^;]*(?:node|edge|graph)/iu);
    expect(migration).not.toMatch(/applicability_(?:result|decision|truth)/iu);
  });

  it('enforces one concurrent query, two rounds, five queries and deduplication', () => {
    expect(migration).toMatch(
      /round_no BETWEEN 1 AND 2 AND query_count BETWEEN 1 AND 5/iu,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uk_configuration_evidence_query_running[\s\S]*?WHERE terminal_status = 'RUNNING'/iu,
    );
    expect(migration).toMatch(
      /UNIQUE \(tenant_id, work_item_id, input_revision, query_fingerprint\)/iu,
    );
    expect(migration).toMatch(
      /UNIQUE \(tenant_id, work_item_id, request_id\)/iu,
    );
  });

  it('keeps query result immutable and permits only a successful candidate adoption', () => {
    expect(migration).toContain(
      'CONFIGURATION_EVIDENCE_QUERY_BINDING_IMMUTABLE',
    );
    expect(migration).toContain(
      'CONFIGURATION_EVIDENCE_QUERY_RESULT_IMMUTABLE',
    );
    expect(migration).toMatch(
      /adoption_status = 'ADOPTED'[\s\S]*?terminal_status IN \('SUCCEEDED_EVIDENCE', 'SUCCEEDED_NO_RECORD'\)/iu,
    );
    expect(migration).toMatch(
      /adopted_work_item_revision = input_revision \+ 1/iu,
    );
  });

  it('preserves explicit non-evidence terminal states and owner-scoped RLS', () => {
    for (const status of [
      'SUCCEEDED_NO_RECORD',
      'NOT_CONNECTED',
      'ACCESS_DENIED',
      'CONFLICT',
      'FAILED_VALIDATION',
      'TIMEOUT',
      'CANCELED',
    ]) {
      expect(migration).toContain(`'${status}'`);
    }
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('configuration_evidence_actor_owns_work_item');
    expect(migration).not.toMatch(
      /CREATE POLICY\s+\S*service_role[\s\S]*?USING\s*\(\s*true\s*\)/iu,
    );
  });
});
