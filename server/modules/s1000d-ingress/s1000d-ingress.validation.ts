import type {
  ResolvedS1000dDocumentSource,
  S1000dAuthorizedSourceArtifact,
  S1000dDependencyRelationship,
  S1000dSourceUseAuthorization,
  S1000dStructuredPackageProducerResult,
} from './s1000d-ingress.types';

const DEPENDENCY_RELATIONSHIPS = new Set<S1000dDependencyRelationship>([
  'DM_REFERENCE',
  'PM_REFERENCE',
  'DELIVERY_MANIFEST',
  'SCHEMA_BINDING',
  'INFORMATION_ENTITY_REFERENCE',
]);

export function validateResolvedSource(
  source: ResolvedS1000dDocumentSource,
  expectedDocumentVersionId: string,
): void {
  if (
    !source.familyId.trim() ||
    !Number.isSafeInteger(source.currentGeneration) ||
    source.currentGeneration <= 0 ||
    source.documentVersionId !== expectedDocumentVersionId ||
    !source.documentId.trim() ||
    !source.revisionId.trim() ||
    !source.canonicalRevisionIdentity.trim() ||
    !source.committedAt.trim() ||
    !source.sourceArtifactId.trim() ||
    !source.originalFilename.trim() ||
    !['application/xml', 'text/xml'].includes(source.mediaType) ||
    !/^[0-9a-f]{64}$/u.test(source.sha256) ||
    !Number.isSafeInteger(source.byteLength) ||
    source.byteLength <= 0 ||
    !source.providerObjectId.trim() ||
    !source.providerVersionId.trim() ||
    !source.fileServiceLocator.bucketId.trim() ||
    !source.fileServiceLocator.filePath.trim()
  ) {
    throw s1000dIngressError(
      'S1000D_DOCUMENT_VERSION_SOURCE_INVALID',
      'DocumentVersion is not bound to one readable canonical XML SourceArtifact.',
      409,
    );
  }
}

export function validateAuthorization(
  value: S1000dSourceUseAuthorization,
  source: ResolvedS1000dDocumentSource,
): void {
  if (
    value.status !== 'AUTHORIZED' ||
    !value.decisionId.trim() ||
    !value.permissionSnapshotVersion.trim() ||
    value.sourceArtifactId !== source.sourceArtifactId ||
    value.documentVersionId !== source.documentVersionId ||
    value.processingAllowed !== true ||
    value.canonicalPackageStorageAllowed !== true ||
    value.browserProjectionAllowed !== true
  ) {
    throw sourceAuthorizationRequired();
  }
  if (
    value.sourceClass === 'OEM_CONTROLLED' &&
    (!value.sourceRedistributionAllowed ||
      !value.processingAuthorizationRef?.trim() ||
      !value.redistributionAuthorizationRef?.trim())
  ) {
    throw s1000dIngressError(
      'S1000D_OEM_AUTHORIZATION_AND_REDISTRIBUTION_REQUIRED',
      'OEM-controlled S1000D ingress requires server-resolved processing and redistribution credentials.',
      403,
    );
  }
  if (
    value.sourceClass !== 'OEM_CONTROLLED' &&
    value.sourceClass !== 'REPOSITORY_CONTROLLED_SYNTHETIC_FIXTURE'
  ) {
    throw sourceAuthorizationRequired();
  }
  validateAuthorizedSourceManifest(value.authorizedSourceManifest, source);
}

export function assertCurrentSourceUnchanged(
  initial: ResolvedS1000dDocumentSource,
  current: ResolvedS1000dDocumentSource,
): void {
  const same =
    current.familyId === initial.familyId &&
    current.currentGeneration === initial.currentGeneration &&
    current.documentId === initial.documentId &&
    current.documentVersionId === initial.documentVersionId &&
    current.revisionId === initial.revisionId &&
    current.canonicalRevisionIdentity === initial.canonicalRevisionIdentity &&
    current.committedAt === initial.committedAt &&
    current.sourceArtifactId === initial.sourceArtifactId &&
    current.originalFilename === initial.originalFilename &&
    current.mediaType === initial.mediaType &&
    current.sha256 === initial.sha256 &&
    current.byteLength === initial.byteLength &&
    current.providerObjectId === initial.providerObjectId &&
    current.providerVersionId === initial.providerVersionId &&
    current.fileServiceLocator.bucketId ===
      initial.fileServiceLocator.bucketId &&
    current.fileServiceLocator.filePath === initial.fileServiceLocator.filePath;
  if (!same) {
    throw s1000dIngressError(
      'S1000D_DOCUMENT_VERSION_DRIFT',
      'The current DocumentVersion or SourceArtifact changed during S1000D production.',
      409,
    );
  }
}

export function validateProducedPackageBinding(
  produced: S1000dStructuredPackageProducerResult,
  source: ResolvedS1000dDocumentSource,
  authorization: S1000dSourceUseAuthorization,
): {
  resultStatus: 'complete' | 'partial';
  contentUnitCount: number;
  sourceRefCount: number;
} {
  if (
    produced.contractId !== 'techpub.parsed-package.v1' ||
    produced.contractRevision !== 'frozen.2' ||
    !/^urn:techpub:package:v1:sha256:[0-9a-f]{64}$/u.test(produced.packageId) ||
    !(produced.bytes instanceof Uint8Array) ||
    produced.bytes.byteLength <= 0 ||
    !produced.producerId.trim() ||
    !produced.producerRevision.trim()
  ) {
    throw producedPackageInvalid('CONTRACT');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(produced.bytes),
    ) as unknown;
  } catch {
    throw producedPackageInvalid('JSON');
  }
  if (!isRecord(parsed)) throw producedPackageInvalid('SHAPE');
  if (
    parsed.$schema !== 'urn:techpub:schema:v1:parsed-package:frozen-2' ||
    parsed.schemaVersion !== produced.contractId ||
    parsed.contractRevision !== produced.contractRevision ||
    parsed.packageId !== produced.packageId
  ) {
    throw producedPackageInvalid('PACKAGE_ID');
  }
  if (!isRecord(parsed.source) || parsed.source.kind !== 'native_s1000d') {
    throw producedPackageInvalid('SOURCE_KIND');
  }
  if (
    !Array.isArray(parsed.artifacts) ||
    !Array.isArray(parsed.source.artifactIds) ||
    !Array.isArray(parsed.contentUnits) ||
    !Array.isArray(parsed.sourceRefs) ||
    !isRecord(parsed.result) ||
    !['complete', 'partial'].includes(String(parsed.result.status))
  ) {
    throw producedPackageInvalid('SOURCE_ARTIFACT');
  }
  const sourceArtifactIds: string[] = stringIds(
    parsed.source.artifactIds,
    'SOURCE_ARTIFACT_ID',
  );
  const packageArtifacts: Map<
    string,
    Record<string, unknown>
  > = packageArtifactIndex(parsed.artifacts);
  const sourceOriginArtifactIds = [...packageArtifacts.entries()]
    .filter(([, artifact]) => artifact.origin === 'source')
    .map(([artifactId]) => artifactId);
  if (
    sourceOriginArtifactIds.length !== sourceArtifactIds.length ||
    sourceOriginArtifactIds.some(
      (packageArtifactId) => !sourceArtifactIds.includes(packageArtifactId),
    )
  ) {
    throw sourceManifestPackageMismatch('SOURCE_ARTIFACT_DECLARATION');
  }
  const manifest: Map<string, S1000dAuthorizedSourceArtifact> =
    authorizedManifestIndex(authorization.authorizedSourceManifest);
  if (
    sourceArtifactIds.length !== manifest.size ||
    sourceArtifactIds.some(
      (packageArtifactId: string) => !manifest.has(packageArtifactId),
    )
  ) {
    throw sourceManifestPackageMismatch('ARTIFACT_SET');
  }
  for (const packageArtifactId of sourceArtifactIds) {
    const artifact = packageArtifacts.get(packageArtifactId);
    const authorized = manifest.get(packageArtifactId);
    if (!artifact || !authorized) {
      throw sourceManifestPackageMismatch('UNKNOWN_ARTIFACT');
    }
    if (
      artifact.origin !== 'source' ||
      artifact.role !== authorized.packageRole ||
      artifact.normalizedPath !== authorized.normalizedPath ||
      artifact.mediaType !== authorized.mediaType ||
      artifact.sha256 !== `sha256:${authorized.sha256}` ||
      artifact.byteLength !== authorized.byteLength
    ) {
      throw sourceManifestPackageMismatch('ARTIFACT_IDENTITY');
    }
  }
  validateSourceRefArtifacts(parsed.sourceRefs, sourceArtifactIds);
  const primary = authorization.authorizedSourceManifest.find(
    (entry: S1000dAuthorizedSourceArtifact) =>
      entry.dependency.kind === 'PRIMARY_DOCUMENT_VERSION',
  );
  if (
    !primary ||
    primary.hostSourceArtifactId !== source.sourceArtifactId ||
    primary.sha256 !== source.sha256 ||
    primary.byteLength !== source.byteLength ||
    primary.mediaType !== source.mediaType
  ) {
    throw sourceManifestPackageMismatch('PRIMARY_SOURCE');
  }
  return {
    resultStatus: parsed.result.status as 'complete' | 'partial',
    contentUnitCount: parsed.contentUnits.length,
    sourceRefCount: parsed.sourceRefs.length,
  };
}

function validateSourceRefArtifacts(
  sourceRefs: unknown[],
  authorizedPackageArtifactIds: string[],
): void {
  const authorized = new Set(authorizedPackageArtifactIds);
  const sourceRefIds = new Set<string>();
  for (const value of sourceRefs) {
    if (
      !isRecord(value) ||
      !requiredString(value.sourceRefId) ||
      !requiredString(value.artifactId) ||
      sourceRefIds.has(value.sourceRefId) ||
      !authorized.has(value.artifactId)
    ) {
      throw sourceManifestPackageMismatch('SOURCE_REF_ARTIFACT');
    }
    sourceRefIds.add(value.sourceRefId);
  }
}

function validateAuthorizedSourceManifest(
  entries: S1000dAuthorizedSourceArtifact[],
  source: ResolvedS1000dDocumentSource,
): void {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw sourceManifestAuthorizationRequired('EMPTY');
  }
  const packageIds = new Set<string>();
  const hostIds = new Set<string>();
  let primary: S1000dAuthorizedSourceArtifact | null = null;
  for (const entry of entries) {
    if (
      !entry ||
      !requiredString(entry.packageArtifactId) ||
      !requiredString(entry.hostSourceArtifactId) ||
      !requiredString(entry.packageRole) ||
      !requiredString(entry.normalizedPath) ||
      !requiredString(entry.mediaType) ||
      !/^[0-9a-f]{64}$/u.test(entry.sha256) ||
      !Number.isSafeInteger(entry.byteLength) ||
      entry.byteLength <= 0 ||
      !requiredString(entry.providerObjectId) ||
      !requiredString(entry.providerVersionId) ||
      !requiredString(entry.fileServiceLocator?.bucketId) ||
      !requiredString(entry.fileServiceLocator?.filePath) ||
      !requiredString(entry.authorizationEvidenceRef) ||
      packageIds.has(entry.packageArtifactId) ||
      hostIds.has(entry.hostSourceArtifactId)
    ) {
      throw sourceManifestAuthorizationRequired('ENTRY');
    }
    packageIds.add(entry.packageArtifactId);
    hostIds.add(entry.hostSourceArtifactId);
    if (entry.dependency.kind === 'PRIMARY_DOCUMENT_VERSION') {
      if (primary || !requiredString(entry.dependency.documentVersionId)) {
        throw sourceManifestAuthorizationRequired('PRIMARY');
      }
      primary = entry;
      continue;
    }
    if (
      entry.dependency.kind !== 'AUTHORIZED_DEPENDENCY' ||
      !requiredString(entry.dependency.parentPackageArtifactId) ||
      !DEPENDENCY_RELATIONSHIPS.has(entry.dependency.relationship)
    ) {
      throw sourceManifestAuthorizationRequired('DEPENDENCY');
    }
  }
  if (
    !primary ||
    primary.dependency.kind !== 'PRIMARY_DOCUMENT_VERSION' ||
    primary.dependency.documentVersionId !== source.documentVersionId ||
    primary.hostSourceArtifactId !== source.sourceArtifactId ||
    primary.packageRole !== 'xml' ||
    primary.normalizedPath !== source.originalFilename ||
    primary.mediaType !== source.mediaType ||
    primary.sha256 !== source.sha256 ||
    primary.byteLength !== source.byteLength ||
    primary.providerObjectId !== source.providerObjectId ||
    primary.providerVersionId !== source.providerVersionId ||
    primary.fileServiceLocator.bucketId !==
      source.fileServiceLocator.bucketId ||
    primary.fileServiceLocator.filePath !== source.fileServiceLocator.filePath
  ) {
    throw sourceManifestAuthorizationRequired('PRIMARY_BINDING');
  }
  assertDependencyClosure(entries, primary.packageArtifactId);
}

function assertDependencyClosure(
  entries: S1000dAuthorizedSourceArtifact[],
  primaryPackageArtifactId: string,
): void {
  const byId = new Map<string, S1000dAuthorizedSourceArtifact>(
    entries.map((entry: S1000dAuthorizedSourceArtifact) => [
      entry.packageArtifactId,
      entry,
    ]),
  );
  for (const entry of entries) {
    let current = entry;
    const visited = new Set<string>();
    while (current.packageArtifactId !== primaryPackageArtifactId) {
      if (
        visited.has(current.packageArtifactId) ||
        current.dependency.kind !== 'AUTHORIZED_DEPENDENCY'
      ) {
        throw sourceManifestAuthorizationRequired('DEPENDENCY_CYCLE');
      }
      visited.add(current.packageArtifactId);
      const parent = byId.get(current.dependency.parentPackageArtifactId);
      if (!parent) {
        throw sourceManifestAuthorizationRequired('DEPENDENCY_PARENT');
      }
      current = parent;
    }
  }
}

function packageArtifactIndex(
  values: unknown[],
): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const value of values) {
    if (!isRecord(value) || !requiredString(value.artifactId)) {
      throw producedPackageInvalid('ARTIFACT_SHAPE');
    }
    if (result.has(value.artifactId)) {
      throw producedPackageInvalid('DUPLICATE_ARTIFACT');
    }
    result.set(value.artifactId, value);
  }
  return result;
}

function authorizedManifestIndex(
  values: S1000dAuthorizedSourceArtifact[],
): Map<string, S1000dAuthorizedSourceArtifact> {
  return new Map(
    values.map((entry: S1000dAuthorizedSourceArtifact) => [
      entry.packageArtifactId,
      entry,
    ]),
  );
}

function stringIds(values: unknown[], reason: string): string[] {
  if (
    values.some((value: unknown) => !requiredString(value)) ||
    new Set(values).size !== values.length
  ) {
    throw producedPackageInvalid(reason);
  }
  return values.map(String);
}

function sourceAuthorizationRequired(): Error & {
  code: string;
  statusCode: number;
} {
  return s1000dIngressError(
    'S1000D_SOURCE_USE_AUTHORIZATION_REQUIRED',
    'S1000D source processing is not authorized.',
    403,
  );
}

function sourceManifestAuthorizationRequired(reason: string): Error & {
  code: string;
  statusCode: number;
} {
  return s1000dIngressError(
    'S1000D_SOURCE_MANIFEST_AUTHORIZATION_REQUIRED',
    `Every S1000D source artifact requires one Host authorization and dependency binding (${reason}).`,
    403,
  );
}

function sourceManifestPackageMismatch(reason: string): Error & {
  code: string;
  statusCode: number;
} {
  return s1000dIngressError(
    'S1000D_SOURCE_MANIFEST_PACKAGE_MISMATCH',
    `The produced package source artifacts do not match the authorized Host manifest (${reason}).`,
    409,
  );
}

function producedPackageInvalid(reason: string): Error & {
  code: string;
  statusCode: number;
} {
  return s1000dIngressError(
    'S1000D_PRODUCED_PACKAGE_INVALID',
    `The S1000D producer result is not bound to canonical frozen.2 source bytes (${reason}).`,
    409,
  );
}

export function s1000dIngressError(
  code: string,
  message: string,
  statusCode: number,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(message), { code, statusCode });
}

function requiredString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
