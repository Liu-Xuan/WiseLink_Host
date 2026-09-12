BEGIN;
ALTER TABLE dm_document_parse_run
  ADD COLUMN lease_owner varchar(160),
  ADD COLUMN lease_token varchar(96),
  ADD COLUMN lease_generation integer NOT NULL DEFAULT 0,
  ADD COLUMN lease_expires_at timestamptz(3),
  ADD COLUMN cancel_requested_at timestamptz(3);
COMMIT;
