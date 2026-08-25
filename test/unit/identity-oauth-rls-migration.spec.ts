import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  '../../migrations/0005_identity_oauth_authenticated_rls.sql',
);

describe('official OAuth authenticated RLS migration', () => {
  let migration: string;

  beforeAll(async () => {
    migration = await readFile(migrationPath, 'utf8');
  });

  it('keeps RLS and never opens the state table to anon or public', () => {
    expect(migration).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/iu);
    expect(migration).not.toMatch(/TO\s+(?:anon|public)\b/iu);
    expect(migration).not.toMatch(/USING\s*\(\s*true\s*\)/iu);
    expect(migration).not.toMatch(
      /identity_oauth_state[\s\S]*?FOR\s+ALL\s+TO\s+authenticated/iu,
    );
    expect(migration).toContain(
      'DROP POLICY IF EXISTS identity_oauth_state_service',
    );
  });

  it('limits state access to issue, read, and atomic consume operations', () => {
    expect(migration).toMatch(
      /identity_oauth_state_authenticated_issue[\s\S]*?FOR\s+INSERT/iu,
    );
    expect(migration).toMatch(
      /identity_oauth_state_authenticated_read[\s\S]*?FOR\s+SELECT/iu,
    );
    expect(migration).toMatch(
      /identity_oauth_state_authenticated_consume[\s\S]*?FOR\s+UPDATE/iu,
    );
    expect(migration).not.toMatch(
      /identity_oauth_state_authenticated_[\s\S]*?FOR\s+DELETE/iu,
    );
  });

  it('binds state rows to the Hosted actor and OAuth invariants', () => {
    expect(migration).toContain("current_setting('app.user_id', TRUE)");
    expect(migration).toContain("state_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain(
      "code_verifier ~ '^[A-Za-z0-9._~-]{43,128}$'",
    );
    expect(migration).toContain("interval '5 minutes'");
    expect(migration).toContain('consumed_at IS NULL');
    expect(migration).toContain('consumed_at IS NOT NULL');
  });

  it('keeps mapping and session visibility bound to the same actor', () => {
    expect(migration).toContain(
      'identity_subject_mapping_authenticated_oauth_read',
    );
    expect(migration).toContain('miaoda_user_id = current_setting');
    expect(migration).toContain('identity_session_authenticated_issue');
    expect(migration).toContain('identity_session_authenticated_read');
    expect(migration).toContain('identity_session_authenticated_update');
  });
});
