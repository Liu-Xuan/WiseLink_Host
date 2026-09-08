import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('R10 Engineering Matter working migration and Drizzle mapping', () => {
  let migration: string;
  let schema: string;

  beforeAll(async () => {
    [migration, schema] = await Promise.all([
      readFile(
        resolve(
          process.cwd(),
          'migrations/0023_engineering_matter_working_state.sql',
        ),
        'utf8',
      ),
      readFile(resolve(process.cwd(), 'server/database/schema.ts'), 'utf8'),
    ]);
  });

  it('creates one append-only work-revision table, not a second head or member copy', () => {
    const table = migration.match(
      /CREATE TABLE IF NOT EXISTS engineering_matter_work_revision[\s\S]*?\n\);/u,
    )?.[0];
    expect(table).toBeDefined();
    expect(table).toContain('working_revision integer NOT NULL');
    expect(table).toContain('based_on_matter_revision_id varchar(96) NOT NULL');
    expect(table).toContain('command_json text NOT NULL');
    expect(table).toContain('state_json text NOT NULL');
    expect(table).not.toMatch(/linked_at_work_item_revision|relation_role/iu);
    expect(migration).not.toContain('engineering_matter_work_head');
    expect(migration).not.toContain('engineering_matter_work_member');
  });

  it('exposes SELECT/INSERT RLS only and relies on existing all-member ownership helpers', () => {
    const executable = migration.replace(/--.*$/gmu, '');
    expect(migration.match(/ENABLE ROW LEVEL SECURITY/gu)).toHaveLength(1);
    expect(migration).toContain(
      'engineering_matter_work_revision_authenticated_select',
    );
    expect(migration).toContain(
      'engineering_matter_work_revision_authenticated_insert',
    );
    expect(executable).not.toMatch(
      /engineering_matter_work_revision\s+FOR (?:UPDATE|DELETE)/iu,
    );
    expect(migration).toContain('engineering_matter_all_links_owned_by_actor');
    expect(executable).not.toMatch(/\b(?:GRANT|REVOKE)\b/iu);
  });

  it('adds nullable Review scope and source ids for atomic W4 recovery', () => {
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS review_scope_json jsonb',
    );
    expect(schema).toContain('reviewScopeJson: jsonb("review_scope_json")');
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION review_turn_r10_guard_scope_immutable()',
    );
    expect(migration).toContain(
      'NEW.review_scope_json IS DISTINCT FROM OLD.review_scope_json',
    );
    expect(migration).toContain('uk_engineering_matter_work_revision_attempt');
    expect(migration).toContain('uk_engineering_matter_work_revision_turn');
    expect(migration).toContain(
      'FOREIGN KEY (action_attempt_id) REFERENCES action_attempt(attempt_id)',
    );
    expect(migration).toContain(
      'FOREIGN KEY (review_turn_id) REFERENCES review_turn(review_turn_id)',
    );
  });

  it('fixes the pre-existing Matter current-revision compound FK column order', () => {
    expect(schema).toMatch(
      /columns: \[table\.tenantId, table\.matterId, table\.currentMatterRevisionId\],[\s\S]*?foreignColumns: \[engineeringMatterRevision\.tenantId, engineeringMatterRevision\.matterId, engineeringMatterRevision\.matterRevisionId\],[\s\S]*?name: "fk_engineering_matter_current_revision"/u,
    );
    expect(schema).not.toMatch(
      /columns: \[table\.currentMatterRevisionId, table\.matterId, table\.tenantId\],[\s\S]*?name: "fk_engineering_matter_current_revision"/u,
    );
  });
});
