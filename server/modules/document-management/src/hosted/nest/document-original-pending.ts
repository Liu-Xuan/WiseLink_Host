import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { engineeringSearchProjectionPending } from '@server/database/engineering-search.schema';

/** Await after the publish CAS using that same transaction. The exact parse
 * run stores the verified manifest; this marker never duplicates its content.
 * Index work acknowledges this marker after persistence. Matter impact is
 * reconciled independently from immutable published versions and saved coverage.
 */
export async function registerPublishedDocumentOriginal(
  database: PostgresJsDatabase,
  run: { tenantId: string; actorUserId: string; documentVersionId: string;
    parseRunId: string; parseRevision: number; status: string },
): Promise<void> {
  if (run.status !== 'PUBLISHED' || !Number.isSafeInteger(run.parseRevision) || run.parseRevision < 1 ||
      [run.tenantId, run.actorUserId, run.documentVersionId, run.parseRunId].some(value => !value)) {
    throw new Error('DOCUMENT_ORIGINAL_PUBLICATION_IDENTITY_INVALID');
  }
  await database.insert(engineeringSearchProjectionPending).values({
    tenantId: run.tenantId, ownerKind: 'SOURCE', ownerId: run.actorUserId,
    subjectId: run.documentVersionId, exactRevisionRef: run.parseRunId,
    lastError: '', attempts: 0,
  }).onConflictDoNothing({
    target: [engineeringSearchProjectionPending.tenantId, engineeringSearchProjectionPending.exactRevisionRef],
  });
}
