import {
  FeishuNativeOemMonitoringIngress,
} from '../../server/modules/external-discovery/feishu-native-oem-monitoring-ingress';
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
  let ingress: FeishuNativeOemMonitoringIngress;

  beforeEach(() => {
    store = new MemoryCandidateStore();
    documentManagement = { ingestFileServiceSelection: jest.fn() };
    service = new ExternalDiscoveryService(
      store as never,
      documentManagement as never,
    );
    ingress = new FeishuNativeOemMonitoringIngress({
      candidateStore: store,
      documentManagement,
    });
  });

  it.each([
    ['ZERO_RESULTS_FOR_TARGET_IDENTIFIER', false, false, false],
    ['ACCESS_DENIED', true, false, false],
    ['PARTIAL_RESULTS', false, false, true],
    ['TRUNCATED', false, true, false],
  ] as const)(
    'records %s without allowing selection or DM I/O',
    async (resultStatus, accessRestricted, truncated, partialOnly) => {
      const run = searchRun(resultStatus, {
        accessRestricted,
        truncated,
        partialOnly,
      });
      await service.recordSearchRun(run, CONTEXT);
      expect(store.runs.get(run.searchRunRef)?.resultStatus).toBe(resultStatus);
      await expect(
        ingress.recordHumanSelection({
          searchRunRef: run.searchRunRef,
          candidateRef: run.candidates[0]!.candidateRef,
          decision: 'HUMAN_SELECTED_FOR_INGEST',
        }, CONTEXT),
      ).rejects.toMatchObject({ code: `OEM_MONITORING_${resultStatus}_NOT_ADOPTABLE` });
      expect(documentManagement.ingestFileServiceSelection).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['accessRestricted', true, false, false],
    ['truncated', false, true, false],
    ['partialOnly', false, false, true],
  ] as const)(
    'keeps legacy CANDIDATES_FOUND with %s discovery-only',
    async (_flag, accessRestricted, truncated, partialOnly) => {
      const run = foundRun({ accessRestricted, truncated, partialOnly });
      await service.recordSearchRun(run, CONTEXT);
      await expect(
        ingress.recordHumanSelection({
          searchRunRef: run.searchRunRef,
          candidateRef: 'candidate-direct',
          decision: 'HUMAN_SELECTED_FOR_INGEST',
        }, CONTEXT),
      ).rejects.toMatchObject({ code: 'OEM_MONITORING_SEARCH_RUN_INCOMPLETE' });
      expect(documentManagement.ingestFileServiceSelection).not.toHaveBeenCalled();
    },
  );

  it('records one found run with N candidates and admits only one pending review once', async () => {
    const run = foundRun();
    await service.recordSearchRun(run, CONTEXT);
    expect(store.runs.size).toBe(1);
    expect(store.runs.get(run.searchRunRef)?.candidates).toHaveLength(2);

    await expect(
      ingress.recordHumanSelection({
        searchRunRef: run.searchRunRef,
        candidateRef: 'candidate-direct',
        decision: 'HUMAN_SELECTED_FOR_INGEST',
      }, CONTEXT),
    ).resolves.toMatchObject({
      disposition: 'RECORDED',
      selection: { decision: 'HUMAN_SELECTED_FOR_INGEST' },
    });
    await expect(
      ingress.recordHumanSelection({
        searchRunRef: run.searchRunRef,
        candidateRef: 'candidate-direct',
        decision: 'HUMAN_SELECTED_FOR_INGEST',
      }, CONTEXT),
    ).rejects.toMatchObject({ code: 'OEM_MONITORING_SELECTION_CONFLICT' });
    expect(documentManagement.ingestFileServiceSelection).not.toHaveBeenCalled();
  });

  it('makes rejection terminal and rejected candidates cannot be ingested or selected', async () => {
    const run = foundRun();
    await service.recordSearchRun(run, CONTEXT);
    await expect(
      ingress.recordHumanRejection({
        searchRunRef: run.searchRunRef,
        candidateRef: 'candidate-direct',
        decision: 'HUMAN_REJECTED',
      }, CONTEXT),
    ).resolves.toMatchObject({
      disposition: 'RECORDED',
      selection: { decision: 'HUMAN_REJECTED' },
    });
    await expect(
      ingress.recordHumanSelection({
        searchRunRef: run.searchRunRef,
        candidateRef: 'candidate-direct',
        decision: 'HUMAN_SELECTED_FOR_INGEST',
      }, CONTEXT),
    ).rejects.toMatchObject({ code: 'OEM_MONITORING_SELECTION_CONFLICT' });
    await expect(
      ingress.ingestSelectedCandidate(
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

  it('selects only deterministic server-owned hosted runs for overall synthesis', async () => {
    const earlier = hostedRun('search:boeing:earlier', '2026-08-16T01:00:00.000Z');
    const latest = hostedRun('search:boeing:latest', '2026-08-16T02:00:00.000Z');
    const foreign = hostedRun('search:boeing:foreign', '2026-08-16T03:00:00.000Z');
    foreign.sourceSystem = 'FOREIGN_DISCOVERY';
    await store.recordSearchRun(earlier, CONTEXT);
    await store.recordSearchRun(latest, CONTEXT);
    await store.recordSearchRun(foreign, CONTEXT);

    await expect(
      service.latestSearchRunsAsOf(['B'], '2026-08-16T02:30:00.000Z', CONTEXT),
    ).resolves.toMatchObject([{ searchRunRef: latest.searchRunRef }]);
    await expect(
      service.latestSearchRunsAsOf(['B'], 'not-a-date', CONTEXT),
    ).rejects.toThrow('OPENCLAW_OVERALL_DISCOVERY_CUTOFF_INVALID');
  });
});

describe('ExternalDiscoveryService production browser methods', () => {
  it.each(['list', 'select', 'reject', 'ingest'] as const)(
    'rejects direct %s before every real store or DM dependency',
    async (action) => {
      const store = {
        recordSearchRun: jest.fn(),
        readSearchRun: jest.fn(),
        recordHumanSelection: jest.fn(),
        recordHumanRejection: jest.fn(),
        readHumanSelection: jest.fn(),
        listSearchRuns: jest.fn(),
      };
      const documentManagement = { ingestFileServiceSelection: jest.fn() };
      const service = new ExternalDiscoveryService(
        store as never,
        documentManagement as never,
      );
      const operation =
        action === 'list'
          ? service.list(CONTEXT)
          : action === 'select'
            ? service.select({
                searchRunRef: 'forged-run',
                candidateRef: 'forged-candidate',
                context: CONTEXT,
              })
            : action === 'reject'
              ? service.reject({
                  searchRunRef: 'forged-run',
                  candidateRef: 'forged-candidate',
                  context: CONTEXT,
                })
              : Promise.resolve().then(() =>
                  service.ingestSelectedCandidate(
                    {
                      searchRunRef: 'forged-run',
                      candidateRef: 'forged-candidate',
                      selection: {
                        bucketId: 'forged-bucket',
                        filePath: '/forged.pdf',
                      },
                    },
                    CONTEXT,
                  ),
                );

      await expect(operation).rejects.toMatchObject({
        code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
        statusCode: 503,
        denialSource: 'MIAODA_BROWSER_UNAVAILABLE_ADAPTER',
      });
      for (const dependency of Object.values(store)) {
        expect(dependency).not.toHaveBeenCalled();
      }
      expect(
        documentManagement.ingestFileServiceSelection,
      ).not.toHaveBeenCalled();
    },
  );
});

function hostedRun(searchRunRef: string, observedAt: string): FeishuNativeOemSearchRun {
  return {
    searchRunRef,
    sourceSystem: 'FEISHU_HOSTED_OPENCLAW',
    query: 'Boeing controlled publication',
    resultStatus: 'CANDIDATES_FOUND',
    observedAt,
    accessRestricted: false,
    truncated: false,
    partialOnly: false,
    failureCode: null,
    candidates: [{
      candidateRef: `${searchRunRef}:candidate:001`,
      publisher: 'BOEING',
      title: 'Official Boeing candidate',
      url: 'https://www.boeing.com/candidate.pdf',
      disposition: 'DIRECT_OFFICIAL_SOURCE_MATCH',
    }],
  };
}

function foundRun(
  flags: Partial<Pick<
    FeishuNativeOemSearchRun,
    'accessRestricted' | 'truncated' | 'partialOnly'
  >> = {},
): FeishuNativeOemSearchRun {
  return {
    ...searchRun('CANDIDATES_FOUND', flags),
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
    failureCode:
      resultStatus === 'ACCESS_DENIED' ? 'UPSTREAM_CONNECT_TIMEOUT' : null,
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
