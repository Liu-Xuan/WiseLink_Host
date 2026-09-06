import type {
  OrdinaryArtifactLocator,
  OrdinaryArtifactLocatorRegistryPort,
} from '../../server/modules/unified-reader/miaoda-ordinary-artifact-locator.registry';

/** Test-only persistence double; production always injects the PostgreSQL registry. */
export class InMemoryArtifactLocator implements OrdinaryArtifactLocatorRegistryPort {
  readonly rows = new Map<string, OrdinaryArtifactLocator>();
  async find(ref: string): Promise<OrdinaryArtifactLocator | null> {
    return this.rows.get(ref) ?? null;
  }
  async record(locator: OrdinaryArtifactLocator): Promise<void> {
    const existing = this.rows.get(locator.artifactRef);
    if (existing && JSON.stringify(existing) !== JSON.stringify(locator)) {
      throw new Error('ARTIFACT_LOCATOR_REGISTRATION_CONFLICT');
    }
    this.rows.set(locator.artifactRef, { ...locator });
  }
}
