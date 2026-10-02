import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HttpException } from '@nestjs/common';
import { CanonicalJobAidProblemService } from '@server/modules/canonical-host/canonical-jobaid-problem.service';
import { GlobalExceptionFilter } from '@server/common/filters/exception.filter';
import type { CanonicalHostActor } from '@server/modules/canonical-host/canonical-host.types';
import JobAidProblemWorkspace from '@client/src/pages/DocumentParsingPage/JobAidProblemWorkspace';
import { jobAidReadAfterFailure } from '@client/src/pages/DocumentParsingPage/useJobAidWorkingRead';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

const { JSDOM } = require('jsdom');
const mockBrowserRead = jest.fn();
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
  subscribeCanonicalHostClientSession: () => () => undefined,
  readJobAidAssessmentWork: (...args: unknown[]) => mockBrowserRead(...args),
}));
jest.mock('@client/src/features/workbench/RetainedWorkbenchPanel', () => ({
  useWorkbenchPanelActive: () => true,
}));
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => createElement('button', props, children),
}));
jest.mock('@client/src/features/review/InitialAnalysisContinueButton', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/matter/SavedAssessmentReading', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/matter/saved-jobaid-reading.css', () => ({}));
jest.mock('@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css', () => ({}));

// Real public readers, global filter and client failure policy; storage/authentication
// outcomes and the HTTP transport are fixtures. This does not validate HTTP or RLS.
const actor: CanonicalHostActor = {
  userId: 'owner-test', tenantId: 'tenant-test', appId: 'app_17bzc551rsg', roles: [], env: 'test',
};

function setup() {
  const previous = jobAidReadingFixture();
  const saved = previous.current!;
  const authorization = { authorize: jest.fn().mockResolvedValue({ allowed: true,
    action: 'READ_DOCUMENT_PARSING', permissionSnapshotVersion: 'permission-test' }) };
  const permissionSnapshots = { freshRead: jest.fn().mockResolvedValue({ permissionSnapshotVersion: 'permission-test' }) };
  const registrar = { getTenantScopedByWorkItemId: jest.fn().mockResolvedValue({
    workItemId: saved.workItemId, revision: saved.basedOnWorkItemRevision,
    source: { documentVersionId: saved.documentVersionId }, integratedAssessment: null,
  }) };
  const sources = { loadAuthorizationBinding: jest.fn().mockResolvedValue({ documentVersionId: saved.documentVersionId }) };
  const mapping = { hasActiveOfficialActorMapping: jest.fn().mockResolvedValue(true) };
  const latest = jest.fn().mockResolvedValue(saved);
  const work = { readByRef: jest.fn().mockResolvedValue(saved), latest,
    readBrowserSnapshot: jest.fn(async () => ({ execution: null, current: await latest(), savedActivity: null, latestAttempt: null })),
    readExecutionStatus: jest.fn().mockResolvedValue(null) };
  const service = new CanonicalJobAidProblemService(registrar as never, {} as never, {} as never,
    authorization as never, permissionSnapshots as never, {} as never, sources as never,
    mapping as never, {} as never, work as never);
  const read = (kind: 'EXACT' | 'CURRENT', identity = actor) => kind === 'EXACT'
    ? service.readBrowserRevision(saved.workItemId, saved.workRevisionRef, identity)
    : service.readBrowser(saved.workItemId, identity);
  return { previous, saved, authorization, permissionSnapshots, registrar, sources, mapping, work, service, read };
}

async function rejection(operation: () => Promise<unknown>): Promise<unknown> {
  try { await operation(); } catch (error: unknown) { return error; }
  throw new Error('Expected the actual reader to reject');
}

function filter(error: unknown) {
  const json = jest.fn(), status = jest.fn().mockReturnValue({ json });
  new GlobalExceptionFilter().catch(error, {
    switchToHttp: () => ({ getResponse: () => ({ status, headersSent: false }) }),
  } as never);
  return { status: status.mock.calls[0][0] as number, body: json.mock.calls[0][0] };
}

function expectUnavailable(result: ReturnType<typeof filter>) {
  expect(result.status).toBe(404);
  const response = JSON.parse(JSON.stringify(result.body.error));
  delete response.timestamp;
  expect(response).toEqual({ code: 'CANONICAL_WORK_ITEM_NOT_FOUND', message: 'CANONICAL_WORK_ITEM_NOT_FOUND' });
  expect(result.body.error.stack).toBeUndefined();
  expect(result.body.error.cause).toBeUndefined();
  expect(result.body).not.toHaveProperty('content');
}

describe.each(['EXACT', 'CURRENT'] as const)('JobAid %s public read boundary', kind => {
  it('still reads an authorized exact immutable work', async () => {
    const h = setup();
    const result = await h.read(kind);
    expect(kind === 'EXACT' ? result : (result as typeof h.previous).current).toBe(h.saved);
    expect(h.sources.loadAuthorizationBinding).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: actor.tenantId, actorUserId: actor.userId, workItemId: h.saved.workItemId,
    }));
  });

  it('keeps primary permission denial generic and stops before reading saved work', async () => {
    const h = setup(); h.authorization.authorize.mockResolvedValue({ allowed: false });
    expectUnavailable(filter(await rejection(() => h.read(kind))));
    expect(h.work.readByRef).not.toHaveBeenCalled(); expect(h.work.latest).not.toHaveBeenCalled();
  });

  it('keeps a changed primary permission snapshot unavailable', async () => {
    const h = setup(); h.permissionSnapshots.freshRead.mockResolvedValue({ permissionSnapshotVersion: 'changed' });
    expectUnavailable(filter(await rejection(() => h.read(kind))));
    expect(h.work.readByRef).not.toHaveBeenCalled(); expect(h.work.latest).not.toHaveBeenCalled();
  });

  it('keeps a tenant-scoped primary object rejection generic before any work read', async () => {
    const h = setup(), other = { ...actor, tenantId: 'other-tenant' };
    h.registrar.getTenantScopedByWorkItemId.mockRejectedValue(Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND', statusCode: 404,
    }));
    expectUnavailable(filter(await rejection(() => h.read(kind, other))));
    expect(h.registrar.getTenantScopedByWorkItemId).toHaveBeenCalledWith({ workItemId: h.saved.workItemId, tenantId: other.tenantId });
    expect(h.work.readByRef).not.toHaveBeenCalled(); expect(h.work.latest).not.toHaveBeenCalled();
  });

  it('clears previous client work after primary source authorization is lost', async () => {
    const h = setup(); h.sources.loadAuthorizationBinding.mockResolvedValue(null);
    const result = filter(await rejection(() => h.read(kind)));
    expectUnavailable(result);
    expect(jobAidReadAfterFailure(h.previous, { statusCode: result.status })).toBeNull();
  });

  it.each(['REVOKED', 'DOCUMENT_VERSION_CHANGED'] as const)('clears previous work when retained secondary source is %s', async mode => {
    const h = setup();
    const passage = h.saved.content.evidence.find(item => item.kind === 'DOCUMENT_PASSAGE')!;
    if (passage.kind !== 'DOCUMENT_PASSAGE') throw new Error('Fixture passage required');
    h.saved.content.evidence = [{ ...passage, workItemId: 'secondary-work', documentVersionId: 'retained-document' }];
    h.sources.loadAuthorizationBinding.mockImplementation(async ({ workItemId }: { workItemId: string }) =>
      workItemId === h.saved.workItemId ? { documentVersionId: h.saved.documentVersionId } :
      mode === 'REVOKED' ? null : { documentVersionId: 'other-document' });
    const result = filter(await rejection(() => h.read(kind)));
    expectUnavailable(result);
    expect(h.sources.loadAuthorizationBinding.mock.calls.map(call => call[0].workItemId))
      .toEqual([h.saved.workItemId, 'secondary-work']);
    expect(jobAidReadAfterFailure(h.previous, { statusCode: result.status })).toBeNull();
  });

  it('keeps an inactive actor mapping unavailable without exposing an actor marker', async () => {
    const h = setup(); h.mapping.hasActiveOfficialActorMapping.mockResolvedValue(false);
    const other = { ...actor, userId: 'other-actor' };
    const result = filter(await rejection(() => h.read(kind, other)));
    expectUnavailable(result);
    expect(h.mapping.hasActiveOfficialActorMapping).toHaveBeenCalledWith({ tenantId: actor.tenantId, actorId: other.userId }, undefined);
    expect(h.sources.loadAuthorizationBinding).not.toHaveBeenCalled();
    expect(jobAidReadAfterFailure(h.previous, { statusCode: result.status })).toBeNull();
  });

  it.each(['WORK', 'SOURCE'] as const)('does not convert unknown %s storage failure to missing', async port => {
    const h = setup();
    if (port === 'WORK') { h.work.readByRef.mockRejectedValue(new Error('STORAGE_FAILURE')); h.work.latest.mockRejectedValue(new Error('STORAGE_FAILURE')); }
    else h.sources.loadAuthorizationBinding.mockRejectedValue(new Error('STORAGE_FAILURE'));
    const result = filter(await rejection(() => h.read(kind)));
    expect(result.status).toBe(500); expect(result.body.error.code).toBe('INTERNAL_ERROR');
    expect(jobAidReadAfterFailure(h.previous, { statusCode: result.status })).toBe(h.previous);
  });

  it('preserves an explicit version conflict rather than treating it as unavailable', async () => {
    const h = setup();
    h.sources.loadAuthorizationBinding.mockRejectedValue(Object.assign(new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED'), {
      code: 'EXPLICIT_VERSION_CONFLICT', statusCode: 409,
    }));
    const result = filter(await rejection(() => h.read(kind)));
    expect(result.status).toBe(409); expect(result.body.error.code).toBe('EXPLICIT_VERSION_CONFLICT');
    expect(jobAidReadAfterFailure(h.previous, { statusCode: result.status })).toBeNull();
  });

  it('preserves an explicit HTTP version conflict carrying the same internal marker', async () => {
    const h = setup();
    const conflict = new HttpException('JOBAID_SOURCE_AUTHORIZATION_CHANGED', 409);
    h.sources.loadAuthorizationBinding.mockRejectedValue(conflict);
    const error = await rejection(() => h.read(kind));
    expect(error).toBe(conflict);
    expect(filter(error).status).toBe(409);
  });

  it.each(['JOBAID_ATTACHMENT_AUTHORIZATION_CHANGED', 'JOBAID_QUERY_RECEIPT_AUTHORIZATION_CHANGED'])('does not reclassify unverified category %s', async message => {
    const h = setup(); h.sources.loadAuthorizationBinding.mockRejectedValue(new Error(message));
    const result = filter(await rejection(() => h.read(kind)));
    expect(result.status).toBe(500); expect(result.body.error.code).toBe('INTERNAL_ERROR');
  });
});

test('missing exact work has the same public response as denied access', async () => {
  const h = setup(); h.work.readByRef.mockResolvedValue(null);
  const missing = filter(await rejection(() => h.read('EXACT')));
  expectUnavailable(missing);
  h.authorization.authorize.mockResolvedValue({ allowed: false });
  const denied = filter(await rejection(() => h.read('EXACT')));
  const normalize = (value: ReturnType<typeof filter>) => ({ ...value.body.error, timestamp: 0 });
  expect(normalize(missing)).toEqual(normalize(denied));
  expect(jobAidReadAfterFailure(h.previous, { statusCode: missing.status })).toBeNull();
});

test('exact repository read remains tenant scoped when that tenant has no work', async () => {
  const h = setup(), other = { ...actor, tenantId: 'other-tenant' };
  h.work.readByRef.mockImplementation(async ({ tenantId }: { tenantId: string }) => tenantId === actor.tenantId ? h.saved : null);
  expectUnavailable(filter(await rejection(() => h.read('EXACT', other))));
  expect(h.work.readByRef).toHaveBeenCalledWith({ tenantId: other.tenantId, workItemId: h.saved.workItemId, workRevisionRef: h.saved.workRevisionRef });
});

test('an empty current workspace remains an allowed empty read', async () => {
  const h = setup(); h.work.latest.mockResolvedValue(null);
  expect((await h.read('CURRENT') as typeof h.previous).current).toBeNull();
});

test('runtime evidence checks still expose their original internal rejection to runtime callers', async () => {
  const h = setup(); h.sources.loadAuthorizationBinding.mockResolvedValue(null);
  const check = Reflect.get(h.service, 'assertEvidenceOwned') as (...args: unknown[]) => Promise<void>;
  const error = await rejection(() => check.call(h.service, h.saved.content.evidence, actor.tenantId, actor.userId, h.saved.workItemId));
  expect(String(error)).toContain('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
  expect(error).not.toHaveProperty('statusCode');
});

test('actual current reader denial through the filter clears the old body in the existing component', async () => {
  const h = setup(), dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  h.previous.executionStatus = 'RUNNING';
  const before = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']) {
    before.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key], configurable: true, writable: true });
  }
  const container = dom.window.document.getElementById('root')!;
  let root: Root | null = createRoot(container);
  try {
    jest.useFakeTimers();
    mockBrowserRead.mockReset(); mockBrowserRead.mockResolvedValueOnce(h.previous);
    await act(async () => root!.render(createElement(JobAidProblemWorkspace, { workItemId: h.saved.workItemId, onLocateDocument: jest.fn() })));
    expect(container.querySelector('[data-work-revision-ref]')).not.toBeNull();
    h.sources.loadAuthorizationBinding.mockResolvedValue(null);
    const response = filter(await rejection(() => h.read('CURRENT')));
    mockBrowserRead.mockRejectedValueOnce(Object.assign(new Error(response.body.error.message), { statusCode: response.status, code: response.body.error.code }));
    await act(async () => { jest.advanceTimersByTime(6000); });
    expect(mockBrowserRead).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-work-revision-ref]')).toBeNull();
    expect(container.textContent).not.toContain(h.saved.content.headline);
    expect(jobAidReadAfterFailure(h.previous, { statusCode: response.status })).toBeNull();
  } finally {
    await act(async () => root!.unmount()); root = null; dom.window.close();
    for (const [key, descriptor] of before) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    jest.useRealTimers();
  }
});
