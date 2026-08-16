-- DM owner Phase 13D ddb77bb. Apply only to the existing Host database after
-- explicit authorization. This adds no table and no runtime trigger.
ALTER TABLE external_search_run
  ADD COLUMN IF NOT EXISTS failure_code VARCHAR(96);
