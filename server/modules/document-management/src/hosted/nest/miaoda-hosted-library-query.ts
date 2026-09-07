import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, ilike, lt, or, sql } from 'drizzle-orm';

import type { CanonicalLibraryDocumentVersionSummary } from '@shared/api.interface';
import {
  dmDocument,
  dmDocumentVersion,
  dmPublicationFamily,
  workItem,
} from '@server/database/schema';
import { tenantFamilyIdentityPrefix } from './miaoda-hosted-document-catalog';

export interface OwnedLibraryFamilyQuery {
  tenantId: string;
  actorUserId: string;
  search: string;
  cursor: { createdAt: string; itemId: string } | null;
  limit: number;
}

/** DM owns identity/currentness. Owned tasks only establish visibility and reader links. */
export function listOwnedLibraryFamilies(
  db: PostgresJsDatabase,
  input: OwnedLibraryFamilyQuery,
) {
  const owned = db.$with('library_owned_tasks').as(
    db
      .select({
        documentId: workItem.documentId,
        documentVersionId: workItem.documentVersionId,
        workItemId: workItem.workItemId,
        workItemCount:
          sql<number>`(count(*) over (partition by ${workItem.documentId}, ${workItem.documentVersionId}))::integer`.as(
            'task_count',
          ),
        rank: sql<number>`row_number() over (
      partition by ${workItem.documentId}, ${workItem.documentVersionId}
      order by (${workItem.packageId} is not null and ${workItem.packageArtifactRef} is not null) desc,
        ${workItem.createdAt} desc, ${workItem.workItemId} desc
    )`.as('reader_rank'),
      })
      .from(workItem)
      .where(
        and(
          eq(workItem.tenantId, input.tenantId),
          eq(workItem.requestedByUserId, input.actorUserId),
        ),
      ),
  );

  const versions = db.$with('library_owned_versions').as(
    db
      .select({
        familyId: dmPublicationFamily.familyId,
        documentId: dmDocument.documentId,
        documentCode: dmPublicationFamily.canonicalDocumentNumber,
        normalizedFamily: dmPublicationFamily.documentFamily,
        issuerAuthority: dmPublicationFamily.issuerAuthority,
        createdAt: dmPublicationFamily.createdAt,
        updatedAt: dmPublicationFamily.updatedAt,
        documentVersionId: dmDocumentVersion.documentVersionId,
        businessRevision: dmDocumentVersion.businessRevision,
        revisionDate: dmDocumentVersion.revisionDate,
        sourceGeneratedDate: dmDocumentVersion.sourceGeneratedDate,
        originalFilename: dmDocumentVersion.originalFilename,
        byteLength: dmDocumentVersion.byteLength,
        committedAt: dmDocumentVersion.committedAt,
        selectedVersionIsCurrent:
          sql<boolean>`coalesce(${dmPublicationFamily.currentDocumentVersionId} = ${dmDocumentVersion.documentVersionId}, false)`.as(
            'is_current',
          ),
        readerWorkItemId: owned.workItemId,
        workItemCount: owned.workItemCount,
      })
      .from(dmDocument)
      .innerJoin(
        dmPublicationFamily,
        eq(dmPublicationFamily.familyId, dmDocument.familyId),
      )
      .innerJoin(
        dmDocumentVersion,
        and(
          eq(dmDocumentVersion.documentId, dmDocument.documentId),
          eq(dmDocumentVersion.familyId, dmDocument.familyId),
        ),
      )
      .innerJoin(
        owned,
        and(
          eq(owned.documentVersionId, dmDocumentVersion.documentVersionId),
          eq(owned.documentId, dmDocument.documentId),
          eq(owned.rank, 1),
        ),
      )
      // Match the existing DM ingress catalog's tenant namespace. Legacy task
      // records remain in task history without becoming another current document.
      .where(
        sql`starts_with(${dmPublicationFamily.canonicalIdentityKey}, ${tenantFamilyIdentityPrefix(input.tenantId)})`,
      ),
  );

  const pattern = `%${input.search.replace(/[\\%_]/gu, '\\$&')}%`;
  const cursor = input.cursor;
  return (
    db
      .with(owned, versions)
      .select({
        familyId: versions.familyId,
        documentId: versions.documentId,
        documentCode: versions.documentCode,
        normalizedFamily: versions.normalizedFamily,
        issuerAuthority: versions.issuerAuthority,
        createdAt: versions.createdAt,
        updatedAt: versions.updatedAt,
        workItemCount: sql<number>`sum(${versions.workItemCount})::integer`,
        versions: sql<
          CanonicalLibraryDocumentVersionSummary[]
        >`jsonb_agg(jsonb_build_object(
      'documentVersionId', ${versions.documentVersionId},
      'businessRevision', ${versions.businessRevision},
      'revisionDate', ${versions.revisionDate},
      'sourceGeneratedDate', ${versions.sourceGeneratedDate},
      'originalFilename', ${versions.originalFilename},
      'byteLength', ${versions.byteLength},
      'committedAt', ${versions.committedAt},
      'selectedVersionIsCurrent', ${versions.selectedVersionIsCurrent},
      'readerWorkItemId', ${versions.readerWorkItemId},
      'workItemCount', ${versions.workItemCount}
    ) order by ${versions.selectedVersionIsCurrent} desc,
      ${versions.committedAt} desc, ${versions.documentVersionId} desc)`,
      })
      .from(versions)
      .where(
        cursor
          ? or(
              lt(versions.createdAt, new Date(cursor.createdAt)),
              and(
                eq(versions.createdAt, new Date(cursor.createdAt)),
                lt(versions.familyId, cursor.itemId),
              ),
            )
          : undefined,
      )
      .groupBy(
        versions.familyId,
        versions.documentId,
        versions.documentCode,
        versions.normalizedFamily,
        versions.issuerAuthority,
        versions.createdAt,
        versions.updatedAt,
      )
      // Search decides whether to include the family, preserving its other versions.
      .having(
        input.search
          ? sql`bool_or(${or(
              ilike(versions.documentCode, pattern),
              ilike(versions.originalFilename, pattern),
              ilike(versions.businessRevision, pattern),
              ilike(versions.normalizedFamily, pattern),
            )})`
          : undefined,
      )
      .orderBy(desc(versions.createdAt), desc(versions.familyId))
      .limit(input.limit + 1)
  );
}

export type OwnedLibraryFamilyRow = Awaited<
  ReturnType<typeof listOwnedLibraryFamilies>
>[number];
