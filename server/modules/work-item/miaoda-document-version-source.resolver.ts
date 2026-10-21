import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { assertSourceIdentity, sourceIdentityQuery } from './document-version-source-identity';
import { tenantFamilyIdentityPrefix } from '../document-management/src/hosted/nest/miaoda-hosted-document-catalog';

import {
  dmCurrentnessDecision,
  dmAcquisition,
  dmDocumentVersion,
  dmIngressPreflight,
  dmPublicationFamily,
  dmSourceArtifact,
} from '../../database/schema';

export interface OwnedFileServicePdfSelection {
  documentVersionId: string;
  sourceArtifactId: string;
  selectionBucketId: string;
  selectionFilePath: string;
  providerObjectId: string;
  providerVersionId: string;
  pdfSha256: string;
  byteLength: number;
}

@Injectable()
export class MiaodaDocumentVersionSourceResolver {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /** Locate an owned original acquisition, never its hash-addressed source copy.
   * The caller must still check current document access and FileService owner. */
  async listOwnedFileServicePdfSelections(input: {
    tenantId: string;
    actorUserId: string;
    bucketId: string;
    search: string;
  }): Promise<{ items: OwnedFileServicePdfSelection[]; sourceTruncated: boolean }> {
    const limit = 24;
    const search = input.search.toLocaleLowerCase();
    const rows = await this.db.select({
      documentVersionId: dmDocumentVersion.documentVersionId,
      sourceArtifactId: dmDocumentVersion.sourceArtifactId,
      selectionBucketId: dmAcquisition.selectionBucketId,
      selectionFilePath: dmAcquisition.selectionFilePath,
      providerObjectId: dmAcquisition.providerObjectId,
      providerVersionId: dmAcquisition.providerVersionId,
      pdfSha256: dmDocumentVersion.pdfSha256,
      byteLength: dmDocumentVersion.byteLength,
    }).from(dmAcquisition)
      .innerJoin(dmDocumentVersion, and(
        eq(dmAcquisition.documentVersionId, dmDocumentVersion.documentVersionId),
        eq(dmAcquisition.sourceArtifactId, dmDocumentVersion.sourceArtifactId),
      ))
      .innerJoin(dmPublicationFamily,
        eq(dmPublicationFamily.familyId, dmDocumentVersion.familyId))
      .innerJoin(dmIngressPreflight, and(
        eq(dmIngressPreflight.acquisitionId, dmAcquisition.acquisitionId),
        eq(dmIngressPreflight.documentVersionId, dmDocumentVersion.documentVersionId),
        eq(dmIngressPreflight.status, 'COMMITTED'),
      ))
      .where(and(
        eq(dmAcquisition.acquiredBy, input.actorUserId),
        eq(dmAcquisition.selectionBucketId, input.bucketId),
        eq(dmAcquisition.sourceChannel, 'canonical_miaoda_document_selection'),
        inArray(dmAcquisition.status, ['COMMITTED_CANONICAL', 'LINKED_EXACT_DOCUMENT_VERSION']),
        eq(dmDocumentVersion.lifecycleStatus, 'COMMITTED_IMMUTABLE'),
        eq(dmDocumentVersion.mediaType, 'application/pdf'),
        eq(dmPublicationFamily.currentDocumentVersionId, dmDocumentVersion.documentVersionId),
        sql`starts_with(${dmPublicationFamily.canonicalIdentityKey}, ${tenantFamilyIdentityPrefix(input.tenantId)})`,
        sql`starts_with(${dmAcquisition.idempotencyKey}, ${`tenant:${encodeURIComponent(input.tenantId)}:request:`})`,
        or(
          sql`position(${search} in lower(${dmDocumentVersion.originalFilename})) > 0`,
          sql`position(${search} in lower(${dmPublicationFamily.canonicalDocumentNumber})) > 0`,
        ),
      ))
      .orderBy(desc(dmAcquisition.acquiredAt), asc(dmAcquisition.acquisitionId))
      .limit(limit + 1);
    return { items: rows.slice(0, limit), sourceTruncated: rows.length > limit };
  }

  /** For already-authorized member validation; no current-head or creator policy is inferred. */
  async resolveIdentity(documentVersionId: string) {
    const [value] = await sourceIdentityQuery(this.db, documentVersionId);
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
