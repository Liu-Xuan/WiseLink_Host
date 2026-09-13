import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import type { DocumentOriginalResult } from '@shared/document-original.interface';
import type { DocumentSemanticMap } from '@shared/document-semantic-map.interface';
import { assertDocumentSemanticMap } from '../document-management/src/hosted/nest/document-semantic-map';

type Scope = { tenantId: string; actorUserId: string; documentVersionId: string };

@Injectable()
// Registered by CanonicalHostModule.forRoot.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentSemanticRevisionRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  /** Caller has fresh document source authorization; RLS also applies to every read. */
  async read(scope: Scope, parseRunId: string, revision?: number): Promise<DocumentSemanticMap | null> {
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1))
      throw new Error('DOCUMENT_SEMANTIC_REVISION_INVALID');
    const rows = await this.db.execute<{ map: DocumentSemanticMap }>(sql`
      SELECT map_json AS map FROM dm_document_semantic_revision
      WHERE tenant_id=${scope.tenantId} AND document_version_id=${scope.documentVersionId}
        AND parse_run_id=${parseRunId} ${revision === undefined ? sql`` : sql`AND semantic_revision=${revision}`}
      ORDER BY semantic_revision DESC LIMIT 1`);
    return rows[0]?.map ?? null;
  }

  /** Deterministic organization of an authorized original. No plugin call spans this transaction. */
  async append(scope: Scope, original: DocumentOriginalResult, map: DocumentSemanticMap,
    expectedRevision: number, manifestSha256: string): Promise<DocumentSemanticMap> {
    if (original.binding.documentVersionId !== scope.documentVersionId || !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 || map.semanticRevision !== expectedRevision + 1)
      throw new Error('DOCUMENT_SEMANTIC_REVISION_CONFLICT');
    assertDocumentSemanticMap(map, original);
    return this.db.transaction(async tx => {
      // Serialize revisions on the existing document key, without changing the original row.
      const versions = await tx.execute(sql`SELECT document_version_id FROM dm_document_version
        WHERE document_version_id=${scope.documentVersionId} FOR UPDATE`);
      if (!versions.length) throw new Error('DOCUMENT_VERSION_NOT_FOUND');
      const source = await tx.execute(sql`SELECT parse_run_id FROM dm_document_parse_run
        WHERE tenant_id=${scope.tenantId} AND document_version_id=${scope.documentVersionId}
          AND parse_run_id=${original.binding.parseRunId} AND parse_revision=${original.binding.parseRevision}
          AND status='PUBLISHED' AND manifest_artifact->>'sha256'=${manifestSha256} FOR SHARE`);
      if (!source.length) throw new Error('DOCUMENT_SEMANTIC_ORIGINAL_CHANGED');
      const rows = await tx.execute<{ revision: number; map: DocumentSemanticMap }>(sql`
        SELECT semantic_revision AS revision, map_json AS map FROM dm_document_semantic_revision
        WHERE tenant_id=${scope.tenantId} AND document_version_id=${scope.documentVersionId}
          AND parse_run_id=${original.binding.parseRunId} ORDER BY semantic_revision DESC LIMIT 1`);
      const current = rows[0];
      if ((current?.revision ?? 0) !== expectedRevision)
        throw new Error('DOCUMENT_SEMANTIC_REVISION_CONFLICT');
      const saved = await tx.execute<{ map: DocumentSemanticMap }>(sql`
        INSERT INTO dm_document_semantic_revision
          (tenant_id,document_version_id,parse_run_id,parse_revision,semantic_revision,actor_user_id,
           profile_ref,original_manifest_sha256,map_json)
        VALUES (${scope.tenantId},${scope.documentVersionId},${original.binding.parseRunId},
          ${original.binding.parseRevision},${map.semanticRevision},${scope.actorUserId},
          ${map.profileRef},${manifestSha256},${JSON.stringify(map)}::jsonb)
        RETURNING map_json AS map`);
      if (!saved[0]) throw new Error('DOCUMENT_SEMANTIC_SAVE_FAILED');
      assertDocumentSemanticMap(saved[0].map, original);
      return saved[0].map;
    });
  }
}
