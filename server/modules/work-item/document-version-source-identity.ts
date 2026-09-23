import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  dmAcquisition,
  dmDocumentVersion,
  dmIngressPreflight,
  dmPublicationFamily,
  dmSourceArtifact,
} from '../../database/schema';

/** Shared required registration query; callers must establish fresh access first. */
export function sourceIdentityQuery(
  db: PostgresJsDatabase,
  documentVersionId: string,
) {
  return sourceIdentityBase(db)
    .where(eq(dmDocumentVersion.documentVersionId, documentVersionId))
    .limit(1);
}

/** The same required registration joins for a bounded, already-authorized group. */
export function sourceIdentityBatchQuery(
  db: PostgresJsDatabase,
  documentVersionIds: string[],
) {
  return sourceIdentityBase(db).where(
    inArray(dmDocumentVersion.documentVersionId, documentVersionIds),
  );
}

function sourceIdentityBase(db: PostgresJsDatabase) {
  return db
    .select({
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
        byteLength: sql<number>`${dmSourceArtifact.byteLength}`.as(
          'source_artifact_byte_length',
        ),
      },
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
    );
}

export function assertSourceIdentity(value: {
  version: {
    lifecycleStatus: string;
    pdfSha256: string;
    byteLength: number | string;
  };
  artifact: {
    readbackVerified: boolean;
    sha256: string;
    byteLength: number | string;
  };
}): void {
  if (
    value.version.lifecycleStatus !== 'COMMITTED_IMMUTABLE' ||
    value.artifact.readbackVerified !== true ||
    value.version.pdfSha256 !== value.artifact.sha256 ||
    Number(value.version.byteLength) !== Number(value.artifact.byteLength)
  ) {
    throw new Error('DOCUMENT_VERSION_SOURCE_IDENTITY_INVALID');
  }
}
