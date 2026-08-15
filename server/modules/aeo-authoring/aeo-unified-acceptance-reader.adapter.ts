import { createHash } from 'node:crypto';

import {
  AEO_UNIFIED_ACCEPTANCE_READER_REVISION,
  type AeoUnifiedAcceptanceReaderInput,
  type AeoUnifiedAcceptanceReaderInspection,
} from '../../../shared/aeo-integration';

import { canonicalStringify, sha256Hex } from './aeo-editor-projection.utils';
import { normalizeAeoSpecialistDocxFinalPackage } from './aeo-specialist-package.validation';

export class AeoUnifiedAcceptanceReaderAdapter {
  async inspectActualBytes(
    input: AeoUnifiedAcceptanceReaderInput,
  ): Promise<AeoUnifiedAcceptanceReaderInspection> {
    validateArtifact(input);
    const rawText = new TextDecoder('utf-8', { fatal: true }).decode(
      input.bytes,
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText) as unknown;
    } catch {
      throw new Error('AEO_ACCEPTANCE_READER_REJECTED:JSON_INVALID');
    }
    const pkg = normalizeAeoSpecialistDocxFinalPackage(parsed, {
      formalAeoIdentity: input.context.formalAeoIdentity,
      revision: input.context.revision,
      iteration: input.context.iteration,
      sourceMediaType: input.context.sourceMediaType,
      sourceByteLength: input.context.sourceByteLength,
      sourceSha256: input.context.sourceSha256,
      currentness: input.context.currentness,
      parsePackageId: input.packageId,
      parsePackageHash: input.context.packageHash,
    });
    if (
      pkg.nodes.length === 0 ||
      pkg.nodes.some((node) => node.sourceRefs.length === 0)
    ) {
      throw new Error(
        'AEO_ACCEPTANCE_READER_REJECTED:SOURCE_BOUND_NODES_REQUIRED',
      );
    }
    const summaryHash = sha256Hex(
      canonicalStringify({
        packageId: pkg.parsePackageId,
        packageHash: pkg.packageHash,
        contractVersion: pkg.contractVersion,
        formalIdentity: pkg.formalIdentity,
        originalSource: pkg.originalSource,
        currentness: pkg.currentness,
        projectionKind: pkg.projectionKind,
        nodeIds: pkg.nodes.map((node) => node.nodeId),
        nodeHashes: pkg.nodes.map((node) => node.nodeHash),
        findingCount: pkg.findings.length,
      }),
    );
    return {
      packageId: pkg.parsePackageId,
      contractId: 'aeo_structured_parse_v1',
      contractRevision: 'candidate.1',
      handlerId: 'AeoStructuredParseCandidateReader',
      handlerRevision: AEO_UNIFIED_ACCEPTANCE_READER_REVISION,
      summaryHash: `sha256:${summaryHash}`,
      sourceBoundUnitCount: pkg.nodes.length,
    };
  }
}

function validateArtifact(input: AeoUnifiedAcceptanceReaderInput): void {
  if (
    input.context.family !== 'AEO' ||
    input.artifact.storeRole !== 'UnifiedArtifactStoreCandidate' ||
    input.artifact.mediaType !== 'application/json' ||
    input.artifact.byteLength !== input.bytes.byteLength ||
    input.artifact.sha256 !== sha256Bytes(input.bytes) ||
    input.packageId !==
      `AEOPARSE-${input.context.packageHash.slice(0, 24).toUpperCase()}`
  ) {
    throw new Error('AEO_ACCEPTANCE_READER_REJECTED:ARTIFACT_BINDING');
  }
}

function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
