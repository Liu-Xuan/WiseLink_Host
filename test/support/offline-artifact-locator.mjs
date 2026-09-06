/** Offline ESM test/script double only; not imported by runtime application code. */
export class InMemoryArtifactLocator {
  rows = new Map();
  async find(ref) { return this.rows.get(ref) ?? null; }
  async record(locator) {
    const existing = this.rows.get(locator.artifactRef);
    if (existing && JSON.stringify(existing) !== JSON.stringify(locator)) {
      throw new Error('ARTIFACT_LOCATOR_REGISTRATION_CONFLICT');
    }
    this.rows.set(locator.artifactRef, { ...locator });
  }
}
