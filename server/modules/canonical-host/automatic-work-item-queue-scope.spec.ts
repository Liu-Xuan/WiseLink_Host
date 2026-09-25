import { ConfiguredDevelopmentCanonicalServiceScopeAuthorization } from './configured-development-service-scope.authorization';

const CONFIG_KEYS = [
  'WL_OPENCLAW_SERVICE_SCOPE_ENABLED',
  'WL_OPENCLAW_GATEWAY_AUTH_MODE',
  'WL_OPENCLAW_SERVICE_SCOPE_ENV',
  'WL_OPENCLAW_SERVICE_PRINCIPAL_ID',
  'WL_OPENCLAW_SERVICE_TENANT_ID',
  'WL_OPENCLAW_SERVICE_WORK_ITEM_ID',
  'WL_OPENCLAW_SERVICE_AUTO_QUEUE_ENABLED',
] as const;

describe('OpenClaw automatic WorkItem queue scope', () => {
  const previous = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of CONFIG_KEYS) {
      previous.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of CONFIG_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('requires the fixed service identity and dedicated queue opt-in', async () => {
    const authorization = new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();
    setBaseScope();

    await expect(
      authorization.authorizeOpenClawAutoWorkItemQueue(),
    ).rejects.toMatchObject({
      code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
      statusCode: 503,
    });

    process.env.WL_OPENCLAW_SERVICE_AUTO_QUEUE_ENABLED = '1';
    await expect(
      authorization.authorizeOpenClawAutoWorkItemQueue(),
    ).resolves.toMatchObject({
      principalId: 'service:openclaw-main',
      appId: 'app_17bzc551rsg',
      tenantId: 'tenant-01',
      authorizationFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
  });

  it('does not accept another configured service principal for this queue', async () => {
    setBaseScope();
    process.env.WL_OPENCLAW_SERVICE_AUTO_QUEUE_ENABLED = '1';
    process.env.WL_OPENCLAW_SERVICE_PRINCIPAL_ID = 'service:other';
    const authorization = new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();

    await expect(
      authorization.authorizeOpenClawAutoWorkItemQueue(),
    ).rejects.toMatchObject({
      code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('keeps the existing MCP transport closed when only the queue scope is enabled', async () => {
    setBaseScope();
    process.env.WL_OPENCLAW_SERVICE_AUTO_QUEUE_ENABLED = '1';
    const authorization = new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();

    await expect(
      authorization.assertTransport({ transport: 'OPENCLAW_MCP' }),
    ).rejects.toMatchObject({
      code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
      statusCode: 503,
    });
    await expect(
      authorization.assertAutoWorkItemQueueTransport(),
    ).resolves.toBeUndefined();
  });
});

function setBaseScope(): void {
  process.env.WL_OPENCLAW_SERVICE_SCOPE_ENABLED = '1';
  process.env.WL_OPENCLAW_GATEWAY_AUTH_MODE = 'API_KEY';
  process.env.WL_OPENCLAW_SERVICE_SCOPE_ENV = 'DEV';
  process.env.WL_OPENCLAW_SERVICE_PRINCIPAL_ID = 'service:openclaw-main';
  process.env.WL_OPENCLAW_SERVICE_TENANT_ID = 'tenant-01';
}
