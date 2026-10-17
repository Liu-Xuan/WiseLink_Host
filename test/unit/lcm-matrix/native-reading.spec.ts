import { LcmNativeMatrixReadingService } from '@server/modules/lcm-export-staging/lcm-native-matrix-reading.service';
import { LcmSourceReadingService } from '@server/modules/lcm-export-staging/lcm-source-reading.service';
import type { LcmDatabaseScope } from '@shared/lcm-configuration-store.interface';
import type {
  LcmSourceReadGrant,
  LcmSnapshotReadRepository,
} from '@server/modules/lcm-export-staging/lcm-source-reading.port';
import { buildLcmNativeIndex } from '@shared/lcm-native-matrix-core';
import { lcmAircraftRef } from '@shared/lcm-matrix-core';
import { actor } from '../tdms-source/tdms-fixtures';
import { nativeFixture, nativeId } from './native-fixtures';

function setup() {
  const subject = actor(),
    fixture = nativeFixture();
  const grant: LcmSourceReadGrant = {
    applicationScopeId: subject.applicationScopeId,
    authorityRef: 'synthetic-authority',
    permissionRevision: 'p1',
    scope: {
      tenantId: subject.tenantId,
      actorId: subject.canonicalSubject.id,
      authorizedSourceInstanceIds: ['test-lcm'],
    },
    managementDomains: {
      'test-lcm': {
        managementDomainRef: 'test-domain',
        evidenceRef: 'synthetic-domain-evidence',
      },
    },
  };
  const nativeMatrixReadSet = jest.fn(
    async (_scope: LcmDatabaseScope, ids: string[], metadataOnly = false) => ({
      snapshots: fixture.snapshots.filter((snapshot) =>
        ids.includes(snapshot.snapshotId),
      ),
      matrices: metadataOnly
        ? []
        : fixture.matrices.map(({ snapshotId, matrix }) => ({
            snapshotId,
            matrix,
          })),
    }),
  );
  const repository: LcmSnapshotReadRepository = {
    available: true,
    catalogue: jest.fn(async () => ({
      snapshots: [],
      hasMore: false,
      nextAfter: null,
    })),
    nativeMatrixReadSet,
  };
  const reading = new LcmSourceReadingService(
    { available: true, authorize: async () => structuredClone(grant) },
    repository,
  );
  return {
    subject,
    fixture,
    nativeMatrixReadSet,
    service: new LcmNativeMatrixReadingService(reading, repository),
  };
}

describe('native Host reading without legacy record-set adapters', () => {
  it('assembles only requested software/PN/aircraft source coordinates, preserving separate FIN rows', async () => {
    const test = setup(),
      data = await test.service.read(test.subject, { snapshotIds: [nativeId] });
    const index = buildLcmNativeIndex(data),
      software = index.software.find(
        (group) => group.lcmSoftwareName === '22 FCC OPS',
      )!;
    const aircraftRef = lcmAircraftRef('test-domain', 'B-1002');
    const result = await test.service.details(test.subject, {
      query: { snapshotIds: [nativeId] },
      binding: data.binding,
      softwareRef: software.softwareRef,
      aircraftRef,
      partNumber: 'A',
    });
    expect(result.records).toHaveLength(3);
    expect(
      result.records
        .flatMap((entry) => entry.record.sourceRows)
        .map((row) => row.row)
        .sort(),
    ).toEqual([2, 3, 5]);
    expect(
      result.records.every(
        (entry) =>
          entry.record.tailNumber === 'B-1002' &&
          entry.record.sourceRows.every(
            (row) => row.cells['矩阵值'].column === 8,
          ),
      ),
    ).toBe(true);
    expect(test.nativeMatrixReadSet).toHaveBeenLastCalledWith(
      expect.anything(),
      [nativeId],
      true,
    );
  });
  it('uses the same plural model filter for normal Host detail reads and rejects malformed arrays', async () => {
    const test = setup();
    test.fixture.snapshots[0].coveredAircraftModels = ['B787-9'];
    for (const [i, model] of ['A320-200', 'C919'].entries()) {
      const other = structuredClone(test.fixture.matrices[0]);
      other.snapshotId = String(i + 2).repeat(64); other.matrix.aircraftModel = model;
      test.fixture.matrices.push(other);
      test.fixture.snapshots.push({ ...test.fixture.snapshots[0], snapshotId: other.snapshotId, coveredAircraftModels: [model] });
    }
    const snapshotIds = test.fixture.snapshots.map(value => value.snapshotId);
    const data = await test.service.read(test.subject, { snapshotIds });
    const softwareRef = buildLcmNativeIndex(data).software[0].softwareRef;
    const request = { query: { snapshotIds, aircraftModels: ['B787-9', 'A320-200'] }, binding: data.binding, softwareRef };
    const result = await test.service.details(test.subject, request);
    expect(new Set(result.records.map(entry => entry.record.aircraftModel))).toEqual(new Set(['B787-9', 'A320-200']));
    expect(result.records.every(entry => entry.snapshot.snapshotId !== '3'.repeat(64))).toBe(true);
    await expect(test.service.details(test.subject, { ...request, query: { snapshotIds, aircraftModels: ['A320-200', 'A320-200'] } }))
      .rejects.toMatchObject({ code: 'LCM_MATRIX_QUERY_INVALID' });
    await expect(test.service.details(test.subject, { ...request, query: { snapshotIds, aircraftModels: 'A320-200' } }))
      .rejects.toMatchObject({ code: 'LCM_MATRIX_QUERY_INVALID' });
  });
  it('rejects unsupported native-body request fields and stale bindings', async () => {
    const test = setup();
    await expect(
      test.service.read(test.subject, {
        snapshotIds: [nativeId],
        search: 'ignored',
      }),
    ).rejects.toMatchObject({ code: 'LCM_MATRIX_QUERY_INVALID' });
    const data = await test.service.read(test.subject, {
      snapshotIds: [nativeId],
    });
    await expect(
      test.service.authorize(test.subject, {
        snapshotIds: [nativeId],
        binding: { ...data.binding, permissionRevision: 'stale' },
      }),
    ).rejects.toMatchObject({ code: 'LCM_MATRIX_BINDING_CHANGED' });
  });
});
