import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalEngineeringStatementBasis,
  CanonicalLibraryCatalogView,
  CanonicalSourceBoundEngineeringStatement,
  EngineeringQuicklookProjection,
  EngineeringQuicklookSourceBoundText,
  EngineeringQuicklookSourceRefSummary,
  LibraryCatalogProjection,
  LibraryItemSummary,
} from '@shared/api.interface';

import {
  CANONICAL_OBJECT_ACCESS,
  type CanonicalObjectAccessPort,
} from '../work-item/canonical-object-access.port';
import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import {
  MiaodaWorkItemRepository,
  type OwnedLibraryCatalogCursor,
  type OwnedLibraryCatalogRow,
} from '../work-item/miaoda-work-item.repository';
import type { CanonicalHostActor } from './canonical-host.types';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;

@Injectable()
export class CanonicalLibraryCatalogService {
  constructor(
    private readonly workItems: MiaodaWorkItemRepository,
    private readonly documentVersions: MiaodaDocumentVersionSourceResolver,
    @Inject(CANONICAL_OBJECT_ACCESS)
    private readonly objectAccess: CanonicalObjectAccessPort,
  ) {}

  async read(
    input: {
      view?: string;
      query?: string;
      family?: string;
      cursor?: string;
      limit?: number;
    },
    actor: CanonicalHostActor,
  ): Promise<LibraryCatalogProjection> {
    return this.readStable(input, actor, 0);
  }

  async quicklook(
    workItemId: string,
    actor: CanonicalHostActor,
  ): Promise<EngineeringQuicklookProjection> {
    const access = await this.requireAccess(workItemId, actor);
    const scoped = await this.workItems.loadTenantScopedProjection(
      access.workItemId,
      actor.tenantId,
    );
    if (
      !scoped ||
      scoped.row.revision !== access.workItemRevision ||
      scoped.row.documentVersionId !== access.documentVersionId
    ) {
      throw catalogChanged();
    }
    const source = await this.documentVersions.resolve(
      scoped.row.documentVersionId,
      { expectedCreatorUserId: actor.userId },
    );
    if (
      source.version.documentId !== scoped.row.documentId ||
      source.version.documentVersionId !== scoped.row.documentVersionId
    ) {
      throw sourceBindingConflict();
    }
    const projection = scoped.projection;
    const overall = projection?.integratedAssessment?.overallSynthesis ?? null;
    const engineering = overall?.engineeringSummary ?? null;
    const sourceStatements: CanonicalSourceBoundEngineeringStatement[] =
      engineering
        ? [
            engineering.conclusion,
            ...engineering.whyItMatters,
            engineering.applicability.sourceScope,
            engineering.applicability.fleetMatch,
            ...engineering.implementationImpact,
          ]
        : [];
    const unresolvedQuestions: string[] = uniqueText([
      ...(engineering?.applicability.requiredFacts.map(
        (statement) => statement.text,
      ) ?? []),
      ...(overall?.missingInputs ?? []),
      ...(overall?.gap ? [overall.gap] : []),
    ]);
    const confirmed =
      projection?.integratedAssessment?.overallForAeoConfirmation;
    const selectedVersionIsCurrent =
      source.family.currentDocumentVersionId ===
      source.version.documentVersionId;
    const response: EngineeringQuicklookProjection = {
      schemaVersion: 'wiselink.3_1.engineering_quicklook.v1',
      status: 'FRESH_READ',
      objectKind: 'WORKITEM',
      workItemId: scoped.row.workItemId,
      displayCode: source.family.canonicalDocumentNumber,
      title: displayTitle(
        projection?.package?.title,
        source.family.canonicalDocumentNumber,
      ),
      authorityState: !overall
        ? 'UNAVAILABLE'
        : confirmed?.overallRevision === overall.revision
          ? 'ENGINEER_CONFIRMED'
          : 'CANDIDATE',
      freshness: !selectedVersionIsCurrent
        ? 'SUPERSEDED'
        : overall?.status === 'STALE'
          ? 'STALE'
          : 'CURRENT',
      generatedAt: null,
      basedOnRevision: scoped.row.revision,
      dataAsOf: scoped.row.updatedAt.toISOString(),
      currentJudgment: engineering
        ? sourceBoundText(engineering.conclusion)
        : overall?.overallCandidate?.trim()
          ? {
              text: overall.overallCandidate.trim(),
              basis: 'CONDITIONAL_INFERENCE',
              sourceRefIds: [],
            }
          : null,
      applicabilitySummary: engineering
        ? [
            sourceBoundText(engineering.applicability.sourceScope),
            sourceBoundText(engineering.applicability.fleetMatch),
          ]
        : [],
      whyItMatters: engineering?.whyItMatters.map(sourceBoundText) ?? [],
      keyEvidence: sourceRefSummaries(sourceStatements),
      unresolvedQuestions,
      recommendedActions: engineering?.nextActions.map(sourceBoundText) ?? [],
      familySummary: {
        currentVersion: source.version.businessRevision,
        currentGeneration: source.family.currentGeneration,
        historicalVersionCount: null,
        attachmentCount: null,
        derivedArtifactCount: derivedArtifactCount(projection),
      },
      boundary: {
        candidateOnly: true,
        sourceRefsRemainWorkItemScoped: true,
        missingCountsAreNotInferred: true,
        note:
          'Version and attachment counts remain unavailable until their ' +
          'authorized catalog owners expose browser-safe summaries.',
      },
    };
    const confirmedRead = await this.workItems.loadTenantScopedProjection(
      scoped.row.workItemId,
      actor.tenantId,
    );
    if (
      !confirmedRead ||
      confirmedRead.row.revision !== scoped.row.revision ||
      confirmedRead.row.documentVersionId !== scoped.row.documentVersionId
    ) {
      throw catalogChanged();
    }
    return response;
  }

  private async readStable(
    input: {
      view?: string;
      query?: string;
      family?: string;
      cursor?: string;
      limit?: number;
    },
    actor: CanonicalHostActor,
    attempt: number,
  ): Promise<LibraryCatalogProjection> {
    const view = catalogView(input.view);
    const query = boundedText(input.query, 120);
    const family = boundedText(input.family, 64) || null;
    const limit = catalogLimit(input.limit);
    const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
    const rows = await this.workItems.listOwnedLibraryCatalog({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      query,
      ...(family ? { family } : {}),
      ...(cursor ? { cursor } : {}),
      limit: limit + 1,
    });
    const visible = rows.slice(0, limit);
    try {
      const items = await Promise.all(
        visible.map((row) => this.catalogItem(row, actor)),
      );
      const families = await this.workItems.listOwnedLibraryFamilies({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
      });
      const hasMore = rows.length > limit;
      const last = items.length > 0 ? visible[visible.length - 1] : null;
      return {
        schemaVersion: 'wiselink.3_1.library_catalog.v1',
        status: 'FRESH_READ',
        scope: {
          mode: 'CREATOR_OWNED',
          label: '我的负责范围',
          allAuthorizedAvailable: false,
          policyRevision: 'creator-only.v1',
          note: '当前责任范围按 Host 记录的事项创建者关系读取；不使用浏览器历史推断权限。',
        },
        view,
        query,
        family,
        dataAsOf: new Date().toISOString(),
        items,
        facets: { documentFamilies: families },
        page: {
          limit,
          returnedCount: items.length,
          nextCursor: hasMore && last ? encodeCursor(last) : null,
          hasMore,
        },
        completeness: {
          tenantWideCatalogAvailable: false,
          memberSharedItemsAvailable: false,
          note: '当前只公开 creator-only 责任范围；团队共享和全部授权范围必须由 Host 责任关系后续扩展。',
        },
      };
    } catch (error: unknown) {
      if (attempt === 0 && errorCode(error) === 'LIBRARY_CATALOG_CHANGED') {
        return this.readStable(input, actor, 1);
      }
      throw error;
    }
  }

  private async catalogItem(
    row: OwnedLibraryCatalogRow,
    actor: CanonicalHostActor,
  ): Promise<LibraryItemSummary> {
    const access = await this.requireAccess(row.workItemId, actor);
    if (
      access.workItemRevision !== row.revision ||
      access.documentVersionId !== row.documentVersionId
    ) {
      throw catalogChanged();
    }
    const baseRules = row.projection?.integratedAssessment?.baseRules ?? null;
    const overall =
      row.projection?.integratedAssessment?.overallSynthesis ?? null;
    const current = row.currentDocumentVersionId === row.documentVersionId;
    const freshness = !current
      ? 'SUPERSEDED'
      : overall?.status === 'STALE'
        ? 'STALE'
        : 'CURRENT';
    return {
      workItemId: row.workItemId,
      displayCode: row.documentCode,
      title: displayTitle(row.projection?.package?.title, row.documentCode),
      views: ['DOCUMENT_FAMILY', 'ENGINEERING_ASSESSMENT'],
      document: {
        family: row.documentFamily,
        businessRevision: row.businessRevision,
        currentness: current ? 'CURRENT' : 'SUPERSEDED',
        currentGeneration: row.currentGeneration,
      },
      assessment: {
        phase: row.status,
        workItemRevision: row.revision,
        authority: overall ? 'CANDIDATE' : 'UNAVAILABLE',
        freshness,
        jobAid: baseRules
          ? {
              completed: Math.max(
                0,
                baseRules.evaluationItemCount - baseRules.unresolvedCount,
              ),
              total: baseRules.criterionCount,
              waiting: baseRules.unresolvedCount,
            }
          : null,
        unresolvedCount: baseRules?.unresolvedCount ?? null,
        reviewRequired:
          Boolean(overall?.engineeringReviewRequired) ||
          Boolean(baseRules && baseRules.unresolvedCount > 0),
        overallAvailable: overall !== null,
      },
      updatedAt: row.updatedAt.toISOString(),
      routes: {
        overview: `/work-items/${encodeURIComponent(row.workItemId)}`,
        workspace:
          `/work-items/${encodeURIComponent(row.workItemId)}/documents` +
          '?node=assessment&tab=assessment',
      },
    };
  }

  private async requireAccess(workItemId: string, actor: CanonicalHostActor) {
    if (!actor.objectAccessActor) {
      throw Object.assign(new Error('Canonical identity is unavailable.'), {
        code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
        statusCode: 503,
      });
    }
    const access = await this.objectAccess.freshRead({
      actor: actor.objectAccessActor,
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: workItemId },
    });
    if (access.allowed === false) {
      throw Object.assign(new Error('WorkItem is not available.'), {
        code: access.code,
        statusCode: access.statusCode,
      });
    }
    return access;
  }
}

function catalogView(value: string | undefined): CanonicalLibraryCatalogView {
  if (!value || value === 'document') return 'DOCUMENT_FAMILY';
  if (value === 'assessment') return 'ENGINEERING_ASSESSMENT';
  throw invalidRequest('LIBRARY_CATALOG_VIEW_INVALID');
}

function catalogLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw invalidRequest('LIBRARY_CATALOG_LIMIT_INVALID');
  }
  return value;
}

function boundedText(value: string | undefined, max: number): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length > max) {
    throw invalidRequest('LIBRARY_CATALOG_QUERY_INVALID');
  }
  return normalized;
}

function encodeCursor(row: OwnedLibraryCatalogRow): string {
  return Buffer.from(
    JSON.stringify({ u: row.updatedAt.toISOString(), w: row.workItemId }),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(value: string): OwnedLibraryCatalogCursor {
  try {
    if (!/^[A-Za-z0-9_-]{8,512}$/u.test(value)) throw new Error('format');
    const decoded = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    if (
      Object.keys(decoded).sort().join(',') !== 'u,w' ||
      typeof decoded.u !== 'string' ||
      typeof decoded.w !== 'string' ||
      decoded.w.trim() === '' ||
      !Number.isFinite(Date.parse(decoded.u))
    ) {
      throw new Error('shape');
    }
    return { updatedAt: new Date(decoded.u), workItemId: decoded.w };
  } catch {
    throw invalidRequest('LIBRARY_CATALOG_CURSOR_INVALID');
  }
}

function displayTitle(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized && normalized !== fallback ? normalized : fallback;
}

function sourceBoundText(
  statement: CanonicalSourceBoundEngineeringStatement,
): EngineeringQuicklookSourceBoundText {
  return {
    text: statement.text,
    basis: statement.basis as CanonicalEngineeringStatementBasis,
    sourceRefIds: [...statement.sourceRefIds],
  };
}

function sourceRefSummaries(
  statements: CanonicalSourceBoundEngineeringStatement[],
): EngineeringQuicklookSourceRefSummary[] {
  const seen = new Set<string>();
  const result: EngineeringQuicklookSourceRefSummary[] = [];
  for (const statement of statements) {
    for (const sourceRefId of statement.sourceRefIds) {
      if (!sourceRefId.trim() || seen.has(sourceRefId)) continue;
      seen.add(sourceRefId);
      result.push({
        sourceRefId,
        label: statement.text,
        pageStart: null,
        sectionTitle: null,
      });
      if (result.length === 6) return result;
    }
  }
  return result;
}

function uniqueText(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).slice(0, 8);
}

function derivedArtifactCount(
  projection: OwnedLibraryCatalogRow['projection'],
): number {
  if (!projection) return 0;
  return (
    (projection.package ? 1 : 0) +
    (projection.translation ? 1 : 0) +
    (projection.integratedAssessment?.baseRules ? 1 : 0) +
    (projection.integratedAssessment?.overallSynthesis ? 1 : 0) +
    (projection.integratedAssessment?.engineerReviews ? 1 : 0) +
    (projection.aeo?.artifacts.length ?? 0)
  );
}

function invalidRequest(code: string): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error(code), { code, statusCode: 400 });
}

function catalogChanged(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('Library catalog changed during read.'), {
    code: 'LIBRARY_CATALOG_CHANGED',
    statusCode: 409,
  });
}

function sourceBindingConflict(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error('Library source binding is inconsistent.'), {
    code: 'LIBRARY_CATALOG_SOURCE_BINDING_CONFLICT',
    statusCode: 409,
  });
}

function errorCode(error: unknown): string | null {
  return error instanceof Error && 'code' in error
    ? String((error as Error & { code?: unknown }).code ?? '')
    : null;
}
