import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOpDecorator = () => () => undefined;
  return {
    ...actual,
    Body: noOpDecorator,
    Controller: noOpDecorator,
    Get: noOpDecorator,
    Param: noOpDecorator,
    Post: noOpDecorator,
    Query: noOpDecorator,
    Req: noOpDecorator,
  };
});

jest.mock('@lark-apaas/fullstack-nestjs-core', () => {
  const actual = jest.requireActual('@lark-apaas/fullstack-nestjs-core');
  return {
    ...actual,
    NeedLogin: () => () => undefined,
  };
});

import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { SessionResolver } from '../../server/modules/identity/session-resolver.service';

import { CanonicalHostController } from '../../server/modules/canonical-host/canonical-host.controller';

const OVERALL_CONFIRMATION = {
  expectedRevision: 8,
  expectedOverallRevision: 2,
  expectedOverallArtifactRef: 'artifact://overall-result-2',
};

const HOST_REQUEST = {
  userContext: {
    userId: 'engineer-1001',
    tenantId: 'tenant-2001',
    appId: 'app_17bzc551rsg',
    roles: ['authenticated'],
    env: 'preview',
  },
};

function target(sessions?: SessionResolver) {
  const service = { browserInitialAnalysisStatus: jest.fn().mockResolvedValue({ status: 'FAILED' }) };
  const workItems = {
    parsePdf: jest.fn().mockResolvedValue({ workItemCreated: true }),
    createDevelopmentRun: jest.fn().mockResolvedValue({
      workItemCreated: true,
    }),
  };
  const integratedAssessments = {
    confirmOpenClawOverallForAeo: jest.fn().mockResolvedValue({ revision: 9 }),
  };
  const engineerReviews = {
    recordReview: jest.fn().mockResolvedValue({ revision: 6 }),
    pageContext: jest.fn().mockResolvedValue(null),
  };
  const aeo = {
    generateCandidate: jest.fn().mockResolvedValue({
      status: 'CANDIDATE_WORD_EXPORTED',
    }),
  };
  const libraryIndex = {
    read: jest.fn().mockResolvedValue({
      schemaVersion: 'wiselink.3_1.library_index_read.v0.candidate',
      scope: 'CURRENT_WORKITEM_ONLY',
    }),
  };
  return {
    service,
    workItems,
    engineerReviews,
    integratedAssessments,
    aeo,
    libraryIndex,
    controller: new CanonicalHostController(
      service as never,
      workItems as never,
      integratedAssessments as never,
      engineerReviews as never,
      aeo as never,
      libraryIndex as never,
      undefined,
      undefined,
      sessions,
    ),
  };
}

describe('CanonicalHostController assessment actions', () => {
  it('reads this release checklist with native browser identity and no business service calls', () => {
    const h = target();
    const read = h.controller.checklistDefinition(HOST_REQUEST as never);
    expect(read).toMatchObject({ schemaVersion: 'wiselink.checklist-definition-read.v1',
      source: 'HOST_RELEASE', management: 'READ_ONLY_RELEASE_MANAGED' });
    expect(read.current.definition.items.length).toBeGreaterThan(0);
    expect(read.current).not.toHaveProperty('goal');
    let denial: unknown = undefined;
    try { h.controller.checklistDefinition({} as never); } catch (error) { denial = error; }
    expect(denial).toBeInstanceOf(Error);
    expect(denial).toMatchObject({ code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE', statusCode: 503,
      denialSource: 'MIAODA_BROWSER_UNAVAILABLE_ADAPTER' });
    for (const service of [h.service, h.workItems, h.engineerReviews, h.integratedAssessments, h.aeo, h.libraryIndex])
      for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
  });

  describe('document parsing native request identity', () => {
    function pageHarness(sessions?: SessionResolver) {
      const h = target(sessions);
      const page = jest.spyOn(h.controller as unknown as {
        pageWithEngineerReviews(input: unknown, actor: unknown): Promise<unknown>;
      }, 'pageWithEngineerReviews').mockResolvedValue({ status: 'FAILED' });
      return { ...h, page };
    }

    it('runs both GET projections inside native identity and native SQL', async () => {
      let inScope = false;
      const sessions = { withNativeBrowserIdentity: jest.fn(async (_request, operation) => {
        inScope = true;
        try { return await operation(null); } finally { inScope = false; }
      }), withVerifiedNativeBrowserSql: jest.fn(async operation => {
        expect(inScope).toBe(true); return operation();
      }) };
      const h = pageHarness(sessions as never);
      h.page.mockImplementation(async () => { expect(inScope).toBe(true); return { status: 'FAILED' }; });
      await expect(h.controller.page('WI-progress', 'query', 'source-ref', HOST_REQUEST as never))
        .resolves.toEqual({ status: 'FAILED' });
      await h.controller.initialAnalysis('WI-progress', HOST_REQUEST as never);
      expect(sessions.withNativeBrowserIdentity).toHaveBeenCalledWith(HOST_REQUEST, expect.any(Function));
      expect(sessions.withNativeBrowserIdentity).toHaveBeenCalledTimes(2);
      expect(sessions.withVerifiedNativeBrowserSql).toHaveBeenCalledTimes(2);
      expect(h.page).toHaveBeenCalledWith({ workItemId: 'WI-progress', query: 'query', sourceRef: 'source-ref' },
        expect.objectContaining({ userId: 'engineer-1001', tenantId: 'tenant-2001' }));
    });

    it('keeps the existing page path when the optional resolver is absent', async () => {
      const h = pageHarness();
      await expect(h.controller.page('WI-progress', undefined, undefined, HOST_REQUEST as never))
        .resolves.toEqual({ status: 'FAILED' });
      expect(h.page).toHaveBeenCalledTimes(1);
    });

    it.each([
      new UnauthorizedException('MALFORMED_SESSION'),
      new Error('SESSION_DATABASE_FAILURE'),
      new UnauthorizedException('OFFICIAL_OAUTH_SESSION_REQUIRED'),
    ])('never softens an optional session resolver failure: %s', async (error) => {
      const sessions = { withNativeBrowserIdentity: jest.fn().mockRejectedValue(error) };
      const h = pageHarness(sessions as never);
      await expect(h.controller.page('WI-progress', undefined, undefined, HOST_REQUEST as never))
        .rejects.toBe(error);
      expect(h.page).not.toHaveBeenCalled();
    });
  });

  it('delegates the initial progress read with the existing trusted browser actor', async () => {
    const { controller, service } = target();
    await expect(controller.initialAnalysis('WI-progress', HOST_REQUEST as never)).resolves.toEqual({ status: 'FAILED' });
    expect(service.browserInitialAnalysisStatus).toHaveBeenCalledWith('WI-progress', expect.objectContaining({ userId: 'engineer-1001', tenantId: 'tenant-2001' }));
  });
  const previousSandboxId = process.env.SANDBOX_ID;
  const previousLocalDev = process.env.MIAODA_LOCAL_DEV;

  beforeAll(() => {
    process.env.SANDBOX_ID = 'unit-hosted-sandbox';
    delete process.env.MIAODA_LOCAL_DEV;
  });

  afterAll(() => {
    restoreEnvironmentVariable('SANDBOX_ID', previousSandboxId);
    restoreEnvironmentVariable('MIAODA_LOCAL_DEV', previousLocalDev);
  });

  it('advertises DEV intake only to the native development role in hosted environments', () => {
    const { controller } = target();
    const preview = {
      userContext: {
        ...HOST_REQUEST.userContext,
        roles: ['authenticated', 'wiselink_development'],
      },
    };
    const runtime = {
      userContext: { ...preview.userContext, env: 'runtime' },
    };

    expect(controller.identityContext(preview as never)).toMatchObject({
      developmentIntakeAvailable: true,
    });
    expect(controller.identityContext(runtime as never)).toMatchObject({
      developmentIntakeAvailable: true,
    });
    expect(
      controller.identityContext({
        userContext: { ...runtime.userContext, roles: ['authenticated'] },
      } as never),
    ).toMatchObject({
      developmentIntakeAvailable: false,
    });
  });

  it('routes the tenant-scoped LibraryIndex read through the authenticated actor', async () => {
    const { controller, libraryIndex } = target();

    await expect(
      controller.library('WI-LIBRARY-1', HOST_REQUEST as never),
    ).resolves.toEqual(
      expect.objectContaining({
        scope: 'CURRENT_WORKITEM_ONLY',
      }),
    );
    expect(libraryIndex.read).toHaveBeenCalledWith({
      workItemId: 'WI-LIBRARY-1',
      actor: expect.objectContaining({
        tenantId: 'tenant-2001',
      }),
    });
    const actor = libraryIndex.read.mock.calls[0]?.[0]?.actor;
    expect(actor).toMatchObject({
      userId: 'engineer-1001',
      tenantId: 'tenant-2001',
      appId: 'app_17bzc551rsg',
      env: 'preview',
      objectAccessActor: {
        canonicalSubject: {
          namespace: 'MIAODA_USER_ID',
          id: 'engineer-1001',
        },
        identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
        applicationScopeId: 'app_17bzc551rsg',
      },
    });
  });

  it('requires a logged-in actor before entering the LibraryIndex service', () => {
    const { controller, libraryIndex } = target();
    expectIdentityHandoffUnavailable(() =>
      controller.library('WI-LIBRARY-1', { userContext: null } as never),
    );
    expect(libraryIndex.read).not.toHaveBeenCalled();
  });

  it('passes only ordinary review fields and the authenticated actor', async () => {
    const { engineerReviews, controller } = target();

    await expect(
      controller.recordEngineerReview(
        'WI-SB-1001',
        {
          expectedRevision: 5,
          criterionId: 'JAC-001',
          decision: 'deferred',
          comment: '需要补充受控证据。',
        },
        HOST_REQUEST as never,
      ),
    ).resolves.toEqual({ revision: 6 });

    expect(engineerReviews.recordReview).toHaveBeenCalledWith(
      {
        workItemId: 'WI-SB-1001',
        expectedRevision: 5,
        criterionId: 'JAC-001',
        decision: 'deferred',
        comment: '需要补充受控证据。',
      },
      expect.objectContaining({ userId: 'engineer-1001' }),
    );
  });

  it('accepts a confirmed decision without client supplied status', async () => {
    const { engineerReviews, controller } = target();

    await controller.recordEngineerReview(
      'WI-SB-1001',
      {
        expectedRevision: 5,
        criterionId: 'JAC-001',
        decision: 'confirmed_pass',
        comment: '已复核当前候选。',
      },
      HOST_REQUEST as never,
    );

    expect(engineerReviews.recordReview).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'confirmed_pass' }),
      expect.any(Object),
    );
  });

  it.each([
    [
      {
        expectedRevision: 0,
        criterionId: 'JAC-001',
        decision: 'deferred',
        comment: 'x',
      },
    ],
    [
      {
        expectedRevision: 5,
        criterionId: '',
        decision: 'deferred',
        comment: 'x',
      },
    ],
    [
      {
        expectedRevision: 5,
        criterionId: 'JAC-001',
        decision: 'overridden',
        comment: 'x',
      },
    ],
    [
      {
        expectedRevision: 5,
        criterionId: 'JAC-001',
        decision: 'deferred',
        comment: '',
      },
    ],
    [
      {
        expectedRevision: 5,
        criterionId: 'JAC-001',
        decision: 'deferred',
        comment: 'x',
        status: 'ENGINEER_CONFIRMED',
      },
    ],
  ])('maps malformed engineer input to HTTP 400', async (body) => {
    const { engineerReviews, controller } = target();

    let caught: unknown;
    try {
      await controller.recordEngineerReview(
        'WI-SB-1001',
        body,
        HOST_REQUEST as never,
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).getStatus()).toBe(400);
    expect(engineerReviews.recordReview).not.toHaveBeenCalled();
  });

  it('rejects client-supplied authority fields as HTTP 400', async () => {
    const { engineerReviews, controller } = target();

    expect(() =>
      controller.recordEngineerReview(
        'WI-SB-1001',
        {
          expectedRevision: 5,
          criterionId: 'JAC-001',
          decision: 'deferred',
          comment: 'x',
          permissionSnapshotVersion: 'client-value',
        },
        HOST_REQUEST as never,
      ),
    ).toThrow(BadRequestException);
    expect(engineerReviews.recordReview).not.toHaveBeenCalled();
  });

  it('requires the authenticated host actor for assessment actions', async () => {
    const { engineerReviews, controller } = target();

    expectIdentityHandoffUnavailable(() =>
      controller.recordEngineerReview(
        'WI-SB-1001',
        {
          expectedRevision: 5,
          criterionId: 'JAC-001',
          decision: 'deferred',
          comment: 'x',
        },
        { userContext: null } as never,
      ),
    );
    expect(engineerReviews.recordReview).not.toHaveBeenCalled();
  });

  it('binds authenticated human AEO confirmation to the displayed versions', async () => {
    const { controller, integratedAssessments } = target();

    await expect(
      controller.confirmOpenClawOverallForAeo(
        'WI-SB-1001',
        OVERALL_CONFIRMATION,
        HOST_REQUEST as never,
      ),
    ).resolves.toEqual({ revision: 9 });

    expect(
      integratedAssessments.confirmOpenClawOverallForAeo,
    ).toHaveBeenCalledWith(
      'WI-SB-1001',
      OVERALL_CONFIRMATION,
      expect.objectContaining({ userId: 'engineer-1001' }),
    );
  });

  it('requires the authenticated host actor for AEO confirmation', () => {
    const { controller, integratedAssessments } = target();

    expectIdentityHandoffUnavailable(() =>
      controller.confirmOpenClawOverallForAeo('WI-SB-1001', OVERALL_CONFIRMATION, {
        userContext: null,
      } as never),
    );
    expect(
      integratedAssessments.confirmOpenClawOverallForAeo,
    ).not.toHaveBeenCalled();
  });

  it('rejects client-supplied confirmation identity before the service', () => {
    const { controller, integratedAssessments } = target();

    expect(() =>
      controller.confirmOpenClawOverallForAeo(
        'WI-SB-1001',
        {
          overallArtifactRef: 'artifact://client-value',
          actor: 'client-value',
        },
        HOST_REQUEST as never,
      ),
    ).toThrow(BadRequestException);
    expect(
      integratedAssessments.confirmOpenClawOverallForAeo,
    ).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { ...OVERALL_CONFIRMATION, expectedRevision: '8' },
    { ...OVERALL_CONFIRMATION, expectedOverallRevision: 0 },
    { ...OVERALL_CONFIRMATION, expectedOverallArtifactRef: '' },
    { ...OVERALL_CONFIRMATION, expectedOverallArtifactRef: undefined },
    { ...OVERALL_CONFIRMATION, actor: 'client-actor' },
  ])('rejects malformed displayed Overall bindings before confirmation: %o', (body) => {
    const { controller, integratedAssessments } = target();
    expect(() => controller.confirmOpenClawOverallForAeo(
      'WI-SB-1001', body, HOST_REQUEST as never,
    )).toThrow(BadRequestException);
    expect(integratedAssessments.confirmOpenClawOverallForAeo).not.toHaveBeenCalled();
  });

  it('exposes AEO candidate generation only as an authenticated empty-body action', async () => {
    const { controller, aeo } = target();

    await expect(
      controller.generateAeoCandidate('WI-SB-1001', {}, HOST_REQUEST as never),
    ).resolves.toEqual({ status: 'CANDIDATE_WORD_EXPORTED' });
    expect(aeo.generateCandidate).toHaveBeenCalledWith(
      'WI-SB-1001',
      expect.objectContaining({ userId: 'engineer-1001' }),
    );
  });

  it('rejects a client-supplied AEO target or authority before the service', () => {
    const { controller, aeo } = target();

    expect(() =>
      controller.generateAeoCandidate(
        'WI-SB-1001',
        { targetIdentity: 'AEO-CLIENT', authority: 'CLIENT' },
        HOST_REQUEST as never,
      ),
    ).toThrow(BadRequestException);
    expect(aeo.generateCandidate).not.toHaveBeenCalled();
  });
});

function expectIdentityHandoffUnavailable(action: () => unknown): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({
    code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
    statusCode: 503,
  });
}

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
