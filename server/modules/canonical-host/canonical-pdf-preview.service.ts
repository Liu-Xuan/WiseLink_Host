import { randomBytes } from 'node:crypto';

import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalPdfPreviewProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';

import { MiaodaFileServiceArtifactStore } from '../document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import {
  CANONICAL_AUTHORIZATION,
  CANONICAL_PERMISSION_SNAPSHOT,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from './canonical-host.constants';
import type {
  CanonicalAuthorizationDecision,
  CanonicalAuthorizationPort,
  CanonicalHostActor,
  CanonicalPermissionSnapshotPort,
  CanonicalWorkItemRegistrarPort,
} from './canonical-host.types';

const PDF_MEDIA_TYPE = 'application/pdf' as const;
const PREVIEW_TTL_MS = 12 * 60 * 1000;
const PREVIEW_MAX_BYTES = 25 * 1024 * 1024;
const PREVIEW_MAX_GRANTS = 2_048;

interface CanonicalPdfPreviewGrant {
  actorUserId: string;
  tenantId: string;
  workItemId: string;
  workItemRevision: number;
  documentVersionId: string;
  sourceArtifactId: string;
  sourceSha256: string;
  sourceByteLength: number;
  providerObjectId: string;
  expiresAtMs: number;
}

interface BoundPdfSource {
  projection: CanonicalWorkItemProjection;
  source: Awaited<ReturnType<MiaodaDocumentVersionSourceResolver['resolve']>>;
}

export type CanonicalPdfPreviewReadResult =
  | {
      kind: 'HEAD';
      byteLength: number;
    }
  | {
      kind: 'FULL';
      byteLength: number;
      bytes: Buffer;
    }
  | {
      kind: 'RANGE_UNSUPPORTED';
      byteLength: number;
    };

@Injectable()
export class CanonicalPdfPreviewService {
  private readonly grants = new Map<string, CanonicalPdfPreviewGrant>();
  private readonly sources: MiaodaFileServiceArtifactStore;

  constructor(
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(CANONICAL_AUTHORIZATION)
    private readonly authorization: CanonicalAuthorizationPort,
    @Inject(CANONICAL_PERMISSION_SNAPSHOT)
    private readonly permissionSnapshots: CanonicalPermissionSnapshotPort,
    private readonly documentVersions: MiaodaDocumentVersionSourceResolver,
    fileService: FileService,
  ) {
    this.sources = new MiaodaFileServiceArtifactStore(fileService, {
      maxBytes: PREVIEW_MAX_BYTES,
    });
  }

  async issue(
    projection: CanonicalWorkItemProjection,
    actor: CanonicalHostActor,
  ): Promise<CanonicalPdfPreviewProjection> {
    if (projection.source.sourceByteLength > PREVIEW_MAX_BYTES) {
      return unavailable('PDF_PREVIEW_SOURCE_TOO_LARGE', false);
    }
    try {
      const source = await this.documentVersions.resolve(
        projection.source.documentVersionId,
        {
          requireCurrent: true,
          expectedCreatorUserId: actor.userId,
        },
      );
      if (
        source.version.mediaType !== PDF_MEDIA_TYPE ||
        source.artifact.mediaType !== PDF_MEDIA_TYPE
      ) {
        return unavailable('PDF_PREVIEW_SOURCE_NOT_PDF', false);
      }
      if (!sourceMatchesProjection(source, projection)) {
        return unavailable('PDF_PREVIEW_SOURCE_IDENTITY_INVALID', false);
      }

      const nowMs: number = Date.now();
      this.prune(nowMs);
      const opaqueLocator: string = this.newLocator();
      const expiresAtMs: number = nowMs + PREVIEW_TTL_MS;
      this.grants.set(opaqueLocator, {
        actorUserId: actor.userId,
        tenantId: actor.tenantId,
        workItemId: projection.workItemId,
        workItemRevision: projection.revision,
        documentVersionId: projection.source.documentVersionId,
        sourceArtifactId: projection.source.sourceArtifactId,
        sourceSha256: projection.source.sourceFileSha256,
        sourceByteLength: projection.source.sourceByteLength,
        providerObjectId: source.artifact.providerObjectId,
        expiresAtMs,
      });
      return {
        status: 'AVAILABLE',
        opaqueLocator,
        expiresAt: new Date(expiresAtMs).toISOString(),
        mediaType: PDF_MEDIA_TYPE,
        byteLength: projection.source.sourceByteLength,
        supportsRange: false,
        navigation: 'PAGE_START',
      };
    } catch (error) {
      if (isSourceIdentityFailure(error)) {
        return unavailable('PDF_PREVIEW_SOURCE_IDENTITY_INVALID', false);
      }
      return unavailable('PDF_PREVIEW_SERVICE_UNAVAILABLE', true);
    }
  }

  async read(input: {
    actor: CanonicalHostActor;
    workItemId: string;
    opaqueLocator: string;
    method: 'GET' | 'HEAD';
    range: string | null;
  }): Promise<CanonicalPdfPreviewReadResult> {
    const grant: CanonicalPdfPreviewGrant = this.requireGrant(input);
    const bound: BoundPdfSource = await this.freshBoundSource(input, grant);
    if (input.range !== null && input.range.trim().length > 0) {
      return {
        kind: 'RANGE_UNSUPPORTED',
        byteLength: grant.sourceByteLength,
      };
    }
    if (input.method === 'HEAD') {
      return { kind: 'HEAD', byteLength: grant.sourceByteLength };
    }

    try {
      const readback = await this.sources.readSelection({
        bucketId: bound.source.artifact.bucketId,
        filePath: bound.source.artifact.filePath,
      });
      if (
        readback.providerObjectId !== grant.providerObjectId ||
        readback.sha256 !== grant.sourceSha256 ||
        readback.byteLength !== grant.sourceByteLength ||
        readback.mediaType !== PDF_MEDIA_TYPE ||
        !readback.bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))
      ) {
        throw previewError('PDF_PREVIEW_SOURCE_DRIFT', 409);
      }
      return {
        kind: 'FULL',
        byteLength: readback.byteLength,
        bytes: readback.bytes,
      };
    } catch (error) {
      if (previewStatus(error) === 409) throw error;
      if (previewCode(error) === 'SOURCE_BYTES_TOO_LARGE') {
        throw previewError('PDF_PREVIEW_SOURCE_TOO_LARGE', 413);
      }
      throw previewError('PDF_PREVIEW_SERVICE_UNAVAILABLE', 503);
    }
  }

  private requireGrant(input: {
    actor: CanonicalHostActor;
    workItemId: string;
    opaqueLocator: string;
  }): CanonicalPdfPreviewGrant {
    const locator: string = input.opaqueLocator.trim();
    const grant: CanonicalPdfPreviewGrant | undefined =
      this.grants.get(locator);
    if (
      !grant ||
      grant.workItemId !== input.workItemId ||
      grant.actorUserId !== input.actor.userId ||
      grant.tenantId !== input.actor.tenantId
    ) {
      throw previewError('PDF_PREVIEW_NOT_FOUND', 404);
    }
    if (Date.now() >= grant.expiresAtMs) {
      this.grants.delete(locator);
      throw previewError('PDF_PREVIEW_LOCATOR_EXPIRED', 410);
    }
    return grant;
  }

  private async freshBoundSource(
    input: { actor: CanonicalHostActor; workItemId: string },
    grant: CanonicalPdfPreviewGrant,
  ): Promise<BoundPdfSource> {
    await this.freshAuthorize(input.actor, input.workItemId, grant);
    let projection: CanonicalWorkItemProjection;
    try {
      projection = await this.registrar.getTenantScopedByWorkItemId({
        workItemId: input.workItemId,
        tenantId: input.actor.tenantId,
      });
    } catch (error) {
      if (previewStatus(error) === 404) {
        throw previewError('PDF_PREVIEW_NOT_FOUND', 404);
      }
      throw previewError('PDF_PREVIEW_SERVICE_UNAVAILABLE', 503);
    }
    if (
      projection.revision !== grant.workItemRevision ||
      projection.source.documentVersionId !== grant.documentVersionId ||
      projection.source.sourceArtifactId !== grant.sourceArtifactId ||
      projection.source.sourceFileSha256 !== grant.sourceSha256 ||
      projection.source.sourceByteLength !== grant.sourceByteLength
    ) {
      throw previewError('PDF_PREVIEW_SOURCE_DRIFT', 409);
    }
    try {
      const source = await this.documentVersions.resolve(
        grant.documentVersionId,
        {
          requireCurrent: true,
          expectedCreatorUserId: input.actor.userId,
        },
      );
      if (
        !sourceMatchesProjection(source, projection) ||
        source.artifact.providerObjectId !== grant.providerObjectId ||
        source.version.mediaType !== PDF_MEDIA_TYPE ||
        source.artifact.mediaType !== PDF_MEDIA_TYPE
      ) {
        throw previewError('PDF_PREVIEW_SOURCE_DRIFT', 409);
      }
      return { projection, source };
    } catch (error) {
      if (previewStatus(error) === 409) throw error;
      throw previewError('PDF_PREVIEW_SOURCE_DRIFT', 409);
    }
  }

  private async freshAuthorize(
    actor: CanonicalHostActor,
    workItemId: string,
    grant: CanonicalPdfPreviewGrant,
  ): Promise<void> {
    try {
      const decision: CanonicalAuthorizationDecision =
        await this.authorization.authorize({
          actor,
          action: 'READ_DOCUMENT_PARSING',
          workItemId,
          documentVersionId: grant.documentVersionId,
        });
      if (
        decision.allowed !== true ||
        decision.action !== 'READ_DOCUMENT_PARSING'
      ) {
        throw previewError('PDF_PREVIEW_NOT_FOUND', 404);
      }
      const fresh = await this.permissionSnapshots.freshRead({
        actor,
        decision,
        workItemId,
        documentVersionId: grant.documentVersionId,
      });
      if (
        fresh.permissionSnapshotVersion !== decision.permissionSnapshotVersion
      ) {
        throw previewError('PDF_PREVIEW_SOURCE_DRIFT', 409);
      }
    } catch (error) {
      const status: number | null = previewStatus(error);
      if (isPreviewError(error) && (status === 404 || status === 409)) {
        throw error;
      }
      if (status === 404) throw previewError('PDF_PREVIEW_NOT_FOUND', 404);
      throw previewError('PDF_PREVIEW_SERVICE_UNAVAILABLE', 503);
    }
  }

  private newLocator(): string {
    let locator: string;
    do {
      locator = randomBytes(32).toString('base64url');
    } while (this.grants.has(locator));
    return locator;
  }

  private prune(nowMs: number): void {
    for (const [locator, grant] of this.grants) {
      if (grant.expiresAtMs <= nowMs) this.grants.delete(locator);
    }
    while (this.grants.size >= PREVIEW_MAX_GRANTS) {
      const oldest: string | undefined = this.grants.keys().next().value;
      if (!oldest) break;
      this.grants.delete(oldest);
    }
  }
}

function sourceMatchesProjection(
  source: Awaited<ReturnType<MiaodaDocumentVersionSourceResolver['resolve']>>,
  projection: CanonicalWorkItemProjection,
): boolean {
  return (
    source.version.documentVersionId === projection.source.documentVersionId &&
    source.version.sourceArtifactId === projection.source.sourceArtifactId &&
    source.artifact.sourceArtifactId === projection.source.sourceArtifactId &&
    source.version.pdfSha256 === projection.source.sourceFileSha256 &&
    source.artifact.sha256 === projection.source.sourceFileSha256 &&
    Number(source.version.byteLength) === projection.source.sourceByteLength &&
    Number(source.artifact.byteLength) === projection.source.sourceByteLength &&
    source.artifact.readbackVerified === true
  );
}

function unavailable(
  reason: Extract<
    CanonicalPdfPreviewProjection,
    { status: 'UNAVAILABLE' }
  >['reason'],
  retryable: boolean,
): CanonicalPdfPreviewProjection {
  return { status: 'UNAVAILABLE', reason, retryable };
}

function previewError(
  code: string,
  statusCode: number,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode });
}

function previewCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code: unknown = error.code;
  return typeof code === 'string' ? code : null;
}

function previewStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('statusCode' in error)) {
    return null;
  }
  const statusCode: unknown = error.statusCode;
  return typeof statusCode === 'number' ? statusCode : null;
}

function isPreviewError(error: unknown): boolean {
  return previewCode(error)?.startsWith('PDF_PREVIEW_') === true;
}

function isSourceIdentityFailure(error: unknown): boolean {
  const identity = `${previewCode(error) ?? ''} ${
    error instanceof Error ? error.message : ''
  }`;
  return /DOCUMENT_VERSION_(?:SOURCE_IDENTITY_INVALID|NOT_CURRENT|CURRENTNESS_UNVERIFIED|NOT_FOUND)/u.test(
    identity,
  );
}
