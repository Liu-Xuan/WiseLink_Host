-- Prepared DDL only. Run scripts/prepare-native-tenant-read-ddl.mjs against
-- a fresh official pg_policies snapshot after 0077. Do not execute this source.
-- The app admission is Tenant + require_login for the single tenant 63849986.
BEGIN;
-- @native-tenant-read:acl-check

CREATE OR REPLACE FUNCTION native_app_shared_read_allowed(target_tenant varchar)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT current_setting('role', true) =
      'authenticated_workspace_aadkpkjef3slu'
    AND nullif(current_setting('app.user_id', true), '') IS NOT NULL
    AND current_setting('app.user_id', true) <> '-1'
    AND target_tenant = '63849986'
$$;

CREATE OR REPLACE FUNCTION native_app_work_item_readable(
  target_tenant varchar, target_work_item varchar)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT native_app_shared_read_allowed(target_tenant)
    AND EXISTS (SELECT 1 FROM work_item w
      WHERE w.tenant_id=target_tenant AND w.work_item_id=target_work_item)
$$;

CREATE OR REPLACE FUNCTION native_app_document_readable(
  target_tenant varchar, target_document_version varchar)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, workspace_aadkpkjef3slu, pg_temp AS $$
  SELECT native_app_shared_read_allowed(target_tenant)
    AND EXISTS (
      SELECT 1 FROM dm_document_version v
      JOIN dm_publication_family f ON f.family_id=v.family_id
      JOIN dm_acquisition a ON a.acquisition_id=v.acquisition_id
        AND a.document_version_id=v.document_version_id
        AND a.source_artifact_id=v.source_artifact_id
      JOIN dm_source_artifact s ON s.source_artifact_id=v.source_artifact_id
      WHERE v.document_version_id=target_document_version
        AND s.readback_verified
        AND s.sha256=v.pdf_sha256 AND s.byte_length=v.byte_length
        AND a.status IN ('COMMITTED_CANONICAL','LINKED_EXACT_DOCUMENT_VERSION')
        AND ((starts_with(f.canonical_identity_key,
          'tenant:' || engineering_matter_uri_component(target_tenant) || ':family:')
          AND starts_with(a.idempotency_key,
            'tenant:' || engineering_matter_uri_component(target_tenant) || ':request:'))
          OR EXISTS (SELECT 1 FROM work_item w
            WHERE w.tenant_id=target_tenant
              AND (NOT starts_with(f.canonical_identity_key,'tenant:')
                OR starts_with(f.canonical_identity_key,
                  'tenant:' || engineering_matter_uri_component(target_tenant) || ':family:'))
              AND (NOT starts_with(a.idempotency_key,'tenant:')
                OR starts_with(a.idempotency_key,
                  'tenant:' || engineering_matter_uri_component(target_tenant) || ':request:'))
              AND w.document_version_id=v.document_version_id
              AND w.document_id=v.document_id
              AND w.source_artifact_id=v.source_artifact_id
              AND w.source_file_sha256=v.pdf_sha256
              AND w.source_byte_length=v.byte_length)))
$$;

-- A fact-only read for tenantless catalog rows. The definer owns the catalog
-- and bypasses its RLS, so family/version policies cannot recursively filter
-- the provenance query. Admission still checks the original SQL ROLE GUC.
CREATE OR REPLACE FUNCTION native_app_dm_related_readable(
  target_tenant varchar, entity_kind varchar, entity_id varchar)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, workspace_aadkpkjef3slu, pg_temp AS $$
  SELECT native_app_shared_read_allowed(target_tenant) AND CASE entity_kind
    WHEN 'FAMILY' THEN EXISTS (SELECT 1 FROM dm_publication_family f
      WHERE f.family_id=entity_id AND (
        starts_with(f.canonical_identity_key,
          'tenant:' || engineering_matter_uri_component(target_tenant) || ':family:')
        OR EXISTS (SELECT 1 FROM dm_document_version v
          WHERE v.family_id=f.family_id
            AND native_app_document_readable(target_tenant,v.document_version_id))))
    WHEN 'DOCUMENT' THEN EXISTS (SELECT 1 FROM dm_document d
      WHERE d.document_id=entity_id AND EXISTS (
        SELECT 1 FROM dm_publication_family f
        WHERE f.family_id=d.family_id AND (
          starts_with(f.canonical_identity_key,
            'tenant:' || engineering_matter_uri_component(target_tenant) || ':family:')
          OR EXISTS (SELECT 1 FROM dm_document_version v
            WHERE v.family_id=d.family_id AND v.document_id=d.document_id
              AND native_app_document_readable(target_tenant,v.document_version_id)))))
    WHEN 'ACQUISITION' THEN EXISTS (SELECT 1 FROM dm_acquisition a
      WHERE a.acquisition_id=entity_id AND (
        starts_with(a.idempotency_key,
          'tenant:' || engineering_matter_uri_component(target_tenant) || ':request:')
        OR EXISTS (SELECT 1 FROM dm_document_version v
          WHERE v.acquisition_id=a.acquisition_id
            AND v.source_artifact_id=a.source_artifact_id
            AND a.document_version_id=v.document_version_id
            AND native_app_document_readable(target_tenant,v.document_version_id))))
    WHEN 'ARTIFACT' THEN EXISTS (SELECT 1 FROM dm_source_artifact s
      WHERE s.source_artifact_id=entity_id AND EXISTS (
        SELECT 1 FROM dm_acquisition a
        WHERE a.source_artifact_id=s.source_artifact_id
          AND (starts_with(a.idempotency_key,
            'tenant:' || engineering_matter_uri_component(target_tenant) || ':request:')
            OR EXISTS (SELECT 1 FROM dm_document_version v
              WHERE v.acquisition_id=a.acquisition_id
                AND v.source_artifact_id=s.source_artifact_id
                AND a.document_version_id=v.document_version_id
                AND native_app_document_readable(target_tenant,v.document_version_id)))))
    ELSE false END
$$;

CREATE OR REPLACE FUNCTION native_app_matter_revision_readable(
  target_tenant varchar, target_matter_revision varchar)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT native_app_shared_read_allowed(target_tenant)
    AND EXISTS (SELECT 1 FROM engineering_matter_revision r
      JOIN engineering_matter m ON m.tenant_id=r.tenant_id
        AND m.matter_id=r.matter_id
      WHERE r.tenant_id=target_tenant
        AND r.matter_revision_id=target_matter_revision)
    AND (EXISTS (SELECT 1 FROM engineering_matter_revision_work_item l
      WHERE l.tenant_id=target_tenant
        AND l.matter_revision_id=target_matter_revision)
      OR EXISTS (SELECT 1 FROM engineering_matter_material_link l
        WHERE l.tenant_id=target_tenant
          AND l.matter_revision_id=target_matter_revision))
    AND NOT EXISTS (SELECT 1 FROM engineering_matter_revision_work_item l
      WHERE l.tenant_id=target_tenant
        AND l.matter_revision_id=target_matter_revision
        AND native_app_work_item_readable(target_tenant,l.work_item_id) IS NOT TRUE)
    AND NOT EXISTS (SELECT 1 FROM engineering_matter_material_link l
      WHERE l.tenant_id=target_tenant
        AND l.matter_revision_id=target_matter_revision
        AND (
          (l.document_version_id IS NOT NULL AND (
            native_app_document_readable(target_tenant,l.document_version_id)
              IS NOT TRUE OR NOT EXISTS (SELECT 1 FROM dm_document_version v
                WHERE v.document_version_id=l.document_version_id
                  AND v.family_id=l.family_id)))
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(
              coalesce(l.material_json::jsonb -> 'basis','[]'::jsonb)) basis
            WHERE native_app_document_readable(
              target_tenant,(basis->>'documentVersionId')::varchar) IS NOT TRUE)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(
              l.material_json::jsonb #> '{expected,fulfilledBy}',
              '[]'::jsonb)) fulfilled
            WHERE native_app_document_readable(
              target_tenant,(fulfilled->>'documentVersionId')::varchar) IS NOT TRUE)
        ))
$$;

CREATE OR REPLACE FUNCTION wiselink_native_reviewer(target_tenant text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT native_app_shared_read_allowed(target_tenant::varchar)
$$;
-- @native-tenant-read:function-acl-check

-- @native-tenant-read:prepared-policies:start
DO $native_read_prepare$ BEGIN
  RAISE EXCEPTION 'NATIVE_TENANT_READ_PREPARATION_REQUIRED' USING ERRCODE='42501';
END $native_read_prepare$;
-- @native-tenant-read:prepared-policies:end
COMMIT;
