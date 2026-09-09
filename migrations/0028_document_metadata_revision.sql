-- Append-only descriptive extraction revisions on the existing metadata table.
-- The original metadata JSON, document/source rows and all immutable triggers stay intact.
BEGIN;
ALTER TABLE dm_document_version_metadata
  ADD COLUMN IF NOT EXISTS metadata_revision integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS request_id varchar(128);
COMMENT ON COLUMN dm_document_version_metadata.metadata_revision IS
  'Append-only extraction revision for one exact DocumentVersion. Existing observations are revision 1; no mutable head.';
COMMENT ON COLUMN dm_document_version_metadata.request_id IS
  'Server-validated client request ID for exact-version re-extraction replay and read-only result recovery. NULL for initial extraction.';
ALTER TABLE dm_document_version_metadata
  DROP CONSTRAINT dm_document_version_metadata_document_version_id_key;
ALTER TABLE dm_document_version_metadata
  ADD CONSTRAINT ck_dm_document_metadata_revision CHECK (metadata_revision > 0),
  ADD CONSTRAINT ck_dm_document_metadata_request CHECK (
    (metadata_revision = 1 AND request_id IS NULL) OR
    (metadata_revision > 1 AND request_id IS NOT NULL AND length(btrim(request_id)) > 0)
  );
CREATE UNIQUE INDEX uk_dm_document_version_metadata_revision
  ON dm_document_version_metadata(document_version_id, metadata_revision);
CREATE UNIQUE INDEX uk_dm_document_version_metadata_request
  ON dm_document_version_metadata(document_version_id, request_id) WHERE request_id IS NOT NULL;
COMMIT;
