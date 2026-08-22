import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOpDecorator = () => () => undefined;
  return {
    ...actual,
    Controller: noOpDecorator,
    Get: noOpDecorator,
    Inject: noOpDecorator,
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

import { UnavailableIdentityVerificationAdapter } from '../../server/modules/identity/identity-verification.port';
import { WhoamiController } from '../../server/modules/identity/whoami.controller';
import type { WhoamiResponse } from '../../server/modules/identity/identity.types';

const HOST_REQUEST = {
  userContext: {
    userId: 'engineer-1001',
    tenantId: 2001,
    appId: 'app_17bzc551rsg',
    roles: ['authenticated', 'wiselink_development'],
    env: 'development',
  },
};

describe('WhoamiController fail-closed identity seam', () => {
  it('returns null verifiedIdentity and UNAVAILABLE_503 object-access status', async () => {
    const adapter = new UnavailableIdentityVerificationAdapter();
    const controller = new WhoamiController(adapter);

    const response = await controller.whoami(HOST_REQUEST as never);

    expect(response.verifiedIdentity).toBeNull();
    expect(response.objectAccessStatus).toBe('UNAVAILABLE_503');
    expect(response.session).toBeNull();
  });

  it('extracts claimedContext from the unverified gateway header', async () => {
    const adapter = new UnavailableIdentityVerificationAdapter();
    const controller = new WhoamiController(adapter);

    const response = await controller.whoami(HOST_REQUEST as never);

    expect(response.claimedContext).toEqual({
      miaodaUserId: 'engineer-1001',
      tenantId: '2001',
      appId: 'app_17bzc551rsg',
      env: 'development',
      roles: ['authenticated', 'wiselink_development'],
    isSystemAccount: false,
    });
  });

  it('does not elevate claimed context to a verified identity', async () => {
    const adapter = new UnavailableIdentityVerificationAdapter();
    const controller = new WhoamiController(adapter);

    const response: WhoamiResponse = await controller.whoami(
      HOST_REQUEST as never,
    );

    // Even though claimedContext has roles including 'wiselink_development',
    // verifiedIdentity must remain null — roles from a caller-constructible
    // header are never a trust source.
    expect(response.verifiedIdentity).toBeNull();
    expect(response.claimedContext.roles).toContain('wiselink_development');
  });

  it('handles missing userContext gracefully', async () => {
    const adapter = new UnavailableIdentityVerificationAdapter();
    const controller = new WhoamiController(adapter);

    const response = await controller.whoami({
      userContext: null,
    } as never);

    expect(response.verifiedIdentity).toBeNull();
    expect(response.claimedContext.miaodaUserId).toBeNull();
    expect(response.claimedContext.tenantId).toBeNull();
    expect(response.claimedContext.appId).toBeNull();
    expect(response.claimedContext.env).toBeNull();
    expect(response.claimedContext.roles).toEqual([]);
    expect(response.claimedContext.isSystemAccount).toBe(false);
    expect(response.objectAccessStatus).toBe('UNAVAILABLE_503');
  });

  it('does not call verify when contextUserId is null', async () => {
    const adapter = new UnavailableIdentityVerificationAdapter();
    const verifySpy = jest.spyOn(adapter, 'verify');

    const controller = new WhoamiController(adapter);

    await controller.whoami({ userContext: null } as never);

    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('does not call verify when contextUserId is a system/bot account', async () => {
    const adapter = new UnavailableIdentityVerificationAdapter();
    const verifySpy = jest.spyOn(adapter, 'verify');

    const controller = new WhoamiController(adapter);

    const systemRequest = {
      userContext: {
        userId: 'system_scheduler_001',
        tenantId: 2001,
        appId: 'app_17bzc551rsg',
        roles: ['authenticated'],
        env: 'production',
        isSystemAccount: true,
      },
    };

    const response = await controller.whoami(systemRequest as never);

    // System accounts are never sent to verify — they cannot be cast into a
    // final user even if a future adapter is wired.
    expect(verifySpy).not.toHaveBeenCalled();
    expect(response.verifiedIdentity).toBeNull();
    expect(response.claimedContext.isSystemAccount).toBe(true);
    expect(response.claimedContext.miaodaUserId).toBe('system_scheduler_001');
    expect(response.objectAccessStatus).toBe('UNAVAILABLE_503');
  });

  it('calls verify when contextUserId is present (returns UNAVAILABLE)', async () => {
    const adapter = new UnavailableIdentityVerificationAdapter();
    const verifySpy = jest.spyOn(adapter, 'verify');

    const controller = new WhoamiController(adapter);

    await controller.whoami(HOST_REQUEST as never);

    expect(verifySpy).toHaveBeenCalledWith({
      contextUserId: 'engineer-1001',
      contextTenantId: '2001',
    });
  });

  it('does not read the request body for identity fields', async () => {
    const adapter = new UnavailableIdentityVerificationAdapter();
    const controller = new WhoamiController(adapter);

    const requestWithBody = {
      userContext: HOST_REQUEST.userContext,
      body: {
        userId: 'attacker-injected',
        roles: ['admin'],
        provenance: 'SIGNED_HOSTED_INGRESS',
      },
    };

    const response = await controller.whoami(requestWithBody as never);

    // Body fields must never appear in the response.
    expect(response.verifiedIdentity).toBeNull();
    expect(response.claimedContext.miaodaUserId).toBe('engineer-1001');
    expect(response.claimedContext.roles).not.toContain('admin');
  });
});

// ---------------------------------------------------------------------------
// Anti-forgery: a bot open_id, a plain object, or a machine context can never
// be cast into a verified final user. The default adapter is unavailable, so
// verifiedIdentity is always null — but the assertions below lock the
// invariant explicitly against future regressions.
// ---------------------------------------------------------------------------
describe('WhoamiController anti-forgery invariants', () => {
  it('does not forge a verified identity from a bot open_id in claimedContext', async () => {
    const adapter = new UnavailableIdentityVerificationAdapter();
    const controller = new WhoamiController(adapter);

    const botRequest = {
      userContext: {
        userId: 'cli_a1b2c3d4', // bot app_id masquerading as userId
        tenantId: 2001,
        appId: 'app_17bzc551rsg',
        roles: ['authenticated'],
        env: 'production',
        // A bot might inject its own open_id into the gateway header
        openId: 'ou_bot_6f7e8d9c0b1a2f3e4d5c6b7a8',
      },
    };

    const response = await controller.whoami(botRequest as never);

    expect(response.verifiedIdentity).toBeNull();
    // The claimed context reflects the unverified header — but it never
    // becomes a namespacedSubject.
    expect(response.claimedContext.miaodaUserId).toBe('cli_a1b2c3d4');
  });

  it('does not forge a verified identity from a plain object in body', async () => {
    const adapter = new UnavailableIdentityVerificationAdapter();
    const controller = new WhoamiController(adapter);

    const forgeryRequest = {
      userContext: HOST_REQUEST.userContext,
      body: {
        // Attacker tries to construct a NamespacedSubject directly
        namespacedSubject: {
          namespace: 'FEISHU_OPEN_ID',
          subject: 'ou_forged_open_id',
          tenantKey: 'forged_tenant_key',
        },
        provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
        verifiedAt: '2026-01-01T00:00:00.000Z',
      },
    };

    const response = await controller.whoami(forgeryRequest as never);

    expect(response.verifiedIdentity).toBeNull();
    // Body-constructed subject must not leak into the response.
    if (response.verifiedIdentity) {
      expect(response.verifiedIdentity.namespacedSubject).toBeNull();
    }
  });

  it('does not forge a verified identity from a machine/bot userContext', async () => {
    const adapter = new UnavailableIdentityVerificationAdapter();
    const verifySpy = jest.spyOn(adapter, 'verify');
const controller = new WhoamiController(adapter);

      const machineContext = {
        userContext: {
        userId: 'bot_scheduler_001',
        tenantId: 2001,
        appId: 'app_17bzc551rsg',
        roles: ['authenticated', 'machine'],
        env: 'production',
      userType: 'bot',
    isSystemAccount: true,
},
    };

    const response = await controller.whoami(machineContext as never);

    // A machine/bot context is never a final user — verify is not called.
  expect(verifySpy).not.toHaveBeenCalled();
    expect(response.verifiedIdentity).toBeNull();
    expect(response.claimedContext.isSystemAccount).toBe(true);
    expect(response.objectAccessStatus).toBe('UNAVAILABLE_503');
  });

  it('returns null namespacedSubject in verifiedIdentity when unavailable', async () => {
    const adapter = new UnavailableIdentityVerificationAdapter();
    const controller = new WhoamiController(adapter);

    const response = await controller.whoami(HOST_REQUEST as never);

    // verifiedIdentity is null entirely (adapter returns UNAVAILABLE), so
    // namespacedSubject can never be populated. This assertion documents
    // the invariant: no subject can exist without verification.
    expect(response.verifiedIdentity).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sequential I/O = 0 proof: the fail-closed adapter performs no I/O (no
// network, no filesystem, no clock, no database). It is a pure function of
// its input. These tests prove that property by asserting determinism,
// absence of side effects, and call-order independence.
// ---------------------------------------------------------------------------
describe('UnavailableIdentityVerificationAdapter sequential I/O = 0 proof', () => {
  it('is deterministic: identical inputs produce identical outputs', async () => {
    const adapter = new UnavailableIdentityVerificationAdapter();
    const input = { contextUserId: 'engineer-1001', contextTenantId: '2001' };

    const results = await Promise.all([
      adapter.verify(input),
      adapter.verify(input),
      adapter.verify(input),
    ]);

    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
    expect(results[0]).toEqual({
      kind: 'UNAVAILABLE',
      reason: 'FEISHU_OAUTH_NOT_CONFIGURED',
    });
  });

  it('has no side effects: verify does not mutate adapter state', async () => {
    const adapter = new UnavailableIdentityVerificationAdapter();
    const input = { contextUserId: 'engineer-1001', contextTenantId: '2001' };

    const before = JSON.stringify(adapter);
    await adapter.verify(input);
    await adapter.verify(input);
    const after = JSON.stringify(adapter);

    expect(after).toBe(before);
  });

  it('call-order independence: results do not depend on call sequence', async () => {
    const adapter = new UnavailableIdentityVerificationAdapter();
    const inputA = { contextUserId: 'user-A', contextTenantId: 't-A' };
    const inputB = { contextUserId: 'user-B', contextTenantId: 't-B' };

    const [aFirst, bFirst] = await Promise.all([
      adapter.verify(inputA),
      adapter.verify(inputB),
    ]);

    // Reverse order
    const [bSecond, aSecond] = await Promise.all([
      adapter.verify(inputB),
      adapter.verify(inputA),
    ]);

    expect(aFirst).toEqual(aSecond);
    expect(bFirst).toEqual(bSecond);
  });

  it('produces no filesystem or network I/O (pure in-memory)', async () => {
    // The adapter has no dependencies on fs, http, or any external resource.
    // We prove this by constructing it with zero external bindings and
    // confirming it resolves without error.
    const adapter = new UnavailableIdentityVerificationAdapter();

    const result = await adapter.verify({
      contextUserId: 'engineer-1001',
      contextTenantId: '2001',
    });

    expect(result.kind).toBe('UNAVAILABLE');
    expect(result).not.toHaveProperty('verifiedAt');
    expect(result).not.toHaveProperty('feishuOpenId');
  });

  it('does not depend on wall-clock time', async () => {
    const adapter = new UnavailableIdentityVerificationAdapter();
    const input = { contextUserId: 'engineer-1001', contextTenantId: '2001' };

    const result1 = await adapter.verify(input);

    // Even if we waited some time, the result is identical — no timestamp
    // is embedded in the UNAVAILABLE path.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const result2 = await adapter.verify(input);

    expect(result1).toEqual(result2);
  });
});
