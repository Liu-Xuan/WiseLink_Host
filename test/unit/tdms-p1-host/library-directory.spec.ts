import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { CanonicalHostActor } from '@server/modules/canonical-host/canonical-host.types';
import { CanonicalHostController } from '@server/modules/canonical-host/canonical-host.controller';
import { CanonicalLibraryService } from '@server/modules/canonical-host/canonical-library.service';
import {
  canonicalLibraryDirectoryStatement,
  type OwnedCanonicalLibraryDirectoryQuery,
} from '@server/modules/canonical-host/canonical-library-directory.query';
import { listOwnedLibraryFamilies } from '@server/modules/document-management/src/hosted/nest/miaoda-hosted-library-query';
import { syntheticMiaodaActorFixture } from '../../fixtures/synthetic-development-canonical-object-access.adapter';
import { libraryFamily } from '../fixtures/canonical-library';

const identity = syntheticMiaodaActorFixture(
  'synthetic-reader',
  'synthetic-tenant',
);
identity.env = 'preview';
identity.subjectDecision.version = 'miaoda-hosted-native-sso.v1';
const actor: CanonicalHostActor = {
  userId: 'synthetic-reader',
  tenantId: 'synthetic-tenant',
  appId: identity.applicationScopeId,
  env: 'preview',
  roles: [],
  objectAccessActor: identity,
};
const scope = {
  tenantId: actor.tenantId,
  actorUserId: actor.userId,
  search: '',
};

function fixture() {
  const directory = jest.fn(
    async (query: OwnedCanonicalLibraryDirectoryQuery) => ({
      scope: 'TENANT_DOCUMENT_CATALOG',
      level: query.ata2
        ? 'ATA4'
        : query.aircraftModel
          ? 'ATA2'
          : 'AIRCRAFT_MODEL',
      documentCount: 2,
      versionCount: 3,
      directDocumentCount: 1,
      directVersionCount: 1,
      nodes: [],
    }),
  );
  const repository = {
    directory,
    listDocuments: jest.fn().mockResolvedValue([
      {
        totalCount: 2,
        familyCounts: { SB: 2 },
        ataCounts: {},
        aircraftModelCounts: {},
        rows: [libraryFamily('family-b'), libraryFamily('family-a')],
      },
    ]),
  };
  const fleet = {
    readLibraryCatalog: jest.fn().mockResolvedValue({
      status: 'AVAILABLE',
      asOf: '2026-10-14',
      source: { sourceSnapshotId: 'synthetic-fleet', authorityRevision: '1' },
      families: [{ fleetFamily: '787', models: ['787-9', '787-10'] }],
    }),
  };
  const authorize = jest.fn();
  const freshRead = jest.fn();
  return {
    repository,
    fleet,
    authorize,
    freshRead,
    service: new CanonicalLibraryService(
      repository as never,
      { authorize } as never,
      { freshRead } as never,
      undefined,
      fleet as never,
    ),
  };
}

describe('formal TDMS P1 directory integration (synthetic, no business membership claim)', () => {
  it('exposes the actual GET route and intersects fleet, model and ATA consistently with leaf lists', async () => {
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        CanonicalHostController.prototype.directory,
      ),
    ).toBe('library/directory');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        CanonicalHostController.prototype.directory,
      ),
    ).toBe(RequestMethod.GET);
    const f = fixture();
    expect(await f.service.directory({}, actor)).toMatchObject({
      level: 'AIRCRAFT_MODEL',
    });
    expect(
      await f.service.directory({ aircraftModel: ' 787-9 ' }, actor),
    ).toMatchObject({ level: 'ATA2' });
    const selection = {
      fleetFamily: ' 787 ',
      fleetModel: '787-9',
      aircraftModel: ' 787-9 ',
      ata2: '27',
    };
    expect(await f.service.directory(selection, actor)).toMatchObject({
      level: 'ATA4',
      documentCount: 2,
      versionCount: 3,
    });
    await f.service.list({ ...selection, ata4: '__DIRECT__' }, actor);
    const directoryQuery = f.repository.directory.mock.calls[2]![0];
    const leafQuery = f.repository.listDocuments.mock.calls[0]![0];
    expect(directoryQuery).toEqual({
      ...scope,
      normalizedFamily: '',
      aircraftModel: '787-9',
      ata2: '27',
      fleetMentionValues: ['787-9', 'B787-9'],
    });
    expect(leafQuery).toMatchObject({ ...directoryQuery, ata4: '__DIRECT__' });
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.freshRead).not.toHaveBeenCalled();
  });

  it('checks verified identity before catalog/SQL and does not convert an unavailable fleet into an all-documents read', async () => {
    const f = fixture();
    await expect(
      f.service.directory(
        { fleetFamily: '787' },
        { ...actor, tenantId: 'foreign' },
      ),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(f.repository.directory).not.toHaveBeenCalled();
    expect(f.fleet.readLibraryCatalog).not.toHaveBeenCalled();
    f.fleet.readLibraryCatalog.mockResolvedValue({
      status: 'MISSING',
      families: [],
      source: null,
    });
    await expect(
      f.service.directory(
        { fleetFamily: '787', aircraftModel: '787-9' },
        actor,
      ),
    ).rejects.toMatchObject({
      response: { code: 'LIBRARY_FLEET_CATALOG_MISSING' },
    });
    expect(f.repository.directory).not.toHaveBeenCalled();
  });

  it('binds a leaf cursor to its ATA2, ATA4, current fleet revision and model scope', async () => {
    const f = fixture();
    const selection = {
      fleetFamily: '787',
      aircraftModel: '787-9',
      ata2: '27',
      ata4: '27-11',
      limit: 1,
    };
    const first = await f.service.list(selection, actor);
    expect(first.nextCursor).not.toBeNull();
    await f.service.list({ ...selection, cursor: first.nextCursor! }, actor);
    for (const changed of [
      { ata2: '34' },
      { ata4: '27-21' },
      { aircraftModel: '787-10' },
    ])
      await expect(
        f.service.list(
          { ...selection, ...changed, cursor: first.nextCursor! },
          actor,
        ),
      ).rejects.toThrow('LIBRARY_CURSOR_INVALID');
    f.fleet.readLibraryCatalog.mockResolvedValue({
      status: 'AVAILABLE',
      asOf: '2026-10-14',
      source: { sourceSnapshotId: 'synthetic-fleet-2', authorityRevision: '2' },
      families: [{ fleetFamily: '787', models: ['787-9'] }],
    });
    await expect(
      f.service.list({ ...selection, cursor: first.nextCursor! }, actor),
    ).rejects.toThrow('LIBRARY_CURSOR_INVALID');
    expect(f.repository.listDocuments).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed node scope before SQL and keeps direct documents distinct from missing classification', async () => {
    const f = fixture();
    for (const query of [
      { ata2: '27-11' },
      { ata2: 'x'.repeat(97) },
      { ata2: ['27'] as never },
    ])
      await expect(f.service.directory(query, actor)).rejects.toThrow(
        'LIBRARY_FILTER_INVALID',
      );
    for (const query of [
      { ata4: '__DIRECT__' },
      { ata2: '__UNKNOWN__', ata4: '__DIRECT__' },
      { ata4: '27*' },
    ])
      await expect(f.service.list(query, actor)).rejects.toThrow(
        'LIBRARY_FILTER_INVALID',
      );
    expect(f.repository.directory).not.toHaveBeenCalled();
    expect(f.repository.listDocuments).not.toHaveBeenCalled();
  });

  it('binds every tenant/filter value and independently aggregates full-family counts without source bodies or parsing', () => {
    const hostile = "MODEL' OR TRUE --";
    const statement = new PgDialect().sqlToQuery(
      canonicalLibraryDirectoryStatement({
        ...scope,
        aircraftModel: hostile,
        ata2: '27',
        search: 'literal%_',
        fleetMentionValues: ['B787-9'],
      }),
    );
    expect(statement.sql).not.toContain(hostile);
    expect(statement.params).toContain(hostile);
    expect(statement.params).toContain('%literal\\%\\_%');
    expect(statement.params).toContain('synthetic-tenant');
    expect(statement.params).not.toContain('synthetic-reader');
    expect(statement.sql).toContain(
      'v.document_version_id=f.current_document_version_id',
    );
    expect(statement.sql).toContain('filter(where is_current)');
    expect(statement.sql).toContain('count(distinct document_version_id)');
    expect(statement.sql).toContain('group by value,family_id');
    expect(statement.sql).toContain('count(*)::integer from filtered');
    // PG's polymorphic jsonb_build_object cannot infer an untyped bound string.
    expect(statement.sql).toMatch(/\$[0-9]+::text as level/u);
    expect(statement.sql).toMatch(/jsonb_build_object\('level',\$[0-9]+::text/u);
    for (const forbidden of [
      'projection_json',
      'dm_document_parse_run',
      'dm_document_reading_run',
      'content',
      'order by committed_at',
    ])
      expect(statement.sql).not.toContain(forbidden);
  });

  it('places rich-list current classification and exact ATA/model node matching before family seek pagination', () => {
    const query = listOwnedLibraryFamilies(drizzle.mock(), {
      ...scope,
      normalizedFamily: 'SB',
      ata2: '27',
      ata4: '27-11',
      aircraftModel: '787-9',
      cursor: null,
      limit: 1,
    }).toSQL();
    expect(query.sql).toContain('filter(where "is_current")');
    expect(query.sql).toContain('node.ata2=');
    expect(query.sql).toContain('node.ata4=');
    expect(query.sql).toContain('btrim(mention.value)=');
    expect(query.sql.indexOf('node.ata2=')).toBeLessThan(
      query.sql.indexOf('"library_family_page" as'),
    );
    expect(query.params).toContain('27');
    expect(query.params).toContain('27-11');
    expect(query.params).toContain('787-9');
    expect(query.params.at(-1)).toBe(2);
  });
});
