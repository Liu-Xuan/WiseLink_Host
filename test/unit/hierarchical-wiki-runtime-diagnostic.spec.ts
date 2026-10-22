import type { HierarchicalWikiStatus } from '../../shared/hierarchical-wiki.interface';
import type { NavigationRequest } from '../../client/src/pages/DocumentParsingPage/runtime-monitor/monitor-types';
import { adaptHierarchicalWikiStatus, wikiDiagnosticRoute } from '../../client/src/features/derived-summary/adapt-hierarchical-wiki-status';

const context = { scopeKey: 'session1:wiki:summary1', observedAt: '2026-10-22T05:01:00Z',
  mode: 'live' as const, environment: 'isolated test directory read', label: 'B787 · ATA 46' };
function status(): HierarchicalWikiStatus {
  return {
    wikiId: 'wiki1', summaryId: 'summary1', parentSummaryId: 'fleet',
    scope: { kind: 'ATA2', title: context.label, fleetFamilyId: 'B787', fleetModelIds: [],
      ata2: '46', ata4: null, selectionReason: 'confirmed membership' },
    enabled: true, state: 'WAITING_UPSTREAM', desiredGeneration: 3, completedGeneration: 1,
    firstDirtyAt: '2026-10-22T04:00:00Z', dueAt: '2026-10-22T04:20:00Z',
    coveredMembers: [
      { kind: 'WORK_ITEM_WORK', workItemId: 'wi1', documentVersionId: 'doc1', workRef: 'work1', workRevision: 2, issueKeys: [] },
      { kind: 'DERIVED_SUMMARY', summaryId: 'child1', summaryRef: 'child-rev1', summaryRevision: 4 },
      { kind: 'DOCUMENT_READING', documentVersionId: 'doc2', parseRunId: 'parse2', semanticRevision: 5,
        readingRunRef: 'read2', readingRevision: 6 },
    ],
    waiting: [{ kind: 'MATTER', subjectId: 'matter1', requestId: 'upstream-request', documentVersionId: null, status: 'RUNNING' }],
    activeRequest: { requestId: 'request1', attemptRef: 'attempt1', status: 'RUNNING', claimCount: 2, executorSessionKey: null },
    errorCode: null, coverage: 'AUTHORIZED_CLASSIFIED_HOST_MATERIAL', lastCheckedAt: '2026-10-22T05:00:00Z', inventoryComplete: true,
  };
}
function event(kind: NavigationRequest['kind'], ref: string, more: Partial<NavigationRequest> = {}): NavigationRequest {
  return { kind, ref, scopeKey: context.scopeKey, nodeId: 'knowledge.wiki', ...more };
}

it('keeps delivered coverage, active execution and waiting facts separate without inventing timestamps or a request collection', () => {
  const read = status();
  const runtime = adaptHierarchicalWikiStatus(read, read.summaryId, context);
  const wiki = runtime.nodes[0];
  expect(runtime.meta.observedAt).toBe(context.observedAt);
  expect(wiki.sourceObservedAt).toBe(read.lastCheckedAt);
  expect(wiki.inputRefs.map(ref => ref.ref)).toEqual(['work1', 'child-rev1', 'read2']);
  expect(wiki.requests).toHaveLength(1);
  expect(wiki.requests[0]).toMatchObject({ id: 'request1', recordKind: 'request', status: { status: 'RUNNING' } });
  expect(wiki.requests[0]).not.toHaveProperty('createdAt');
  expect(wiki.requests[0]).not.toHaveProperty('startedAt');
  expect(wiki.requests[0]).not.toHaveProperty('firstSavedAt');
  expect(wiki.requestCompleteness).toBe('partial');
  expect(wiki.summary).toContain('目标代次 3，完成代次 1');
  expect(wiki.summary).toContain(read.dueAt);
  expect(wiki.summary).toContain('MATTER matter1：RUNNING');
  expect(runtime.resources).toBeUndefined();
});

it('does not claim the saved reading consumed an exact revision absent from the directory', () => {
  const runtime = adaptHierarchicalWikiStatus(status(), 'summary1', context);
  expect(runtime.edges).toEqual([expect.objectContaining({ from: 'knowledge.wiki', to: 'surface.reading', status: 'unknown', refs: ['summary1'] })]);
  expect(runtime.nodes[1].coverage).toBe('当前正文修订未在目录返回');
  expect(wikiDiagnosticRoute(event('artifact', 'summary1'), runtime, status())).toBe('/summaries/summary1');
});

it('uses the existing exact member routes and the actual active request attempt', () => {
  const read = status(), runtime = adaptHierarchicalWikiStatus(read, 'summary1', context);
  expect(wikiDiagnosticRoute(event('source', 'work1'), runtime, read)).toBe('/knowledge?subjectKind=WORK_ITEM&subjectId=wi1&workRef=work1');
  expect(wikiDiagnosticRoute(event('source', 'child-rev1'), runtime, read)).toBe('/summaries/child1?summaryRef=child-rev1');
  expect(wikiDiagnosticRoute(event('source', 'read2'), runtime, read)).toBe('/document-versions/doc2?parseRunId=parse2&semanticRevision=5&readingRevision=6&readingRunRef=read2');
  expect(wikiDiagnosticRoute(event('request', 'request1', { recordKind: 'request', requestId: 'request1' }), runtime, read))
    .toBe('/summaries/summary1?attemptRef=attempt1');
});

it('rejects stale scope, replaced request and member references without accepting arbitrary routes', () => {
  const read = status(), runtime = adaptHierarchicalWikiStatus(read, 'summary1', context);
  const source = event('source', 'work1');
  expect(wikiDiagnosticRoute({ ...source, scopeKey: 'other-session' }, runtime, read)).toBeNull();
  expect(wikiDiagnosticRoute({ ...source, subjectRef: 'other-summary' }, runtime, read)).toBeNull();
  expect(wikiDiagnosticRoute({ ...source, nodeId: 'surface.reading' }, runtime, read)).toBeNull();
  expect(wikiDiagnosticRoute(source, runtime, { ...read, coveredMembers: [] })).toBeNull();
  expect(wikiDiagnosticRoute(event('artifact', 'https://untrusted.example'), runtime, read)).toBeNull();
  const request = event('request', 'request1', { recordKind: 'request', requestId: 'request1' });
  expect(wikiDiagnosticRoute(request, runtime, { ...read, activeRequest: null })).toBeNull();
  expect(wikiDiagnosticRoute({ ...request, attemptId: 'attempt1' }, runtime, read)).toBeNull();
  expect(wikiDiagnosticRoute({ ...request, recordKind: 'attempt' }, runtime, read)).toBeNull();
});

it.each([undefined, null])('leaves unknown execution and empty saves unknown when activeRequest is %s', activeRequest => {
  const read = { ...status(), activeRequest, state: 'EMPTY' as const, completedGeneration: 0, coveredMembers: [] };
  const runtime = adaptHierarchicalWikiStatus(read, 'summary1', context);
  expect(runtime.nodes[0].requests).toEqual([]);
  expect(runtime.nodes[0].requestCompleteness).toBe('not_provided');
  expect(runtime.nodes.flatMap(node => node.outputs)).toEqual([]);
  expect(runtime.nodes[0].execution).toBe('当前目录未提供活跃执行');
});

it('rejects a mismatched directory identity', () => {
  expect(() => adaptHierarchicalWikiStatus(status(), 'other-summary', context)).toThrow('Wiki 观察与当前范围不一致');
});
