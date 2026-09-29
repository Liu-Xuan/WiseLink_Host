-- DRAFT ONLY. Apply after 0069 following the normal dev/online review and
-- schema readback. This migration does not enable a source policy or worker.
BEGIN;
DO $$
BEGIN
  IF current_schema() IS DISTINCT FROM 'workspace_aadkpkjef3slu'
      OR to_regclass('workspace_aadkpkjef3slu.dm_acquisition') IS NULL
      OR to_regclass('workspace_aadkpkjef3slu.action_attempt') IS NULL
      OR NOT EXISTS (SELECT 1 FROM pg_roles
        WHERE rolname='service_role_workspace_aadkpkjef3slu'
          AND NOT rolsuper AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'SOURCE_INTAKE_APP_SCHEMA_OR_ROLE_MISMATCH' USING ERRCODE='42501';
  END IF;
END;
$$;

ALTER TABLE action_attempt DROP CONSTRAINT ck_action_attempt_subject;
ALTER TABLE action_attempt ADD CONSTRAINT ck_action_attempt_subject CHECK (
  (subject_kind = 'WORK_ITEM' AND work_item_id IS NOT NULL
    AND matter_id IS NULL AND matter_revision_id IS NULL
    AND action_type NOT IN ('OPENCLAW_MATTER_ASSESSMENT', 'DOCUMENT_TRANSLATE'))
  OR (subject_kind = 'ENGINEERING_MATTER' AND work_item_id IS NULL
    AND document_version_id IS NULL AND matter_id IS NOT NULL AND matter_revision_id IS NOT NULL
    AND action_type = 'OPENCLAW_MATTER_ASSESSMENT'
    AND input_revision IS NOT NULL AND base_revision IS NOT NULL)
  OR (subject_kind = 'DOCUMENT_VERSION' AND work_item_id IS NULL
    AND matter_id IS NULL AND matter_revision_id IS NULL AND document_version_id IS NOT NULL
    AND producer_run_id IS NOT NULL AND input_revision IS NOT NULL AND input_revision > 0
    AND action_type = 'DOCUMENT_TRANSLATE'
    AND (execution_model_json IS NULL OR (
      jsonb_typeof(execution_model_json::jsonb) = 'object'
      AND jsonb_exists_all(execution_model_json::jsonb,
        ARRAY['modelRef','displayName','providerKind','settingsRevision','selectedAt']::text[])
      AND execution_model_json::jsonb ->> 'modelRef' = 'm3probe/minimax-m3'
      AND execution_model_json::jsonb ->> 'providerKind' = 'CUSTOM'
      AND jsonb_typeof(execution_model_json::jsonb -> 'displayName') = 'string'
      AND execution_model_json::jsonb ->> 'displayName' <> ''
      AND jsonb_typeof(execution_model_json::jsonb -> 'settingsRevision') = 'number'
      AND (execution_model_json::jsonb ->> 'settingsRevision')::numeric >= 0
      AND jsonb_typeof(execution_model_json::jsonb -> 'selectedAt') = 'string'
    )))
  OR (subject_kind = 'ACQUISITION' AND work_item_id IS NULL
    AND matter_id IS NULL AND matter_revision_id IS NULL AND document_version_id IS NULL
    AND producer_run_id IS NULL AND input_revision IS NULL AND base_revision IS NULL
    AND action_type = 'DOCUMENT_DELIVERY_INTENT' AND status = 'RECORDED'
    AND task_envelope_json IS NOT NULL AND idempotency_key IS NOT NULL)
);

-- 0054 is the current restrictive subject policy. Retain all earlier
-- branches verbatim; the new branch can only be read under the exact Host role.
DROP POLICY action_attempt_matter_or_document_subject_boundary ON action_attempt;
CREATE POLICY action_attempt_matter_or_document_subject_boundary ON action_attempt
AS RESTRICTIVE FOR ALL TO authenticated, service_role
USING (
  subject_kind IN ('WORK_ITEM', 'DOCUMENT_VERSION') OR (
    subject_kind = 'ACQUISITION' AND current_user='service_role_workspace_aadkpkjef3slu'
      AND actor_user_id=current_setting('app.user_id',true)
      AND starts_with(idempotency_key,
        'source-intake:')
      AND EXISTS (SELECT 1 FROM dm_acquisition a
        WHERE a.acquisition_id=action_attempt.task_envelope_json::jsonb->>'acquisitionId'
          AND a.acquired_by=action_attempt.actor_user_id
          AND starts_with(a.idempotency_key,
            'tenant:'||engineering_matter_uri_component(action_attempt.tenant_id)||':request:'))
  ) OR (
    subject_kind = 'ENGINEERING_MATTER'
      AND actor_user_id = current_setting('app.user_id', true)
      AND engineering_matter_actor_has_tenant(tenant_id)
      AND engineering_matter_owned_by_actor(tenant_id, matter_id)
      AND engineering_matter_all_links_owned_by_actor(tenant_id, matter_revision_id)
      AND EXISTS (SELECT 1 FROM engineering_matter m WHERE m.tenant_id = action_attempt.tenant_id
        AND m.matter_id = action_attempt.matter_id
        AND engineering_matter_all_links_owned_by_actor(m.tenant_id, m.current_matter_revision_id))
  )
);

-- The platform may grant broad native table privileges. A restrictive policy
-- and a trigger both deny forged source-channel rows and identity changes.
CREATE POLICY dm_acquisition_source_intake_host_only ON dm_acquisition
AS RESTRICTIVE FOR ALL TO PUBLIC
USING (source_channel <> 'wiselink_drive_source'
  OR current_user='service_role_workspace_aadkpkjef3slu')
WITH CHECK (source_channel <> 'wiselink_drive_source'
  OR current_user='service_role_workspace_aadkpkjef3slu');
CREATE POLICY action_attempt_source_intake_host_only ON action_attempt
AS RESTRICTIVE FOR ALL TO PUBLIC
USING (subject_kind <> 'ACQUISITION'
  OR (current_user='service_role_workspace_aadkpkjef3slu'
    AND actor_user_id=current_setting('app.user_id',true)
    AND EXISTS (SELECT 1 FROM dm_acquisition a
      WHERE a.acquisition_id=action_attempt.task_envelope_json::jsonb->>'acquisitionId'
        AND a.acquired_by=action_attempt.actor_user_id
        AND starts_with(a.idempotency_key,
          'tenant:'||engineering_matter_uri_component(action_attempt.tenant_id)||':request:'))))
WITH CHECK (subject_kind <> 'ACQUISITION'
  OR (current_user='service_role_workspace_aadkpkjef3slu'
    AND actor_user_id=current_setting('app.user_id',true)));

CREATE FUNCTION source_intake_guard_acquisition() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.source_channel='wiselink_drive_source' AND
      (current_user <> 'service_role_workspace_aadkpkjef3slu'
        OR NEW.acquired_by IS DISTINCT FROM current_setting('app.user_id',true)) THEN
      RAISE EXCEPTION 'SOURCE_INTAKE_HOST_REQUIRED' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.source_channel='wiselink_drive_source' THEN
    IF TG_OP='DELETE' THEN
      RAISE EXCEPTION 'SOURCE_INTAKE_ACQUISITION_DELETE_DENIED' USING ERRCODE='42501';
    END IF;
    IF ROW(OLD.acquisition_id,OLD.source_artifact_id,OLD.source_channel,OLD.source_ref,
      OLD.selection_bucket_id,OLD.selection_file_path,OLD.provider_object_id,
      OLD.provider_version_id,OLD.acquired_by,OLD.acquired_at,OLD.idempotency_key,
      OLD.source_descriptor_json) IS DISTINCT FROM
      ROW(NEW.acquisition_id,NEW.source_artifact_id,NEW.source_channel,NEW.source_ref,
      NEW.selection_bucket_id,NEW.selection_file_path,NEW.provider_object_id,
      NEW.provider_version_id,NEW.acquired_by,NEW.acquired_at,NEW.idempotency_key,
      NEW.source_descriptor_json) THEN
      RAISE EXCEPTION 'SOURCE_INTAKE_ACQUISITION_IMMUTABLE' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.source_channel='wiselink_drive_source' THEN
    RAISE EXCEPTION 'SOURCE_INTAKE_CHANNEL_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_intake_guard_acquisition
BEFORE INSERT OR UPDATE OR DELETE ON dm_acquisition
FOR EACH ROW EXECUTE FUNCTION source_intake_guard_acquisition();

CREATE FUNCTION source_intake_guard_attempt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE
  e jsonb;
  a record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF OLD.subject_kind='ACQUISITION' THEN
      RAISE EXCEPTION 'SOURCE_INTAKE_INTENT_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND NEW.subject_kind='ACQUISITION' THEN
      RAISE EXCEPTION 'SOURCE_INTAKE_INTENT_INSERT_REQUIRED' USING ERRCODE='23514';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF NEW.subject_kind <> 'ACQUISITION' THEN RETURN NEW; END IF;
  IF current_user <> 'service_role_workspace_aadkpkjef3slu'
      OR NEW.actor_user_id IS DISTINCT FROM current_setting('app.user_id',true) THEN
    RAISE EXCEPTION 'SOURCE_INTAKE_HOST_REQUIRED' USING ERRCODE='42501';
  END IF;
  e := NEW.task_envelope_json::jsonb;
  IF jsonb_typeof(e) IS DISTINCT FROM 'object'
      OR NOT jsonb_exists_all(e,
        ARRAY['schemaVersion','acquisitionId','authority','documentDelivery','engineeringMode']::text[])
      OR e - ARRAY['schemaVersion','acquisitionId','authority',
                   'documentDelivery','engineeringMode']::text[] <> '{}'::jsonb
      OR COALESCE(e->>'schemaVersion','') <> 'wiselink.document_delivery_intent.v2'
      OR COALESCE(e->>'acquisitionId','') = ''
      OR jsonb_typeof(e->'authority') IS DISTINCT FROM 'object'
      OR NOT jsonb_exists_all(e->'authority',
        ARRAY['kind','authorityRef','policyRevision','executorPrincipalId']::text[])
      OR (e->'authority') - ARRAY['kind','authorityRef','policyRevision',
        'executorPrincipalId']::text[] <> '{}'::jsonb
      OR COALESCE(e->'authority'->>'kind','') NOT IN ('VERIFIED_UPLOAD','SOURCE_DELEGATION')
      OR COALESCE(e->'authority'->>'authorityRef','') = ''
      OR COALESCE(e->'authority'->>'policyRevision','') = ''
      OR COALESCE(e->'authority'->>'executorPrincipalId','') = ''
      OR jsonb_typeof(e->'documentDelivery') IS DISTINCT FROM 'object'
      OR NOT jsonb_exists_all(e->'documentDelivery',ARRAY['reading','translation']::text[])
      OR (e->'documentDelivery') - ARRAY['reading','translation']::text[] <> '{}'::jsonb
      OR e->'documentDelivery'->'reading' IS NULL
      OR e->'documentDelivery'->'reading' NOT IN ('true'::jsonb,'false'::jsonb)
      OR COALESCE(e->'documentDelivery'->>'translation','') NOT IN ('NONE','ZH_FULL')
      OR COALESCE(e->>'engineeringMode','') NOT IN ('DOCUMENT_ONLY','AUTHORIZED_SCOPE') THEN
    RAISE EXCEPTION 'SOURCE_INTAKE_ENVELOPE_INVALID' USING ERRCODE='23514';
  END IF;
  SELECT d.acquisition_id,d.source_channel,d.acquired_by,d.source_descriptor_json,
      d.idempotency_key,d.selection_bucket_id,d.selection_file_path,
      d.provider_object_id,d.provider_version_id,s.readback_verified,
      s.bucket_id,s.file_path,s.provider_object_id AS artifact_object_id,
      s.provider_version_id AS artifact_version_id
    INTO a FROM workspace_aadkpkjef3slu.dm_acquisition d
    JOIN workspace_aadkpkjef3slu.dm_source_artifact s
      ON s.source_artifact_id=d.source_artifact_id
    WHERE d.acquisition_id=e->>'acquisitionId';
  IF a.acquisition_id IS NULL OR a.acquired_by<>NEW.actor_user_id
      OR a.readback_verified IS DISTINCT FROM TRUE
      OR a.selection_bucket_id IS DISTINCT FROM a.bucket_id
      OR a.selection_file_path IS DISTINCT FROM a.file_path
      OR a.provider_object_id IS DISTINCT FROM a.artifact_object_id
      OR a.provider_version_id IS DISTINCT FROM a.artifact_version_id
      OR NOT starts_with(a.idempotency_key,
        'tenant:'||workspace_aadkpkjef3slu.engineering_matter_uri_component(NEW.tenant_id)||':request:')
      OR NEW.idempotency_key IS DISTINCT FROM
        'source-intake:'||a.acquisition_id||':initial'
      OR ((a.source_channel='document_library_upload'
        AND e->'authority'->>'kind'='VERIFIED_UPLOAD'
        AND e->'authority'->>'authorityRef'=a.acquisition_id
        AND e->'authority'->>'policyRevision'='verified-upload.v1'
        AND e->>'engineeringMode'='DOCUMENT_ONLY'
        AND a.source_descriptor_json::jsonb->'documentDeliveryIntent'=e->'documentDelivery')
        OR (a.source_channel='wiselink_drive_source'
          AND e->'authority'->>'kind'='SOURCE_DELEGATION'
          AND e->'authority'->>'authorityRef'=
            (a.source_descriptor_json::jsonb->>'sourceKey')||':'||
            (a.source_descriptor_json::jsonb->>'rootToken'))) IS NOT TRUE THEN
    RAISE EXCEPTION 'SOURCE_INTAKE_ACQUISITION_MISMATCH' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_intake_guard_attempt
BEFORE INSERT OR UPDATE OR DELETE ON action_attempt
FOR EACH ROW EXECUTE FUNCTION source_intake_guard_attempt();
COMMIT;
