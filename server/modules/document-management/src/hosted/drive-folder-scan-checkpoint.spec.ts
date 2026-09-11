import { decodeDriveFolderScanCheckpoint, encodeDriveFolderScanCheckpoint } from './drive-folder-scan-checkpoint';

describe('drive scan checkpoints', () => {
  it('round trips resumable frontier without credentials or entries', () => {
    const roots = [{ folderToken: 'root', path: '技术资料', depth: 0 }];
    const continuation = [{ folderToken: 'child', path: '技术资料/FTD', depth: 1, pageToken: 'next-2' }];
    expect(decodeDriveFolderScanCheckpoint(encodeDriveFolderScanCheckpoint(roots, continuation, '2026-09-12T00:00:00.000Z'))).toEqual({
      version: 1, roots, continuation, updatedAt: '2026-09-12T00:00:00.000Z',
    });
  });

  it('rejects malformed or unsafe checkpoint states', () => {
    expect(() => decodeDriveFolderScanCheckpoint('{"version":1,"roots":[],"continuation":[{"folderToken":"x","path":"","depth":0}],"updatedAt":"x"}')).toThrow('DRIVE_SCAN_CHECKPOINT_INVALID');
    expect(() => decodeDriveFolderScanCheckpoint('not-json')).toThrow('DRIVE_SCAN_CHECKPOINT_INVALID');
    expect(() => decodeDriveFolderScanCheckpoint('{"version":1,"roots":[],"continuation":[],"updatedAt":"x","blockers":{}}')).toThrow('DRIVE_SCAN_CHECKPOINT_INVALID');
    expect(() => decodeDriveFolderScanCheckpoint('{"version":1,"roots":[],"continuation":[],"updatedAt":"x","blockers":[{"folderToken":""}]}')).toThrow('DRIVE_SCAN_CHECKPOINT_INVALID');
  });
});
