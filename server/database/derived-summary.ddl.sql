BEGIN;

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

-- Preserve the database's current WorkItem/Matter/document/acquisition branches
-- verbatim. Earlier migrations have extended this predicate several times.
DO $$ DECLARE prior text; BEGIN
  SELECT pg_get_expr(conbin, conrelid) INTO prior FROM pg_constraint
    WHERE conrelid = 'action_attempt'::regclass AND conname = 'ck_action_attempt_subject';
  IF prior IS NULL THEN RAISE EXCEPTION 'DERIVED_SUMMARY_SUBJECT_CONSTRAINT_MISSING'; END IF;
  IF position('DERIVED_SUMMARY' in prior) = 0 THEN
    ALTER TABLE action_attempt DROP CONSTRAINT ck_action_attempt_subject;
    EXECUTE 'ALTER TABLE action_attempt ADD CONSTRAINT ck_action_attempt_subject CHECK ((' || prior || ') OR (
      subject_kind = ''DERIVED_SUMMARY'' AND work_item_id IS NULL AND matter_id IS NULL
      AND matter_revision_id IS NULL AND document_version_id IS NULL AND summary_id IS NOT NULL
      AND action_type = ''OPENCLAW_DERIVED_SUMMARY'' AND input_revision IS NOT NULL AND base_revision IS NOT NULL))';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION derived_summary_attempt_owned(t varchar, actor varchar, s varchar)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
  SELECT actor = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(t)
    AND EXISTS (SELECT 1 FROM derived_summary h WHERE h.tenant_id=t AND h.summary_id=s AND h.actor_user_id=actor);
$$;
REVOKE ALL ON FUNCTION derived_summary_attempt_owned(varchar,varchar,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derived_summary_attempt_owned(varchar,varchar,varchar) TO authenticated,service_role;

-- Only the existing Hosted service may resolve the actor of an explicitly
-- delegated request, before entering that actor's ordinary RLS scope.
CREATE OR REPLACE FUNCTION derived_summary_runtime_actor(t varchar, s varchar, a varchar, principal varchar)
RETURNS varchar LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
  SELECT x.actor_user_id FROM action_attempt x JOIN derived_summary h
    ON h.tenant_id=x.tenant_id AND h.summary_id=x.summary_id AND h.actor_user_id=x.actor_user_id
  WHERE x.tenant_id=t AND x.summary_id=s AND x.operation_ref=a
    AND x.subject_kind='DERIVED_SUMMARY' AND x.action_type='OPENCLAW_DERIVED_SUMMARY'
    AND x.summary_delegated_principal_id=principal
    AND EXISTS (SELECT 1 FROM identity_subject_mapping m WHERE m.miaoda_user_id=x.actor_user_id
      AND m.miaoda_tenant_id=t AND m.expected_client_id='cli_aadde8b579f95bc9' AND m.status='ACTIVE');
$$;
REVOKE ALL ON FUNCTION derived_summary_runtime_actor(varchar,varchar,varchar,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derived_summary_runtime_actor(varchar,varchar,varchar,varchar) TO service_role;

-- Ordinary source RLS also governs saved task/body copies. Exact leaf work and
-- original carriers are retained in the Host reading snapshot, including upper summaries.
CREATE OR REPLACE FUNCTION derived_summary_reading_sources_owned(t varchar, actor varchar, reading jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE member jsonb; leaf jsonb; e jsonb; saved record;
BEGIN
  IF actor IS DISTINCT FROM current_setting('app.user_id', true)
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
REVOKE ALL ON FUNCTION derived_summary_reading_sources_owned(varchar,varchar,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derived_summary_reading_sources_owned(varchar,varchar,jsonb) TO authenticated,service_role;

DO $$ DECLARE p record; added text; BEGIN
  FOR p IN SELECT polname,pg_get_expr(polqual,polrelid) AS predicate,
      pg_get_expr(polwithcheck,polrelid) AS checks FROM pg_policy WHERE polrelid='action_attempt'::regclass
      AND polname IN ('action_attempt_matter_subject_boundary','action_attempt_matter_or_document_subject_boundary')
  LOOP
    added := '(subject_kind = ''DERIVED_SUMMARY'' AND derived_summary_attempt_owned(tenant_id,actor_user_id,summary_id))';
    EXECUTE format('CREATE POLICY %I ON action_attempt AS RESTRICTIVE FOR ALL TO authenticated,service_role USING ((%s) OR %s) WITH CHECK ((%s) OR %s)',
      p.polname || '_summary',p.predicate,added,COALESCE(p.checks,p.predicate),added);
    EXECUTE format('DROP POLICY %I ON action_attempt',p.polname);
  END LOOP;
END $$;
DROP POLICY IF EXISTS action_attempt_summary_subject_boundary ON action_attempt;
CREATE POLICY action_attempt_summary_subject_boundary ON action_attempt AS RESTRICTIVE FOR ALL TO authenticated,service_role
  USING (subject_kind <> 'DERIVED_SUMMARY' OR (derived_summary_attempt_owned(tenant_id,actor_user_id,summary_id)
    AND derived_summary_reading_sources_owned(tenant_id,actor_user_id,task_envelope_json::jsonb->'modelInput')))
  WITH CHECK (subject_kind <> 'DERIVED_SUMMARY' OR (derived_summary_attempt_owned(tenant_id,actor_user_id,summary_id)
    AND derived_summary_reading_sources_owned(tenant_id,actor_user_id,task_envelope_json::jsonb->'modelInput')));

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

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_derived_summary_current') THEN
    ALTER TABLE derived_summary ADD CONSTRAINT fk_derived_summary_current
      FOREIGN KEY (tenant_id, summary_id, current_summary_ref)
      REFERENCES derived_summary_revision(tenant_id, summary_id, summary_ref) DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_action_attempt_derived_summary') THEN
    ALTER TABLE action_attempt ADD CONSTRAINT fk_action_attempt_derived_summary
      FOREIGN KEY (tenant_id, summary_id) REFERENCES derived_summary(tenant_id, summary_id);
  END IF;
  -- Reapply this new subject boundary as well, so an earlier additive DDL
  -- execution cannot retain a weaker non-summary action branch.
  ALTER TABLE action_attempt DROP CONSTRAINT IF EXISTS ck_action_attempt_derived_summary;
  ALTER TABLE action_attempt ADD CONSTRAINT ck_action_attempt_derived_summary CHECK (
      (subject_kind = 'DERIVED_SUMMARY' AND summary_id IS NOT NULL AND work_item_id IS NULL
        AND matter_id IS NULL AND matter_revision_id IS NULL AND document_version_id IS NULL
        AND action_type = 'OPENCLAW_DERIVED_SUMMARY' AND summary_request_command_json IS NOT NULL
        AND summary_delegated_principal_id IS NOT NULL)
      OR (subject_kind <> 'DERIVED_SUMMARY' AND summary_id IS NULL
        AND action_type <> 'OPENCLAW_DERIVED_SUMMARY')
    );
END $$;

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
DROP POLICY IF EXISTS derived_summary_owner_boundary ON derived_summary;
CREATE POLICY derived_summary_owner_boundary ON derived_summary AS RESTRICTIVE FOR ALL TO authenticated,service_role
  USING (actor_user_id=current_setting('app.user_id',true) AND engineering_matter_actor_has_tenant(tenant_id))
  WITH CHECK (actor_user_id=current_setting('app.user_id',true) AND engineering_matter_actor_has_tenant(tenant_id));
DROP POLICY IF EXISTS derived_summary_revision_actor_read ON derived_summary_revision;
CREATE POLICY derived_summary_revision_actor_read ON derived_summary_revision FOR SELECT TO authenticated
  USING (actor_user_id = current_setting('app.user_id', true));
DROP POLICY IF EXISTS derived_summary_revision_actor_insert ON derived_summary_revision;
DROP POLICY IF EXISTS derived_summary_revision_service ON derived_summary_revision;
CREATE POLICY derived_summary_revision_service ON derived_summary_revision TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS derived_summary_revision_sources ON derived_summary_revision;
CREATE POLICY derived_summary_revision_sources ON derived_summary_revision AS RESTRICTIVE FOR ALL TO authenticated,service_role
  USING (derived_summary_reading_sources_owned(tenant_id,actor_user_id,content_json))
  WITH CHECK (derived_summary_reading_sources_owned(tenant_id,actor_user_id,content_json));
DROP POLICY IF EXISTS derived_summary_revision_real_attempt ON derived_summary_revision;
CREATE POLICY derived_summary_revision_real_attempt ON derived_summary_revision AS RESTRICTIVE FOR INSERT TO authenticated,service_role
  WITH CHECK (actor_user_id=current_setting('app.user_id',true) AND EXISTS (
    SELECT 1 FROM action_attempt a WHERE a.attempt_id=derived_summary_revision.attempt_id
      AND a.tenant_id=derived_summary_revision.tenant_id AND a.summary_id=derived_summary_revision.summary_id
      AND a.actor_user_id=derived_summary_revision.actor_user_id AND a.subject_kind='DERIVED_SUMMARY'
      AND a.action_type='OPENCLAW_DERIVED_SUMMARY' AND a.status='RUNNING' AND a.cancel_requested_at IS NULL
      AND a.lease_token IS NOT NULL AND a.lease_expires_at>CURRENT_TIMESTAMP AND a.deadline_at>CURRENT_TIMESTAMP
      AND a.base_revision+1=derived_summary_revision.revision AND a.trigger_request_id=derived_summary_revision.request_id
  ));

GRANT SELECT, INSERT, UPDATE ON derived_summary TO authenticated, service_role;
GRANT SELECT ON derived_summary_revision TO authenticated;
GRANT SELECT, INSERT ON derived_summary_revision TO service_role;
COMMENT ON COLUMN derived_summary.scope_json IS '@type import("@shared/derived-summary.interface").DerivedSummaryScopeSelection';
COMMENT ON COLUMN derived_summary.members_json IS '@type import("@shared/derived-summary.interface").DerivedSummaryMember[]';
COMMENT ON COLUMN derived_summary_revision.content_json IS '@type import("@shared/derived-summary.interface").DerivedSummaryRevision';
COMMENT ON TABLE derived_summary IS
  'Explicit candidate aggregate scope and current pointer. ATA nodes are never EngineeringMatter identities.';
COMMENT ON TABLE derived_summary_revision IS
  'Immutable candidate body, exact saved member work, coverage and transitive original evidence. No formal adoption.';
COMMIT;
