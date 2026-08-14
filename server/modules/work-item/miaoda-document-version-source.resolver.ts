import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq } from 'drizzle-orm';

import {
  dmDocumentVersion,
  dmPublicationFamily,
  dmSourceArtifact,
} from '../../database/schema';

@Injectable()
export class MiaodaDocumentVersionSourceResolver {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async resolve(documentVersionId: string) {
    const [value] = await this.db
      .select({
        version: dmDocumentVersion,
        family: dmPublicationFamily,
        artifact: dmSourceArtifact,
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
    return value;
  }
}
