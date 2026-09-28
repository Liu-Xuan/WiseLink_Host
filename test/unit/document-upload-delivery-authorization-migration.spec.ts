import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('document upload delivery authorization migration', () => {
  const migration = readFileSync(resolve(process.cwd(),
    'migrations/0067_document_upload_delivery_authorization.sql'), 'utf8');
  const repair = readFileSync(resolve(process.cwd(),
    'migrations/0068_document_delivery_service_policy_repair.sql'), 'utf8');

  it('registers only an exact committed source and freezes its selected intake', () => {
    expect(migration).toMatch(/NEW\.source_channel <> 'document_library_upload'/u);
    expect(migration).toMatch(/NEW\.status='COMMITTED_CANONICAL'[\s\S]*?v\.acquisition_id=NEW\.acquisition_id/u);
    expect(migration).toMatch(/NEW\.status='LINKED_EXACT_DOCUMENT_VERSION'[\s\S]*?v\.acquisition_id<>NEW\.acquisition_id/u);
    expect(migration).toMatch(/v\.source_artifact_id=NEW\.source_artifact_id/u);
    expect(migration).toMatch(/v\.committed_by=NEW\.acquired_by/u);
    expect(migration).toMatch(/s\.sha256=v\.pdf_sha256/u);
    expect(migration).toMatch(/s\.byte_length=v\.byte_length/u);
    expect(migration).toMatch(/p\.decision IN \('REUSE_EXACT','RESUME_EXISTING_PROCESS'\)/u);
    expect(migration).toMatch(/NEW\.acquired_by IS DISTINCT FROM current_setting\('app\.user_id',true\)/u);
    expect(migration).toMatch(/OLD\.source_descriptor_json/u);
    expect(migration).toMatch(/DOCUMENT_UPLOAD_INTAKE_IMMUTABLE/u);
    expect(migration).toMatch(/dm_acquisition_document_upload_owner_insert/u);
    expect(migration).toMatch(/dm_acquisition_document_upload_owner_update/u);
  });

  it('lets only the selected actor advance WAITING and exposes no direct writes', () => {
    expect(migration).toMatch(/current_schema\(\) IS DISTINCT FROM 'workspace_aadkpkjef3slu'/u);
    expect(migration).toMatch(/rolname='service_role_workspace_aadkpkjef3slu'[\s\S]*?NOT rolsuper AND NOT rolbypassrls/u);
    expect(migration).toMatch(/rolname='authenticated_workspace_aadkpkjef3slu'[\s\S]*?NOT rolsuper AND NOT rolbypassrls/u);
    expect(migration).toMatch(/auto_document_delivery_no_browser[\s\S]*?AS RESTRICTIVE FOR ALL TO authenticated,authenticated_workspace_aadkpkjef3slu/u);
    expect(migration).not.toContain('auto_document_delivery_no_generic_service');
    expect(repair).toMatch(/DROP POLICY IF EXISTS auto_document_delivery_no_generic_service/u);
    expect(repair).not.toMatch(/^\s*(?:GRANT|REVOKE)\b/gmu);
    expect(migration).toMatch(/has_table_privilege\('service_role_workspace_aadkpkjef3slu',[\s\S]*?'SELECT'\)/u);
    expect(migration).toMatch(/has_table_privilege\('service_role_workspace_aadkpkjef3slu',[\s\S]*?'UPDATE'\)/u);
    expect(migration).toMatch(/FOR SELECT TO service_role_workspace_aadkpkjef3slu USING \(true\)/u);
    expect(migration).toMatch(/FOR UPDATE TO service_role_workspace_aadkpkjef3slu/u);
    expect(migration).toMatch(/status='WAITING' AND actor_user_id=current_setting\('app\.user_id',true\)/u);
    expect(migration).toMatch(/status='ADMITTED' AND actor_user_id=current_setting\('app\.user_id',true\)/u);
    expect(migration).not.toMatch(/FOR ALL TO service_role_workspace_aadkpkjef3slu USING \(true\)/u);
    expect(migration).not.toMatch(/FOR (?:INSERT|DELETE) TO service_role_workspace_aadkpkjef3slu/u);
    expect(migration).toMatch(/SECURITY DEFINER SET search_path = pg_catalog/u);
    expect(migration).toMatch(/auto_document_delivery_no_truncate[\s\S]*?BEFORE TRUNCATE ON auto_document_delivery_authorization/u);
    for (const column of ['_created_at', '_created_by', '_updated_at', '_updated_by']) {
      expect(migration).toContain(column);
    }
    expect(migration).toMatch(/NEW\._updated_at := CURRENT_TIMESTAMP/u);
    expect(migration).toMatch(/NEW\._updated_by := CASE WHEN current_setting\('app\.user_id',true\)/u);
  });

  it('blocks native writes and TRUNCATE on the WorkItem delivery intent source', () => {
    expect(migration).not.toMatch(/^\s*(?:GRANT|REVOKE)\b/gmu);
    for (const table of ['action_attempt', 'dm_acquisition', 'dm_ingress_preflight']) {
      expect(migration).toMatch(new RegExp(`BEFORE TRUNCATE ON ${table}`, 'u'));
    }
    expect(migration).toMatch(/DOCUMENT_DELIVERY_BROWSER_TRUNCATE_DENIED/u);
    expect(migration).toMatch(/action_attempt_delivery_no_native_insert[\s\S]*?FOR INSERT TO authenticated,authenticated_workspace_aadkpkjef3slu\s+WITH CHECK \(action_type <> 'DOCUMENT_DELIVERY_INTENT'\)/u);
    expect(migration).toMatch(/action_attempt_delivery_no_native_update[\s\S]*?FOR UPDATE TO authenticated,authenticated_workspace_aadkpkjef3slu\s+USING \(action_type <> 'DOCUMENT_DELIVERY_INTENT'\)[\s\S]*?WITH CHECK \(action_type <> 'DOCUMENT_DELIVERY_INTENT'\)/u);
    expect(migration).toMatch(/action_attempt_delivery_no_native_delete[\s\S]*?FOR DELETE TO authenticated,authenticated_workspace_aadkpkjef3slu\s+USING \(action_type <> 'DOCUMENT_DELIVERY_INTENT'\)/u);
  });
});
