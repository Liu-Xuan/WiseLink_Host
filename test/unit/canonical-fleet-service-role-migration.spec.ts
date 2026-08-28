import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'migrations/0012_canonical_fleet_service_role_select.sql',
);

describe('R09 canonical FleetMasterData service-role migration', () => {
  let migration: string;
  let executableSql: string;

  beforeAll(async () => {
    migration = await readFile(migrationPath, 'utf8');
    executableSql = migration.replace(/--.*$/gmu, '');
  });

  it('adds exactly five replay-safe SELECT-only service policies', () => {
    expect(
      migration.match(
        /DROP POLICY IF EXISTS canonical_fleet_\S+_service_role_select/gu,
      ),
    ).toHaveLength(5);
    expect(
      migration.match(
        /CREATE POLICY canonical_fleet_\S+_service_role_select/gu,
      ),
    ).toHaveLength(5);
    expect(
      executableSql.match(/FOR SELECT\s+TO service_role\s+USING \(true\)/gu),
    ).toHaveLength(5);
  });

  it('does not add DML, DCL or non-Fleet access', () => {
    expect(executableSql).not.toMatch(
      /FOR\s+(?:INSERT|UPDATE|DELETE|ALL)\s+TO\s+service_role/iu,
    );
    expect(executableSql).not.toMatch(/\b(?:GRANT|REVOKE)\b/iu);
    expect(executableSql).not.toMatch(/WITH CHECK/iu);
    expect(executableSql).not.toMatch(
      /\b(?:work_item|identity_|review_|action_attempt)\b/iu,
    );
    expect(executableSql).not.toMatch(/DISABLE ROW LEVEL SECURITY/iu);
  });
});
