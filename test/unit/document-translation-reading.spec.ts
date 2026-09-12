import { DocumentTranslationReadingController } from '../../server/modules/canonical-host/document-translation-reading.controller';

function setup() {
  const reader = { readDocumentOriginal: jest.fn().mockResolvedValue({ run: { manifestArtifact: { sha256: 'a'.repeat(64) } },
    original: { binding: { documentVersionId: 'DV', parseRunId: 'parse' } } }) };
  const workspaces = { readForSource: jest.fn().mockResolvedValue(null), readSnapshot: jest.fn() };
  const parsing = { status: jest.fn().mockResolvedValue({}) };
  const attempts = { latest: jest.fn().mockResolvedValue({ producerRunId: 'other', status: 'RUNNING' }) };
  const controller = new DocumentTranslationReadingController(reader as never, workspaces as never, parsing as never, attempts as never);
  const request = { userContext: { userId: 'actor', tenantId: 'tenant', roles: [] } } as never;
  return { reader, workspaces, parsing, attempts, controller, request };
}

describe('independent document browser reading', () => {
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
