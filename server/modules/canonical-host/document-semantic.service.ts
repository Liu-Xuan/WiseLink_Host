import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import { DocumentSemanticRevisionRepository } from './document-semantic-revision.repository';
import { assertDocumentSemanticMap, buildDocumentSemanticMap } from '../document-management/src/hosted/nest/document-semantic-map';
import { BOEING_FTD_SEMANTIC_PROFILE, GENERIC_SEMANTIC_PROFILE } from '../document-management/src/hosted/nest/document-semantic-profile';

type Scope = { tenantId: string; actorUserId: string; documentVersionId: string; roles: string[] };
type Loaded = Awaited<ReturnType<UnifiedReaderService['readDocumentOriginal']>>;

@Injectable()
// Registered by CanonicalHostModule.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentSemanticService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly revisions: DocumentSemanticRevisionRepository) {}

  /** Pure organization is saved by the existing authorized INDEX operation, never by GET. */
  async ensure(scope: Scope, loaded: Loaded) {
    const existing = await this.read(scope, loaded);
    if (existing) return existing;
    const rows = await this.db.execute<{ family: string; issuer: string }>(sql`
      SELECT f.document_family AS family, f.issuer_authority AS issuer
      FROM dm_document_version v JOIN dm_publication_family f ON f.family_id=v.family_id
      WHERE v.document_version_id=${scope.documentVersionId}`);
    if (!rows[0]) throw new Error('DOCUMENT_SEMANTIC_FAMILY_NOT_FOUND');
    // SB supplier/airframe layout is not yet verified by registered family alone.
    const profile = rows[0].family === 'FTD' && rows[0].issuer === 'BOEING'
      ? BOEING_FTD_SEMANTIC_PROFILE : GENERIC_SEMANTIC_PROFILE;
    const map = buildDocumentSemanticMap({ original: loaded.original, semanticRevision: 1, profile });
    const manifest = loaded.run.manifestArtifact;
    if (!manifest || manifest.readback !== 'VERIFIED') throw new Error('DOCUMENT_ORIGINAL_MANIFEST_REQUIRED');
    try {
      return await this.revisions.append(scope, loaded.original, map, 0, manifest.sha256);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'DOCUMENT_SEMANTIC_REVISION_CONFLICT') throw error;
      // A concurrent normal INDEX may have saved the same first revision.
      const saved = await this.read(scope, loaded, 1);
      if (!saved || !isDeepStrictEqual(saved, map)) throw error;
      return saved;
    }
  }

  /** Caller has loaded this exact original through the authorized Reader. */
  async read(scope: Scope, loaded: Loaded, revision?: number) {
    if (loaded.original.binding.documentVersionId !== scope.documentVersionId ||
      loaded.run.tenantId !== scope.tenantId) throw new Error('DOCUMENT_SEMANTIC_SCOPE_MISMATCH');
    const map = await this.revisions.read(scope, loaded.run.parseRunId, revision);
    if (map) assertDocumentSemanticMap(map, loaded.original);
    else if (revision !== undefined) throw new Error('DOCUMENT_SEMANTIC_REVISION_NOT_FOUND');
    return map;
  }
}
