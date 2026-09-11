import { scanDriveFolders } from './drive-folder-scanner';

describe('scanDriveFolders', () => {
  it('rejects non-positive scan bounds before fetching', async () => {
    const fetchPage = jest.fn();
    await expect(scanDriveFolders([{ folderToken: 'root', path: 'root', depth: 0 }], fetchPage, { maxPages: 0 }))
      .rejects.toThrow('DRIVE_SCAN_OPTIONS_INVALID');
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('stops at the entry bound even when one page contains more entries', async () => {
    const checkpoints: unknown[] = [];
    const result = await scanDriveFolders([{ folderToken: 'root', path: 'root', depth: 0 }], async () => ({
      files: [
        { token: 'file-1', type: 'file', name: '一.pdf' },
        { token: 'file-2', type: 'file', name: '二.pdf' },
      ], hasMore: false,
    }), { maxEntries: 1, onPage: continuation => { checkpoints.push(continuation); } });
    expect(result.entries).toHaveLength(1);
    expect(result.continuation).toEqual([{ folderToken: 'root', path: 'root', depth: 0, entryOffset: 1 }]);
    expect(checkpoints).toEqual([[{ folderToken: 'root', path: 'root', depth: 0, entryOffset: 1 }]]);
    const resumed = await scanDriveFolders(result.continuation, async () => ({
      files: [
        { token: 'file-1', type: 'file', name: '一.pdf' },
        { token: 'file-2', type: 'file', name: '二.pdf' },
      ], hasMore: false,
    }), { maxEntries: 1 });
    expect(resumed.entries.map(entry => entry.token)).toEqual(['file-2']);
  });

  it('blocks a provider that repeats a page token instead of claiming completion', async () => {
    const result = await scanDriveFolders([{ folderToken: 'root', path: 'root', depth: 0 }], async () => ({
      files: [{ token: 'file-1', type: 'file', name: '第一页.pdf' }], hasMore: true, nextPageToken: 'same',
    }));
    expect(result.blockers).toEqual([{ folderToken: 'root', pageToken: 'same', code: 'DRIVE_PAGE_TOKEN_REPEATED' }]);
    expect(result.continuation).toEqual([{ folderToken: 'root', pageToken: 'same', path: 'root', depth: 0 }]);
  });
  it('keeps folder pagination independent and resumes child folders', async () => {
    const calls: string[] = [];
    const result = await scanDriveFolders([{ folderToken: 'root', path: 'root', depth: 0 }], async (folder, token) => {
      calls.push(`${folder}:${token ?? 'first'}`);
      if (folder === 'root' && !token) return { files: [{ token: 'child', type: 'folder', name: 'child' }], hasMore: true, nextPageToken: 'r2' };
      if (folder === 'root' && token === 'r2') return { files: [{ token: 'a', type: 'file', name: 'a.pdf' }], hasMore: false };
      return { files: [{ token: 'b', type: 'file', name: 'b.pdf' }], hasMore: false };
    });
    expect(calls).toEqual(['root:first', 'root:r2', 'child:first']);
    expect(result.entries.map(entry => entry.path)).toEqual(['root/child', 'root/a.pdf', 'root/child/b.pdf']);
    expect(result.blockers).toEqual([]);
  });

  it('records a pagination blocker instead of looping forever', async () => {
    const result = await scanDriveFolders([{ folderToken: 'root', path: '', depth: 0 }], async () => ({ files: [], hasMore: true }), { maxMissingPageTokenRetries: 3 });
    expect(result.blockers).toEqual([{ folderToken: 'root', code: 'DRIVE_PAGE_TOKEN_MISSING' }]);
  });
});
