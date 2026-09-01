import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'migrations/0018_interactive_review_openclaw_candidate_update.sql',
);

describe('R09 OpenClaw Review authenticated actor context migration', () => {
  let migration: string;

  beforeAll(async () => {
    migration = await readFile(migrationPath, 'utf8');
  });

  it('adds only the narrow authenticated candidate update policy', () => {
    const executable = migration.replace(/--.*$/gmu, '');
    expect(executable).toMatch(/ON review_turn FOR UPDATE TO authenticated/iu);
    expect(executable).not.toMatch(/\bservice_role\b/iu);
    expect(executable).not.toMatch(/DISABLE ROW LEVEL SECURITY/iu);
    expect(executable).not.toMatch(/CREATE TABLE|ALTER TABLE/iu);
  });

  it('rejects the public actor and binds owner, mapping, current WorkItem, and active conversation', () => {
    expect(migration).toMatch(
      /current_setting\('app\.user_id', true\) NOT IN \('', '-1'\)/u,
    );
    expect(migration).toContain(
      "current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'",
    );
    expect(migration).toMatch(/current_mapping\.status = 'ACTIVE'/u);
    expect(migration).toMatch(
      /owned_work_item\.requested_by_user_id = review_turn\.actor_id/iu,
    );
    expect(migration).toMatch(
      /owned_work_item\.revision = review_turn\.input_revision/iu,
    );
    expect(migration).toMatch(
      /bound_conversation\.last_synced_revision =[\s\S]*?review_turn\.input_revision/iu,
    );
    expect(migration).toMatch(/bound_conversation\.status = 'ACTIVE'/iu);
  });

  it('allows only empty-to-complete candidate state through RLS before the existing C2 trigger', () => {
    expect(migration).toMatch(/USING \([\s\S]*?assistant_response IS NULL/iu);
    expect(migration).toMatch(
      /WITH CHECK \([\s\S]*?assistant_response IS NOT NULL/iu,
    );
    expect(migration).toContain(
      'The existing review_turn_c2_guard_update trigger remains the final binding',
    );
  });
});
