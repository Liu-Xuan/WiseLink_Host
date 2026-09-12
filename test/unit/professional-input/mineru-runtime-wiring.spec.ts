import { DocumentParsingHostedService } from '../../../server/modules/document-management/src/hosted/nest/document-parsing-hosted.service';
describe('Official document plugin wiring', () => {
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
    const plugins = { configured: jest.fn(() => false) };
    const service = new DocumentParsingHostedService(files as never, catalog as never, repository as never, plugins as never, {} as never, authorizer as never);
    return { service, events, files, repository, plugins };
  }
  const context = { actorUserId: 'actor', tenantId: 'tenant', roles: [] };

  it('does not start a deployment download when document access is denied', async () => {
    const { service, files, events } = setup(false);
    await expect(service.status('version', context)).rejects.toThrow('READ_DENIED');
    expect(events).toEqual(['authorize']);
    expect(files.from).not.toHaveBeenCalled();
  });

  it('reports a clear configuration state and does not reserve a parse until the official plugin is configured', async () => {
    const { service, events, repository } = setup(true);
    const result = await service.status('version', context);
    expect(events).toEqual(['authorize', 'source']);
    expect(result).toMatchObject({ runtimeAvailable: false, runtime: { state: 'NOT_CONFIGURED', errorCode: 'DOCUMENT_PLUGIN_NOT_CONFIGURED' } });
    await expect(service.start('version', { requestId: 'runtime-check-1', expectedPublishedRevision: 0 }, context))
      .rejects.toMatchObject({ code: 'DOCUMENT_PLUGIN_NOT_CONFIGURED' });
    expect(repository.reserve).not.toHaveBeenCalled();
  });
});
