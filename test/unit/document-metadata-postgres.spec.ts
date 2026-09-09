import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { MiaodaHostedDocumentCatalog } from '../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog';
import type { DocumentExtractedMetadata } from '@shared/api.interface';

const enabled = process.env.WL_DM_LIBRARY_LOCAL_PG === '1';
(enabled ? describe : describe.skip)(
  'metadata isolated PostgreSQL persistence',
  () => {
    const client = postgres({
      host: '127.0.0.1',
      port: 55439,
      database: 'postgres',
      max: 1,
    });
    const concurrentClient = postgres({
      host: '127.0.0.1',
      port: 55439,
      database: 'postgres',
      max: 1,
    });
    const catalog = new MiaodaHostedDocumentCatalog(drizzle(client) as never);
    const concurrentCatalog = new MiaodaHostedDocumentCatalog(
      drizzle(concurrentClient) as never,
    );
    const fixtureSchema = `dm_metadata_fixture_${process.pid}`;
    const sha = 'a'.repeat(64);
    const metadata: DocumentExtractedMetadata = {
      schemaVersion: 'wiselink.document_metadata.v1',
      source: 'ACTUAL_PDF_TEXT',
      sourceSha256: sha,
      sourceByteLength: 100,
      pageCount: 1,
      inspectedPages: [1],
      extractedAt: '2026-09-09T00:00:00.000Z',
      title: {
        status: 'PENDING_REVIEW',
        observations: [
          {
            value: 'Source title',
            status: 'PENDING_REVIEW',
            evidence: [{ page: 1, text: 'Subject: Source title' }],
          },
        ],
      },
      documentType: { status: 'NOT_FOUND', observations: [] },
      issuer: { status: 'NOT_FOUND', observations: [] },
      ata: { status: 'NOT_FOUND', observations: [] },
      mentionedAircraftModels: { status: 'NOT_FOUND', observations: [] },
      aircraftModelSemantics: 'DOCUMENT_MENTION_ONLY',
      applicabilityAssessment: 'NOT_EVALUATED',
    };
    beforeAll(async () => {
      await client.unsafe(`CREATE SCHEMA "${fixtureSchema}"`);
      await client.unsafe(`SET search_path TO "${fixtureSchema}", public`);
      await concurrentClient.unsafe(
        `SET search_path TO "${fixtureSchema}", public`,
      );
      await client.unsafe(`CREATE TABLE dm_document_version (
      id uuid DEFAULT gen_random_uuid(), document_version_id varchar(96) UNIQUE, document_id text, family_id text, revision_id text,
      canonical_revision_identity text, business_revision text, revision_date text, source_generated_date text, original_filename text,
      source_artifact_id text, acquisition_id text, pdf_sha256 text, byte_length bigint, media_type text, lifecycle_status text,
      committed_at timestamptz, committed_by text, _created_at timestamptz, _created_by text, _updated_at timestamptz, _updated_by text
    );
    CREATE TABLE dm_document_version_metadata (id uuid DEFAULT gen_random_uuid(),
      document_version_id varchar(96) REFERENCES dm_document_version(document_version_id), extracted_metadata jsonb NOT NULL,
      metadata_revision integer NOT NULL DEFAULT 1, request_id varchar(128),
      UNIQUE(document_version_id, metadata_revision), UNIQUE(document_version_id, request_id),
      _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, _created_by text,
      _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, _updated_by text);
    CREATE FUNCTION dm_metadata_fixture_immutable() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'immutable row'; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER dm_version_fixture_immutable BEFORE UPDATE OR DELETE ON dm_document_version FOR EACH ROW EXECUTE FUNCTION dm_metadata_fixture_immutable();
    CREATE TRIGGER dm_metadata_fixture_immutable BEFORE UPDATE OR DELETE ON dm_document_version_metadata FOR EACH ROW EXECUTE FUNCTION dm_metadata_fixture_immutable();`);
      await client`INSERT INTO dm_document_version (document_version_id,pdf_sha256,byte_length,lifecycle_status,original_filename) VALUES ('v1',${sha},100,'COMMITTED_IMMUTABLE','original.pdf')`;
    });
    afterAll(async () => {
      await concurrentClient.end();
      await client.unsafe(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await client.end();
    });

    it('fills once, returns the first observation on replay, and never mutates the original version', async () => {
      const before =
        await client`SELECT to_jsonb(v) AS snapshot FROM dm_document_version v`;
      const request = {
        documentVersionId: 'v1',
        sourceSha256: sha,
        sourceByteLength: 100,
        extractedMetadata: metadata,
      };
      await expect(
        catalog.fillMissingExtractedMetadata(request),
      ).resolves.toMatchObject({ disposition: 'ENRICHED' });
      await expect(
        catalog.fillMissingExtractedMetadata({
          ...request,
          extractedMetadata: {
            ...metadata,
            extractedAt: '2026-09-10T00:00:00.000Z',
          },
        }),
      ).resolves.toMatchObject({
        disposition: 'ALREADY_PRESENT',
        extractedMetadata: { extractedAt: metadata.extractedAt },
      });
      expect(
        await client`SELECT to_jsonb(v) AS snapshot FROM dm_document_version v`,
      ).toEqual(before);
      expect(
        (
          await client`SELECT count(*)::int AS count FROM dm_document_version_metadata`
        )[0].count,
      ).toBe(1);
      await expect(
        client`UPDATE dm_document_version SET original_filename='changed.pdf'`,
      ).rejects.toThrow('immutable row');
      await expect(
        client`UPDATE dm_document_version_metadata SET extracted_metadata='{}'`,
      ).rejects.toThrow('immutable row');
    });
    it('rejects mismatched original bytes without creating another record', async () => {
      await expect(
        catalog.fillMissingExtractedMetadata({
          documentVersionId: 'v1',
          sourceSha256: 'b'.repeat(64),
          sourceByteLength: 100,
          extractedMetadata: metadata,
        }),
      ).rejects.toThrow(
        'Document metadata does not match its immutable version',
      );
      expect(
        (
          await client`SELECT count(*)::int AS count FROM dm_document_version_metadata`
        )[0].count,
      ).toBe(1);
    });
    it('appends immutable revisions and resolves interrupted response retries without another insert', async () => {
      const before =
        await client`SELECT to_jsonb(v) AS snapshot FROM dm_document_version v`;
      const request = {
        documentVersionId: 'v1',
        sourceSha256: sha,
        sourceByteLength: 100,
        expectedMetadataRevision: 1,
        requestId: 'reextract-1',
        extractedMetadata: {
          ...metadata,
          extractedAt: '2026-09-10T00:00:00.000Z',
        },
      };
      expect(
        await catalog.readExtractedMetadata({
          documentVersionId: 'v1',
          requestId: request.requestId,
        }),
      ).toBeNull();
      await expect(
        catalog.appendExtractedMetadata(request),
      ).resolves.toMatchObject({
        disposition: 'APPENDED',
        metadata: { metadataRevision: 2, requestId: request.requestId },
      });
      await expect(
        catalog.readExtractedMetadata({ documentVersionId: 'v1', revision: 1 }),
      ).resolves.toMatchObject({
        metadataRevision: 1,
        extractedMetadata: metadata,
      });
      await expect(
        catalog.readExtractedMetadata({
          documentVersionId: 'v1',
          requestId: request.requestId,
        }),
      ).resolves.toMatchObject({ metadataRevision: 2 });
      await expect(
        catalog.appendExtractedMetadata(request),
      ).resolves.toMatchObject({
        disposition: 'IDEMPOTENT_REPLAY',
        metadata: { metadataRevision: 2 },
      });
      await expect(
        catalog.appendExtractedMetadata({
          ...request,
          expectedMetadataRevision: 2,
        }),
      ).rejects.toMatchObject({ code: 'DOCUMENT_METADATA_REQUEST_CONFLICT' });
      await expect(
        catalog.appendExtractedMetadata({
          ...request,
          requestId: 'stale-new-request',
        }),
      ).rejects.toMatchObject({ code: 'DOCUMENT_METADATA_REVISION_CONFLICT' });
      expect(
        (
          await client`SELECT count(*)::int AS count FROM dm_document_version_metadata`
        )[0].count,
      ).toBe(2);
      expect(
        await client`SELECT to_jsonb(v) AS snapshot FROM dm_document_version v`,
      ).toEqual(before);
    });
    it('serializes concurrent expected-revision appends and leaves the losing request uncommitted', async () => {
      const request = {
        documentVersionId: 'v1',
        sourceSha256: sha,
        sourceByteLength: 100,
        expectedMetadataRevision: 2,
        extractedMetadata: metadata,
      };
      const results = await Promise.allSettled([
        catalog.appendExtractedMetadata({
          ...request,
          requestId: 'concurrent-a',
        }),
        concurrentCatalog.appendExtractedMetadata({
          ...request,
          requestId: 'concurrent-b',
        }),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected).toMatchObject({
        status: 'rejected',
        reason: { code: 'DOCUMENT_METADATA_REVISION_CONFLICT' },
      });
      await expect(
        catalog.readExtractedMetadata({ documentVersionId: 'v1' }),
      ).resolves.toMatchObject({ metadataRevision: 3 });
      expect(
        (
          await client`SELECT count(*)::int AS count FROM dm_document_version_metadata`
        )[0].count,
      ).toBe(3);
    });
  },
);
