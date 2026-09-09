-- One derived observation record per immutable DocumentVersion. No version UPDATE.
BEGIN;
CREATE TABLE IF NOT EXISTS dm_document_version_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_version_id varchar(96) NOT NULL UNIQUE REFERENCES dm_document_version(document_version_id),
  extracted_metadata jsonb NOT NULL,
  _created_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  _updated_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  CONSTRAINT ck_dm_version_metadata_object CHECK (jsonb_typeof(extracted_metadata) = 'object'),
  CONSTRAINT ck_dm_version_metadata_semantics CHECK (COALESCE(
    extracted_metadata->>'schemaVersion' = 'wiselink.document_metadata.v1'
    AND extracted_metadata->>'source' = 'ACTUAL_PDF_TEXT'
    AND extracted_metadata->>'aircraftModelSemantics' = 'DOCUMENT_MENTION_ONLY'
    AND extracted_metadata->>'applicabilityAssessment' = 'NOT_EVALUATED'
  , false))
);
COMMENT ON COLUMN dm_document_version_metadata.extracted_metadata IS
  '@type { schemaVersion: "wiselink.document_metadata.v1"; source: "ACTUAL_PDF_TEXT"; sourceSha256: string; sourceByteLength: number; pageCount: number; inspectedPages: number[]; extractedAt: string; title: { status: "PENDING_REVIEW" | "NOT_FOUND"; observations: Array<{ value: string; status: "PENDING_REVIEW"; evidence: Array<{ page: number; text: string }> }> }; documentType: { status: "PENDING_REVIEW" | "NOT_FOUND"; observations: Array<{ value: string; status: "PENDING_REVIEW"; evidence: Array<{ page: number; text: string }> }> }; issuer: { status: "PENDING_REVIEW" | "NOT_FOUND"; observations: Array<{ value: string; status: "PENDING_REVIEW"; evidence: Array<{ page: number; text: string }> }> }; ata: { status: "PENDING_REVIEW" | "NOT_FOUND"; observations: Array<{ value: string; status: "PENDING_REVIEW"; evidence: Array<{ page: number; text: string }> }> }; mentionedAircraftModels: { status: "PENDING_REVIEW" | "NOT_FOUND"; observations: Array<{ value: string; status: "PENDING_REVIEW"; evidence: Array<{ page: number; text: string }> }> }; aircraftModelSemantics: "DOCUMENT_MENTION_ONLY"; applicabilityAssessment: "NOT_EVALUATED" }';
ALTER TABLE dm_document_version_metadata ENABLE ROW LEVEL SECURITY;
-- Match DM catalog access; Host must authorize the exact version before access.
CREATE POLICY service_role_bypass_policy ON dm_document_version_metadata TO service_role USING (true);
CREATE POLICY "修改全部数据" ON dm_document_version_metadata AS PERMISSIVE FOR ALL TO authenticated USING (true);
CREATE POLICY "查看全部数据" ON dm_document_version_metadata AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "修改本人数据" ON dm_document_version_metadata AS PERMISSIVE FOR ALL TO authenticated USING (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
);
CREATE TRIGGER dm_document_version_metadata_immutable
  BEFORE UPDATE OR DELETE ON dm_document_version_metadata
  FOR EACH ROW EXECUTE FUNCTION dm_reject_immutable_row_mutation();
COMMIT;
