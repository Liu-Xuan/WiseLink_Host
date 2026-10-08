import 'reflect-metadata';

import { BadRequestException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { CanonicalLibraryGraphRequest } from '../../shared/library-graph.interface';
import type { CanonicalLibraryFleetCatalog } from '../../shared/library-fleet.interface';
import type {
  OwnedLibraryGraphQuery,
  OwnedLibraryGraphResult,
} from '../../server/modules/document-management/src/hosted/nest/miaoda-hosted-library-graph-query';
import { CanonicalHostController } from '../../server/modules/canonical-host/canonical-host.controller';
import { CanonicalLibraryService } from '../../server/modules/canonical-host/canonical-library.service';
import {
  graphRequest,
  libraryGraphHttpRequest,
  readLibraryGraph,
} from '../../server/modules/canonical-host/canonical-library-graph';
import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import { PgDialect } from 'drizzle-orm/pg-core';
import { tenantFamilyIdentityPrefix } from '../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog';
import { libraryGraphStatement } from '../../server/modules/document-management/src/hosted/nest/miaoda-hosted-library-graph-query';
import { syntheticMiaodaActorFixture } from '../fixtures/synthetic-development-canonical-object-access.adapter';

const APP_ID = 'app_17bzc551rsg';
const identity = syntheticMiaodaActorFixture('reader-a', 'tenant-a');
identity.env = 'preview';
identity.subjectDecision.version = 'miaoda-hosted-native-sso.v1';
const actor: CanonicalHostActor = {
  userId: 'reader-a',
  tenantId: 'tenant-a',
  appId: APP_ID,
  env: 'preview',
  roles: [],
  objectAccessActor: identity,
};

const cluster = (value: string | null, count = 2) => ({
  kind: 'CLASSIFICATION' as const,
  value,
  uniqueFamilyCount: count,
  readableVersionCountInMatchingFamilies: count + 1,
});
const family = (familyId = 'family-1') => ({
  kind: 'FAMILY' as const,
  familyId,
  documentId: 'document-1',
  documentCode: 'SB 737-100',
  normalizedFamily: 'SB',
  readableVersionCount: 2,
});
const version = (documentVersionId = 'version-1') => ({
  kind: 'VERSION' as const,
  documentVersionId,
  businessRevision: 'Revision 1',
  committedAt: '2026-10-01T12:00:00.000Z',
  isCurrent: true,
});
const result = (
  items: OwnedLibraryGraphResult['items'] = [],
): OwnedLibraryGraphResult => ({
  uniqueFamilyCount: 2,
  readableVersionCountInMatchingFamilies: 3,
  invalidData: false,
  items,
});

function serviceTarget() {
  const repository = { graph: jest.fn().mockResolvedValue([result()]) };
  const fleet = {
    readLibraryCatalog: jest.fn().mockResolvedValue({
      status: 'AVAILABLE',
      asOf: '2026-10-07',
      source: {
        sourceSnapshotId: 'fleet-snapshot-1',
        authorityRevision: 'rev-1',
      },
      families: [{ fleetFamily: '787', models: ['787-9', '787-10'] }],
    }),
  };
  return {
    repository,
    fleet,
    service: new CanonicalLibraryService(
      repository as never,
      {} as never,
      {} as never,
      undefined,
      fleet as never,
    ),
  };
}

describe('canonical library graph request contract', () => {
  it('accepts only the supported level-specific shape and bounded limits', () => {
    expect(
      graphRequest({ level: 'clusters', groupBy: 'ata', limit: 1 }),
    ).toMatchObject({
      level: 'clusters',
      groupBy: 'ata',
      limit: 1,
    });
    expect(
      graphRequest({ level: 'clusters', groupBy: 'ata', limit: 50 }),
    ).toMatchObject({ limit: 50 });
    expect(
      graphRequest({ level: 'clusters', groupBy: 'normalizedFamily' }).limit,
    ).toBe(50);

    const invalid: unknown[] = [
      { level: 'bogus', groupBy: 'ata' },
      { level: 'clusters', groupBy: 'ata', tenantId: 'tenant-b' },
      { level: 'clusters', groupBy: 'ata', actorUserId: 'reader-b' },
      { level: 'clusters', groupBy: 'ata', actor: { userId: 'reader-b' } },
      { level: 'clusters', groupBy: 'ata', clusterValue: null },
      { level: 'families', groupBy: 'ata' },
      {
        level: 'families',
        groupBy: 'ata',
        familyId: 'family-1',
        clusterValue: null,
      },
      { level: 'versions', familyId: 'family-1', search: 'anything' },
      { level: 'versions', familyId: 'family-1', groupBy: 'ata' },
      { level: 'versions', familyId: '   ' },
      { level: 'clusters', groupBy: 'ata', limit: 0 },
      { level: 'clusters', groupBy: 'ata', limit: 51 },
      { level: 'clusters', groupBy: 'ata', limit: 1.5 },
      { level: 'clusters', groupBy: 'ata', limit: '1' },
    ];
    for (const request of invalid)
      expect(() => graphRequest(request)).toThrow(BadRequestException);
  });

  it('validates HTTP query scalar syntax and preserves missing, null, and empty classification distinctly', () => {
    expect(
      libraryGraphHttpRequest({
        level: 'families',
        groupBy: 'ata',
        clusterMissing: 'true',
        limit: '1',
      }),
    ).toEqual({
      level: 'families',
      groupBy: 'ata',
      clusterValue: null,
      limit: 1,
    });
    expect(
      libraryGraphHttpRequest({
        level: 'clusters',
        groupBy: 'ata',
        limit: '50',
      }).limit,
    ).toBe(50);
    expect(
      libraryGraphHttpRequest({
        level: 'families',
        groupBy: 'ata',
        clusterValue: '',
      }),
    ).toEqual({
      level: 'families',
      groupBy: 'ata',
      clusterValue: '',
      limit: 50,
    });
    expect(
      graphRequest({ level: 'families', groupBy: 'ata', clusterValue: null }),
    ).toMatchObject({
      clusterValue: null,
    });

    const invalidQueries: unknown[] = [
      { level: ['clusters'], groupBy: 'ata' },
      { level: 'clusters', groupBy: ['ata'] },
      { level: 'clusters', groupBy: 'ata', search: ['737'] },
      { level: 'clusters', groupBy: 'ata', cursor: ['opaque'] },
      { level: 'clusters', groupBy: 'ata', limit: ['1'] },
      { level: 'clusters', groupBy: 'ata', limit: '01' },
      { level: 'clusters', groupBy: 'ata', limit: '51' },
      { level: 'families', groupBy: 'ata', clusterMissing: 'false' },
      {
        level: 'families',
        groupBy: 'ata',
        clusterMissing: 'true',
        clusterValue: '',
      },
      { level: 'clusters', groupBy: 'ata', clusterMissing: 'true' },
      { level: 'versions', familyId: 'family-1', ata: 'ATA 27' },
      { level: 'clusters', groupBy: 'ata', unrelated: 'value' },
    ];
    for (const query of invalidQueries)
      expect(() => libraryGraphHttpRequest(query)).toThrow(BadRequestException);
  });

  it('normalizes filters before they reach the owner-scoped repository and never trusts client scope fields', async () => {
    const { service, repository } = serviceTarget();
    const response = await service.graph(
      {
        level: 'clusters',
        groupBy: 'normalizedFamily',
        search: '  737  ',
        normalizedFamily: ' SB ',
        fleetFamily: ' 787 ',
        limit: 2,
      },
      actor,
    );
    const query = repository.graph.mock.calls[0][0] as OwnedLibraryGraphQuery;
    expect(query).toMatchObject({
      tenantId: 'tenant-a',
      actorUserId: 'reader-a',
      limit: 2,
      request: {
        level: 'clusters',
        groupBy: 'normalizedFamily',
        search: '737',
        normalizedFamily: 'SB',
        fleetFamily: '787',
      },
      fleetMentionValues: [
        '787',
        'B787',
        '787-9',
        'B787-9',
        '787-10',
        'B787-10',
      ],
    });
    expect(query).not.toHaveProperty('tenantId', 'client-tenant');
    expect(JSON.stringify(response)).not.toContain('tenant-a');
    await expect(
      service.graph(
        {
          level: 'clusters',
          groupBy: 'ata',
          tenantId: 'tenant-b',
        } as never,
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(repository.graph).toHaveBeenCalledTimes(1);
  });

  it('requires a validated hosted final-user identity and performs a new scoped repository read for each page', async () => {
    const { service, repository } = serviceTarget();
    repository.graph
      .mockResolvedValueOnce([result([cluster('ATA 27'), cluster('ATA 28')])])
      .mockResolvedValueOnce([result([cluster('ATA 28')])]);
    const first = await service.graph(
      { level: 'clusters', groupBy: 'ata', limit: 1 },
      actor,
    );
    const second = await service.graph(
      {
        level: 'clusters',
        groupBy: 'ata',
        limit: 1,
        cursor: first.nextCursor!,
      },
      actor,
    );
    expect(first.hasMore).toBe(true);
    expect(second.items).toEqual([cluster('ATA 28')]);
    expect(repository.graph).toHaveBeenCalledTimes(2);
    expect(
      repository.graph.mock.calls.map(([query]) => [
        query.tenantId,
        query.actorUserId,
      ]),
    ).toEqual([
      ['tenant-a', 'reader-a'],
      ['tenant-a', 'reader-a'],
    ]);
    expect(first).toMatchObject({
      scope: 'CURRENT_USER_DOCUMENT_CATALOG',
      versionMeaning: 'ALL_READABLE_VERSIONS',
      consistency: 'LIVE_READ',
      relationMeaning: 'CLASSIFICATION_AND_CONTAINMENT_ONLY',
      coverage: {
        documentReferences: 'NOT_INDEXED',
        matterMemberships: 'NOT_LOADED',
      },
      fileReadPerformed: false,
      modelRunPerformed: false,
      countScope: 'FILTERED_FAMILIES',
      clusterCountsOverlap: true,
    });
    expect(JSON.stringify(first)).not.toMatch(
      /reader-a|tenant-a|app_17|permission|role|grant|authorization|token/iu,
    );

    const drift = { ...actor, userId: 'reader-b', roles: ['admin'] };
    expect(() =>
      service.graph({ level: 'clusters', groupBy: 'ata' }, drift),
    ).toThrow('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE');
    expect(() =>
      service.graph(
        { level: 'clusters', groupBy: 'ata' },
        {
          ...actor,
          tenantId: 'tenant-b',
        },
      ),
    ).toThrow('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE');
    expect(repository.graph).toHaveBeenCalledTimes(2);
  });

  it('reads selected-family versions with a fresh owner scope and returns only exact version facts', async () => {
    const { service, repository } = serviceTarget();
    repository.graph.mockResolvedValueOnce([
      result([
        {
          ...version('document-version-東京'),
          businessRevision: 'Révision 2',
          committedAt: '2026-10-01T14:00:00+02:00',
          internalOwnerId: 'reader-a',
          rawMetadata: { secret: true },
        } as never,
      ]),
    ]);
    const response = await service.graph(
      { level: 'versions', familyId: 'family-a' },
      actor,
    );
    expect(repository.graph).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        actorUserId: 'reader-a',
        after: null,
        limit: 50,
        request: { level: 'versions', familyId: 'family-a', limit: 50 },
      }),
    );
    expect(response).toMatchObject({
      level: 'versions',
      familyId: 'family-a',
      countScope: 'SELECTED_FAMILY_FRESH_READ',
      counts: {
        uniqueFamilyCount: 2,
        readableVersionCountInMatchingFamilies: 3,
      },
      coverage: {
        documentReferences: 'NOT_INDEXED',
        matterMemberships: 'NOT_LOADED',
      },
      items: [
        {
          kind: 'VERSION',
          documentVersionId: 'document-version-東京',
          businessRevision: 'Révision 2',
          committedAt: '2026-10-01T12:00:00.000Z',
          isCurrent: true,
        },
      ],
    });
    expect(JSON.stringify(response)).not.toMatch(
      /reader-a|rawMetadata|secret/iu,
    );
    await expect(
      service.graph(
        {
          level: 'versions',
          familyId: 'family-a',
          normalizedFamily: 'SB',
        } as never,
        actor,
      ),
    ).rejects.toMatchObject({
      response: { code: 'LIBRARY_GRAPH_REQUEST_INVALID' },
    });
    expect(repository.graph).toHaveBeenCalledTimes(1);
  });

  it('keeps null and empty classification cursors distinct and rejects malformed or oversized cursors', async () => {
    const { service, repository } = serviceTarget();
    repository.graph
      .mockResolvedValueOnce([result([cluster(null), cluster('')])])
      .mockResolvedValueOnce([result([cluster(''), cluster('ATA 27')])])
      .mockResolvedValueOnce([result([cluster('ATA 27')])]);
    const first = await service.graph(
      { level: 'clusters', groupBy: 'ata', limit: 1 },
      actor,
    );
    expect(first.items).toEqual([cluster(null)]);
    const second = await service.graph(
      {
        level: 'clusters',
        groupBy: 'ata',
        limit: 1,
        cursor: first.nextCursor!,
      },
      actor,
    );
    expect(repository.graph.mock.calls[1][0].after).toEqual({ value: null });
    expect(second.items).toEqual([cluster('')]);
    await service.graph(
      {
        level: 'clusters',
        groupBy: 'ata',
        limit: 1,
        cursor: second.nextCursor!,
      },
      actor,
    );
    expect(repository.graph.mock.calls[2][0].after).toEqual({ value: '' });

    for (const cursor of ['e30', '!!!!']) {
      await expect(
        service.graph(
          {
            level: 'clusters',
            groupBy: 'ata',
            cursor,
          },
          actor,
        ),
      ).rejects.toMatchObject({
        response: { code: 'LIBRARY_GRAPH_CURSOR_INVALID' },
      });
    }
    await expect(
      service.graph(
        {
          level: 'clusters',
          groupBy: 'ata',
          cursor: 'A'.repeat(8193),
        },
        actor,
      ),
    ).rejects.toMatchObject({
      response: { code: 'LIBRARY_GRAPH_REQUEST_INVALID' },
    });
    expect(repository.graph).toHaveBeenCalledTimes(3);
  });

  it('caps a public page at 50 rows while accepting the single 51st lookahead row', async () => {
    const { service, repository } = serviceTarget();
    repository.graph.mockResolvedValueOnce([
      result(
        Array.from({ length: 51 }, (_, index) => cluster(`ATA ${index + 1}`)),
      ),
    ]);
    const response = await service.graph(
      { level: 'clusters', groupBy: 'ata', limit: 50 },
      actor,
    );
    expect(repository.graph.mock.calls[0][0].limit).toBe(50);
    expect(response.items).toHaveLength(50);
    expect(response.hasMore).toBe(true);
    expect(response.nextCursor).toBeTruthy();
    await expect(
      service.graph({ level: 'clusters', groupBy: 'ata', limit: 51 }, actor),
    ).rejects.toMatchObject({
      response: { code: 'LIBRARY_GRAPH_REQUEST_INVALID' },
    });
    expect(repository.graph).toHaveBeenCalledTimes(1);
  });

  it('keeps a maximum-size escaped control-character page below the serialized response budget', async () => {
    const { service, repository } = serviceTarget();
    const escapedControl = '\u0001'.repeat(96);
    const escapedCode = '\u0001'.repeat(512);
    const maxEscapedFamilies = Array.from({ length: 50 }, () => ({
      kind: 'FAMILY' as const,
      familyId: escapedControl,
      documentId: escapedControl,
      documentCode: escapedCode,
      normalizedFamily: escapedControl,
      readableVersionCount: 2,
    }));
    repository.graph.mockResolvedValueOnce([result(maxEscapedFamilies)]);
    const response = await service.graph(
      {
        level: 'families',
        groupBy: 'normalizedFamily',
        clusterValue: 'SB',
        limit: 50,
      },
      actor,
    );
    expect(response.items).toHaveLength(50);
    expect(response.items[0]).toEqual({
      kind: 'FAMILY',
      familyId: escapedControl,
      documentId: escapedControl,
      documentCode: escapedCode,
      normalizedFamily: escapedControl,
      readableVersionCount: 2,
    });
    expect(Buffer.byteLength(JSON.stringify(response), 'utf8')).toBeLessThan(
      256 * 1024,
    );
  });

  it('binds continuation cursors to every scope and selection dimension', async () => {
    const request: CanonicalLibraryGraphRequest = {
      level: 'families',
      groupBy: 'normalizedFamily',
      clusterValue: 'SB',
      search: '737',
      normalizedFamily: 'SB',
      limit: 1,
    };
    const scope = {
      tenantId: 'tenant-a',
      actorUserId: 'reader-a',
      appId: APP_ID,
    };
    const page = await readLibraryGraph(
      request,
      scope,
      async () => {
        throw new Error('unused');
      },
      async () => [result([family('family-1'), family('family-2')])],
    );
    expect(page.nextCursor).toBeTruthy();
    const variants: Array<
      [string, CanonicalLibraryGraphRequest, typeof scope]
    > = [
      ['tenant', request, { ...scope, tenantId: 'tenant-b' }],
      ['actor', request, { ...scope, actorUserId: 'reader-b' }],
      ['app', request, { ...scope, appId: 'app-other' }],
      ['filter', { ...request, search: '737-900' }, scope],
      [
        'level',
        {
          level: 'clusters',
          groupBy: 'normalizedFamily',
          search: '737',
          normalizedFamily: 'SB',
          limit: 1,
        },
        scope,
      ],
      ['group', { ...request, groupBy: 'ata' }, scope],
      ['anchor', { ...request, clusterValue: 'ATA 27' }, scope],
      ['limit', { ...request, limit: 2 }, scope],
    ];
    for (const [label, changedRequest, changedScope] of variants) {
      const read = jest.fn(async () => [result([family('family-3')])]);
      await expect(
        readLibraryGraph(
          {
            ...changedRequest,
            cursor: page.nextCursor!,
          } as CanonicalLibraryGraphRequest,
          changedScope,
          async () => {
            throw new Error('unused');
          },
          read,
        ),
      ).rejects.toMatchObject({
        response: { code: 'LIBRARY_GRAPH_CURSOR_INVALID' },
      });
      expect(read).not.toHaveBeenCalled();
      expect(label).toBeTruthy();
    }
  });

  it('binds fleet cursors to fresh catalog source revision and catalog aliases', async () => {
    const request: CanonicalLibraryGraphRequest = {
      level: 'clusters',
      groupBy: 'ata',
      fleetFamily: '787',
      limit: 1,
    };
    const scope = {
      tenantId: 'tenant-a',
      actorUserId: 'reader-a',
      appId: APP_ID,
    };
    const read = jest.fn(async (_query: OwnedLibraryGraphQuery) => [
      result([cluster('ATA 27'), cluster('ATA 28')]),
    ]);
    let revision = 'rev-1';
    let models = ['787-9', '787-10'];
    const readFleet = jest.fn(
      async (): Promise<CanonicalLibraryFleetCatalog> => ({
        scope: 'CURRENT_TENANT_ACTIVE_FLEET',
        status: 'AVAILABLE' as const,
        asOf: '2026-10-07',
        source: {
          sourceSnapshotId: 'fleet-snapshot-1',
          sourceRevisionKey: 'fleet-source-1',
          sourceAsOf: '2026-10-07',
          authorityRevision: revision,
        },
        families: [{ fleetFamily: '787', models }],
        unclassifiedAssetCount: 0,
        semantics: 'DOCUMENT_MENTION_CLASSIFICATION_ONLY',
      }),
    );
    const first = await readLibraryGraph(request, scope, readFleet, read);
    expect(read.mock.calls[0][0].fleetMentionValues).toEqual([
      '787',
      'B787',
      '787-9',
      'B787-9',
      '787-10',
      'B787-10',
    ]);
    models = ['787-9'];
    await expect(
      readLibraryGraph(
        { ...request, cursor: first.nextCursor! },
        scope,
        readFleet,
        read,
      ),
    ).rejects.toMatchObject({
      response: { code: 'LIBRARY_GRAPH_CURSOR_INVALID' },
    });
    models = ['787-9', '787-10'];
    revision = 'rev-2';
    await expect(
      readLibraryGraph(
        { ...request, cursor: first.nextCursor! },
        scope,
        readFleet,
        read,
      ),
    ).rejects.toMatchObject({
      response: { code: 'LIBRARY_GRAPH_CURSOR_INVALID' },
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('binds version cursors to the selected family anchor', async () => {
    const scope = {
      tenantId: 'tenant-a',
      actorUserId: 'reader-a',
      appId: APP_ID,
    };
    const request: CanonicalLibraryGraphRequest = {
      level: 'versions',
      familyId: 'family-a',
      limit: 1,
    };
    const read = jest
      .fn()
      .mockResolvedValueOnce([
        result([version('version-a'), version('version-b')]),
      ])
      .mockResolvedValueOnce([result([version('version-b')])]);
    const first = await readLibraryGraph(
      request,
      scope,
      async () => {
        throw new Error('unused');
      },
      read,
    );
    await readLibraryGraph(
      {
        level: 'versions',
        familyId: 'family-b',
        limit: 1,
        cursor: first.nextCursor!,
      },
      scope,
      async () => {
        throw new Error('unused');
      },
      read,
    ).then(
      () => {
        throw new Error('family cursor should be rejected');
      },
      (error) =>
        expect(error).toMatchObject({
          response: { code: 'LIBRARY_GRAPH_CURSOR_INVALID' },
        }),
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reports fleet catalog failures and validates selected catalog members', async () => {
    const { service, fleet, repository } = serviceTarget();
    fleet.readLibraryCatalog.mockResolvedValue({
      status: 'MISSING',
      source: null,
      families: [],
    });
    await expect(
      service.graph(
        {
          level: 'clusters',
          groupBy: 'ata',
          fleetFamily: '787',
        },
        actor,
      ),
    ).rejects.toMatchObject({
      response: { code: 'LIBRARY_FLEET_CATALOG_MISSING' },
    });
    fleet.readLibraryCatalog.mockRejectedValueOnce(
      new Error('database offline'),
    );
    await expect(
      service.graph(
        {
          level: 'clusters',
          groupBy: 'ata',
          fleetFamily: '787',
        },
        actor,
      ),
    ).rejects.toMatchObject({
      response: { code: 'LIBRARY_FLEET_CATALOG_READ_FAILED' },
    });
    fleet.readLibraryCatalog.mockResolvedValue({
      status: 'AVAILABLE',
      asOf: '2026-10-07',
      source: {
        sourceSnapshotId: 'fleet-snapshot-1',
        authorityRevision: 'rev-1',
      },
      families: [{ fleetFamily: '787', models: ['787-9'] }],
    });
    await expect(
      service.graph(
        {
          level: 'clusters',
          groupBy: 'ata',
          fleetFamily: '737',
        },
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.graph(
        {
          level: 'clusters',
          groupBy: 'ata',
          fleetFamily: '787',
          fleetModel: '787-10',
        },
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(repository.graph).not.toHaveBeenCalled();
  });

  it('rejects unsafe repository rows as typed data-budget errors without clipping identifiers or leaking metadata', async () => {
    const { service, repository } = serviceTarget();
    repository.graph.mockResolvedValueOnce([
      {
        ...result([family('f'.repeat(385))]),
        internalOwnerId: 'reader-a',
        rawMetadata: { password: 'must-not-leak' },
      },
    ]);
    await expect(
      service.graph(
        { level: 'families', groupBy: 'normalizedFamily', clusterValue: 'SB' },
        actor,
      ),
    ).rejects.toMatchObject({
      response: { code: 'LIBRARY_GRAPH_DATA_LIMIT_EXCEEDED' },
    });

    repository.graph.mockResolvedValueOnce([
      { ...result([family(`é`.repeat(193))]) },
    ]);
    await expect(
      service.graph(
        { level: 'families', groupBy: 'normalizedFamily', clusterValue: 'SB' },
        actor,
      ),
    ).rejects.toMatchObject({
      response: { code: 'LIBRARY_GRAPH_DATA_LIMIT_EXCEEDED' },
    });

    repository.graph.mockResolvedValueOnce([
      { ...result([family('\0invalid')]) },
    ]);
    await expect(
      service.graph(
        { level: 'families', groupBy: 'normalizedFamily', clusterValue: 'SB' },
        actor,
      ),
    ).rejects.toMatchObject({
      response: { code: 'LIBRARY_GRAPH_DATA_LIMIT_EXCEEDED' },
    });

    repository.graph.mockResolvedValueOnce([{ ...result([family('\ud800')]) }]);
    await expect(
      service.graph(
        { level: 'families', groupBy: 'normalizedFamily', clusterValue: 'SB' },
        actor,
      ),
    ).rejects.toMatchObject({
      response: { code: 'LIBRARY_GRAPH_DATA_LIMIT_EXCEEDED' },
    });

    repository.graph.mockResolvedValueOnce([
      {
        ...result([family('family-1')]),
        invalidData: true,
      },
    ]);
    await expect(
      service.graph(
        { level: 'families', groupBy: 'normalizedFamily', clusterValue: 'SB' },
        actor,
      ),
    ).rejects.toMatchObject({
      response: { code: 'LIBRARY_GRAPH_DATA_LIMIT_EXCEEDED' },
    });

    const extraMetadata = {
      ...family('family-1'),
      internalOwnerId: 'reader-a',
      rawMetadata: { password: 'must-not-leak' },
    };
    repository.graph.mockResolvedValueOnce([
      { ...result([extraMetadata as never]) },
    ]);
    const response = await service.graph(
      {
        level: 'families',
        groupBy: 'normalizedFamily',
        clusterValue: 'SB',
      },
      actor,
    );
    expect(response.items[0]).toEqual(family('family-1'));
    expect(JSON.stringify(response)).not.toMatch(
      /reader-a|password|rawMetadata|internalOwnerId/iu,
    );
  });

  it('fails closed when a generated continuation token would exceed its serialized budget', async () => {
    const scope = {
      tenantId: 't'.repeat(6200),
      actorUserId: 'reader-a',
      appId: APP_ID,
    };
    await expect(
      readLibraryGraph(
        { level: 'clusters', groupBy: 'ata', limit: 1 },
        scope,
        async () => {
          throw new Error('unused');
        },
        async () => [result([cluster('ATA 27'), cluster('ATA 28')])],
      ),
    ).rejects.toMatchObject({
      response: { code: 'LIBRARY_GRAPH_DATA_LIMIT_EXCEEDED' },
    });
  });

  it('registers the GET endpoint and forwards only a validated normalized request plus the trusted browser actor', async () => {
    const previousSandboxId = process.env.SANDBOX_ID;
    const previousLocalDev = process.env.MIAODA_LOCAL_DEV;
    process.env.SANDBOX_ID = 'unit-library-graph';
    delete process.env.MIAODA_LOCAL_DEV;
    try {
      expect(
        Reflect.getMetadata(
          PATH_METADATA,
          CanonicalHostController.prototype.libraryGraph,
        ),
      ).toBe('library/graph');
      expect(
        Reflect.getMetadata(
          METHOD_METADATA,
          CanonicalHostController.prototype.libraryGraph,
        ),
      ).toBe(0);
      const libraryDocuments = {
        graph: jest.fn().mockResolvedValue({ level: 'clusters', items: [] }),
      };
      const controller = new CanonicalHostController(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        undefined,
        libraryDocuments as never,
      );
      const request = {
        userContext: {
          userId: 'reader-a',
          tenantId: 'tenant-a',
          appId: APP_ID,
          env: 'preview',
          roles: ['authenticated'],
        },
      };
      await expect(
        controller.libraryGraph(
          {
            level: 'clusters',
            groupBy: 'normalizedFamily',
            search: '  737 ',
            limit: '2',
          },
          request as never,
        ),
      ).resolves.toEqual({ level: 'clusters', items: [] });
      expect(libraryDocuments.graph).toHaveBeenCalledWith(
        {
          level: 'clusters',
          groupBy: 'normalizedFamily',
          search: '737',
          limit: 2,
        },
        expect.objectContaining({
          userId: 'reader-a',
          tenantId: 'tenant-a',
          appId: APP_ID,
          objectAccessActor: expect.objectContaining({
            principalKind: 'FINAL_USER',
          }),
        }),
      );
      expect(() =>
        controller.libraryGraph(
          {
            level: 'clusters',
            groupBy: 'ata',
            search: ['737'],
          } as never,
          request as never,
        ),
      ).toThrow(BadRequestException);
      expect(libraryDocuments.graph).toHaveBeenCalledTimes(1);
    } finally {
      if (previousSandboxId === undefined) delete process.env.SANDBOX_ID;
      else process.env.SANDBOX_ID = previousSandboxId;
      if (previousLocalDev === undefined) delete process.env.MIAODA_LOCAL_DEV;
      else process.env.MIAODA_LOCAL_DEV = previousLocalDev;
    }
  });
});


// These regressions are new for the selective merge onto exact main 4f33b59.
describe('current-main bounded graph compatibility', () => {
  it('reuses the existing catalog tenant prefix exactly, including delimiter, wildcard and Unicode tenant values', () => {
    const dialect = new PgDialect();
    for (const tenantId of ['tenant:%_航', 'other:family:', 'tenant-a']) {
      const expectedPrefix = `tenant:${encodeURIComponent(tenantId)}:family:`;
      expect(tenantFamilyIdentityPrefix(tenantId)).toBe(expectedPrefix);
      const compiled = dialect.sqlToQuery(
        libraryGraphStatement({
          tenantId,
          actorUserId: 'reader-a',
          request: { level: 'versions', familyId: 'family-1' },
          after: null,
          limit: 1,
        }),
      );
      expect(compiled.sql).toContain('starts_with(f.canonical_identity_key,');
      expect(compiled.sql).not.toContain(tenantId);
      expect(compiled.params).toContain(expectedPrefix);
      expect(compiled.params).toContain(tenantId);
      expect(compiled.params).toContain(`tenant:${encodeURIComponent(tenantId)}:request:`);
    }
    expect(() => tenantFamilyIdentityPrefix('\ud800')).toThrow(
      expect.objectContaining({ code: 'TENANT_SCOPE_INVALID' }),
    );
  });

  it('preserves the existing main catalog and fleet routes alongside the graph endpoint', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CanonicalHostController.prototype.documents)).toBe('library/documents');
    expect(Reflect.getMetadata(PATH_METADATA, CanonicalHostController.prototype.fleetCatalog)).toBe('library/fleet-catalog');
    expect(Reflect.getMetadata(PATH_METADATA, CanonicalHostController.prototype.libraryGraph)).toBe('library/graph');
  });

  it('rejects a trusted identity whose app or tenant no longer matches the host actor before any graph query', () => {
    for (const drift of [{ appId: 'app-other' }, { tenantId: 'tenant-other' }]) {
      const { service, repository, fleet } = serviceTarget();
      expect(() =>
        service.graph(
          { level: 'versions', familyId: 'family-1' },
          { ...actor, ...drift },
        ),
      ).toThrow(expect.objectContaining({ code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE' }));
      expect(repository.graph).not.toHaveBeenCalled();
      expect(fleet.readLibraryCatalog).not.toHaveBeenCalled();
    }
  });
});
