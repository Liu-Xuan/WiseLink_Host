import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('0013 canonical RuleSet lifecycle migration', () => {
  const sql: string = readFileSync(
    resolve(process.cwd(), 'migrations/0013_canonical_rule_set_lifecycle.sql'),
    'utf8',
  );

  it('uses immutable snapshots and one append-only activation ledger', () => {
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS canonical_rule_set_snapshot',
    );
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS canonical_rule_set_activation',
    );
    expect(sql).toContain(
      'UNIQUE (tenant_id, rule_set_key, activation_revision)',
    );
    expect(sql).toContain('activation_revision = expected_revision + 1');
    expect(sql).toContain("CHECK (action IN ('PROMOTE', 'ROLLBACK'))");
    expect(sql).toContain('canonical_rule_set_snapshot_immutable');
    expect(sql).toContain('canonical_rule_set_activation_append_only');
    expect(sql).toContain('BEFORE UPDATE OR DELETE');
    expect(sql).toContain('BEFORE TRUNCATE');
    expect(sql).not.toMatch(/CREATE TABLE[^;]+rule_engine/isu);
  });

  it('keeps direct authenticated writes closed and records Host owner audit', () => {
    expect(sql).toContain('engineering_owner_user_id varchar(255) NOT NULL');
    expect(sql).toContain('required_role_id varchar(96) NOT NULL');
    expect(sql).toContain('TO service_role');
    expect(sql).not.toMatch(/FOR ALL/u);
    expect(sql).not.toMatch(
      /TO authenticated[\s\S]{0,100}FOR (INSERT|UPDATE|ALL)/u,
    );
  });
});
