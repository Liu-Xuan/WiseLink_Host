-- Older completed automatic tasks may predate the browser-readable receipt.
-- Restore only the projection of an existing, fenced COMPLETED grant. This
-- neither creates a grant nor changes WorkItem or source identity.
UPDATE work_item AS w
SET projection_json = jsonb_set(
  w.projection_json::jsonb,
  '{autoProcessingCompletionReceipt}',
  jsonb_build_object(
    'tenantId', a.tenant_id,
    'workItemId', a.work_item_id,
    'requestId', a.request_id,
    'actorUserId', a.actor_user_id,
    'documentId', a.document_id,
    'documentVersionId', a.document_version_id,
    'sourceArtifactId', a.source_artifact_id,
    'sourceFileSha256', a.source_file_sha256,
    'sourceByteLength', a.source_byte_length,
    'completedAt', to_char(a.completed_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ),
  true
)::text
FROM auto_work_item_authorization AS a
WHERE a.tenant_id = w.tenant_id
  AND a.work_item_id = w.work_item_id
  AND a.grant_kind = 'MIAODA_CANONICAL_PARSE_REQUEST'
  AND a.status = 'COMPLETED'
  AND a.completed_at IS NOT NULL
  AND a.completed_lease_generation > 0
  AND a.completed_lease_token_hash ~ '^[0-9a-f]{64}$'
  AND a.request_id = w.request_id
  AND a.actor_user_id = w.requested_by_user_id
  AND a.document_id = w.document_id
  AND a.document_version_id = w.document_version_id
  AND a.source_artifact_id = w.source_artifact_id
  AND a.source_file_sha256 = w.source_file_sha256
  AND a.source_file_sha256 ~ '^[0-9a-f]{64}$'
  AND a.source_byte_length = w.source_byte_length
  AND a.source_byte_length > 0
  AND w.action_type = 'PARSE_PDF'
  AND w.status = 'CANDIDATE_READBACK_VERIFIED'
  AND w.package_id IS NOT NULL
  AND w.projection_json IS NOT NULL
  AND jsonb_extract_path_text(w.projection_json::jsonb, 'revision') = w.revision::text
  AND jsonb_extract_path_text(w.projection_json::jsonb, 'autoProcessingCompletionReceipt') IS NULL;
