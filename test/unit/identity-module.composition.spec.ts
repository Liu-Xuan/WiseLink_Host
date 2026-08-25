import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOp = () => () => undefined;
  return {
    ...actual,
    Controller: noOp, Get: noOp, Post: noOp, Inject: noOp,
    Req: noOp, Res: noOp, Query: noOp, Param: noOp, HttpCode: noOp,
  };
});

import { IdentityModule } from '../../server/modules/identity/identity.module';
import { WhoamiController } from '../../server/modules/identity/whoami.controller';
import { OauthFlowController } from '../../server/modules/identity/oauth-flow.controller';
import { ProtectedWorkItemReadController } from '../../server/modules/identity/protected-work-item-read.controller';
import {
  IDENTITY_VERIFICATION,
  UnavailableIdentityVerificationAdapter,
} from '../../server/modules/identity/identity-verification.port';
import { FEISHU_OAUTH_TOKEN_HTTP, HttpFeishuOAuthTokenAdapter } from '../../server/modules/identity/feishu-oauth-token.http';
import { FEISHU_USER_INFO_HTTP, HttpFeishuUserInfoAdapter } from '../../server/modules/identity/feishu-user-info.http';
import { SUBJECT_TENANT_MAPPING, DatabaseSubjectTenantMappingAdapter } from '../../server/modules/identity/subject-tenant-mapping.port';
import { IdentityRepository } from '../../server/modules/identity/identity.repository';
import { OauthStateStore } from '../../server/modules/identity/oauth-state.store';
import { SessionStore } from '../../server/modules/identity/session.store';
import { SessionResolver } from '../../server/modules/identity/session-resolver.service';

describe('IdentityModule official OAuth composition', () => {
  const controllers = () => Reflect.getMetadata('controllers', IdentityModule) as unknown[];
  const providers = () => Reflect.getMetadata('providers', IdentityModule) as unknown[];

  it('registers whoami, OAuth, and protected WorkItem controllers', () => {
    expect(controllers()).toEqual(expect.arrayContaining([
      WhoamiController, OauthFlowController, ProtectedWorkItemReadController,
    ]));
  });

  it('keeps caller/gateway identity verification fail-closed', () => {
    expect(tokenProvider(IDENTITY_VERIFICATION)).toMatchObject({
      useClass: UnavailableIdentityVerificationAdapter,
    });
  });

  it('wires the production official OAuth token HTTP adapter', () => {
    const provider = tokenProvider(FEISHU_OAUTH_TOKEN_HTTP) as { useFactory: () => unknown };
    expect(provider.useFactory()).toBeInstanceOf(HttpFeishuOAuthTokenAdapter);
  });

  it('wires the production official user_info HTTP adapter', () => {
    const provider = tokenProvider(FEISHU_USER_INFO_HTTP) as { useFactory: () => unknown };
    expect(provider.useFactory()).toBeInstanceOf(HttpFeishuUserInfoAdapter);
  });

  it('wires Host DB subject mapping rather than caller fields', () => {
    expect(tokenProvider(SUBJECT_TENANT_MAPPING)).toMatchObject({
      useClass: DatabaseSubjectTenantMappingAdapter,
    });
  });

  it('registers persistent repository, state, session, and resolver providers', () => {
    expect(providers()).toEqual(expect.arrayContaining([
      IdentityRepository, OauthStateStore, SessionStore, SessionResolver,
    ]));
  });

  it('exports only the server SessionResolver identity seam', () => {
    const exports = Reflect.getMetadata('exports', IdentityModule) as unknown[];
    expect(exports).toContain(SessionResolver);
    expect(exports).not.toContain(UnavailableIdentityVerificationAdapter);
  });

  it('whoami fails closed for a normal gateway context without a session', async () => {
    const resolver = { resolve: jest.fn().mockResolvedValue(null) };
    await expect(new WhoamiController(resolver as never).whoami({
      userContext: { userId: 'engineer-1', tenantId: 'tenant-1' },
    } as never)).rejects.toMatchObject({ status: 401 });
  });

  it('whoami fails closed for forged body authority without a session', async () => {
    const resolver = { resolve: jest.fn().mockResolvedValue(null) };
    await expect(new WhoamiController(resolver as never).whoami({
      body: {
        provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
        miaodaUserId: 'forged',
        tenantId: 'forged',
      },
    } as never)).rejects.toMatchObject({ status: 401 });
  });

  it('whoami does not cast a system/bot context into a final user', async () => {
    const resolver = { resolve: jest.fn().mockResolvedValue(null) };
    await expect(new WhoamiController(resolver as never).whoami({
      userContext: { userId: 'system-bot', isSystemAccount: true, roles: ['admin'] },
    } as never)).rejects.toMatchObject({ status: 401 });
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
  });

  it('keeps the legacy caller/gateway verification adapter fail-closed for every input', async () => {
    const adapter = new UnavailableIdentityVerificationAdapter();
    for (const input of [
      { contextUserId: 'normal-user', contextTenantId: 'tenant-1' },
      { contextUserId: 'system-bot', contextTenantId: 'tenant-1' },
      { contextUserId: 'agent_4km47c77ujwqphg', contextTenantId: 'tenant-1' },
      { contextUserId: 'forged-user', contextTenantId: 'forged-tenant' },
    ]) {
      await expect(adapter.verify(input)).resolves.toEqual({
        kind: 'UNAVAILABLE',
        reason: 'FEISHU_OAUTH_NOT_CONFIGURED',
      });
    }
  });

  function tokenProvider(token: symbol) {
    return providers().find((value) =>
      typeof value === 'object' && value !== null &&
      'provide' in value && (value as { provide: unknown }).provide === token,
    ) as Record<string, unknown>;
  }
});
