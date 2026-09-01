import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourceMigrationPath = resolve(
  process.cwd(),
  'migrations/0009_review_conversation_persistence_c1.sql',
);
const runtimeMigrationPath = resolve(
  process.cwd(),
  'migrations/0019_interactive_review_hosted_runtime_select.sql',
);

const policyPairs = [
  {
    tableName: 'review_conversation',
    sourcePolicyName: 'review_conversation_authenticated_select',
    policyName: 'review_conversation_hosted_runtime_actor_select',
  },
  {
    tableName: 'review_turn',
    sourcePolicyName: 'review_turn_authenticated_select',
    policyName: 'review_turn_hosted_runtime_actor_select',
  },
  {
    tableName: 'engineer_supplied_input',
    sourcePolicyName: 'engineer_supplied_input_authenticated_select',
    policyName: 'engineer_supplied_input_hosted_runtime_actor_select',
  },
] as const;

describe('R09 Hosted runtime Review SELECT migration', () => {
  let sourceMigration: string;
  let runtimeMigration: string;

  beforeAll(async () => {
    [sourceMigration, runtimeMigration] = await Promise.all([
      readFile(sourceMigrationPath, 'utf8'),
      readFile(runtimeMigrationPath, 'utf8'),
    ]);
  });

  it('adds only three permissive PUBLIC SELECT policies without grants or write widening', () => {
    const executable = runtimeMigration.replace(/--.*$/gmu, '');
    expect(executable.match(/CREATE POLICY/gu)).toHaveLength(3);
    expect(executable.match(/FOR SELECT\s+TO PUBLIC/gu)).toHaveLength(3);
    expect(executable).not.toMatch(/\bGRANT\b|\bREVOKE\b/iu);
    expect(executable).not.toMatch(
      /FOR\s+(?:ALL|INSERT|UPDATE|DELETE)|DISABLE ROW LEVEL SECURITY/iu,
    );
    expect(executable).not.toMatch(
      /CREATE POLICY[\s\S]*?ON public\.(?:work_item|identity_subject_mapping)/iu,
    );
  });

  it.each(policyPairs)(
    'keeps $tableName business qualification mechanically equivalent',
    ({ tableName, sourcePolicyName, policyName }) => {
      const sourceQual = normalizedPolicyQual(
        sourceMigration,
        sourcePolicyName,
      );
      const runtimeQual = normalizedPolicyQual(runtimeMigration, policyName);
      const proof = {
        policyName,
        schemaName: 'public',
        tableName,
        command: 'SELECT',
        permissive: true,
        roles: ['public'],
        qualHash: hash(runtimeQual),
        sourcePolicyName,
        sourceQualHash: hash(sourceQual),
        qualEquivalent: runtimeQual === sourceQual,
      };

      expect(proof).toMatchObject({
        policyName,
        schemaName: 'public',
        tableName,
        command: 'SELECT',
        permissive: true,
        roles: ['public'],
        sourcePolicyName,
        qualEquivalent: true,
      });
      expect(proof.qualHash).toBe(proof.sourceQualHash);
    },
  );

  it('fully qualifies policy targets and every predicate dependency', () => {
    for (const { tableName, policyName } of policyPairs) {
      expect(runtimeMigration).toContain(
        `CREATE POLICY ${policyName}\n  ON public.${tableName}`,
      );
    }
    expect(runtimeMigration).toContain(
      'FROM public.identity_subject_mapping current_mapping',
    );
    expect(runtimeMigration).toContain('FROM public.work_item owned_work_item');
    expect(runtimeMigration).toContain(
      'FROM public.review_conversation bound_conversation',
    );
  });
});

function normalizedPolicyQual(migration: string, policyName: string): string {
  const escapedName = policyName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = migration.match(
    new RegExp(
      `CREATE POLICY ${escapedName}[\\s\\S]*?USING \\(([\\s\\S]*?)\\n  \\);`,
      'u',
    ),
  );
  if (!match?.[1]) throw new Error(`POLICY_QUAL_NOT_FOUND:${policyName}`);
  return match[1]
    .replace(/\bpublic\./gu, '')
    .replace(/\bpg_catalog\./gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
