import { DocumentTranslationReadingController } from '../../server/modules/canonical-host/document-translation-reading.controller';

function setup() {
  const reader = { readDocumentOriginal: jest.fn().mockResolvedValue({ run: { manifestArtifact: { sha256: 'a'.repeat(64) } },
    original: { binding: { documentVersionId: 'DV', parseRunId: 'parse' } } }) };
  const workspaces = { readForSource: jest.fn().mockResolvedValue(null), readSnapshot: jest.fn() };
  const parsing = { status: jest.fn().mockResolvedValue({}) };
  const attempts = { latest: jest.fn().mockResolvedValue({ producerRunId: 'other', status: 'RUNNING' }) };
  const revisions = { readForBrowser: jest.fn().mockResolvedValue({ familyId: 'family' }),
    readSemanticForBrowser: jest.fn().mockResolvedValue({ semanticMap: null }) };
  const controller = new DocumentTranslationReadingController(reader as never, workspaces as never, parsing as never, attempts as never, revisions as never);
  const request = { userContext: { userId: 'actor', tenantId: 'tenant', roles: [] } } as never;
  return { reader, workspaces, parsing, attempts, revisions, controller, request };
}

describe('independent document browser reading', () => {
  it('discovers saved semantics without guessing a revision and permits a pinned revision', async () => {
    const f = setup();
    await expect(f.controller.readSemantic('DV', 'parse', undefined, f.request)).resolves.toEqual({ semanticMap: null });
    expect(f.revisions.readSemanticForBrowser).toHaveBeenLastCalledWith({ documentVersionId: 'DV', parseRunId: 'parse' },
      expect.objectContaining({ tenantId: 'tenant', actorUserId: 'actor' }));
    await f.controller.readSemantic('DV', 'parse', '3', f.request);
    expect(f.revisions.readSemanticForBrowser).toHaveBeenLastCalledWith({ documentVersionId: 'DV', parseRunId: 'parse', semanticRevision: 3 }, expect.anything());
    await expect(f.controller.readSemantic('DV', 'parse', '0', f.request)).rejects.toThrow('IDENTITY_INVALID');
    expect(f.revisions.readSemanticForBrowser).toHaveBeenCalledTimes(2);
  });
  it('routes revision reading through the authenticated browser context without Hosted actor rebinding', async () => {
    const f = setup();
    await expect(f.controller.readRevision('new', 'parse-new', '1', 'old', 'parse-old', '2', 'ftd.status', f.request))
      .resolves.toEqual({ familyId: 'family' });
    expect(f.revisions.readForBrowser).toHaveBeenCalledWith({
      before: { documentVersionId: 'old', parseRunId: 'parse-old', semanticRevision: 2 },
      after: { documentVersionId: 'new', parseRunId: 'parse-new', semanticRevision: 1 }, roleKey: 'ftd.status',
    }, expect.objectContaining({ tenantId: 'tenant', actorUserId: 'actor' }));
    await expect(f.controller.readRevision('new', 'parse-new', '0', 'old', 'parse-old', '2', 'ftd.status', f.request))
      .rejects.toThrow('IDENTITY_INVALID');
    expect(f.revisions.readForBrowser).toHaveBeenCalledTimes(1);
  });
  it('uses the exact published manifest and does not project another parseRun execution', async () => {
    const f = setup();
    const result = await f.controller.read('DV', 'parse', f.request);
    expect(f.workspaces.readForSource).toHaveBeenCalledWith({ tenantId: 'tenant', workItemId: null, documentVersionId: 'DV',
      parsedArtifactRef: 'document-original://DV/parse', parsedArtifactSha256: 'a'.repeat(64) });
    expect(result.execution).toBeNull();
    expect(result.translation.status).toBe('UNAVAILABLE');
    expect(f.parsing.status).toHaveBeenCalledWith('DV', expect.objectContaining({ actorUserId: 'actor' }));
  });
  it('does not return stored results after source permission is revoked', async () => {
    const f = setup();
    f.parsing.status.mockRejectedValueOnce(new Error('SOURCE_DENIED'));
    await expect(f.controller.read('DV', 'parse', f.request)).rejects.toThrow('SOURCE_DENIED');
    await expect(f.controller.read('DV', '', f.request)).rejects.toThrow('IDENTITY_INVALID');
    expect(f.reader.readDocumentOriginal).toHaveBeenCalledTimes(1);
  });
});
