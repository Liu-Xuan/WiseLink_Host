BEGIN;
-- DRAFT 0084: only after removing the candidate consumer; never rewrite sealed tasks.
DROP FUNCTION workspace_aadkpkjef3slu.canonical_model_setting_compare_and_set_with_output_budget(varchar, varchar, integer, bigint);
ALTER TABLE workspace_aadkpkjef3slu.canonical_model_setting
  DROP COLUMN output_budgets_json;
COMMIT;
