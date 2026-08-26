import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const previousMigrationPath = resolve(
  __dirname,
  '../../migrations/0007_identity_session_seven_day_rls.sql',
);
const migrationPath = resolve(
  __dirname,
  '../../migrations/0008_identity_session_authenticated_role_rebind.sql',
);

const normalizeSql = (value: string): string =>
  value.replace(/\s+/gu, ' ').trim();

const extractIssueCheck = (migration: string): string => {
  const match = migration.match(
    /(?:ALTER|CREATE) POLICY identity_session_authenticated_issue[\s\S]*?WITH CHECK \(([\s\S]*?)\n  \);/u,
  );
  if (!match?.[1]) {
    throw new Error('Identity session issue policy was not found');
  }
  return match[1];
};

describe('authenticated identity-session role rebind migration', () => {
  let previousMigration: string;
  let migration: string;

  beforeAll(async () => {
    [previousMigration, migration] = await Promise.all([
      readFile(previousMigrationPath, 'utf8'),
      readFile(migrationPath, 'utf8'),
    ]);
  });

  it('recreates the portable authenticated policy instead of altering its role', () => {
    const executableSql = migration.replace(/--.*$/gmu, '');
    expect(migration).toMatch(
      /DROP POLICY IF EXISTS identity_session_authenticated_issue\s+ON identity_session/iu,
    );
    expect(migration).toMatch(
      /CREATE POLICY identity_session_authenticated_issue[\s\S]*?FOR INSERT\s+TO authenticated/iu,
    );
    expect(executableSql).not.toMatch(/ALTER POLICY/iu);
    expect(executableSql).not.toMatch(/TO\s+authenticated_[a-z0-9_]+/iu);
  });

  it('keeps every seven-day session check unchanged', () => {
    expect(normalizeSql(extractIssueCheck(migration))).toBe(
      normalizeSql(extractIssueCheck(previousMigration)),
    );
  });

  it('does not weaken RLS or grant access to another role', () => {
    expect(migration).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/iu);
    expect(migration).not.toMatch(/TO\s+(?:anon|public)\b/iu);
    expect(migration).not.toMatch(/USING\s*\(\s*true\s*\)/iu);
    expect(migration).not.toMatch(/\bGRANT\b/iu);
  });
});
