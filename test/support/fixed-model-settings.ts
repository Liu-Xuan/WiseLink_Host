import type { CanonicalExecutionModelSelection } from '@shared/api.interface';
import { CanonicalModelSettingsService } from '../../server/modules/model-settings/canonical-model-settings.service';

/** Offline lifecycle fixture; never used by a production provider. */
export function fixedModelSettings(
  modelRef = 'miaoda/minimax-m3',
): CanonicalModelSettingsService {
  const selection = (selectedAt: Date): CanonicalExecutionModelSelection => ({
    modelRef,
    displayName:
      modelRef === 'miaoda/minimax-m3' ? 'MiniMax-M3' : 'GPT 5.6 Sol',
    providerKind: modelRef.startsWith('miaoda/') ? 'BUILT_IN' : 'CUSTOM',
    settingsRevision: 0,
    selectedAt: selectedAt.toISOString(),
  });
  return new CanonicalModelSettingsService({
    read: async (tenantId: string) => ({
      tenantId,
      modelRef,
      revision: 0,
      updatedAt: new Date('2026-09-06T00:00:00Z'),
    }),
    readWorkItemModel: async () => selection(new Date('2026-09-06T00:00:00Z')),
    pinWorkItemModel: async (
      _tenantId: string,
      _workItemId: string,
      model: CanonicalExecutionModelSelection,
    ) => model,
  } as never);
}
