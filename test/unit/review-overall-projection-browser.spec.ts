import 'reflect-metadata';
import { AuthNPaasGuard, UserContextMiddleware } from '@lark-apaas/fullstack-nestjs-core';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type {
  CanonicalReviewOverallProjectionReceipt,
  CanonicalWorkItemProjection,
  RequestCanonicalReviewOverallProjectionRequest,
} from '@shared/api.interface';
import type { JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import { GlobalExceptionFilter } from '../../server/common/filters/exception.filter';
import { CanonicalHostReviewOverallProjectionController } from
  '../../server/modules/canonical-host/canonical-host-review-overall-projection.controller';
import { CanonicalHostReviewOverallProjectionService } from
  '../../server/modules/canonical-host/canonical-host-review-overall-projection.service';
import { DialogueBrowserScope } from '../../server/modules/canonical-host/dialogue-browser-scope.service';
import type { OAuthConfigPort } from '../../server/modules/identity/oauth-config.port';
import type { VerifiedIdentity } from '../../server/modules/identity/identity.types';
import { SessionResolver } from '../../server/modules/identity/session-resolver.service';
import { MiaodaHostedCanonicalObjectAccessAdapter } from
  '../../server/modules/work-item/miaoda-hosted-canonical-object-access.adapter';
import type { WorkItemAuthorizationBinding } from '../../server/modules/work-item/miaoda-work-item.repository';
import { miaodaHostedFinalUserActor } from '../../server/modules/work-item/production-miaoda-browser-ingress';

const BASE_PATH = '/api/canonical-host/work-items/WI-1/integrated-assessment/review-overall-projections';
const OAUTH_CONFIG: OAuthConfigPort = {
  clientId: null, redirectUri: null, tokenApiVersion: 'v3', mappingBootstrap: { kind: 'DISABLED' },
  configured: false, applicationScopeId: 'app_17bzc551rsg', sessionEnvironment: 'runtime',
};
const SOURCE = { documentVersionId: 'DV-1', sourceArtifactId: 'SRC-1', sourceFileSha256: 'a'.repeat(64),
  packageId: 'PKG-1', packageArtifactSha256: 'b'.repeat(64) };
const ARTIFACT = { ref: 'artifact://synthetic-overall', sha256: 'c'.repeat(64), byteLength: 100,
  mediaType: 'application/json', storeRole: 'UnifiedArtifactStoreCandidate' };
const COMMAND: RequestCanonicalReviewOverallProjectionRequest = {
  requestId: 'REQ-1', expectedRevision: 8, reviewConversationId: 'RC-1', reviewTurnId: 'RT-1',
  workRevisionRef: 'WORK-REVIEW', expectedWorkRevision: 3, sourceIdentity: SOURCE,
};
const GATEWAY_USER = { user_id: 'native-owner', tenant_id: 2001, app_id: 'app_17bzc551rsg',
  env: 'runtime', is_system_account: false, roles: ['wiselink_engineering_reviewer'] };
interface BindingRead { workItemId: string; tenantId: string; actorUserId: string; readScope?: 'TENANT' }
interface Probe { method: 'GET' | 'POST'; path: string; body?: unknown; gateway?: Record<string, unknown>; cookie?: string }
const ROUTES: Probe[] = [
  { method: 'GET', path: `${BASE_PATH}/eligibility` },
  { method: 'POST', path: BASE_PATH, body: COMMAND },
  { method: 'GET', path: `${BASE_PATH}/REQ-1` },
];
const priorEnv = new Map<string, string | undefined>(['SANDBOX_ID', 'MIAODA_LOCAL_DEV', 'FORCE_FRAMEWORK_ENVIRONMENT']
  .map((key: string): [string, string | undefined] => [key, process.env[key]]));
let fixture: Awaited<ReturnType<typeof buildFixture>>;

beforeEach(async () => {
  process.env.SANDBOX_ID = 'unit-hosted-sandbox';
  delete process.env.MIAODA_LOCAL_DEV;
  delete process.env.FORCE_FRAMEWORK_ENVIRONMENT;
  fixture = await buildFixture();
});
afterEach(async () => {
  await fixture.app.close();
  for (const [key, value] of priorEnv) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

it('reads ordinary saved work as ineligible through the registered native route without OAuth', async () => {
  fixture.saved.requestId = 'initial-analysis:ordinary';
  const result = await dispatchInMemory(fixture.app, ROUTES[0]);
  expect(result.status).toBe(200); expect(result.body).toEqual({ eligible: false, binding: null });
  expect(fixture.validate).not.toHaveBeenCalled();
  expect(fixture.latest).toHaveBeenCalledTimes(1);
  expect(fixture.exactSaved).not.toHaveBeenCalled();
  expect(fixture.artifacts).not.toHaveBeenCalled(); expect(fixture.insert).not.toHaveBeenCalled();
});

it.each([false, true])('uses one native owner for eligibility, project, status and idempotent replay (matching OAuth=%s)',
  async (withOauth: boolean) => {
    const cookie: string | undefined = withOauth ? 'wl_session=matching-synthetic-session' : undefined;
    const eligibility = await dispatchInMemory(fixture.app, { ...ROUTES[0], cookie });
    expect(eligibility.status).toBe(200);
    expect(eligibility.body).toEqual({ eligible: true, binding: {
      expectedRevision: 8, reviewConversationId: 'RC-1', reviewTurnId: 'RT-1',
      workRevisionRef: 'WORK-REVIEW', expectedWorkRevision: 3, sourceIdentity: SOURCE,
    } });
    const projected = await dispatchInMemory(fixture.app, { ...ROUTES[1], cookie });
    expect(projected.status).toBe(201); expect(projected.body).toMatchObject({
      status: 'SUCCEEDED', executionKind: 'DETERMINISTIC_PROJECTION', modelRequests: 0,
      workItemRevision: 9, replayed: false,
    });
    const status = await dispatchInMemory(fixture.app, { ...ROUTES[2], cookie });
    expect(status.status).toBe(200); expect(status.body).toMatchObject({ status: 'SUCCEEDED', replayed: true });
    const replay = await dispatchInMemory(fixture.app, { ...ROUTES[1], cookie });
    expect(replay.status).toBe(201); expect(replay.body).toEqual(status.body);
    expect(fixture.insert).toHaveBeenCalledTimes(1); expect(fixture.locked).toHaveBeenCalledTimes(1);
    expect(fixture.artifacts).toHaveBeenCalledTimes(2);
    expect(fixture.authorizationRead).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: '2001', actorUserId: 'native-owner', workItemId: 'WI-1',
    }), fixture.database);
    expect(fixture.sqlContexts).toHaveLength(4);
    for (const context of fixture.sqlContexts) expect(context).toMatchObject({
      userId: 'native-owner', tenantId: 2001, isSystemAccount: false,
      roles: ['wiselink_engineering_reviewer'],
    });
    if (withOauth) expect(fixture.validate).toHaveBeenCalledTimes(4);
    else expect(fixture.validate).not.toHaveBeenCalled();
    const conflict = await dispatchInMemory(fixture.app, { ...ROUTES[1], cookie,
      body: { ...COMMAND, reviewTurnId: 'RT-other' } });
    expect(conflict.status).toBe(409); expect(fixture.insert).toHaveBeenCalledTimes(1);
  });

it('keeps tenant reading separate from owner-only projection on all three endpoints', async () => {
  const actor = miaodaHostedFinalUserActor({ userId: 'native-reader', tenantId: 2001,
    appId: 'app_17bzc551rsg', env: 'runtime', roles: [] });
  await expect(fixture.access.freshRead({ actor, action: 'READ_DOCUMENT_PARSING',
    accessRoot: { kind: 'WORK_ITEM', id: 'WI-1' } })).resolves.toMatchObject({
    allowed: true, actionPolicy: { objectRelation: 'TENANT_READER' },
  });
  for (const route of ROUTES) {
    const result = await dispatchInMemory(fixture.app, { ...route, gateway: { user_id: 'native-reader' } });
    expect(result.status).toBe(404);
  }
  expectNoSavedReadsOrWrites();
});

it('rejects a cross-tenant native user before reading saved work or artifacts', async () => {
  for (const route of ROUTES) {
    const result = await dispatchInMemory(fixture.app, { ...route, gateway: { tenant_id: 2002 } });
    expect(result.status).toBe(404);
  }
  expectNoSavedReadsOrWrites();
});

it.each([
  { name: 'NeedLogin metadata', gateway: { user_id: null, login_url: 'https://login.synthetic.invalid' }, status: 401 },
  { name: 'missing native user without login URL', gateway: { user_id: null }, status: 503 },
  { name: 'missing app', gateway: { app_id: null }, status: 503 },
  { name: 'wrong app', gateway: { app_id: 'another-app' }, status: 503 },
  { name: 'wrong env', gateway: { env: 'development' }, status: 503 },
  { name: 'system account', gateway: { is_system_account: true }, status: 503 },
])('executes the real route guards for $name on every endpoint', async ({ gateway, status }) => {
  for (const route of ROUTES) {
    const result = await dispatchInMemory(fixture.app, { ...route, gateway });
    expect(result.status).toBe(status);
  }
  expect(fixture.authorizationRead).not.toHaveBeenCalled(); expectNoSavedReadsOrWrites();
});

it.each(['local marker', 'missing hosted provenance'])('rejects caller-constructed headers in %s execution', async (mode: string) => {
  if (mode === 'local marker') process.env.MIAODA_LOCAL_DEV = '1';
  else delete process.env.SANDBOX_ID;
  for (const route of ROUTES) expect((await dispatchInMemory(fixture.app, route)).status).toBe(503);
  expect(fixture.authorizationRead).not.toHaveBeenCalled(); expectNoSavedReadsOrWrites();
});

it.each(['user', 'tenant', 'app'])('rejects an optional OAuth session bound to another native %s', async (dimension: string) => {
  if (dimension === 'user') fixture.oauthIdentity.miaodaUserId = 'another-user';
  else if (dimension === 'tenant') fixture.oauthIdentity.tenantId = '2002';
  else Object.assign(fixture.oauthConfig, { applicationScopeId: 'another-app' });
  const result = await dispatchInMemory(fixture.app, { ...ROUTES[0], cookie: 'wl_session=synthetic-mismatch' });
  expect(result.status).toBe(403); expect(fixture.sqlContexts).toHaveLength(0);
  expect(fixture.authorizationRead).not.toHaveBeenCalled(); expectNoSavedReadsOrWrites();
});

it.each(['revision', 'requestId', 'documentVersionId'])('retains exact grant-to-WorkItem matching for %s', async (field: string) => {
  if (field === 'revision') fixture.binding.revision += 1;
  else if (field === 'requestId') fixture.binding.requestId = 'changed-request';
  else fixture.binding.documentVersionId = 'changed-document';
  const result = await dispatchInMemory(fixture.app, ROUTES[0]);
  expect(result.status).toBe(409); expect(result.body).toMatchObject({ error: { code: 'REVIEW_OVERALL_ACCESS_CHANGED' } });
  expectNoSavedReadsOrWrites();
});

it('requires verified request-local native identity even when the service is called directly', async () => {
  await expect(fixture.service.eligibility('WI-1', { headers: {} } as Request))
    .rejects.toThrow('NATIVE_BROWSER_IDENTITY_REQUIRED');
  expect(fixture.authorizationRead).not.toHaveBeenCalled(); expectNoSavedReadsOrWrites();
});

it('rechecks native actor identity in the locked callback and commits nothing after it changes', async () => {
  fixture.afterArtifacts(() => {
    const request = fixture.requests.at(-1)!;
    request.userContext.userId = 'changed-native-user';
  });
  const result = await dispatchInMemory(fixture.app, ROUTES[1]);
  expect(result.status).toBe(403); expect(fixture.locked).toHaveBeenCalledTimes(1);
  expect(fixture.insert).not.toHaveBeenCalled(); expect(fixture.currentRevision()).toBe(8);
});

it('fresh-reads the owner action inside the locked callback before any receipt or WorkItem commit', async () => {
  fixture.afterArtifacts(() => { fixture.binding.requestedByUserId = 'changed-owner'; });
  const result = await dispatchInMemory(fixture.app, ROUTES[1]);
  expect(result.status).toBe(404); expect(fixture.authorizationRead).toHaveBeenCalledTimes(2);
  expect(fixture.artifacts).toHaveBeenCalledTimes(2); expect(fixture.insert).not.toHaveBeenCalled();
  expect(fixture.currentRevision()).toBe(8);
});

function expectNoSavedReadsOrWrites(): void {
  expect(fixture.latest).not.toHaveBeenCalled(); expect(fixture.exactSaved).not.toHaveBeenCalled();
  expect(fixture.readExecution).not.toHaveBeenCalled(); expect(fixture.artifacts).not.toHaveBeenCalled();
  expect(fixture.locked).not.toHaveBeenCalled(); expect(fixture.insert).not.toHaveBeenCalled();
}

async function buildFixture() {
  let current: CanonicalWorkItemProjection = {
    workItemId: 'WI-1', requestId: 'WI-REQUEST-1', revision: 8,
    source: { ...SOURCE, sourceByteLength: 300 },
    package: { packageId: SOURCE.packageId, artifact: { ...ARTIFACT, sha256: SOURCE.packageArtifactSha256 } },
    integratedAssessment: { status: 'BASE_RULE_CANDIDATE_READY',
      baseRules: { schemaVersion: 'wiselink.jobaid-problem-result.v2', status: 'CANDIDATE_ONLY',
        revision: 2, workRevisionRef: 'WORK-old', workRevision: 2, artifact: ARTIFACT },
      engineerReviews: null, overallSynthesis: null, overallForAeoConfirmation: null },
  } as unknown as CanonicalWorkItemProjection;
  const saved = { workRevisionRef: 'WORK-REVIEW', workRevision: 3, workItemId: 'WI-1',
    previousWorkRevisionRef: 'WORK-old', requestId: 'review-turn:RT-1', actionAttemptId: 'ATT-REVIEW',
    basedOnWorkItemRevision: 8, documentVersionId: 'DV-1', createdAt: '2026-10-23T00:00:00.000Z',
    content: { schemaVersion: 'wiselink.jobaid-problem-work.v3', headline: 'Saved headline', listBrief: 'Saved brief',
      understanding: 'Exact saved understanding', decisiveIssueKeys: [], overviewStatus: 'CURRENT',
      roundCompletion: 'COMPLETE', issues: [], evidence: [] },
  } as unknown as JobAidWorkRevision;
  const binding: WorkItemAuthorizationBinding = { workItemId: 'WI-1', revision: 8, tenantId: '2001',
    requestId: 'WI-REQUEST-1', documentId: 'DOC-1', documentVersionId: 'DV-1', requestedByUserId: 'native-owner', runKey: 'RUN-1' };
  const authorizationRead = jest.fn(async (input: BindingRead, _database?: unknown) =>
    input.workItemId === binding.workItemId && input.tenantId === binding.tenantId &&
    (input.readScope === 'TENANT' || input.actorUserId === binding.requestedByUserId) ? binding : null);
  const access = new MiaodaHostedCanonicalObjectAccessAdapter({ loadAuthorizationBinding: authorizationRead } as never);
  const oauthIdentity: VerifiedIdentity = { subjectMappingId: 'synthetic-mapping', provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
    miaodaUserId: 'native-owner', tenantId: '2001', feishuUserId: null, feishuOpenId: 'ou-synthetic-owner',
    namespacedSubject: { namespace: 'FEISHU_OPEN_ID', subject: 'ou-synthetic-owner', tenantKey: 'synthetic-tenant' },
    verifiedAt: '2026-10-23T00:00:00.000Z' };
  const oauthConfig = { ...OAUTH_CONFIG };
  const validate = jest.fn(async () => ({ identity: oauthIdentity, revision: 1, sessionId: 'synthetic-session',
    expiresAt: new Date(Date.now() + 60_000) }));
  const sqlContexts: unknown[] = [];
  const requests: Request[] = [];
  const sqlContext = { use: (request: Request, _response: unknown, next: () => void): void => {
    sqlContexts.push(structuredClone(request.userContext)); requests.push(request); next();
  } };
  const sessions = new SessionResolver({ validate } as never, oauthConfig, sqlContext as never);
  const browser = new DialogueBrowserScope(sessions);
  const database = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) };
  let stored: { input: RequestCanonicalReviewOverallProjectionRequest; receipt: CanonicalReviewOverallProjectionReceipt } | null = null;
  const readExecution = jest.fn(async () => stored);
  const insert = jest.fn(async (value: { request: RequestCanonicalReviewOverallProjectionRequest;
    receipt: CanonicalReviewOverallProjectionReceipt }) => { stored = { input: value.request, receipt: value.receipt }; });
  const locked = jest.fn(async (_input: unknown, operation: (db: unknown, item: CanonicalWorkItemProjection) =>
    Promise<{ next: Omit<CanonicalWorkItemProjection, 'revision'>; value: CanonicalReviewOverallProjectionReceipt }>) => {
    const result = await operation(database, current);
    current = { ...result.next, revision: current.revision + 1 }; binding.revision = current.revision;
    return { saved: current, value: result.value };
  });
  const latest = jest.fn(async () => saved);
  const exactSaved = jest.fn(async () => saved);
  let artifactCount: number = 0;
  let afterArtifacts: (() => void) | null = null;
  const artifacts = jest.fn(async () => {
    artifactCount += 1; if (artifactCount === 2) afterArtifacts?.();
    return { artifact: { ...ARTIFACT, ref: `artifact://synthetic/${artifactCount}` } };
  });
  const service = new CanonicalHostReviewOverallProjectionService(sessions, access,
    { getTenantScopedByWorkItemId: jest.fn(async () => current) } as never,
    { withLockedReviewOverallProjection: locked } as never,
    { latest, reviewTurnBindingForProjection: jest.fn(async () => ({ reviewConversationId: 'RC-1' })),
      hasActiveReviewOverallConflict: jest.fn(async () => false) } as never,
    { exactSavedReviewWorkForProjection: exactSaved, assertProjectionOriginalCurrent: jest.fn() } as never,
    { read: readExecution, insert, attemptId: () => 'ATT-PROJECTION' } as never,
    { persistAndReadback: artifacts } as never);
  const moduleRef = await Test.createTestingModule({ controllers: [CanonicalHostReviewOverallProjectionController],
    providers: [{ provide: CanonicalHostReviewOverallProjectionService, useValue: service },
      { provide: DialogueBrowserScope, useValue: browser }] }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  app.useGlobalGuards(new AuthNPaasGuard(new Reflector()));
  app.useGlobalFilters(new GlobalExceptionFilter()); await app.init();
  return { app, service, saved, binding, authorizationRead, access, validate, oauthIdentity, oauthConfig,
    sqlContexts, requests, database, locked, insert, readExecution, latest, exactSaved, artifacts,
    afterArtifacts: (operation: () => void): void => { afterArtifacts = operation; }, currentRevision: () => current.revision };
}

// Real Nest/Express routes, SDK middleware and both guards, with bounded
// repository/artifact and SQL-context fixtures. This is not real DB/RLS or
// evidence that the synthetic hosted headers were authenticated by a gateway.
async function dispatchInMemory(app: INestApplication, probe: Probe): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = new Readable({ read(): void { this.push(null); } }) as unknown as Request;
    const requestRecord = request as unknown as Record<string, unknown>;
    requestRecord.method = probe.method; requestRecord.url = probe.path; requestRecord.body = probe.body;
    requestRecord.headers = { 'x-larkgw-suda-webuser': encodeURIComponent(JSON.stringify({ ...GATEWAY_USER, ...probe.gateway })),
      ...(probe.cookie ? { cookie: probe.cookie } : {}) };
    const response = new EventEmitter() as EventEmitter & Partial<Response>;
    const responseRecord = response as unknown as Record<string, unknown>;
    const headers = new Map<string, string>(); const chunks: Buffer[] = [];
    responseRecord.statusCode = 200; responseRecord.headersSent = false;
    responseRecord.setHeader = (name: string, value: unknown): void => { headers.set(name.toLowerCase(), String(value)); };
    responseRecord.getHeader = (name: string): string | undefined => headers.get(name.toLowerCase());
    responseRecord.getHeaderNames = (): string[] => [...headers.keys()];
    responseRecord.removeHeader = (name: string): void => { headers.delete(name.toLowerCase()); };
    responseRecord.write = (chunk: unknown): boolean => { chunks.push(Buffer.from(String(chunk))); return true; };
    responseRecord.end = (chunk?: unknown): typeof response => {
      if (chunk !== undefined) chunks.push(Buffer.from(String(chunk)));
      responseRecord.headersSent = true;
      const text: string = Buffer.concat(chunks).toString('utf8');
      resolve({ status: Number(responseRecord.statusCode), body: text ? JSON.parse(text) : null });
      response.emit('finish'); return response;
    };
    response.on('error', reject);
    const next: NextFunction = () => app.getHttpAdapter().getInstance()(request, response);
    new UserContextMiddleware().use(request, response as unknown as Response, next);
  });
}
