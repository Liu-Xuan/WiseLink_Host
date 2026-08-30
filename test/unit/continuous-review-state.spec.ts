import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { ReviewConversationReadModel } from '@shared/api.interface';

import { continuousReviewPresentation } from '../../client/src/features/review/continuous-review-state';

describe('continuous review client state', () => {
  it('keeps a same-revision active conversation writable', () => {
    expect(continuousReviewPresentation(conversation('ACTIVE', true))).toEqual(
      expect.objectContaining({
        state: 'ACTIVE',
        stateLabel: '讨论进行中',
        composerEnabled: true,
        canStartOrSync: false,
      }),
    );
  });

  it('keeps stale turns read-only and exposes the legal synchronization action', () => {
    const view = continuousReviewPresentation(
      conversation('STALE_CONTEXT', false),
    );

    expect(view).toEqual(
      expect.objectContaining({
        state: 'STALE_CONTEXT',
        stateLabel: '上下文待同步',
        contextTitle: '事项已更新',
        composerEnabled: false,
        canStartOrSync: true,
      }),
    );
    expect(view.contextMessage).toContain('同步讨论上下文');
  });

  it('keeps a closed conversation ended without a synchronization action', () => {
    expect(continuousReviewPresentation(conversation('CLOSED', true))).toEqual(
      expect.objectContaining({
        state: 'CLOSED',
        stateLabel: '本轮已结束',
        contextTitle: '本轮复核已结束',
        composerEnabled: false,
        canStartOrSync: false,
      }),
    );
  });

  it('conservatively blocks an inconsistent unsynchronized ACTIVE projection', () => {
    expect(continuousReviewPresentation(conversation('ACTIVE', false))).toEqual(
      expect.objectContaining({
        state: 'STALE_CONTEXT',
        composerEnabled: false,
        canStartOrSync: true,
      }),
    );
  });

  it('remounts the panel at the WorkItem boundary so A state cannot leak into B', async () => {
    const source = await readFile(
      resolve(
        __dirname,
        '../../client/src/pages/DocumentParsingPage/DocumentParsingPage.tsx',
      ),
      'utf8',
    );

    expect(source).toMatch(
      /<ContinuousReviewPanel\s+key=\{workItemId\}\s+workItemId=\{workItemId\}/u,
    );
  });
});

function conversation(
  status: ReviewConversationReadModel['status'],
  currentRevisionSynced: boolean,
): ReviewConversationReadModel {
  return {
    schemaVersion: 'wiselink.3_1.review_conversation.v1.c1',
    reviewConversationId: 'conversation-browser-safe',
    workItemId: 'WI-CURRENT',
    startedAtRevision: 7,
    lastSyncedRevision: 7,
    currentWorkItemRevision: currentRevisionSynced ? 7 : 8,
    currentRevisionSynced,
    status,
    createdAt: '2026-08-30T00:00:00.000Z',
    lastActiveAt: '2026-08-30T00:00:00.000Z',
    closedAt: status === 'CLOSED' ? '2026-08-30T00:05:00.000Z' : null,
    turns: [],
  };
}
