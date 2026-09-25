BEGIN;

ALTER TABLE auto_work_item_authorization
  ADD COLUMN completed_lease_token_hash varchar(64),
  ADD COLUMN completed_lease_generation integer,
  ADD COLUMN completed_at timestamptz(3),
  ADD CONSTRAINT ck_auto_work_item_authorization_completion
    CHECK ((status = 'COMPLETED') = (
      completed_lease_token_hash IS NOT NULL
      AND completed_lease_generation IS NOT NULL
      AND completed_at IS NOT NULL
    )),
  ADD CONSTRAINT ck_auto_work_item_authorization_completion_hash
    CHECK (completed_lease_token_hash IS NULL
      OR completed_lease_token_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT ck_auto_work_item_authorization_completion_generation
    CHECK (completed_lease_generation IS NULL
      OR completed_lease_generation > 0);

COMMENT ON COLUMN auto_work_item_authorization.completed_lease_token_hash IS
  'SHA-256 receipt for idempotent acknowledgement; raw lease token is cleared at completion.';
COMMENT ON COLUMN auto_work_item_authorization.completed_lease_generation IS
  'Fencing generation accepted by the one-time consumer acknowledgement.';

COMMIT;
