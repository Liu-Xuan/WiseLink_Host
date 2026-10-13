BEGIN;
-- @hierarchical-wiki:prepare-required
DO $wiki_prepare$ BEGIN RAISE EXCEPTION 'WIKI_DDL_PREPARE_REQUIRED' USING ERRCODE='42501'; END $wiki_prepare$;
-- Same role-boundary helper as DerivedSummary. No shared tenant Wiki is introduced.
CREATE TABLE hierarchical_wiki_scope (
  wiki_id varchar(96) PRIMARY KEY,
  summary_id varchar(96) NOT NULL UNIQUE REFERENCES derived_summary(summary_id),
  tenant_id varchar(128) NOT NULL,
  actor_user_id varchar(255) NOT NULL,
  scope_key text NOT NULL,
  scope_json jsonb NOT NULL,
  parent_wiki_id varchar(96) REFERENCES hierarchical_wiki_scope(wiki_id),
  delegated_principal_id varchar(160) NOT NULL,
  model_ref varchar(128) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  state_json jsonb NOT NULL,
  last_event_seq bigint NOT NULL DEFAULT 0,
  last_inventory_at timestamptz,
  inventory_cursor text,
  upstream_delegations_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(upstream_delegations_json)='object'),
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT CASE WHEN current_setting('app.user_id',true)='' THEN NULL
    ELSE concat('(',current_setting('app.user_id',true),')')::user_profile END,
  _updated_by user_profile DEFAULT CASE WHEN current_setting('app.user_id',true)='' THEN NULL
    ELSE concat('(',current_setting('app.user_id',true),')')::user_profile END,
  UNIQUE (tenant_id,actor_user_id,scope_key),
  CHECK (jsonb_typeof(state_json)='object' AND state_json->>'schemaVersion'='1'),
  CHECK (jsonb_typeof(scope_json)='object')
);
CREATE TABLE hierarchical_wiki_membership (
  wiki_id varchar(96) NOT NULL REFERENCES hierarchical_wiki_scope(wiki_id),
  tenant_id varchar(128) NOT NULL,
  actor_user_id varchar(255) NOT NULL,
  member_key text NOT NULL,
  source_kind varchar(16) NOT NULL CHECK (source_kind IN ('DOCUMENT','MATTER','WORK_ITEM','SUMMARY')),
  source_id varchar(96) NOT NULL,
  member_json jsonb NOT NULL,
  basis_json jsonb NOT NULL,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT CASE WHEN current_setting('app.user_id',true)='' THEN NULL
    ELSE concat('(',current_setting('app.user_id',true),')')::user_profile END,
  _updated_by user_profile DEFAULT CASE WHEN current_setting('app.user_id',true)='' THEN NULL
    ELSE concat('(',current_setting('app.user_id',true),')')::user_profile END,
  PRIMARY KEY (wiki_id,member_key),
  CHECK (jsonb_typeof(member_json)='object' AND jsonb_typeof(basis_json)='object')
);
-- Minimal durable journal required to keep source-save locks separate from Wiki
-- reservation locks. Contains exact identities only, never another source body.
CREATE TABLE hierarchical_wiki_change (
  seq bigserial PRIMARY KEY,
  tenant_id varchar(128) NOT NULL,
  actor_user_id varchar(255) NOT NULL,
  kind varchar(16) NOT NULL CHECK (kind IN ('DOCUMENT','MATTER','WORK_ITEM','SUMMARY')),
  subject_id varchar(96) NOT NULL,
  version_ref varchar(160) NOT NULL,
  important boolean NOT NULL DEFAULT false,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT CASE WHEN current_setting('app.user_id',true)='' THEN NULL
    ELSE concat('(',current_setting('app.user_id',true),')')::user_profile END,
  _updated_by user_profile DEFAULT CASE WHEN current_setting('app.user_id',true)='' THEN NULL
    ELSE concat('(',current_setting('app.user_id',true),')')::user_profile END,
  UNIQUE (tenant_id,kind,subject_id,version_ref)
);
CREATE INDEX hierarchical_wiki_change_tenant_seq ON hierarchical_wiki_change(tenant_id,seq);
CREATE INDEX hierarchical_wiki_membership_source ON hierarchical_wiki_membership(tenant_id,actor_user_id,source_kind,source_id);

ALTER TABLE hierarchical_wiki_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE hierarchical_wiki_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE hierarchical_wiki_change ENABLE ROW LEVEL SECURITY;
CREATE POLICY wiki_scope_owner ON hierarchical_wiki_scope AS RESTRICTIVE FOR ALL TO authenticated,service_role,anon
  USING (derived_summary_sql_role_allowed(false) AND actor_user_id=current_setting('app.user_id',true)
    AND engineering_matter_actor_has_tenant(tenant_id))
  WITH CHECK (derived_summary_sql_role_allowed(false) AND actor_user_id=current_setting('app.user_id',true)
    AND engineering_matter_actor_has_tenant(tenant_id)
    AND derived_summary_attempt_owned(tenant_id,actor_user_id,summary_id));
CREATE POLICY wiki_scope_crud ON hierarchical_wiki_scope FOR ALL TO authenticated,service_role USING(true) WITH CHECK(true);
CREATE POLICY wiki_scope_no_delete ON hierarchical_wiki_scope AS RESTRICTIVE FOR DELETE TO authenticated,service_role,anon USING(false);
CREATE POLICY wiki_membership_owner ON hierarchical_wiki_membership AS RESTRICTIVE FOR ALL TO authenticated,service_role,anon
  USING (actor_user_id=current_setting('app.user_id',true) AND engineering_matter_actor_has_tenant(tenant_id)
    AND EXISTS (SELECT 1 FROM hierarchical_wiki_scope w WHERE w.wiki_id=hierarchical_wiki_membership.wiki_id
      AND w.tenant_id=hierarchical_wiki_membership.tenant_id AND w.actor_user_id=hierarchical_wiki_membership.actor_user_id))
  WITH CHECK (actor_user_id=current_setting('app.user_id',true) AND engineering_matter_actor_has_tenant(tenant_id)
    AND EXISTS (SELECT 1 FROM hierarchical_wiki_scope w WHERE w.wiki_id=hierarchical_wiki_membership.wiki_id
      AND w.tenant_id=hierarchical_wiki_membership.tenant_id AND w.actor_user_id=hierarchical_wiki_membership.actor_user_id));
CREATE POLICY wiki_membership_crud ON hierarchical_wiki_membership FOR ALL TO authenticated,service_role USING(true) WITH CHECK(true);
CREATE POLICY wiki_change_read ON hierarchical_wiki_change AS RESTRICTIVE FOR SELECT TO authenticated,service_role,anon
  USING (derived_summary_sql_role_allowed(false) AND engineering_matter_actor_has_tenant(tenant_id)
    AND CASE kind WHEN 'DOCUMENT' THEN engineering_matter_document_owned_by_actor(tenant_id,subject_id)
      WHEN 'MATTER' THEN engineering_matter_owned_by_actor(tenant_id,subject_id)
      WHEN 'WORK_ITEM' THEN engineering_matter_work_item_owned_by_actor(tenant_id,subject_id)
      WHEN 'SUMMARY' THEN derived_summary_attempt_owned(tenant_id,current_setting('app.user_id',true)::varchar,subject_id)
      ELSE false END);
CREATE POLICY wiki_change_insert ON hierarchical_wiki_change AS RESTRICTIVE FOR INSERT TO authenticated,service_role,anon
  WITH CHECK (derived_summary_sql_role_allowed(false) AND actor_user_id=current_setting('app.user_id',true)
    AND engineering_matter_actor_has_tenant(tenant_id));
CREATE POLICY wiki_change_crud ON hierarchical_wiki_change FOR ALL TO authenticated,service_role USING(true) WITH CHECK(true);
CREATE POLICY wiki_change_no_update ON hierarchical_wiki_change AS RESTRICTIVE FOR UPDATE TO authenticated,service_role,anon USING (false);
CREATE POLICY wiki_change_no_delete ON hierarchical_wiki_change AS RESTRICTIVE FOR DELETE TO authenticated,service_role,anon USING (false);
CREATE FUNCTION hierarchical_wiki_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'WIKI_TRUNCATE_FORBIDDEN' USING ERRCODE='42501'; END $$;
CREATE TRIGGER hierarchical_wiki_scope_no_truncate BEFORE TRUNCATE ON hierarchical_wiki_scope
  FOR EACH STATEMENT EXECUTE FUNCTION hierarchical_wiki_no_truncate();
CREATE TRIGGER hierarchical_wiki_membership_no_truncate BEFORE TRUNCATE ON hierarchical_wiki_membership
  FOR EACH STATEMENT EXECUTE FUNCTION hierarchical_wiki_no_truncate();
CREATE TRIGGER hierarchical_wiki_change_no_truncate BEFORE TRUNCATE ON hierarchical_wiki_change
  FOR EACH STATEMENT EXECUTE FUNCTION hierarchical_wiki_no_truncate();

CREATE FUNCTION hierarchical_wiki_runtime_owners(t varchar,principal varchar)
RETURNS TABLE(actor_user_id varchar) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT derived_summary_sql_role_allowed(true) OR principal IS NULL OR principal='' THEN
    RAISE EXCEPTION 'WIKI_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT w.actor_user_id FROM hierarchical_wiki_scope w
    WHERE w.tenant_id=t AND w.delegated_principal_id=principal AND w.enabled
      AND EXISTS (SELECT 1 FROM identity_subject_mapping m WHERE m.miaoda_tenant_id=t
        AND m.miaoda_user_id=w.actor_user_id AND m.expected_client_id='cli_aadde8b579f95bc9' AND m.status='ACTIVE')
    GROUP BY w.actor_user_id ORDER BY min(w._updated_at),w.actor_user_id;
END $$;
-- Separate engineering-analysis consent: a Wiki classification alone cannot
-- authorize a Matter evaluation. Resolve only the stored owner and exact auto
-- attempt; callers never supply an actor or tenant override.
CREATE FUNCTION hierarchical_wiki_matter_actor(t varchar,principal varchar,matter varchar,attempt varchar,allow_closed boolean)
RETURNS varchar LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE actor varchar;
BEGIN
  IF NOT derived_summary_sql_role_allowed(true) THEN
    RAISE EXCEPTION 'WIKI_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT w.actor_user_id INTO actor FROM hierarchical_wiki_scope w
  WHERE w.tenant_id=t AND w.delegated_principal_id=principal AND w.scope_json->>'kind'='FLEET'
    AND w.upstream_delegations_json ? matter
    AND (allow_closed OR (w.enabled AND w.upstream_delegations_json->matter->>'enabled'='true'))
    AND EXISTS (SELECT 1 FROM identity_subject_mapping m WHERE m.miaoda_tenant_id=t
      AND m.miaoda_user_id=w.actor_user_id AND m.expected_client_id='cli_aadde8b579f95bc9' AND m.status='ACTIVE')
    AND (allow_closed OR EXISTS (SELECT 1 FROM hierarchical_wiki_membership l JOIN hierarchical_wiki_scope s ON s.wiki_id=l.wiki_id
      WHERE s.tenant_id=t AND s.actor_user_id=w.actor_user_id AND s.scope_json->>'fleetFamilyId'=w.scope_json->>'fleetFamilyId'
        AND s.scope_json->'fleetModelIds'=w.scope_json->'fleetModelIds' AND l.source_kind='MATTER' AND l.source_id=matter
        AND l.basis_json->>'classificationStatus'='CONFIRMED'))
    AND (attempt IS NULL OR EXISTS (SELECT 1 FROM action_attempt a WHERE a.tenant_id=t AND a.actor_user_id=w.actor_user_id
      AND a.matter_id=matter AND a.operation_ref=attempt AND a.subject_kind='ENGINEERING_MATTER'
      AND a.action_type='OPENCLAW_MATTER_ASSESSMENT' AND a.request_origin='OPENCLAW_MCP_V1'
      AND (a.idempotency_key LIKE 'matter-auto:%' OR a.idempotency_key LIKE 'matter-revisit:%')))
  ORDER BY w.wiki_id LIMIT 1;
  RETURN actor;
END $$;
REVOKE ALL ON FUNCTION hierarchical_wiki_runtime_owners(varchar,varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION hierarchical_wiki_matter_actor(varchar,varchar,varchar,varchar,boolean) FROM PUBLIC;
-- Only queue control metadata is available after source revocation. This never
-- returns a task, work body or source. A logical CANCEL does not prove provider
-- termination; the native durable pointer independently requires that proof.
CREATE FUNCTION hierarchical_wiki_cleanup(t varchar,principal varchar,kind varchar,subject varchar,attempt varchar,operation varchar)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE actor varchar; a action_attempt; cancel_result varchar;
BEGIN
  IF NOT derived_summary_sql_role_allowed(true) OR operation NOT IN ('STATUS','CANCEL') THEN
    RAISE EXCEPTION 'WIKI_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF kind='MATTER' THEN actor:=hierarchical_wiki_matter_actor(t,principal,subject,attempt,true);
  ELSIF kind='SUMMARY' THEN
    SELECT w.actor_user_id INTO actor FROM hierarchical_wiki_scope w JOIN action_attempt x ON x.summary_id=w.summary_id
      AND x.tenant_id=w.tenant_id AND x.actor_user_id=w.actor_user_id
    WHERE w.tenant_id=t AND w.summary_id=subject AND w.delegated_principal_id=principal
      AND x.operation_ref=attempt AND x.subject_kind='DERIVED_SUMMARY' AND x.action_type='OPENCLAW_DERIVED_SUMMARY'
      AND x.summary_delegated_principal_id=principal AND x.trigger_request_id LIKE 'wiki-%'
      AND EXISTS(SELECT 1 FROM identity_subject_mapping m WHERE m.miaoda_tenant_id=t AND m.miaoda_user_id=w.actor_user_id
        AND m.expected_client_id='cli_aadde8b579f95bc9' AND m.status='ACTIVE');
  END IF;
  IF actor IS NULL THEN RAISE EXCEPTION 'WIKI_ATTEMPT_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM action_attempt x WHERE x.tenant_id=t AND x.actor_user_id=actor AND x.operation_ref=attempt
    AND ((kind='MATTER' AND x.matter_id=subject) OR (kind='SUMMARY' AND x.summary_id=subject)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WIKI_ATTEMPT_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  IF operation='CANCEL' AND (a.status='COMMITTING' OR a.commit_started_at IS NOT NULL) THEN
    cancel_result:='TOO_LATE';
  ELSIF operation='CANCEL' AND a.status IN ('QUEUED','RUNNING','RETRY_SCHEDULED') THEN
    UPDATE action_attempt SET status='CANCELLED',cancel_requested_at=CURRENT_TIMESTAMP,completed_at=CURRENT_TIMESTAMP,
      lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,lease_slot=NULL,error_code='WIKI_AUTOMATIC_CANCELLED',
      terminal_reason='WIKI_AUTOMATIC_CANCELLED',updated_at=CURRENT_TIMESTAMP WHERE attempt_id=a.attempt_id;
    a.status:='CANCELLED'; a.error_code:='WIKI_AUTOMATIC_CANCELLED';
    cancel_result:='CANCELLED';
  ELSIF operation='CANCEL' THEN
    cancel_result:='NOT_ACTIVE';
  END IF;
  RETURN jsonb_build_object('status',a.status,'attemptRef',attempt,'errorCode',a.error_code,
    'cancelResult',cancel_result,CASE kind WHEN 'MATTER' THEN 'matterId' ELSE 'summaryId' END,subject,'savedSummaryRefs','[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION hierarchical_wiki_cleanup(varchar,varchar,varchar,varchar,varchar,varchar) FROM PUBLIC;
-- @hierarchical-wiki:runtime-acl:start
-- Preparation emits portable top-level GRANTs to the actual service SQL role.
-- @hierarchical-wiki:runtime-acl:end
COMMIT;
