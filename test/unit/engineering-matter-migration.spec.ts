import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'migrations/0014_engineering_matter_catalog.sql',
);

describe('R09 engineering matter migration', () => {
  let migration: string;

  beforeAll(async () => {
    migration = await readFile(migrationPath, 'utf8');
  });

  it('uses Miaoda-managed privileges without forbidden DCL', () => {
    const executableSql = migration.replace(/--.*$/gmu, '');
    expect(executableSql).not.toMatch(/\b(?:GRANT|REVOKE)\b/iu);
    expect(migration).toContain('Miaoda manages function and table privileges');
    expect(migration.match(/SET search_path FROM CURRENT/gu)).toHaveLength(5);
    expect(executableSql).not.toMatch(/\bpublic\./u);
  });

  it('keeps the authenticated RLS policies as the browser boundary', () => {
    expect(migration.match(/ENABLE ROW LEVEL SECURITY/gu)).toHaveLength(3);
    expect(migration).toContain('engineering_matter_authenticated_select');
    expect(migration).toContain('engineering_matter_revision_authenticated_select');
    expect(migration).toContain('engineering_matter_link_authenticated_select');
    expect(migration).not.toMatch(/DISABLE ROW LEVEL SECURITY/iu);
  });

  it('can resume after a platform-side partial DDL application', () => {
    expect(migration).toContain(
      "conname = 'fk_engineering_matter_current_revision'",
    );
    expect(migration).toContain("conrelid = 'engineering_matter'::regclass");
  });
});
