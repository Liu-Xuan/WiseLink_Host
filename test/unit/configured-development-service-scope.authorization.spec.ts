import { ConfiguredDevelopmentCanonicalServiceScopeAuthorization } from '../../server/modules/canonical-host/configured-development-service-scope.authorization';

const KEYS = [
  'WL_OPENCLAW_SERVICE_SCOPE_ENABLED',
  'WL_OPENCLAW_GATEWAY_AUTH_MODE',
  'WL_OPENCLAW_SERVICE_SCOPE_ENV',
  'WL_OPENCLAW_SERVICE_PRINCIPAL_ID',
  'WL_OPENCLAW_SERVICE_TENANT_ID',
  'WL_OPENCLAW_SERVICE_WORK_ITEM_ID',
  'WL_OPENCLAW_APPLICABILITY_CONTEXT_REF',
  'WL_OPENCLAW_DEVELOPMENT_CREATE_ENABLED',
  'WL_OPENCLAW_DEVELOPMENT_DOCUMENT_VERSION_ID',
  'WL_OPENCLAW_DEVELOPMENT_RUN_TOKEN',
] as const;

describe('ConfiguredDevelopmentCanonicalServiceScopeAuthorization', () => {
  const original = Object.fromEntries(
    KEYS.map((key) => [key, process.env[key]]),
  );

  afterEach(() => {
    for (const key of KEYS) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('fails closed when explicit gateway and DEV scope configuration is absent', async () => {
    for (const key of KEYS) delete process.env[key];
    const service =
      new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();

    await expect(
      service.assertTransport({ transport: 'OPENCLAW_MCP' }),
    ).rejects.toMatchObject({
      code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('authorizes only the one configured isolated WorkItem', async () => {
    configure();
    const service =
      new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();

    await expect(
      service.authorizeOpenClawWorkItem({
        operation: 'BEGIN_DYNAMIC',
        workItemId: 'WI-DEV-ISOLATED',
      }),
    ).resolves.toMatchObject({
      principalId: 'service:openclaw-dev-real',
      appId: 'app_17bzc551rsg',
      tenantId: 'tenant-dev',
      workItemId: 'WI-DEV-ISOLATED',
    });
    await expect(
      service.authorizeOpenClawWorkItem({
        operation: 'BEGIN_DYNAMIC',
        workItemId: 'WI-PROTECTED',
      }),
    ).rejects.toMatchObject({ code: 'CANONICAL_WORK_ITEM_NOT_FOUND' });
  });

  it('authorizes the independent translation begin and commit operations', async () => {
    configure();
    const service =
      new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();

    await expect(
      service.authorizeOpenClawWorkItem({
        operation: 'BEGIN_TRANSLATE',
        workItemId: 'WI-DEV-ISOLATED',
      }),
    ).resolves.toMatchObject({
      principalId: 'service:openclaw-dev-real',
      tenantId: 'tenant-dev',
      workItemId: 'WI-DEV-ISOLATED',
    });
    await expect(
      service.authorizeOpenClawAttempt({
        operation: 'COMMIT_TRANSLATE',
        attemptRef: 'TRN-TRANSLATE-1',
      }),
    ).resolves.toMatchObject({
      principalId: 'service:openclaw-dev-real',
      tenantId: 'tenant-dev',
      workItemId: 'WI-DEV-ISOLATED',
      attemptRef: 'TRN-TRANSLATE-1',
    });
  });

  it('derives Review begin scope only from the configured WorkItem', async () => {
    configure();
    const service =
      new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();

    await expect(
      service.authorizeOpenClawReview({
        operation: 'BEGIN_REVIEW',
        reviewConversationRef: 'RC-OPAQUE-1',
        requestId: 'request-1',
      }),
    ).resolves.toMatchObject({
      principalId: 'service:openclaw-dev-real',
      tenantId: 'tenant-dev',
      workItemId: 'WI-DEV-ISOLATED',
    });
    await expect(
      service.authorizeOpenClawReview({
        operation: 'BEGIN_REVIEW',
        reviewConversationRef: '',
        requestId: 'request-1',
      }),
    ).rejects.toMatchObject({ code: 'CANONICAL_WORK_ITEM_NOT_FOUND' });
  });

  it('resolves only the configured opaque applicability context and never accepts a caller WorkItem', async () => {
    configure();
    const service =
      new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();

    await expect(
      service.authorizeOpenClawApplicabilityContext({
        operation: 'BEGIN_APPLICABILITY',
        applicabilityContextRef: 'APCTX-DEV-OPAQUE',
        requestId: 'request-1',
      }),
    ).resolves.toMatchObject({
      workItemId: 'WI-DEV-ISOLATED',
      tenantId: 'tenant-dev',
      applicabilityContextRef: 'APCTX-DEV-OPAQUE',
      requestId: 'request-1',
    });
    await expect(
      service.authorizeOpenClawApplicabilityContext({
        operation: 'BEGIN_APPLICABILITY',
        applicabilityContextRef: 'APCTX-FORGED',
        requestId: 'request-1',
      }),
    ).rejects.toMatchObject({ code: 'CANONICAL_WORK_ITEM_NOT_FOUND' });
    await expect(
      service.authorizeOpenClawAttempt({
        operation: 'COMMIT_APPLICABILITY',
        attemptRef: 'AQ-APP-1',
      }),
    ).resolves.toMatchObject({
      workItemId: 'WI-DEV-ISOLATED',
      attemptRef: 'AQ-APP-1',
    });
  });

  it('authorizes one exact DocumentVersion and run token for development creation', async () => {
    configure();
    const service =
      new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();
    const input = {
      documentVersionId: 'document-version-dev-current',
      developmentRunToken: '0f8fad5b-d9cb-469f-a165-70867728950e',
    };
    await expect(
      service.authorizeDevelopmentCreate(input),
    ).resolves.toMatchObject({
      principalId: 'service:openclaw-dev-real',
      tenantId: 'tenant-dev',
      environment: 'DEV',
      ...input,
      authorizationFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
    await expect(
      service.authorizeDevelopmentCreate({
        ...input,
        developmentRunToken: '1f8fad5b-d9cb-469f-a165-70867728950e',
      }),
    ).rejects.toMatchObject({ code: 'CANONICAL_WORK_ITEM_NOT_FOUND' });
  });
});

function configure(): void {
  process.env.WL_OPENCLAW_SERVICE_SCOPE_ENABLED = '1';
  process.env.WL_OPENCLAW_GATEWAY_AUTH_MODE = 'API_KEY';
  process.env.WL_OPENCLAW_SERVICE_SCOPE_ENV = 'DEV';
  process.env.WL_OPENCLAW_SERVICE_PRINCIPAL_ID = 'service:openclaw-dev-real';
  process.env.WL_OPENCLAW_SERVICE_TENANT_ID = 'tenant-dev';
  process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID = 'WI-DEV-ISOLATED';
  process.env.WL_OPENCLAW_APPLICABILITY_CONTEXT_REF = 'APCTX-DEV-OPAQUE';
  process.env.WL_OPENCLAW_DEVELOPMENT_CREATE_ENABLED = '1';
  process.env.WL_OPENCLAW_DEVELOPMENT_DOCUMENT_VERSION_ID =
    'document-version-dev-current';
  process.env.WL_OPENCLAW_DEVELOPMENT_RUN_TOKEN =
    '0f8fad5b-d9cb-469f-a165-70867728950e';
}
