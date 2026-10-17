-- CANDIDATE ONLY. Not executed. Source approval/configuration requires a separate authorized batch.
-- No Source rows, grants, credentials, broad role grants or new receipt channel are created here.
BEGIN;
CREATE TABLE tdms_source_receiver (
  receiver_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  application_scope_id text NOT NULL,
  source_key text NOT NULL CHECK (source_key = 'TDMS'),
  source_instance_id text NOT NULL,
  scope_id text NOT NULL,
  source_subject_namespace text NOT NULL,
  source_subject_id text NOT NULL,
  authority_ref text NOT NULL,
  authority_revision text NOT NULL,
  authority_evidence_ref text NOT NULL,
  approved_by_subject text NOT NULL,
  approved_at timestamptz NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  revoked_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (valid_until > valid_from),
  CHECK ((status = 'ACTIVE' AND revoked_at IS NULL) OR (status = 'REVOKED' AND revoked_at IS NOT NULL)),
  UNIQUE (tenant_id,application_scope_id,source_key,source_instance_id,scope_id)
);
CREATE TABLE tdms_source_receiver_grant (
  receiver_id text NOT NULL REFERENCES tdms_source_receiver(receiver_id),
  actor_subject_id text NOT NULL,
  source_subject_namespace text NOT NULL,
  source_subject_id text NOT NULL,
  permission_revision text NOT NULL,
  authority_evidence_ref text NOT NULL,
  approved_by_subject text NOT NULL,
  approved_at timestamptz NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  revoked_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  -- IMPORT/CATALOGUE/READ_RECORD/READ_HISTORY/READ_RELATIONS have independent
  -- current decisions: allowed, authorityRef/Revision/EvidenceRef, approvedBySubject,
  -- validFrom/validUntil, purpose, captureRetentionAllowed/nativeProjectionAllowed
  -- or retainedCaptureReadAllowed, and exact permittedMembers. Missing = denied.
  actions_json jsonb NOT NULL CHECK (jsonb_typeof(actions_json) = 'object'),
  CHECK (valid_until > valid_from),
  CHECK ((status = 'ACTIVE' AND revoked_at IS NULL) OR (status = 'REVOKED' AND revoked_at IS NOT NULL)),
  PRIMARY KEY(receiver_id,actor_subject_id)
);
CREATE FUNCTION tdms_receiver_guard_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Same receiver key as the Host's short commit-time shared lock. Collisions
  -- can only serialize unrelated grants; no hash is used as a Source identity.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('wiselink:tdms-receiver:' || OLD.receiver_id,0));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.receiver_id IS DISTINCT FROM OLD.receiver_id THEN
    RAISE EXCEPTION 'TDMS_RECEIVER_ID_IMMUTABLE';
  END IF;
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tdms_receiver_revision BEFORE UPDATE OR DELETE ON tdms_source_receiver
  FOR EACH ROW EXECUTE FUNCTION tdms_receiver_guard_change();
CREATE TRIGGER tdms_receiver_grant_revision BEFORE UPDATE OR DELETE ON tdms_source_receiver_grant
  FOR EACH ROW EXECUTE FUNCTION tdms_receiver_guard_change();
CREATE TABLE tdms_upload_selection_association (
  tenant_id text NOT NULL,
  application_scope_id text NOT NULL,
  actor_subject_id text NOT NULL,
  source_key text NOT NULL CHECK (source_key='TDMS'),
  source_instance_id text NOT NULL,
  scope_id text NOT NULL,
  request_id text NOT NULL,
  binding_id text NOT NULL,
  receiver_id text NOT NULL REFERENCES tdms_source_receiver(receiver_id),
  receiver_revision integer NOT NULL,
  grant_revision integer NOT NULL,
  permission_revision text NOT NULL,
  package_id text NOT NULL,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  member_claims_json jsonb NOT NULL CHECK (jsonb_typeof(member_claims_json)='object'),
  data_json jsonb NOT NULL CHECK (jsonb_typeof(data_json)='object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((data_json->>'receiverId'=receiver_id
    AND (data_json->>'receiverRevision')::integer=receiver_revision
    AND (data_json->>'grantRevision')::integer=grant_revision
    AND data_json->>'permissionRevision'=permission_revision
    AND data_json->>'payloadDigest'=payload_digest AND data_json->>'packageId'=package_id
    AND data_json->'memberClaims'=member_claims_json
    AND data_json->'scope'=jsonb_build_object('tenantId',tenant_id,'sourceKey',source_key,
      'sourceInstanceId',source_instance_id,'scopeId',scope_id)
    AND data_json->>'applicationScopeId'=application_scope_id AND data_json->>'actorSubjectId'=actor_subject_id
    AND data_json#>>'{receipt,requestId}'=request_id AND data_json#>>'{receipt,bindingId}'=binding_id
    AND data_json#>>'{receipt,receiverId}'=receiver_id AND data_json#>>'{receipt,packageId}'=package_id
    AND data_json#>>'{receipt,payloadDigest}'=payload_digest
    AND data_json#>>'{receipt,status}'='STAGED_CANDIDATE'
    AND data_json#>'{receipt,documentVersionId}'='null'::jsonb
    AND data_json#>'{receipt,readbackVerified}'='true'::jsonb
    AND data_json#>>'{observation,bindingId}'=binding_id
    AND data_json#>>'{artifact,memberId}'=binding_id
    AND data_json#>'{artifact,selection}'=data_json#>'{receipt,selection}'
    AND data_json#>>'{artifact,sha256}'=data_json#>>'{observation,blobSha256}'
    AND data_json#>'{artifact,byteLength}'=data_json#>'{observation,byteLength}'
    AND data_json#>>'{artifact,sourceAttachmentId}'=data_json#>>'{observation,sourceAttachmentId}'
    AND data_json#>>'{receipt,sha256}'=data_json#>>'{artifact,sha256}'
    AND data_json#>'{receipt,byteLength}'=data_json#>'{artifact,byteLength}'
    AND data_json#>>'{receipt,ownerSnapshotId}'=data_json#>>'{observation,ownerSnapshotId}'
    AND data_json#>>'{receipt,sourceAttachmentId}'=data_json#>>'{observation,sourceAttachmentId}') IS TRUE),
  PRIMARY KEY(tenant_id,application_scope_id,actor_subject_id,source_key,source_instance_id,scope_id,request_id,binding_id)
);
ALTER TABLE tdms_source_receiver ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdms_source_receiver FORCE ROW LEVEL SECURITY;
ALTER TABLE tdms_source_receiver_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdms_source_receiver_grant FORCE ROW LEVEL SECURITY;
ALTER TABLE tdms_upload_selection_association ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdms_upload_selection_association FORCE ROW LEVEL SECURITY;
-- Match the existing server member check: record/relation sets are contained;
-- attachment identity is exact (including metadataOnly), and owners may narrow.
-- A metadata-only grant cannot admit a retained full attachment by JSON subset.
CREATE FUNCTION tdms_receiver_members_cover(permitted jsonb, requested jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(permitted)='object' AND jsonb_typeof(requested)='object'
  AND jsonb_typeof(permitted->'records')='array' AND jsonb_typeof(requested->'records')='array'
  AND jsonb_typeof(permitted->'artifacts')='array' AND jsonb_typeof(requested->'artifacts')='array'
  AND jsonb_typeof(permitted->'relationIds')='array' AND jsonb_typeof(requested->'relationIds')='array'
 THEN
  COALESCE(permitted->'relatedDocumentVersionIds','[]'::jsonb)='[]'::jsonb
  AND COALESCE(requested->'relatedDocumentVersionIds','[]'::jsonb)='[]'::jsonb
  AND (permitted->'records') @> (requested->'records')
  AND (permitted->'relationIds') @> (requested->'relationIds')
  AND NOT EXISTS (
   SELECT 1 FROM jsonb_array_elements(requested->'artifacts') wanted
   WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(permitted->'artifacts') allowed
    WHERE CASE WHEN jsonb_typeof(wanted.value)='object' AND jsonb_typeof(allowed.value)='object'
     THEN (allowed.value-'owners')=(wanted.value-'owners')
     AND CASE WHEN jsonb_typeof(allowed.value->'owners')='array'
      AND jsonb_typeof(wanted.value->'owners')='array'
      THEN jsonb_array_length(wanted.value->'owners')>0
       AND (allowed.value->'owners') @> (wanted.value->'owners')
      ELSE false END
     ELSE false END
   )
  )
 ELSE false END
$$;
-- Runtime may read only its own preconfigured Source grant; there are deliberately
-- no application INSERT/UPDATE/DELETE policies for Source registration or approval.
CREATE POLICY tdms_receiver_grant_actor_read ON tdms_source_receiver_grant FOR SELECT
 USING (actor_subject_id=current_setting('app.user_id',true));
CREATE POLICY tdms_receiver_actor_read ON tdms_source_receiver FOR SELECT
 USING (EXISTS (SELECT 1 FROM tdms_source_receiver_grant g WHERE g.receiver_id=tdms_source_receiver.receiver_id
  AND g.actor_subject_id=current_setting('app.user_id',true)));
CREATE POLICY tdms_selection_actor_read ON tdms_upload_selection_association FOR SELECT USING (
 actor_subject_id=current_setting('app.user_id',true) AND EXISTS (
  SELECT 1 FROM tdms_source_receiver r JOIN tdms_source_receiver_grant g USING(receiver_id)
  WHERE r.receiver_id=tdms_upload_selection_association.receiver_id
   AND r.tenant_id=tdms_upload_selection_association.tenant_id
   AND r.application_scope_id=tdms_upload_selection_association.application_scope_id
   AND r.source_key=tdms_upload_selection_association.source_key
   AND r.source_instance_id=tdms_upload_selection_association.source_instance_id
   AND r.scope_id=tdms_upload_selection_association.scope_id
   AND g.actor_subject_id=tdms_upload_selection_association.actor_subject_id
   AND r.source_subject_namespace=g.source_subject_namespace AND r.source_subject_id=g.source_subject_id
   AND r.status='ACTIVE' AND g.status='ACTIVE' AND r.revoked_at IS NULL AND g.revoked_at IS NULL
   AND r.valid_from<=clock_timestamp() AND r.valid_until>clock_timestamp()
   AND g.valid_from<=clock_timestamp() AND g.valid_until>clock_timestamp()
   AND g.actions_json#>>'{IMPORT,allowed}'='true'
   AND g.actions_json#>>'{READ_RECORD,allowed}'='true'
   AND g.actions_json#>>'{IMPORT,captureRetentionAllowed}'='true'
   AND g.actions_json#>>'{IMPORT,nativeProjectionAllowed}'='true'
   AND g.actions_json#>>'{READ_RECORD,retainedCaptureReadAllowed}'='true'
   AND (g.actions_json#>>'{IMPORT,validFrom}')::timestamptz<=clock_timestamp()
   AND (g.actions_json#>>'{IMPORT,validUntil}')::timestamptz>clock_timestamp()
   AND (g.actions_json#>>'{READ_RECORD,validFrom}')::timestamptz<=clock_timestamp()
   AND (g.actions_json#>>'{READ_RECORD,validUntil}')::timestamptz>clock_timestamp()
   AND tdms_receiver_members_cover(g.actions_json#>'{READ_RECORD,permittedMembers}',
     tdms_upload_selection_association.member_claims_json)
 ));
-- Only the existing verified Host service SQL scope may persist server-verified facts.
-- Authenticated callers receive no insert policy, even if table privileges exist.
CREATE POLICY tdms_selection_host_insert ON tdms_upload_selection_association FOR INSERT TO service_role WITH CHECK (
 actor_subject_id=current_setting('app.user_id',true) AND EXISTS (
  SELECT 1 FROM tdms_source_receiver r JOIN tdms_source_receiver_grant g USING(receiver_id)
  WHERE r.receiver_id=tdms_upload_selection_association.receiver_id
   AND r.tenant_id=tdms_upload_selection_association.tenant_id
   AND r.application_scope_id=tdms_upload_selection_association.application_scope_id
   AND r.source_key=tdms_upload_selection_association.source_key
   AND r.source_instance_id=tdms_upload_selection_association.source_instance_id
   AND r.scope_id=tdms_upload_selection_association.scope_id
   AND g.actor_subject_id=tdms_upload_selection_association.actor_subject_id
   AND r.source_subject_namespace=g.source_subject_namespace AND r.source_subject_id=g.source_subject_id
   AND r.revision=tdms_upload_selection_association.receiver_revision
   AND g.revision=tdms_upload_selection_association.grant_revision
   AND r.status='ACTIVE' AND g.status='ACTIVE' AND r.revoked_at IS NULL AND g.revoked_at IS NULL
   AND r.valid_from<=clock_timestamp() AND r.valid_until>clock_timestamp()
   AND g.valid_from<=clock_timestamp() AND g.valid_until>clock_timestamp()
   AND g.actions_json#>>'{IMPORT,allowed}'='true'
   AND g.actions_json#>>'{IMPORT,captureRetentionAllowed}'='true'
   AND g.actions_json#>>'{IMPORT,nativeProjectionAllowed}'='true'
   AND (g.actions_json#>>'{IMPORT,validFrom}')::timestamptz<=clock_timestamp()
   AND (g.actions_json#>>'{IMPORT,validUntil}')::timestamptz>clock_timestamp()
   AND tdms_receiver_members_cover(g.actions_json#>'{IMPORT,permittedMembers}',
     tdms_upload_selection_association.member_claims_json)
 ));
-- Associations are immutable: conflicting replay is rejected; there are no UPDATE/DELETE policies.
COMMIT;
