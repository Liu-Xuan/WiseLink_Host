import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import { dmDocumentVersion } from '@server/database/schema';
import { dmDocumentParseRun } from '@server/database/document-parsing.schema';
import type { MineruDocumentVersionBinding, MineruStoredArtifact } from '../../../../professional-input/mineru/mineru-artifact-store';

export interface DocumentParseScope {
  tenantId: string;
  actorUserId: string;
  documentVersionId: string;
}
export type DocumentParseRow = typeof dmDocumentParseRun.$inferSelect;
const ACTIVE = ['RUNNING', 'STAGING'] as const;
const sourceColumns = {
  documentVersionId: dmDocumentVersion.documentVersionId, documentId: dmDocumentVersion.documentId,
  familyId: dmDocumentVersion.familyId, sourceArtifactId: dmDocumentVersion.sourceArtifactId,
  pdfSha256: dmDocumentVersion.pdfSha256, byteLength: dmDocumentVersion.byteLength,
};

export function documentParseError(code: string, statusCode = 409) {
  return Object.assign(new Error(code), { code, statusCode });
}

@Injectable()
// Registered by DocumentManagementHostedModule.register().
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentParsingRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async current(scope: DocumentParseScope) {
    const rows = await this.db.select().from(dmDocumentParseRun).where(scoped(scope))
      .orderBy(desc(dmDocumentParseRun.parseRevision));
    return { latest: rows[0] ?? null, published: rows.find(row => row.status === 'PUBLISHED') ?? null };
  }

  async read(scope: DocumentParseScope, parseRunId: string) {
    const [row] = await this.db.select().from(dmDocumentParseRun).where(and(scoped(scope), eq(dmDocumentParseRun.parseRunId, parseRunId))).limit(1);
    return row ?? null;
  }

  async readRequest(scope: DocumentParseScope, requestId: string) {
    const [row] = await this.db.select().from(dmDocumentParseRun).where(and(scoped(scope),
      eq(dmDocumentParseRun.actorUserId, scope.actorUserId), eq(dmDocumentParseRun.requestId, requestId))).limit(1);
    return row ?? null;
  }

  async reserve(scope: DocumentParseScope, input: {
    requestId: string; expectedPublishedRevision: number; bucketId: string; sourceBinding: MineruDocumentVersionBinding;
  }) {
    return this.db.transaction(async tx => {
      const [version] = await tx.select(sourceColumns).from(dmDocumentVersion)
        .where(eq(dmDocumentVersion.documentVersionId, scope.documentVersionId)).for('update');
      if (!version || !sameSource(version, input.sourceBinding)) throw documentParseError('DOCUMENT_PARSE_SOURCE_CHANGED');
      const [replay] = await tx.select().from(dmDocumentParseRun).where(and(scoped(scope),
        eq(dmDocumentParseRun.actorUserId, scope.actorUserId), eq(dmDocumentParseRun.requestId, input.requestId))).limit(1);
      if (replay) {
        if (replay.expectedPublishedRevision !== input.expectedPublishedRevision) throw documentParseError('DOCUMENT_PARSE_REQUEST_CONFLICT');
        return { row: replay, created: false };
      }
      // A hard processing deadline bounds interrupted runs. It is never extended by retrying a request.
      await tx.update(dmDocumentParseRun).set({ status: 'FAILED', errorCode: 'DOCUMENT_PARSE_INTERRUPTED', completedAt: new Date() })
        .where(and(scoped(scope), eq(dmDocumentParseRun.actorUserId, scope.actorUserId),
          inArray(dmDocumentParseRun.status, [...ACTIVE]), lte(dmDocumentParseRun.deadlineAt, new Date())));
      const rows = await tx.select().from(dmDocumentParseRun).where(scoped(scope)).orderBy(desc(dmDocumentParseRun.parseRevision));
      if (rows.some(row => ACTIVE.includes(row.status as typeof ACTIVE[number]))) throw documentParseError('DOCUMENT_PARSE_ALREADY_RUNNING');
      const publishedRevision = rows.find(row => row.status === 'PUBLISHED')?.parseRevision ?? 0;
      if (publishedRevision !== input.expectedPublishedRevision) throw documentParseError('DOCUMENT_PARSE_REVISION_CONFLICT');
      const [row] = await tx.insert(dmDocumentParseRun).values({ ...scope, ...input,
        parseRunId: `PRUN-${randomUUID()}`, parseRevision: (rows[0]?.parseRevision ?? 0) + 1,
        status: 'RUNNING', deadlineAt: new Date(Date.now() + 40 * 60_000),
      }).returning();
      if (!row) throw documentParseError('DOCUMENT_PARSE_RESERVATION_FAILED', 500);
      return { row, created: true };
    });
  }

  async stage(scope: DocumentParseScope, parseRunId: string) {
    const [row] = await this.db.update(dmDocumentParseRun).set({ status: 'STAGING' })
      .where(and(owned(scope, parseRunId), eq(dmDocumentParseRun.status, 'RUNNING'))).returning();
    if (!row) throw documentParseError('DOCUMENT_PARSE_STATE_CHANGED');
    return row;
  }

  async progress(scope: DocumentParseScope, parseRunId: string, artifacts: MineruStoredArtifact[]) {
    const [row] = await this.db.update(dmDocumentParseRun).set({ artifactProgress: structuredClone(artifacts) })
      .where(and(owned(scope, parseRunId), eq(dmDocumentParseRun.status, 'STAGING'))).returning();
    if (!row) throw documentParseError('DOCUMENT_PARSE_STATE_CHANGED');
  }

  async publish(scope: DocumentParseScope, parseRunId: string, manifestArtifact: MineruStoredArtifact) {
    return this.db.transaction(async tx => {
      const [version] = await tx.select(sourceColumns).from(dmDocumentVersion)
        .where(eq(dmDocumentVersion.documentVersionId, scope.documentVersionId)).for('update');
      const [run] = await tx.select().from(dmDocumentParseRun).where(owned(scope, parseRunId)).for('update');
      if (!run || run.status !== 'STAGING') throw documentParseError('DOCUMENT_PARSE_STATE_CHANGED');
      if (run.deadlineAt.getTime() <= Date.now()) throw documentParseError('DOCUMENT_PARSE_DEADLINE_EXCEEDED');
      if (!version || !sameSource(version, run.sourceBinding)) throw documentParseError('DOCUMENT_PARSE_SOURCE_CHANGED');
      if (manifestArtifact.role !== 'MANIFEST' || manifestArtifact.readback !== 'VERIFIED' ||
          manifestArtifact.bucketId !== run.bucketId || run.artifactProgress.length === 0 ||
          run.artifactProgress.some(item => item.readback !== 'VERIFIED') ||
          !run.artifactProgress.some(item => item.role === 'MANIFEST' && item.sha256 === manifestArtifact.sha256 && item.filePath === manifestArtifact.filePath)) {
        throw documentParseError('DOCUMENT_PARSE_READBACK_REQUIRED');
      }
      const [published] = await tx.select().from(dmDocumentParseRun).where(and(scoped(scope), eq(dmDocumentParseRun.status, 'PUBLISHED')))
        .orderBy(desc(dmDocumentParseRun.parseRevision)).limit(1);
      if ((published?.parseRevision ?? 0) !== run.expectedPublishedRevision) throw documentParseError('DOCUMENT_PARSE_REVISION_CONFLICT');
      const [result] = await tx.update(dmDocumentParseRun).set({ status: 'PUBLISHED', manifestArtifact,
        pendingObject: null, errorCode: null, completedAt: new Date() }).where(owned(scope, parseRunId)).returning();
      return result;
    });
  }

  async fail(scope: DocumentParseScope, parseRunId: string, input: {
    errorCode: string; progress?: MineruStoredArtifact[]; pendingObject?: { bucketId: string; filePath: string } | null;
  }) {
    await this.db.update(dmDocumentParseRun).set({ status: 'FAILED', errorCode: input.errorCode,
      ...(input.progress ? { artifactProgress: structuredClone(input.progress) } : {}),
      ...(input.pendingObject !== undefined ? { pendingObject: input.pendingObject } : {}), completedAt: new Date(),
    }).where(and(owned(scope, parseRunId), inArray(dmDocumentParseRun.status, [...ACTIVE])));
  }
}

function scoped(scope: DocumentParseScope) {
  return and(eq(dmDocumentParseRun.tenantId, scope.tenantId), eq(dmDocumentParseRun.documentVersionId, scope.documentVersionId));
}
function owned(scope: DocumentParseScope, parseRunId: string) {
  return and(scoped(scope), eq(dmDocumentParseRun.actorUserId, scope.actorUserId), eq(dmDocumentParseRun.parseRunId, parseRunId));
}
function sameSource(version: Pick<typeof dmDocumentVersion.$inferSelect, keyof typeof sourceColumns>, source: MineruDocumentVersionBinding) {
  return version.documentVersionId === source.documentVersionId && version.documentId === source.documentId &&
    version.familyId === source.familyId && version.sourceArtifactId === source.sourceArtifactId &&
    version.pdfSha256 === source.pdfSha256 && version.byteLength === source.byteLength;
}
