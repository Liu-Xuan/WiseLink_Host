import { DocumentWorkRuntimeService } from '../../server/modules/canonical-host/document-work-runtime.service';
import { buildDocumentSemanticMap } from '../../server/modules/document-management/src/hosted/nest/document-semantic-map';
import { GENERIC_SEMANTIC_PROFILE } from '../../server/modules/document-management/src/hosted/nest/document-semantic-profile';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

function fixture() {
  const authorization = { authorizeDocumentWork: jest.fn().mockResolvedValue({
    tenantId: 'tenant', actorUserId: 'actor', documentVersionId: 'DV',
  }) };
  const actors = { withActorScope: jest.fn(async (_actor, fn) => fn()) };
  const parsing = {
    status: jest.fn().mockResolvedValue({ latestRun: { parseRunId: 'run', status: 'STAGING' } }),
    executeStep: jest.fn().mockResolvedValue({ parseRunId: 'run', status: 'STAGING' }),
    loadPublished: jest.fn(),
  };
  const fence = { parseRunId: 'run', leaseOwner: 'worker', leaseToken: 'token', leaseGeneration: 2 };
  const leases = { claim: jest.fn().mockResolvedValue(fence), renew: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(true), cancel: jest.fn().mockResolvedValue(true) };
  const reader = { readDocumentOriginal: parsing.loadPublished };
  const semantics = { read: jest.fn().mockResolvedValue(null) };
  const service = new DocumentWorkRuntimeService(authorization as never, actors as never, parsing as never, leases as never, reader as never, {} as never, semantics as never);
  return { service, authorization, actors, parsing, leases, fence, semantics };
}

describe('authorized document step runtime', () => {
  afterEach(() => jest.useRealTimers());

  it('reads exact published original units with coverage and refuses identity drift', async () => {
    const f = fixture();
    const original = originalFixture();
    original.binding.documentVersionId = 'DV';
    original.binding.parseRunId = 'run';
    const loaded = { original, structuredSource: original.source, run: { parseRunId: 'run',
      manifestArtifact: { relativePath: 'original/manifest.json', readback: 'VERIFIED', sha256: 'a'.repeat(64),
        byteLength: 1234, mediaType: 'application/json' } } };
    f.parsing.loadPublished.mockResolvedValue(loaded);
    const result = await f.service.readOriginal({ documentVersionId: 'DV', parseRunId: 'run', limit: 1 });
    expect(result.units).toEqual(original.source.units.slice(0, 1));
    expect(result.coverage).toEqual(original.coverage);
    expect(result.artifact).toEqual({ ref: 'document-original://DV/run', sha256: 'a'.repeat(64), byteLength: 1234, mediaType: 'application/json' });
    expect(f.parsing.loadPublished).toHaveBeenCalledWith('DV', 'run', expect.objectContaining({ actorUserId: 'actor', tenantId: 'tenant' }));
    original.binding.parseRunId = 'new-run';
    await expect(f.service.readOriginal({ documentVersionId: 'DV', parseRunId: 'run' }))
      .rejects.toThrow('DOCUMENT_ORIGINAL_EXACT_BINDING_MISMATCH');
    expect(f.parsing.executeStep).not.toHaveBeenCalled();
  });

  it('requires an exact semantic revision for chapter reads and keeps pagination inside its context', async () => {
    const f = fixture();
    const original = originalFixture();
    Object.assign(original.binding, { documentVersionId: 'DV', parseRunId: 'run' });
    original.source.units[0].kind = 'heading';
    original.source.units[0].payload = { text: 'Conditions', level: 1 };
    const map = buildDocumentSemanticMap({ original, semanticRevision: 2, profile: GENERIC_SEMANTIC_PROFILE });
    const loaded = { original, structuredSource: original.source, run: { parseRunId: 'run',
      manifestArtifact: { relativePath: 'original/manifest.json', readback: 'VERIFIED', sha256: 'a'.repeat(64), byteLength: 10 } } };
    f.parsing.loadPublished.mockResolvedValue(loaded);
    f.semantics.read.mockResolvedValue(map);
    const input = { documentVersionId: 'DV', parseRunId: 'run', sectionId: map.sections[0].sectionId, limit: 1 };
    await expect(f.service.readOriginal(input)).rejects.toThrow('DOCUMENT_SEMANTIC_EXACT_REVISION_REQUIRED');
    expect(f.semantics.read).not.toHaveBeenCalled();
    const first = await f.service.readOriginal({ ...input, semanticRevision: 2 });
    expect(f.semantics.read).toHaveBeenCalledWith(expect.any(Object), loaded, 2);
    expect(first.semanticMap?.semanticRevision).toBe(2);
    expect(first.nextOffset).toBe(1);
    const second = await f.service.readOriginal({ ...input, semanticRevision: 2, offset: 1 });
    expect(second.units[0].unitId).toBe('u2');
    expect(second.nextOffset).toBeNull();
    expect(second.coverage).toEqual(original.coverage);
    f.semantics.read.mockRejectedValueOnce(new Error('DOCUMENT_SEMANTIC_REVISION_NOT_FOUND'));
    await expect(f.service.readOriginal({ ...input, semanticRevision: 99 })).rejects.toThrow('DOCUMENT_SEMANTIC_REVISION_NOT_FOUND');
  });

  it('rechecks source permission before leasing and rejects stale run identities', async () => {
    const f = fixture();
    await expect(f.service.run({ action: 'STEP', documentVersionId: 'DV', parseRunId: 'old' }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(f.leases.claim).not.toHaveBeenCalled();
    f.parsing.status.mockRejectedValueOnce(new Error('SOURCE_ACCESS_DENIED'));
    await expect(f.service.run({ action: 'CANCEL', documentVersionId: 'DV', parseRunId: 'run' }))
      .rejects.toThrow('SOURCE_ACCESS_DENIED');
    expect(f.leases.cancel).not.toHaveBeenCalled();
    expect(f.actors.withActorScope).toHaveBeenCalledWith('actor', expect.any(Function));
  });

  it('does not execute an already leased step and always releases a failed execution', async () => {
    const f = fixture();
    f.leases.claim.mockResolvedValueOnce(null);
    await expect(f.service.run({ action: 'STEP', documentVersionId: 'DV', parseRunId: 'run' }))
      .resolves.toEqual({ status: 'BUSY', parseRunId: 'run' });
    expect(f.parsing.executeStep).not.toHaveBeenCalled();
    f.parsing.executeStep.mockRejectedValueOnce(new Error('PLUGIN_FAILED'));
    await expect(f.service.run({ action: 'STEP', documentVersionId: 'DV', parseRunId: 'run' }))
      .rejects.toThrow('PLUGIN_FAILED');
    expect(f.leases.release).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'actor' }), f.fence);
  });

  it('renews an awaited long step and stops the timer after completion', async () => {
    jest.useFakeTimers();
    const f = fixture();
    let finish!: (result: { parseRunId: string; status: string }) => void;
    f.parsing.executeStep.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const running = f.service.run({ action: 'STEP', documentVersionId: 'DV', parseRunId: 'run' });
    await jest.advanceTimersByTimeAsync(60_000);
    expect(f.leases.renew).toHaveBeenCalledTimes(2);
    finish({ parseRunId: 'run', status: 'PUBLISHED' });
    await expect(running).resolves.toMatchObject({ status: 'PUBLISHED' });
    await jest.advanceTimersByTimeAsync(60_000);
    expect(f.leases.renew).toHaveBeenCalledTimes(2);
    expect(f.leases.release).toHaveBeenCalledTimes(1);
  });
});
