import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import type {
  EngineeringIssueRead,
  EngineeringIssueSearchHit,
  EngineeringIssueSearchResponse,
} from '@shared/engineering-issue-search.interface';
import type { CanonicalHostActor } from './canonical-host.types';
import { CanonicalJobAidProblemService } from './canonical-jobaid-problem.service';
import { EngineeringMatterWorkingService } from './engineering-matter-working.service';
import { isHostedCanonicalFinalUserActor } from '../work-item/miaoda-hosted-canonical-object-access.adapter';
import { jobAidReadingResult } from './jobaid-problem-work';

type IssueIdentity = Pick<
  EngineeringIssueSearchHit,
  'subjectKind' | 'subjectId' | 'workRef' | 'issueKey'
>;
type SavedIssueWork =
  | Awaited<ReturnType<CanonicalJobAidProblemService['readBrowserRevision']>>
  | Awaited<ReturnType<EngineeringMatterWorkingService['readWorkingRevision']>>;

@Injectable()
export class EngineeringIssueSearchService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly jobAid: CanonicalJobAidProblemService,
    private readonly matters: EngineeringMatterWorkingService,
  ) {}

  async search(
    query: string,
    actor: CanonicalHostActor,
  ): Promise<EngineeringIssueSearchResponse> {
    this.requireActor(actor);
    const search = typeof query === 'string' ? query.trim() : '';
    if (!search || search.length > 200)
      throw new BadRequestException('ENGINEERING_ISSUE_QUERY_INVALID');
    // SQL narrows current saved work to matching issues before any body is loaded.
    // No derived index or second copy of engineering work needs synchronization.
    const candidates = await this.db.execute<
      EngineeringIssueSearchHit & Record<string, unknown>
    >(sql`
      WITH works AS (
        SELECT 'WORK_ITEM'::text AS kind, w.work_item_id AS subject_id,
          w.assessment_work_revision_id AS work_ref, w.work_revision AS revision,
          w.content_json::jsonb AS content
        FROM assessment_work_revision w
        WHERE w.tenant_id = ${actor.tenantId} AND w.created_by_user_id = ${actor.userId}
          AND NOT EXISTS (SELECT 1 FROM assessment_work_revision newer
            WHERE newer.tenant_id = w.tenant_id AND newer.work_item_id = w.work_item_id
              AND newer.work_revision > w.work_revision)
        UNION ALL
        SELECT 'ENGINEERING_MATTER', w.matter_id, w.matter_work_revision_id,
          w.working_revision, w.state_json::jsonb -> 'problemWork'
        FROM engineering_matter_work_revision w
        WHERE w.tenant_id = ${actor.tenantId} AND w.created_by_user_id = ${actor.userId}
          AND NOT EXISTS (SELECT 1 FROM engineering_matter_work_revision newer
            WHERE newer.tenant_id = w.tenant_id AND newer.matter_id = w.matter_id
              AND newer.working_revision > w.working_revision)
      )
      SELECT kind AS "subjectKind", subject_id AS "subjectId", work_ref AS "workRef",
        revision AS "workRevision", issue ->> 'issueKey' AS "issueKey",
        issue ->> 'question' AS question, issue -> 'sourceDependencies' AS "sourceRefs"
      FROM works CROSS JOIN LATERAL jsonb_array_elements(content -> 'issues') issue
      WHERE strpos(lower(issue::text), lower(${search})) > 0
      ORDER BY subject_id, work_ref, issue ->> 'issueKey'
      LIMIT 51
    `);
    const hits: EngineeringIssueSearchHit[] = [];
    const workReads = new Map<string, Promise<SavedIssueWork>>();
    for (const candidate of candidates) {
      try {
        // Reuse exact-work/source authorization, including retained private and
        // removed sources. Search metadata must not bypass the full reader.
        const key = JSON.stringify([
          candidate.subjectKind,
          candidate.subjectId,
          candidate.workRef,
        ]);
        let work = workReads.get(key);
        if (!work) {
          work = this.loadWork(candidate, actor);
          workReads.set(key, work);
        }
        const read = this.issueFromWork(candidate, await work);
        hits.push(read.identity);
      } catch (error: unknown) {
        if (!isAccessUnavailable(error)) throw error;
      }
    }
    // Even pagination hints derive only from authorized hits.
    return { hits: hits.slice(0, 50), hasMore: hits.length > 50 };
  }

  async read(
    identity: Pick<
      EngineeringIssueSearchHit,
      'subjectKind' | 'subjectId' | 'workRef' | 'issueKey'
    >,
    actor: CanonicalHostActor,
  ): Promise<EngineeringIssueRead> {
    this.requireActor(actor);
    if (
      !['WORK_ITEM', 'ENGINEERING_MATTER'].includes(identity.subjectKind) ||
      [identity.subjectId, identity.workRef, identity.issueKey].some(
        (value) => typeof value !== 'string' || !value || value.length > 255,
      )
    )
      throw new BadRequestException('ENGINEERING_ISSUE_IDENTITY_INVALID');
    return this.issueFromWork(identity, await this.loadWork(identity, actor));
  }

  private loadWork(
    identity: IssueIdentity,
    actor: CanonicalHostActor,
  ): Promise<SavedIssueWork> {
    return identity.subjectKind === 'WORK_ITEM'
      ? this.jobAid.readBrowserRevision(
          identity.subjectId,
          identity.workRef,
          actor,
        )
      : this.matters.readWorkingRevision(
          identity.subjectId,
          identity.workRef,
          actor,
        );
  }

  private issueFromWork(
    identity: IssueIdentity,
    revision: SavedIssueWork,
  ): EngineeringIssueRead {
    const content =
      'content' in revision ? revision.content : revision.state.problemWork;
    const reading =
      'content' in revision
        ? jobAidReadingResult(revision)
        : revision.state.substantiveResult;
    const issue = content?.issues.find(
      (item) => item.issueKey === identity.issueKey,
    );
    if (!issue || !reading || !content)
      throw new NotFoundException('ENGINEERING_ISSUE_NOT_FOUND');
    return {
      identity: {
        ...identity,
        workRevision:
          'workRevision' in revision
            ? revision.workRevision
            : revision.workingRevision,
        question: issue.question,
        sourceRefs: issue.sourceDependencies,
      },
      issue,
      reading: { ...reading, evidence: content.evidence },
    };
  }

  private requireActor(actor: CanonicalHostActor): void {
    const identity = actor.objectAccessActor;
    if (
      !identity ||
      !isHostedCanonicalFinalUserActor(identity) ||
      identity.tenantId !== actor.tenantId ||
      identity.canonicalSubject.id !== actor.userId
    )
      throw Object.assign(new Error('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE'), {
        statusCode: 503,
      });
  }
}

function isAccessUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status =
    (error as Error & { statusCode?: number; status?: number }).statusCode ??
    (error as Error & { status?: number }).status;
  return (
    status === 403 ||
    status === 404 ||
    /^(JOBAID_(SOURCE|ATTACHMENT|QUERY_RECEIPT|ACTOR)_AUTHORIZATION_CHANGED|ENGINEERING_MATTER_RUNTIME_AUTHORIZATION_UNAVAILABLE)$/.test(
      error.message,
    )
  );
}
