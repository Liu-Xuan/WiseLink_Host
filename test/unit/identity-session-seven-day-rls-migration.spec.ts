import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const originalMigrationPath = resolve(
  __dirname,
  '../../migrations/0005_identity_oauth_authenticated_rls.sql',
);
const migrationPath = resolve(
  __dirname,
  '../../migrations/0007_identity_session_seven_day_rls.sql',
);

const normalizeSql = (value: string): string =>
  value.replace(/\s+/gu, ' ').trim();

const extractOriginalIssueCheck = (migration: string): string => {
  const match = migration.match(
    /CREATE POLICY identity_session_authenticated_issue[\s\S]*?WITH CHECK \(([\s\S]*?)\n  \);\n\nCREATE POLICY identity_session_authenticated_read/u,
  );
  if (!match?.[1]) {
    throw new Error('Original identity session issue policy was not found');
  }
  return match[1];
};

const extractReplacementIssueCheck = (migration: string): string => {
  const match = migration.match(
    /ALTER POLICY identity_session_authenticated_issue[\s\S]*?WITH CHECK \(([\s\S]*?)\n  \);\n\nCOMMIT;/u,
  );
  if (!match?.[1]) {
    throw new Error('Replacement identity session issue policy was not found');
  }
  return match[1];
};

describe('seven-day authenticated identity session RLS migration', () => {
  let originalMigration: string;
  let migration: string;

  beforeAll(async () => {
    [originalMigration, migration] = await Promise.all([
      readFile(originalMigrationPath, 'utf8'),
      readFile(migrationPath, 'utf8'),
    ]);
  });

  it('changes only the session expiry ceiling from thirty minutes to seven days', () => {
    const originalCheck = extractOriginalIssueCheck(originalMigration);
    const replacementCheck = extractReplacementIssueCheck(migration);
    const expectedCheck = originalCheck.replace(
      "interval '30 minutes'",
      "interval '7 days'",
    );

    expect(originalCheck).toContain("interval '30 minutes'");
    expect(replacementCheck).toContain("interval '7 days'");
    expect(replacementCheck).not.toContain("interval '30 minutes'");
    expect(normalizeSql(replacementCheck)).toBe(normalizeSql(expectedCheck));
  });

  it('alters the existing authenticated INSERT policy without weakening RLS', () => {
    expect(migration).toMatch(
      /ALTER POLICY identity_session_authenticated_issue\s+ON identity_session\s+TO authenticated/iu,
    );
    expect(migration).not.toMatch(/CREATE\s+POLICY|DROP\s+POLICY/iu);
    expect(migration).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/iu);
    expect(migration).not.toMatch(/TO\s+(?:anon|public)\b/iu);
    expect(migration).not.toMatch(/USING\s*\(\s*true\s*\)/iu);
    expect(migration).not.toMatch(/\bGRANT\b/iu);
  });
});
