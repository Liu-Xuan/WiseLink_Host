import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { listOwnedLibraryFamilies } from '../../server/modules/document-management/src/hosted/nest/miaoda-hosted-library-query';
import { MiaodaHostedDocumentCatalog } from '../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog';

const enabled = process.env.WL_DM_LIBRARY_LOCAL_PG === '1';
(enabled ? describe : describe.skip)(
  'document library isolated PostgreSQL',
  () => {
    const client = postgres({
      host: '127.0.0.1',
      port: 55439,
      database: 'postgres',
      max: 1,
    });
    const db = drizzle(client);
    const scope = {
      tenantId: 't1',
      actorUserId: 'u1',
      search: '',
      cursor: null,
      limit: 1,
    };
    beforeAll(async () => {
      await client.unsafe(`create temporary table work_item (document_id text,document_version_id text,work_item_id text,tenant_id text,requested_by_user_id text,package_id text,package_artifact_ref text,created_at timestamptz);
      create temporary table dm_document (document_id text,family_id text);
      create temporary table dm_publication_family (family_id text,canonical_document_number text,document_family text,issuer_authority text,created_at timestamptz,updated_at timestamptz,canonical_identity_key text,current_document_version_id text);
      create temporary table dm_document_version (document_version_id text,document_id text,family_id text,source_artifact_id text,business_revision text,revision_date text,source_generated_date text,original_filename text,byte_length int,committed_at timestamptz);
      create temporary table dm_document_version_metadata (document_version_id text,extracted_metadata jsonb);
      create temporary table dm_acquisition (document_version_id text,source_artifact_id text,acquired_by text,status text,idempotency_key text);`);
      for (const id of [
        'a',
        'b',
        'hidden',
        'cross',
        'mismatch',
        'pending',
        'scope',
      ]) {
        await client`insert into dm_document values (${id},${id})`;
        await client`insert into dm_publication_family values (${id},${id},'SB','BOEING','2026-09-01','2026-09-01',${`tenant:${id === 'cross' ? 't2' : 't1'}:family:${id}`},${id})`;
        await client`insert into dm_document_version values (${id},${id},${id},'shared-source','R1','','',${`${id}.pdf`},100,'2026-09-01')`;
        await client`insert into dm_acquisition values (${id},${id === 'mismatch' ? 'wrong-source' : 'shared-source'},${id === 'hidden' ? 'u2' : 'u1'},${id === 'pending' ? 'ACQUIRED_READBACK_VERIFIED' : 'COMMITTED_CANONICAL'},${`tenant:${id === 'scope' ? 't2' : 't1'}:request:${id}`})`;
      }
      await client`insert into dm_document_version_metadata values ('a', ${JSON.stringify({ ata: { observations: [{ value: '34' }, { value: '34' }] }, mentionedAircraftModels: { observations: [{ value: '787' }] }, title: { observations: [{ value: 'Flight navigation' }] } })})`;
    });
    afterAll(async () => {
      await client.end();
    });
    it('reads acquisition-only versions, paginates and counts without exposing reused-source outsiders', async () => {
      const [first] = await listOwnedLibraryFamilies(db as never, scope);
      expect(first.totalCount).toBe(2);
      expect(first.rows.map((row) => row.familyId)).toEqual(['b', 'a']);
      expect(
        first.rows.every(
          (row) =>
            row.versions[0].readerWorkItemId === '' && row.workItemCount === 0,
        ),
      ).toBe(true);
      expect(first.familyCounts).toEqual({ SB: 2 });
      expect(first.ataCounts).toEqual({ '34': 1, __UNKNOWN__: 1 });
      expect(first.aircraftModelCounts).toEqual({ '787': 1, __UNKNOWN__: 1 });
      const [next] = await listOwnedLibraryFamilies(db as never, {
        ...scope,
        cursor: {
          createdAt: new Date(first.rows[0].createdAt).toISOString(),
          itemId: 'b',
        },
      });
      expect(next.rows.map((row) => row.familyId)).toEqual(['a']);
      expect(next.totalCount).toBe(2);
    });
    it('filters and searches metadata across the full authorized result', async () => {
      const [filtered] = await listOwnedLibraryFamilies(db as never, {
        ...scope,
        ata: '34',
        aircraftModel: '787',
      });
      expect(filtered.totalCount).toBe(1);
      expect(filtered.rows[0].familyId).toBe('a');
      const [searched] = await listOwnedLibraryFamilies(db as never, {
        ...scope,
        search: 'navigation',
      });
      expect(searched.totalCount).toBe(1);
      const [unknown] = await listOwnedLibraryFamilies(db as never, {
        ...scope,
        ata: '__UNKNOWN__',
      });
      expect(unknown.rows[0].familyId).toBe('b');
      const [empty] = await listOwnedLibraryFamilies(db as never, {
        ...scope,
        search: 'absent',
      });
      expect(empty).toMatchObject({ rows: [], totalCount: 0, ataCounts: {} });
    });
    it('keeps authorized history under a matching family and never adds an unowned version', async () => {
      await client`insert into dm_document_version values ('a-old','a','a','old-source','R0','','','old.pdf',90,'2026-08-01'), ('a-private','a','a','private-source','R2','','','private.pdf',110,'2026-09-02')`;
      await client`insert into dm_acquisition values ('a-old','old-source','u1','LINKED_EXACT_DOCUMENT_VERSION','tenant:t1:request:old')`;
      const [result] = await listOwnedLibraryFamilies(db as never, {
        ...scope,
        search: 'navigation',
      });
      expect(
        result.rows[0].versions.map((version) => version.documentVersionId),
      ).toEqual(['a', 'a-old']);
      const catalog = new MiaodaHostedDocumentCatalog(db as never);
      expect(
        await catalog.readOwnedAcquisitionVersionBinding({
          ...scope,
          documentVersionId: 'a-old',
        }),
      ).toBe(true);
      expect(
        await catalog.readOwnedAcquisitionVersionBinding({
          ...scope,
          documentVersionId: 'a-private',
        }),
      ).toBe(false);
      await client`delete from dm_document_version where document_version_id in ('a-old','a-private')`;
      await client`delete from dm_acquisition where document_version_id='a-old'`;
    });

    it('uses the same exact acquisition ownership for DOCUMENT_READ', async () => {
      const catalog = new MiaodaHostedDocumentCatalog(db as never);
      for (const documentVersionId of ['a', 'b'])
        expect(
          await catalog.readOwnedAcquisitionVersionBinding({
            ...scope,
            documentVersionId,
          }),
        ).toBe(true);
      for (const documentVersionId of [
        'hidden',
        'cross',
        'mismatch',
        'pending',
        'scope',
      ])
        expect(
          await catalog.readOwnedAcquisitionVersionBinding({
            ...scope,
            documentVersionId,
          }),
        ).toBe(false);
      expect(
        await catalog.readOwnedAcquisitionVersionBinding({
          ...scope,
          documentVersionId: 'a',
          actorUserId: 'u2',
        }),
      ).toBe(false);
    });
  },
);
