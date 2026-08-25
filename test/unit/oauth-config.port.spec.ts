import {
  EnvOauthConfigAdapter,
  FEISHU_OAUTH_V2_COMPATIBILITY_MODE,
} from '../../server/modules/identity/oauth-config.port';

const MANAGED_ENV_KEYS = [
  'FEISHU_OAUTH_CLIENT_ID',
  'FEISHU_OAUTH_CLIENT_SECRET',
  'FEISHU_OAUTH_REDIRECT_URI',
  'FEISHU_OAUTH_TOKEN_API_VERSION',
] as const;

describe('EnvOauthConfigAdapter token endpoint selection', () => {
  const originalValues = new Map<string, string | undefined>();

  beforeAll(() => {
    for (const key of MANAGED_ENV_KEYS) {
      originalValues.set(key, process.env[key]);
    }
  });

  beforeEach(() => {
    process.env.FEISHU_OAUTH_CLIENT_ID = 'cli-controlled-dev';
    process.env.FEISHU_OAUTH_CLIENT_SECRET = 'controlled-dev-secret';
    process.env.FEISHU_OAUTH_REDIRECT_URI =
      'https://dev.example.com/client/oauth/callback';
    delete process.env.FEISHU_OAUTH_TOKEN_API_VERSION;
  });

  afterAll(() => {
    for (const key of MANAGED_ENV_KEYS) {
      const value = originalValues.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('defaults an absent version setting to the long-term v3 contract', () => {
    const config = new EnvOauthConfigAdapter();

    expect(config.tokenApiVersion).toBe('v3');
    expect(config.configured).toBe(true);
  });

  it('accepts exact v2 only as the official temporary compatibility selection', () => {
    process.env.FEISHU_OAUTH_TOKEN_API_VERSION = 'v2';

    const config = new EnvOauthConfigAdapter();

    expect(FEISHU_OAUTH_V2_COMPATIBILITY_MODE).toBe(
      'OFFICIAL_TEMPORARY_COMPATIBILITY',
    );
    expect(config.tokenApiVersion).toBe('v2');
    expect(config.configured).toBe(true);
  });

  it('accepts exact v3 as the long-term selection', () => {
    process.env.FEISHU_OAUTH_TOKEN_API_VERSION = 'v3';

    const config = new EnvOauthConfigAdapter();

    expect(config.tokenApiVersion).toBe('v3');
    expect(config.configured).toBe(true);
  });

  it.each(['', 'V2', 'v2 ', ' v2', 'v4', '2'])(
    'fails closed for an unknown version value %j',
    (value) => {
      process.env.FEISHU_OAUTH_TOKEN_API_VERSION = value;

      const config = new EnvOauthConfigAdapter();

      expect(config.tokenApiVersion).toBeNull();
      expect(config.configured).toBe(false);
    },
  );
});
