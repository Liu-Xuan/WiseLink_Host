const hostActor = jest.fn();

jest.mock(
  '../../server/modules/canonical-host/canonical-host-request-actor',
  () => ({ hostActor }),
);

import { CanonicalLibraryCatalogController } from '../../server/modules/canonical-host/canonical-library-catalog.controller';

describe('CanonicalLibraryCatalogController', () => {
  beforeEach(() => hostActor.mockReset());

  it('forwards only browser query fields and the Host-derived actor', async () => {
    const actor = { userId: 'engineer', tenantId: 'tenant' };
    hostActor.mockReturnValue(actor);
    const catalog = {
      read: jest.fn().mockResolvedValue({ items: [] }),
      quicklook: jest.fn(),
    };
    const controller = new CanonicalLibraryCatalogController(catalog as never);
    const request = {} as never;

    await controller.read(
      'assessment',
      '737',
      'B737',
      'cursor-token',
      '24',
      request,
    );

    expect(catalog.read).toHaveBeenCalledWith(
      {
        view: 'assessment',
        query: '737',
        family: 'B737',
        cursor: 'cursor-token',
        limit: 24,
      },
      actor,
    );
  });

  it('rejects malformed pagination before the service read', () => {
    hostActor.mockReturnValue({ userId: 'engineer', tenantId: 'tenant' });
    const catalog = { read: jest.fn(), quicklook: jest.fn() };
    const controller = new CanonicalLibraryCatalogController(catalog as never);

    expect(() =>
      controller.read(
        undefined,
        undefined,
        undefined,
        undefined,
        '-1',
        {} as never,
      ),
    ).toThrow('LIBRARY_CATALOG_LIMIT_INVALID');
    expect(catalog.read).not.toHaveBeenCalled();
  });
});
