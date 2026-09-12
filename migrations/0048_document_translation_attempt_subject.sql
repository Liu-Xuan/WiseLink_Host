BEGIN;
-- Independent document translation uses the existing ActionAttempt lease.
-- It cannot claim a WorkItem identity or borrow a Matter's authorization.
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
    AND action_type = 'DOCUMENT_TRANSLATE' AND execution_model_json IS NULL)
);
CREATE UNIQUE INDEX uk_dm_parse_exact_subject ON dm_document_parse_run(tenant_id, document_version_id, parse_run_id);
-- producer_run_id also stores legacy producer identities, so a whole-table FK
-- would incorrectly constrain unrelated WorkItem runs.
CREATE FUNCTION action_attempt_check_document_original() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.subject_kind = 'DOCUMENT_VERSION' AND NOT EXISTS (
    SELECT 1 FROM dm_document_parse_run p WHERE p.tenant_id=NEW.tenant_id
      AND p.document_version_id=NEW.document_version_id AND p.parse_run_id=NEW.producer_run_id
      AND p.parse_revision=NEW.input_revision AND p.status='PUBLISHED'
  ) THEN
    RAISE EXCEPTION 'DOCUMENT_TRANSLATION_ORIGINAL_NOT_PUBLISHED' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER action_attempt_check_document_original BEFORE INSERT OR UPDATE ON action_attempt
  FOR EACH ROW EXECUTE FUNCTION action_attempt_check_document_original();
CREATE UNIQUE INDEX uk_action_attempt_document_number
  ON action_attempt(tenant_id, document_version_id, action_type, attempt_no)
  WHERE subject_kind = 'DOCUMENT_VERSION';
CREATE UNIQUE INDEX uk_action_attempt_active_document_task
  ON action_attempt(tenant_id, document_version_id, action_type)
  WHERE subject_kind = 'DOCUMENT_VERSION' AND status IN ('QUEUED','RUNNING','RETRY_SCHEDULED','COMMITTING');

CREATE FUNCTION action_attempt_preserve_document_subject() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.subject_kind = 'DOCUMENT_VERSION' OR NEW.subject_kind = 'DOCUMENT_VERSION')
    AND ROW(OLD.subject_kind, OLD.tenant_id, OLD.actor_user_id, OLD.work_item_id,
      OLD.matter_id, OLD.matter_revision_id, OLD.document_version_id, OLD.producer_run_id,
      OLD.input_revision, OLD.action_type, OLD.task_envelope_json, OLD.task_input_hash)
      IS DISTINCT FROM ROW(NEW.subject_kind, NEW.tenant_id, NEW.actor_user_id, NEW.work_item_id,
      NEW.matter_id, NEW.matter_revision_id, NEW.document_version_id, NEW.producer_run_id,
      NEW.input_revision, NEW.action_type, NEW.task_envelope_json, NEW.task_input_hash) THEN
    RAISE EXCEPTION 'ACTION_ATTEMPT_SUBJECT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER action_attempt_preserve_document_subject BEFORE UPDATE ON action_attempt
  FOR EACH ROW EXECUTE FUNCTION action_attempt_preserve_document_subject();

-- Keep the existing Matter predicate exactly; the separate restrictive policy
-- below governs document subjects even where a broad platform policy exists.
ALTER POLICY action_attempt_matter_subject_boundary ON action_attempt USING (
  subject_kind IN ('WORK_ITEM', 'DOCUMENT_VERSION') OR (
    actor_user_id = current_setting('app.user_id', true)
    AND engineering_matter_actor_has_tenant(tenant_id)
    AND engineering_matter_owned_by_actor(tenant_id, matter_id)
    AND engineering_matter_all_links_owned_by_actor(tenant_id, matter_revision_id)
    AND EXISTS (SELECT 1 FROM engineering_matter m WHERE m.tenant_id = action_attempt.tenant_id
      AND m.matter_id = action_attempt.matter_id
      AND engineering_matter_all_links_owned_by_actor(m.tenant_id, m.current_matter_revision_id))
  )
);
CREATE FUNCTION document_translation_attempt_owned(t varchar, actor varchar, dv varchar, pr varchar, revision integer)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT actor = current_setting('app.user_id', true)
    AND engineering_matter_actor_has_tenant(t)
    AND engineering_matter_document_owned_by_actor(t, dv)
    AND EXISTS (SELECT 1 FROM dm_document_parse_run p
      WHERE p.tenant_id=t AND p.document_version_id=dv AND p.parse_run_id=pr
        AND p.parse_revision=revision AND p.status='PUBLISHED'
        AND p.manifest_artifact @> '{"role":"MANIFEST","relativePath":"original/manifest.json","readback":"VERIFIED"}'::jsonb);
$$;
CREATE POLICY action_attempt_document_subject_boundary ON action_attempt AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (subject_kind <> 'DOCUMENT_VERSION' OR
    document_translation_attempt_owned(tenant_id,actor_user_id,document_version_id,producer_run_id,input_revision));
CREATE POLICY action_attempt_document_read ON action_attempt FOR SELECT TO authenticated, service_role
  USING (subject_kind='DOCUMENT_VERSION' AND
    document_translation_attempt_owned(tenant_id,actor_user_id,document_version_id,producer_run_id,input_revision));
CREATE POLICY action_attempt_document_actor ON action_attempt FOR ALL TO service_role
  USING (subject_kind='DOCUMENT_VERSION' AND
    document_translation_attempt_owned(tenant_id,actor_user_id,document_version_id,producer_run_id,input_revision))
  WITH CHECK (subject_kind='DOCUMENT_VERSION' AND
    document_translation_attempt_owned(tenant_id,actor_user_id,document_version_id,producer_run_id,input_revision));
CREATE POLICY action_attempt_document_no_native_insert ON action_attempt AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (subject_kind <> 'DOCUMENT_VERSION');
CREATE POLICY action_attempt_document_no_native_update ON action_attempt AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (subject_kind <> 'DOCUMENT_VERSION') WITH CHECK (subject_kind <> 'DOCUMENT_VERSION');
CREATE POLICY action_attempt_document_no_native_delete ON action_attempt AS RESTRICTIVE FOR DELETE TO authenticated
  USING (subject_kind <> 'DOCUMENT_VERSION');
COMMIT;
