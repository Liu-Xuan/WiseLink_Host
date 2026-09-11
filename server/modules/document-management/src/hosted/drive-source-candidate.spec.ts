import { classifyDriveSourceCandidates, decodeDriveSourceCandidates, encodeDriveSourceCandidates, toDriveSourceCandidates } from './drive-source-candidate';

it('round trips candidate identity snapshots and rejects malformed state', () => {
  const candidates = toDriveSourceCandidates('operations', [{ token: 'same', type: 'file', name: '日报.pdf', path: '日报.pdf', version_id: 'v1' }]);
  expect(decodeDriveSourceCandidates(encodeDriveSourceCandidates(candidates))).toEqual(candidates);
  expect(() => decodeDriveSourceCandidates('{"bad":true}')).toThrow('DRIVE_CANDIDATE_SNAPSHOT_INVALID');
});

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

  it('treats repeated delivery as unchanged and a provider version change as changed', () => {
    const previous = toDriveSourceCandidates('operations', [{ token: 'same', type: 'file', name: '日报.pdf', path: '日报.pdf', version_id: 'v1' }]);
    const current = toDriveSourceCandidates('operations', [
      { token: 'same', type: 'file', name: '日报.pdf', path: '日报.pdf', version_id: 'v1' },
      { token: 'new', type: 'file', name: '新增.pdf', path: '新增.pdf', version_id: 'v1' },
    ]);
    expect(classifyDriveSourceCandidates(previous, current).map(item => item.change)).toEqual(['UNCHANGED', 'NEW']);
    expect(classifyDriveSourceCandidates(previous, [current[0]!, { ...current[0]!, providerVersionId: 'v2' }]).map(item => item.change)).toEqual(['UNCHANGED', 'CHANGED']);
  });

  it('does not merge equal provider tokens from different registered sources', () => {
    const previous = toDriveSourceCandidates('operations', [{ token: 'same', type: 'file', name: '日报.pdf', path: '日报.pdf', version_id: 'v1' }]);
    const current = toDriveSourceCandidates('technical-library', [{ token: 'same', type: 'file', name: '手册.pdf', path: '手册.pdf', version_id: 'v1' }]);
    expect(classifyDriveSourceCandidates(previous, current)[0]?.change).toBe('NEW');
  });

  it('uses modified time when the provider has no version identifier', () => {
    const previous = toDriveSourceCandidates('operations', [{ token: 'same', type: 'file', name: '日报.pdf', path: '日报.pdf', modifiedTime: '2026-09-12T00:00:00Z' }]);
    const current = toDriveSourceCandidates('operations', [{ token: 'same', type: 'file', name: '日报.pdf', path: '日报.pdf', modifiedTime: '2026-09-13T00:00:00Z' }]);
    expect(classifyDriveSourceCandidates(previous, current)[0]?.change).toBe('CHANGED');
  });

  it('does not claim unchanged when neither version nor modified time is available', () => {
    const previous = toDriveSourceCandidates('operations', [{ token: 'same', type: 'file', name: '日报.pdf', path: '日报.pdf' }]);
    const current = toDriveSourceCandidates('operations', [{ token: 'same', type: 'file', name: '日报.pdf', path: '日报.pdf' }]);
    expect(classifyDriveSourceCandidates(previous, current)[0]?.change).toBe('CHANGED');
  });
});
