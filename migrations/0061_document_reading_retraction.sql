BEGIN;
-- A saved reading remains immutable. Retraction is a separate, append-only
-- decision about whether that revision may be served to readers.
CREATE TABLE dm_document_reading_retraction (
  run_ref varchar(96) PRIMARY KEY REFERENCES dm_document_reading_run(run_ref),
  tenant_id varchar(128) NOT NULL,
  actor_user_id varchar(255) NOT NULL,
  document_version_id varchar(96) NOT NULL,
  reading_revision integer NOT NULL CHECK (reading_revision > 0),
  request_id varchar(160) NOT NULL,
  reason_code varchar(160) NOT NULL CHECK (reason_code ~ '^[A-Z0-9_:-]+$'),
  review_reference varchar(255) NOT NULL,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT CASE WHEN current_setting('app.user_id', true) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', true), ')')::user_profile END,
  UNIQUE (tenant_id, actor_user_id, request_id)
);
ALTER TABLE dm_document_reading_retraction ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON dm_document_reading_retraction TO authenticated,service_role;
GRANT INSERT ON dm_document_reading_retraction TO service_role;
CREATE POLICY document_reading_retraction_source_read ON dm_document_reading_retraction FOR SELECT
TO authenticated, service_role USING (EXISTS (
  SELECT 1 FROM dm_document_reading_run r WHERE r.run_ref=dm_document_reading_retraction.run_ref
    AND r.tenant_id=dm_document_reading_retraction.tenant_id
    AND r.actor_user_id=dm_document_reading_retraction.actor_user_id
    AND r.document_version_id=dm_document_reading_retraction.document_version_id
    AND r.reading_revision=dm_document_reading_retraction.reading_revision AND r.status='SAVED'
));
CREATE POLICY document_reading_retraction_producer_insert ON dm_document_reading_retraction FOR INSERT
TO service_role WITH CHECK (actor_user_id=current_setting('app.user_id', true) AND EXISTS (
  SELECT 1 FROM dm_document_reading_run r WHERE r.run_ref=dm_document_reading_retraction.run_ref
    AND r.tenant_id=dm_document_reading_retraction.tenant_id
    AND r.actor_user_id=dm_document_reading_retraction.actor_user_id
    AND r.document_version_id=dm_document_reading_retraction.document_version_id
    AND r.reading_revision=dm_document_reading_retraction.reading_revision AND r.status='SAVED'
));
CREATE FUNCTION document_reading_retraction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DOCUMENT_READING_RETRACTION_IMMUTABLE' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER document_reading_retraction_guard BEFORE UPDATE OR DELETE ON dm_document_reading_retraction
FOR EACH ROW EXECUTE FUNCTION document_reading_retraction_guard();
COMMIT;
