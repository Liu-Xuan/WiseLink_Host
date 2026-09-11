BEGIN;
ALTER TABLE wiselink_drive_scan_checkpoint
  ADD COLUMN candidate_snapshot_json text;
COMMIT;
