-- P proposal only; M registers shared migration 0047 and ActionAttempt clauses.
BEGIN;
ALTER TABLE translation_workspace ALTER COLUMN work_item_id DROP NOT NULL;
ALTER TABLE translation_block_revision ALTER COLUMN work_item_id DROP NOT NULL;
ALTER TABLE translation_workspace ADD COLUMN subject_kind varchar(32) NOT NULL DEFAULT 'WORK_ITEM';
ALTER TABLE translation_workspace ADD CONSTRAINT ck_translation_workspace_subject CHECK (
  (subject_kind = 'WORK_ITEM' AND work_item_id IS NOT NULL) OR
  (subject_kind = 'DOCUMENT_VERSION' AND work_item_id IS NULL));
CREATE UNIQUE INDEX uk_translation_workspace_document_source ON translation_workspace
  (tenant_id, document_version_id, parsed_artifact_sha256, target_locale) WHERE work_item_id IS NULL;
ALTER TABLE translation_workspace ADD CONSTRAINT uk_translation_workspace_tenant_id UNIQUE (tenant_id, workspace_id);
ALTER TABLE translation_block_revision ADD CONSTRAINT fk_translation_block_workspace_tenant
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES translation_workspace(tenant_id, workspace_id);
-- Existing WI composite FKs remain. A trigger prevents nullable block scopes from
-- bypassing that composite FK and attaching to a WI workspace (or vice versa).
CREATE FUNCTION translation_block_guard_subject() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM translation_workspace w WHERE w.tenant_id = NEW.tenant_id
      AND w.workspace_id = NEW.workspace_id AND w.work_item_id IS NOT DISTINCT FROM NEW.work_item_id) THEN
    RAISE EXCEPTION 'TRANSLATION_BLOCK_SUBJECT_MISMATCH';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER translation_block_subject BEFORE INSERT OR UPDATE ON translation_block_revision
  FOR EACH ROW EXECUTE FUNCTION translation_block_guard_subject();
CREATE POLICY translation_workspace_document_read ON translation_workspace FOR SELECT TO authenticated USING (
  subject_kind = 'DOCUMENT_VERSION' AND work_item_id IS NULL
  AND engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_document_owned_by_actor(tenant_id, document_version_id));
CREATE POLICY translation_block_document_read ON translation_block_revision FOR SELECT TO authenticated USING (
  work_item_id IS NULL AND EXISTS (SELECT 1 FROM translation_workspace w
    WHERE w.tenant_id = translation_block_revision.tenant_id AND w.workspace_id = translation_block_revision.workspace_id
    AND w.subject_kind = 'DOCUMENT_VERSION' AND w.work_item_id IS NULL));
-- No authenticated write grants here: M dispatch uses existing service scope after
-- fresh actor/DV authorization; RLS does not invent a user or permit anonymous IO.
COMMIT;
