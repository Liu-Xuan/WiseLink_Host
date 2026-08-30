import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migrationPath: string = resolve(
  process.cwd(),
  'migrations/0015_translation_memory_knowledge_governance.sql',
);

describe('R09 candidate-only Translation Memory governance migration', () => {
  let migration: string;

  beforeAll(async (): Promise<void> => {
    migration = await readFile(migrationPath, 'utf8');
  });

  it('uses the lane-exclusive 0015 slot and creates only the three governance tables', () => {
    expect(migrationPath).toContain(
      '0015_translation_memory_knowledge_governance.sql',
    );
    expect(migration.match(/CREATE TABLE IF NOT EXISTS/gu)).toHaveLength(3);
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS translation_knowledge_candidate',
    );
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS translation_knowledge_source_ref',
    );
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS translation_knowledge_governance_event',
    );
  });

  it('dedupes replay by existing artifact identity and SourceUnit without a new text hash', () => {
    expect(migration).toContain(
      'UNIQUE (tenant_id, source_artifact_sha256, source_unit_id)',
    );
    expect(migration).not.toMatch(
      /(?:dedupe|source_text|translated_text)_hash/iu,
    );
  });

  it('preserves exact SourceRef, rule, execution, owner and validity lineage', () => {
    const requiredColumns: string[] = [
      'owner_actor_id',
      'source_artifact_ref',
      'source_artifact_sha256',
      'source_document_id',
      'source_revision_id',
      'source_sbd_package_id',
      'source_sbd_content_hash',
      'action_attempt_id',
      'result_content_hash',
      'rule_set_id',
      'rule_set_version',
      'source_unit_id',
      'source_ref_id',
      'valid_from',
      'expires_at',
    ];
    requiredColumns.forEach((column: string) => {
      expect(migration).toContain(column);
    });
    expect(migration).toContain('REFERENCES action_attempt(attempt_id)');
  });

  it('has no activation state and permits confirmation only from a human', () => {
    const executableSql: string = migration.replace(/--.*$/gmu, '');
    expect(executableSql).toContain(
      "CHECK (knowledge_kind = 'TRANSLATION_MEMORY')",
    );
    expect(executableSql).toContain('CHECK (candidate_only = true)');
    expect(executableSql).toContain("CHECK (usage_policy = 'SUGGESTION_ONLY')");
    expect(executableSql).toContain(
      "CHECK (event_type IN ('HUMAN_CONFIRMED', 'INVALIDATED'))",
    );
    expect(executableSql).toContain(
      "CHECK (event_type <> 'HUMAN_CONFIRMED' OR actor_kind = 'HUMAN')",
    );
    expect(executableSql).not.toMatch(/\b(?:PROMOTED|FORMAL_KNOWLEDGE)\b/iu);
  });

  it('keeps browser access closed and contains no forbidden DCL', () => {
    const executableSql: string = migration.replace(/--.*$/gmu, '');
    expect(migration.match(/ENABLE ROW LEVEL SECURITY/gu)).toHaveLength(3);
    expect(executableSql).not.toMatch(/\bCREATE\s+POLICY\b/iu);
    expect(executableSql).not.toMatch(/\b(?:GRANT|REVOKE)\b/iu);
    expect(executableSql).not.toMatch(/DISABLE ROW LEVEL SECURITY/iu);
  });
});
