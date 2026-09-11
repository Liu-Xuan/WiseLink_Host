BEGIN;
CREATE TABLE dm_document_parse_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parse_run_id varchar(96) NOT NULL UNIQUE,
  document_version_id varchar(96) NOT NULL REFERENCES dm_document_version(document_version_id),
  tenant_id varchar(128) NOT NULL,
  actor_user_id varchar(255) NOT NULL,
  request_id varchar(128) NOT NULL,
  parse_revision integer NOT NULL CHECK (parse_revision > 0),
  expected_published_revision integer NOT NULL CHECK (expected_published_revision >= 0),
  status varchar(32) NOT NULL CHECK (status IN ('RUNNING', 'STAGING', 'PUBLISHED', 'FAILED')),
  bucket_id varchar(255) NOT NULL,
  source_binding jsonb NOT NULL,
  artifact_progress jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(artifact_progress) = 'array'),
  pending_object jsonb,
  manifest_artifact jsonb,
  error_code varchar(160),
  error_message text,
  started_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deadline_at timestamptz(3) NOT NULL,
  completed_at timestamptz(3),
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT CASE WHEN current_setting('app.user_id', true) = '' THEN NULL ELSE concat('(', current_setting('app.user_id', true), ')')::user_profile END,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT CASE WHEN current_setting('app.user_id', true) = '' THEN NULL ELSE concat('(', current_setting('app.user_id', true), ')')::user_profile END,
  CONSTRAINT ck_dm_parse_source_version CHECK (jsonb_typeof(source_binding) = 'object'
    AND jsonb_exists(source_binding, 'documentVersionId') AND source_binding ->> 'documentVersionId' = document_version_id),
  CONSTRAINT ck_dm_parse_publication CHECK (
    (status = 'PUBLISHED' AND manifest_artifact IS NOT NULL
      AND manifest_artifact @> '{"role":"MANIFEST","readback":"VERIFIED"}'::jsonb
      AND pending_object IS NULL AND completed_at IS NOT NULL)
    OR (status <> 'PUBLISHED' AND manifest_artifact IS NULL)
  )
);
CREATE UNIQUE INDEX uk_dm_parse_request ON dm_document_parse_run(tenant_id, actor_user_id, document_version_id, request_id);
CREATE UNIQUE INDEX uk_dm_parse_revision ON dm_document_parse_run(tenant_id, document_version_id, parse_revision);
CREATE UNIQUE INDEX uk_dm_parse_active ON dm_document_parse_run(tenant_id, document_version_id) WHERE status IN ('RUNNING', 'STAGING');

CREATE FUNCTION dm_guard_parse_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('PUBLISHED', 'FAILED') THEN
    RAISE EXCEPTION 'DOCUMENT_PARSE_TERMINAL_IMMUTABLE';
  END IF;
  IF (NEW.parse_run_id, NEW.document_version_id, NEW.tenant_id, NEW.actor_user_id, NEW.request_id,
      NEW.parse_revision, NEW.expected_published_revision, NEW.bucket_id, NEW.source_binding, NEW.started_at, NEW.deadline_at)
    IS DISTINCT FROM
     (OLD.parse_run_id, OLD.document_version_id, OLD.tenant_id, OLD.actor_user_id, OLD.request_id,
      OLD.parse_revision, OLD.expected_published_revision, OLD.bucket_id, OLD.source_binding, OLD.started_at, OLD.deadline_at) THEN
    RAISE EXCEPTION 'DOCUMENT_PARSE_BINDING_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dm_parse_run_immutable BEFORE UPDATE ON dm_document_parse_run FOR EACH ROW EXECUTE FUNCTION dm_guard_parse_run();
ALTER TABLE dm_document_parse_run ENABLE ROW LEVEL SECURITY;
CREATE POLICY dm_parse_read ON dm_document_parse_run FOR SELECT TO authenticated, service_role USING (
  engineering_matter_document_owned_by_actor(tenant_id, document_version_id)
);
CREATE POLICY dm_parse_insert ON dm_document_parse_run FOR INSERT TO authenticated, service_role WITH CHECK (
  actor_user_id = current_setting('app.user_id', true)
  AND engineering_matter_document_owned_by_actor(tenant_id, document_version_id)
);
CREATE POLICY dm_parse_update ON dm_document_parse_run FOR UPDATE TO authenticated, service_role USING (
  actor_user_id = current_setting('app.user_id', true)
  AND engineering_matter_document_owned_by_actor(tenant_id, document_version_id)
) WITH CHECK (
  actor_user_id = current_setting('app.user_id', true)
  AND engineering_matter_document_owned_by_actor(tenant_id, document_version_id)
);
CREATE POLICY dm_parse_no_delete ON dm_document_parse_run FOR DELETE TO authenticated, service_role USING (false);
-- Table privileges are provisioned by the platform; the policies above retain actor/document scope.
COMMIT;
