import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';

import type {
  ImmutableArtifactPersistResult,
  UnifiedArtifactStorePort,
} from './unified-reader.types';

export class UnconfiguredUnifiedArtifactStoreAdapter
  implements UnifiedArtifactStorePort
{
  async persistAndReadback(
    _bytes: Uint8Array,
  ): Promise<ImmutableArtifactPersistResult> {
    throw new Error(
      'CANONICAL_ROLE_NOT_VERIFIED:ARTIFACT_STORE_UNCONFIGURED',
    );
  }

  async readActualBytes(
    _artifact: UnifiedPackageArtifactDescriptor,
  ): Promise<Uint8Array> {
    throw new Error(
      'CANONICAL_ROLE_NOT_VERIFIED:ARTIFACT_STORE_UNCONFIGURED',
    );
  }
}
