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
    select: jest.fn(() => ({ from: jest.fn(() => query) })),
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
