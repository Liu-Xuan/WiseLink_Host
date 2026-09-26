import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { LocalMineruWorkerService } from '../../server/modules/canonical-host/local-mineru-worker.service';
import { LocalMineruWorkerOpenApiController } from '../../server/modules/canonical-host/local-mineru-worker.openapi.controller';
import type { CanonicalServiceScopeAuthorizationPort } from '../../server/modules/canonical-host/canonical-service-scope.authorization';
import type { EngineeringMatterWorkingRepository } from '../../server/modules/canonical-host/engineering-matter-working.repository';
import type { DocumentParsingRepository } from '../../server/modules/document-management/src/hosted/nest/document-parsing.repository';
import type { DocumentParsingHostedService } from '../../server/modules/document-management/src/hosted/nest/document-parsing-hosted.service';
import type { DocumentStepLeaseRepository } from '../../server/modules/document-management/src/hosted/nest/document-step-lease.repository';

const identity = { parseRunId: 'PRUN-test', documentVersionId: 'DV-test', lease: {
  leaseOwner: 'mineru:configured-principal', leaseToken: 'lease-secret', leaseGeneration: 2,
} };
const fence = { parseRunId: identity.parseRunId, ...identity.lease };
const denied = Object.assign(new Error('DOCUMENT_STEP_LEASE_REJECTED'), { statusCode: 409 });

function setup() {
  const serviceScope = { appId: 'app_17bzc551rsg', tenantId: 'configured-tenant',
    principalId: 'configured-principal', authorizationFingerprint: 'verified' };
  const row = { parseRunId: identity.parseRunId, documentVersionId: identity.documentVersionId,
    actorUserId: 'persisted-user' };
  const scope = { tenantId: serviceScope.tenantId, actorUserId: row.actorUserId,
    documentVersionId: row.documentVersionId, roles: [], automaticWorkItem: { principalId: serviceScope.principalId } };
  const sourceBinding: { pdfSha256: string; byteLength: number; parserInput: object } = {
    pdfSha256: 'a'.repeat(64), byteLength: 10,
    parserInput: { mode: 'LOCAL_MINERU_WORKER', settings: { localMineruFallbackEnabled: true } },
  };
  const artifactProgress: Array<{ relativePath: string; localWorkerReceipt?: typeof identity.lease }> = [];
  const loaded = { scope, run: { sourceBinding, artifactProgress, deadlineAt: new Date('2026-09-27T00:00:00Z') } };
  const authorization = { assertAutoWorkItemQueueTransport: jest.fn().mockResolvedValue(undefined),
    authorizeOpenClawAutoWorkItemQueue: jest.fn().mockResolvedValue(serviceScope) };
  const actors = { withActorScope: jest.fn(async (_actor: string, action: () => Promise<unknown>) => action()) };
  const repository = { listLocalWorkerCandidates: jest.fn().mockResolvedValue([row]),
    readLocalWorkerById: jest.fn().mockResolvedValue(row) };
  const parsing = { readLocalWorkerRun: jest.fn().mockResolvedValue(loaded),
    readLocalWorkerOriginal: jest.fn().mockResolvedValue({ candidateReady: false, bytes: Buffer.from('%PDF-test') }),
    acceptLocalWorkerCandidate: jest.fn().mockResolvedValue({ status: 'STAGING' }) };
  const leases = { claim: jest.fn().mockResolvedValue(fence), renew: jest.fn().mockResolvedValue(true),
    check: jest.fn().mockResolvedValue(undefined), release: jest.fn().mockResolvedValue(undefined) };
  const worker = new LocalMineruWorkerService(authorization as unknown as CanonicalServiceScopeAuthorizationPort,
    actors as unknown as EngineeringMatterWorkingRepository, repository as unknown as DocumentParsingRepository,
    parsing as unknown as DocumentParsingHostedService, leases as unknown as DocumentStepLeaseRepository);
  return { worker, controller: new LocalMineruWorkerOpenApiController(worker), authorization, actors,
    repository, parsing, leases, loaded, serviceScope, scope };
}

function upload(headers: Record<string, string> = {}, chunks: Buffer[] = [Buffer.from('{}')]) {
  const values: Record<string, string> = { 'content-type': 'application/octet-stream',
    'x-wiselink-parse-run-id': identity.parseRunId, 'x-wiselink-document-version-id': identity.documentVersionId,
    'x-wiselink-lease-owner': identity.lease.leaseOwner, 'x-wiselink-lease-token': identity.lease.leaseToken,
    'x-wiselink-lease-generation': String(identity.lease.leaseGeneration), ...headers };
  const consumed = jest.fn();
  const request = { get: (name: string) => values[name], async *[Symbol.asyncIterator]() {
    consumed(); for (const chunk of chunks) yield chunk;
  } };
  return { request: request as unknown as Request, consumed };
}

describe('local MinerU Host dispatcher', () => {
  it('claims only through configured transport and restores the durable actor', async () => {
    const h = setup();
    await expect(h.worker.claim({})).resolves.toMatchObject({ status: 'CLAIMED', ...identity });
    expect(h.authorization.assertAutoWorkItemQueueTransport).toHaveBeenCalledTimes(1);
    expect(h.repository.listLocalWorkerCandidates).toHaveBeenCalledWith('configured-tenant', 50);
    expect(h.actors.withActorScope).toHaveBeenCalledWith('persisted-user', expect.any(Function));
    expect(h.parsing.readLocalWorkerRun).toHaveBeenCalledWith(identity.parseRunId, {
      tenantId: 'configured-tenant', actorUserId: 'persisted-user', documentVersionId: identity.documentVersionId, roles: [],
    });
    expect(h.leases.claim).toHaveBeenCalledWith(h.scope, identity.parseRunId, identity.lease.leaseOwner, 120_000);
  });

  it.each(['actorUserId', 'tenantId', 'roles', 'principalId'])('rejects caller-provided %s', async field => {
    const h = setup();
    await expect(h.worker.claim({ [field]: 'forged' })).rejects.toThrow('LOCAL_MINERU_CLAIM_INPUT_INVALID');
    await expect(h.worker.source({ ...identity, [field]: 'forged' })).rejects.toThrow('LOCAL_MINERU_LEASE_INPUT_INVALID');
    expect(h.repository.readLocalWorkerById).not.toHaveBeenCalled();
    expect(h.parsing.readLocalWorkerOriginal).not.toHaveBeenCalled();
  });

  it('skips an expired automatic grant and claims the next eligible durable run', async () => {
    const h = setup();
    h.repository.listLocalWorkerCandidates.mockResolvedValue([
      { parseRunId: 'PRUN-expired', documentVersionId: 'DV-expired', actorUserId: 'expired-user' },
      { parseRunId: identity.parseRunId, documentVersionId: identity.documentVersionId, actorUserId: 'persisted-user' },
    ]);
    h.parsing.readLocalWorkerRun.mockRejectedValueOnce(new Error('DOCUMENT_AUTOMATIC_LEASE_REJECTED'));
    await expect(h.worker.claim({})).resolves.toMatchObject({ status: 'CLAIMED', ...identity });
    expect(h.leases.claim).toHaveBeenCalledTimes(1);
    expect(h.actors.withActorScope).toHaveBeenLastCalledWith('persisted-user', expect.any(Function));
  });

  it('does not hide a storage failure while scanning candidates', async () => {
    const h = setup(); h.parsing.readLocalWorkerRun.mockRejectedValue(new Error('storage unavailable'));
    await expect(h.worker.claim({})).rejects.toThrow('storage unavailable');
    expect(h.leases.claim).not.toHaveBeenCalled();
  });

  it('stops before any lookup if transport authorization fails', async () => {
    const h = setup(); h.authorization.assertAutoWorkItemQueueTransport.mockRejectedValue(new Error('transport denied'));
    await expect(h.worker.claim({})).rejects.toThrow('transport denied');
    expect(h.repository.listLocalWorkerCandidates).not.toHaveBeenCalled();
  });

  it.each(['tenant', 'principal'])('rejects persisted %s mismatch before source dispatch', async mismatch => {
    const h = setup();
    if (mismatch === 'tenant') h.scope.tenantId = 'other'; else h.scope.automaticWorkItem.principalId = 'other';
    await expect(h.worker.source(identity)).rejects.toThrow('LOCAL_MINERU_SERVICE_SCOPE_MISMATCH');
    expect(h.parsing.readLocalWorkerOriginal).not.toHaveBeenCalled();
  });

  it('rejects an owner outside the configured principal before lookup', async () => {
    const h = setup();
    await expect(h.worker.source({ ...identity, lease: { ...identity.lease, leaseOwner: 'mineru:attacker' } }))
      .rejects.toThrow('DOCUMENT_STEP_LEASE_REJECTED');
    expect(h.repository.readLocalWorkerById).not.toHaveBeenCalled();
  });

  it('does not return source bytes or acknowledge renewal when the lease is rejected', async () => {
    const h = setup(); h.parsing.readLocalWorkerOriginal.mockRejectedValue(denied); h.leases.renew.mockResolvedValue(false);
    await expect(h.worker.source(identity)).rejects.toThrow('DOCUMENT_STEP_LEASE_REJECTED');
    expect(h.parsing.readLocalWorkerOriginal).toHaveBeenCalledWith(identity.parseRunId, h.scope, fence);
    await expect(h.worker.renew(identity)).rejects.toThrow('DOCUMENT_STEP_LEASE_REJECTED');
  });

  it('replays a persisted receipt but checks and rejects arbitrary replacement tokens', async () => {
    const h = setup(); h.loaded.run.artifactProgress.push({ relativePath: 'raw/mineru-candidate.json', localWorkerReceipt: { ...identity.lease } });
    h.leases.check.mockRejectedValue(denied);
    await expect(h.worker.validateUpload(identity)).resolves.toBeUndefined();
    expect(h.leases.check).not.toHaveBeenCalled();
    await expect(h.worker.validateUpload({ ...identity, lease: { ...identity.lease, leaseToken: 'arbitrary' } }))
      .rejects.toThrow('DOCUMENT_STEP_LEASE_REJECTED');
  });

  it('returns candidate-ready JSON without a PDF body and releases the fence', async () => {
    const h = setup(); h.parsing.readLocalWorkerOriginal.mockResolvedValue({ candidateReady: true });
    const response = { setHeader: jest.fn(), send: jest.fn(), json: jest.fn() };
    await h.controller.readLocalMineruSource(identity, response as unknown as Response);
    expect(response.json).toHaveBeenCalledWith({ status: 'CANDIDATE_READY', parseRunId: identity.parseRunId });
    expect(response.send).not.toHaveBeenCalled();
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(h.leases.release).toHaveBeenCalledWith(h.scope, fence);
  });

  it('propagates a rejected candidate without releasing its lease or reporting acceptance', async () => {
    const h = setup(); h.parsing.acceptLocalWorkerCandidate.mockRejectedValue(denied);
    await expect(h.worker.result(identity, Buffer.from('{}'))).rejects.toThrow('DOCUMENT_STEP_LEASE_REJECTED');
    expect(h.leases.release).not.toHaveBeenCalled();
  });
});

describe('local MinerU binary result controller', () => {
  it('authorizes the fence before iterating any upload bytes', async () => {
    const h = setup(); const body = upload(); h.leases.check.mockRejectedValue(denied);
    await expect(h.controller.acceptLocalMineruResult(body.request)).rejects.toThrow('DOCUMENT_STEP_LEASE_REJECTED');
    expect(body.consumed).not.toHaveBeenCalled();
    expect(h.parsing.acceptLocalWorkerCandidate).not.toHaveBeenCalled();
  });

  it.each([
    [{ 'content-type': 'application/json' }, 'LOCAL_MINERU_RESULT_MEDIA_TYPE_INVALID'],
    [{ 'x-wiselink-lease-generation': '0' }, 'LOCAL_MINERU_LEASE_INPUT_INVALID'],
    [{ 'x-wiselink-lease-generation': '1e2' }, 'LOCAL_MINERU_LEASE_INPUT_INVALID'],
    [{ 'x-wiselink-lease-generation': '9007199254740992' }, 'LOCAL_MINERU_LEASE_INPUT_INVALID'],
    [{ 'x-wiselink-lease-token': '' }, 'LOCAL_MINERU_LEASE_INPUT_INVALID'],
    [{ 'x-wiselink-parse-run-id': '../bad' }, 'LOCAL_MINERU_LEASE_INPUT_INVALID'],
  ] as [Record<string, string>, string][])('rejects invalid metadata %j without consuming bytes', async (headers, code) => {
    const h = setup(); const body = upload(headers);
    await expect(h.controller.acceptLocalMineruResult(body.request)).rejects.toThrow(code);
    expect(body.consumed).not.toHaveBeenCalled();
    expect(h.parsing.acceptLocalWorkerCandidate).not.toHaveBeenCalled();
  });

  it.each(['67108865', '-1', 'NaN'])('rejects invalid content length %s before reading', async length => {
    const h = setup(); const body = upload({ 'content-length': length });
    await expect(h.controller.acceptLocalMineruResult(body.request)).rejects.toThrow('MINERU_CANDIDATE_TOO_LARGE');
    expect(body.consumed).not.toHaveBeenCalled();
  });

  it('rejects a length mismatch and empty upload without persistence', async () => {
    const h = setup();
    await expect(h.controller.acceptLocalMineruResult(upload({ 'content-length': '3' }).request))
      .rejects.toThrow('MINERU_CANDIDATE_LENGTH_MISMATCH');
    await expect(h.controller.acceptLocalMineruResult(upload({}, []).request)).rejects.toThrow('MINERU_CANDIDATE_TOO_LARGE');
    expect(h.parsing.acceptLocalWorkerCandidate).not.toHaveBeenCalled();
  });

  it('bounds a chunked upload even without a content-length header', async () => {
    const h = setup(); const chunk = Buffer.alloc(1024 * 1024);
    await expect(h.controller.acceptLocalMineruResult(upload({}, Array.from({ length: 65 }, () => chunk)).request))
      .rejects.toThrow('MINERU_CANDIDATE_TOO_LARGE');
    expect(h.parsing.acceptLocalWorkerCandidate).not.toHaveBeenCalled();
  });

  it('passes exact binary bytes and Host identity to persistence and reports their digest', async () => {
    const h = setup(); const bytes = Buffer.from('{"candidate":"测试"}');
    const body = upload({ 'content-length': String(bytes.length) }, [bytes.subarray(0, 5), bytes.subarray(5)]);
    await expect(h.controller.acceptLocalMineruResult(body.request)).resolves.toEqual({ status: 'ACCEPTED',
      parseRunId: identity.parseRunId, candidateSha256: createHash('sha256').update(bytes).digest('hex') });
    expect(h.parsing.acceptLocalWorkerCandidate).toHaveBeenCalledWith(identity.parseRunId, h.scope, fence, bytes);
    expect(h.leases.release).toHaveBeenCalledWith(h.scope, fence);
  });
});

// Uses Nest's real Express/body-parser setup. Platform SDK gateway middleware is outside this harness.
it('serves the real Nest binary route with HTTP 200 and exact bytes after default body parsing', async () => {
  const bytes = Buffer.from([0, 255, 123, 10, 128, 125]);
  const worker = { validateUpload: jest.fn().mockResolvedValue(undefined),
    result: jest.fn().mockResolvedValue({ status: 'ACCEPTED', parseRunId: identity.parseRunId,
      candidateSha256: createHash('sha256').update(bytes).digest('hex') }) };
  const module = await Test.createTestingModule({ controllers: [LocalMineruWorkerOpenApiController],
    providers: [{ provide: LocalMineruWorkerService, useValue: worker }] }).compile();
  const app = module.createNestApplication();
  try {
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/openapi/wiselink/local-mineru/result`, {
      method: 'POST', headers: { 'content-type': 'application/octet-stream',
        'x-wiselink-parse-run-id': identity.parseRunId,
        'x-wiselink-document-version-id': identity.documentVersionId,
        'x-wiselink-lease-owner': identity.lease.leaseOwner,
        'x-wiselink-lease-token': identity.lease.leaseToken,
        'x-wiselink-lease-generation': String(identity.lease.leaseGeneration) }, body: bytes,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ACCEPTED', parseRunId: identity.parseRunId });
    expect(worker.validateUpload).toHaveBeenCalledWith(identity);
    expect(worker.result).toHaveBeenCalledWith(identity, bytes);
    expect(worker.validateUpload.mock.invocationCallOrder[0]).toBeLessThan(worker.result.mock.invocationCallOrder[0]);
  } finally { await app.close(); }
});
