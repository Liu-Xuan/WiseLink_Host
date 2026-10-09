import { tdmsError, type TdmsArtifactStore } from './tdms-source.types';
export class UnconfiguredTdmsArtifactStore implements TdmsArtifactStore {
  async acquire(): Promise<never> {
    throw tdmsError('TDMS_CONTROLLED_ARTIFACT_STORE_UNCONFIGURED', 503);
  }
}
