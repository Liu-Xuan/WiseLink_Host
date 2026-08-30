import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';

import type { CanonicalHostActor } from '../canonical-host/canonical-host.types';
import { U0FullValidationService } from '../unified-reader/u0-full-validation.service';
import { sha256Raw } from '../unified-reader/unified-reader.utils';
import type {
  ResolvedS1000dDocumentSource,
  S1000dDocumentSourcePort,
  S1000dIngressCandidateStatus,
  S1000dIngressRequest,
  S1000dSourceUseAuthorization,
  S1000dSourceUseAuthorizerPort,
  S1000dStructuredPackageProducerPort,
} from './s1000d-ingress.types';
import {
  assertCurrentSourceUnchanged,
  s1000dIngressError,
  validateAuthorization,
  validateProducedPackageBinding,
  validateResolvedSource,
} from './s1000d-ingress.validation';

/**
 * S1000D-specific adapter seam for the existing canonical chain:
 *
 *   DM DocumentVersion/SourceArtifact -> server-owned producer -> frozen.2
 *     -> full U0 validation -> non-persisted candidate status.
 *
 * The class owns no parser, storage, correlation, WorkItem state transition or
 * Reader implementation. Persist/correlation/readback remains exclusively
 * owned by the canonical vertical once that owner accepts this candidate seam.
 */
export class S1000dIngressService {
  constructor(
    private readonly sources: S1000dDocumentSourcePort,
    private readonly authorizer: S1000dSourceUseAuthorizerPort,
    private readonly producer: S1000dStructuredPackageProducerPort,
    private readonly validator: U0FullValidationService,
  ) {}

  async ingest(
    request: S1000dIngressRequest,
    actor: CanonicalHostActor,
  ): Promise<S1000dIngressCandidateStatus> {
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
      throw s1000dIngressError(
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
    const summary = validateProducedPackageBinding(
      produced,
      source,
      authorization,
    );

    // Producer execution may be long-running. Re-resolve the same current
    // DocumentVersion immediately before U0 validation. Any drift is rejected
    // while this adapter still has no persistence or correlation capability.
    const currentSource: ResolvedS1000dDocumentSource =
      await this.sources.resolveCurrent(request.documentVersionId);
    validateResolvedSource(currentSource, request.documentVersionId);
    assertCurrentSourceUnchanged(source, currentSource);

    const artifact: UnifiedPackageArtifactDescriptor = candidateDescriptor(
      produced.bytes,
    );
    const proof = await this.validator.validate({
      artifact,
      bytes: produced.bytes,
      packageId: produced.packageId,
    });

    return {
      schemaVersion: 'wiselink.3_1.s1000d_ingress_candidate_status.v1',
      status: 'CANDIDATE_U0_VALIDATED',
      sourceKind: 'native_s1000d',
      contract: {
        id: 'techpub.parsed-package.v1',
        revision: 'frozen.2',
        validatorStatus: proof.status,
      },
      summary: {
        ...summary,
        authorizedSourceArtifactCount:
          authorization.authorizedSourceManifest.length,
      },
      boundary: {
        currentDocumentVersionRechecked: true,
        canonicalArtifactPersisted: false,
        professionalArtifactCorrelated: false,
        workItemStateChanged: false,
        readerProjectionCreated: false,
        actualSourceBytesExposed: false,
        internalIdentityExposed: false,
        applicabilityIsInstallationFact: false,
        publicationAuthorized: false,
        currentSelectionChanged: false,
      },
    };
  }
}

function candidateDescriptor(
  bytes: Uint8Array,
): UnifiedPackageArtifactDescriptor {
  const sha256: string = sha256Raw(bytes);
  return {
    storeRole: 'UnifiedArtifactStoreCandidate',
    ref: `artifact://validation-only/s1000d/sha256/${sha256}`,
    sha256,
    byteLength: bytes.byteLength,
    mediaType: 'application/json',
  };
}

function validateRequest(request: S1000dIngressRequest): void {
  exactKeys(
    request,
    ['workItemId', 'requestId', 'documentVersionId'],
    'request',
  );
  requiredText(request.workItemId, 'workItemId', 300);
  requiredText(request.requestId, 'requestId', 300);
  requiredText(request.documentVersionId, 'documentVersionId', 300);
}

function exactKeys(
  value: unknown,
  keys: readonly string[],
  field: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw s1000dIngressError(
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
    throw s1000dIngressError(
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
    throw s1000dIngressError(
      'S1000D_INGRESS_REQUEST_INVALID',
      `${field} is required.`,
      400,
    );
  }
  const normalized = value.trim().normalize('NFC');
  if (!normalized || normalized.length > maxLength) {
    throw s1000dIngressError(
      'S1000D_INGRESS_REQUEST_INVALID',
      `${field} is invalid.`,
      400,
    );
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
