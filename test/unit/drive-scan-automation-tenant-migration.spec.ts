import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Drive scan automation tenant policy migration', () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      'migrations/0059_drive_scan_automation_tenant_scope.sql',
    ),
    'utf8',
  );

  it('binds service-role reads and writes to the transaction tenant', () => {
    expect(source).toContain('FOR ALL TO service_role');
    expect(source).toContain(
      "USING (tenant_id = current_setting('app.tenant_id', true))",
    );
    expect(source).toContain(
      "WITH CHECK (tenant_id = current_setting('app.tenant_id', true))",
    );
    expect(source).not.toContain('USING (true)');
  });
});
