import { readFile } from 'node:fs/promises';

describe('engineering search projection migration contract', () => {
  it('uses a rebuildable weighted simple-text projection with tenant RLS', async () => {
    const sql = await readFile('migrations/0039_engineering_search_projection.sql', 'utf8');
    expect(sql).toContain('GENERATED ALWAYS AS');
    expect(sql).toContain("to_tsvector('simple'");
    expect(sql).toContain('USING GIN (search_vector)');
    expect(sql).toContain('ALTER TABLE engineering_search_projection ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('current_setting(\'app.tenant_id\', true)');
  });
});
