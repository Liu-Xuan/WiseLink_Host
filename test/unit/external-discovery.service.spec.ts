import type {
  FeishuNativeOemHumanRejection,
  FeishuNativeOemHumanSelection,
  FeishuNativeOemSearchRun,
  FeishuNativeOemServerContext,
} from '../../server/modules/external-discovery/feishu-native-oem-monitoring-ingress';
import { ExternalDiscoveryService } from '../../server/modules/external-discovery/external-discovery.service';

const CONTEXT: FeishuNativeOemServerContext = {
  actorUserId: 'engineer-1001',
  tenantId: 'tenant-2001',
  roles: ['authenticated'],
};

type Review = FeishuNativeOemHumanSelection | FeishuNativeOemHumanRejection;

class MemoryCandidateStore {
  readonly runs = new Map<string, FeishuNativeOemSearchRun>();
  readonly reviews = new Map<string, Review>();

  async recordSearchRun(run: FeishuNativeOemSearchRun) {
    if (this.runs.has(run.searchRunRef)) throw conflict('OEM_MONITORING_SEARCH_RUN_CONFLICT');
    this.runs.set(run.searchRunRef, structuredClone(run));
    return { disposition: 'RECORDED', searchRun: structuredClone(run) };
  }

  async readSearchRun(searchRunRef: string) {
    return structuredClone(this.runs.get(searchRunRef) ?? null);
  }

  async recordHumanSelection(selection: FeishuNativeOemHumanSelection) {
    return this.recordReview(selection);
  }

  async recordHumanRejection(selection: FeishuNativeOemHumanRejection) {
    return this.recordReview(selection);
  }

  async readHumanSelection(searchRunRef: string, candidateRef: string) {
    const value = this.reviews.get(`${searchRunRef}:${candidateRef}`);
    return value?.decision === 'HUMAN_SELECTED_FOR_INGEST'
      ? structuredClone(value)
      : null;
  }

  async listSearchRuns() {
    return [...this.runs.values()].map((searchRun) => ({
      searchRun: structuredClone(searchRun),
      reviews: new Map(
        searchRun.candidates.flatMap((candidate) => {
          const review = this.reviews.get(`${searchRun.searchRunRef}:${candidate.candidateRef}`);
          return review ? [[candidate.candidateRef, structuredClone(review)] as const] : [];
        }),
      ),
    }));
  }

  private async recordReview<T extends Review>(review: T) {
    const key = `${review.searchRunRef}:${review.candidateRef}`;
    if (this.reviews.has(key)) throw conflict('OEM_MONITORING_SELECTION_CONFLICT');
    this.reviews.set(key, structuredClone(review));
    return { disposition: 'RECORDED', selection: structuredClone(review) };
  }
}

describe('ExternalDiscoveryService candidate-only admission', () => {
  let store: MemoryCandidateStore;
  let documentManagement: { ingestFileServiceSelection: jest.Mock };
  let service: ExternalDiscoveryService;

  beforeEach(() => {
    store = new MemoryCandidateStore();
    documentManagement = { ingestFileServiceSelection: jest.fn() };
    service = new ExternalDiscoveryService(
      store as never,
      documentManagement as never,
    );
  });

  it.each([
    ['ZERO_RESULTS_FOR_TARGET_IDENTIFIER', false, false, false],
    ['ACCESS_DENIED', true, false, false],
    ['PARTIAL_RESULTS', false, false, true],
  ] as const)(
    'records %s without allowing selection or DM I/O',
    async (resultStatus, accessRestricted, truncated, partialOnly) => {
      const run = searchRun(resultStatus, {
        accessRestricted,
        truncated,
        partialOnly,
      });
      await service.recordSearchRun(run, CONTEXT);
      const page = await service.list(CONTEXT);
      expect(page.searchRuns).toHaveLength(1);
      expect(page.searchRuns[0]?.resultStatus).toBe(resultStatus);
      await expect(
        service.select({
          searchRunRef: run.searchRunRef,
          candidateRef: run.candidates[0]!.candidateRef,
          context: CONTEXT,
        }),
      ).rejects.toMatchObject({ code: `OEM_MONITORING_${resultStatus}_NOT_ADOPTABLE` });
      expect(documentManagement.ingestFileServiceSelection).not.toHaveBeenCalled();
    },
  );

  it('records one found run with N candidates and admits only one pending review once', async () => {
    const run = foundRun();
    await service.recordSearchRun(run, CONTEXT);
    expect(store.runs.size).toBe(1);
    expect(store.runs.get(run.searchRunRef)?.candidates).toHaveLength(2);

    await expect(
      service.select({
        searchRunRef: run.searchRunRef,
        candidateRef: 'candidate-direct',
        context: CONTEXT,
      }),
    ).resolves.toMatchObject({
      status: 'HUMAN_REVIEW_RECORDED',
      reviewStatus: 'HUMAN_SELECTED',
      documentManagementIoPerformed: false,
    });
    await expect(
      service.select({
        searchRunRef: run.searchRunRef,
        candidateRef: 'candidate-direct',
        context: CONTEXT,
      }),
    ).rejects.toMatchObject({ code: 'OEM_MONITORING_SELECTION_CONFLICT' });
    expect(documentManagement.ingestFileServiceSelection).not.toHaveBeenCalled();
  });

  it('makes rejection terminal and rejected candidates cannot be ingested or selected', async () => {
    const run = foundRun();
    await service.recordSearchRun(run, CONTEXT);
    await expect(
      service.reject({
        searchRunRef: run.searchRunRef,
        candidateRef: 'candidate-direct',
        context: CONTEXT,
      }),
    ).resolves.toMatchObject({
      reviewStatus: 'REJECTED',
      reviewDecision: 'HUMAN_REJECTED',
    });
    await expect(
      service.select({
        searchRunRef: run.searchRunRef,
        candidateRef: 'candidate-direct',
        context: CONTEXT,
      }),
    ).rejects.toMatchObject({ code: 'OEM_MONITORING_SELECTION_CONFLICT' });
    await expect(
      service.ingestSelectedCandidate(
        {
          searchRunRef: run.searchRunRef,
          candidateRef: 'candidate-direct',
          selection: { bucketId: 'never-used', filePath: '/never-used.pdf' },
          idempotencyKey: 'never-used',
        },
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: 'OEM_MONITORING_HUMAN_SELECTION_REQUIRED' });
    expect(documentManagement.ingestFileServiceSelection).not.toHaveBeenCalled();
  });
});

function foundRun(): FeishuNativeOemSearchRun {
  return {
    ...searchRun('CANDIDATES_FOUND'),
    candidates: [
      {
        candidateRef: 'candidate-direct',
        publisher: 'AIRBUS',
        title: 'FAST Magazine issue 62',
        url: 'https://www.airbus.com/fast-62.pdf',
        disposition: 'DIRECT_OFFICIAL_SOURCE_MATCH',
      },
      {
        candidateRef: 'candidate-tangential',
        publisher: 'BOEING',
        title: 'Training catalog',
        url: 'https://services.boeing.com/catalog.pdf',
        disposition: 'TANGENTIAL_NO_DIRECT_MATCH',
      },
    ],
  };
}

function searchRun(
  resultStatus: FeishuNativeOemSearchRun['resultStatus'],
  flags: Partial<Pick<
    FeishuNativeOemSearchRun,
    'accessRestricted' | 'truncated' | 'partialOnly'
  >> = {},
): FeishuNativeOemSearchRun {
  return {
    searchRunRef: `run-${resultStatus}`,
    sourceSystem: 'OPENCLAW_HOSTED_DISCOVERY',
    query: 'AIRBUS FAST latest',
    resultStatus,
    observedAt: '2026-08-15T08:00:00.000Z',
    accessRestricted: flags.accessRestricted ?? false,
    truncated: flags.truncated ?? false,
    partialOnly: flags.partialOnly ?? false,
    candidates: [
      {
        candidateRef: `candidate-${resultStatus}`,
        publisher: 'AIRBUS',
        title: 'Discovery candidate',
        url: 'https://www.airbus.com/discovery.pdf',
        disposition: 'TANGENTIAL_NO_DIRECT_MATCH',
      },
    ],
  };
}

function conflict(code: string): Error {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}
