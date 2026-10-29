import { Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { IdentityRepository } from '../identity/identity.repository';

export const AILY_MCP_CONFIGURATION = Symbol('AILY_MCP_CONFIGURATION');
export interface AilyMcpConfiguration {
  enabled: boolean;
  agentId: string;
  expectedClientId: string;
  signingSecret: string;
  /** Actual target payload types/namespaces must be verified before enabling. */
  subjectNamespace: 'FEISHU_OPEN_ID' | null;
  tenantNamespace: 'FEISHU_TENANT_KEY' | null;
}
export interface AilyMcpVerifiedActor {
  agentId: string; actorUserId: string; tenantId: string;
  mappingId: string; mappingRevision: number; expiresAt: number;
  feishuOpenId: string; feishuTenantKey: string; expectedClientId: string;
  platformToolCallId: null;
}

@Injectable()
export class AilyMcpIdentityService {
  private readonly verified = new WeakSet<object>();
  constructor(private readonly identities: IdentityRepository,
    @Optional() @Inject(AILY_MCP_CONFIGURATION) private readonly config: AilyMcpConfiguration | null = null) {}

  async verify(header: unknown): Promise<AilyMcpVerifiedActor> {
    const config = this.config;
    if (!config?.enabled || !config.signingSecret || !config.expectedClientId ||
        config.subjectNamespace !== 'FEISHU_OPEN_ID' || config.tenantNamespace !== 'FEISHU_TENANT_KEY')
      throw new UnauthorizedException('AILY_MCP_IDENTITY_NOT_CONFIGURED');
    if (typeof header !== 'string' || header.length > 16_384) throw new UnauthorizedException('AILY_MCP_JWT_INVALID');
    const parts = header.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/u.test(part)))
      throw new UnauthorizedException('AILY_MCP_JWT_INVALID');
    let metadata: unknown; let payload: unknown;
    try {
      metadata = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch { throw new UnauthorizedException('AILY_MCP_JWT_INVALID'); }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || !('alg' in metadata) || metadata.alg !== 'HS256')
      throw new UnauthorizedException('AILY_MCP_JWT_INVALID');
    const expected = createHmac('sha256', config.signingSecret).update(`${parts[0]}.${parts[1]}`).digest();
    const actual = Buffer.from(parts[2], 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new UnauthorizedException('AILY_MCP_JWT_INVALID');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new UnauthorizedException('AILY_MCP_JWT_INVALID');
    const claims = payload as Record<string, unknown>;
    // Official documentation contradicts its open-ID description with numeric
    // types. This branch accepts only an explicitly verified string namespace.
    if (claims.agent_id !== config.agentId || typeof claims.user_id !== 'string' || typeof claims.tenant_id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,255}$/u.test(claims.user_id) || !/^[A-Za-z0-9_-]{1,255}$/u.test(claims.tenant_id) ||
        !Number.isSafeInteger(claims.exp) || !Number.isFinite(new Date(Number(claims.exp)*1000).getTime()) ||
        Number(claims.exp) * 1000 <= Date.now())
      throw new UnauthorizedException('AILY_MCP_JWT_INVALID');
    const mapping = await this.identities.resolveSubjectMapping({feishuOpenId: claims.user_id,
      feishuTenantKey: claims.tenant_id, expectedClientId: config.expectedClientId});
    if (!mapping) throw new UnauthorizedException('AILY_MCP_SUBJECT_MAPPING_REQUIRED');
    const actor: AilyMcpVerifiedActor = Object.freeze({agentId: config.agentId, actorUserId: mapping.miaodaUserId,
      tenantId: mapping.miaodaTenantId, mappingId: mapping.id, mappingRevision: mapping.revision,
      feishuOpenId: claims.user_id, feishuTenantKey: claims.tenant_id, expectedClientId: config.expectedClientId,
      expiresAt: Number(claims.exp) * 1000, platformToolCallId: null});
    this.verified.add(actor);
    return actor;
  }

  assertVerified(actor: AilyMcpVerifiedActor): void {
    if (!this.verified.has(actor) || actor.expiresAt <= Date.now()) throw new UnauthorizedException('AILY_MCP_IDENTITY_REQUIRED');
  }
}
