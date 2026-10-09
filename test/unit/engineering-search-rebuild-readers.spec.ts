import { Test } from '@nestjs/testing';
import { CANONICAL_OBJECT_ACCESS } from '../../server/modules/work-item/canonical-object-access.port';
import { PgDialect } from 'drizzle-orm/pg-core';
import { CanonicalJobAidProblemService } from '../../server/modules/canonical-host/canonical-jobaid-problem.service';
import { EngineeringMatterWorkingService } from '../../server/modules/canonical-host/engineering-matter-working.service';
import { CANONICAL_MIAODA_APP_ID } from '../../server/modules/canonical-host/canonical-host.constants';

const actor = { userId: 'user', tenantId: 'tenant', appId: CANONICAL_MIAODA_APP_ID, roles: [],
  objectAccessActor: { principalKind: 'FINAL_USER', transport: 'MIAODA_AUTHENTICATED_HTTP',
    canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'user' }, tenantId: 'tenant',
    applicationScopeId: CANONICAL_MIAODA_APP_ID,
    subjectDecision: { applicationScopeId: CANONICAL_MIAODA_APP_ID, tenantId: 'tenant',
      source: 'MIAODA_GATEWAY_USER_CONTEXT', version: 'miaoda-hosted-native-sso.v1' },
    workspaceId: null, workspaceProvenance: 'UNAVAILABLE', identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
    applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT', env: 'runtime', feishuUserId: null,
    feishuOpenId: null, feishuIdentityProvenance: 'UNAVAILABLE', sessionId: null, sessionRevision: null,
    sessionProvenance: 'UNAVAILABLE' } };
const dialect = new PgDialect();
function fixture(exists = true) {
  let predicate: { sql: string; params: unknown[] };
  const query = { from: jest.fn(() => query), where: jest.fn(condition => {
    predicate = dialect.sqlToQuery(condition); return query;
  }), limit: jest.fn().mockResolvedValue(exists ? [{ ref: 'revision' }] : []),
    for: jest.fn(() => { throw new Error('APPEND_ONLY_REVISION_HAS_NO_UPDATE_POLICY'); }) };
  const database = { select: jest.fn(() => query) };
  return { database, query, predicate: () => predicate };
}

it('checks JobAid native grant, authoritative creator/exact tuple, saved body and evidence with one tx', async () => {
  const h = fixture(); const revision = { workItemId: 'wi', workRevisionRef: 'revision', content: { evidence: [] } };
  const objectAccess = { freshRead: jest.fn().mockResolvedValue({ workItemId: 'wi' }) };
  const work = { readByRef: jest.fn().mockResolvedValue(revision) };
  const evidence = jest.fn().mockResolvedValue(undefined);
  const service = Object.assign(Object.create(CanonicalJobAidProblemService.prototype),
    { objectAccess, work, assertEvidenceOwned: evidence }) as CanonicalJobAidProblemService;
  expect(await service.readBrowserRevisionForProjection('wi', 'revision', actor as never, h.database as never)).toBe(revision);
  expect(h.predicate().params).toEqual(['tenant', 'wi', 'revision', 'user']);
  expect(h.query.for).not.toHaveBeenCalled();
  expect(objectAccess.freshRead).toHaveBeenCalledWith(expect.objectContaining({ actor: actor.objectAccessActor }), h.database);
  expect(work.readByRef).toHaveBeenCalledWith({ tenantId: 'tenant', workItemId: 'wi', workRevisionRef: 'revision' }, h.database);
  expect(evidence).toHaveBeenCalledWith([], 'tenant', 'user', 'wi', h.database);
});

it.each(['creator', 'object', 'ref', 'grant', 'source', 'body'])('rejects mismatched JobAid %s without returning content', async mismatch => {
  const h = fixture(mismatch !== 'creator');
  const service = Object.assign(Object.create(CanonicalJobAidProblemService.prototype), {
    objectAccess: { freshRead: jest.fn().mockResolvedValue(mismatch === 'grant' ? { code: 'DENIED' } : { workItemId: 'wi' }) },
    work: { readByRef: jest.fn().mockResolvedValue({ workItemId: mismatch === 'object' ? 'other' : 'wi',
      workRevisionRef: mismatch === 'ref' ? 'other' : 'revision', content: mismatch === 'body' ? undefined : { evidence: [] } }) },
    assertEvidenceOwned: jest.fn(async () => { if (mismatch === 'source') throw new Error('SOURCE_REVOKED'); }),
  }) as CanonicalJobAidProblemService;
  await expect(service.readBrowserRevisionForProjection('wi', 'revision', actor as never, h.database as never)).rejects.toThrow();
});

it('checks Matter current, historical and saved members plus creator/exact tuple with one tx', async () => {
  const h = fixture(); const revision = { matterId: 'matter', matterWorkRevisionId: 'revision',
    basedOnMatterRevisionId: 'basis', state: { substantiveInputs: [{ workItemId: 'removed' }],
      coverage: [{ binding: { workItemId: 'covered' } }] } };
  const working = { authorizeRuntimeInputs: jest.fn().mockResolvedValue({ currentInputs: [{ workItemId: 'current' }] }),
    readByRef: jest.fn().mockResolvedValue(revision) };
  const objectAccess = { freshRead: jest.fn(async (input, _database) => ({ workItemId: input.accessRoot.id })) };
  const service = Object.assign(Object.create(EngineeringMatterWorkingService.prototype), { working, objectAccess }) as EngineeringMatterWorkingService;
  expect(await service.readWorkingRevisionForProjection('matter', 'revision', actor as never, h.database as never)).toBe(revision);
  expect(h.predicate().params).toEqual(['tenant', 'matter', 'revision', 'user']);
  expect(h.query.for).not.toHaveBeenCalled();
  expect(working.authorizeRuntimeInputs).toHaveBeenNthCalledWith(1,
    { tenantId: 'tenant', actorUserId: 'user', matterId: 'matter' }, h.database);
  expect(working.authorizeRuntimeInputs).toHaveBeenNthCalledWith(2,
    { tenantId: 'tenant', actorUserId: 'user', matterId: 'matter', basedOnMatterRevisionId: 'basis' }, h.database);
  expect(objectAccess.freshRead.mock.calls.map(([input]) => input.accessRoot.id)).toEqual(['current', 'removed', 'covered']);
  for (const call of objectAccess.freshRead.mock.calls) expect(call[1]).toBe(h.database);
});

it.each(['creator', 'object', 'ref', 'member'])('rejects mismatched Matter %s without returning content', async mismatch => {
  const h = fixture(mismatch !== 'creator');
  const service = Object.assign(Object.create(EngineeringMatterWorkingService.prototype), {
    working: { authorizeRuntimeInputs: jest.fn().mockResolvedValue({ currentInputs: [{ workItemId: 'current' }] }),
      readByRef: jest.fn().mockResolvedValue({ matterId: mismatch === 'object' ? 'other' : 'matter',
        matterWorkRevisionId: mismatch === 'ref' ? 'other' : 'revision', basedOnMatterRevisionId: 'basis',
        state: { substantiveInputs: [], coverage: [] } }) },
    objectAccess: { freshRead: jest.fn().mockResolvedValue({ code: 'DENIED' }) },
  }) as EngineeringMatterWorkingService;
  await expect(service.readWorkingRevisionForProjection('matter', 'revision', actor as never, h.database as never)).rejects.toThrow();
});


it.each(['missing-port', 'missing-identity', 'wrong-actor', 'wrong-tenant'])('projection reader fails closed for %s before querying saved content', async mismatch => {
  const h = fixture();
  const objectAccess = { freshRead: jest.fn().mockResolvedValue({ workItemId: 'wi' }) };
  const service = Object.assign(Object.create(CanonicalJobAidProblemService.prototype), {
    objectAccess: mismatch === 'missing-port' ? undefined : objectAccess,
    work: { readByRef: jest.fn() }, assertEvidenceOwned: jest.fn(),
  }) as CanonicalJobAidProblemService;
  const requestActor = structuredClone(actor);
  if (mismatch === 'missing-identity') delete (requestActor as Partial<typeof actor>).objectAccessActor;
  if (mismatch === 'wrong-actor') requestActor.objectAccessActor.canonicalSubject.id = 'another';
  if (mismatch === 'wrong-tenant') requestActor.objectAccessActor.tenantId = 'another';
  await expect(service.readBrowserRevisionForProjection('wi', 'revision', requestActor as never, h.database as never)).rejects.toThrow();
  expect(h.database.select).not.toHaveBeenCalled();
  expect(objectAccess.freshRead).not.toHaveBeenCalled();
});


it('Nest resolves appended optional object access without changing prior constructor dependencies', async () => {
  const types: unknown[] = Reflect.getMetadata('design:paramtypes', CanonicalJobAidProblemService);
  const declared: Array<{ index: number; param: unknown }> = Reflect.getMetadata('self:paramtypes', CanonicalJobAidProblemService);
  const values = types.slice(0, -1).map((_type, index) => ({ position: index }));
  const providers = values.map((value, index) => ({
    provide: declared.find(item => item.index === index)?.param ?? types[index], useValue: value,
  }));
  const optional: number[] = Reflect.getMetadata('optional:paramtypes', CanonicalJobAidProblemService);
  expect(declared.find(item => item.index === types.length - 1)?.param).toBe(CANONICAL_OBJECT_ACCESS);
  expect(optional).toContain(types.length - 1);
  for (const includePort of [false, true]) {
    const port = { freshRead: jest.fn() };
    const module = await Test.createTestingModule({ providers: [CanonicalJobAidProblemService,
      ...providers as never[], ...(includePort ? [{ provide: CANONICAL_OBJECT_ACCESS, useValue: port }] : [])] }).compile();
    try {
      const service = module.get(CanonicalJobAidProblemService) as unknown as Record<string, unknown>;
      expect(service.registrar).toBe(values[0]);
      expect(service.activityRuns).toBe(values.at(-1));
      expect(service.objectAccess).toBe(includePort ? port : undefined);
    } finally { await module.close(); }
  }
});
