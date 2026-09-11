import { DocumentParsingHostedService } from '../../../server/modules/document-management/src/hosted/nest/document-parsing-hosted.service';
import { MineruHostedRuntime } from '../../../server/modules/professional-input/mineru/mineru-hosted-runtime';

describe('MinerU authorized runtime preparation', () => {
  afterEach(() => jest.restoreAllMocks());

  function setup(allowed: boolean) {
    const events: string[] = [];
    const files = { from: jest.fn() };
    const authorizer = { assertCanRead: jest.fn(async () => {
      events.push('authorize');
      if (!allowed) throw new Error('READ_DENIED');
    }) };
    const catalog = { readMetadataSource: jest.fn(async () => {
      events.push('source');
      return { version: { originalFilename: 'source.pdf' }, source: {} };
    }) };
    const repository = { current: jest.fn(async () => ({ latest: null, published: null })),
      readRequest: jest.fn(async () => null), reserve: jest.fn() };
    const observe = jest.spyOn(MineruHostedRuntime.prototype, 'observe').mockImplementation(() => {
      events.push('prepare');
      return { state: 'PREPARING', stage: 'FILES', verifiedFiles: 4, totalFiles: 55, errorCode: null };
    });
    const service = new DocumentParsingHostedService(files as never, catalog as never, repository as never, {} as never, authorizer as never);
    return { service, events, files, repository, observe };
  }
  const context = { actorUserId: 'actor', tenantId: 'tenant', roles: [] };

  it('does not start a deployment download when document access is denied', async () => {
    const { service, observe, files, events } = setup(false);
    await expect(service.status('version', context)).rejects.toThrow('READ_DENIED');
    expect(events).toEqual(['authorize']);
    expect(observe).not.toHaveBeenCalled();
    expect(files.from).not.toHaveBeenCalled();
  });

  it('returns preparation progress after authorization and does not reserve a parse until ready', async () => {
    const { service, events, repository } = setup(true);
    const result = await service.status('version', context);
    expect(events).toEqual(['authorize', 'source', 'prepare']);
    expect(result).toMatchObject({ runtimeAvailable: false, runtime: { state: 'PREPARING', verifiedFiles: 4, totalFiles: 55 } });
    await expect(service.start('version', { requestId: 'runtime-check-1', expectedPublishedRevision: 0 }, context))
      .rejects.toMatchObject({ code: 'DOCUMENT_PARSE_RUNTIME_UNAVAILABLE' });
    expect(repository.reserve).not.toHaveBeenCalled();
  });
});
