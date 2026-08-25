import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  '../../migrations/0006_identity_subject_mapping_bootstrap.sql',
);

describe('isolated DEV identity mapping bootstrap migration', () => {
  let migration: string;

  beforeAll(async () => {
    migration = await readFile(migrationPath, 'utf8');
  });

  it('adds only an authenticated INSERT policy without weakening RLS', () => {
    expect(migration).toMatch(
      /identity_subject_mapping_authenticated_dev_bootstrap[\s\S]*?FOR INSERT[\s\S]*?TO authenticated/iu,
    );
    expect(migration).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/iu);
    expect(migration).not.toMatch(/TO\s+(?:anon|public)\b/iu);
    expect(migration).not.toMatch(/USING\s*\(\s*true\s*\)/iu);
    expect(migration).not.toMatch(/FOR\s+(?:ALL|UPDATE|DELETE)/iu);
  });

  it('binds the canonical user and audit fields to the Hosted actor', () => {
    expect(migration).toContain("current_setting('app.user_id', TRUE)");
    expect(migration).toContain(
      "miaoda_user_id = current_setting('app.user_id', TRUE)",
    );
    expect(migration).toContain("((_created_by).user_id)::text");
    expect(migration).toContain("((_updated_by).user_id)::text");
  });

  it('limits the insert to the exact app, active revision one, and one actor mapping', () => {
    expect(migration).toContain(
      "expected_client_id = 'cli_aadde8b579f95bc9'",
    );
    expect(migration).toContain("status = 'ACTIVE'");
    expect(migration).toContain('revision = 1');
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*?\(miaoda_user_id, expected_client_id\)[\s\S]*?WHERE status = 'ACTIVE'/iu,
    );
  });
});
