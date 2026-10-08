import { TdmsSourceController } from '../../../server/modules/tdms-source/tdms-source.controller';
import { CANONICAL_MIAODA_APP_ID } from '../../../server/modules/canonical-host/canonical-host.constants';
import { fixture } from './tdms-fixtures';
const hosted = {
  userContext: {
    userId: '123',
    tenantId: 'server-tenant',
    appId: CANONICAL_MIAODA_APP_ID,
    env: 'preview',
    isSystemAccount: false,
  },
};
describe('actual public controller ingress contract', () => {
  const old = process.env.SANDBOX_ID;
  beforeEach(() => {
    process.env.SANDBOX_ID = 'test';
  });
  afterAll(() => {
    if (old === undefined) delete process.env.SANDBOX_ID;
    else process.env.SANDBOX_ID = old;
  });
  it('exact GET signatures preserve browser actor and context via service', () => {
    const service = {
      catalogue: jest.fn(),
      readRecord: jest.fn(),
      history: jest.fn(),
      readRelations: jest.fn(),
    };
    const c = new TdmsSourceController(service as any);
    c.catalogue(hosted as any, { matterId: 'M', after: 'ref' });
    c.record(hosted as any, 'exact', {});
    c.history(hosted as any, 'exact', { after: 'prior', matterId: 'M' });
    c.relations(hosted as any, 'exact', { documentVersionId: 'DV' });
    expect(service.catalogue).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'server-tenant',
        canonicalSubject: { namespace: 'MIAODA_USER_ID', id: '123' },
      }),
      { matterId: 'M' },
      'ref',
    );
    expect(service.readRecord).toHaveBeenCalledWith(
      expect.anything(),
      'exact',
      {},
    );
    expect(service.history).toHaveBeenCalledWith(
      expect.anything(),
      'exact',
      { matterId: 'M' },
      'prior',
    );
    expect(service.readRelations).toHaveBeenCalledWith(
      expect.anything(),
      'exact',
      { documentVersionId: 'DV' },
    );
  });
  it('rejects guessed history query authority and cursor', () => {
    const c = new TdmsSourceController({ history: jest.fn() } as any);
    expect(() =>
      c.history(hosted as any, 'exact', { actorId: 'someone' }),
    ).toThrow('TDMS_INPUT_UNKNOWN_FIELD');
    expect(() => c.history(hosted as any, 'exact', { after: ' bad' })).toThrow(
      'TDMS_IDENTIFIER_INVALID',
    );
  });
  it('rejects body tenant/actor/ACL fields rather than trusting exported authority', () => {
    const c = new TdmsSourceController({ importPackage: jest.fn() } as any);
    expect(() =>
      c.importPackage(hosted as any, {
        sourceKey: 'TDMS',
        sourceInstanceId: 'I',
        scopeId: 'S',
        package: fixture(),
        tenantId: 'evil',
        actorId: 'evil',
      }),
    ).toThrow('TDMS_INPUT_UNKNOWN_FIELD');
  });
  it('rejects simultaneous context roots, unknown query keys and whitespace identifiers', () => {
    const c = new TdmsSourceController({ readRecord: jest.fn() } as any);
    expect(() =>
      c.record(hosted as any, 'exact', {
        matterId: 'M',
        documentVersionId: 'D',
      }),
    ).toThrow('TDMS_READ_CONTEXT_AMBIGUOUS');
    expect(() => c.record(hosted as any, 'exact', { actorId: '123' })).toThrow(
      'TDMS_BROWSER_CONTEXT_INVALID',
    );
    expect(() => c.record(hosted as any, ' exact', {})).toThrow(
      'TDMS_IDENTIFIER_INVALID',
    );
  });
  it('system account and untrusted local actor cannot enter public service', () => {
    const service = { readRecord: jest.fn() };
    const c = new TdmsSourceController(service as any);
    expect(() =>
      c.record(
        {
          ...hosted,
          userContext: { ...hosted.userContext, isSystemAccount: true },
        } as any,
        'exact',
        {},
      ),
    ).toThrow('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE');
    delete process.env.SANDBOX_ID;
    delete process.env.FORCE_FRAMEWORK_ENVIRONMENT;
    expect(() => c.record(hosted as any, 'exact', {})).toThrow(
      'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
    );
    expect(service.readRecord).not.toHaveBeenCalled();
  });
});
