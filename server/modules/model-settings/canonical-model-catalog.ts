import type {
  CanonicalExecutionModelSelection,
  CanonicalModelOption,
} from '@shared/api.interface';

// Registration snapshot read from the official Hosted instance on 2026-09-06.
// This is an allowlist of routing identifiers, not a live inference health check.
// Provider credentials and URLs remain in that instance's official settings.
export const CANONICAL_REGISTERED_MODELS: readonly CanonicalModelOption[] = [
  {
    modelRef: 'miaoda/minimax-m3',
    displayName: 'MiniMax-M3',
    providerKind: 'BUILT_IN',
    providerLabel: '妙搭',
    available: true,
  },
  {
    modelRef: 'miaoda/miaoda-model-auto',
    displayName: '智能选择',
    providerKind: 'BUILT_IN',
    providerLabel: '妙搭',
    available: true,
  },
  {
    modelRef: 'miaoda/miaoda-model-flash',
    displayName: 'Flash',
    providerKind: 'BUILT_IN',
    providerLabel: '妙搭',
    available: true,
  },
  {
    modelRef: 'miaoda/miaoda-auto-multimodal',
    displayName: '多模态',
    providerKind: 'BUILT_IN',
    providerLabel: '妙搭',
    available: true,
  },
  {
    modelRef: 'dli/gpt-5.6-sol',
    displayName: 'GPT 5.6 Sol',
    providerKind: 'CUSTOM',
    providerLabel: 'DLI',
    available: true,
  },
];

// The explicit user-selected deployment default, not a failure fallback.
export const CANONICAL_INITIAL_MODEL_REF = 'miaoda/minimax-m3';
export const CANONICAL_MODEL_MANAGER_ROLE_ENV =
  'WL_CANONICAL_MODEL_MANAGER_ROLE_ID';

/** Called behind the existing task authorization, never a global settings write. */
export function taskModelSelection(
  modelRef: unknown = CANONICAL_INITIAL_MODEL_REF,
  selectedAt = new Date(),
): CanonicalExecutionModelSelection {
  const option = CANONICAL_REGISTERED_MODELS.find(
    (candidate) => candidate.available && candidate.modelRef === modelRef,
  );
  if (!option) throw canonicalModelError('TASK_MODEL_UNAVAILABLE', 400);
  return {
    modelRef: option.modelRef,
    displayName: option.displayName,
    providerKind: option.providerKind,
    // Compatibility field: explicit task choices do not revise global settings.
    settingsRevision: 0,
    selectedAt: selectedAt.toISOString(),
  };
}

export function canonicalModelError(
  code: string,
  statusCode: number,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode });
}
