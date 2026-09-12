import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import type { DocumentSourceSearchResponse } from '@shared/document-source-search.interface';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import type { CanonicalHostActor } from './canonical-host.types';
import { prepareEngineeringSearchQuery } from './engineering-search-text';
import { findDocumentOriginalEvidence } from './document-original-engineering-reading';

@Injectable()
// CanonicalHostModule.register providers.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentSourceSearchService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase, private readonly reader: UnifiedReaderService) {}

  async search(query: string, actor: CanonicalHostActor, scope: 'CURRENT' | 'HISTORY'): Promise<DocumentSourceSearchResponse> {
    const search = query.trim();
    if (!search || search.length > 200 || !['CURRENT','HISTORY'].includes(scope) || !actor.tenantId || !actor.userId)
      throw new BadRequestException('DOCUMENT_SOURCE_SEARCH_INVALID');
    const prepared = prepareEngineeringSearchQuery(search);
    const identifiers = sql`ARRAY[${sql.join(prepared.exactIdentifierCandidates.map(value => sql`${value}`), sql`,`)}]::text[]`;
    const hits: DocumentSourceSearchResponse['hits'] = [];
    let cursor = '';
    const loaded = new Map<string, Awaited<ReturnType<UnifiedReaderService['readDocumentOriginal']>>>();
    while (hits.length < 51) {
      const candidates = await this.db.execute<{ entryId: string; documentVersionId: string; parseRunId: string;
        sourceRefId: string; originalText: string; reason: 'FULL_TEXT' | 'EXACT_IDENTIFIER' }>(sql`
        SELECT p.entry_id AS "entryId", r.document_version_id AS "documentVersionId", r.parse_run_id AS "parseRunId",
          p.locator_ref AS "sourceRefId", p.original_or_work_text AS "originalText",
          CASE WHEN p.identifiers && ${identifiers} THEN 'EXACT_IDENTIFIER' ELSE 'FULL_TEXT' END AS reason
        FROM engineering_search_projection p JOIN dm_document_parse_run r
          ON r.tenant_id=p.tenant_id AND r.parse_run_id=p.exact_revision_ref AND r.document_version_id=p.parent_context_ref
        WHERE p.tenant_id=${actor.tenantId} AND p.owner_kind='SOURCE' AND p.entry_kind='SOURCE'
          AND r.status='PUBLISHED' AND p.entry_id > ${cursor}
          AND (${scope === 'HISTORY'} OR NOT EXISTS (SELECT 1 FROM dm_document_parse_run newer
            WHERE newer.tenant_id=r.tenant_id AND newer.document_version_id=r.document_version_id
              AND newer.status='PUBLISHED' AND newer.parse_revision > r.parse_revision))
          AND (p.search_vector @@ plainto_tsquery('simple',${prepared.tokenizedText})
            OR p.identifiers && ${identifiers}
            OR position(lower(${search}) in lower(p.original_or_work_text)) > 0)
        ORDER BY p.entry_id LIMIT 51`);
      for (const candidate of candidates) {
        try {
          let original = loaded.get(candidate.parseRunId);
          if (!original) {
            original = await this.reader.readDocumentOriginal(candidate.documentVersionId, candidate.parseRunId,
              { tenantId: actor.tenantId, actorUserId: actor.userId, roles: actor.roles });
            loaded.set(candidate.parseRunId, original);
          }
          if (original.run.parseRunId !== candidate.parseRunId || original.run.documentVersionId !== candidate.documentVersionId)
            throw new Error('DOCUMENT_SOURCE_SEARCH_BINDING_MISMATCH');
          const evidence = findDocumentOriginalEvidence(original, candidate.sourceRefId);
          if (evidence.excerpt !== candidate.originalText) throw new Error('DOCUMENT_SOURCE_SEARCH_INDEX_STALE');
          hits.push({ kind: 'SOURCE', documentVersionId: candidate.documentVersionId, parseRunId: candidate.parseRunId,
            parseRevision: original.run.parseRevision, sourceRefId: evidence.sourceRefId, evidenceRef: evidence.evidenceRef,
            originalText: evidence.excerpt, matchedRange: evidence.locator ?? evidence.sourceRefId, reason: candidate.reason,
            rootRefs: [`DOCUMENT_VERSION:${candidate.documentVersionId}`, `DOCUMENT_ORIGINAL:${candidate.documentVersionId}:${candidate.parseRunId}`],
            coverage: original.original.coverage });
          if (hits.length === 51) break;
        } catch (error) {
          const status = error && typeof error === 'object' ? ('getStatus' in error && typeof error.getStatus === 'function'
            ? error.getStatus() : 'statusCode' in error ? error.statusCode : null) : null;
          if (status !== 403 && status !== 404) throw error;
        }
      }
      if (candidates.length < 51) break;
      cursor = candidates[candidates.length-1].entryId;
    }
    return { hits: hits.slice(0,50), hasMore: hits.length > 50,
      limitations: ['仅检索已入索引且当前有权读取的已发布原文；命中不表示全文或图表已读。',
        ...(scope === 'HISTORY' ? ['包含历史解析修订，引用时须核对确切版本。'] : [])] };
  }
}
