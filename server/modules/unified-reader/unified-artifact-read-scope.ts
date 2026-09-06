import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';

import type {
  U0FullValidationProof,
  UnifiedArtifactStorePort,
  UnifiedReaderSourcePackage,
} from './unified-reader.types';
import { assertNoDuplicateJsonKeys } from './unified-reader.utils';

interface ScopedSourcePackageInput {
  artifact: UnifiedPackageArtifactDescriptor;
  packageId: string;
  documentVersionId?: string;
}

interface ScopedValidatedSourcePackage {
  sourcePackage: UnifiedReaderSourcePackage;
  proof: U0FullValidationProof;
}

/**
 * One request/task's read results, never a process cache or an authorization.
 * Construct at the authorized business entry and pass it explicitly. Every
 * business consumer must still check its actor and document-version binding.
 * Returned bytes/JSON are shared read-only inputs; consumers must not edit them.
 */
export class UnifiedArtifactReadScope {
  private readonly bytes: Map<string, Promise<Uint8Array>> = new Map();
  private readonly json: WeakMap<Uint8Array, unknown> = new WeakMap();
  private readonly packages: Map<string, Promise<ScopedValidatedSourcePackage>> =
    new Map();

  constructor(private readonly artifactStore: UnifiedArtifactStorePort) {}

  readActualBytes(artifact: UnifiedPackageArtifactDescriptor): Promise<Uint8Array> {
    const key: string = artifactKey(artifact);
    const existing: Promise<Uint8Array> | undefined = this.bytes.get(key);
    if (existing) return existing;
    const pending: Promise<Uint8Array> = this.artifactStore.readActualBytes({
      ...artifact,
    });
    this.bytes.set(key, pending);
    void pending.catch((): void => {
      if (this.bytes.get(key) === pending) this.bytes.delete(key);
    });
    return pending;
  }

  /** The byte object is request-local and comes from the exact registered ref. */
  parseJson(bytes: Uint8Array): unknown {
    if (this.json.has(bytes)) return this.json.get(bytes);
    const rawText: string = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assertNoDuplicateJsonKeys(rawText);
    const parsed: unknown = JSON.parse(rawText) as unknown;
    this.json.set(bytes, parsed);
    return parsed;
  }

  readValidatedSourcePackage(
    input: ScopedSourcePackageInput,
    read: () => Promise<ScopedValidatedSourcePackage>,
  ): Promise<ScopedValidatedSourcePackage> {
    const key: string = JSON.stringify([
      input.documentVersionId ?? null,
      input.packageId,
      artifactKey(input.artifact),
    ]);
    const existing: Promise<ScopedValidatedSourcePackage> | undefined =
      this.packages.get(key);
    if (existing) return existing;
    const pending: Promise<ScopedValidatedSourcePackage> = read();
    this.packages.set(key, pending);
    void pending.catch((): void => {
      if (this.packages.get(key) === pending) this.packages.delete(key);
      // A failed validation is not a reusable successful read. An explicit
      // retry may acquire fresh bytes, while concurrent callers see the error.
      this.bytes.delete(artifactKey(input.artifact));
    });
    return pending;
  }
}

function artifactKey(artifact: UnifiedPackageArtifactDescriptor): string {
  return JSON.stringify([
    artifact.storeRole,
    artifact.ref,
    artifact.sha256,
    artifact.byteLength,
    artifact.mediaType,
  ]);
}
