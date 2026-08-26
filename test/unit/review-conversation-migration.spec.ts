import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  '../../migrations/0009_review_conversation_persistence_c1.sql',
);

describe('R09 C1 review persistence migration', () => {
  let migration: string;

  beforeAll(async () => {
    migration = await readFile(migrationPath, 'utf8');
  });

  it('creates the three Host persistence objects and exact C1 input states', () => {
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS review_conversation/iu,
    );
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS review_turn/iu);
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS engineer_supplied_input/iu,
    );
    expect(migration).toMatch(/input_type = 'ENGINEER_TEXT'/u);
    expect(migration).toMatch(/adoption_status = 'CANDIDATE_UNADOPTED'/u);
  });

  it('enforces one live conversation and both turn idempotency identities', () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uk_review_conversation_live[\s\S]*?tenant_id, actor_id, work_item_id[\s\S]*?WHERE status = 'ACTIVE'/iu,
    );
    expect(migration).toMatch(
      /uk_review_turn_request[\s\S]*?review_conversation_id, request_id/iu,
    );
    expect(migration).toMatch(
      /uk_review_turn_number[\s\S]*?review_conversation_id, turn_no/iu,
    );
  });

  it('atomically allocates an active turn and persists its unadopted input', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION review_turn_c1_allocate\(\)[\s\S]*?status = 'ACTIVE'[\s\S]*?REVIEW_CONVERSATION_CLOSED_OR_MISMATCH/iu,
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION review_turn_c1_persist_engineer_input\(\)[\s\S]*?INSERT INTO engineer_supplied_input/iu,
    );
    expect(migration).toMatch(/DEFERRABLE INITIALLY DEFERRED/iu);
  });

  it('has no broad service-role bypass and keeps turn/input append-only', () => {
    const executableSql: string = migration.replace(/--.*$/gmu, '');
    expect(executableSql).not.toMatch(
      /CREATE POLICY\s+\S*service_role[\s\S]*?USING\s*\(\s*true\s*\)/iu,
    );
    expect(executableSql).not.toMatch(
      /ON review_turn\s+FOR\s+(?:ALL|UPDATE|DELETE)/iu,
    );
    expect(executableSql).not.toMatch(
      /ON engineer_supplied_input\s+FOR\s+(?:ALL|UPDATE|DELETE)/iu,
    );
    expect(executableSql).toMatch(
      /ON review_turn FOR SELECT TO authenticated/iu,
    );
    expect(executableSql).toMatch(
      /ON review_turn FOR INSERT TO authenticated/iu,
    );
    expect(executableSql).toMatch(
      /ON engineer_supplied_input FOR SELECT TO authenticated/iu,
    );
    expect(executableSql).toMatch(
      /ON engineer_supplied_input FOR INSERT TO authenticated/iu,
    );
  });

  it('binds every authenticated policy to app.user_id and owned WorkItem facts', () => {
    expect(migration).toMatch(/current_setting\('app\.user_id', true\)/u);
    expect(migration).toMatch(
      /owned_work_item\.tenant_id = review_conversation\.tenant_id/iu,
    );
    expect(migration).toMatch(
      /owned_work_item\.requested_by_user_id = review_conversation\.actor_id/iu,
    );
    expect(migration).toMatch(
      /current_mapping\.miaoda_user_id =[\s\S]*?current_setting\('app\.user_id', true\)/iu,
    );
    expect(migration).toMatch(
      /current_mapping\.miaoda_tenant_id =[\s\S]*?review_conversation\.tenant_id/iu,
    );
    expect(migration).toContain(
      "current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'",
    );
    expect(migration).toMatch(/current_mapping\.status = 'ACTIVE'/iu);
    expect(migration).toMatch(
      /bound_conversation\.review_conversation_id =[\s\S]*?review_turn\.review_conversation_id/iu,
    );
    expect(migration).toMatch(
      /bound_conversation\.review_conversation_id =[\s\S]*?engineer_supplied_input\.review_conversation_id/iu,
    );
  });
});
