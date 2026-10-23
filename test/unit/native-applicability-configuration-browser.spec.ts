import 'reflect-metadata';
import { AuthNPaasGuard, UserContextMiddleware } from '@lark-apaas/fullstack-nestjs-core';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type {
  CanonicalApplicabilitySelectionReviewDraft,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import { GlobalExceptionFilter } from '../../server/common/filters/exception.filter';
import type { FleetMasterDataSource } from '../../server/modules/assessment-workbench/applicability-fleet/fleetMasterData';
import { CanonicalHostApplicabilitySelectionController } from '../../server/modules/canonical-host/canonical-host-applicability-selection.controller';
import { CanonicalHostApplicabilitySelectionService } from '../../server/modules/canonical-host/canonical-host-applicability-selection.service';
import { ConfigurationEvidenceController } from '../../server/modules/canonical-host/configuration-evidence/configuration-evidence.controller';
import { ConfigurationEvidenceService } from '../../server/modules/canonical-host/configuration-evidence/configuration-evidence.service';
import type {
  CompleteConfigurationEvidenceQueryInput,
  ConfigurationEvidenceQueryAttemptReadModel,
  ConfigurationEvidenceQueryResponse,
  RefreshConfigurationEvidenceRequest,
  ReserveConfigurationEvidenceQueryInput,
} from '../../server/modules/canonical-host/configuration-evidence/configuration-evidence.persistence.types';
import { UnconfiguredGetInstallationEventsAdapter } from '../../server/modules/canonical-host/configuration-evidence/get-installation-events.port';
import { DialogueBrowserScope } from '../../server/modules/canonical-host/dialogue-browser-scope.service';
import type { VerifiedIdentity } from '../../server/modules/identity/identity.types';
import type { OAuthConfigPort } from '../../server/modules/identity/oauth-config.port';
import { SessionResolver } from '../../server/modules/identity/session-resolver.service';
import type { CanonicalObjectAccessAction } from '../../server/modules/work-item/canonical-object-access.port';
import { MiaodaHostedCanonicalObjectAccessAdapter } from '../../server/modules/work-item/miaoda-hosted-canonical-object-access.adapter';
import type { WorkItemAuthorizationBinding } from '../../server/modules/work-item/miaoda-work-item.repository';
import { miaodaHostedFinalUserActor } from '../../server/modules/work-item/production-miaoda-browser-ingress';

const WORK_ITEM_ID = 'WI-PANEL-1';
const SELECTION = `/api/work-items/${WORK_ITEM_ID}/applicability-selection`;
const CONFIGURATION = `/api/canonical-host/work-items/${WORK_ITEM_ID}/configuration-evidence`;
const GATEWAY_USER = { user_id: 'native-owner', tenant_id: 2001, app_id: 'app_17bzc551rsg',
  env: 'runtime', is_system_account: false, roles: ['wiselink_engineering_reviewer'] };
const OAUTH_CONFIG: OAuthConfigPort = {
  clientId: null, redirectUri: null, tokenApiVersion: 'v3', mappingBootstrap: { kind: 'DISABLED' },
  configured: false, applicationScopeId: 'app_17bzc551rsg', sessionEnvironment: 'runtime',
};
const PREVIEW = { aircraftIdentifier: 'B-1234', asOf: '2026-08-28', expectedWorkItemRevision: 7 };
const QUERY: RefreshConfigurationEvidenceRequest = {
  schemaVersion: 'wiselink.3_1.refresh_configuration_evidence.v1', requestId: 'REQ-CONFIG',
  expectedRevision: 7, aircraftIdentifier: 'B-1234', assessmentAsOf: '2026-08-29T23:59:59.999Z',
  windowStart: null, gapRefs: ['GAP-CONFIGURATION'],
  targets: [{ kind: 'EQUIPMENT', equipmentKey: 'OPTION-X', positionId: null }],
};
const STRUCTURAL_DRAFT: CanonicalApplicabilitySelectionReviewDraft = {
  schemaVersion: 'wiselink.3_1.applicability_selection_review_draft.v1', workItemId: WORK_ITEM_ID,
  documentVersionId: 'DV-1', ...PREVIEW,
  fleetSource: { snapshotId: 'fleet-snapshot-1', sourceRevisionKey: 'fleet-r1',
    authorityRevision: 'authority-r1', sourceAsOf: '2026-08-26' },
  expiresAt: '2026-10-24T00:00:00.000Z', confirmationToken: '0'.repeat(64),
};
interface Probe {
  method: 'GET' | 'POST'; path: string; action: CanonicalObjectAccessAction;
  body?: unknown; gateway?: Record<string, unknown>; cookie?: string;
}
const ROUTES: Probe[] = [
  { method: 'GET', path: SELECTION, action: 'READ_WORK_ITEM' },
  { method: 'GET', path: `${SELECTION}/review-action`, action: 'CONFIGURE_APPLICABILITY_SELECTION' },
  { method: 'POST', path: `${SELECTION}/review-action/preview`, action: 'CONFIGURE_APPLICABILITY_SELECTION', body: PREVIEW },
  { method: 'POST', path: `${SELECTION}/review-action/confirm`, action: 'CONFIGURE_APPLICABILITY_SELECTION',
    body: { draft: STRUCTURAL_DRAFT, confirmed: true } },
  { method: 'GET', path: `${CONFIGURATION}/status`, action: 'READ_CONFIGURATION_EVIDENCE' },
  { method: 'POST', path: `${CONFIGURATION}/queries`, action: 'REFRESH_CONFIGURATION_EVIDENCE', body: QUERY },
  { method: 'GET', path: `${CONFIGURATION}/queries/EQ-REQ-CONFIG`, action: 'READ_CONFIGURATION_EVIDENCE' },
  { method: 'POST', path: `${CONFIGURATION}/candidate-evidence/CE-REQ-CONFIG/adoptions`,
    action: 'REFRESH_CONFIGURATION_EVIDENCE', body: { expectedRevision: 7 } },
  { method: 'GET', path: `${CONFIGURATION}/snapshots/current`, action: 'READ_CONFIGURATION_EVIDENCE' },
  { method: 'GET', path: `${CONFIGURATION}/snapshots/missing-snapshot`, action: 'READ_CONFIGURATION_EVIDENCE' },
];
const REPRESENTATIVE_ROUTES = [ROUTES[0], ROUTES[2], ROUTES[4], ROUTES[5]];
const ENV_KEYS = ['SANDBOX_ID', 'MIAODA_LOCAL_DEV', 'FORCE_FRAMEWORK_ENVIRONMENT',
  'WL_APPLICABILITY_SELECTION_REVIEW_ACTION_ENABLED', 'WL_OPENCLAW_SERVICE_WORK_ITEM_ID',
  'WL_APPLICABILITY_SELECTION_REVIEW_SIGNING_KEY', 'WL_OPENCLAW_SERVICE_ADDITIONAL_WORK_ITEM_IDS'];
const priorEnv = new Map(ENV_KEYS.map((key: string): [string, string | undefined] => [key, process.env[key]]));
let fixture: Awaited<ReturnType<typeof buildFixture>>;

beforeEach(async () => {
  process.env.SANDBOX_ID = 'unit-hosted-sandbox';
  delete process.env.MIAODA_LOCAL_DEV; delete process.env.FORCE_FRAMEWORK_ENVIRONMENT;
  process.env.WL_APPLICABILITY_SELECTION_REVIEW_ACTION_ENABLED = '1';
  process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID = 'WI-legacy';
  process.env.WL_APPLICABILITY_SELECTION_REVIEW_SIGNING_KEY = 'test-only-signing-key-32-characters-long';
  process.env.WL_OPENCLAW_SERVICE_ADDITIONAL_WORK_ITEM_IDS = JSON.stringify([WORK_ITEM_ID]);
  fixture = await buildFixture();
});
afterEach(async () => {
  await fixture.app.close();
  for (const [key, value] of priorEnv) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

it.each([false, true])('runs all ten owner routes with native SQL and no extra login (matching OAuth=%s)',
  async (withOauth: boolean) => {
    const cookie = withOauth ? 'wl_session=matching-synthetic-session' : undefined;
    const call = (index: number, body?: unknown) => checkedDispatch({ ...ROUTES[index], cookie,
      ...(body === undefined ? {} : { body }) });
    expect((await call(0)).body).toMatchObject({ workItemRevision: 7, asOf: '2026-08-27' });
    expect((await call(1)).body).toEqual({ enabled: true });
    const preview = await call(2);
    expect(preview.status).toBe(201);
    expect(fixture.registrar.compareAndSet).not.toHaveBeenCalled();
    const confirmed = await call(3, { draft: preview.body, confirmed: true });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body).toMatchObject({ workItemRevision: 8, asOf: '2026-08-28', currentness: 'CURRENT' });
    expect((await call(4)).body).toMatchObject({ source: { configured: false }, current: null, latestQuery: null });
    const query = await call(5, { ...QUERY, expectedRevision: 8 });
    expect(query.status).toBe(201);
    expect(query.body).toMatchObject({ workItemRevision: 8, replayed: false, candidate: {
      terminalStatus: 'NOT_CONNECTED', adoption: { status: 'CANDIDATE_UNADOPTED' },
      request: { capabilityGrant: { sourceConfigured: false } },
      candidateSnapshot: { facts: [{ truth: 'UNKNOWN', value: null, status: 'WAITING_INPUT' }],
        predicateTraces: [{ dependencyObservation: { sourceErrorCode: 'SOURCE_NOT_CONFIGURED' } }] },
    }, authority: { queryAdvancesWorkItemRevision: false, notConnectedMeansFalse: false } });
    const queryStatus = await call(6);
    expect(queryStatus.status).toBe(200);
    expect((queryStatus.body as ConfigurationEvidenceQueryResponse).candidate)
      .toEqual((query.body as ConfigurationEvidenceQueryResponse).candidate);
    const adoption = await call(7, { expectedRevision: 8 });
    expect(adoption.status).toBe(409);
    expect(adoption.body).toMatchObject({ error: { code: 'CONFIGURATION_EVIDENCE_CANDIDATE_NOT_ADOPTABLE' } });
    expect((await call(8)).body).toMatchObject({ status: 'EMPTY', current: null, history: [] });
    expect((await call(9)).status).toBe(404);
    expect(fixture.store.readSnapshot).toHaveBeenCalledWith({
      tenantId: '2001', workItemId: WORK_ITEM_ID, snapshotId: 'missing-snapshot',
    });
    const replay = await call(5, { ...QUERY, expectedRevision: 8 });
    expect(replay.body).toMatchObject({ replayed: true });
    expect(fixture.queryStore.reserve).toHaveBeenCalledTimes(1);
    expect(fixture.queryStore.complete).toHaveBeenCalledTimes(1);
    expect(fixture.registrar.compareAndSet).toHaveBeenCalledTimes(1);
    expect(fixture.currentRevision()).toBe(8);
    expect(fixture.store.commit).not.toHaveBeenCalled();
    expect(fixture.queryStore.markAdopted).not.toHaveBeenCalled();
    expect(fixture.externalPort).not.toHaveBeenCalled();
    expect(fixture.serviceRole).not.toHaveBeenCalled();
    for (const context of fixture.sqlContexts) expect(context).toMatchObject({
      userId: 'native-owner', tenantId: 2001, appId: 'app_17bzc551rsg', env: 'runtime',
      isSystemAccount: false, roles: ['wiselink_engineering_reviewer'],
    });
    if (withOauth) expect(fixture.validate).toHaveBeenCalledTimes(11);
    else expect(fixture.validate).not.toHaveBeenCalled();
  });

it('keeps both owner-only panels closed even when the same tenant reader has generic native READ', async () => {
  const actor = miaodaHostedFinalUserActor({ userId: 'native-reader', tenantId: 2001,
    appId: 'app_17bzc551rsg', env: 'runtime', roles: [] });
  for (const action of ['READ_WORK_ITEM', 'READ_CONFIGURATION_EVIDENCE'] as const) {
    await expect(fixture.access.freshRead({ actor, action, accessRoot: { kind: 'WORK_ITEM', id: WORK_ITEM_ID } }))
      .resolves.toMatchObject({ allowed: true, actionPolicy: { objectRelation: 'TENANT_READER' } });
  }
  for (const route of ROUTES) {
    expect((await checkedDispatch({ ...route, gateway: { user_id: 'native-reader', roles: [] } })).status).toBe(404);
  }
  expectNoBusinessReadsOrWrites();
});

it('rejects cross-tenant GET and POST requests before loading either panel', async () => {
  for (const route of REPRESENTATIVE_ROUTES) {
    expect((await checkedDispatch({ ...route, gateway: { tenant_id: 2002 } })).status).toBe(404);
  }
  expectNoBusinessReadsOrWrites();
});

it.each([
  { name: 'NeedLogin metadata', gateway: { user_id: null, login_url: 'https://login.synthetic.invalid' }, status: 401 },
  { name: 'missing user without login URL', gateway: { user_id: null }, status: 503 },
  { name: 'missing app', gateway: { app_id: null }, status: 503 },
  { name: 'wrong app', gateway: { app_id: 'another-app' }, status: 503 },
  { name: 'wrong environment', gateway: { env: 'development' }, status: 503 },
  { name: 'system account', gateway: { is_system_account: true }, status: 503 },
])('runs the actual GET and POST ingress guards for $name on both controllers', async ({ gateway, status }) => {
  for (const route of REPRESENTATIVE_ROUTES) {
    expect((await dispatchInMemory(fixture.app, { ...route, gateway })).status).toBe(status);
  }
  expect(fixture.authorizationRead).not.toHaveBeenCalled();
  expect(fixture.sqlContexts).toHaveLength(0); expectNoBusinessReadsOrWrites();
});

it.each(['local marker', 'missing hosted provenance'])('rejects synthetic headers during %s execution', async (mode: string) => {
  if (mode === 'local marker') process.env.MIAODA_LOCAL_DEV = '1'; else delete process.env.SANDBOX_ID;
  for (const route of REPRESENTATIVE_ROUTES) expect((await dispatchInMemory(fixture.app, route)).status).toBe(503);
  expect(fixture.authorizationRead).not.toHaveBeenCalled(); expectNoBusinessReadsOrWrites();
});

it.each(['user', 'tenant', 'app'])('rejects a supplied OAuth identity with a different native %s', async (dimension: string) => {
  if (dimension === 'user') fixture.oauthIdentity.miaodaUserId = 'another-user';
  else if (dimension === 'tenant') fixture.oauthIdentity.tenantId = '2002';
  else Object.assign(fixture.oauthConfig, { applicationScopeId: 'another-app' });
  for (const route of REPRESENTATIVE_ROUTES) {
    const result = await dispatchInMemory(fixture.app, { ...route, cookie: 'wl_session=synthetic-mismatch' });
    expect(result.status).toBe(403);
  }
  expect(fixture.sqlContexts).toHaveLength(0);
  expect(fixture.authorizationRead).not.toHaveBeenCalled(); expectNoBusinessReadsOrWrites();
});

it('requires request-local native identity when either service is called directly', async () => {
  await expect(fixture.selection.read(WORK_ITEM_ID, {} as Request)).rejects.toThrow('NATIVE_BROWSER_IDENTITY_REQUIRED');
  await expect(fixture.configuration.status(WORK_ITEM_ID, {} as Request)).rejects.toThrow('NATIVE_BROWSER_IDENTITY_REQUIRED');
  expect(fixture.authorizationRead).not.toHaveBeenCalled(); expectNoBusinessReadsOrWrites();
});

it('rejects native actor changes after scope entry and before either service loads data', async () => {
  fixture.onSql((request: Request): void => { request.userContext.userId = 'changed-native-user'; });
  for (const route of [ROUTES[0], ROUTES[4]]) {
    expect((await dispatchInMemory(fixture.app, route)).status).toBe(403);
  }
  expect(fixture.authorizationRead).not.toHaveBeenCalled(); expectNoBusinessReadsOrWrites();
});

it.each(['revision', 'documentVersionId'])('retains grant-to-WorkItem matching for %s on both panels', async (field: string) => {
  if (field === 'revision') fixture.binding.revision += 1; else fixture.binding.documentVersionId = 'changed-document';
  expect((await checkedDispatch(ROUTES[0])).status).toBe(409);
  expect((await checkedDispatch(ROUTES[4])).status).toBe(404);
  expect(fixture.fleet.readCurrentForAircraft).not.toHaveBeenCalled();
  expect(fixture.queryStore.findLatest).not.toHaveBeenCalled(); expect(fixture.store.readCurrent).not.toHaveBeenCalled();
  expect(fixture.registrar.compareAndSet).not.toHaveBeenCalled(); expect(fixture.externalPort).not.toHaveBeenCalled();
});

async function checkedDispatch(probe: Probe): Promise<{ status: number; body: unknown }> {
  const reads = fixture.runRead.mock.calls.length; const writes = fixture.runWrite.mock.calls.length;
  const grants = fixture.freshRead.mock.calls.length; const contexts = fixture.sqlContexts.length;
  const result = await dispatchInMemory(fixture.app, probe);
  expect(fixture.runRead).toHaveBeenCalledTimes(reads + (probe.method === 'GET' ? 1 : 0));
  expect(fixture.runWrite).toHaveBeenCalledTimes(writes + (probe.method === 'POST' ? 1 : 0));
  expect(fixture.freshRead.mock.calls[grants][0]).toMatchObject({ action: probe.action,
    actor: { identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT' }, accessRoot: { kind: 'WORK_ITEM', id: WORK_ITEM_ID } });
  expect(fixture.sqlContexts).toHaveLength(contexts + 1);
  return result;
}

function expectNoBusinessReadsOrWrites(): void {
  for (const operation of [...Object.values(fixture.registrar), ...Object.values(fixture.fleet),
    ...Object.values(fixture.store), ...Object.values(fixture.queryStore), fixture.engineerReview.pageContext,
    fixture.externalPort]) expect(operation).not.toHaveBeenCalled();
}

async function buildFixture() {
  let current = initialWorkItem();
  const binding: WorkItemAuthorizationBinding = { workItemId: WORK_ITEM_ID, revision: 7, tenantId: '2001',
    requestId: 'WI-REQUEST-1', documentId: 'DOC-1', documentVersionId: 'DV-1', requestedByUserId: 'native-owner', runKey: 'RUN-1' };
  const authorizationRead = jest.fn(async (input: { workItemId: string; tenantId: string; actorUserId: string; readScope?: 'TENANT' }) =>
    input.workItemId === binding.workItemId && input.tenantId === binding.tenantId &&
    (input.readScope === 'TENANT' || input.actorUserId === binding.requestedByUserId) ? binding : null);
  const access = new MiaodaHostedCanonicalObjectAccessAdapter({ loadAuthorizationBinding: authorizationRead } as never);
  const freshRead = jest.spyOn(access, 'freshRead');
  const oauthIdentity: VerifiedIdentity = { subjectMappingId: 'synthetic-mapping', provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
    miaodaUserId: 'native-owner', tenantId: '2001', feishuUserId: null, feishuOpenId: 'ou-synthetic-owner',
    namespacedSubject: { namespace: 'FEISHU_OPEN_ID', subject: 'ou-synthetic-owner', tenantKey: 'synthetic-tenant' },
    verifiedAt: '2026-10-23T00:00:00.000Z' };
  const oauthConfig = { ...OAUTH_CONFIG };
  const validate = jest.fn(async () => ({ identity: oauthIdentity, revision: 1, sessionId: 'synthetic-session',
    expiresAt: new Date(Date.now() + 60_000) }));
  const sqlContexts: unknown[] = []; let onSql: ((request: Request) => void) | null = null;
  const sqlContext = { use: (request: Request, _response: unknown, next: () => void): void => {
    sqlContexts.push(structuredClone(request.userContext)); onSql?.(request); next();
  } };
  const sessions = new SessionResolver({ validate } as never, oauthConfig, sqlContext as never);
  const browser = new DialogueBrowserScope(sessions);
  const runRead = jest.spyOn(browser, 'runRead'); const runWrite = jest.spyOn(browser, 'runNativeWrite');
  const serviceRole = jest.spyOn(browser, 'run');
  const registrar = {
    getTenantScopedByWorkItemId: jest.fn(async () => structuredClone(current)),
    compareAndSet: jest.fn(async (input: { expectedRevision: number; next: Omit<CanonicalWorkItemProjection, 'revision'> }) => {
      if (input.expectedRevision !== current.revision) throw new Error('WORK_ITEM_CAS_CONFLICT');
      current = { ...structuredClone(input.next), revision: current.revision + 1 }; binding.revision = current.revision;
      return structuredClone(current);
    }),
  };
  const fleet = { readCurrentForAircraft: jest.fn(async (): Promise<FleetMasterDataSource> => ({
    schemaVersion: 'wiselink.v3_1.applicability_fleet.fleet_master_data.v1', sourceSnapshotId: 'fleet-snapshot-1',
    sourceRevisionKey: 'fleet-r1', authorityRevision: 'authority-r1', sourceAsOf: '2026-08-26',
    assets: [{ assetId: 'ASSET-1', assetVersionId: 'ASSET-V1', aircraftNumber: 'B-1234', aircraftModel: 'B737-8',
      msn: null, lineNumber: null,
      sourceRef: { sourceTable: 'fleet_asset', sourceRecordId: 'asset-1' }, recordHash: 'asset-hash-1' }], facts: [],
  })) };
  const engineerReview = { pageContext: jest.fn(async (item: CanonicalWorkItemProjection) => ({ gapLedger: {
    inputRevision: item.revision, gaps: [{ gapRef: 'GAP-CONFIGURATION', materiality: 'P0_DECISION_CRITICAL',
      queryability: 'REVIEW_QUERYABLE', resolutionStatus: 'OPEN', disposition: null,
      evidenceCapabilities: ['GET_INSTALLATION_EVENTS'], affectedCriterionIds: ['APP-012'] }],
  } })) };
  const port = new UnconfiguredGetInstallationEventsAdapter();
  const externalPort = jest.spyOn(port, 'getInstallationEvents');
  const store = { readCurrent: jest.fn(async () => null), listHistory: jest.fn(async () => []),
    readSnapshot: jest.fn(async () => null), findByRequest: jest.fn(async () => null),
    commit: jest.fn(async () => { throw new Error('UNEXPECTED_CONFIGURATION_COMMIT'); }) };
  let attempt: ConfigurationEvidenceQueryAttemptReadModel | null = null;
  const cloneAttempt = () => attempt ? structuredClone(attempt) : null;
  const queryStore = {
    findLatest: jest.fn(async () => cloneAttempt()),
    findByRequest: jest.fn(async (input: { requestId: string }) =>
      attempt?.request.requestId === input.requestId ? cloneAttempt() : null),
    findByQueryAttemptRef: jest.fn(async (input: { queryAttemptRef: string }) =>
      attempt?.queryAttemptRef === input.queryAttemptRef ? cloneAttempt() : null),
    findByCandidateEvidenceRef: jest.fn(async (input: { candidateEvidenceRef: string }) =>
      attempt?.candidateEvidenceRef === input.candidateEvidenceRef ? cloneAttempt() : null),
    reserve: jest.fn(async (input: ReserveConfigurationEvidenceQueryInput) => {
      attempt = { queryAttemptRef: input.queryAttemptRef, candidateEvidenceRef: input.candidateEvidenceRef,
        workItemId: input.workItemId, inputRevision: input.request.expectedRevision, roundNo: 1,
        queryCount: input.request.targets.length, queryFingerprint: input.queryFingerprint, request: structuredClone(input.request),
        terminalStatus: 'RUNNING', sourceRecordCount: 0, projections: null, candidateSnapshot: null,
        startedAt: input.startedAt, deadlineAt: input.deadlineAt, completedAt: null, adoption: { status: 'CANDIDATE_UNADOPTED' } };
      return { replayed: false, attempt: structuredClone(attempt) };
    }),
    complete: jest.fn(async (input: CompleteConfigurationEvidenceQueryInput) => {
      if (!attempt) throw new Error('QUERY_RESERVATION_REQUIRED');
      attempt = { ...attempt, terminalStatus: input.terminalStatus, projections: input.projections,
        candidateSnapshot: input.candidateSnapshot, sourceRecordCount: input.sourceRecordCount, completedAt: input.completedAt };
      return structuredClone(attempt);
    }),
    markAdopted: jest.fn(async () => { throw new Error('UNEXPECTED_CONFIGURATION_ADOPTION'); }),
  };
  const selection = new CanonicalHostApplicabilitySelectionService(sessions, access, registrar as never, fleet as never);
  const configuration = new ConfigurationEvidenceService(sessions, access, registrar as never, fleet as never,
    engineerReview as never, port, store, queryStore, { nowIso: () => '2026-08-30T01:02:03.000Z' });
  const moduleRef = await Test.createTestingModule({
    controllers: [CanonicalHostApplicabilitySelectionController, ConfigurationEvidenceController],
    providers: [{ provide: CanonicalHostApplicabilitySelectionService, useValue: selection },
      { provide: ConfigurationEvidenceService, useValue: configuration }, { provide: DialogueBrowserScope, useValue: browser }],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalGuards(new AuthNPaasGuard(new Reflector())); app.useGlobalFilters(new GlobalExceptionFilter()); await app.init();
  return { app, selection, configuration, access, freshRead, binding, authorizationRead, oauthConfig, oauthIdentity,
    validate, sqlContexts, runRead, runWrite, serviceRole, registrar, fleet, engineerReview, externalPort, store, queryStore,
    currentRevision: () => current.revision, onSql: (operation: (request: Request) => void): void => { onSql = operation; } };
}

function initialWorkItem(): CanonicalWorkItemProjection {
  return { workItemId: WORK_ITEM_ID, requestId: 'WI-REQUEST-1', revision: 7,
    phase: 'CANDIDATE_READBACK_VERIFIED', source: { documentVersionId: 'DV-1' },
    package: { contractId: 'techpub.parsed-package.v1', contractRevision: 'frozen.2',
      usagePolicy: { applicability: { sourceExpressionCount: 0, normalizedCandidateCount: 0, assignmentCount: 0 } } },
    applicabilityControlledSelection: { schemaVersion: 'wiselink.3_1.controlled_applicability_selection.v1',
      selectionRevision: `work-item:${WORK_ITEM_ID}:applicability-selection:7`, currentness: 'CURRENT',
      documentVersionId: 'DV-1', aircraftIdentifier: 'B-1234', asOf: '2026-08-27', fleetSourceSnapshotId: 'fleet-snapshot-1',
      fleetSourceRevisionKey: 'fleet-r1', fleetAuthorityRevision: 'authority-r1', fleetSourceAsOf: '2026-08-26' },
  } as unknown as CanonicalWorkItemProjection;
}

// Real routes, SDK middleware, guards, resolver, native scope and access adapter.
// Repository/query-store/SQL-context fixtures do not prove real DB/RLS or
// that an upstream gateway authenticated the synthetic hosted headers.
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
