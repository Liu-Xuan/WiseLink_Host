import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('document upload delivery authorization migration', () => {
  const migration = readFileSync(resolve(process.cwd(),
    'migrations/0067_document_upload_delivery_authorization.sql'), 'utf8');

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
    expect(migration).toMatch(/GRANT UPDATE\(status,admitted_at\) ON auto_document_delivery_authorization\s+TO service_role_workspace_aadkpkjef3slu/u);
    expect(migration).toMatch(/FOR SELECT TO service_role_workspace_aadkpkjef3slu USING \(true\)/u);
    expect(migration).toMatch(/FOR UPDATE TO service_role_workspace_aadkpkjef3slu/u);
    expect(migration).toMatch(/status='WAITING' AND actor_user_id=current_setting\('app\.user_id',true\)/u);
    expect(migration).toMatch(/status='ADMITTED' AND actor_user_id=current_setting\('app\.user_id',true\)/u);
    expect(migration).not.toMatch(/FOR ALL TO service_role_workspace_aadkpkjef3slu USING \(true\)/u);
    expect(migration).not.toMatch(/FOR (?:INSERT|DELETE) TO service_role_workspace_aadkpkjef3slu/u);
    expect(migration).toMatch(/SECURITY DEFINER SET search_path = pg_catalog/u);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION auto_document_delivery_register_upload\(\) FROM PUBLIC/u);
  });

  it('blocks native writes and TRUNCATE on the WorkItem delivery intent source', () => {
    expect(migration).toMatch(/REVOKE TRUNCATE ON action_attempt FROM authenticated_workspace_aadkpkjef3slu/u);
    expect(migration).toMatch(/REVOKE TRUNCATE ON dm_acquisition,dm_ingress_preflight\s+FROM authenticated_workspace_aadkpkjef3slu/u);
    expect(migration).toMatch(/action_attempt_delivery_no_native_insert[\s\S]*?FOR INSERT TO authenticated,authenticated_workspace_aadkpkjef3slu\s+WITH CHECK \(action_type <> 'DOCUMENT_DELIVERY_INTENT'\)/u);
    expect(migration).toMatch(/action_attempt_delivery_no_native_update[\s\S]*?FOR UPDATE TO authenticated,authenticated_workspace_aadkpkjef3slu\s+USING \(action_type <> 'DOCUMENT_DELIVERY_INTENT'\)[\s\S]*?WITH CHECK \(action_type <> 'DOCUMENT_DELIVERY_INTENT'\)/u);
    expect(migration).toMatch(/action_attempt_delivery_no_native_delete[\s\S]*?FOR DELETE TO authenticated,authenticated_workspace_aadkpkjef3slu\s+USING \(action_type <> 'DOCUMENT_DELIVERY_INTENT'\)/u);
  });
});
