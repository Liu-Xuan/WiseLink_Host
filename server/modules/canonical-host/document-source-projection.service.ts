import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, eq, sql } from 'drizzle-orm';
import { dmDocumentParseRun } from '../../database/document-parsing.schema';
import { engineeringSearchProjectionPending as pendingTable } from '../../database/engineering-search.schema';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import { EngineeringSearchProjectionWriter } from './engineering-search-projection';
import { documentOriginalEngineeringReading } from './document-original-engineering-reading';
import { extractEngineeringSearchIdentifiers } from './engineering-search-text';
import { DocumentSemanticService } from './document-semantic.service';

@Injectable()
// Registered by CanonicalHostModule.register.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentSourceProjectionService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly reader: UnifiedReaderService, private readonly writer: EngineeringSearchProjectionWriter,
    private readonly semantics: DocumentSemanticService) {}

  async nextPendingRun(scope: { tenantId: string; actorUserId: string; documentVersionId: string }): Promise<string | null> {
    const [pending] = await this.db.select({ parseRunId: dmDocumentParseRun.parseRunId }).from(pendingTable)
      .innerJoin(dmDocumentParseRun, and(eq(dmDocumentParseRun.tenantId,pendingTable.tenantId),
        eq(dmDocumentParseRun.parseRunId,pendingTable.exactRevisionRef),eq(dmDocumentParseRun.documentVersionId,pendingTable.subjectId)))
      .where(and(eq(pendingTable.tenantId,scope.tenantId),eq(pendingTable.subjectId,scope.documentVersionId),
        eq(pendingTable.ownerId,scope.actorUserId),eq(pendingTable.ownerKind,'SOURCE'),eq(dmDocumentParseRun.status,'PUBLISHED')))
      .orderBy(asc(pendingTable.attempts),asc(dmDocumentParseRun.parseRevision)).limit(1);
    return pending?.parseRunId ?? null;
  }

  /** Caller holds the exact authorized Hosted document/actor SQL scope. */
  async step(scope: { tenantId: string; actorUserId: string; documentVersionId: string; roles: string[] }, parseRunId: string) {
    const identity = and(eq(pendingTable.tenantId, scope.tenantId), eq(pendingTable.ownerKind, 'SOURCE'),
      eq(pendingTable.ownerId, scope.actorUserId), eq(pendingTable.subjectId, scope.documentVersionId),
      eq(pendingTable.exactRevisionRef, parseRunId));
    // Always use the normal Reader, including retries of an already indexed run.
    const loaded = await this.reader.readDocumentOriginal(scope.documentVersionId, parseRunId, scope);
    const semanticMap = await this.semantics.ensure(scope, loaded);
    const [pending] = await this.db.select().from(pendingTable).where(identity).limit(1);
    if (!pending) return { status: 'NO_PENDING' as const, documentVersionId: scope.documentVersionId, parseRunId,
      semanticRevision: semanticMap.semanticRevision, profileRef: semanticMap.profileRef };
    const reading = documentOriginalEngineeringReading(loaded, pending.sourceNextOffset, 20);
    if (reading.documentVersionId !== scope.documentVersionId || reading.binding.parseRunId !== parseRunId)
      throw new Error('DOCUMENT_SOURCE_PROJECTION_BINDING_MISMATCH');
    const entries = reading.evidence.map(evidence => {
      const ordinal = loaded.structuredSource.sourceLocators.findIndex(item => item.sourceRefId === evidence.sourceRefId);
      if (ordinal < 0) throw new Error('DOCUMENT_ORIGINAL_SOURCE_LOCATOR_MISSING');
      return { entryId: `SRC:${parseRunId}:${ordinal}`, ownerKind: 'SOURCE' as const,
        ownerId: scope.actorUserId, exactRevisionRef: parseRunId, entryKind: 'SOURCE' as const,
        locatorRef: evidence.sourceRefId, parentContextRef: scope.documentVersionId,
        title: evidence.title, originalText: evidence.excerpt, identifiers: extractEngineeringSearchIdentifiers(evidence.excerpt) };
    });
    try {
      return await this.db.transaction(async tx => {
        const [current] = await tx.select().from(pendingTable).where(identity).for('update');
        if (!current || current.sourceNextOffset !== pending.sourceNextOffset)
          return { status: 'RETRY' as const, documentVersionId: scope.documentVersionId, parseRunId };
        // Parse-row RLS rechecks current document access inside the write transaction.
        const [run] = await tx.select().from(dmDocumentParseRun).where(and(
          eq(dmDocumentParseRun.tenantId, scope.tenantId), eq(dmDocumentParseRun.documentVersionId, scope.documentVersionId),
          eq(dmDocumentParseRun.parseRunId, parseRunId), eq(dmDocumentParseRun.status, 'PUBLISHED'))).for('share');
        if (!run || run.manifestArtifact?.sha256 !== reading.artifactSha256)
          throw new Error('DOCUMENT_SOURCE_PROJECTION_AUTHORIZATION_CHANGED');
        await this.writer.indexAuthorizedSourceEntries({ tenantId: scope.tenantId, entries, database: tx });
        const complete = reading.nextOffset === null;
        if (complete) {
          // Matter input reconciliation reads immutable published parse versions,
          // independently of this derived-index marker. Removing it cannot lose
          // an original-change wakeup: next_matter_assessment compares that version
          // with saved coverage and registers its ordinary idempotent successor.
          await tx.delete(pendingTable).where(identity);
        } else await tx.update(pendingTable).set({ sourceNextOffset: reading.offset + reading.units.length, lastError: '' }).where(identity);
        return { status: complete ? 'INDEXED' as const : 'PROGRESS' as const,
          documentVersionId: scope.documentVersionId, parseRunId, nextOffset: reading.nextOffset };
      });
    } catch (error) {
      let diagnostic = 'DOCUMENT_SOURCE_PROJECTION_FAILED';
      for (let cause = error, depth = 0; cause instanceof Error && depth < 5; cause = cause.cause, depth++) {
        const code = 'code' in cause ? cause.code : cause.message;
        if (typeof code === 'string' && /^[A-Z0-9_:-]+$/.test(code)) diagnostic = code;
      }
      await this.db.update(pendingTable).set({ lastError: diagnostic,
        attempts: sql`${pendingTable.attempts} + 1` }).where(identity);
      throw error;
    }
  }
}
