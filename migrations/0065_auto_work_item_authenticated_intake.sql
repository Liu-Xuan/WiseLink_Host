BEGIN;

-- The browser intake reserves a WorkItem and its queue grant in one user-context
-- transaction. Permit only that initial insert for the same authenticated owner;
-- lease discovery, reads, updates and terminal receipts remain service-only.
CREATE POLICY auto_work_item_authorization_owner_intake_insert
  ON auto_work_item_authorization
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'WAITING'
    AND lease_generation = 0
    AND lease_owner IS NULL
    AND lease_token IS NULL
    AND lease_expires_at IS NULL
    AND actor_user_id = current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1 FROM work_item wi
      WHERE wi.tenant_id = auto_work_item_authorization.tenant_id
        AND wi.work_item_id = auto_work_item_authorization.work_item_id
        AND wi.request_id = auto_work_item_authorization.request_id
        AND wi.requested_by_user_id = auto_work_item_authorization.actor_user_id
        AND wi.document_id = auto_work_item_authorization.document_id
        AND wi.document_version_id = auto_work_item_authorization.document_version_id
        AND wi.source_artifact_id = auto_work_item_authorization.source_artifact_id
        AND wi.source_file_sha256 = auto_work_item_authorization.source_file_sha256
        AND wi.source_byte_length = auto_work_item_authorization.source_byte_length
        AND wi.status = 'RESERVED'
        AND wi.revision = 0
        AND wi.package_id IS NULL
        AND wi.created_at >= CURRENT_TIMESTAMP - INTERVAL '5 minutes'
        AND (wi.run_key = 'canonical' OR wi.run_key LIKE 'dev:%')
    )
  );

COMMIT;
