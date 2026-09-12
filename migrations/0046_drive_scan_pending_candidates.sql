BEGIN;
ALTER TABLE wiselink_drive_scan_checkpoint ADD COLUMN pending_candidates_json text NOT NULL DEFAULT '[]';
COMMIT;
