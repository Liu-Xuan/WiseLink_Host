BEGIN;

-- Prepare with the previous Host repository; apply in dev, review the schema
-- diff, and deploy through the official app release. Do not run online DDL.
-- Preserve all saved model choices, audit records, parsing flags and policies.
DROP FUNCTION workspace_aadkpkjef3slu.canonical_model_setting_compare_and_set(
  varchar, varchar, integer
);

COMMIT;
