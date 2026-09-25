BEGIN;

ALTER TABLE auto_work_item_authorization
  ADD COLUMN blocked_lease_token_hash varchar(64),
  ADD COLUMN blocked_lease_generation integer,
  ADD COLUMN blocked_at timestamptz(3),
  ADD CONSTRAINT ck_auto_work_item_authorization_block_receipt
    CHECK ((blocked_lease_token_hash IS NULL AND
      blocked_lease_generation IS NULL AND blocked_at IS NULL) OR
      (blocked_lease_token_hash IS NOT NULL AND
      blocked_lease_generation IS NOT NULL AND blocked_at IS NOT NULL)),
  ADD CONSTRAINT ck_auto_work_item_authorization_block_hash
    CHECK (blocked_lease_token_hash IS NULL OR
      blocked_lease_token_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT ck_auto_work_item_authorization_block_generation
    CHECK (blocked_lease_generation IS NULL OR blocked_lease_generation > 0);

COMMENT ON COLUMN auto_work_item_authorization.blocked_lease_token_hash IS
  'SHA-256 receipt for an idempotent consumer attention block; raw token is cleared.';
COMMENT ON COLUMN auto_work_item_authorization.blocked_lease_generation IS
  'Lease fencing generation accepted by the consumer attention block.';

COMMIT;
