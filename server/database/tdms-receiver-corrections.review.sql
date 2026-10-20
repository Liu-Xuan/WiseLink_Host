-- LOCAL REVIEW CANDIDATE ONLY. This is not the original migration 72 and is not
-- registered with a deploy runner. Apply only to an owned PostgreSQL fixture.
-- Retains the existing three tables, five helpers, roles, audit/revision hooks
-- and immutable associations. No grant, receiver or runtime privilege is added.
BEGIN;

CREATE OR REPLACE FUNCTION workspace_aadkpkjef3slu.tdms_receiver_members_cover(
  permitted jsonb, requested jsonb
) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path TO pg_catalog AS $function$
DECLARE claims jsonb; member jsonb; identity jsonb; owner jsonb; field text;
BEGIN
  FOREACH claims IN ARRAY ARRAY[permitted, requested] LOOP
    IF jsonb_typeof(claims) IS DISTINCT FROM 'object'
      OR NOT (claims ?& ARRAY['records','artifacts','relationIds'])
      OR claims - ARRAY['records','artifacts','relationIds','relatedDocumentVersionIds'] <> '{}'::jsonb
      OR jsonb_typeof(claims->'records') IS DISTINCT FROM 'array'
      OR jsonb_typeof(claims->'artifacts') IS DISTINCT FROM 'array'
      OR jsonb_typeof(claims->'relationIds') IS DISTINCT FROM 'array'
      OR COALESCE(claims->'relatedDocumentVersionIds','[]'::jsonb) <> '[]'::jsonb
    THEN RETURN false; END IF;
    FOREACH field IN ARRAY ARRAY['records','artifacts','relationIds'] LOOP
      IF jsonb_array_length(claims->field)>10000
        OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(claims->field))
      THEN RETURN false; END IF;
    END LOOP;
    FOR member IN SELECT value FROM jsonb_array_elements(claims->'artifacts') LOOP
      IF jsonb_typeof(member) IS DISTINCT FROM 'object'
        OR NOT (member ?& ARRAY['memberId','sourceAttachmentId','sourceAttachmentVersion','owners'])
        OR member - ARRAY['memberId','sourceAttachmentId','sourceAttachmentVersion','metadataOnly','owners'] <> '{}'::jsonb
        OR (member ? 'metadataOnly' AND member->'metadataOnly'<>'true'::jsonb)
        OR jsonb_typeof(member->'owners') IS DISTINCT FROM 'array'
      THEN RETURN false; END IF;
      IF jsonb_array_length(member->'owners')=0
        OR jsonb_array_length(member->'owners')>10000
        OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(member->'owners'))
      THEN RETURN false; END IF;
      FOREACH field IN ARRAY ARRAY['memberId','sourceAttachmentId','sourceAttachmentVersion'] LOOP
        IF field<>'memberId' AND member->field='null'::jsonb THEN CONTINUE; END IF;
        IF jsonb_typeof(member->field) IS DISTINCT FROM 'string'
          OR length(member->>field) NOT BETWEEN 1 AND 255
          OR btrim(member->>field)<>member->>field
          OR member->>field ~ '[[:cntrl:]]'
        THEN RETURN false; END IF;
      END LOOP;
    END LOOP;
    FOR identity IN
      SELECT value FROM jsonb_array_elements(claims->'records')
      UNION ALL
      SELECT owner.value FROM jsonb_array_elements(claims->'artifacts') artifact,
        LATERAL jsonb_array_elements(artifact.value->'owners') owner
    LOOP
      IF jsonb_typeof(identity) IS DISTINCT FROM 'object'
        OR identity<>jsonb_build_object('recordKind',identity->'recordKind','sourceRecordId',identity->'sourceRecordId')
      THEN RETURN false; END IF;
      FOREACH field IN ARRAY ARRAY['recordKind','sourceRecordId'] LOOP
        IF jsonb_typeof(identity->field) IS DISTINCT FROM 'string'
          OR length(identity->>field) NOT BETWEEN 1 AND 255
          OR btrim(identity->>field)<>identity->>field
          OR identity->>field ~ '[[:cntrl:]]'
        THEN RETURN false; END IF;
      END LOOP;
    END LOOP;
    FOR identity IN SELECT value FROM jsonb_array_elements(claims->'relationIds') LOOP
      IF jsonb_typeof(identity) IS DISTINCT FROM 'string'
        OR length(identity#>>'{}') NOT BETWEEN 1 AND 255
        OR btrim(identity#>>'{}')<>identity#>>'{}'
        OR identity#>>'{}' ~ '[[:cntrl:]]'
      THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  -- JSONB containment of objects accepts partial identities, such as {}.
  -- Membership compares whole canonical objects; owners use the same equality.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(requested->'records') wanted
      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(permitted->'records') allowed
        WHERE allowed.value=wanted.value))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(requested->'relationIds') wanted
      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(permitted->'relationIds') allowed
        WHERE allowed.value=wanted.value))
  THEN RETURN false; END IF;
  RETURN NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(requested->'artifacts') wanted
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(permitted->'artifacts') allowed
      WHERE allowed.value-'owners'=wanted.value-'owners'
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(wanted.value->'owners') owner
          WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(allowed.value->'owners') approved
            WHERE approved.value=owner.value)
        )
    )
  );
END $function$;

-- A selection cannot present claims for A while retaining attachment B.
-- The owner identity is produced from the validated selected package record.
-- Existing corrupt or pre-contract rows stop this candidate; no data is repaired.
ALTER TABLE workspace_aadkpkjef3slu.tdms_upload_selection_association
  ADD CONSTRAINT tdms_selection_exact_members CHECK ((
    workspace_aadkpkjef3slu.tdms_receiver_members_cover(member_claims_json,member_claims_json)
    AND data_json->'ownerRecord'=jsonb_build_object(
      'snapshotId',data_json#>'{ownerRecord,snapshotId}',
      'recordKind',data_json#>'{ownerRecord,recordKind}',
      'sourceRecordId',data_json#>'{ownerRecord,sourceRecordId}')
    AND jsonb_typeof(data_json#>'{ownerRecord,snapshotId}')='string'
    AND length(data_json#>>'{ownerRecord,snapshotId}') BETWEEN 1 AND 255
    AND data_json#>>'{ownerRecord,snapshotId}'=data_json#>>'{observation,ownerSnapshotId}'
    AND data_json#>'{artifact,ownerItemIds}'=jsonb_build_array(data_json#>'{ownerRecord,snapshotId}')
    AND jsonb_typeof(data_json#>'{artifact,sourceAttachmentId}')='string'
    AND data_json#>'{artifact,sourceAttachmentVersion}'='null'::jsonb
    AND member_claims_json=jsonb_build_object(
      'records',jsonb_build_array(jsonb_build_object(
        'recordKind',data_json#>'{ownerRecord,recordKind}',
        'sourceRecordId',data_json#>'{ownerRecord,sourceRecordId}')),
      'artifacts',jsonb_build_array(jsonb_build_object(
        'memberId',data_json#>'{artifact,memberId}',
        'sourceAttachmentId',data_json#>'{artifact,sourceAttachmentId}',
        'sourceAttachmentVersion','null'::jsonb,
        'owners',jsonb_build_array(jsonb_build_object(
          'recordKind',data_json#>'{ownerRecord,recordKind}',
          'sourceRecordId',data_json#>'{ownerRecord,sourceRecordId}')))),
      'relationIds','[]'::jsonb,'relatedDocumentVersionIds','[]'::jsonb)
  ) IS TRUE);

-- Existing policy names and roles are preserved. Reads use current independent
-- READ_RECORD or READ_HISTORY membership, never an old import grant revision.
-- Final document/original reading still checks READ_RECORD at its own consumer.
ALTER POLICY tdms_act_insert_guard
  ON workspace_aadkpkjef3slu.tdms_upload_selection_association
  WITH CHECK ((current_user='service_role_workspace_aadkpkjef3slu' AND actor_subject_id=current_setting('app.user_id',true)
    AND EXISTS (
      SELECT 1 FROM workspace_aadkpkjef3slu.tdms_source_receiver r
      JOIN workspace_aadkpkjef3slu.tdms_source_receiver_grant g USING(receiver_id)
      WHERE r.receiver_id=tdms_upload_selection_association.receiver_id
        AND r.tenant_id=tdms_upload_selection_association.tenant_id
        AND r.application_scope_id=tdms_upload_selection_association.application_scope_id
        AND r.source_key=tdms_upload_selection_association.source_key
        AND r.source_instance_id=tdms_upload_selection_association.source_instance_id
        AND r.scope_id=tdms_upload_selection_association.scope_id
        AND g.actor_subject_id=tdms_upload_selection_association.actor_subject_id
        AND r.source_subject_namespace=g.source_subject_namespace
        AND r.source_subject_id=g.source_subject_id
        AND r.status='ACTIVE' AND g.status='ACTIVE'
        AND r.revoked_at IS NULL AND g.revoked_at IS NULL
        AND r.valid_from<=clock_timestamp() AND r.valid_until>clock_timestamp()
        AND g.valid_from<=clock_timestamp() AND g.valid_until>clock_timestamp()
        AND r.revision=tdms_upload_selection_association.receiver_revision
        AND g.revision=tdms_upload_selection_association.grant_revision
        AND tdms_upload_selection_association.permission_revision::jsonb=jsonb_build_array(
          'tdms-receiver-v1',r.receiver_id,r.revision,r.authority_revision,g.revision,g.permission_revision)
        AND g.actions_json#>'{IMPORT,allowed}'='true'::jsonb
        AND g.actions_json#>'{IMPORT,captureRetentionAllowed}'='true'::jsonb
        AND g.actions_json#>'{IMPORT,nativeProjectionAllowed}'='true'::jsonb
        AND (g.actions_json#>>'{IMPORT,validFrom}')::timestamptz<=clock_timestamp()
        AND (g.actions_json#>>'{IMPORT,validUntil}')::timestamptz>clock_timestamp()
        AND workspace_aadkpkjef3slu.tdms_receiver_members_cover(
          g.actions_json#>'{IMPORT,permittedMembers}',member_claims_json)
    )) IS TRUE);

ALTER POLICY tdms_selection_host_insert
  ON workspace_aadkpkjef3slu.tdms_upload_selection_association
  WITH CHECK ((actor_subject_id=current_setting('app.user_id',true)
    AND EXISTS (
      SELECT 1 FROM workspace_aadkpkjef3slu.tdms_source_receiver r
      JOIN workspace_aadkpkjef3slu.tdms_source_receiver_grant g USING(receiver_id)
      WHERE r.receiver_id=tdms_upload_selection_association.receiver_id
        AND r.tenant_id=tdms_upload_selection_association.tenant_id
        AND r.application_scope_id=tdms_upload_selection_association.application_scope_id
        AND r.source_key=tdms_upload_selection_association.source_key
        AND r.source_instance_id=tdms_upload_selection_association.source_instance_id
        AND r.scope_id=tdms_upload_selection_association.scope_id
        AND g.actor_subject_id=tdms_upload_selection_association.actor_subject_id
        AND r.source_subject_namespace=g.source_subject_namespace
        AND r.source_subject_id=g.source_subject_id
        AND r.status='ACTIVE' AND g.status='ACTIVE'
        AND r.revoked_at IS NULL AND g.revoked_at IS NULL
        AND r.valid_from<=clock_timestamp() AND r.valid_until>clock_timestamp()
        AND g.valid_from<=clock_timestamp() AND g.valid_until>clock_timestamp()
        AND r.revision=tdms_upload_selection_association.receiver_revision
        AND g.revision=tdms_upload_selection_association.grant_revision
        AND tdms_upload_selection_association.permission_revision::jsonb=jsonb_build_array(
          'tdms-receiver-v1',r.receiver_id,r.revision,r.authority_revision,g.revision,g.permission_revision)
        AND g.actions_json#>'{IMPORT,allowed}'='true'::jsonb
        AND g.actions_json#>'{IMPORT,captureRetentionAllowed}'='true'::jsonb
        AND g.actions_json#>'{IMPORT,nativeProjectionAllowed}'='true'::jsonb
        AND (g.actions_json#>>'{IMPORT,validFrom}')::timestamptz<=clock_timestamp()
        AND (g.actions_json#>>'{IMPORT,validUntil}')::timestamptz>clock_timestamp()
        AND workspace_aadkpkjef3slu.tdms_receiver_members_cover(
          g.actions_json#>'{IMPORT,permittedMembers}',member_claims_json)
    )) IS TRUE);

ALTER POLICY tdms_act_select_guard
  ON workspace_aadkpkjef3slu.tdms_upload_selection_association
  USING ((current_user IN ('authenticated_workspace_aadkpkjef3slu','service_role_workspace_aadkpkjef3slu') AND actor_subject_id=current_setting('app.user_id',true)
    AND EXISTS (
      SELECT 1 FROM workspace_aadkpkjef3slu.tdms_source_receiver r
      JOIN workspace_aadkpkjef3slu.tdms_source_receiver_grant g USING(receiver_id)
      WHERE r.receiver_id=tdms_upload_selection_association.receiver_id
        AND r.tenant_id=tdms_upload_selection_association.tenant_id
        AND r.application_scope_id=tdms_upload_selection_association.application_scope_id
        AND r.source_key=tdms_upload_selection_association.source_key
        AND r.source_instance_id=tdms_upload_selection_association.source_instance_id
        AND r.scope_id=tdms_upload_selection_association.scope_id
        AND g.actor_subject_id=tdms_upload_selection_association.actor_subject_id
        AND r.source_subject_namespace=g.source_subject_namespace
        AND r.source_subject_id=g.source_subject_id
        AND r.status='ACTIVE' AND g.status='ACTIVE'
        AND r.revoked_at IS NULL AND g.revoked_at IS NULL
        AND r.valid_from<=clock_timestamp() AND r.valid_until>clock_timestamp()
        AND g.valid_from<=clock_timestamp() AND g.valid_until>clock_timestamp()
        AND r.revision=tdms_upload_selection_association.receiver_revision
        AND ((g.actions_json#>'{READ_RECORD,allowed}'='true'::jsonb
          AND g.actions_json#>'{READ_RECORD,retainedCaptureReadAllowed}'='true'::jsonb
          AND (g.actions_json#>>'{READ_RECORD,validFrom}')::timestamptz<=clock_timestamp()
          AND (g.actions_json#>>'{READ_RECORD,validUntil}')::timestamptz>clock_timestamp()
          AND workspace_aadkpkjef3slu.tdms_receiver_members_cover(
            g.actions_json#>'{READ_RECORD,permittedMembers}',member_claims_json))
          OR (g.actions_json#>'{READ_HISTORY,allowed}'='true'::jsonb
          AND g.actions_json#>'{READ_HISTORY,retainedCaptureReadAllowed}'='true'::jsonb
          AND (g.actions_json#>>'{READ_HISTORY,validFrom}')::timestamptz<=clock_timestamp()
          AND (g.actions_json#>>'{READ_HISTORY,validUntil}')::timestamptz>clock_timestamp()
          AND workspace_aadkpkjef3slu.tdms_receiver_members_cover(
            g.actions_json#>'{READ_HISTORY,permittedMembers}',member_claims_json)))
    )) IS TRUE);

ALTER POLICY tdms_selection_actor_read
  ON workspace_aadkpkjef3slu.tdms_upload_selection_association
  USING ((actor_subject_id=current_setting('app.user_id',true)
    AND EXISTS (
      SELECT 1 FROM workspace_aadkpkjef3slu.tdms_source_receiver r
      JOIN workspace_aadkpkjef3slu.tdms_source_receiver_grant g USING(receiver_id)
      WHERE r.receiver_id=tdms_upload_selection_association.receiver_id
        AND r.tenant_id=tdms_upload_selection_association.tenant_id
        AND r.application_scope_id=tdms_upload_selection_association.application_scope_id
        AND r.source_key=tdms_upload_selection_association.source_key
        AND r.source_instance_id=tdms_upload_selection_association.source_instance_id
        AND r.scope_id=tdms_upload_selection_association.scope_id
        AND g.actor_subject_id=tdms_upload_selection_association.actor_subject_id
        AND r.source_subject_namespace=g.source_subject_namespace
        AND r.source_subject_id=g.source_subject_id
        AND r.status='ACTIVE' AND g.status='ACTIVE'
        AND r.revoked_at IS NULL AND g.revoked_at IS NULL
        AND r.valid_from<=clock_timestamp() AND r.valid_until>clock_timestamp()
        AND g.valid_from<=clock_timestamp() AND g.valid_until>clock_timestamp()
        AND r.revision=tdms_upload_selection_association.receiver_revision
        AND ((g.actions_json#>'{READ_RECORD,allowed}'='true'::jsonb
          AND g.actions_json#>'{READ_RECORD,retainedCaptureReadAllowed}'='true'::jsonb
          AND (g.actions_json#>>'{READ_RECORD,validFrom}')::timestamptz<=clock_timestamp()
          AND (g.actions_json#>>'{READ_RECORD,validUntil}')::timestamptz>clock_timestamp()
          AND workspace_aadkpkjef3slu.tdms_receiver_members_cover(
            g.actions_json#>'{READ_RECORD,permittedMembers}',member_claims_json))
          OR (g.actions_json#>'{READ_HISTORY,allowed}'='true'::jsonb
          AND g.actions_json#>'{READ_HISTORY,retainedCaptureReadAllowed}'='true'::jsonb
          AND (g.actions_json#>>'{READ_HISTORY,validFrom}')::timestamptz<=clock_timestamp()
          AND (g.actions_json#>>'{READ_HISTORY,validUntil}')::timestamptz>clock_timestamp()
          AND workspace_aadkpkjef3slu.tdms_receiver_members_cover(
            g.actions_json#>'{READ_HISTORY,permittedMembers}',member_claims_json)))
    )) IS TRUE);

COMMIT;
