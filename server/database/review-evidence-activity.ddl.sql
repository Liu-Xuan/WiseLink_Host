BEGIN;

ALTER TABLE action_attempt ADD COLUMN IF NOT EXISTS review_activity_json TEXT;
COMMENT ON COLUMN action_attempt.review_activity_json IS
  'Host-observed Review context preparation and exact SourceRef resolution receipts; optional for historical attempts, never model reasoning or business adoption.';

COMMIT;
