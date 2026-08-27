import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'migrations/0011_canonical_fleet_master_data.sql',
);

describe('R09 canonical FleetMasterData migration', () => {
  let migration: string;

  beforeAll(async () => {
    migration = await readFile(migrationPath, 'utf8');
  });

  it('uses Miaoda-managed table privileges without forbidden DCL', () => {
    const executableSql = migration.replace(/--.*$/gmu, '');
    expect(executableSql).not.toMatch(/\b(?:GRANT|REVOKE)\b/iu);
    expect(migration).toContain('Miaoda manages table privileges');
  });

  it('keeps all five tables tenant-readable and browser-write closed by RLS', () => {
    expect(migration.match(/ENABLE ROW LEVEL SECURITY/gu)).toHaveLength(5);
    expect(
      migration.match(/CREATE POLICY canonical_fleet_\S+_authenticated_select/gu),
    ).toHaveLength(5);
    expect(migration.match(/FOR SELECT TO authenticated/gu)).toHaveLength(5);
    expect(migration).not.toMatch(
      /FOR\s+(?:INSERT|UPDATE|DELETE|ALL)\s+TO\s+authenticated/iu,
    );
    expect(migration).toContain(
      "current_mapping.miaoda_tenant_id =\n          canonical_fleet_source_snapshot.tenant_id",
    );
    expect(migration).not.toMatch(/DISABLE ROW LEVEL SECURITY/iu);
  });
});
