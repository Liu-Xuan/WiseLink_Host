import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, ilike, lt, or, sql } from 'drizzle-orm';

import type { CanonicalLibraryQuicklookResponse } from '@shared/api.interface';
import {
  dmDocumentVersion,
  dmPublicationFamily,
  workItem,
} from '../../database/schema';

export interface CanonicalLibraryCursor {
  createdAt: string;
  workItemId: string;
}

export interface CanonicalLibraryQueryScope {
  tenantId: string;
  actorUserId: string;
}

const summaryColumns = {
  workItemId: workItem.workItemId,
  revision: workItem.revision,
  phase: workItem.status,
  documentId: workItem.documentId,
  documentVersionId: workItem.documentVersionId,
  documentCode: dmPublicationFamily.canonicalDocumentNumber,
  businessRevision: dmDocumentVersion.businessRevision,
  normalizedFamily: workItem.normalizedFamily,
  originalFilename: dmDocumentVersion.originalFilename,
  byteLength: dmDocumentVersion.byteLength,
  familyId: dmPublicationFamily.familyId,
  selectedVersionIsCurrent: sql<boolean>`coalesce(${dmPublicationFamily.currentDocumentVersionId} = ${workItem.documentVersionId}, false)`,
  packageRegistered: sql<boolean>`${workItem.packageId} is not null and ${workItem.packageArtifactRef} is not null`,
  createdAt: workItem.createdAt,
  updatedAt: workItem.updatedAt,
};

/** No FileService, package reader, or whole WorkItem projection dependency. */
@Injectable()
export class CanonicalLibraryRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async list(
    input: CanonicalLibraryQueryScope & {
      search: string;
      cursor: CanonicalLibraryCursor | null;
      limit: number;
    },
  ) {
    const conditions = [
      eq(workItem.tenantId, input.tenantId),
      eq(workItem.requestedByUserId, input.actorUserId),
    ];
    if (input.search) {
      // Treat user text literally, including PostgreSQL LIKE metacharacters.
      const pattern = `%${input.search.replace(/[\\%_]/gu, '\\$&')}%`;
      conditions.push(
        or(
          ilike(dmPublicationFamily.canonicalDocumentNumber, pattern),
          ilike(dmDocumentVersion.originalFilename, pattern),
          ilike(dmDocumentVersion.businessRevision, pattern),
        )!,
      );
    }
    if (input.cursor) {
      const createdAt = new Date(input.cursor.createdAt);
      conditions.push(
        or(
          lt(workItem.createdAt, createdAt),
          and(
            eq(workItem.createdAt, createdAt),
            lt(workItem.workItemId, input.cursor.workItemId),
          ),
        )!,
      );
    }
    return (
      this.db
        .select(summaryColumns)
        .from(workItem)
        .innerJoin(
          dmDocumentVersion,
          and(
            eq(dmDocumentVersion.documentVersionId, workItem.documentVersionId),
            eq(dmDocumentVersion.documentId, workItem.documentId),
          ),
        )
        .innerJoin(
          dmPublicationFamily,
          eq(dmPublicationFamily.familyId, dmDocumentVersion.familyId),
        )
        .where(and(...conditions))
        // Creation time is immutable: later review updates cannot move rows across pages.
        .orderBy(desc(workItem.createdAt), desc(workItem.workItemId))
        .limit(input.limit + 1)
    );
  }

  async quicklook(input: CanonicalLibraryQueryScope & { workItemId: string }) {
    const [row] = await this.db
      .select({
        ...summaryColumns,
        // Select only the result fields consumed by quicklook; never transfer or
        // JSON.parse projection_json (nor TaskEnvelope / complete result files).
        result: sql<CanonicalLibraryQuicklookResponse['result']>`case
        when ${workItem.projectionJson}::jsonb #> '{integratedAssessment,overallSynthesis}' is null
          or ${workItem.projectionJson}::jsonb #> '{integratedAssessment,overallSynthesis}' = 'null'::jsonb
        then null
        else jsonb_build_object(
          'status', ${workItem.projectionJson}::jsonb #> '{integratedAssessment,overallSynthesis,status}',
          'revision', ${workItem.projectionJson}::jsonb #> '{integratedAssessment,overallSynthesis,revision}',
          'sourceResultId', ${workItem.projectionJson}::jsonb #> '{integratedAssessment,overallSynthesis,sourceResultId}',
          'engineeringSummary', ${workItem.projectionJson}::jsonb #> '{integratedAssessment,overallSynthesis,engineeringSummary}',
          'overallCandidate', ${workItem.projectionJson}::jsonb #> '{integratedAssessment,overallSynthesis,overallCandidate}',
          'missingInputs', coalesce(${workItem.projectionJson}::jsonb #> '{integratedAssessment,overallSynthesis,missingInputs}', '[]'::jsonb),
          'gap', ${workItem.projectionJson}::jsonb #> '{integratedAssessment,overallSynthesis,gap}',
          'staleReason', ${workItem.projectionJson}::jsonb #> '{integratedAssessment,overallSynthesis,staleReason}',
          'sourceCount', coalesce(${workItem.projectionJson}::jsonb #> '{package,sourceRefCount}', '0'::jsonb)
        ) end`,
      })
      .from(workItem)
      .innerJoin(
        dmDocumentVersion,
        and(
          eq(dmDocumentVersion.documentVersionId, workItem.documentVersionId),
          eq(dmDocumentVersion.documentId, workItem.documentId),
        ),
      )
      .innerJoin(
        dmPublicationFamily,
        eq(dmPublicationFamily.familyId, dmDocumentVersion.familyId),
      )
      .where(
        and(
          eq(workItem.tenantId, input.tenantId),
          eq(workItem.requestedByUserId, input.actorUserId),
          eq(workItem.workItemId, input.workItemId),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}

export type CanonicalLibrarySummaryRow = Awaited<
  ReturnType<CanonicalLibraryRepository['list']>
>[number];
