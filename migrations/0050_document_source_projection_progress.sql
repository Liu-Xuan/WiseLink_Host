BEGIN;
ALTER TABLE engineering_search_projection_pending
  ADD COLUMN source_next_offset integer NOT NULL DEFAULT 0 CHECK (source_next_offset >= 0);
COMMIT;
