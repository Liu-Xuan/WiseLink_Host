import 'reflect-metadata';

// Same mock strategy as identity-whoami.spec.ts: no-op the class/method/param
// decorators that crash under ts-jest's stage-3 ES decorator output (the
// platform preset tsconfig does NOT enable experimentalDecorators), but keep
// @Module real so we can inspect its metadata.
jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOpDecorator = () => () => undefined;
  return {
    ...actual,
    Controller: noOpDecorator,
    Get: noOpDecorator,
    Inject: noOpDecorator,
    Req: noOpDecorator,
    Res: noOpDecorator,
    Query: noOpDecorator,
    Param: noOpDecorator,
    HttpCode: noOpDecorator,
    HttpException: actual.HttpException,
    HttpStatus: actual.HttpStatus,
    Logger: actual.Logger,
  };
});

jest.mock('@lark-apaas/fullstack-nestjs-core', () => {
  const actual = jest.requireActual('@lark-apaas/fullstack-nestjs-core');
  return {
    ...actual,
    NeedLogin: () => () => undefined,
  };
});

import { IDENTITY_VERIFICATION } from '../../server/modules/identity/identity-verification.port';
import { UnavailableIdentityVerificationAdapter } from '../../server/modules/identity/identity-verification.port';
import { IdentityModule } from '../../server/modules/identity/identity.module';
import { WhoamiController } from '../../server/modules/identity/whoami.controller';
import type { WhoamiResponse } from '../../server/modules/identity/identity.types';

/**
 * Metadata-level wiring checks — verify IdentityModule's @Module decorator
 * registers the correct controller and provider token. The @Module decorator
 * is kept real (via jest.requireActual), so it writes Reflect metadata that
 * we can inspect without booting a NestJS container.
 */
describe('IdentityModule @Module metadata wiring', () => {
  it('registers WhoamiController in controllers', () => {
    const metadata = Reflect.getMetadata(
      'controllers',
      IdentityModule,
    ) as unknown[] | undefined;
    expect(metadata).toBeDefined();
    expect(metadata).toContain(WhoamiController);
  });

  it('registers IDENTITY_VERIFICATION → UnavailableIdentityVerificationAdapter in providers', () => {
    const metadata = Reflect.getMetadata(
      'providers',
      IdentityModule,
    ) as unknown[] | undefined;
    expect(metadata).toBeDefined();

    const tokenProvider = metadata!.find(
      (p): p is { provide: symbol; useClass: unknown } =>
        typeof p === 'object' &&
        p !== null &&
        'provide' in p &&
        (p as { provide: unknown }).provide === IDENTITY_VERIFICATION,
    );
    expect(tokenProvider).toBeDefined();
    expect(tokenProvider!.useClass).toBe(
      UnavailableIdentityVerificationAdapter,
    );
  });

  it('does NOT register any real-verification adapter (fail-closed default)', () => {
    const metadata = Reflect.getMetadata(
      'providers',
      IdentityModule,
    ) as unknown[] | undefined;
    expect(metadata).toBeDefined();

    // Every provider must either be the UnavailableIdentityVerificationAdapter
    // or a non-identity-verification value. No "real" adapter should sneak in.
    for (const p of metadata!) {
      if (
        typeof p === 'object' &&
        p !== null &&
        'useClass' in p &&
        'provide' in p &&
        (p as { provide: unknown }).provide === IDENTITY_VERIFICATION
      ) {
        const cls = (p as { useClass: unknown }).useClass;
        expect(cls).toBe(UnavailableIdentityVerificationAdapter);
      }
    }
  });
});

/**
 * Composition test — manually instantiate WhoamiController with the
 * UnavailableIdentityVerificationAdapter (the same adapter the @Module
 * metadata registers), then exercise the whoami() method end-to-end.
 *
 * We avoid Test.createTestingModule() because the platform tsconfig does
 * not enable experimentalDecorators / emitDecoratorMetadata, so ts-jest's
 * stage-3 ES decorator output is incompatible with NestJS's legacy DI
 * container (@Get crashes on class load; design:paramtypes metadata is
 * absent so @Inject can't resolve). Manual instantiation bypasses DI
 * entirely and tests the actual behavioral contract.
 */
describe('IdentityModule composition (manual wiring)', () => {
  let controller: WhoamiController;

  beforeEach(() => {
    controller = new WhoamiController(new UnavailableIdentityVerificationAdapter());
  });

  it('produces a fail-closed WhoamiResponse for a normal user context', async () => {
    const response: WhoamiResponse = await controller.whoami({
      userContext: {
        userId: 'engineer-1001',
        tenantId: 2001,
        appId: 'app_17bzc551rsg',
        roles: ['authenticated', 'wiselink_development'],
        env: 'development',
      },
    } as never);

    expect(response.verifiedIdentity).toBeNull();
    expect(response.objectAccessStatus).toBe('UNAVAILABLE_503');
    expect(response.session).toBeNull();
    expect(response.claimedContext.miaodaUserId).toBe('engineer-1001');
    expect(response.claimedContext.isSystemAccount).toBe(false);
  });

  it('produces a fail-closed response even with a forged body payload', async () => {
    const response = await controller.whoami({
      userContext: {
        userId: 'engineer-1001',
        tenantId: 2001,
        appId: 'app_17bzc551rsg',
        roles: ['authenticated', 'admin'],
        env: 'production',
      },
      body: {
        namespacedSubject: {
          namespace: 'FEISHU_OPEN_ID',
          subject: 'ou_forged_0001',
          tenantKey: 'forged_tenant_key',
        },
        provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
        verifiedAt: '2026-08-21T00:00:00.000Z',
      },
    } as never);

    expect(response.verifiedIdentity).toBeNull();
    expect(response.objectAccessStatus).toBe('UNAVAILABLE_503');
  });

  it('marks system/bot accounts as claimedContext.isSystemAccount but still fail-closed', async () => {
    const response = await controller.whoami({
      userContext: {
        userId: 'system_scheduler_001',
        tenantId: 2001,
        appId: 'app_17bzc551rsg',
        roles: ['authenticated', 'admin'],
        env: 'production',
        isSystemAccount: true,
      },
    } as never);

    expect(response.verifiedIdentity).toBeNull();
    expect(response.claimedContext.isSystemAccount).toBe(true);
    expect(response.objectAccessStatus).toBe('UNAVAILABLE_503');
  });
});

/**
 * Fail-closed invariant — the UnavailableIdentityVerificationAdapter must
 * ALWAYS return UNAVAILABLE regardless of input, ensuring no verified
 * identity can escape the module in its default (G0) configuration.
 */
describe('IdentityModule fail-closed invariant', () => {
  it('UnavailableIdentityVerificationAdapter always returns UNAVAILABLE', async () => {
    const adapter = new UnavailableIdentityVerificationAdapter();

    const inputs = [
      { contextUserId: 'engineer-1001', contextTenantId: '2001' },
      { contextUserId: 'admin-0000', contextTenantId: '9999' },
      { contextUserId: 'bot_scheduler', contextTenantId: '0' },
      { contextUserId: '', contextTenantId: '' },
      { contextUserId: 'ou_forged_0001', contextTenantId: 'forged_tenant' },
    ];

    for (const input of inputs) {
      const result = await adapter.verify(input);
      expect(result.kind).toBe('UNAVAILABLE');
    }
  });
});
