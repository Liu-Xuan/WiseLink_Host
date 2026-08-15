import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq } from 'drizzle-orm';

import {
  externalDiscoveryCandidate,
  externalSearchRun,
} from '../../database/schema';
import type {
  FeishuNativeOemCandidateStore,
  FeishuNativeOemHumanRejection,
  FeishuNativeOemHumanSelection,
  FeishuNativeOemSearchRun,
  FeishuNativeOemServerContext,
} from './feishu-native-oem-monitoring-ingress';

type DatabaseExecutor = PostgresJsDatabase;

@Injectable()
export class MiaodaExternalCandidateStore
  implements FeishuNativeOemCandidateStore
{
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async recordSearchRun(
    searchRun: FeishuNativeOemSearchRun,
    context: FeishuNativeOemServerContext,
  ): Promise<{ disposition: 'RECORDED' | 'REPLAYED'; searchRun: FeishuNativeOemSearchRun }> {
    return this.db.transaction(async (transaction) => {
      const inserted = await transaction
        .insert(externalSearchRun)
        .values({
          tenantId: context.tenantId,
          searchRunRef: searchRun.searchRunRef,
          sourceSystem: searchRun.sourceSystem,
          query: searchRun.query,
          resultStatus: searchRun.resultStatus,
          observedAt: new Date(searchRun.observedAt),
          accessRestricted: searchRun.accessRestricted,
          truncated: searchRun.truncated,
          partialOnly: searchRun.partialOnly,
          recordedByUserId: context.actorUserId,
        })
        .onConflictDoNothing({
          target: [externalSearchRun.tenantId, externalSearchRun.searchRunRef],
        })
        .returning({ id: externalSearchRun.id });

      if (inserted.length === 0) {
        const replay = await this.readSearchRunFrom(
          transaction as DatabaseExecutor,
          searchRun.searchRunRef,
          context,
        );
        if (!replay || !sameSearchRun(replay, searchRun)) {
          throw statusError(
            'OEM_MONITORING_SEARCH_RUN_CONFLICT',
            409,
            'SearchRun identity was reused for different content.',
          );
        }
        return { disposition: 'REPLAYED', searchRun: replay };
      }

      if (searchRun.candidates.length > 0) {
        await transaction.insert(externalDiscoveryCandidate).values(
          searchRun.candidates.map((candidate) => ({
            tenantId: context.tenantId,
            searchRunRef: searchRun.searchRunRef,
            candidateRef: candidate.candidateRef,
            publisher: candidate.publisher,
            title: candidate.title,
            sourceUrl: candidate.url,
            disposition: candidate.disposition,
            reviewStatus: 'PENDING',
          })),
        );
      }
      const stored = await this.readSearchRunFrom(
        transaction as DatabaseExecutor,
        searchRun.searchRunRef,
        context,
      );
      if (!stored || !sameSearchRun(stored, searchRun)) {
        throw new Error('OEM_MONITORING_SEARCH_RUN_TRANSACTION_READBACK_FAILED');
      }
      return { disposition: 'RECORDED', searchRun: stored };
    });
  }

  readSearchRun(
    searchRunRef: string,
    context: FeishuNativeOemServerContext,
  ): Promise<FeishuNativeOemSearchRun | null> {
    return this.readSearchRunFrom(this.db, searchRunRef, context);
  }

  async recordHumanSelection(
    selection: FeishuNativeOemHumanSelection,
    context: FeishuNativeOemServerContext,
  ): Promise<{ disposition: 'RECORDED'; selection: FeishuNativeOemHumanSelection }> {
    return this.recordReview(selection, 'HUMAN_SELECTED', context);
  }

  async recordHumanRejection(
    selection: FeishuNativeOemHumanRejection,
    context: FeishuNativeOemServerContext,
  ): Promise<{ disposition: 'RECORDED'; selection: FeishuNativeOemHumanRejection }> {
    return this.recordReview(selection, 'REJECTED', context);
  }

  private async recordReview<
    T extends FeishuNativeOemHumanSelection | FeishuNativeOemHumanRejection,
  >(
    selection: T,
    reviewStatus: 'HUMAN_SELECTED' | 'REJECTED',
    context: FeishuNativeOemServerContext,
  ): Promise<{ disposition: 'RECORDED'; selection: T }> {
    const updated = await this.db
      .update(externalDiscoveryCandidate)
      .set({
        reviewStatus,
        reviewDecision: selection.decision,
        reviewedByUserId: selection.reviewedBy,
        reviewedAt: new Date(selection.reviewedAt),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(externalDiscoveryCandidate.tenantId, context.tenantId),
          eq(externalDiscoveryCandidate.searchRunRef, selection.searchRunRef),
          eq(externalDiscoveryCandidate.candidateRef, selection.candidateRef),
          eq(externalDiscoveryCandidate.reviewStatus, 'PENDING'),
        ),
      )
      .returning({ candidateRef: externalDiscoveryCandidate.candidateRef });
    if (updated.length === 1) {
      return { disposition: 'RECORDED', selection };
    }
    const existing = await this.readCandidate(
      selection.searchRunRef,
      selection.candidateRef,
      context,
    );
    if (!existing) {
      throw statusError(
        'OEM_MONITORING_CANDIDATE_NOT_FOUND',
        404,
        `Candidate not found: ${selection.candidateRef}`,
      );
    }
    throw statusError(
      'OEM_MONITORING_SELECTION_CONFLICT',
      409,
      'Candidate review is no longer pending.',
    );
  }

  async readHumanSelection(
    searchRunRef: string,
    candidateRef: string,
    context: FeishuNativeOemServerContext,
  ): Promise<FeishuNativeOemHumanSelection | null> {
    const row = await this.readCandidate(searchRunRef, candidateRef, context);
    if (
      !row
      || row.reviewStatus !== 'HUMAN_SELECTED'
      || row.reviewDecision !== 'HUMAN_SELECTED_FOR_INGEST'
      || !row.reviewedByUserId
      || !row.reviewedAt
    ) {
      return null;
    }
    return {
      searchRunRef: row.searchRunRef,
      candidateRef: row.candidateRef,
      decision: 'HUMAN_SELECTED_FOR_INGEST',
      reviewedBy: row.reviewedByUserId,
      reviewedAt: row.reviewedAt.toISOString(),
      publisher: row.publisher,
      sourceUrl: row.sourceUrl,
    };
  }

  async listSearchRuns(
    context: FeishuNativeOemServerContext,
  ): Promise<Array<{
    searchRun: FeishuNativeOemSearchRun;
    reviews: Map<
      string,
      FeishuNativeOemHumanSelection | FeishuNativeOemHumanRejection
    >;
  }>> {
    const runs = await this.db
      .select()
      .from(externalSearchRun)
      .where(eq(externalSearchRun.tenantId, context.tenantId))
      .orderBy(desc(externalSearchRun.observedAt));
    return Promise.all(
      runs.map(async (row) => {
        const searchRun = await this.readSearchRun(row.searchRunRef, context);
        if (!searchRun) throw new Error('OEM_MONITORING_SEARCH_RUN_LIST_READBACK_FAILED');
        const reviews = new Map<
          string,
          FeishuNativeOemHumanSelection | FeishuNativeOemHumanRejection
        >();
        for (const candidate of searchRun.candidates) {
          const selection = await this.readReview(
            searchRun.searchRunRef,
            candidate.candidateRef,
            context,
          );
          if (selection) reviews.set(candidate.candidateRef, selection);
        }
        return { searchRun, reviews };
      }),
    );
  }

  private async readReview(
    searchRunRef: string,
    candidateRef: string,
    context: FeishuNativeOemServerContext,
  ): Promise<
    FeishuNativeOemHumanSelection | FeishuNativeOemHumanRejection | null
  > {
    const row = await this.readCandidate(searchRunRef, candidateRef, context);
    if (
      !row
      || row.reviewStatus === 'PENDING'
      || !row.reviewedByUserId
      || !row.reviewedAt
    ) {
      return null;
    }
    if (
      row.reviewStatus === 'HUMAN_SELECTED'
      && row.reviewDecision === 'HUMAN_SELECTED_FOR_INGEST'
    ) {
      return {
        searchRunRef,
        candidateRef,
        decision: 'HUMAN_SELECTED_FOR_INGEST',
        reviewedBy: row.reviewedByUserId,
        reviewedAt: row.reviewedAt.toISOString(),
        publisher: row.publisher,
        sourceUrl: row.sourceUrl,
      };
    }
    if (
      row.reviewStatus === 'REJECTED'
      && row.reviewDecision === 'HUMAN_REJECTED'
    ) {
      return {
        searchRunRef,
        candidateRef,
        decision: 'HUMAN_REJECTED',
        reviewedBy: row.reviewedByUserId,
        reviewedAt: row.reviewedAt.toISOString(),
        publisher: row.publisher,
        sourceUrl: row.sourceUrl,
      };
    }
    throw new Error('OEM_MONITORING_REVIEW_STATE_INVALID');
  }

  private async readSearchRunFrom(
    executor: DatabaseExecutor,
    searchRunRef: string,
    context: FeishuNativeOemServerContext,
  ): Promise<FeishuNativeOemSearchRun | null> {
    const [run] = await executor
      .select()
      .from(externalSearchRun)
      .where(
        and(
          eq(externalSearchRun.tenantId, context.tenantId),
          eq(externalSearchRun.searchRunRef, searchRunRef),
        ),
      )
      .limit(1);
    if (!run) return null;
    const candidates = await executor
      .select()
      .from(externalDiscoveryCandidate)
      .where(
        and(
          eq(externalDiscoveryCandidate.tenantId, context.tenantId),
          eq(externalDiscoveryCandidate.searchRunRef, searchRunRef),
        ),
      )
      .orderBy(externalDiscoveryCandidate.candidateRef);
    return {
      searchRunRef: run.searchRunRef,
      sourceSystem: run.sourceSystem,
      query: run.query,
      resultStatus: run.resultStatus as FeishuNativeOemSearchRun['resultStatus'],
      observedAt: run.observedAt.toISOString(),
      accessRestricted: run.accessRestricted,
      truncated: run.truncated,
      partialOnly: run.partialOnly,
      candidates: candidates.map((candidate) => ({
        candidateRef: candidate.candidateRef,
        publisher: candidate.publisher as 'AIRBUS' | 'BOEING' | 'COMAC',
        title: candidate.title,
        url: candidate.sourceUrl,
        disposition: candidate.disposition,
      })),
    };
  }

  private async readCandidate(
    searchRunRef: string,
    candidateRef: string,
    context: FeishuNativeOemServerContext,
  ) {
    const [row] = await this.db
      .select()
      .from(externalDiscoveryCandidate)
      .where(
        and(
          eq(externalDiscoveryCandidate.tenantId, context.tenantId),
          eq(externalDiscoveryCandidate.searchRunRef, searchRunRef),
          eq(externalDiscoveryCandidate.candidateRef, candidateRef),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}

function sameSearchRun(
  left: FeishuNativeOemSearchRun,
  right: FeishuNativeOemSearchRun,
): boolean {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  }
  return value;
}

function statusError(code: string, statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { code, statusCode });
}
