import type { CanonicalExecutionModelSelection } from '@shared/api.interface';
import { CANONICAL_REGISTERED_MODELS } from '../model-settings/canonical-model-catalog';
import { parseExecutionModel } from '../model-settings/canonical-execution-model';

/** HOSTED_M3 is the legacy wire producer tag, not the selected model identity. */
export function isDocumentTranslationModel(value: unknown): value is CanonicalExecutionModelSelection {
  try {
    const model = parseExecutionModel(value);
    return CANONICAL_REGISTERED_MODELS.some(option => option.available &&
      option.modelRef === model.modelRef && option.providerKind === model.providerKind);
  } catch { return false; }
}

export function requireDocumentTranslationModel(value: unknown): CanonicalExecutionModelSelection {
  if (!isDocumentTranslationModel(value)) throw new Error('DOCUMENT_TRANSLATION_HOSTED_MODEL_INVALID');
  return value;
}
