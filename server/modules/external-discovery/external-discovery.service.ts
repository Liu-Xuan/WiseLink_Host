import { Injectable } from '@nestjs/common';

import type {
  ExternalDiscoveryPageResponse,
  ExternalDiscoverySearchRunView,
  ExternalDiscoverySelectionResponse,
} from '@shared/api.interface';
import { DocumentManagementHostedService } from '../document-management/src/hosted/nest';
import {
  FeishuNativeOemMonitoringIngress,
  type FeishuNativeOemSearchRun,
  type FeishuNativeOemServerContext,
} from './feishu-native-oem-monitoring-ingress';
import { MiaodaExternalCandidateStore } from './miaoda-external-candidate.store';

const DIRECT_MATCH = 'DIRECT_OFFICIAL_SOURCE_MATCH';

@Injectable()
export class ExternalDiscoveryService {
  private readonly ingress: FeishuNativeOemMonitoringIngress;

  constructor(
    private readonly store: MiaodaExternalCandidateStore,
    documentManagement: DocumentManagementHostedService,
  ) {
    this.ingress = new FeishuNativeOemMonitoringIngress({
      candidateStore: store,
      documentManagement,
    });
  }

  recordSearchRun(
    searchRun: FeishuNativeOemSearchRun,
    context: FeishuNativeOemServerContext,
  ): Promise<unknown> {
    return this.ingress.recordSearchRun(searchRun, context);
  }

  async list(
    context: FeishuNativeOemServerContext,
  ): Promise<ExternalDiscoveryPageResponse> {
    const entries = await this.store.listSearchRuns(context);
    return {
      status: 'FRESH_READ',
      searchRuns: entries.map(({ searchRun, reviews }) =>
        toSearchRunView(searchRun, reviews),
      ),
      authority: {
        currentnessChanged: false,
        documentManagementIoPerformed: false,
        engineeringConclusionCreated: false,
      },
    };
  }

  async select(input: {
    searchRunRef: string;
    candidateRef: string;
    context: FeishuNativeOemServerContext;
  }): Promise<ExternalDiscoverySelectionResponse> {
    const result = (await this.ingress.recordHumanSelection(
      {
        searchRunRef: input.searchRunRef,
        candidateRef: input.candidateRef,
        decision: 'HUMAN_SELECTED_FOR_INGEST',
      },
      input.context,
    )) as {
      selection: {
        reviewedBy: string;
        reviewedAt: string;
      };
    };
    return {
      status: 'HUMAN_REVIEW_RECORDED',
      searchRunRef: input.searchRunRef,
      candidateRef: input.candidateRef,
      reviewStatus: 'HUMAN_SELECTED',
      reviewDecision: 'HUMAN_SELECTED_FOR_INGEST',
      reviewedByUserId: result.selection.reviewedBy,
      reviewedAt: result.selection.reviewedAt,
      documentManagementIoPerformed: false,
    };
  }

  async reject(input: {
    searchRunRef: string;
    candidateRef: string;
    context: FeishuNativeOemServerContext;
  }): Promise<ExternalDiscoverySelectionResponse> {
    const result = (await this.ingress.recordHumanRejection(
      {
        searchRunRef: input.searchRunRef,
        candidateRef: input.candidateRef,
        decision: 'HUMAN_REJECTED',
      },
      input.context,
    )) as {
      selection: {
        reviewedBy: string;
        reviewedAt: string;
      };
    };
    return {
      status: 'HUMAN_REVIEW_RECORDED',
      searchRunRef: input.searchRunRef,
      candidateRef: input.candidateRef,
      reviewStatus: 'REJECTED',
      reviewDecision: 'HUMAN_REJECTED',
      reviewedByUserId: result.selection.reviewedBy,
      reviewedAt: result.selection.reviewedAt,
      documentManagementIoPerformed: false,
    };
  }

  ingestSelectedCandidate(
    input: unknown,
    context: FeishuNativeOemServerContext,
  ): Promise<unknown> {
    return this.ingress.ingestSelectedCandidate(input, context);
  }
}

function toSearchRunView(
  run: FeishuNativeOemSearchRun,
  reviews: Map<
    string,
    {
      reviewedBy: string;
      reviewedAt: string;
      decision: 'HUMAN_SELECTED_FOR_INGEST' | 'HUMAN_REJECTED';
    }
  >,
): ExternalDiscoverySearchRunView {
  return {
    ...run,
    candidates: run.candidates.map((candidate) => {
      const review = reviews.get(candidate.candidateRef) ?? null;
      const blockReason = selectionBlockReason(run, candidate.disposition);
      return {
        searchRunRef: run.searchRunRef,
        candidateRef: candidate.candidateRef,
        publisher: candidate.publisher,
        title: candidate.title,
        url: candidate.url,
        disposition: candidate.disposition,
        reviewStatus:
          review?.decision === 'HUMAN_SELECTED_FOR_INGEST'
            ? 'HUMAN_SELECTED'
            : review?.decision === 'HUMAN_REJECTED'
              ? 'REJECTED'
              : 'PENDING',
        reviewDecision: review?.decision ?? null,
        reviewedByUserId: review?.reviewedBy ?? null,
        reviewedAt: review?.reviewedAt ?? null,
        eligibleForHumanSelection: blockReason === null && review === null,
        selectionBlockReason: review ? 'ALREADY_REVIEWED' : blockReason,
      };
    }),
  };
}

function selectionBlockReason(
  run: FeishuNativeOemSearchRun,
  disposition: string,
): string | null {
  if (run.resultStatus !== 'CANDIDATES_FOUND') return run.resultStatus;
  if (run.accessRestricted || run.truncated || run.partialOnly) {
    return 'SEARCH_RUN_INCOMPLETE';
  }
  if (disposition !== DIRECT_MATCH) return 'NOT_DIRECT_OFFICIAL_SOURCE_MATCH';
  return null;
}
