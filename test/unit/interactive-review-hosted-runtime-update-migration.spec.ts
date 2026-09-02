import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const authenticatedMigrationPath = resolve(
  process.cwd(),
  'migrations/0018_interactive_review_openclaw_candidate_update.sql',
);
const hostedMigrationPath = resolve(
  process.cwd(),
  'migrations/0021_interactive_review_hosted_runtime_candidate_update.sql',
);

describe('R09 Hosted runtime Review candidate UPDATE migration', () => {
  let authenticatedMigration: string;
  let hostedMigration: string;

  beforeAll(async () => {
    [authenticatedMigration, hostedMigration] = await Promise.all([
      readFile(authenticatedMigrationPath, 'utf8'),
      readFile(hostedMigrationPath, 'utf8'),
    ]);
  });

  it('adds one scoped UPDATE policy and one SECURITY INVOKER function', () => {
    const executable = hostedMigration.replace(/--.*$/gmu, '');
    expect(executable.match(/CREATE POLICY/gu)).toHaveLength(1);
    expect(executable.match(/FOR UPDATE\s+TO service_role/gu)).toHaveLength(1);
    expect(executable).toMatch(/SECURITY INVOKER/iu);
    expect(executable).not.toMatch(/SECURITY DEFINER/iu);
    expect(executable).not.toMatch(/\bGRANT\b|\bREVOKE\b/iu);
    expect(executable).toMatch(
      /review_turn_hosted_runtime_actor_candidate_update[\s\S]*hosted_role\.role_name <> 'public'[\s\S]*pg_catalog\.pg_has_role\([\s\S]*REVIEW_HOSTED_RUNTIME_ROLE_REQUIRED/iu,
    );
    expect(executable).not.toMatch(
      /FOR\s+(?:ALL|INSERT|SELECT|DELETE)|DISABLE ROW LEVEL SECURITY/iu,
    );
    const roleGuard = executable.indexOf('REVIEW_HOSTED_RUNTIME_ROLE_REQUIRED');
    const actorContext = executable.indexOf("set_config('app.user_id'");
    const candidateUpdate = executable.indexOf('UPDATE review_turn');
    expect(roleGuard).toBeGreaterThan(0);
    expect(actorContext).toBeGreaterThan(roleGuard);
    expect(candidateUpdate).toBeGreaterThan(actorContext);
    expect(executable).not.toMatch(/\bpublic\./u);
  });

  it('matches the authenticated USING and WITH CHECK predicates', () => {
    for (const clause of ['USING', 'WITH CHECK'] as const) {
      const authenticated = normalizedClause(
        authenticatedMigration,
        'review_turn_authenticated_candidate_update',
        clause,
      );
      const hosted = normalizedClause(
        hostedMigration,
        'review_turn_hosted_runtime_actor_candidate_update',
        clause,
      );
      expect(hash(hosted)).toBe(hash(authenticated));
      expect(hosted).toBe(authenticated);
    }
  });
});

function normalizedClause(
  migration: string,
  policyName: string,
  clause: 'USING' | 'WITH CHECK',
): string {
  const escapedName = policyName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const end = clause === 'USING' ? '\\n  \\)\\n  WITH CHECK' : '\\n  \\);';
  const match = migration.match(
    new RegExp(
      `CREATE POLICY ${escapedName}[\\s\\S]*?${clause} \\(([\\s\\S]*?)${end}`,
      'u',
    ),
  );
  if (!match?.[1]) throw new Error(`POLICY_${clause}_NOT_FOUND:${policyName}`);
  return match[1]
    .replace(/\bpublic\./gu, '')
    .replace(/\bpg_catalog\./gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
