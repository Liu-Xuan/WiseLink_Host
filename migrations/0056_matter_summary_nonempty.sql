-- Summary prose has no application-specific length cap. Preserve nonempty checks.
BEGIN;
ALTER TABLE engineering_matter_work_revision
  DROP CONSTRAINT ck_engineering_matter_work_revision_summary,
  ADD CONSTRAINT ck_engineering_matter_work_revision_summary CHECK (length(btrim(change_summary)) > 0);
ALTER TABLE engineering_matter_revision
  DROP CONSTRAINT ck_engineering_matter_revision_summary,
  ADD CONSTRAINT ck_engineering_matter_revision_summary CHECK (length(btrim(change_summary)) > 0);
COMMIT;
