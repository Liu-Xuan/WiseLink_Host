import { UnconfiguredUnifiedArtifactStoreAdapter } from '../../server/modules/unified-reader/unconfigured-unified-artifact-store.adapter';

describe('UnconfiguredUnifiedArtifactStoreAdapter', () => {
  it('fails closed before any artifact store role is activated', async () => {
    const adapter = new UnconfiguredUnifiedArtifactStoreAdapter();

    await expect(
      adapter.persistAndReadback(new TextEncoder().encode('{"ok":true}')),
    ).rejects.toThrow(
      'CANONICAL_ROLE_NOT_VERIFIED:ARTIFACT_STORE_UNCONFIGURED',
    );
  });
});
