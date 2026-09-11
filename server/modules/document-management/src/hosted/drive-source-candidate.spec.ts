import { toDriveSourceCandidates } from './drive-source-candidate';

describe('toDriveSourceCandidates', () => {
  it('keeps provider identity and excludes folders without triggering analysis', () => {
    const candidates = toDriveSourceCandidates('operations', [
      { token: 'folder', type: 'folder', name: '2026', path: '运行信息/2026' },
      { token: 'file', type: 'file', name: '日报.pdf', path: '运行信息/日报.pdf', modifiedTime: '2026-09-12T00:00:00Z', version_id: 'v3' },
    ]);
    expect(candidates).toEqual([{
      sourceKey: 'operations', providerObjectId: 'file', providerVersionId: 'v3', entryType: 'file',
      name: '日报.pdf', path: '运行信息/日报.pdf', modifiedTime: '2026-09-12T00:00:00Z', identity: 'operations:file:file:v3',
    }]);
  });
});
