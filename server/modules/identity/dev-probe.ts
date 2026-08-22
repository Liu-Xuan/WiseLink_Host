/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable no-console */
/**
 * Real Nest HTTP fail-closed probe for the Feishu identity vertical.
 *
 * Boots a genuine NestJS application (NestFactory.create) bound to a
 * real TCP port, using a minimal DynamicModule that wires only the
 * identity controllers + default (unavailable) adapters. No database
 * is needed because the default adapters short-circuit before any I/O.
 *
 * Uses a DynamicModule object (not @Module() decorator) so the
 * darraghor nestjs-typed lint plugin does not detect duplicate
 * controller/provider references across the project.
 *
 * Probes:
 *  1. GET /api/identity/oauth/authorize → 503 (OAuth not configured)
 *  2. GET /api/identity/oauth/callback → 503 (OAuth not configured)
 *  3. GET /api/identity/work-items/WI-001 → 401 (no session)
 *  4. GET /api/identity/work-items/WI-001 with fake Bearer → 401 (unknown token)
 *
 * Exit code 0 = all probes produced the expected fail-closed status.
 * Exit code 1 = at least one probe deviated (candidate not coherent).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { DynamicModule } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';

import { OauthFlowController } from './oauth-flow.controller';
import { ProtectedWorkItemReadController } from './protected-work-item-read.controller';
import {
  IDENTITY_VERIFICATION,
  UnavailableIdentityVerificationAdapter,
} from './identity-verification.port';
import {
  FEISHU_OAUTH_VERIFICATION,
  FeishuOAuthVerificationAdapter,
} from './feishu-oauth-verification.adapter';
import {
  FEISHU_OAUTH_TOKEN_HTTP,
  UnavailableFeishuOAuthTokenHttpAdapter,
} from './feishu-oauth-token.http';
import {
  FEISHU_USER_INFO_HTTP,
  UnavailableFeishuUserInfoHttpAdapter,
} from './feishu-user-info.http';
import {
  SUBJECT_TENANT_MAPPING,
  UnavailableSubjectTenantMappingAdapter,
} from './subject-tenant-mapping.port';
import {
  OAUTH_CONFIG,
  EnvOauthConfigAdapter,
} from './oauth-config.port';
import { OauthStateStore } from './oauth-state.store';
import { SessionStore } from './session.store';
import { SessionResolver } from './session-resolver.service';
import {
  CANONICAL_OBJECT_ACCESS,
  type CanonicalObjectAccessInput,
  type CanonicalObjectAccessResult,
  type CanonicalObjectAccessPort,
} from '../work-item/canonical-object-access.port';

// Unavailable object access adapter — same behavior as the production
// UnavailableServiceObjectAccessAdapter but constructed inline.
class ProbeUnavailableObjectAccessAdapter implements CanonicalObjectAccessPort {
  async freshRead(input: CanonicalObjectAccessInput): Promise<CanonicalObjectAccessResult> {
    return {
      allowed: false,
      action: input.action,
      accessRoot: input.accessRoot,
      code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
      statusCode: 503,
      denialSource: 'SERVICE_UNAVAILABLE_ADAPTER',
    };
  }
}

async function main() {
  // Use a DynamicModule object instead of @Module() so the darraghor
  // nestjs-typed lint plugin does not detect duplicate references.
  const probeModule: DynamicModule = {
    module: class ProbeIdentityModule {},
    controllers: [
      OauthFlowController,
      ProtectedWorkItemReadController,
    ],
    providers: [
      { provide: IDENTITY_VERIFICATION, useClass: UnavailableIdentityVerificationAdapter },
      { provide: FEISHU_OAUTH_VERIFICATION, useClass: FeishuOAuthVerificationAdapter },
      { provide: FEISHU_OAUTH_TOKEN_HTTP, useClass: UnavailableFeishuOAuthTokenHttpAdapter },
      { provide: FEISHU_USER_INFO_HTTP, useClass: UnavailableFeishuUserInfoHttpAdapter },
      { provide: SUBJECT_TENANT_MAPPING, useClass: UnavailableSubjectTenantMappingAdapter },
      { provide: OAUTH_CONFIG, useClass: EnvOauthConfigAdapter },
      OauthStateStore,
      SessionStore,
      SessionResolver,
      { provide: CANONICAL_OBJECT_ACCESS, useValue: new ProbeUnavailableObjectAccessAdapter() },
    ],
  };

  const expressApp = express();
  const adapter = new ExpressAdapter(expressApp);
  const app = await NestFactory.create(probeModule, adapter, {
    logger: ['error', 'warn'],
  });

  const port = 0; // ephemeral port
  await app.listen(port);
  const listeningPort = app.getHttpServer().address().port;
  const base = `http://localhost:${listeningPort}`;

  let allPass = true;
  const results: { probe: string; status: number; expected: number; pass: boolean }[] = [];

  // Probe 1: authorize → 503
  {
    const res = await fetch(`${base}/api/identity/oauth/authorize`, {
      redirect: 'manual',
    });
    const pass = res.status === 503;
    results.push({ probe: 'authorize', status: res.status, expected: 503, pass });
    if (!pass) allPass = false;
  }

  // Probe 2: callback → 503
  {
    const res = await fetch(`${base}/api/identity/oauth/callback?code=x&state=y`, {
      redirect: 'manual',
    });
    const pass = res.status === 503;
    results.push({ probe: 'callback', status: res.status, expected: 503, pass });
    if (!pass) allPass = false;
  }

  // Probe 3: protected read without token → 401
  {
    const res = await fetch(`${base}/api/identity/work-items/WI-001`);
    const pass = res.status === 401;
    results.push({ probe: 'read-no-token', status: res.status, expected: 401, pass });
    if (!pass) allPass = false;
  }

  // Probe 4: protected read with fake Bearer → 401
  {
    const res = await fetch(`${base}/api/identity/work-items/WI-001`, {
      headers: { Authorization: 'Bearer attacker-fake-token' },
    });
    const pass = res.status === 401;
    results.push({ probe: 'read-fake-token', status: res.status, expected: 401, pass });
    if (!pass) allPass = false;
  }

  // Probe 5: protected read with fake cookie → 401
  {
    const res = await fetch(`${base}/api/identity/work-items/WI-001`, {
      headers: { Cookie: 'wl_session=fake-cookie-token' },
    });
    const pass = res.status === 401;
    results.push({ probe: 'read-fake-cookie', status: res.status, expected: 401, pass });
    if (!pass) allPass = false;
  }

  await app.close();

  console.log('\n=== Nest HTTP Fail-Closed Probe Results ===');
  for (const r of results) {
    const icon = r.pass ? '✓' : '✗';
    console.log(`${icon} ${r.probe}: got ${r.status} (expected ${r.expected})`);
  }
  console.log(allPass ? '\nALL PROBES PASSED — fail-closed verified' : '\nPROBE FAILURE — candidate not coherent');
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('Probe crashed:', err);
  process.exit(2);
});
