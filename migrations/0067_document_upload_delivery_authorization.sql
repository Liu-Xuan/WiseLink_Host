-- CONTROLLED ROLLOUT CANDIDATE: user-authorized 2026-09-28 for staged
-- dev-to-online migration, subject to pre-application checks. This source
-- commit does not apply the migration. The exact-link guard accepts the
-- immutable version's original acquisition while checking this acquisition's source
-- bytes and READY preflight. The local server candidate has narrow verified
-- service transactions. Hosted execution evidence is recorded in
-- 0067_document_upload_delivery_authorization.review.md.
BEGIN;

-- This draft is bound to the verified 17b application schema and its two
-- concrete SQL identities. Fail before any grant or DDL if run elsewhere.
DO $$
BEGIN
  IF current_schema() IS DISTINCT FROM 'workspace_aadkpkjef3slu'
      OR to_regclass('workspace_aadkpkjef3slu.dm_acquisition') IS NULL
      OR to_regclass('workspace_aadkpkjef3slu.dm_ingress_preflight') IS NULL
      OR NOT EXISTS (SELECT 1 FROM pg_roles
        WHERE rolname='service_role_workspace_aadkpkjef3slu'
          AND NOT rolsuper AND NOT rolbypassrls)
      OR NOT EXISTS (SELECT 1 FROM pg_roles
        WHERE rolname='authenticated_workspace_aadkpkjef3slu'
          AND NOT rolsuper AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'DOCUMENT_DELIVERY_APP_SCHEMA_OR_ROLE_MISMATCH'
      USING ERRCODE='42501';
  END IF;
END;
$$;

-- The WorkItem selection is stored in action_attempt. Existing platform-wide
-- authenticated grants/policies otherwise let a browser forge or change it.
-- TRUNCATE bypasses RLS, so remove that table privilege as well. Review old
-- callers of authenticated TRUNCATE before applying this migration.
REVOKE TRUNCATE ON action_attempt FROM authenticated;
REVOKE TRUNCATE ON dm_acquisition,dm_ingress_preflight FROM authenticated;
REVOKE TRUNCATE ON action_attempt FROM authenticated_workspace_aadkpkjef3slu;
REVOKE TRUNCATE ON dm_acquisition,dm_ingress_preflight
  FROM authenticated_workspace_aadkpkjef3slu;
DO $$
BEGIN
  IF has_table_privilege('authenticated_workspace_aadkpkjef3slu',
       'workspace_aadkpkjef3slu.action_attempt','TRUNCATE')
      OR has_table_privilege('authenticated_workspace_aadkpkjef3slu',
       'workspace_aadkpkjef3slu.dm_acquisition','TRUNCATE')
      OR has_table_privilege('authenticated_workspace_aadkpkjef3slu',
       'workspace_aadkpkjef3slu.dm_ingress_preflight','TRUNCATE') THEN
    RAISE EXCEPTION 'DOCUMENT_DELIVERY_BROWSER_TRUNCATE_REMAINS'
      USING ERRCODE='42501';
  END IF;
END;
$$;
CREATE POLICY action_attempt_delivery_no_native_insert ON action_attempt AS RESTRICTIVE
FOR INSERT TO authenticated,authenticated_workspace_aadkpkjef3slu
WITH CHECK (action_type <> 'DOCUMENT_DELIVERY_INTENT');
CREATE POLICY action_attempt_delivery_no_native_update ON action_attempt AS RESTRICTIVE
FOR UPDATE TO authenticated,authenticated_workspace_aadkpkjef3slu
USING (action_type <> 'DOCUMENT_DELIVERY_INTENT')
WITH CHECK (action_type <> 'DOCUMENT_DELIVERY_INTENT');
CREATE POLICY action_attempt_delivery_no_native_delete ON action_attempt AS RESTRICTIVE
FOR DELETE TO authenticated,authenticated_workspace_aadkpkjef3slu
USING (action_type <> 'DOCUMENT_DELIVERY_INTENT');

-- A selected library upload becomes a recoverable Host task only when its
-- acquisition is linked to the exact immutable DocumentVersion. No backfill.
CREATE TABLE auto_document_delivery_authorization (
  acquisition_id varchar(96) PRIMARY KEY REFERENCES dm_acquisition(acquisition_id),
  tenant_key varchar(255) NOT NULL,
  actor_user_id varchar(255) NOT NULL,
  document_version_id varchar(96) NOT NULL REFERENCES dm_document_version(document_version_id),
  source_artifact_id varchar(96) NOT NULL REFERENCES dm_source_artifact(source_artifact_id),
  reading boolean NOT NULL,
  translation varchar(16) NOT NULL CHECK (translation IN ('NONE','ZH_FULL')),
  status varchar(16) NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','ADMITTED')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  admitted_at timestamptz,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT CASE WHEN current_setting('app.user_id',true) = '' THEN NULL
    ELSE concat('(',current_setting('app.user_id',true),')')::user_profile END,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT CASE WHEN current_setting('app.user_id',true) = '' THEN NULL
    ELSE concat('(',current_setting('app.user_id',true),')')::user_profile END,
  CHECK (reading OR translation='ZH_FULL'),
  CHECK ((status='ADMITTED') = (admitted_at IS NOT NULL))
);
CREATE INDEX idx_auto_document_delivery_due
  ON auto_document_delivery_authorization(tenant_key,status,created_at);

CREATE FUNCTION auto_document_delivery_register_upload() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  selection jsonb;
  family_key text;
  encoded_tenant text;
BEGIN
  IF NEW.source_channel <> 'document_library_upload'
      OR NEW.status NOT IN ('COMMITTED_CANONICAL','LINKED_EXACT_DOCUMENT_VERSION')
      OR NEW.document_version_id IS NULL THEN
    RETURN NEW;
  END IF;
  selection := NEW.source_descriptor_json::jsonb->'documentDeliveryIntent';
  IF selection IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(selection) <> 'object'
      OR selection - 'reading' - 'translation' <> '{}'::jsonb
      OR selection->'reading' NOT IN ('true'::jsonb,'false'::jsonb)
      OR selection->>'translation' NOT IN ('NONE','ZH_FULL') THEN
    RAISE EXCEPTION 'DOCUMENT_DELIVERY_SELECTION_INVALID' USING ERRCODE='23514';
  END IF;
  IF selection->'reading' = 'false'::jsonb AND selection->>'translation'='NONE' THEN
    RETURN NEW;
  END IF;
  SELECT f.canonical_identity_key INTO family_key
    FROM workspace_aadkpkjef3slu.dm_document_version v
      JOIN workspace_aadkpkjef3slu.dm_publication_family f ON f.family_id=v.family_id
      JOIN workspace_aadkpkjef3slu.dm_source_artifact s ON s.source_artifact_id=NEW.source_artifact_id
    WHERE v.document_version_id=NEW.document_version_id
      AND v.source_artifact_id=NEW.source_artifact_id
      AND v.lifecycle_status='COMMITTED_IMMUTABLE'
      AND s.readback_verified=TRUE AND s.sha256=v.pdf_sha256
      AND s.byte_length=v.byte_length
      AND (
        (NEW.status='COMMITTED_CANONICAL'
          AND v.acquisition_id=NEW.acquisition_id
          AND v.committed_by=NEW.acquired_by)
        OR (NEW.status='LINKED_EXACT_DOCUMENT_VERSION'
          AND v.acquisition_id<>NEW.acquisition_id
          AND EXISTS (SELECT 1 FROM workspace_aadkpkjef3slu.dm_ingress_preflight p
            WHERE p.acquisition_id=NEW.acquisition_id
              AND p.status='READY' AND p.execution_authorized=FALSE
              AND p.decision IN ('REUSE_EXACT','RESUME_EXISTING_PROCESS')
              AND p.document_version_id IS NULL
              AND p.commit_idempotency_key IS NULL
              AND p.normalized_descriptor_json::jsonb->>'sha256'=v.pdf_sha256
              AND (p.normalized_descriptor_json::jsonb->>'sizeBytes')::bigint=v.byte_length))
      );
  encoded_tenant := split_part(family_key, ':', 2);
  IF family_key IS NULL OR NEW.acquired_by IS DISTINCT FROM current_setting('app.user_id',true)
      OR encoded_tenant='' OR
      NOT starts_with(family_key, 'tenant:'||encoded_tenant||':family:') OR
      NOT starts_with(NEW.idempotency_key, 'tenant:'||encoded_tenant||':request:') THEN
    RAISE EXCEPTION 'DOCUMENT_DELIVERY_SOURCE_MISMATCH' USING ERRCODE='23503';
  END IF;
  INSERT INTO workspace_aadkpkjef3slu.auto_document_delivery_authorization
    (acquisition_id,tenant_key,actor_user_id,document_version_id,
     source_artifact_id,reading,translation)
  VALUES (NEW.acquisition_id,encoded_tenant,NEW.acquired_by,NEW.document_version_id,
          NEW.source_artifact_id,(selection->>'reading')::boolean,selection->>'translation')
  ON CONFLICT (acquisition_id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM workspace_aadkpkjef3slu.auto_document_delivery_authorization d
      WHERE d.acquisition_id=NEW.acquisition_id AND d.tenant_key=encoded_tenant
        AND d.actor_user_id=NEW.acquired_by AND d.document_version_id=NEW.document_version_id
        AND d.source_artifact_id=NEW.source_artifact_id
        AND d.reading=(selection->>'reading')::boolean
        AND d.translation=selection->>'translation') THEN
    RAISE EXCEPTION 'DOCUMENT_DELIVERY_IDEMPOTENCY_CONFLICT' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION auto_document_delivery_register_upload() FROM PUBLIC;
CREATE TRIGGER auto_document_delivery_register_upload
AFTER INSERT OR UPDATE OF status,document_version_id ON dm_acquisition
FOR EACH ROW EXECUTE FUNCTION auto_document_delivery_register_upload();

CREATE FUNCTION auto_document_delivery_freeze_upload() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.source_channel='document_library_upload' AND
    ROW(OLD.acquisition_id,OLD.source_artifact_id,OLD.source_channel,OLD.source_ref,
      OLD.selection_bucket_id,OLD.selection_file_path,OLD.provider_object_id,
      OLD.provider_version_id,OLD.acquired_by,OLD.acquired_at,OLD.idempotency_key,
      OLD.source_descriptor_json)
    IS DISTINCT FROM
    ROW(NEW.acquisition_id,NEW.source_artifact_id,NEW.source_channel,NEW.source_ref,
      NEW.selection_bucket_id,NEW.selection_file_path,NEW.provider_object_id,
      NEW.provider_version_id,NEW.acquired_by,NEW.acquired_at,NEW.idempotency_key,
      NEW.source_descriptor_json) THEN
    RAISE EXCEPTION 'DOCUMENT_UPLOAD_INTAKE_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER auto_document_delivery_freeze_upload
BEFORE UPDATE ON dm_acquisition
FOR EACH ROW EXECUTE FUNCTION auto_document_delivery_freeze_upload();
CREATE POLICY dm_acquisition_document_upload_owner_insert ON dm_acquisition
AS RESTRICTIVE FOR INSERT TO authenticated,authenticated_workspace_aadkpkjef3slu
WITH CHECK (
  source_channel<>'document_library_upload' OR
  (acquired_by=current_setting('app.user_id',true)
    AND status='ACQUIRED_READBACK_VERIFIED' AND document_version_id IS NULL));
CREATE POLICY dm_acquisition_document_upload_owner_update ON dm_acquisition
AS RESTRICTIVE FOR UPDATE TO authenticated,authenticated_workspace_aadkpkjef3slu
USING (source_channel<>'document_library_upload' OR
  (acquired_by=current_setting('app.user_id',true)
    AND status='ACQUIRED_READBACK_VERIFIED' AND document_version_id IS NULL))
WITH CHECK (source_channel<>'document_library_upload' OR
  (acquired_by=current_setting('app.user_id',true)
    AND status='ACQUIRED_READBACK_VERIFIED' AND document_version_id IS NULL));
CREATE POLICY dm_acquisition_document_upload_no_delete ON dm_acquisition
AS RESTRICTIVE FOR DELETE TO authenticated,authenticated_workspace_aadkpkjef3slu
USING (source_channel<>'document_library_upload');

-- An actor may create a READY observation through the upload entry, but it
-- cannot turn that observation into an execution decision or rewrite it. The
-- final transition is made by the narrow verified Host service transaction.
CREATE POLICY dm_ingress_preflight_document_upload_owner_insert ON dm_ingress_preflight
AS RESTRICTIVE FOR INSERT TO authenticated,authenticated_workspace_aadkpkjef3slu
WITH CHECK (EXISTS (
  SELECT 1 FROM dm_acquisition a WHERE a.acquisition_id=dm_ingress_preflight.acquisition_id
    AND (a.source_channel<>'document_library_upload' OR
      (a.acquired_by=current_setting('app.user_id',true)
        AND dm_ingress_preflight.status='READY'
        AND dm_ingress_preflight.execution_authorized=FALSE
        AND dm_ingress_preflight.document_version_id IS NULL
        AND dm_ingress_preflight.commit_idempotency_key IS NULL
        AND dm_ingress_preflight.committed_at IS NULL))));
CREATE FUNCTION auto_document_delivery_freeze_upload_preflight() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF current_user IN ('authenticated','authenticated_workspace_aadkpkjef3slu') AND EXISTS (
    SELECT 1 FROM workspace_aadkpkjef3slu.dm_acquisition a
    WHERE a.acquisition_id=OLD.acquisition_id
      AND a.source_channel='document_library_upload') AND
    ROW(OLD.preflight_id,OLD.acquisition_id,OLD.decision,OLD.branch,
      OLD.execution_authorized,OLD.observed_current_generation,
      OLD.observed_current_document_version_id,OLD.normalized_descriptor_json,
      OLD.decision_payload_json,OLD.status,OLD.document_version_id,
      OLD.commit_idempotency_key,OLD.committed_at) IS DISTINCT FROM
    ROW(NEW.preflight_id,NEW.acquisition_id,NEW.decision,NEW.branch,
      NEW.execution_authorized,NEW.observed_current_generation,
      NEW.observed_current_document_version_id,NEW.normalized_descriptor_json,
      NEW.decision_payload_json,NEW.status,NEW.document_version_id,
      NEW.commit_idempotency_key,NEW.committed_at) THEN
    RAISE EXCEPTION 'DOCUMENT_UPLOAD_PREFLIGHT_HOST_COMMIT_REQUIRED'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER auto_document_delivery_freeze_upload_preflight
BEFORE UPDATE ON dm_ingress_preflight
FOR EACH ROW EXECUTE FUNCTION auto_document_delivery_freeze_upload_preflight();
CREATE POLICY dm_ingress_preflight_document_upload_no_delete ON dm_ingress_preflight
AS RESTRICTIVE FOR DELETE TO authenticated,authenticated_workspace_aadkpkjef3slu
USING (NOT EXISTS (
  SELECT 1 FROM dm_acquisition a WHERE a.acquisition_id=dm_ingress_preflight.acquisition_id
    AND a.source_channel='document_library_upload'));

CREATE FUNCTION auto_document_delivery_preserve() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.acquisition_id,OLD.tenant_key,OLD.actor_user_id,OLD.document_version_id,
      OLD.source_artifact_id,OLD.reading,OLD.translation,OLD.created_at,
      OLD._created_at,OLD._created_by)
    IS DISTINCT FROM ROW(NEW.acquisition_id,NEW.tenant_key,NEW.actor_user_id,
      NEW.document_version_id,NEW.source_artifact_id,NEW.reading,NEW.translation,NEW.created_at,
      NEW._created_at,NEW._created_by)
    OR (OLD.status='ADMITTED' AND
        (NEW.status<>'ADMITTED' OR NEW.admitted_at IS DISTINCT FROM OLD.admitted_at))
    OR (OLD.status='WAITING' AND NEW.status<>'ADMITTED') THEN
    RAISE EXCEPTION 'DOCUMENT_DELIVERY_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  NEW._updated_at := CURRENT_TIMESTAMP;
  NEW._updated_by := CASE WHEN current_setting('app.user_id',true) = '' THEN NULL
    ELSE concat('(',current_setting('app.user_id',true),')')::user_profile END;
  RETURN NEW;
END;
$$;
CREATE TRIGGER auto_document_delivery_preserve
BEFORE UPDATE ON auto_document_delivery_authorization
FOR EACH ROW EXECUTE FUNCTION auto_document_delivery_preserve();

ALTER TABLE auto_document_delivery_authorization ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON auto_document_delivery_authorization FROM PUBLIC;
REVOKE ALL ON auto_document_delivery_authorization FROM authenticated;
REVOKE ALL ON auto_document_delivery_authorization
  FROM authenticated_workspace_aadkpkjef3slu,service_role,
    service_role_workspace_aadkpkjef3slu;
GRANT SELECT ON auto_document_delivery_authorization
  TO service_role_workspace_aadkpkjef3slu;
GRANT UPDATE(status,admitted_at) ON auto_document_delivery_authorization
  TO service_role_workspace_aadkpkjef3slu;
CREATE POLICY auto_document_delivery_service_read ON auto_document_delivery_authorization
FOR SELECT TO service_role_workspace_aadkpkjef3slu USING (true);
CREATE POLICY auto_document_delivery_service_admit ON auto_document_delivery_authorization
FOR UPDATE TO service_role_workspace_aadkpkjef3slu
USING (status='WAITING' AND actor_user_id=current_setting('app.user_id',true))
WITH CHECK (status='ADMITTED' AND actor_user_id=current_setting('app.user_id',true));

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['authenticated',
      'authenticated_workspace_aadkpkjef3slu'] LOOP
    IF has_table_privilege(role_name,
        'workspace_aadkpkjef3slu.auto_document_delivery_authorization',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
      RAISE EXCEPTION 'DOCUMENT_DELIVERY_BROWSER_AUTHORIZATION_PRIVILEGE_REMAINS'
        USING ERRCODE='42501';
    END IF;
  END LOOP;
END;
$$;

COMMIT;
