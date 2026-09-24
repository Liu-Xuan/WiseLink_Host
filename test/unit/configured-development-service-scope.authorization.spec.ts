import { ConfiguredDevelopmentCanonicalServiceScopeAuthorization, isOpenClawAutomaticReviewConfigured } from '../../server/modules/canonical-host/configured-development-service-scope.authorization';

const KEYS = [
  'WL_OPENCLAW_SERVICE_SCOPE_ENABLED',
  'WL_OPENCLAW_GATEWAY_AUTH_MODE',
  'WL_OPENCLAW_SERVICE_SCOPE_ENV',
  'WL_OPENCLAW_SERVICE_PRINCIPAL_ID',
  'WL_OPENCLAW_SERVICE_TENANT_ID',
  'WL_OPENCLAW_SERVICE_WORK_ITEM_ID',
  'WL_OPENCLAW_SERVICE_ADDITIONAL_WORK_ITEM_IDS',
  'WL_OPENCLAW_DOCUMENT_SCOPE_ENABLED',
  'WL_OPENCLAW_SERVICE_DOCUMENT_VERSION_ID',
  'WL_OPENCLAW_SERVICE_DOCUMENT_VERSION_IDS',
  'WL_OPENCLAW_SERVICE_DOCUMENT_ACTOR_ID',
  'WL_OPENCLAW_MATTER_SCOPE_ENABLED',
  'WL_OPENCLAW_SERVICE_MATTER_ID',
  'WL_OPENCLAW_SERVICE_MATTER_IDS',
  'WL_OPENCLAW_SERVICE_MATTER_ACTOR_ID',
  'WL_OPENCLAW_APPLICABILITY_CONTEXT_REF',
  'WL_OPENCLAW_APPLICABILITY_ADDITIONAL_CONTEXT_BINDING',
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

  it('binds an additional applicability context to exactly one allowlisted WorkItem', async () => {
    for (const key of KEYS) delete process.env[key];
    Object.assign(process.env, { WL_OPENCLAW_SERVICE_SCOPE_ENABLED:'1', WL_OPENCLAW_GATEWAY_AUTH_MODE:'API_KEY',
      WL_OPENCLAW_SERVICE_SCOPE_ENV:'UAT', WL_OPENCLAW_SERVICE_PRINCIPAL_ID:'service:openclaw-main',
      WL_OPENCLAW_SERVICE_TENANT_ID:'tenant-1', WL_OPENCLAW_SERVICE_WORK_ITEM_ID:'WI-legacy',
      WL_OPENCLAW_SERVICE_ADDITIONAL_WORK_ITEM_IDS:JSON.stringify(['WI-ftd']),
      WL_OPENCLAW_APPLICABILITY_CONTEXT_REF:'APCTX-legacy',
      WL_OPENCLAW_APPLICABILITY_ADDITIONAL_CONTEXT_BINDING:JSON.stringify({workItemId:'WI-ftd',applicabilityContextRef:'APCTX-ftd'}) });
    const service=new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();
    await expect(service.resolveOpenClawApplicabilityContextRef({tenantId:'tenant-1',workItemId:'WI-ftd'}))
      .resolves.toBe('APCTX-ftd');
    await expect(service.authorizeOpenClawApplicabilityContext({operation:'BEGIN_APPLICABILITY',
      applicabilityContextRef:'APCTX-ftd',requestId:'request-1'})).resolves.toMatchObject({
        tenantId:'tenant-1',workItemId:'WI-ftd',requirePersistedSelection:true });
    await expect(service.authorizeOpenClawApplicabilityContext({operation:'BEGIN_APPLICABILITY',
      applicabilityContextRef:'APCTX-legacy',requestId:'request-1'})).resolves.toMatchObject({workItemId:'WI-legacy'});
    await expect(service.authorizeOpenClawAttempt({operation:'COMMIT_APPLICABILITY',attemptRef:'AQ-1',workItemId:'WI-ftd'}))
      .resolves.toMatchObject({workItemId:'WI-ftd'});
    await expect(service.resolveOpenClawApplicabilityContextRef({tenantId:'other',workItemId:'WI-ftd'}))
      .rejects.toMatchObject({statusCode:404});
    await expect(service.authorizeOpenClawApplicabilityContext({operation:'BEGIN_APPLICABILITY',
      applicabilityContextRef:'APCTX-other',requestId:'request-1'})).rejects.toMatchObject({statusCode:404});
    process.env.WL_OPENCLAW_APPLICABILITY_ADDITIONAL_CONTEXT_BINDING=JSON.stringify({workItemId:'WI-other',applicabilityContextRef:'APCTX-ftd'});
    await expect(service.resolveOpenClawApplicabilityContextRef({tenantId:'tenant-1',workItemId:'WI-ftd'}))
      .rejects.toMatchObject({statusCode:503});
    await expect(service.authorizeOpenClawApplicabilityContext({operation:'BEGIN_APPLICABILITY',
      applicabilityContextRef:'APCTX-legacy',requestId:'request-1'})).resolves.toMatchObject({workItemId:'WI-legacy'});
  });

  it('authorizes one document independently without granting engineering WorkItem or Matter access', async () => {
    for (const key of KEYS) delete process.env[key];
    Object.assign(process.env, { WL_OPENCLAW_SERVICE_SCOPE_ENABLED: '1', WL_OPENCLAW_GATEWAY_AUTH_MODE: 'API_KEY',
      WL_OPENCLAW_SERVICE_SCOPE_ENV: 'UAT', WL_OPENCLAW_SERVICE_PRINCIPAL_ID: 'service:document-consumer',
      WL_OPENCLAW_SERVICE_TENANT_ID: 'tenant-test', WL_OPENCLAW_DOCUMENT_SCOPE_ENABLED: '1',
      WL_OPENCLAW_SERVICE_DOCUMENT_VERSION_ID: 'DV-test', WL_OPENCLAW_SERVICE_DOCUMENT_ACTOR_ID: 'actor-test' });
    const service = new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();
    await expect(service.assertTransport({ transport: 'OPENCLAW_MCP' })).resolves.toBeUndefined();
    await expect(service.authorizeDocumentWork({ documentVersionId: 'DV-test' })).resolves.toMatchObject({
      tenantId: 'tenant-test', actorUserId: 'actor-test', documentVersionId: 'DV-test' });
    await expect(service.authorizeDocumentWork({ documentVersionId: 'DV-other' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.authorizeWorkItemRead({ transport: 'READONLY_MCP', operation: 'READ_STATUS', workItemId: 'WI-test' }))
      .rejects.toMatchObject({ statusCode: 503 });
    await expect(service.authorizeOpenClawMatterRequest({ matterId: 'MAT-test' })).rejects.toMatchObject({ statusCode: 503 });
    delete process.env.WL_OPENCLAW_SERVICE_DOCUMENT_ACTOR_ID;
    await expect(service.authorizeDocumentWork({ documentVersionId: 'DV-test' })).rejects.toMatchObject({ statusCode: 503 });
  });

  it('requires a separate exact Matter and actor scope; it never converts the WorkItem allowlist', async () => {
    for (const key of KEYS) delete process.env[key];
    Object.assign(process.env, { WL_OPENCLAW_SERVICE_SCOPE_ENABLED: '1',
      WL_OPENCLAW_GATEWAY_AUTH_MODE: 'API_KEY', WL_OPENCLAW_SERVICE_SCOPE_ENV: 'DEV',
      WL_OPENCLAW_SERVICE_PRINCIPAL_ID: 'service:executor', WL_OPENCLAW_SERVICE_TENANT_ID: 'tenant-1',
      WL_OPENCLAW_SERVICE_WORK_ITEM_ID: 'WI-one' });
    const service = new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();
    const request = { operation: 'CLAIM' as const, matterId: 'MAT-one', attemptRef: 'AQ-one' };
    await expect(service.authorizeOpenClawMatterAttempt(request)).rejects.toMatchObject({ statusCode: 503 });
    Object.assign(process.env, { WL_OPENCLAW_MATTER_SCOPE_ENABLED: '1',
      WL_OPENCLAW_SERVICE_MATTER_ID: 'MAT-one', WL_OPENCLAW_SERVICE_MATTER_ACTOR_ID: 'actor-1' });
    await expect(service.authorizeOpenClawMatterAttempt(request)).resolves.toMatchObject({
      matterId: 'MAT-one', actorUserId: 'actor-1', tenantId: 'tenant-1', principalId: 'service:executor' });
    await expect(service.authorizeOpenClawMatterAttempt({ ...request, matterId: 'MAT-two' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.authorizeWorkItemRead({ transport: 'OPENAPI_REST', operation: 'READ_STATUS', workItemId: 'WI-two' })).rejects.toMatchObject({ statusCode: 404 });
    delete process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID;
    await expect(service.assertTransport({ transport: 'OPENCLAW_MCP' })).resolves.toBeUndefined();
    await expect(service.assertTransport({ transport: 'READONLY_MCP' })).rejects.toMatchObject({ statusCode: 503 });
    process.env.WL_OPENCLAW_SERVICE_SCOPE_ENV = 'PROD';
    await expect(service.authorizeOpenClawMatterAttempt(request)).rejects.toMatchObject({ statusCode: 503 });
  });

  it('binds each listed Matter to the requested object and observes removal without granting other object scopes', async () => {
    for (const key of KEYS) delete process.env[key];
    Object.assign(process.env, { WL_OPENCLAW_SERVICE_SCOPE_ENABLED: '1', WL_OPENCLAW_GATEWAY_AUTH_MODE: 'API_KEY',
      WL_OPENCLAW_SERVICE_SCOPE_ENV: 'UAT', WL_OPENCLAW_SERVICE_PRINCIPAL_ID: 'service:matter-consumer',
      WL_OPENCLAW_SERVICE_TENANT_ID: 'tenant-test', WL_OPENCLAW_MATTER_SCOPE_ENABLED: '1',
      WL_OPENCLAW_SERVICE_MATTER_ID: 'MAT-legacy', WL_OPENCLAW_SERVICE_MATTER_ACTOR_ID: 'actor-test',
      WL_OPENCLAW_SERVICE_MATTER_IDS: JSON.stringify(['MAT-first', 'MAT-second']) });
    const service = new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();
    for (const matterId of ['MAT-first', 'MAT-second']) {
      await expect(service.authorizeOpenClawMatterAttempt({ operation: 'CLAIM', matterId, attemptRef: 'AQ-one' }))
        .resolves.toMatchObject({ tenantId: 'tenant-test', actorUserId: 'actor-test', matterId, attemptRef: 'AQ-one' });
    }
    for (const matterId of ['MAT-other', 'MAT-legacy', 'MAT-first ']) {
      await expect(service.authorizeOpenClawMatterRequest({ matterId })).rejects.toMatchObject({ statusCode: 404 });
    }
    delete process.env.WL_OPENCLAW_SERVICE_MATTER_ID;
    await expect(service.assertTransport({ transport: 'OPENCLAW_MCP' })).resolves.toBeUndefined();
    process.env.WL_OPENCLAW_SERVICE_MATTER_IDS = JSON.stringify(['MAT-second']);
    await expect(service.authorizeOpenClawMatterAttempt({ operation: 'CLAIM', matterId: 'MAT-first', attemptRef: 'AQ-one' }))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(service.authorizeDocumentWork({ documentVersionId: 'DV-test' })).rejects.toMatchObject({ statusCode: 503 });
    await expect(service.authorizeWorkItemRead({ transport: 'READONLY_MCP', operation: 'READ_STATUS', workItemId: 'WI-test' }))
      .rejects.toMatchObject({ statusCode: 503 });
    delete process.env.WL_OPENCLAW_SERVICE_MATTER_ACTOR_ID;
    await expect(service.authorizeOpenClawMatterRequest({ matterId: 'MAT-second' })).rejects.toMatchObject({ statusCode: 503 });
  });

  it.each(['', 'not-json', '{}', '[]', '[null]', '["*"]', '["MAT-"]', '[" MAT-one"]', '["WI-one"]', '["MAT-one","MAT-one"]'])
    ('rejects invalid explicit Matter configuration %s instead of authorizing the legacy binding', async configured => {
      for (const key of KEYS) delete process.env[key];
      Object.assign(process.env, { WL_OPENCLAW_SERVICE_SCOPE_ENABLED: '1', WL_OPENCLAW_GATEWAY_AUTH_MODE: 'API_KEY',
        WL_OPENCLAW_SERVICE_SCOPE_ENV: 'UAT', WL_OPENCLAW_SERVICE_PRINCIPAL_ID: 'service:matter-consumer',
        WL_OPENCLAW_SERVICE_TENANT_ID: 'tenant-test', WL_OPENCLAW_MATTER_SCOPE_ENABLED: '1',
        WL_OPENCLAW_SERVICE_MATTER_ID: 'MAT-legacy', WL_OPENCLAW_SERVICE_MATTER_ACTOR_ID: 'actor-test',
        WL_OPENCLAW_SERVICE_MATTER_IDS: configured });
      const service = new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();
      await expect(service.authorizeOpenClawMatterRequest({ matterId: 'MAT-legacy' }))
        .rejects.toMatchObject({ code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE', statusCode: 503 });
      await expect(service.assertTransport({ transport: 'OPENCLAW_MCP' }))
        .rejects.toMatchObject({ code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE', statusCode: 503 });
    });

  it('authorizes only explicitly listed document versions under the same actor and reflects removal immediately', async () => {
    for (const key of KEYS) delete process.env[key];
    Object.assign(process.env, { WL_OPENCLAW_SERVICE_SCOPE_ENABLED: '1', WL_OPENCLAW_GATEWAY_AUTH_MODE: 'API_KEY',
      WL_OPENCLAW_SERVICE_SCOPE_ENV: 'UAT', WL_OPENCLAW_SERVICE_PRINCIPAL_ID: 'service:document-consumer',
      WL_OPENCLAW_SERVICE_TENANT_ID: 'tenant-test', WL_OPENCLAW_DOCUMENT_SCOPE_ENABLED: '1',
      WL_OPENCLAW_SERVICE_DOCUMENT_VERSION_ID: 'DV-legacy', WL_OPENCLAW_SERVICE_DOCUMENT_ACTOR_ID: 'actor-test',
      WL_OPENCLAW_SERVICE_DOCUMENT_VERSION_IDS: JSON.stringify(['DV-old', 'DV-new']) });
    const service = new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();
    for (const documentVersionId of ['DV-old', 'DV-new']) {
      await expect(service.authorizeDocumentWork({ documentVersionId })).resolves.toMatchObject({
        tenantId: 'tenant-test', actorUserId: 'actor-test', documentVersionId });
    }
    for (const documentVersionId of ['DV-other', 'DV-legacy', 'DV-old ']) {
      await expect(service.authorizeDocumentWork({ documentVersionId })).rejects.toMatchObject({ statusCode: 404 });
    }
    process.env.WL_OPENCLAW_SERVICE_DOCUMENT_VERSION_IDS = JSON.stringify(['DV-new']);
    await expect(service.authorizeDocumentWork({ documentVersionId: 'DV-old' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.authorizeOpenClawMatterRequest({ matterId: 'MAT-test' })).rejects.toMatchObject({ statusCode: 503 });
    await expect(service.authorizeWorkItemRead({ transport: 'READONLY_MCP', operation: 'READ_STATUS', workItemId: 'WI-test' }))
      .rejects.toMatchObject({ statusCode: 503 });
    delete process.env.WL_OPENCLAW_SERVICE_DOCUMENT_ACTOR_ID;
    await expect(service.authorizeDocumentWork({ documentVersionId: 'DV-new' })).rejects.toMatchObject({ statusCode: 503 });
  });

  it.each(['', 'not-json', '{}', '[]', '[null]', '["*"]', '[" DV-old"]', '["DV-old","DV-old"]'])
    ('rejects invalid explicit document configuration %s without falling back to the legacy version', async configured => {
      for (const key of KEYS) delete process.env[key];
      Object.assign(process.env, { WL_OPENCLAW_SERVICE_SCOPE_ENABLED: '1', WL_OPENCLAW_GATEWAY_AUTH_MODE: 'API_KEY',
        WL_OPENCLAW_SERVICE_SCOPE_ENV: 'UAT', WL_OPENCLAW_SERVICE_PRINCIPAL_ID: 'service:document-consumer',
        WL_OPENCLAW_SERVICE_TENANT_ID: 'tenant-test', WL_OPENCLAW_DOCUMENT_SCOPE_ENABLED: '1',
        WL_OPENCLAW_SERVICE_DOCUMENT_VERSION_ID: 'DV-legacy', WL_OPENCLAW_SERVICE_DOCUMENT_ACTOR_ID: 'actor-test',
        WL_OPENCLAW_SERVICE_DOCUMENT_VERSION_IDS: configured });
      await expect(new ConfiguredDevelopmentCanonicalServiceScopeAuthorization().authorizeDocumentWork({ documentVersionId: 'DV-legacy' }))
        .rejects.toMatchObject({ code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE', statusCode: 503 });
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

  it('grants one explicit JobAid and Overall WorkItem without changing the legacy binding', async () => {
    configure();
    const service = new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();
    const legacy = await service.authorizeOpenClawWorkItem({
      operation: 'BEGIN_DYNAMIC', workItemId: 'WI-DEV-ISOLATED',
    });
    process.env.WL_OPENCLAW_SERVICE_ADDITIONAL_WORK_ITEM_IDS =
      JSON.stringify(['WI-FTD-EXACT']);
    const extra = await service.authorizeOpenClawWorkItem({
      operation: 'BEGIN_DYNAMIC', workItemId: 'WI-FTD-EXACT',
    });
    expect(extra).toMatchObject({
      tenantId: 'tenant-dev', workItemId: 'WI-FTD-EXACT',
    });
    expect((await service.authorizeOpenClawWorkItem({
      operation: 'BEGIN_DYNAMIC', workItemId: 'WI-DEV-ISOLATED',
    })).authorizationFingerprint).toBe(legacy.authorizationFingerprint);
    await expect(service.authorizeOpenClawWorkItem({
      operation: 'BEGIN_TRANSLATE', workItemId: 'WI-FTD-EXACT',
    })).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.authorizeOpenClawWorkItem({
      operation: 'BEGIN_OVERALL', workItemId: 'WI-FTD-EXACT',
    })).resolves.toMatchObject({ workItemId: 'WI-FTD-EXACT' });
    await expect(service.authorizeOpenClawAttempt({
      operation: 'COMMIT_DYNAMIC', attemptRef: 'AQ-FTD', workItemId: 'WI-FTD-EXACT',
    })).resolves.toMatchObject({ workItemId: 'WI-FTD-EXACT' });
    await expect(service.authorizeOpenClawAttempt({
      operation: 'COMMIT_TRANSLATE', attemptRef: 'AQ-FTD', workItemId: 'WI-FTD-EXACT',
    })).rejects.toMatchObject({ statusCode: 404 });
    for (const operation of ['RESUME_OVERALL', 'COMMIT_OVERALL'] as const) {
      await expect(service.authorizeOpenClawAttempt({
        operation, attemptRef: 'AQ-FTD', workItemId: 'WI-FTD-EXACT',
      })).resolves.toMatchObject({ workItemId: 'WI-FTD-EXACT' });
    }
    await expect(service.authorizeOpenClawAttempt({
      operation: 'COMMIT_DYNAMIC', attemptRef: 'AQ-FTD',
    })).resolves.toMatchObject({ workItemId: 'WI-DEV-ISOLATED' });
    expect(isOpenClawAutomaticReviewConfigured({
      tenantId: 'tenant-dev', workItemId: 'WI-FTD-EXACT',
    })).toBe(false);
    delete process.env.WL_OPENCLAW_SERVICE_ADDITIONAL_WORK_ITEM_IDS;
    await expect(service.authorizeOpenClawWorkItem({
      operation: 'BEGIN_DYNAMIC', workItemId: 'WI-FTD-EXACT',
    })).rejects.toMatchObject({ statusCode: 404 });
  });

  it.each(['', 'not-json', '{}', '[]', '[null]', '["*"]',
    '["WI-FTD","WI-OTHER"]', '["WI-DEV-ISOLATED"]'])
  ('rejects invalid extra WorkItem configuration %s without breaking legacy', async configured => {
    configure();
    process.env.WL_OPENCLAW_SERVICE_ADDITIONAL_WORK_ITEM_IDS = configured;
    const service = new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();
    await expect(service.authorizeOpenClawWorkItem({
      operation: 'BEGIN_DYNAMIC', workItemId: 'WI-DEV-ISOLATED',
    })).resolves.toMatchObject({ workItemId: 'WI-DEV-ISOLATED' });
    await expect(service.authorizeOpenClawWorkItem({
      operation: 'BEGIN_DYNAMIC', workItemId: 'WI-FTD',
    })).rejects.toMatchObject({ code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE' });
  });

  it('projects automatic review only for the configured tenant and WorkItem', () => {
    for (const key of KEYS) delete process.env[key];
    const supported = { tenantId: 'tenant-dev', workItemId: 'WI-DEV-ISOLATED' };
    expect(isOpenClawAutomaticReviewConfigured(supported)).toBe(false);
    configure();
    expect(isOpenClawAutomaticReviewConfigured(supported)).toBe(true);
    expect(isOpenClawAutomaticReviewConfigured({ ...supported, tenantId: 'other' })).toBe(false);
    expect(isOpenClawAutomaticReviewConfigured({ ...supported, workItemId: 'WI-OTHER' })).toBe(false);
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
