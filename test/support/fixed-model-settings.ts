import type { CanonicalExecutionModelSelection } from '@shared/api.interface';
import type { CanonicalModelSettingsService } from '../../server/modules/model-settings/canonical-model-settings.service';

/** Offline lifecycle fixture; never used by a production provider. */
export function fixedModelSettings(
  modelRef = 'miaoda/minimax-m3',
): CanonicalModelSettingsService {
  return {
    captureForNewTask: async (
      _tenantId: string,
      selectedAt: Date,
    ): Promise<CanonicalExecutionModelSelection> => ({
      modelRef,
      displayName:
        modelRef === 'miaoda/minimax-m3' ? 'MiniMax-M3' : 'GPT 5.6 Sol',
      providerKind: modelRef.startsWith('miaoda/') ? 'BUILT_IN' : 'CUSTOM',
      settingsRevision: 0,
      selectedAt: selectedAt.toISOString(),
    }),
  } as CanonicalModelSettingsService;
}
