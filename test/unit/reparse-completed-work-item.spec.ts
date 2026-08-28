import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalOrdinaryWorkItemRunResponse,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';

import {
  assertSameWorkItemReparseReadback,
  assertSameWorkItemReparseRun,
  availableParseAction,
  parseActionLabel,
} from '../../client/src/pages/WorkspaceHomePage/reparse-completed-work-item';

const EXPECTED = {
  workItemId: 'WI-SAME-1',
  documentVersionId: 'DV-CURRENT-1',
};

describe('completed WorkItem explicit reparse client semantics', () => {
  it('shows 重新解析 only for a readable completed candidate in the development scope', () => {
    const action = availableParseAction(true, projection());

    expect(action).toBe('REPARSE_COMPLETED');
    expect(parseActionLabel(action!)).toBe('重新解析');
    expect(availableParseAction(false, projection())).toBeNull();
    expect(
      availableParseAction(true, projection({ package: null })),
    ).toBeNull();
  });

  it('accepts a new Attempt only when the response and fresh readback keep the same WorkItem and DV', () => {
    const run = runResponse();
    const readback = readbackResponse();

    expect(() => assertSameWorkItemReparseRun(run, EXPECTED)).not.toThrow();
    expect(() =>
      assertSameWorkItemReparseReadback(readback, EXPECTED),
    ).not.toThrow();
    expect(run.actionAttemptId).toBe('ATT-REPARSE-2');
  });

  it('rejects a duplicate WorkItem or a DV drift before replacing the page readback', () => {
    const duplicate = runResponse();
    duplicate.workItemCreated = true;
    const drifted = readbackResponse();
    drifted.workItem.source.documentVersionId = 'DV-NOT-CURRENT';

    expect(() => assertSameWorkItemReparseRun(duplicate, EXPECTED)).toThrow(
      'CANONICAL_SAME_WORK_ITEM_RETRY_MISMATCH',
    );
    expect(() => assertSameWorkItemReparseReadback(drifted, EXPECTED)).toThrow(
      'CANONICAL_SAME_WORK_ITEM_READBACK_MISMATCH',
    );
  });
});

function projection(
  override?: Partial<CanonicalWorkItemProjection>,
): CanonicalWorkItemProjection {
  return {
    phase: 'CANDIDATE_READBACK_VERIFIED',
    package: { packageId: 'PKG-NEW' },
    failure: null,
    ...override,
  } as unknown as CanonicalWorkItemProjection;
}

function runResponse(): CanonicalOrdinaryWorkItemRunResponse {
  return {
    schemaVersion: 'wiselink.3_1.ordinary_work_item_run.v1',
    workItemCreated: false,
    workItemReused: true,
    actionAttemptId: 'ATT-REPARSE-2',
    result: {
      status: 'CANDIDATE_VERTICAL_VERIFIED',
      workItem: projection({
        workItemId: EXPECTED.workItemId,
        source: {
          documentVersionId: EXPECTED.documentVersionId,
        } as never,
      }),
    },
  } as unknown as CanonicalOrdinaryWorkItemRunResponse;
}

function readbackResponse(): CanonicalDocumentParsingPageResponse {
  return {
    status: 'FRESH_READ',
    workItem: projection({
      workItemId: EXPECTED.workItemId,
      source: {
        documentVersionId: EXPECTED.documentVersionId,
      } as never,
    }),
  } as unknown as CanonicalDocumentParsingPageResponse;
}
