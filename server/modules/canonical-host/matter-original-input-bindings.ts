import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { EngineeringMatterWorkingInputBinding, EngineeringMatterOriginalInputBinding } from '@shared/matter-working.interface';
import { dmDocumentParseRun } from '../../database/document-parsing.schema';

/** Call after ordinary input authorization; parse rows additionally enforce their own RLS. */
export async function bindMatterOriginalInputs(database: Pick<PostgresJsDatabase, 'select'>, tenantId: string,
  inputs: EngineeringMatterWorkingInputBinding[]): Promise<EngineeringMatterWorkingInputBinding[]> {
  if (!inputs.length) return [];
  const rows = await database.select({ documentVersionId: dmDocumentParseRun.documentVersionId,
    parseRunId: dmDocumentParseRun.parseRunId, parseRevision: dmDocumentParseRun.parseRevision,
    semantic: sql<EngineeringMatterOriginalInputBinding['semantic']>`(SELECT jsonb_build_object('revision',s.semantic_revision,'profileRef',s.profile_ref)
      FROM dm_document_semantic_revision s WHERE s.tenant_id="dm_document_parse_run"."tenant_id"
        AND s.document_version_id="dm_document_parse_run"."document_version_id" AND s.parse_run_id="dm_document_parse_run"."parse_run_id"
      ORDER BY s.semantic_revision DESC LIMIT 1)` })
    .from(dmDocumentParseRun).where(and(eq(dmDocumentParseRun.tenantId,tenantId),
      inArray(dmDocumentParseRun.documentVersionId,[...new Set(inputs.map(item => item.documentVersionId))]),
      eq(dmDocumentParseRun.status,'PUBLISHED'), sql`${dmDocumentParseRun.manifestArtifact}->>'relativePath' = 'original/manifest.json'`))
    .orderBy(desc(dmDocumentParseRun.parseRevision));
  const latest = new Map<string, EngineeringMatterOriginalInputBinding>();
  for (const row of rows) if (!latest.has(row.documentVersionId))
    latest.set(row.documentVersionId,{ parseRunId: row.parseRunId, parseRevision: row.parseRevision,
      ...(row.semantic ? {semantic:row.semantic} : {}) });
  return inputs.map(({ original: _oldOriginal, ...input }) => ({ ...input,
    ...(latest.has(input.documentVersionId) ? { original: latest.get(input.documentVersionId)! } : {}) }));
}
