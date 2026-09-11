import { runDriveFolderScan } from './drive-folder-scan-coordinator';

describe('runDriveFolderScan', () => {
  it('loads and saves a durable continuation per source', async () => {
    let checkpoint: string | null = null;
    const saved: string[] = [];
    const result = await runDriveFolderScan({
      sourceKey: 'technical-library',
      roots: [{ folderToken: 'root', path: 'root', depth: 0 }],
      maxPages: 1,
      fetchPage: async () => ({ files: [{ token: 'child', type: 'folder', name: 'child' }], hasMore: true, nextPageToken: 'next' }),
      checkpoints: { load: async () => checkpoint, save: async (_key, value) => { checkpoint = value; saved.push(value); } },
    });
    expect(result.continuation).toEqual([
      { folderToken: 'root', path: 'root', depth: 0, pageToken: 'next' },
      { folderToken: 'child', path: 'root/child', depth: 1 },
    ]);
    expect(saved.length).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(checkpoint!).continuation).toEqual(result.continuation);
  });

  it.each([
    [{ status: 403 }, 'HTTP status'],
    [{ statusCode: 403 }, 'statusCode'],
    [{ code: 1061004 }, 'Feishu code'],
    [{ message: 'permission_denied' }, 'message'],
  ])('returns a durable authorization blocker for %s (%s)', async (error, _label) => {
    const saved: string[] = [];
    const result = await runDriveFolderScan({
      sourceKey: 'restricted-library',
      roots: [{ folderToken: 'restricted', path: 'restricted', depth: 0 }],
      fetchPage: async () => { throw error; },
      checkpoints: { load: async () => null, save: async (_key, value) => { saved.push(value); } },
    });
    expect(result.entries).toEqual([]);
    expect(result.continuation).toEqual([{ folderToken: 'restricted', path: 'restricted', depth: 0 }]);
    expect(result.blockers).toEqual([{ folderToken: 'restricted', code: 'DRIVE_AUTHORIZATION_DENIED' }]);
    expect(saved).toEqual([]);
  });

  it('keeps the saved frontier when authorization is denied after resuming', async () => {
    const checkpoint = JSON.stringify({
      version: 1,
      roots: [{ folderToken: 'root', path: 'root', depth: 0 }],
      continuation: [{ folderToken: 'child', path: 'root/child', depth: 1, pageToken: 'p2' }],
      updatedAt: '2026-09-12T00:00:00.000Z',
    });
    const saved: string[] = [];
    const result = await runDriveFolderScan({
      sourceKey: 'technical-library',
      roots: [{ folderToken: 'root', path: 'root', depth: 0 }],
      fetchPage: async () => { throw { code: 1061004 }; },
      checkpoints: { load: async () => checkpoint, save: async (_key, value) => { saved.push(value); } },
    });
    expect(result.continuation).toEqual([{ folderToken: 'child', path: 'root/child', depth: 1, pageToken: 'p2' }]);
    expect(saved).toEqual([]);
  });

  it('rejects unknown fetch failures instead of treating them as empty', async () => {
    await expect(runDriveFolderScan({
      sourceKey: 'technical-library',
      roots: [{ folderToken: 'root', path: 'root', depth: 0 }],
      fetchPage: async () => { throw new Error('network unavailable'); },
      checkpoints: { load: async () => null, save: async () => undefined },
    })).rejects.toThrow('network unavailable');
  });
});
