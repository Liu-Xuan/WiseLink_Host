import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { AuthNPaasService } from '@lark-apaas/fullstack-nestjs-core';
import * as jsonwebtoken from 'jsonwebtoken';

import type { CanonicalAilyFinalUserActorContext } from '../work-item/canonical-object-access.port';
import {
  CANONICAL_AILY_AGENT_ID,
  CANONICAL_MIAODA_APP_ID,
} from './canonical-host.constants';

export const AILY_IDENTITY_JWT_SECRET = Symbol('AILY_IDENTITY_JWT_SECRET');
export const AILY_IDENTITY_JWT_SECRET_ENV =
  'WL_AILY_IDENTITY_JWT_SECRET' as const;

export interface VerifiedAilyFinalUserIdentity {
  actor: CanonicalAilyFinalUserActorContext;
  actorFingerprint: string;
  agentId: string;
  tokenExpiresAt: string;
}

/**
 * Thin adapter for Aily's native x-aily-jwt contract. `jsonwebtoken` performs
 * the cryptographic verification; AuthNPaasService performs the platform ID
 * conversion. No message/session lookup or tenant-token exchange is needed.
 */
@Injectable()
// Retained as disabled legacy code; no module registers this custom protocol.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class AilyNativeFinalUserIdentityService {
  constructor(
    private readonly authn: AuthNPaasService,
    @Inject(AILY_IDENTITY_JWT_SECRET)
    private readonly identityJwtSecret: string | null,
  ) {}

  async verifyAndMap(
    token: string | undefined,
  ): Promise<VerifiedAilyFinalUserIdentity> {
    const secret = this.identityJwtSecret;
    if (!secret) {
      throw identityError(
        'AILY_IDENTITY_JWT_SECRET_UNAVAILABLE',
        503,
        `Missing hosted secret ${AILY_IDENTITY_JWT_SECRET_ENV}.`,
      );
    }
    if (!token || token.length > 16_384) {
      throw identityError(
        'AILY_SIGNED_IDENTITY_MISSING',
        401,
        'Missing Aily signed identity.',
      );
    }

    let verifiedPayload: jsonwebtoken.JwtPayload;
    try {
      const verified = jsonwebtoken.verify(token, secret, {
        algorithms: ['HS256'],
      });
      if (typeof verified === 'string') throw new Error('JWT_PAYLOAD_INVALID');
      verifiedPayload = verified;
    } catch {
      throw identityError(
        'AILY_SIGNED_IDENTITY_INVALID',
        401,
        'Invalid or expired Aily signed identity.',
      );
    }

    const claims = exactIdentifierClaims(token);
    if (
      typeof verifiedPayload.exp !== 'number' ||
      !Number.isSafeInteger(verifiedPayload.exp) ||
      verifiedPayload.exp !== claims.exp
    ) {
      throw identityError(
        'AILY_SIGNED_IDENTITY_CLAIMS_INVALID',
        401,
        'Invalid Aily identity claims.',
      );
    }
    if (claims.agentId !== CANONICAL_AILY_AGENT_ID) {
      throw identityError(
        'AILY_SIGNED_IDENTITY_AGENT_NOT_ALLOWED',
        401,
        'Aily agent is not allowed.',
      );
    }

    let mapped: (string | null)[];
    try {
      mapped = await this.authn.getBatchMiaodaUserIds([claims.feishuUserId]);
    } catch {
      throw identityError(
        'AILY_MIAODA_ID_CONVERSION_UNAVAILABLE',
        503,
        'Miaoda user identity conversion is unavailable.',
      );
    }
    const miaodaUserId = cleanId(mapped[0]);
    if (!miaodaUserId || mapped.length !== 1) {
      throw identityError(
        'AILY_MIAODA_ID_CONVERSION_UNAVAILABLE',
        503,
        'Miaoda user identity conversion is unavailable.',
      );
    }

    const decidedAt = new Date().toISOString();
    const tokenExpiresAt = new Date(claims.exp * 1_000).toISOString();
    const actor: CanonicalAilyFinalUserActorContext = {
      principalKind: 'FINAL_USER',
      transport: 'AILY_SIGNED_MCP_HTTP',
      canonicalSubject: { namespace: 'MIAODA_USER_ID', id: miaodaUserId },
      subjectDecision: {
        source: 'AILY_SIGNED_JWT_AND_MIAODA_AUTHNPAAS_ID_CONVERT',
        applicationScopeId: CANONICAL_MIAODA_APP_ID,
        tenantId: claims.tenantId,
        version: 'aily-jwt-hs256.authnpaas-user-convert.v1',
        decidedAt,
      },
      tenantId: claims.tenantId,
      applicationScopeId: CANONICAL_MIAODA_APP_ID,
      applicationScopeProvenance: 'HOST_CONFIGURED_MIAODA_APP_ID',
      workspaceId: null,
      workspaceProvenance: 'UNAVAILABLE',
      env: hostedEnvironment(),
      platformRoles: [],
      identityProvenance: 'AILY_SIGNED_JWT',
      feishuUserId: claims.feishuUserId,
      feishuOpenId: null,
      feishuIdentityProvenance: 'AILY_SIGNED_JWT',
      agentId: claims.agentId,
      tokenExpiresAt,
      sessionId: null,
      sessionRevision: null,
      sessionProvenance: 'UNAVAILABLE',
    };
    return {
      actor,
      actorFingerprint: digest(
        JSON.stringify({
          canonicalSubject: actor.canonicalSubject,
          tenantId: actor.tenantId,
          applicationScopeId: actor.applicationScopeId,
          identityProvenance: actor.identityProvenance,
        }),
      ),
      agentId: claims.agentId,
      tokenExpiresAt,
    };
  }
}

export function ailyIdentityJwtSecretFromEnv(): string | null {
  const value = process.env[AILY_IDENTITY_JWT_SECRET_ENV];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

interface ExactAilyClaims {
  feishuUserId: string;
  tenantId: string;
  agentId: string;
  exp: number;
}

function exactIdentifierClaims(token: string): ExactAilyClaims {
  const segments = token.split('.');
  if (segments.length !== 3) throw invalidClaims();
  let raw: string;
  try {
    raw = Buffer.from(segments[1]!, 'base64url').toString('utf8');
  } catch {
    throw invalidClaims();
  }

  let payload: unknown;
  try {
    const parseWithSource = JSON.parse as unknown as (
      text: string,
      reviver: (
        key: string,
        value: unknown,
        context?: { source?: string },
      ) => unknown,
    ) => unknown;
    payload = parseWithSource(raw, (key, value, context) => {
      if (
        (key === 'user_id' || key === 'tenant_id') &&
        typeof value === 'number'
      ) {
        const source = context?.source;
        if (source && /^\d{1,32}$/.test(source)) return source;
      }
      return value;
    });
  } catch {
    throw invalidClaims();
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidClaims();
  }
  const record = payload as Record<string, unknown>;
  const feishuUserId = decimalId(record.user_id);
  const tenantId = decimalId(record.tenant_id);
  const agentId = cleanAgentId(record.agent_id);
  const exp = record.exp;
  if (
    !feishuUserId ||
    !tenantId ||
    !agentId ||
    typeof exp !== 'number' ||
    !Number.isSafeInteger(exp) ||
    exp <= 0
  ) {
    throw invalidClaims();
  }
  return { feishuUserId, tenantId, agentId, exp };
}

function decimalId(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{1,32}$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  return null;
}

function cleanId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^\d{1,32}$/.test(normalized) ? normalized : null;
}

function cleanAgentId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : null;
}

function hostedEnvironment(): string {
  return (
    process.env.FORCE_FRAMEWORK_ENVIRONMENT?.trim() ||
    process.env.NODE_ENV?.trim() ||
    'unknown'
  );
}

function invalidClaims(): Error & { code: string; statusCode: number } {
  return identityError(
    'AILY_SIGNED_IDENTITY_CLAIMS_INVALID',
    401,
    'Invalid Aily identity claims.',
  );
}

function identityError(
  code: string,
  statusCode: 401 | 503,
  message: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(message), { code, statusCode });
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
