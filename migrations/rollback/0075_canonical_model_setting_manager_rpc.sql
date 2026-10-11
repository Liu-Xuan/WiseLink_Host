BEGIN;

-- Revert the Host repository to its previous implementation before applying.
-- Preserve all saved model choices, audit records, parsing flags and policies.
DROP FUNCTION workspace_aadkpkjef3slu.canonical_model_setting_compare_and_set(
  varchar, varchar, integer
);

COMMIT;
