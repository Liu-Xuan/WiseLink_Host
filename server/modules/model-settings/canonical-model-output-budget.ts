import { canonicalModelError, CANONICAL_REGISTERED_MODELS } from './canonical-model-catalog';

/** Local candidate only. The existing Native five-field consumer rejects V2. */
export const CANONICAL_EXECUTION_MODEL_V2_SCHEMA =
  'wiselink.3_1.execution_model_selection.v2' as const;
export const CANONICAL_EXECUTION_MODEL_V2_ENV =
  'WL_CANONICAL_EXECUTION_MODEL_V2_ENABLED';

/** Host binding for new GLM Agent requests, not a provider-wide guarantee. */
export const CANONICAL_INITIAL_GLM_OUTPUT_TOKENS = 131072;

/** Only this registered, available profile has an approved Agent output limit. */
export function programAgentOutputTokens(modelRef: string): number | undefined {
  if (modelRef !== 'miaoda/glm-5.3' ||
      !CANONICAL_REGISTERED_MODELS.some(option => option.modelRef === modelRef && option.available))
    return undefined;
  return CANONICAL_INITIAL_GLM_OUTPUT_TOKENS;
}

export function validOutputTokens(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function readModelOutputBudgets(value: unknown): Record<string, number> {
  if (value === undefined || value === null) return {};
  let parsed: unknown = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); }
    catch { throw canonicalModelError('MODEL_OUTPUT_BUDGET_STORED_INVALID', 500); }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw canonicalModelError('MODEL_OUTPUT_BUDGET_STORED_INVALID', 500);
  const result: Record<string, number> = {};
  for (const [modelRef, tokens] of Object.entries(parsed)) {
    // Preserve a retired model's configuration. Route admission separately
    // checks the current catalog; one retired entry must not disable settings.
    if (modelRef.length > 255 ||
        !/^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9/._:-]*$/u.test(modelRef) ||
        !validOutputTokens(tokens))
      throw canonicalModelError('MODEL_OUTPUT_BUDGET_STORED_INVALID', 500);
    result[modelRef] = tokens;
  }
  return result;
}
