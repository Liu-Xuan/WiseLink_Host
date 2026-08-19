import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, eq } from 'drizzle-orm';

import {
  dmCurrentnessDecision,
  dmDocumentVersion,
  dmPublicationFamily,
  dmSourceArtifact,
} from '../../database/schema';

@Injectable()
export class MiaodaDocumentVersionSourceResolver {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async resolve(
    documentVersionId: string,
    options: { requireCurrent?: boolean } = {},
  ) {
    const [value] = await this.db
      .select({
        version: dmDocumentVersion,
        family: dmPublicationFamily,
        artifact: dmSourceArtifact,
        currentness: dmCurrentnessDecision,
      })
      .from(dmDocumentVersion)
      .innerJoin(
        dmPublicationFamily,
        eq(dmDocumentVersion.familyId, dmPublicationFamily.familyId),
      )
      .innerJoin(
        dmSourceArtifact,
        eq(dmDocumentVersion.sourceArtifactId, dmSourceArtifact.sourceArtifactId),
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
      value.version.lifecycleStatus !== 'COMMITTED_IMMUTABLE' ||
      value.artifact.readbackVerified !== true ||
      value.version.pdfSha256 !== value.artifact.sha256 ||
      Number(value.version.byteLength) !== Number(value.artifact.byteLength)
    ) {
      throw new Error('DOCUMENT_VERSION_SOURCE_IDENTITY_INVALID');
    }
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
