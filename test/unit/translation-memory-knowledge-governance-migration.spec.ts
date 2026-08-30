import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migrationPath: string = resolve(
  process.cwd(),
  'migrations/0015_translation_memory_knowledge_governance.sql',
);

describe('R09 Phase2 candidate-only Translation Memory migration', () => {
  let migration: string;
  let executableSql: string;

  beforeAll(async (): Promise<void> => {
    migration = await readFile(migrationPath, 'utf8');
    executableSql = migration.replace(/--.*$/gmu, '');
  });

  it('uses only the lane-reserved 0015 slot and creates four domain tables', () => {
    expect(migrationPath).toContain(
      '0015_translation_memory_knowledge_governance.sql',
    );
    expect(migration.match(/CREATE TABLE IF NOT EXISTS/gu)).toHaveLength(4);
    for (const table of [
      'translation_knowledge_candidate',
      'translation_knowledge_source_ref',
      'translation_knowledge_import_request_item',
      'translation_knowledge_governance_event',
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('binds identity and replay to tenant, WorkItem, revision, artifact and SourceUnit without a text hash', () => {
    expect(migration).toMatch(
      /UNIQUE\s*\(\s*tenant_id,\s*work_item_id,\s*snapshot_work_item_revision,\s*source_artifact_sha256,\s*source_unit_id\s*\)/u,
    );
    expect(migration).toMatch(
      /UNIQUE\s*\(tenant_id, work_item_id, request_id, source_unit_ordinal\)/u,
    );
    expect(migration).toContain('expected_unit_count integer NOT NULL');
    expect(migration).not.toMatch(
      /(?:dedupe|source_text|translated_text)_hash/iu,
    );
  });

  it('preserves WorkItem, SourceRef, rule, execution, owner and validity lineage', () => {
    const requiredColumns: string[] = [
      'work_item_id',
      'snapshot_work_item_revision',
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
      'source_unit_count',
      'source_ref_id',
      'source_ref_count',
      'valid_from',
      'expires_at',
    ];
    requiredColumns.forEach((column: string) => {
      expect(migration).toContain(column);
    });
    expect(migration).toContain(
      'REFERENCES work_item(tenant_id, work_item_id)',
    );
    expect(migration).toContain('REFERENCES action_attempt(attempt_id)');
  });

  it('records append-only human feedback and never promotes candidate authority', () => {
    expect(executableSql).toContain(
      "CHECK (knowledge_kind = 'TRANSLATION_MEMORY')",
    );
    expect(executableSql).toContain('CHECK (candidate_only = true)');
    expect(executableSql).toContain("CHECK (usage_policy = 'SUGGESTION_ONLY')");
    expect(executableSql).toContain("'ENGINEER_ADOPTED'");
    expect(executableSql).toContain("'ENGINEER_REJECTED'");
    expect(executableSql).toContain(
      "feedback_decision = 'ADOPTED_AS_CANDIDATE_SUGGESTION'",
    );
    expect(executableSql).toMatch(
      /event_type NOT IN\s*\(\s*'HUMAN_CONFIRMED',\s*'ENGINEER_ADOPTED',\s*'ENGINEER_REJECTED'\s*\)\s*OR actor_kind = 'HUMAN'/u,
    );
    expect(executableSql).not.toMatch(/\b(?:PROMOTED|FORMAL_KNOWLEDGE)\b/iu);
  });

  it('enforces current WorkItem CAS on candidate, import receipt and feedback inserts', () => {
    expect(executableSql).toContain(
      'CREATE OR REPLACE FUNCTION translation_knowledge_assert_current_work_item()',
    );
    expect(executableSql).toContain(
      'current_work_item.revision = NEW.snapshot_work_item_revision',
    );
    expect(executableSql).toContain(
      "MESSAGE = 'TRANSLATION_KNOWLEDGE_WORK_ITEM_CAS_CONFLICT'",
    );
    expect(executableSql).toContain(
      "MESSAGE = 'TRANSLATION_KNOWLEDGE_ACTION_ATTEMPT_SCOPE_CONFLICT'",
    );
    expect(executableSql).toContain(
      "current_attempt.action_type = 'OPENCLAW_TRANSLATE'",
    );
    expect(executableSql).toContain(
      'current_attempt.result_content_hash = NEW.result_content_hash',
    );
    expect(
      executableSql.match(/BEFORE INSERT ON translation_knowledge_/gu),
    ).toHaveLength(3);
    expect(executableSql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uk_translation_knowledge_feedback_request',
    );
    expect(executableSql).toMatch(
      /UNIQUE\s*\(\s*tenant_id,\s*work_item_id,\s*asset_id,\s*resulting_revision\s*\)/u,
    );
  });

  it('keeps browser access closed with service-role SELECT/INSERT policies only', () => {
    expect(migration.match(/ENABLE ROW LEVEL SECURITY/gu)).toHaveLength(4);
    expect(executableSql.match(/CREATE POLICY/gu)).toHaveLength(8);
    expect(executableSql.match(/FOR SELECT TO service_role/gu)).toHaveLength(4);
    expect(executableSql.match(/FOR INSERT TO service_role/gu)).toHaveLength(4);
    expect(executableSql).not.toMatch(/\bTO authenticated\b/iu);
    expect(executableSql).not.toMatch(/\bFOR (?:UPDATE|DELETE)\b/iu);
    expect(executableSql).not.toMatch(/\b(?:GRANT|REVOKE)\b/iu);
    expect(executableSql).not.toMatch(/DISABLE ROW LEVEL SECURITY/iu);
  });
});
