import { type OAuthConfigPort } from '../../../server/modules/identity/oauth-config.port';
import { TdmsReceiverIdentityProfile } from '../../../server/modules/tdms-source/tdms-receiver-identity-profile';

const tenantKey = 'WISELINK_TDMS_BOUND_TENANT_ID';
const oauth: OAuthConfigPort = {
  clientId: 'synthetic-client',
  redirectUri: 'https://synthetic.invalid/callback',
  tokenApiVersion: 'v3',
  mappingBootstrap: { kind: 'DISABLED' },
  configured: true,
  applicationScopeId: 'app_17bzc551rsg',
  sessionEnvironment: 'preview',
};

describe('controlled TDMS identity profile (synthetic configuration only)', () => {
  const previousTenant = process.env[tenantKey];
  afterEach(() => {
    if (previousTenant === undefined) delete process.env[tenantKey];
    else process.env[tenantKey] = previousTenant;
  });

  it.each([undefined, '', ' ', 'tenant a', 'tenant-a\n'])(
    'rejects an absent/invalid bound tenant %p instead of deriving it',
    (value) => {
      if (value === undefined) delete process.env[tenantKey];
      else process.env[tenantKey] = value;
      const config: OAuthConfigPort = {
        ...oauth,
        mappingBootstrap: {
          kind: 'ENABLED',
          mode: 'OFFICIAL_ONE_TIME_ISOLATED_DEV',
          miaodaTenantId: 'tenant-a',
        },
      };
      expect(() => new TdmsReceiverIdentityProfile(config).current()).toThrow(
        'TDMS_RECEIVER_IDENTITY_PROFILE_UNCONFIGURED',
      );
    },
  );

  it.each([
    { ...oauth, configured: false },
    { ...oauth, clientId: null },
    { ...oauth, clientId: '' },
    { ...oauth, clientId: 'wrong client' },
  ])('requires the existing configured OAuth port and a valid C', (config) => {
    process.env[tenantKey] = 'tenant-a';
    try {
      new TdmsReceiverIdentityProfile(config).current();
      throw new Error('unexpected profile admission');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'TDMS_RECEIVER_IDENTITY_PROFILE_UNCONFIGURED',
        statusCode: 503,
      });
    }
  });

  it('pins T at construction and takes C only from the existing OAuth port', () => {
    process.env[tenantKey] = 'tenant-a';
    const profile = new TdmsReceiverIdentityProfile(oauth);
    process.env[tenantKey] = 'other';
    expect(profile.current()).toEqual({
      tenantId: 'tenant-a',
      clientId: 'synthetic-client',
    });
    expect(Object.keys(profile.current())).toEqual(['tenantId', 'clientId']);
  });
});
