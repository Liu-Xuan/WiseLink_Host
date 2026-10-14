import 'reflect-metadata';
import { CanonicalHostController } from '../../server/modules/canonical-host/canonical-host.controller';
import { libraryCatalogueQuery, LIBRARY_CATALOG_PAGED_QUERY_BUDGET } from '@shared/library-aircraft-mentions';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const decorator = () => () => undefined;
  return { ...actual, Body: decorator, Controller: decorator, Get: decorator, Param: decorator,
    Post: decorator, Query: decorator, Req: decorator };
});
jest.mock('@lark-apaas/fullstack-nestjs-core', () => ({
  ...jest.requireActual('@lark-apaas/fullstack-nestjs-core'), NeedLogin: () => () => undefined,
}));

function target(originalUrl: string) {
  const library = { list: jest.fn().mockResolvedValue({}), directory: jest.fn().mockResolvedValue({}) };
  const controller = new CanonicalHostController({} as never, {} as never, {} as never, {} as never,
    {} as never, undefined, library as never);
  const request = { originalUrl, userContext: { userId: 'synthetic-reader', tenantId: 'synthetic-tenant',
    appId: 'app_17bzc551rsg', roles: [], env: 'preview' } };
  return { controller, library, request };
}

it('wires the same exact union and ATA layout through the two existing GET consumers without replacing actor scope', async () => {
  // Test-only hosted provenance, as in the existing controller harness; no local gateway-auth claim.
  const previousSandbox = process.env.SANDBOX_ID;
  const previousLocal = process.env.MIAODA_LOCAL_DEV;
  process.env.SANDBOX_ID = 'unit-hosted-sandbox'; delete process.env.MIAODA_LOCAL_DEV;
  try {
    const aircraftModels = ['737-800', '737-600'];
    const h = target(`/api/canonical-host/library/documents?${libraryCatalogueQuery({ aircraftModels, ata2: '27', ata4: '27-11' })}`);
    await h.controller.documents('number', undefined, '1', h.request as never, undefined, undefined,
      undefined, undefined, undefined, '27', '27-11', JSON.stringify(aircraftModels));
    expect(h.library.list).toHaveBeenCalledWith(expect.objectContaining({ search: 'number', limit: 1,
      aircraftModels: ['737-600', '737-800'], ata2: '27', ata4: '27-11' }),
      expect.objectContaining({ userId: 'synthetic-reader', tenantId: 'synthetic-tenant' }));
    await h.controller.directory(h.request as never, 'number', undefined, undefined, undefined,
      undefined, '27', JSON.stringify(aircraftModels), 'ATA');
    expect(h.library.directory).toHaveBeenCalledWith(expect.objectContaining({ layout: 'ATA',
      aircraftModels: ['737-600', '737-800'], ata2: '27' }),
      expect.objectContaining({ userId: 'synthetic-reader', tenantId: 'synthetic-tenant' }));
  } finally {
    if (previousSandbox === undefined) delete process.env.SANDBOX_ID; else process.env.SANDBOX_ID = previousSandbox;
    if (previousLocal === undefined) delete process.env.MIAODA_LOCAL_DEV; else process.env.MIAODA_LOCAL_DEV = previousLocal;
  }
});

it.each(['[]', '{broken', 'null', JSON.stringify([''])])('rejects malformed or empty GET model union %s before reading rows', raw => {
  const h = target('/api/canonical-host/library/documents');
  expect(() => h.controller.documents(undefined, undefined, undefined, h.request as never,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, raw)).toThrow('LIBRARY_AIRCRAFT_MODELS_INVALID');
  expect(() => h.controller.directory(h.request as never, undefined, undefined, undefined, undefined,
    undefined, undefined, raw, 'ATA')).toThrow('LIBRARY_AIRCRAFT_MODELS_INVALID');
  expect(h.library.list).not.toHaveBeenCalled(); expect(h.library.directory).not.toHaveBeenCalled();
});

it('rejects a union request above the real GET URL byte ceiling rather than silently dropping it', () => {
  const h = target(`/api/canonical-host/library/documents?aircraftModels=%5B%22A320%22%5D&extra=${'x'.repeat(LIBRARY_CATALOG_PAGED_QUERY_BUDGET)}`);
  expect(() => h.controller.documents(undefined, undefined, undefined, h.request as never,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, '["A320"]')).toThrow('LIBRARY_CATALOG_QUERY_TOO_LONG');
  expect(h.library.list).not.toHaveBeenCalled();
});
