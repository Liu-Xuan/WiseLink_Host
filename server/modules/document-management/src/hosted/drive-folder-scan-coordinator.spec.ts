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
});
