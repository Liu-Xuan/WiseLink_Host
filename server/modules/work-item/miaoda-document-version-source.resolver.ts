import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, eq } from 'drizzle-orm';

import {
  dmCurrentnessDecision,
  dmAcquisition,
  dmDocumentVersion,
  dmIngressPreflight,
  dmPublicationFamily,
  dmSourceArtifact,
} from '../../database/schema';

@Injectable()
export class MiaodaDocumentVersionSourceResolver {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /** For already-authorized member validation; no current-head or creator policy is inferred. */
  async resolveIdentity(documentVersionId: string) {
    const [value] = await this.db.select({
      version: {
        documentId: dmDocumentVersion.documentId,
        documentVersionId: dmDocumentVersion.documentVersionId,
        lifecycleStatus: dmDocumentVersion.lifecycleStatus,
        pdfSha256: dmDocumentVersion.pdfSha256,
        byteLength: dmDocumentVersion.byteLength,
      },
      artifact: {
        readbackVerified: dmSourceArtifact.readbackVerified,
        sha256: dmSourceArtifact.sha256,
        byteLength: dmSourceArtifact.byteLength,
      },
    }).from(dmDocumentVersion)
      .innerJoin(dmPublicationFamily, eq(dmDocumentVersion.familyId, dmPublicationFamily.familyId))
      .innerJoin(dmSourceArtifact, eq(dmDocumentVersion.sourceArtifactId, dmSourceArtifact.sourceArtifactId))
      .innerJoin(dmAcquisition, eq(dmDocumentVersion.acquisitionId, dmAcquisition.acquisitionId))
      .innerJoin(dmIngressPreflight, and(
        eq(dmIngressPreflight.acquisitionId, dmAcquisition.acquisitionId),
        eq(dmIngressPreflight.documentVersionId, dmDocumentVersion.documentVersionId),
        eq(dmIngressPreflight.status, 'COMMITTED'),
      ))
      .where(eq(dmDocumentVersion.documentVersionId, documentVersionId)).limit(1);
    if (!value) throw new Error('DOCUMENT_VERSION_NOT_FOUND');
    assertSourceIdentity(value);
    return { version: { documentId: value.version.documentId, documentVersionId: value.version.documentVersionId } };
  }

  async resolve(
    documentVersionId: string,
    options: { requireCurrent?: boolean; expectedCreatorUserId?: string } = {},
  ) {
    const [value] = await this.db
      .select({
        version: dmDocumentVersion,
        family: dmPublicationFamily,
        artifact: dmSourceArtifact,
        acquisition: dmAcquisition,
        preflight: dmIngressPreflight,
        currentness: dmCurrentnessDecision,
      })
      .from(dmDocumentVersion)
      .innerJoin(
        dmPublicationFamily,
        eq(dmDocumentVersion.familyId, dmPublicationFamily.familyId),
      )
      .innerJoin(
        dmSourceArtifact,
        eq(
          dmDocumentVersion.sourceArtifactId,
          dmSourceArtifact.sourceArtifactId,
        ),
      )
      .innerJoin(
        dmAcquisition,
        eq(dmDocumentVersion.acquisitionId, dmAcquisition.acquisitionId),
      )
      .innerJoin(
        dmIngressPreflight,
        and(
          eq(dmIngressPreflight.acquisitionId, dmAcquisition.acquisitionId),
          eq(
            dmIngressPreflight.documentVersionId,
            dmDocumentVersion.documentVersionId,
          ),
          eq(dmIngressPreflight.status, 'COMMITTED'),
        ),
      )
      .leftJoin(
        dmCurrentnessDecision,
        and(
          eq(dmCurrentnessDecision.familyId, dmPublicationFamily.familyId),
          eq(
            dmCurrentnessDecision.nextDocumentVersionId,
            dmPublicationFamily.currentDocumentVersionId,
          ),
          eq(
            dmCurrentnessDecision.nextGeneration,
            dmPublicationFamily.currentGeneration,
          ),
        ),
      )
      .where(eq(dmDocumentVersion.documentVersionId, documentVersionId))
      .limit(1);
    if (!value) throw new Error('DOCUMENT_VERSION_NOT_FOUND');
    if (
      options.expectedCreatorUserId &&
      (value.version.committedBy !== options.expectedCreatorUserId ||
        value.acquisition.acquiredBy !== options.expectedCreatorUserId)
    ) {
      throw Object.assign(new Error('DOCUMENT_VERSION_NOT_FOUND'), {
        code: 'DOCUMENT_VERSION_NOT_FOUND',
        statusCode: 404,
      });
    }
    assertSourceIdentity(value);
    if (options.requireCurrent) {
      if (value.family.currentDocumentVersionId !== documentVersionId) {
        throw Object.assign(new Error('DOCUMENT_VERSION_NOT_CURRENT'), {
          code: 'DOCUMENT_VERSION_NOT_CURRENT',
          statusCode: 409,
        });
      }
      if (
        value.family.currentGeneration <= 0 ||
        !value.currentness ||
        value.currentness.familyId !== value.family.familyId ||
        value.currentness.nextDocumentVersionId !== documentVersionId ||
        value.currentness.nextGeneration !== value.family.currentGeneration
      ) {
        throw Object.assign(
          new Error('DOCUMENT_VERSION_CURRENTNESS_UNVERIFIED'),
          {
            code: 'DOCUMENT_VERSION_CURRENTNESS_UNVERIFIED',
            statusCode: 409,
          },
        );
      }
    }
    return value;
  }
}

function assertSourceIdentity(value: {
  version: { lifecycleStatus: string; pdfSha256: string; byteLength: number | string };
  artifact: { readbackVerified: boolean; sha256: string; byteLength: number | string };
}): void {
  if (value.version.lifecycleStatus !== 'COMMITTED_IMMUTABLE'
    || value.artifact.readbackVerified !== true
    || value.version.pdfSha256 !== value.artifact.sha256
    || Number(value.version.byteLength) !== Number(value.artifact.byteLength)) {
    throw new Error('DOCUMENT_VERSION_SOURCE_IDENTITY_INVALID');
  }
}
