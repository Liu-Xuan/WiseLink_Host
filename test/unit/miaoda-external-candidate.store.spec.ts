import { PgDialect } from 'drizzle-orm/pg-core';

import type { FeishuNativeOemSearchRun } from '../../server/modules/external-discovery/feishu-native-oem-monitoring-ingress';
import { MiaodaExternalDiscoveryCandidateStore } from '../../server/modules/document-management/src/hosted/nest/miaoda-external-discovery-candidate.store';
import {
  externalDiscoveryCandidate,
  externalSearchRun,
} from '../../server/database/schema';

describe('MiaodaExternalDiscoveryCandidateStore transaction boundary', () => {
  it('persists one run and N candidates in one database transaction', async () => {
    const state: {
      run: Record<string, unknown> | null;
      candidates: Array<Record<string, unknown>>;
    } = { run: null, candidates: [] };
    const transaction = fakeTransaction(state);
    const db = {
      transaction: jest.fn(async (callback: (executor: unknown) => unknown) =>
        callback(transaction),
      ),
    };
    const store = new MiaodaExternalDiscoveryCandidateStore(db as never);
    const run: FeishuNativeOemSearchRun = {
      searchRunRef: 'run-found-001',
      sourceSystem: 'OPENCLAW_HOSTED_DISCOVERY',
      query: 'AIRBUS FAST latest',
      resultStatus: 'CANDIDATES_FOUND',
      observedAt: '2026-08-15T08:00:00.000Z',
      accessRestricted: false,
      truncated: false,
      partialOnly: false,
      failureCode: null,
      candidates: [
        {
          candidateRef: 'candidate-1',
          publisher: 'AIRBUS',
          title: 'FAST 61',
          url: 'https://www.airbus.com/fast61.pdf',
          disposition: 'DIRECT_OFFICIAL_SOURCE_MATCH',
        },
        {
          candidateRef: 'candidate-2',
          publisher: 'AIRBUS',
          title: 'FAST index',
          url: 'https://www.airbus.com/fast',
          disposition: 'TANGENTIAL_NO_DIRECT_MATCH',
        },
      ],
    };

    await expect(
      store.recordSearchRun(run, {
        actorUserId: 'automation-1',
        tenantId: 'tenant-1',
        roles: ['automation'],
      }),
    ).resolves.toMatchObject({ disposition: 'RECORDED' });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(state.run?.searchRunRef).toBe(run.searchRunRef);
    expect(state.candidates).toHaveLength(2);
  });

  it('binds the fresh publisher and source URL in the conditional review update', async () => {
    let updateSql = '';
    let updateParams: unknown[] = [];
    const db = {
      update: () => ({
        set: () => ({
          where: (condition: unknown) => {
            const query = new PgDialect().sqlToQuery(condition as never);
            updateSql = query.sql;
            updateParams = query.params;
            return {
              returning: async () => [{ candidateRef: 'candidate-1' }],
            };
          },
        }),
      }),
    };
    const store = new MiaodaExternalDiscoveryCandidateStore(db as never);

    await expect(
      store.recordHumanSelection(
        {
          searchRunRef: 'run-found-001',
          candidateRef: 'candidate-1',
          decision: 'HUMAN_SELECTED_FOR_INGEST',
          reviewedBy: 'engineer-1',
          reviewedAt: '2026-08-16T14:00:00.000Z',
          publisher: 'AIRBUS',
          sourceUrl: 'https://www.airbus.com/en/newsroom/stories/fast-62',
        },
        {
          actorUserId: 'engineer-1',
          tenantId: 'tenant-1',
          roles: ['engineer'],
        },
      ),
    ).resolves.toMatchObject({ disposition: 'RECORDED' });

    expect(updateSql).toContain('"publisher" =');
    expect(updateSql).toContain('"source_url" =');
    expect(updateParams).toEqual(
      expect.arrayContaining([
        'AIRBUS',
        'https://www.airbus.com/en/newsroom/stories/fast-62',
      ]),
    );
  });
});

function fakeTransaction(state: {
  run: Record<string, unknown> | null;
  candidates: Array<Record<string, unknown>>;
}) {
  return {
    insert(table: unknown) {
      return {
        values(value: Record<string, unknown> | Array<Record<string, unknown>>) {
          if (table === externalSearchRun) {
            state.run = { ...(value as Record<string, unknown>), id: 'run-row-id' };
            const builder = {
              onConflictDoNothing: () => builder,
              returning: async () => [{ id: 'run-row-id' }],
            };
            return builder;
          }
          if (table === externalDiscoveryCandidate) {
            state.candidates = (value as Array<Record<string, unknown>>).map(
              (entry) => ({ ...entry, id: `candidate-${entry.candidateRef}` }),
            );
          }
          return Promise.resolve();
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          const rows = table === externalSearchRun
            ? state.run
              ? [state.run]
              : []
            : state.candidates;
          const chain = {
            where: () => chain,
            limit: async (limit: number) => rows.slice(0, limit),
            orderBy: async () => rows,
          };
          return chain;
        },
      };
    },
  };
}
