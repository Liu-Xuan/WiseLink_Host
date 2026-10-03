BEGIN;

DO $summary_sql_boundaries$ DECLARE role_oids oid[]; BEGIN
  SELECT array_agg(oid ORDER BY oid) INTO role_oids FROM pg_roles
    WHERE rolname IN ('authenticated_' || current_schema(),
      'service_role_' || current_schema(),'anon_' || current_schema());
  IF cardinality(role_oids) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'DERIVED_SUMMARY_SQL_ROLES_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE oid=ANY(role_oids) AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'DERIVED_SUMMARY_SQL_ROLE_RLS_REQUIRED' USING ERRCODE='42501';
  END IF;
END $summary_sql_boundaries$;

CREATE TABLE IF NOT EXISTS derived_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_id varchar(96) NOT NULL UNIQUE,
  tenant_id varchar(128) NOT NULL,
  actor_user_id varchar(255) NOT NULL,
  create_request_id varchar(96) NOT NULL,
  scope_json jsonb NOT NULL,
  members_json jsonb NOT NULL,
  current_revision integer NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  current_summary_ref varchar(96),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT CASE WHEN current_setting('app.user_id', true)='' THEN NULL
    ELSE concat('(',current_setting('app.user_id', true),')')::user_profile END,
  _updated_by user_profile DEFAULT CASE WHEN current_setting('app.user_id', true)='' THEN NULL
    ELSE concat('(',current_setting('app.user_id', true),')')::user_profile END,
  CONSTRAINT uk_derived_summary_request UNIQUE (tenant_id, actor_user_id, create_request_id),
  CONSTRAINT uk_derived_summary_tenant_id UNIQUE (tenant_id, summary_id),
  CONSTRAINT ck_derived_summary_pointer CHECK
    ((current_revision = 0 AND current_summary_ref IS NULL) OR
     (current_revision > 0 AND current_summary_ref IS NOT NULL))
);

ALTER TABLE action_attempt ADD COLUMN IF NOT EXISTS summary_id varchar(96);
ALTER TABLE action_attempt ADD COLUMN IF NOT EXISTS summary_request_command_json text;
ALTER TABLE action_attempt ADD COLUMN IF NOT EXISTS summary_delegated_principal_id varchar(160);

-- The SDK installs a PostgreSQL-validated SET LOCAL ROLE before each query.
-- Freeze the schema here; JWT/app claim GUCs and caller JSON are not roles.
CREATE OR REPLACE FUNCTION derived_summary_sql_role_allowed(service_only boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
  SELECT COALESCE(current_setting('role', true), '') = 'service_role_' || current_schema()
    OR (service_only IS FALSE AND COALESCE(current_setting('role', true), '') = 'authenticated_' || current_schema());
$$;

CREATE OR REPLACE FUNCTION derived_summary_attempt_owned(t varchar, actor varchar, s varchar)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
  SELECT derived_summary_sql_role_allowed(false)
    AND actor = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(t)
    AND EXISTS (SELECT 1 FROM derived_summary h WHERE h.tenant_id=t AND h.summary_id=s AND h.actor_user_id=actor);
$$;

-- Only the existing Hosted service may resolve the actor of an explicitly
-- delegated request, before entering that actor's ordinary RLS scope.
-- The platform manages ACLs. PostgreSQL's special role setting records the
-- SDK's validated SET LOCAL ROLE; current_user here would be the definer,
-- and JWT/app claim GUCs are not trusted role identities.
CREATE OR REPLACE FUNCTION derived_summary_runtime_actor(t varchar, s varchar, a varchar, principal varchar)
RETURNS varchar LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE bound_actor varchar;
BEGIN
  IF NOT derived_summary_sql_role_allowed(true) THEN
    RAISE EXCEPTION 'DERIVED_SUMMARY_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT x.actor_user_id INTO bound_actor FROM action_attempt x JOIN derived_summary h
    ON h.tenant_id=x.tenant_id AND h.summary_id=x.summary_id AND h.actor_user_id=x.actor_user_id
  WHERE x.tenant_id=t AND x.summary_id=s AND x.operation_ref=a
    AND x.subject_kind='DERIVED_SUMMARY' AND x.action_type='OPENCLAW_DERIVED_SUMMARY'
    AND x.summary_delegated_principal_id=principal
    AND EXISTS (SELECT 1 FROM identity_subject_mapping m WHERE m.miaoda_user_id=x.actor_user_id
      AND m.miaoda_tenant_id=t AND m.expected_client_id='cli_aadde8b579f95bc9' AND m.status='ACTIVE');
  RETURN bound_actor;
END;
$$;

-- Ordinary source RLS also governs saved task/body copies. Exact leaf work and
-- original carriers are retained in the Host reading snapshot, including upper summaries.
CREATE OR REPLACE FUNCTION derived_summary_reading_sources_owned(t varchar, actor varchar, reading jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE member jsonb; leaf jsonb; e jsonb; saved record;
BEGIN
  IF NOT derived_summary_sql_role_allowed(false)
    OR actor IS DISTINCT FROM current_setting('app.user_id', true)
    OR NOT engineering_matter_actor_has_tenant(t)
    OR jsonb_typeof(reading->'members') IS DISTINCT FROM 'array'
    OR jsonb_typeof(reading->'evidence') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR member IN SELECT jsonb_array_elements(reading->'members') LOOP
    IF jsonb_typeof(member->'leaves') IS DISTINCT FROM 'array' OR jsonb_array_length(member->'leaves')=0 THEN RETURN false; END IF;
    FOR leaf IN SELECT jsonb_array_elements(member->'leaves') LOOP
      IF leaf->>'kind'='WORK_ITEM_WORK' THEN
        IF NOT engineering_matter_work_item_owned_by_actor(t,(leaf->>'workItemId')::varchar)
          OR NOT engineering_matter_document_owned_by_actor(t,(leaf->>'documentVersionId')::varchar)
          OR NOT EXISTS (SELECT 1 FROM assessment_work_revision r WHERE r.tenant_id=t
            AND r.work_item_id=leaf->>'workItemId' AND r.assessment_work_revision_id=leaf->>'workRef'
            AND r.document_version_id=leaf->>'documentVersionId' AND r.work_revision=(leaf->>'workRevision')::integer
            AND r.created_by_user_id=actor) THEN RETURN false; END IF;
      ELSIF leaf->>'kind'='MATTER_WORK' THEN
        SELECT r.based_on_matter_revision_id,m.current_matter_revision_id INTO saved
          FROM engineering_matter_work_revision r JOIN engineering_matter m
            ON m.tenant_id=r.tenant_id AND m.matter_id=r.matter_id
          WHERE r.tenant_id=t AND r.matter_id=leaf->>'matterId' AND r.matter_work_revision_id=leaf->>'workRef'
            AND r.working_revision=(leaf->>'workRevision')::integer AND r.created_by_user_id=actor;
        IF NOT FOUND OR NOT engineering_matter_owned_by_actor(t,(leaf->>'matterId')::varchar)
          OR NOT engineering_matter_all_links_owned_by_actor(t,saved.based_on_matter_revision_id)
          OR NOT engineering_matter_all_links_owned_by_actor(t,saved.current_matter_revision_id) THEN RETURN false; END IF;
      ELSE RETURN false; END IF;
    END LOOP;
  END LOOP;
  FOR e IN SELECT jsonb_array_elements(reading->'evidence') LOOP
    IF e->>'kind' IN ('DOCUMENT_PASSAGE','ENGINEER_ATTACHMENT') AND
      NOT engineering_matter_document_owned_by_actor(t,(e->>'documentVersionId')::varchar) THEN RETURN false; END IF;
    IF e->>'workItemId' IS NOT NULL AND
      NOT engineering_matter_work_item_owned_by_actor(t,(e->>'workItemId')::varchar) THEN RETURN false; END IF;
    IF e->'sourceWork'->>'subjectKind'='ENGINEERING_MATTER' AND
      NOT engineering_matter_owned_by_actor(t,(e->'sourceWork'->>'subjectId')::varchar) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

-- This source requires the official-snapshot preparer before execution.
-- @derived-summary:legacy-boundaries:start
DO $$ BEGIN RAISE EXCEPTION 'DERIVED_SUMMARY_PREPARE_REQUIRED' USING ERRCODE='42501'; END $$;
-- @derived-summary:legacy-boundaries:end

CREATE OR REPLACE FUNCTION action_attempt_preserve_summary_subject() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.subject_kind='DERIVED_SUMMARY' OR NEW.subject_kind='DERIVED_SUMMARY') AND
    ROW(OLD.attempt_id,OLD.operation_ref,OLD.idempotency_key,OLD.attempt_no,OLD.request_origin,OLD.deadline_at,
      OLD.subject_kind,OLD.summary_id,OLD.tenant_id,OLD.actor_user_id,OLD.work_item_id,OLD.matter_id,
      OLD.matter_revision_id,OLD.document_version_id,OLD.action_type,OLD.base_revision,OLD.input_revision,
      OLD.trigger_request_id,OLD.summary_request_command_json,OLD.summary_delegated_principal_id,
      OLD.task_envelope_json,OLD.task_input_hash,OLD.execution_model_json)
    IS DISTINCT FROM
    ROW(NEW.attempt_id,NEW.operation_ref,NEW.idempotency_key,NEW.attempt_no,NEW.request_origin,NEW.deadline_at,
      NEW.subject_kind,NEW.summary_id,NEW.tenant_id,NEW.actor_user_id,NEW.work_item_id,NEW.matter_id,
      NEW.matter_revision_id,NEW.document_version_id,NEW.action_type,NEW.base_revision,NEW.input_revision,
      NEW.trigger_request_id,NEW.summary_request_command_json,NEW.summary_delegated_principal_id,
      NEW.task_envelope_json,NEW.task_input_hash,NEW.execution_model_json) THEN
    RAISE EXCEPTION 'ACTION_ATTEMPT_SUBJECT_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS action_attempt_preserve_summary_subject ON action_attempt;
CREATE TRIGGER action_attempt_preserve_summary_subject BEFORE UPDATE ON action_attempt FOR EACH ROW
  EXECUTE FUNCTION action_attempt_preserve_summary_subject();

CREATE TABLE IF NOT EXISTS derived_summary_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_ref varchar(96) NOT NULL UNIQUE,
  summary_id varchar(96) NOT NULL,
  tenant_id varchar(128) NOT NULL,
  actor_user_id varchar(255) NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  request_id varchar(96) NOT NULL,
  attempt_id varchar(96) NOT NULL REFERENCES action_attempt(attempt_id),
  content_json jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT CASE WHEN current_setting('app.user_id', true)='' THEN NULL
    ELSE concat('(',current_setting('app.user_id', true),')')::user_profile END,
  _updated_by user_profile DEFAULT CASE WHEN current_setting('app.user_id', true)='' THEN NULL
    ELSE concat('(',current_setting('app.user_id', true),')')::user_profile END,
  CONSTRAINT fk_derived_summary_revision_head FOREIGN KEY (tenant_id, summary_id)
    REFERENCES derived_summary(tenant_id, summary_id),
  CONSTRAINT uk_derived_summary_revision UNIQUE (tenant_id, summary_id, revision),
  CONSTRAINT uk_derived_summary_save_request UNIQUE (tenant_id, summary_id, request_id),
  CONSTRAINT uk_derived_summary_exact_ref UNIQUE (tenant_id, summary_id, summary_ref)
);
CREATE OR REPLACE FUNCTION derived_summary_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'DERIVED_SUMMARY_REVISION_IMMUTABLE' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS derived_summary_revision_immutable ON derived_summary_revision;
CREATE TRIGGER derived_summary_revision_immutable BEFORE UPDATE OR DELETE ON derived_summary_revision
  FOR EACH ROW EXECUTE FUNCTION derived_summary_revision_immutable();

-- Platform default table ACLs can include TRUNCATE, which bypasses RLS and
-- row-level immutable triggers. Preserve candidate history under those ACLs.
CREATE OR REPLACE FUNCTION derived_summary_reject_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'DERIVED_SUMMARY_TRUNCATE_DENIED' USING ERRCODE='42501'; END $$;
DROP TRIGGER IF EXISTS derived_summary_no_truncate ON derived_summary;
CREATE TRIGGER derived_summary_no_truncate BEFORE TRUNCATE ON derived_summary
  FOR EACH STATEMENT EXECUTE FUNCTION derived_summary_reject_truncate();
DROP TRIGGER IF EXISTS derived_summary_revision_no_truncate ON derived_summary_revision;
CREATE TRIGGER derived_summary_revision_no_truncate BEFORE TRUNCATE ON derived_summary_revision
  FOR EACH STATEMENT EXECUTE FUNCTION derived_summary_reject_truncate();

-- Fresh names force the managed migration snapshot to carry constraints
-- omitted by an earlier DO apply. All physical changes stay top-level.
ALTER TABLE derived_summary DROP CONSTRAINT IF EXISTS fk_derived_summary_current;
ALTER TABLE derived_summary DROP CONSTRAINT IF EXISTS fk_derived_summary_saved_pointer;
ALTER TABLE derived_summary ADD CONSTRAINT fk_derived_summary_saved_pointer
  FOREIGN KEY (tenant_id,summary_id,current_summary_ref)
  REFERENCES derived_summary_revision(tenant_id,summary_id,summary_ref) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE action_attempt DROP CONSTRAINT IF EXISTS fk_action_attempt_derived_summary;
ALTER TABLE action_attempt DROP CONSTRAINT IF EXISTS fk_action_attempt_summary_head;
ALTER TABLE action_attempt ADD CONSTRAINT fk_action_attempt_summary_head
  FOREIGN KEY (tenant_id,summary_id) REFERENCES derived_summary(tenant_id,summary_id);
ALTER TABLE action_attempt DROP CONSTRAINT IF EXISTS ck_action_attempt_derived_summary;
ALTER TABLE action_attempt DROP CONSTRAINT IF EXISTS ck_action_attempt_summary_identity;
ALTER TABLE action_attempt ADD CONSTRAINT ck_action_attempt_summary_identity CHECK (
  (subject_kind='DERIVED_SUMMARY' AND summary_id IS NOT NULL AND work_item_id IS NULL
    AND matter_id IS NULL AND matter_revision_id IS NULL AND document_version_id IS NULL
    AND action_type='OPENCLAW_DERIVED_SUMMARY' AND summary_request_command_json IS NOT NULL
    AND summary_delegated_principal_id IS NOT NULL)
  OR (subject_kind<>'DERIVED_SUMMARY' AND summary_id IS NULL AND action_type<>'OPENCLAW_DERIVED_SUMMARY')
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_action_attempt_summary_number
  ON action_attempt (tenant_id, summary_id, action_type, attempt_no)
  WHERE subject_kind = 'DERIVED_SUMMARY';
CREATE UNIQUE INDEX IF NOT EXISTS uk_action_attempt_active_summary
  ON action_attempt (tenant_id, summary_id, action_type)
  WHERE subject_kind = 'DERIVED_SUMMARY' AND status IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING');

ALTER TABLE derived_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE derived_summary_revision ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS derived_summary_actor ON derived_summary;
CREATE POLICY derived_summary_actor ON derived_summary TO authenticated
  USING (actor_user_id = current_setting('app.user_id', true))
  WITH CHECK (actor_user_id = current_setting('app.user_id', true));
DROP POLICY IF EXISTS derived_summary_service ON derived_summary;
CREATE POLICY derived_summary_service ON derived_summary TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS derived_summary_revision_actor_read ON derived_summary_revision;
CREATE POLICY derived_summary_revision_actor_read ON derived_summary_revision FOR SELECT TO authenticated
  USING (actor_user_id = current_setting('app.user_id', true));
DROP POLICY IF EXISTS derived_summary_revision_actor_insert ON derived_summary_revision;
DROP POLICY IF EXISTS derived_summary_revision_service ON derived_summary_revision;
CREATE POLICY derived_summary_revision_service ON derived_summary_revision TO service_role USING (true) WITH CHECK (true);
-- Preserve the original narrow table rights even if the platform installs
-- additional broad native CRUD policies. Restrictive policies only constrain
-- the three actual SDK scopes; they do not give any additional access.

-- Use top-level portable aliases so the platform records every SQL scope
-- in migration metadata. Each policy constrains exactly one SDK scope.
DROP POLICY IF EXISTS action_attempt_summary_subject_boundary ON action_attempt;
DROP POLICY IF EXISTS action_attempt_summary_subject_boundary_authenticated ON action_attempt;
CREATE POLICY action_attempt_summary_subject_boundary_authenticated ON action_attempt AS RESTRICTIVE FOR ALL TO authenticated
      USING (subject_kind <> 'DERIVED_SUMMARY' OR (derived_summary_attempt_owned(tenant_id,actor_user_id,summary_id)
        AND derived_summary_reading_sources_owned(tenant_id,actor_user_id,task_envelope_json::jsonb->'modelInput')))
      WITH CHECK (subject_kind <> 'DERIVED_SUMMARY' OR (derived_summary_attempt_owned(tenant_id,actor_user_id,summary_id)
        AND derived_summary_reading_sources_owned(tenant_id,actor_user_id,task_envelope_json::jsonb->'modelInput')));
DROP POLICY IF EXISTS action_attempt_summary_subject_boundary_service_role ON action_attempt;
CREATE POLICY action_attempt_summary_subject_boundary_service_role ON action_attempt AS RESTRICTIVE FOR ALL TO service_role
      USING (subject_kind <> 'DERIVED_SUMMARY' OR (derived_summary_attempt_owned(tenant_id,actor_user_id,summary_id)
        AND derived_summary_reading_sources_owned(tenant_id,actor_user_id,task_envelope_json::jsonb->'modelInput')))
      WITH CHECK (subject_kind <> 'DERIVED_SUMMARY' OR (derived_summary_attempt_owned(tenant_id,actor_user_id,summary_id)
        AND derived_summary_reading_sources_owned(tenant_id,actor_user_id,task_envelope_json::jsonb->'modelInput')));
DROP POLICY IF EXISTS action_attempt_summary_subject_boundary_anon ON action_attempt;
CREATE POLICY action_attempt_summary_subject_boundary_anon ON action_attempt AS RESTRICTIVE FOR ALL TO anon
      USING (subject_kind <> 'DERIVED_SUMMARY' OR (derived_summary_attempt_owned(tenant_id,actor_user_id,summary_id)
        AND derived_summary_reading_sources_owned(tenant_id,actor_user_id,task_envelope_json::jsonb->'modelInput')))
      WITH CHECK (subject_kind <> 'DERIVED_SUMMARY' OR (derived_summary_attempt_owned(tenant_id,actor_user_id,summary_id)
        AND derived_summary_reading_sources_owned(tenant_id,actor_user_id,task_envelope_json::jsonb->'modelInput')));
DROP POLICY IF EXISTS derived_summary_owner_boundary ON derived_summary;
DROP POLICY IF EXISTS derived_summary_owner_boundary_authenticated ON derived_summary;
CREATE POLICY derived_summary_owner_boundary_authenticated ON derived_summary AS RESTRICTIVE FOR ALL TO authenticated
      USING (derived_summary_sql_role_allowed(false) AND actor_user_id=current_setting('app.user_id',true) AND engineering_matter_actor_has_tenant(tenant_id))
      WITH CHECK (derived_summary_sql_role_allowed(false) AND actor_user_id=current_setting('app.user_id',true) AND engineering_matter_actor_has_tenant(tenant_id));
DROP POLICY IF EXISTS derived_summary_owner_boundary_service_role ON derived_summary;
CREATE POLICY derived_summary_owner_boundary_service_role ON derived_summary AS RESTRICTIVE FOR ALL TO service_role
      USING (derived_summary_sql_role_allowed(false) AND actor_user_id=current_setting('app.user_id',true) AND engineering_matter_actor_has_tenant(tenant_id))
      WITH CHECK (derived_summary_sql_role_allowed(false) AND actor_user_id=current_setting('app.user_id',true) AND engineering_matter_actor_has_tenant(tenant_id));
DROP POLICY IF EXISTS derived_summary_owner_boundary_anon ON derived_summary;
CREATE POLICY derived_summary_owner_boundary_anon ON derived_summary AS RESTRICTIVE FOR ALL TO anon
      USING (derived_summary_sql_role_allowed(false) AND actor_user_id=current_setting('app.user_id',true) AND engineering_matter_actor_has_tenant(tenant_id))
      WITH CHECK (derived_summary_sql_role_allowed(false) AND actor_user_id=current_setting('app.user_id',true) AND engineering_matter_actor_has_tenant(tenant_id));
DROP POLICY IF EXISTS derived_summary_no_delete ON derived_summary;
DROP POLICY IF EXISTS derived_summary_no_delete_authenticated ON derived_summary;
CREATE POLICY derived_summary_no_delete_authenticated ON derived_summary AS RESTRICTIVE FOR DELETE TO authenticated
 USING (false);
DROP POLICY IF EXISTS derived_summary_no_delete_service_role ON derived_summary;
CREATE POLICY derived_summary_no_delete_service_role ON derived_summary AS RESTRICTIVE FOR DELETE TO service_role
 USING (false);
DROP POLICY IF EXISTS derived_summary_no_delete_anon ON derived_summary;
CREATE POLICY derived_summary_no_delete_anon ON derived_summary AS RESTRICTIVE FOR DELETE TO anon
 USING (false);
DROP POLICY IF EXISTS derived_summary_revision_sources ON derived_summary_revision;
DROP POLICY IF EXISTS derived_summary_revision_sources_authenticated ON derived_summary_revision;
CREATE POLICY derived_summary_revision_sources_authenticated ON derived_summary_revision AS RESTRICTIVE FOR ALL TO authenticated
      USING (derived_summary_reading_sources_owned(tenant_id,actor_user_id,content_json))
      WITH CHECK (derived_summary_reading_sources_owned(tenant_id,actor_user_id,content_json));
DROP POLICY IF EXISTS derived_summary_revision_sources_service_role ON derived_summary_revision;
CREATE POLICY derived_summary_revision_sources_service_role ON derived_summary_revision AS RESTRICTIVE FOR ALL TO service_role
      USING (derived_summary_reading_sources_owned(tenant_id,actor_user_id,content_json))
      WITH CHECK (derived_summary_reading_sources_owned(tenant_id,actor_user_id,content_json));
DROP POLICY IF EXISTS derived_summary_revision_sources_anon ON derived_summary_revision;
CREATE POLICY derived_summary_revision_sources_anon ON derived_summary_revision AS RESTRICTIVE FOR ALL TO anon
      USING (derived_summary_reading_sources_owned(tenant_id,actor_user_id,content_json))
      WITH CHECK (derived_summary_reading_sources_owned(tenant_id,actor_user_id,content_json));
DROP POLICY IF EXISTS derived_summary_revision_real_attempt ON derived_summary_revision;
DROP POLICY IF EXISTS derived_summary_revision_real_attempt_authenticated ON derived_summary_revision;
CREATE POLICY derived_summary_revision_real_attempt_authenticated ON derived_summary_revision AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (actor_user_id=current_setting('app.user_id',true) AND EXISTS (
        SELECT 1 FROM action_attempt a WHERE a.attempt_id=derived_summary_revision.attempt_id
          AND a.tenant_id=derived_summary_revision.tenant_id AND a.summary_id=derived_summary_revision.summary_id
          AND a.actor_user_id=derived_summary_revision.actor_user_id AND a.subject_kind='DERIVED_SUMMARY'
          AND a.action_type='OPENCLAW_DERIVED_SUMMARY' AND a.status='RUNNING' AND a.cancel_requested_at IS NULL
          AND a.lease_token IS NOT NULL AND a.lease_expires_at>CURRENT_TIMESTAMP AND a.deadline_at>CURRENT_TIMESTAMP
          AND a.base_revision+1=derived_summary_revision.revision AND a.trigger_request_id=derived_summary_revision.request_id
      ));
DROP POLICY IF EXISTS derived_summary_revision_real_attempt_service_role ON derived_summary_revision;
CREATE POLICY derived_summary_revision_real_attempt_service_role ON derived_summary_revision AS RESTRICTIVE FOR INSERT TO service_role
      WITH CHECK (actor_user_id=current_setting('app.user_id',true) AND EXISTS (
        SELECT 1 FROM action_attempt a WHERE a.attempt_id=derived_summary_revision.attempt_id
          AND a.tenant_id=derived_summary_revision.tenant_id AND a.summary_id=derived_summary_revision.summary_id
          AND a.actor_user_id=derived_summary_revision.actor_user_id AND a.subject_kind='DERIVED_SUMMARY'
          AND a.action_type='OPENCLAW_DERIVED_SUMMARY' AND a.status='RUNNING' AND a.cancel_requested_at IS NULL
          AND a.lease_token IS NOT NULL AND a.lease_expires_at>CURRENT_TIMESTAMP AND a.deadline_at>CURRENT_TIMESTAMP
          AND a.base_revision+1=derived_summary_revision.revision AND a.trigger_request_id=derived_summary_revision.request_id
      ));
DROP POLICY IF EXISTS derived_summary_revision_real_attempt_anon ON derived_summary_revision;
CREATE POLICY derived_summary_revision_real_attempt_anon ON derived_summary_revision AS RESTRICTIVE FOR INSERT TO anon
      WITH CHECK (actor_user_id=current_setting('app.user_id',true) AND EXISTS (
        SELECT 1 FROM action_attempt a WHERE a.attempt_id=derived_summary_revision.attempt_id
          AND a.tenant_id=derived_summary_revision.tenant_id AND a.summary_id=derived_summary_revision.summary_id
          AND a.actor_user_id=derived_summary_revision.actor_user_id AND a.subject_kind='DERIVED_SUMMARY'
          AND a.action_type='OPENCLAW_DERIVED_SUMMARY' AND a.status='RUNNING' AND a.cancel_requested_at IS NULL
          AND a.lease_token IS NOT NULL AND a.lease_expires_at>CURRENT_TIMESTAMP AND a.deadline_at>CURRENT_TIMESTAMP
          AND a.base_revision+1=derived_summary_revision.revision AND a.trigger_request_id=derived_summary_revision.request_id
      ));
DROP POLICY IF EXISTS derived_summary_revision_hosted_insert ON derived_summary_revision;
DROP POLICY IF EXISTS derived_summary_revision_hosted_insert_authenticated ON derived_summary_revision;
CREATE POLICY derived_summary_revision_hosted_insert_authenticated ON derived_summary_revision AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (derived_summary_sql_role_allowed(true));
DROP POLICY IF EXISTS derived_summary_revision_hosted_insert_service_role ON derived_summary_revision;
CREATE POLICY derived_summary_revision_hosted_insert_service_role ON derived_summary_revision AS RESTRICTIVE FOR INSERT TO service_role
      WITH CHECK (derived_summary_sql_role_allowed(true));
DROP POLICY IF EXISTS derived_summary_revision_hosted_insert_anon ON derived_summary_revision;
CREATE POLICY derived_summary_revision_hosted_insert_anon ON derived_summary_revision AS RESTRICTIVE FOR INSERT TO anon
      WITH CHECK (derived_summary_sql_role_allowed(true));
DROP POLICY IF EXISTS derived_summary_revision_no_update ON derived_summary_revision;
DROP POLICY IF EXISTS derived_summary_revision_no_update_authenticated ON derived_summary_revision;
CREATE POLICY derived_summary_revision_no_update_authenticated ON derived_summary_revision AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS derived_summary_revision_no_update_service_role ON derived_summary_revision;
CREATE POLICY derived_summary_revision_no_update_service_role ON derived_summary_revision AS RESTRICTIVE FOR UPDATE TO service_role
      USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS derived_summary_revision_no_update_anon ON derived_summary_revision;
CREATE POLICY derived_summary_revision_no_update_anon ON derived_summary_revision AS RESTRICTIVE FOR UPDATE TO anon
      USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS derived_summary_revision_no_delete ON derived_summary_revision;
DROP POLICY IF EXISTS derived_summary_revision_no_delete_authenticated ON derived_summary_revision;
CREATE POLICY derived_summary_revision_no_delete_authenticated ON derived_summary_revision AS RESTRICTIVE FOR DELETE TO authenticated
 USING (false);
DROP POLICY IF EXISTS derived_summary_revision_no_delete_service_role ON derived_summary_revision;
CREATE POLICY derived_summary_revision_no_delete_service_role ON derived_summary_revision AS RESTRICTIVE FOR DELETE TO service_role
 USING (false);
DROP POLICY IF EXISTS derived_summary_revision_no_delete_anon ON derived_summary_revision;
CREATE POLICY derived_summary_revision_no_delete_anon ON derived_summary_revision AS RESTRICTIVE FOR DELETE TO anon
 USING (false);

-- DO checks metadata only; it does not carry schema mutations to migrate.
DO $summary_sql_boundaries$ DECLARE role_oids oid[]; BEGIN
  SELECT array_agg(oid ORDER BY oid) INTO role_oids FROM pg_roles
    WHERE rolname IN ('authenticated_' || current_schema(),
      'service_role_' || current_schema(),'anon_' || current_schema());
  IF cardinality(role_oids) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'DERIVED_SUMMARY_SQL_ROLES_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE oid=ANY(role_oids) AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'DERIVED_SUMMARY_SQL_ROLE_RLS_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('action_attempt_summary_subject_boundary_authenticated','action_attempt'::regclass,'*','authenticated'),
      ('action_attempt_summary_subject_boundary_service_role','action_attempt'::regclass,'*','service_role'),
      ('action_attempt_summary_subject_boundary_anon','action_attempt'::regclass,'*','anon'),
      ('derived_summary_owner_boundary_authenticated','derived_summary'::regclass,'*','authenticated'),
      ('derived_summary_owner_boundary_service_role','derived_summary'::regclass,'*','service_role'),
      ('derived_summary_owner_boundary_anon','derived_summary'::regclass,'*','anon'),
      ('derived_summary_no_delete_authenticated','derived_summary'::regclass,'d','authenticated'),
      ('derived_summary_no_delete_service_role','derived_summary'::regclass,'d','service_role'),
      ('derived_summary_no_delete_anon','derived_summary'::regclass,'d','anon'),
      ('derived_summary_revision_sources_authenticated','derived_summary_revision'::regclass,'*','authenticated'),
      ('derived_summary_revision_sources_service_role','derived_summary_revision'::regclass,'*','service_role'),
      ('derived_summary_revision_sources_anon','derived_summary_revision'::regclass,'*','anon'),
      ('derived_summary_revision_real_attempt_authenticated','derived_summary_revision'::regclass,'a','authenticated'),
      ('derived_summary_revision_real_attempt_service_role','derived_summary_revision'::regclass,'a','service_role'),
      ('derived_summary_revision_real_attempt_anon','derived_summary_revision'::regclass,'a','anon'),
      ('derived_summary_revision_hosted_insert_authenticated','derived_summary_revision'::regclass,'a','authenticated'),
      ('derived_summary_revision_hosted_insert_service_role','derived_summary_revision'::regclass,'a','service_role'),
      ('derived_summary_revision_hosted_insert_anon','derived_summary_revision'::regclass,'a','anon'),
      ('derived_summary_revision_no_update_authenticated','derived_summary_revision'::regclass,'w','authenticated'),
      ('derived_summary_revision_no_update_service_role','derived_summary_revision'::regclass,'w','service_role'),
      ('derived_summary_revision_no_update_anon','derived_summary_revision'::regclass,'w','anon'),
      ('derived_summary_revision_no_delete_authenticated','derived_summary_revision'::regclass,'d','authenticated'),
      ('derived_summary_revision_no_delete_service_role','derived_summary_revision'::regclass,'d','service_role'),
      ('derived_summary_revision_no_delete_anon','derived_summary_revision'::regclass,'d','anon')
    ) AS expected(name,relation,command,scope)
    LEFT JOIN pg_policy p ON p.polname=expected.name AND p.polrelid=expected.relation
    LEFT JOIN pg_roles r ON r.rolname=expected.scope || '_' || current_schema()
    WHERE p.polname IS NULL OR p.polpermissive OR p.polroles IS DISTINCT FROM ARRAY[r.oid]::oid[]
      OR p.polcmd::text IS DISTINCT FROM expected.command
  ) THEN
    RAISE EXCEPTION 'DERIVED_SUMMARY_SQL_BOUNDARY_REQUIRED' USING ERRCODE='42501';
  END IF;
END $summary_sql_boundaries$;

-- Table/function ACLs are platform-managed; this DDL expresses the narrower
-- actor/source/real-attempt boundaries with RLS and immutable triggers.
COMMENT ON COLUMN derived_summary.scope_json IS '@type import("@shared/derived-summary.interface").DerivedSummaryScopeSelection';
COMMENT ON COLUMN derived_summary.members_json IS '@type import("@shared/derived-summary.interface").DerivedSummaryMember[]';
COMMENT ON COLUMN derived_summary_revision.content_json IS '@type import("@shared/derived-summary.interface").DerivedSummaryRevision';
COMMENT ON TABLE derived_summary IS
  'Explicit candidate aggregate scope and current pointer. ATA nodes are never EngineeringMatter identities.';
COMMENT ON TABLE derived_summary_revision IS
  'Immutable candidate body, exact saved member work, coverage and transitive original evidence. No formal adoption.';
COMMIT;
