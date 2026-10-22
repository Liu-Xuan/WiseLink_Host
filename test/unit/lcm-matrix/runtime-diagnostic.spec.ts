import { buildLcmNativeIndex, lcmNativeWindow } from '@shared/lcm-native-matrix-core';
import { adaptLcmNativeRead, lcmDiagnosticCanOpenReading, lcmDiagnosticScopeKey } from '@client/src/pages/WorkspaceHomePage/adapt-lcm-native-read';
import type { NavigationRequest } from '@client/src/pages/DocumentParsingPage/runtime-monitor/monitor-types';
import { nativeMatrixFixture, nativeSnapshotId } from './native-ui-fixtures';

function observation(aircraftRef: string | null = null) {
  const read = nativeMatrixFixture();
  const index = buildLcmNativeIndex(read);
  const matrix = lcmNativeWindow(index, { query: { snapshotIds: [nativeSnapshotId] }, rowLimit: 0, columnLimit: 0 });
  const scopeKey = lcmDiagnosticScopeKey('session1/read-epoch1', read.binding, aircraftRef);
  const context = { scopeKey, observedAt: '2026-10-22T06:00:00Z', mode: 'live' as const,
    environment: 'isolated Host snapshot read', label: 'current test scope' };
  return { read, matrix, context, runtime: adaptLcmNativeRead(read, matrix, aircraftRef, context) };
}

it('projects only actual read-set consumption, retaining candidate and finite-coverage limits', () => {
  const { read, runtime } = observation();
  expect(runtime.nodes.map(node => node.id)).toEqual(['business.software_configuration', 'surface.reading']);
  expect(runtime.edges).toEqual([expect.objectContaining({ from: 'business.software_configuration', to: 'surface.reading',
    status: 'consumed', refs: [read.binding.readSetRef] })]);
  expect(runtime.nodes[0].inputRefs.map(item => item.ref)).toEqual([nativeSnapshotId]);
  expect(runtime.nodes[0].kind).toBe('fact');
  expect(runtime.nodes[0].coverageScope).toContain('不能据此推算全机队覆盖');
  expect(runtime.nodes[0].business).toContain('来源候选');
  expect(runtime.nodes[1].business).toContain('不推导 AEO 实施');
  expect(runtime.nodes.flatMap(node => node.requests)).toEqual([]);
  expect(runtime.nodes.every(node => node.requestCompleteness === 'not_provided')).toBe(true);
  expect(runtime.resources).toBeUndefined();
  expect(runtime.nodes[0].sourceObservedAt).toBeUndefined();
});

it('does not reinterpret source values or convert blank/unknown to allowed or installed facts', () => {
  const { read, matrix, context } = observation();
  read.matrices[0].matrix.rows[0].states = [1, 2, '', null, 3];
  const before = structuredClone(read);
  const result = adaptLcmNativeRead(read, matrix, null, context);
  expect(read).toEqual(before);
  expect(result.nodes[0].summary).toContain('实装、允装、来源空白和未知分别展示');
  expect(result.nodes[0].artifact).toContain('1 个固定快照');
  expect(result.meta.observedAt).toBe(context.observedAt);
});

it('describes the current filtered and single-aircraft view without borrowing snapshot-wide counts', () => {
  const { read, matrix, context } = observation();
  const limited = { ...matrix, aircraftIndex: matrix.aircraftIndex.slice(0, 2), softwareIndex: matrix.softwareIndex.slice(0, 1) };
  expect(adaptLcmNativeRead(read, limited, null, context).nodes[0].summary).toContain('当前筛选 2 架飞机、1 项软件');
  const aircraft = limited.aircraftIndex[0];
  expect(adaptLcmNativeRead(read, limited, aircraft.aircraftRef, context).nodes[1].artifact).toBe(`当前单机 ${aircraft.tailNumber}`);
  expect(adaptLcmNativeRead(read, limited, 'not-selected', context).nodes[1].artifact).toBe('所选单机不在当前筛选范围');
});

it('rejects a view from another exact binding, including changed permission with the same read-set id', () => {
  const { read, matrix, context } = observation();
  expect(() => adaptLcmNativeRead(read, { ...matrix, binding: { ...matrix.binding, permissionRevision: 'p2' } }, null, context))
    .toThrow('LCM 诊断与当前阅读绑定不一致');
});

it('allows only current-bound read and snapshot references; stale session, permission and aircraft views cannot navigate', () => {
  const { read, runtime, context } = observation();
  const detail: NavigationRequest = { kind: 'artifact', nodeId: 'business.software_configuration',
    scopeKey: context.scopeKey, ref: read.binding.readSetRef };
  expect(lcmDiagnosticCanOpenReading(detail, runtime, read, context.scopeKey)).toBe(true);
  expect(lcmDiagnosticCanOpenReading({ ...detail, kind: 'source', ref: nativeSnapshotId }, runtime, read, context.scopeKey)).toBe(true);
  for (const next of [
    lcmDiagnosticScopeKey('session2/read-epoch1', read.binding, null),
    lcmDiagnosticScopeKey('session1/read-epoch1', { ...read.binding, permissionRevision: 'p2' }, null),
    lcmDiagnosticScopeKey('session1/read-epoch1', read.binding, 'other-aircraft'),
  ]) expect(lcmDiagnosticCanOpenReading(detail, runtime, read, next)).toBe(false);
  expect(lcmDiagnosticCanOpenReading({ ...detail, nodeId: 'missing' }, runtime, read, context.scopeKey)).toBe(false);
  expect(lcmDiagnosticCanOpenReading({ ...detail, ref: 'arbitrary-snapshot' }, runtime, read, context.scopeKey)).toBe(false);
  expect(lcmDiagnosticCanOpenReading({ ...detail, subjectRef: 'other-readset' }, runtime, read, context.scopeKey)).toBe(false);
  expect(lcmDiagnosticCanOpenReading({ ...detail, kind: 'request' }, runtime, read, context.scopeKey)).toBe(false);
  expect(lcmDiagnosticCanOpenReading({ ...detail, kind: 'source', ref: nativeSnapshotId }, runtime,
    { ...read, snapshots: [] }, context.scopeKey)).toBe(false);
});
