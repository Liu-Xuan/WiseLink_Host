import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Drive scan checkpoint migration contract', () => {
  it('keeps checkpoint state tenant scoped and separate from source content', () => {
    const sql = readFileSync(resolve(process.cwd(), 'migrations/0040_wiselink_drive_scan_checkpoint.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE wiselink_drive_scan_checkpoint');
    expect(sql).toContain('id uuid PRIMARY KEY DEFAULT gen_random_uuid()');
    expect(sql).toContain('UNIQUE (tenant_id, source_key)');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain("current_setting('app.tenant_id', true)");
    expect(sql).not.toContain('file_content');
    expect(sql).not.toContain('access_token');
  });
});
