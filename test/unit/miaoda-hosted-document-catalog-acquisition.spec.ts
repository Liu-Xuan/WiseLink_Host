import { PgDialect } from 'drizzle-orm/pg-core';

import {
  dmAcquisition,
  dmPublicationFamily,
  dmSourceArtifact,
} from '@server/database/schema';

import { MiaodaHostedDocumentCatalog } from '../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog';

interface CatalogState {
  artifacts: Array<Record<string, unknown>>;
  acquisitions: Array<Record<string, unknown>>;
  operations: string[];
}

interface RecordAcquisitionInput {
  sourceArtifact: {
    sourceArtifactId: string;
    sha256: string;
    byteLength: number;
    mediaType: string;
    bucketId: string;
    filePath: string;
    providerObjectId: string;
    providerVersionId: string;
    readbackVerified: boolean;
    createdAt: string;
  };
  acquisition: {
    acquisitionId: string;
    sourceArtifactId: string;
    sourceChannel: string;
    sourceRef: string;
    selectionBucketId: string;
    selectionFilePath: string;
    providerObjectId: string;
    providerVersionId: string;
    acquiredBy: string;
    acquiredAt: string;
    idempotencyKey: string;
    sourceDescriptor: Record<string, unknown>;
  };
}

describe('MiaodaHostedDocumentCatalog acquisition boundary', () => {
  it('registers and reads back source plus acquisition in one short transaction', async () => {
    const fixture = catalogDatabase();
    const catalog = new MiaodaHostedDocumentCatalog(fixture.db as never);

    await expect(
      catalog.recordAcquisition(recordAcquisitionInput()),
    ).resolves.toMatchObject({
      acquisitionId: 'ACQUISITION-1',
      sourceArtifactId: 'SOURCE-1',
      sourceDescriptor: { originalFilename: 'source.pdf' },
    });

    expect(fixture.db.transaction).toHaveBeenCalledTimes(1);
    expect(fixture.state.operations).toEqual([
      'insert-source-artifact',
      'read-source-artifact',
      'insert-acquisition',
      'read-acquisition',
    ]);
    expect(fixture.state.artifacts).toHaveLength(1);
    expect(fixture.state.acquisitions).toHaveLength(1);
  });

  it('rolls back source registration when acquisition registration fails', async () => {
    const fixture = catalogDatabase({ failAcquisitionInsert: true });
    const catalog = new MiaodaHostedDocumentCatalog(fixture.db as never);

    await expect(
      catalog.recordAcquisition(recordAcquisitionInput()),
    ).rejects.toThrow('ACQUISITION_INSERT_FAILED');

    expect(fixture.db.transaction).toHaveBeenCalledTimes(1);
    expect(fixture.state.artifacts).toHaveLength(0);
    expect(fixture.state.acquisitions).toHaveLength(0);
  });

  it('rejects a replay when the acquisition route identity drifted', async () => {
    const fixture = catalogDatabase();
    const catalog = new MiaodaHostedDocumentCatalog(fixture.db as never);
    const original = recordAcquisitionInput();
    await catalog.recordAcquisition(original);

    const conflicting = recordAcquisitionInput();
    conflicting.acquisition.sourceRef = 'upload:different-source.pdf';
    conflicting.acquisition.sourceDescriptor = {
      originalFilename: 'different-source.pdf',
    };

    await expect(catalog.recordAcquisition(conflicting)).rejects.toMatchObject({
      code: 'ACQUISITION_IDEMPOTENCY_CONFLICT',
    });
    expect(fixture.state.artifacts).toHaveLength(1);
    expect(fixture.state.acquisitions).toHaveLength(1);
    expect(fixture.state.acquisitions[0]).toMatchObject({
      sourceRef: 'upload:source.pdf',
    });
  });

  it('returns an identical concurrently linked acquisition for complete-lineage replay', async () => {
    const fixture = catalogDatabase();
    const catalog = new MiaodaHostedDocumentCatalog(fixture.db as never);
    const input = recordAcquisitionInput();
    await catalog.recordAcquisition(input);
    Object.assign(fixture.state.acquisitions[0]!, {
      status: 'COMMITTED_CANONICAL',
      documentVersionId: 'DV-COMMITTED-1',
    });
    await expect(catalog.recordAcquisition(input)).resolves.toMatchObject({
      status: 'COMMITTED_CANONICAL',
      documentVersionId: 'DV-COMMITTED-1',
    });
    expect(fixture.state.acquisitions).toHaveLength(1);
    expect(fixture.state.artifacts).toHaveLength(1);
  });
});

describe('MiaodaHostedDocumentCatalog tenant-scoped listing', () => {
  it('pushes the exact encoded tenant prefix into the database query', async () => {
    let condition: unknown = null;
    const where = jest.fn(async (value: unknown) => {
      condition = value;
      return [];
    });
    const db = {
      select: jest.fn(() => ({
        from: () => ({
          innerJoin: () => ({ where }),
        }),
      })),
    };
    const catalog = new MiaodaHostedDocumentCatalog(db as never);

    await expect(
      catalog.listIngressDocuments({ tenantId: '租户_1' }),
    ).resolves.toEqual([]);

    expect(where).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(condition as never);
    expect(query.sql).toContain('starts_with');
    expect(query.sql).toContain(dmPublicationFamily.canonicalIdentityKey.name);
    expect(query.params).toEqual(['tenant:%E7%A7%9F%E6%88%B7_1:family:']);
  });
});

function recordAcquisitionInput(): RecordAcquisitionInput {
  return {
    sourceArtifact: {
      sourceArtifactId: 'SOURCE-1',
      sha256: 'a'.repeat(64),
      byteLength: 1024,
      mediaType: 'application/pdf',
      bucketId: 'bucket-1',
      filePath: 'immutable/source.pdf',
      providerObjectId: 'provider-object-1',
      providerVersionId: 'provider-version-1',
      readbackVerified: true,
      createdAt: '2026-09-06T00:00:00.000Z',
    },
    acquisition: {
      acquisitionId: 'ACQUISITION-1',
      sourceArtifactId: 'SOURCE-1',
      sourceChannel: 'upload',
      sourceRef: 'upload:source.pdf',
      selectionBucketId: 'selection-bucket-1',
      selectionFilePath: 'source.pdf',
      providerObjectId: 'selection-object-1',
      providerVersionId: 'selection-version-1',
      acquiredBy: 'engineer-1',
      acquiredAt: '2026-09-06T00:00:00.000Z',
      idempotencyKey: 'ACQUISITION-IDEMPOTENCY-1',
      sourceDescriptor: { originalFilename: 'source.pdf' },
    },
  };
}

function catalogDatabase(options: { failAcquisitionInsert?: boolean } = {}): {
  db: { transaction: jest.Mock };
  state: CatalogState;
} {
  const state: CatalogState = {
    artifacts: [],
    acquisitions: [],
    operations: [],
  };
  const transaction = {
    insert: jest.fn((table: unknown) => ({
      values: (value: Record<string, unknown>) => ({
        onConflictDoNothing: async () => {
          if (table === dmSourceArtifact) {
            state.operations.push('insert-source-artifact');
            const existing = state.artifacts.find(
              (row: Record<string, unknown>) =>
                row.sourceArtifactId === value.sourceArtifactId,
            );
            if (!existing) state.artifacts.push({ ...value });
            return;
          }
          if (table === dmAcquisition) {
            state.operations.push('insert-acquisition');
            if (options.failAcquisitionInsert) {
              throw new Error('ACQUISITION_INSERT_FAILED');
            }
            const existing = state.acquisitions.find(
              (row: Record<string, unknown>) =>
                row.idempotencyKey === value.idempotencyKey,
            );
            if (!existing) {
              state.acquisitions.push({
                ...value,
                documentVersionId: null,
              });
            }
          }
        },
      }),
    })),
    select: jest.fn(() => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async (limit: number) => {
            if (table === dmSourceArtifact) {
              state.operations.push('read-source-artifact');
              return state.artifacts.slice(0, limit);
            }
            state.operations.push('read-acquisition');
            return state.acquisitions.slice(0, limit);
          },
        }),
      }),
    })),
  };
  const db = {
    transaction: jest.fn(
      async (callback: (executor: typeof transaction) => Promise<unknown>) => {
        const artifactSnapshot = state.artifacts.map(
          (row: Record<string, unknown>) => ({ ...row }),
        );
        const acquisitionSnapshot = state.acquisitions.map(
          (row: Record<string, unknown>) => ({ ...row }),
        );
        try {
          return await callback(transaction);
        } catch (error) {
          state.artifacts.splice(
            0,
            state.artifacts.length,
            ...artifactSnapshot,
          );
          state.acquisitions.splice(
            0,
            state.acquisitions.length,
            ...acquisitionSnapshot,
          );
          throw error;
        }
      },
    ),
  };
  return { db, state };
}
