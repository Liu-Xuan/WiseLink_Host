import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, ilike, lt, or, sql } from 'drizzle-orm';

import type { CanonicalLibraryDocumentVersionSummary } from '@shared/api.interface';
import {
  dmAcquisition,
  dmDocument,
  dmDocumentVersion,
  dmDocumentVersionMetadata,
  dmPublicationFamily,
  workItem,
} from '@server/database/schema';
import { tenantFamilyIdentityPrefix } from './miaoda-hosted-document-catalog';

export interface OwnedLibraryFamilyQuery {
  tenantId: string;
  actorUserId: string;
  search: string;
  normalizedFamily?: string;
  ata?: string;
  aircraftModel?: string;
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
        extractedMetadata: dmDocumentVersionMetadata.extractedMetadata,
        metadataRevision: dmDocumentVersionMetadata.metadataRevision,
        byteLength: dmDocumentVersion.byteLength,
        committedAt: dmDocumentVersion.committedAt,
        selectedVersionIsCurrent:
          sql<boolean>`coalesce(${dmPublicationFamily.currentDocumentVersionId} = ${dmDocumentVersion.documentVersionId}, false)`.as(
            'is_current',
          ),
        readerWorkItemId: sql<string>`coalesce(${owned.workItemId}, '')`.as(
          'reader_work_item_id',
        ),
        workItemCount: sql<number>`coalesce(${owned.workItemCount}, 0)`.as(
          'owned_task_count',
        ),
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
      .leftJoin(
        dmDocumentVersionMetadata,
        and(
          eq(
            dmDocumentVersionMetadata.documentVersionId,
            dmDocumentVersion.documentVersionId,
          ),
          // Metadata revisions are append-only; choose the latest for this exact
          // document version before search, grouping and facet counts.
          sql`${dmDocumentVersionMetadata.metadataRevision} = (
            select max(latest_metadata.metadata_revision)
            from ${dmDocumentVersionMetadata} latest_metadata
            where latest_metadata.document_version_id = ${dmDocumentVersion.documentVersionId}
          )`,
        ),
      )
      .leftJoin(
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
        and(
          sql`starts_with(${dmPublicationFamily.canonicalIdentityKey}, ${tenantFamilyIdentityPrefix(input.tenantId)})`,
          sql`(${owned.workItemId} is not null or exists (
            select 1 from ${dmAcquisition} a
            where a.document_version_id = ${dmDocumentVersion.documentVersionId}
              and a.source_artifact_id = ${dmDocumentVersion.sourceArtifactId}
              and a.acquired_by = ${input.actorUserId}
              and a.status in ('COMMITTED_CANONICAL', 'LINKED_EXACT_DOCUMENT_VERSION')
              and starts_with(a.idempotency_key, ${`tenant:${encodeURIComponent(input.tenantId)}:request:`})
          ))`,
        ),
      ),
  );

  const pattern = `%${input.search.replace(/[\\%_]/gu, '\\$&')}%`;
  const cursor = input.cursor;
  const matched = db.$with('library_matched_families').as(
    db
      .select({
        familyId: versions.familyId,
        documentId: versions.documentId,
        documentCode: versions.documentCode,
        normalizedFamily: versions.normalizedFamily,
        issuerAuthority: versions.issuerAuthority,
        createdAt: versions.createdAt,
        updatedAt: versions.updatedAt,
        ataValues: sql<
          string[]
        >`jsonb_path_query_array(jsonb_agg(${versions.extractedMetadata}), '$[*].ata.observations[*].value')`.as(
          'ata_values',
        ),
        aircraftValues: sql<
          string[]
        >`jsonb_path_query_array(jsonb_agg(${versions.extractedMetadata}), '$[*].mentionedAircraftModels.observations[*].value')`.as(
          'aircraft_values',
        ),
        workItemCount: sql<number>`sum(${versions.workItemCount})::integer`.as(
          'work_item_count',
        ),
        versions: sql<
          CanonicalLibraryDocumentVersionSummary[]
        >`jsonb_agg(jsonb_build_object(
      'documentVersionId', ${versions.documentVersionId},
      'businessRevision', ${versions.businessRevision},
      'revisionDate', ${versions.revisionDate},
      'sourceGeneratedDate', ${versions.sourceGeneratedDate},
      'originalFilename', ${versions.originalFilename},
      'extractedMetadata', ${versions.extractedMetadata},
      'metadataRevision', ${versions.metadataRevision},
      'byteLength', ${versions.byteLength},
      'committedAt', ${versions.committedAt},
      'selectedVersionIsCurrent', ${versions.selectedVersionIsCurrent},
      'readerWorkItemId', ${versions.readerWorkItemId},
      'workItemCount', ${versions.workItemCount}
    ) order by ${versions.selectedVersionIsCurrent} desc,
      ${versions.committedAt} desc, ${versions.documentVersionId} desc)`.as(
          'versions',
        ),
      })
      .from(versions)
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
              ilike(versions.issuerAuthority, pattern),
              sql`exists (select 1 from jsonb_each(${versions.extractedMetadata}) f,
                jsonb_array_elements(case when jsonb_typeof(f.value->'observations') = 'array'
                  then f.value->'observations' else '[]'::jsonb end) observation
                where f.key in ('title', 'documentType', 'issuer', 'ata', 'mentionedAircraftModels')
                  and observation->>'value' ilike ${pattern})`,
            )})`
          : undefined,
      ),
  );
  const filtered = db.$with('library_filtered_families').as(
    db
      .select()
      .from(matched)
      .where(
        and(
          input.normalizedFamily
            ? input.normalizedFamily === '__UNKNOWN__'
              ? sql`${matched.normalizedFamily} = ''`
              : eq(matched.normalizedFamily, input.normalizedFamily)
            : undefined,
          input.ata
            ? input.ata === '__UNKNOWN__'
              ? sql`jsonb_array_length(${matched.ataValues}) = 0`
              : sql`${matched.ataValues} ? ${input.ata}`
            : undefined,
          input.aircraftModel
            ? input.aircraftModel === '__UNKNOWN__'
              ? sql`jsonb_array_length(${matched.aircraftValues}) = 0`
              : sql`${matched.aircraftValues} ? ${input.aircraftModel}`
            : undefined,
        ),
      ),
  );
  const page = db.$with('library_family_page').as(
    db
      .select()
      .from(filtered)
      .where(
        cursor
          ? or(
              lt(filtered.createdAt, new Date(cursor.createdAt)),
              and(
                eq(filtered.createdAt, new Date(cursor.createdAt)),
                lt(filtered.familyId, cursor.itemId),
              ),
            )
          : undefined,
      )
      .orderBy(desc(filtered.createdAt), desc(filtered.familyId))
      .limit(input.limit + 1),
  );
  return db
    .with(owned, versions, matched, filtered, page)
    .select({
      totalCount: sql<number>`(select count(*)::integer from ${filtered})`,
      familyCounts: sql<
        Record<string, number>
      >`coalesce((select jsonb_object_agg(family, total) from
      (select coalesce(nullif(${matched.normalizedFamily}, ''), '__UNKNOWN__') as family, count(*)::integer as total from ${matched} group by ${matched.normalizedFamily}) counts), '{}'::jsonb)`,
      ataCounts: sql<
        Record<string, number>
      >`coalesce((select jsonb_object_agg(value, total) from
      (select facet.value, count(distinct ${matched.familyId})::integer total from ${matched}
       cross join lateral jsonb_array_elements_text(case when jsonb_array_length(${matched.ataValues}) = 0 then '["__UNKNOWN__"]'::jsonb else ${matched.ataValues} end) facet(value)
       group by facet.value) counts), '{}'::jsonb)`,
      aircraftModelCounts: sql<
        Record<string, number>
      >`coalesce((select jsonb_object_agg(value, total) from
      (select facet.value, count(distinct ${matched.familyId})::integer total from ${matched}
       cross join lateral jsonb_array_elements_text(case when jsonb_array_length(${matched.aircraftValues}) = 0 then '["__UNKNOWN__"]'::jsonb else ${matched.aircraftValues} end) facet(value)
       group by facet.value) counts), '{}'::jsonb)`,
      rows: sql<
        Array<{
          familyId: string;
          documentId: string;
          documentCode: string;
          normalizedFamily: string;
          issuerAuthority: string;
          createdAt: string;
          updatedAt: string;
          workItemCount: number;
          versions: CanonicalLibraryDocumentVersionSummary[];
        }>
      >`coalesce((select jsonb_agg(jsonb_build_object(
      'familyId', ${page.familyId}, 'documentId', ${page.documentId}, 'documentCode', ${page.documentCode},
      'normalizedFamily', ${page.normalizedFamily}, 'issuerAuthority', ${page.issuerAuthority},
      'createdAt', ${page.createdAt}, 'updatedAt', ${page.updatedAt},
      'workItemCount', ${page.workItemCount}, 'versions', ${page.versions}
    ) order by ${page.createdAt} desc, ${page.familyId} desc) from ${page}), '[]'::jsonb)`,
    })
    .from(sql`(values (1)) as one(value)`);
}

export type OwnedLibraryFamilyRow = Awaited<
  ReturnType<typeof listOwnedLibraryFamilies>
>[number];
