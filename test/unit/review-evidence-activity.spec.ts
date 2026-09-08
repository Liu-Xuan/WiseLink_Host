import { PgDialect } from 'drizzle-orm/pg-core';
import { ActionAttemptRepository } from '../../server/modules/action-attempt/action-attempt.repository';
import type { ActionAttemptRow } from '../../server/modules/action-attempt/action-attempt.types';
import {
  projectReviewEvidenceActivity,
  projectReviewRuntimeActivity,
} from '../../server/modules/action-attempt/review-evidence-activity';
import { resolvedReviewSourceRefs } from '../../server/modules/canonical-host/matter-review-candidate';

const receipt = {
  kind: 'SOURCE_REFS_RESOLVED' as const,
  observedAt: '2026-09-06T04:00:00.000Z',
  sourceRefIds: ['SRC-1'],
  sourceCatalogCount: 3,
};

describe('Host-observed Review evidence activity', () => {
  it('projects retries separately and never treats runtime metadata as source evidence', () => {
    const retry = {
      kind: 'MODEL_RETRY',
      observedAt: receipt.observedAt,
      requestNo: 1,
      retryNo: 1,
      delayMs: 1000,
      errorCode: 'REVIEW_GATEWAY_HTTP_503',
    };
    const stored = JSON.stringify([
      receipt,
      { ...retry, sourceRefIds: ['FORGED-REF'], privateCredential: 'secret' },
    ]);
    expect(projectReviewEvidenceActivity(stored)?.items).toEqual([receipt]);
    expect(projectReviewRuntimeActivity(stored)?.items).toEqual([retry]);
    expect([...resolvedReviewSourceRefs(stored)]).toEqual(['SRC-1']);
    expect(
      projectReviewRuntimeActivity(JSON.stringify([{ ...retry, retryNo: 3 }]))
        ?.error?.code,
    ).toBe('REVIEW_RUNTIME_ACTIVITY_UNREADABLE');
  });

  it('preserves missing and invalid receipts honestly, without exposing private fields', () => {
    expect(projectReviewEvidenceActivity(null)).toBeNull();
    expect(projectReviewEvidenceActivity('{bad private record')).toMatchObject({
      items: [],
      error: { code: 'REVIEW_ACTIVITY_UNREADABLE' },
    });
    const projected = projectReviewEvidenceActivity(
      JSON.stringify([{ ...receipt, privateCredential: 'do-not-expose' }]),
    );
    expect(projected).toEqual({
      items: [receipt],
      omittedEarlierCount: 0,
      error: null,
    });
    expect(JSON.stringify(projected)).not.toContain('do-not-expose');
  });

  it('bounds the page without deleting stored history or claiming omitted events are displayed', () => {
    const saved = JSON.stringify(Array.from({ length: 104 }, () => receipt));
    expect(projectReviewEvidenceActivity(saved)).toMatchObject({
      omittedEarlierCount: 4,
      error: null,
    });
    expect(projectReviewEvidenceActivity(saved)?.items).toHaveLength(100);
    expect(JSON.parse(saved)).toHaveLength(104);
  });

  it('appends atomically to the exact authorized attempt and retains tenant, actor and lease fences', async () => {
    const returning = jest.fn(async () => [{ attemptId: 'ATT-1' }]);
    const where = jest.fn((_condition: unknown) => ({ returning }));
    const set = jest.fn((_values: { reviewActivityJson: unknown }) => ({
      where,
    }));
    const repository = new ActionAttemptRepository({
      update: jest.fn(() => ({ set })),
    } as never);
    const row = {
      attemptId: 'ATT-1',
      tenantId: 'TENANT-1',
      workItemId: 'WI-1',
      actorUserId: 'ACTOR-1',
      requestOrigin: 'OPENCLAW_MCP_V1',
      leaseGeneration: 2,
    } as ActionAttemptRow;
    await repository.appendReviewActivity(row, receipt);
    const dialect = new PgDialect();
    const condition = dialect.sqlToQuery(where.mock.calls[0][0] as never);
    expect(condition.params).toEqual([
      'ATT-1',
      'TENANT-1',
      'WI-1',
      'ACTOR-1',
      'OPENCLAW_INTERACTIVE_REVIEW',
      'OPENCLAW_MCP_V1',
      2,
    ]);
    const update = dialect.sqlToQuery(
      (set.mock.calls[0][0] as { reviewActivityJson: never })
        .reviewActivityJson,
    );
    expect(update.sql).toContain('COALESCE');
    expect(update.sql).toContain('||');
    expect(update.params).toEqual([JSON.stringify([receipt])]);
    returning.mockResolvedValue([]);
    await expect(repository.appendReviewActivity(row, receipt)).rejects.toThrow(
      'REVIEW_ACTIVITY_BINDING_CHANGED',
    );
  });
});
