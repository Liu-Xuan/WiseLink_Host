import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalOverallRegenerationReadModel,
} from '@shared/api.interface';

import {
  overallRegenerationClientFailure,
  overallRegenerationInput,
  overallRegenerationPresentation,
  resetOverallRegenerationForWorkItem,
  reusableOverallRegenerationRequest,
} from '../../client/src/features/workitem/overall-regeneration-state';

describe('overall regeneration client state', () => {
  it('builds the exact request from one fresh WorkItem projection', () => {
    const input = overallRegenerationInput(freshPage(), 'request-one');

    expect(input).toEqual({
      requestId: 'request-one',
      expectedRevision: 12,
      sourceIdentity: {
        documentVersionId: 'DV-CURRENT',
        sourceArtifactId: 'SOURCE-CURRENT',
        sourceFileSha256: 'source-sha-current',
        packageId: 'PACKAGE-CURRENT',
        packageArtifactSha256: 'package-sha-current',
      },
    });
    expect(input).not.toHaveProperty('staleReason');
    expect(input).not.toHaveProperty('actor');
    expect(input).not.toHaveProperty('tenant');
  });

  it('fails honestly before POST when the current package is unavailable', () => {
    const page = freshPage();
    page.workItem.package = null;

    expect(() => overallRegenerationInput(page, 'request-one')).toThrow(
      'OVERALL_REGENERATION_SOURCE_NOT_READY',
    );
  });

  it('rejects a fresh projection from a different WorkItem', () => {
    expect(() =>
      overallRegenerationInput(freshPage(), 'request-one', 'WI-DIFFERENT'),
    ).toThrow('OVERALL_REGENERATION_SOURCE_CONTEXT_CHANGED');
  });

  it.each([
    ['RUNNING', '正在结合当前原文依据生成工程摘要', 'progress'],
    ['WAITING_INPUT', '当前还缺少受控资料', 'warning'],
    ['CONFLICT', '事项已产生新版本', 'warning'],
    ['SUCCEEDED', '新的候选工程摘要已形成', 'success'],
  ] as const)('maps %s to business language', (status, text, tone) => {
    const view = overallRegenerationPresentation(readModel(status));
    const serialized = JSON.stringify(view);

    expect(view.message).toContain(text);
    expect(view.tone).toBe(tone);
    expect(serialized).not.toContain('attempt-internal');
    expect(serialized).not.toContain('INTERNAL_HOST_ERROR');
  });

  it('keeps transport retries on the same request action', () => {
    expect(
      overallRegenerationClientFailure({
        hasStableRequest: true,
        polling: false,
        conflict: false,
        sourceUnavailable: false,
      }),
    ).toMatchObject({ label: '重试提交', retryMode: 'post' });
    expect(
      overallRegenerationClientFailure({
        hasStableRequest: true,
        polling: true,
        conflict: false,
        sourceUnavailable: false,
      }),
    ).toMatchObject({ label: '继续检查进度', retryMode: 'poll' });
  });

  it('does not reuse WorkItem A request state after routing to WorkItem B', () => {
    const stable = {
      workItemId: 'WI-A',
      input: overallRegenerationInput(freshPage(), 'request-a'),
      polling: false,
    };

    expect(reusableOverallRegenerationRequest(stable, 'WI-A', 'post')).toBe(
      stable,
    );
    expect(
      reusableOverallRegenerationRequest(stable, 'WI-B', 'post'),
    ).toBeNull();
  });

  it('creates a new revision-bound action after a conflict and fresh reload', () => {
    const first = {
      workItemId: 'WI-CURRENT',
      input: overallRegenerationInput(freshPage(12), 'request-12'),
      polling: false,
    };
    const conflict = overallRegenerationPresentation(readModel('CONFLICT'));

    expect(conflict.retryMode).toBe('new');
    expect(
      reusableOverallRegenerationRequest(
        first,
        'WI-CURRENT',
        conflict.retryMode,
      ),
    ).toBeNull();

    const next = overallRegenerationInput(freshPage(13), 'request-13');
    expect(next.expectedRevision).toBe(13);
    expect(next.requestId).toBe('request-13');
    expect(next.requestId).not.toBe(first.input.requestId);
  });

  it('restores an idle, runnable view when routing away from a disabled terminal state', () => {
    const terminal = overallRegenerationPresentation(
      readModel('WAITING_INPUT'),
    );
    expect(terminal.disabled).toBe(true);

    const nextWorkItem = resetOverallRegenerationForWorkItem();

    expect(nextWorkItem.request).toBeNull();
    expect(nextWorkItem.view).toEqual({
      label: '重新生成工程摘要',
      message: null,
      tone: 'neutral',
      busy: false,
      disabled: false,
      retryMode: 'none',
    });
  });
});

function freshPage(
  revision: number = 12,
): CanonicalDocumentParsingPageResponse {
  return {
    workItem: {
      workItemId: 'WI-CURRENT',
      revision,
      source: {
        documentVersionId: 'DV-CURRENT',
        sourceArtifactId: 'SOURCE-CURRENT',
        sourceFileSha256: 'source-sha-current',
      },
      package: {
        packageId: 'PACKAGE-CURRENT',
        artifact: { sha256: 'package-sha-current' },
      },
    },
  } as unknown as CanonicalDocumentParsingPageResponse;
}

function readModel(
  status: CanonicalOverallRegenerationReadModel['status'],
): CanonicalOverallRegenerationReadModel {
  return {
    schemaVersion: 'wiselink.3_1.overall_regeneration_read.v1',
    workItemId: 'WI-CURRENT',
    requestId: 'request-internal',
    requestedAt: '2026-08-29T00:00:00.000Z',
    requestedFromRevision: 12,
    executionRevision: 13,
    currentWorkItemRevision: 13,
    staleReason: 'USER_REQUESTED_REGENERATION',
    status,
    attemptRef: 'attempt-internal',
    projectionApplied: status === 'SUCCEEDED',
    terminalReason: null,
    terminalErrorCode: 'INTERNAL_HOST_ERROR',
    authority: {
      candidateOnly: true,
      reviewActionCreated: false,
      engineeringApprovalChanged: false,
      documentCurrentnessChanged: false,
    },
  };
}
