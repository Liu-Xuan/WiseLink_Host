import { projectCanonicalStructuredContentUnit } from '../canonical-host/canonical-structured-content-projection';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import { sha256Raw } from '../unified-reader/unified-reader.utils';
import type {
  ResolvedS1000dDocumentSource,
  S1000dBrowserQueryUnit,
  S1000dDocumentSourcePort,
  S1000dIngressReadModel,
  S1000dIngressRequest,
  S1000dSourceUseAuthorization,
  S1000dSourceUseAuthorizerPort,
  S1000dStructuredPackageProducerPort,
} from './s1000d-ingress.types';
import type { CanonicalHostActor } from '../canonical-host/canonical-host.types';

/**
 * S1000D-specific adapter seam for the existing canonical chain:
 *
 *   DM DocumentVersion/SourceArtifact -> server-owned producer -> frozen.2
 *     -> U0 + the sole UnifiedReader -> browser-safe projection.
 *
 * The class owns no parser, storage or Reader implementation. It intentionally
 * remains outside AppModule until the DM owner supports XML DocumentVersions
 * and the deployment binds both authorization and producer ports.
 */
export class S1000dIngressService {
  constructor(
    private readonly sources: S1000dDocumentSourcePort,
    private readonly authorizer: S1000dSourceUseAuthorizerPort,
    private readonly producer: S1000dStructuredPackageProducerPort,
    private readonly reader: UnifiedReaderService,
  ) {}

  async ingest(
    request: S1000dIngressRequest,
    actor: CanonicalHostActor,
  ): Promise<S1000dIngressReadModel> {
    validateRequest(request);
    const source: ResolvedS1000dDocumentSource =
      await this.sources.resolveCurrent(request.documentVersionId);
    validateResolvedSource(source, request.documentVersionId);

    // Authorization is resolved before FileService actual bytes are read.
    const authorization: S1000dSourceUseAuthorization =
      await this.authorizer.authorize({
        actor,
        workItemId: request.workItemId,
        requestId: request.requestId,
        source,
      });
    validateAuthorization(authorization, source);

    const actualBytes: Uint8Array = await this.sources.readActualBytes(source);
    if (
      actualBytes.byteLength !== source.byteLength ||
      sha256Raw(actualBytes) !== source.sha256
    ) {
      throw ingressError(
        'S1000D_SOURCE_ACTUAL_BYTE_MISMATCH',
        'The canonical SourceArtifact descriptor does not match actual FileService bytes.',
        409,
      );
    }

    const produced = await this.producer.produce({
      source,
      actualBytes,
      authorization,
    });
    validateProducedPackageBinding(produced, source);

    // This is the existing artifact store, U0 validator and UnifiedReader
    // path. No S1000D-specific persistence or reader is introduced here.
    const readback = await this.reader.persistAndReadback(produced.bytes, {
      workItemId: request.workItemId,
      requestId: request.requestId,
      documentVersionId: request.documentVersionId,
      permissionSnapshotVersion: authorization.permissionSnapshotVersion,
      packageId: produced.packageId,
      contractId: produced.contractId,
      contractRevision: produced.contractRevision,
      query: request.query,
    });
    if (readback.package.sourceKind !== 'native_s1000d') {
      throw ingressError(
        'S1000D_READER_SOURCE_KIND_MISMATCH',
        'UnifiedReader did not identify the accepted package as native S1000D.',
        409,
      );
    }

    const units: S1000dBrowserQueryUnit[] = readback.queryResults.map(
      (unit, index) => {
        const projected = projectCanonicalStructuredContentUnit(
          unit,
          index + 1,
        );
        if (projected === null) {
          return {
            resultIndex: index + 1,
            unitId: unit.unitId,
            displayKind: 'unavailable' as const,
            outlineKind: 'NONE' as const,
            sectionTitle: null,
            displayText: '该结构单元暂不支持直接阅读。',
            sourceRefIds: [...unit.sourceRefIds],
            sourceLocators: [],
          };
        }
        return {
          ...projected,
          resultIndex: index + 1,
          unitId: unit.unitId,
        };
      },
    );

    return {
      schemaVersion: 'wiselink.3_1.s1000d_ingress_read_model.v1.candidate',
      status: 'CANDIDATE_READBACK_VERIFIED',
      workItemId: request.workItemId,
      requestId: request.requestId,
      documentVersionId: request.documentVersionId,
      sourceKind: 'native_s1000d',
      package: {
        packageId: readback.package.packageId,
        contractId: 'techpub.parsed-package.v1',
        contractRevision: 'frozen.2',
        resultStatus: readback.package.resultStatus,
        title: readback.package.title,
        revisionLabel: readback.package.revisionLabel,
        contentUnitCount: readback.package.contentUnitCount,
        sourceRefCount: readback.package.sourceRefCount,
      },
      authorization: {
        decisionId: authorization.decisionId,
        sourceClass: authorization.sourceClass,
        processingAuthorized: true,
        canonicalPackageStorageAuthorized: true,
        browserProjectionAuthorized: true,
      },
      query: {
        text: request.query,
        resultCount: units.length,
        units,
      },
      boundary: {
        actualSourceBytesExposed: false,
        fileServiceLocatorExposed: false,
        packageArtifactLocatorExposed: false,
        nativeXmlLocatorExposed: false,
        applicabilityIsInstallationFact: false,
        publicationAuthorized: false,
        currentSelectionChanged: false,
      },
    };
  }
}

function validateRequest(request: S1000dIngressRequest): void {
  exactKeys(
    request,
    ['workItemId', 'requestId', 'documentVersionId', 'query'],
    'request',
  );
  requiredText(request.workItemId, 'workItemId', 300);
  requiredText(request.requestId, 'requestId', 300);
  requiredText(request.documentVersionId, 'documentVersionId', 300);
  const query = requiredText(request.query, 'query', 200);
  if (query.length < 2) {
    throw ingressError(
      'S1000D_QUERY_INVALID',
      'query must contain at least two characters.',
      400,
    );
  }
}

function validateResolvedSource(
  source: ResolvedS1000dDocumentSource,
  expectedDocumentVersionId: string,
): void {
  if (
    source.documentVersionId !== expectedDocumentVersionId ||
    !source.documentId.trim() ||
    !source.sourceArtifactId.trim() ||
    !source.originalFilename.trim() ||
    !['application/xml', 'text/xml'].includes(source.mediaType) ||
    !/^[0-9a-f]{64}$/u.test(source.sha256) ||
    !Number.isSafeInteger(source.byteLength) ||
    source.byteLength <= 0 ||
    !source.providerObjectId.trim() ||
    !source.fileServiceLocator.bucketId.trim() ||
    !source.fileServiceLocator.filePath.trim()
  ) {
    throw ingressError(
      'S1000D_DOCUMENT_VERSION_SOURCE_INVALID',
      'DocumentVersion is not bound to one readable canonical XML SourceArtifact.',
      409,
    );
  }
}

function validateAuthorization(
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
    throw ingressError(
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
}

function validateProducedPackageBinding(
  produced: Awaited<ReturnType<S1000dStructuredPackageProducerPort['produce']>>,
  source: ResolvedS1000dDocumentSource,
): void {
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
  const packageSource = parsed.source;
  if (
    !Array.isArray(parsed.artifacts) ||
    !Array.isArray(packageSource.artifactIds)
  ) {
    throw producedPackageInvalid('SOURCE_ARTIFACT');
  }
  const sourceArtifactIds = packageSource.artifactIds;
  const expectedHash = `sha256:${source.sha256}`;
  const matchingArtifacts = parsed.artifacts.filter(
    (artifact): artifact is Record<string, unknown> =>
      isRecord(artifact) &&
      artifact.origin === 'source' &&
      artifact.role === 'xml' &&
      artifact.sha256 === expectedHash &&
      artifact.byteLength === source.byteLength &&
      artifact.mediaType === source.mediaType &&
      typeof artifact.artifactId === 'string' &&
      sourceArtifactIds.includes(artifact.artifactId),
  );
  if (matchingArtifacts.length !== 1) {
    throw producedPackageInvalid('SOURCE_ACTUAL_BYTES_UNBOUND');
  }
}

function exactKeys(
  value: unknown,
  keys: readonly string[],
  field: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw ingressError(
      'S1000D_INGRESS_REQUEST_INVALID',
      `${field} must be an object.`,
      400,
    );
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw ingressError(
      'S1000D_INGRESS_REQUEST_INVALID',
      `${field} contains unknown or missing fields.`,
      400,
    );
  }
}

function requiredText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== 'string') {
    throw ingressError(
      'S1000D_INGRESS_REQUEST_INVALID',
      `${field} is required.`,
      400,
    );
  }
  const normalized = value.trim().normalize('NFC');
  if (!normalized || normalized.length > maxLength) {
    throw ingressError(
      'S1000D_INGRESS_REQUEST_INVALID',
      `${field} is invalid.`,
      400,
    );
  }
  return normalized;
}

function sourceAuthorizationRequired(): Error & {
  code: string;
  statusCode: number;
} {
  return ingressError(
    'S1000D_SOURCE_USE_AUTHORIZATION_REQUIRED',
    'S1000D source processing is not authorized.',
    403,
  );
}

function producedPackageInvalid(reason: string): Error & {
  code: string;
  statusCode: number;
} {
  return ingressError(
    'S1000D_PRODUCED_PACKAGE_INVALID',
    `The S1000D producer result is not bound to canonical frozen.2 source bytes (${reason}).`,
    409,
  );
}

function ingressError(
  code: string,
  message: string,
  statusCode: number,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(message), { code, statusCode });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
