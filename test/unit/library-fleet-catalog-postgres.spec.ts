import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { CanonicalFleetMasterDataRepository } from '../../server/modules/canonical-host/canonical-fleet-master-data.repository';

(process.env.WL_DM_LIBRARY_LOCAL_PG === '1' ? describe : describe.skip)(
  'fleet catalog isolated PostgreSQL',
  () => {
    const client = postgres({
      host: '127.0.0.1',
      port: 55439,
      database: 'postgres',
      max: 1,
    });
    const repository = new CanonicalFleetMasterDataRepository(
      drizzle(client) as never,
    );
    beforeAll(async () => {
      await client.unsafe(`
      create temporary table canonical_fleet_scope_head (tenant_id text, current_source_snapshot_id text, authority_revision integer);
      create temporary table canonical_fleet_source_snapshot (tenant_id text, source_snapshot_id text, source_revision_key text, source_as_of text);
      create temporary table canonical_fleet_asset_version (tenant_id text, source_snapshot_id text, asset_id text, fleet_family text, aircraft_model text, status text, valid_from text, valid_to text);
      insert into canonical_fleet_scope_head values ('a','current',2),('b','other',1),('empty','empty',1);
      insert into canonical_fleet_source_snapshot values ('a','current','r2','2026-09-01'),('a','old','r1','2026-01-01'),('b','other','r1','2026-09-01'),('empty','empty','r1','2026-09-01');
      insert into canonical_fleet_asset_version values
        ('a','current','1','787','787-9','ACTIVE','2026-01-01',null),
        ('a','current','2','787','787-10','ACTIVE','2026-01-01',null),
        ('a','current','3','787','787-9','ACTIVE','2026-01-01',null),
        ('a','current','4','737','737-8','ACTIVE','2026-09-11',null),
        ('a','current','5','777','777-9','ACTIVE','2026-01-01','2026-09-10'),
        ('a','current','6','767','767-3','INACTIVE','2026-01-01',null),
        ('a','old','7','OLD','OLD','ACTIVE','2026-01-01',null),
        ('b','other','8','OTHER','OTHER','ACTIVE','2026-01-01',null),
        ('a','current','9',null,'UNMAPPED','ACTIVE','2026-01-01',null);
    `);
    });
    afterAll(async () => {
      await client.end();
    });
    it('selects only the current tenant snapshot and effective ACTIVE assets without guessing missing parents', async () => {
      expect(
        await repository.readLibraryCatalog({
          tenantId: 'a',
          asOf: '2026-09-10',
        }),
      ).toEqual({
        scope: 'CURRENT_TENANT_ACTIVE_FLEET',
        status: 'AVAILABLE',
        asOf: '2026-09-10',
        source: {
          sourceSnapshotId: 'current',
          sourceRevisionKey: 'r2',
          sourceAsOf: '2026-09-01',
          authorityRevision: '2',
        },
        families: [{ fleetFamily: '787', models: ['787-10', '787-9'] }],
        unclassifiedAssetCount: 1,
        semantics: 'DOCUMENT_MENTION_CLASSIFICATION_ONLY',
      });
      expect(
        await repository.readLibraryCatalog({
          tenantId: 'empty',
          asOf: '2026-09-10',
        }),
      ).toMatchObject({ status: 'AVAILABLE', families: [] });
      expect(
        await repository.readLibraryCatalog({
          tenantId: 'missing',
          asOf: '2026-09-10',
        }),
      ).toMatchObject({ status: 'MISSING', source: null, families: [] });
    });
  },
);
