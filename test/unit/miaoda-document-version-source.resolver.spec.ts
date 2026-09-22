import { drizzle } from 'drizzle-orm/postgres-js';
import {
  dmAcquisition,
  dmCurrentnessDecision,
  dmDocumentVersion,
  dmIngressPreflight,
  dmPublicationFamily,
  dmSourceArtifact,
} from '../../server/database/schema';
import { MiaodaDocumentVersionSourceResolver } from '../../server/modules/work-item/miaoda-document-version-source.resolver';

function database(value: ReturnType<typeof resolvedValue>) {
  const query = {
    innerJoin: jest.fn(),
    leftJoin: jest.fn(),
    where: jest.fn(),
    limit: jest.fn().mockResolvedValue([value]),
  };
  query.innerJoin.mockReturnValue(query);
  query.leftJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  return {
    select: jest.fn((_projection?: any) => ({ from: jest.fn(() => query) })),
    query,
  };
}

function resolvedValue() {
  return {
    version: {
      documentVersionId: 'document-version-sb',
      acquisitionId: 'acquisition-sb',
      committedBy: 'miaoda-user-1',
      lifecycleStatus: 'COMMITTED_IMMUTABLE',
      pdfSha256: 'a'.repeat(64),
      byteLength: 1024,
    },
    family: {
      familyId: 'family-sb',
      currentDocumentVersionId: 'document-version-sb',
      currentGeneration: 1,
    },
    artifact: {
      readbackVerified: true,
      sha256: 'a'.repeat(64),
      byteLength: 1024,
    },
    acquisition: {
      acquisitionId: 'acquisition-sb',
      acquiredBy: 'miaoda-user-1',
    },
    preflight: {
      normalizedDescriptorJson: JSON.stringify({
        adapterRelease: {
          adapterId: 'issuer.boeing.service_bulletin.v1',
          adapterVersion: 'v8.4-document-family-adapter.v1',
        },
      }),
    },
    currentness: {
      familyId: 'family-sb',
      nextDocumentVersionId: 'document-version-sb',
      nextGeneration: 1,
    },
  };
}

describe('MiaodaDocumentVersionSourceResolver currentness', () => {
  it('fresh-reads source identity and matching authoritative current head', async () => {
    const { select, query } = database(resolvedValue());
    const resolver = new MiaodaDocumentVersionSourceResolver({
      select,
    } as never);

    await expect(
      resolver.resolve('document-version-sb', { requireCurrent: true }),
    ).resolves.toMatchObject({
      family: { currentDocumentVersionId: 'document-version-sb' },
      currentness: { nextGeneration: 1 },
    });
    expect(query.innerJoin).toHaveBeenCalledTimes(4);
    expect(query.leftJoin).toHaveBeenCalledWith(
      dmCurrentnessDecision,
      expect.anything(),
    );
    expect(select).toHaveBeenCalledWith({
      version: dmDocumentVersion,
      family: dmPublicationFamily,
      artifact: dmSourceArtifact,
      acquisition: dmAcquisition,
      preflight: dmIngressPreflight,
      currentness: dmCurrentnessDecision,
    });
  });

  it('rejects a current DocumentVersion not acquired and committed by the mapped session user', async () => {
    const { select } = database(resolvedValue());
    const resolver = new MiaodaDocumentVersionSourceResolver({
      select,
    } as never);
    await expect(
      resolver.resolve('document-version-sb', {
        requireCurrent: true,
        expectedCreatorUserId: 'different-miaoda-user',
      }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_VERSION_NOT_FOUND' });
  });

  it('rejects a committed version that is no longer the family current head', async () => {
    const value = resolvedValue();
    value.family.currentDocumentVersionId = 'document-version-newer';
    const { select } = database(value);
    const resolver = new MiaodaDocumentVersionSourceResolver({
      select,
    } as never);

    await expect(
      resolver.resolve('document-version-sb', { requireCurrent: true }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_VERSION_NOT_CURRENT' });
  });

  it('rejects a head without the matching currentness decision readback', async () => {
    const value = { ...resolvedValue(), currentness: null };
    const { select } = database(value as never);
    const resolver = new MiaodaDocumentVersionSourceResolver({
      select,
    } as never);

    await expect(
      resolver.resolve('document-version-sb', { requireCurrent: true }),
    ).rejects.toMatchObject({
      code: 'DOCUMENT_VERSION_CURRENTNESS_UNVERIFIED',
    });
  });
});


describe('member source identity projection', () => {
  it('retains required registration joins while returning only validated document ids', async () => {
    const value = resolvedValue();
    Object.assign(value.version, { documentId: 'document-sb' });
    const db = database(value);
    const resolver = new MiaodaDocumentVersionSourceResolver(db as never);
    await expect(resolver.resolveIdentity('document-version-sb')).resolves.toEqual({ version: { documentId: 'document-sb', documentVersionId: 'document-version-sb' } });
    expect(db.query.innerJoin.mock.calls.map(call => call[0])).toEqual([dmPublicationFamily, dmSourceArtifact, dmAcquisition, dmIngressPreflight]);
    expect(db.query.leftJoin).not.toHaveBeenCalled();
    const projection = db.select.mock.calls[0][0];
    expect(Object.keys(projection)).toEqual(['version', 'artifact']);
    expect(Object.keys(projection.version)).toHaveLength(5);
    expect(Object.keys(projection.artifact)).toHaveLength(3);
  });

  it('compiles a narrow SQL projection with the exact committed preflight binding', async () => {
    const builder = drizzle({} as never);
    let compiled: { sql: string; params: unknown[] } | undefined;
    const db = { select: (fields: never) => ({ from: (table: never) => {
      const statement = builder.select(fields).from(table);
      const limit = statement.limit.bind(statement);
      jest.spyOn(statement, 'limit').mockImplementation((count: number) => {
        compiled = limit(count).toSQL();
        return Promise.resolve([resolvedValue()]) as never;
      });
      return statement;
    } }) };
    await new MiaodaDocumentVersionSourceResolver(db as never).resolveIdentity('exact-dv');
    expect(compiled?.params).toEqual(['COMMITTED', 'exact-dv', 1]);
    expect(compiled?.sql.match(/inner join/g)).toHaveLength(4);
    expect(compiled?.sql).toContain('"dm_ingress_preflight"."acquisition_id" = "dm_acquisition"."acquisition_id"');
    expect(compiled?.sql).toContain('"dm_ingress_preflight"."document_version_id" = "dm_document_version"."document_version_id"');
    expect(compiled?.sql).not.toContain('normalized_descriptor_json');
    expect(compiled?.sql).not.toContain('dm_currentness_decision');
  });

  it.each(['lifecycle', 'verified', 'digest', 'length'])('preserves the %s source rejection in both paths', async (reason) => {
    const value = resolvedValue();
    if (reason === 'lifecycle') value.version.lifecycleStatus = 'DRAFT';
    if (reason === 'verified') value.artifact.readbackVerified = false;
    if (reason === 'digest') value.artifact.sha256 = 'different';
    if (reason === 'length') value.artifact.byteLength = 2048;
    const resolver = new MiaodaDocumentVersionSourceResolver(database(value) as never);
    await expect(resolver.resolveIdentity('document-version-sb')).rejects.toThrow('DOCUMENT_VERSION_SOURCE_IDENTITY_INVALID');
    await expect(resolver.resolve('document-version-sb')).rejects.toThrow('DOCUMENT_VERSION_SOURCE_IDENTITY_INVALID');
  });

  it('rejects missing joined registration instead of returning a partial identity', async () => {
    const db = database(resolvedValue());
    db.query.limit.mockResolvedValue([]);
    const resolver = new MiaodaDocumentVersionSourceResolver(db as never);
    await expect(resolver.resolveIdentity('missing')).rejects.toThrow('DOCUMENT_VERSION_NOT_FOUND');
  });
});
