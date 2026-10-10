import { z } from 'zod/v4';
import type { ApplyPendingModelConfigurationRequest } from '@shared/pending-model-configuration.interface';
import { parseExecutionModel } from '../model-settings/canonical-execution-model';
import { canonicalModelError } from '../model-settings/canonical-model-catalog';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/u);
const model = z.strictObject({ modelRef: z.string(), displayName: z.string(), providerKind: z.enum(['BUILT_IN', 'CUSTOM']), settingsRevision: z.number().int().nonnegative(), selectedAt: z.string() }).nullable();
const request = z.strictObject({ configurationRequestId: z.string().uuid(), workItemId: id, requestId: id, documentVersionId: id, sourceArtifactId: id, sourceFileSha256: z.string().regex(/^[a-f0-9]{64}$/u), sourceByteLength: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), expectedWorkItemRevision: z.number().int().nonnegative(), expectedExecutionModel: model, expectedSettingsRevision: z.number().int().positive() });
export function parsePendingModelConfigurationRequest(input: unknown): ApplyPendingModelConfigurationRequest {
  try {
    const value = request.parse(input);
    return { ...value, expectedExecutionModel: value.expectedExecutionModel === null ? null : parseExecutionModel(value.expectedExecutionModel) };
  } catch { throw canonicalModelError('PENDING_MODEL_CONFIGURATION_INPUT_INVALID', 400); }
}
