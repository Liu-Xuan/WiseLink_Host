import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'migrations/0010_interactive_review_host_mcp_c2.sql',
);

describe('R09 C2 interactive review migration', () => {
  let migration: string;

  beforeAll(async () => {
    migration = await readFile(migrationPath, 'utf8');
  });

  it('extends the accepted C1 ReviewTurn and existing ActionAttempt only', () => {
    const executableSql = migration.replace(/--.*$/gmu, '');
    expect(migration).toMatch(/ALTER TABLE review_turn/iu);
    expect(migration).toMatch(/REFERENCES action_attempt\(attempt_id\)/iu);
    expect(migration).toMatch(/action_type = 'OPENCLAW_INTERACTIVE_REVIEW'/iu);
    expect(executableSql).not.toMatch(/CREATE TABLE\s+review_action/iu);
    expect(executableSql).not.toMatch(/UPDATE\s+work_item/iu);
    expect(executableSql).not.toMatch(/projection_json/iu);
    expect(executableSql).not.toMatch(/\bSTALE\b/iu);
  });

  it('makes the assistant candidate complete-or-null and append-only', () => {
    expect(migration).toMatch(/ck_review_turn_c2_candidate_state/iu);
    expect(migration).toMatch(/REVIEW_TURN_C2_CANDIDATE_APPEND_ONLY/iu);
    expect(migration).toMatch(/REVIEW_TURN_C2_PARTIAL_UPDATE_REJECTED/iu);
    expect(migration).toMatch(/attempt\.status = 'COMMITTING'/iu);
    expect(migration).toMatch(
      /attempt\.result_content_hash = NEW\.result_content_hash/iu,
    );
  });

  it('does not loosen the existing WorkItem/task active-attempt uniqueness', () => {
    expect(migration).not.toMatch(/uk_action_attempt_active_work_task/iu);
    expect(migration).not.toMatch(/actor_user_id\).*WHERE status/iu);
  });

  it('does not add a broad RLS bypass or an authenticated update policy', () => {
    expect(migration).not.toMatch(/service_role/iu);
    expect(migration).not.toMatch(/CREATE POLICY/iu);
    expect(migration).not.toMatch(/DISABLE ROW LEVEL SECURITY/iu);
  });
});
