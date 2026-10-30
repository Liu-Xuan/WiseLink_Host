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

type IdentityStage = 'CONFIGURATION' | 'JWT_FORMAT' | 'JWT_JSON' | 'JWT_ALGORITHM' | 'JWT_SIGNATURE' |
  'JWT_PAYLOAD' | 'JWT_AGENT' | 'JWT_SUBJECT' | 'JWT_EXPIRY' | 'SUBJECT_MAPPING';
type ClaimType = 'MISSING' | 'NULL' | 'STRING' | 'NUMBER' | 'BOOLEAN' | 'ARRAY' | 'OBJECT';
type RejectionCode = 'AILY_MCP_IDENTITY_NOT_CONFIGURED' | 'AILY_MCP_JWT_INVALID' | 'AILY_MCP_SUBJECT_MAPPING_REQUIRED';
export interface AilyMcpIdentityDiagnostic {
  stage: IdentityStage;
  signatureVerified: boolean | null;
  userIdType: ClaimType | null;
  tenantIdType: ClaimType | null;
  agentMatched: boolean | null;
  expiryValid: boolean | null;
}

// Only original rejection instances registered here can supply log diagnostics.
// No diagnostic property is added to the public 401 response or exception JSON.
const rejectionDiagnostics = new WeakMap<object, Readonly<AilyMcpIdentityDiagnostic>>();
class IdentityRejection extends UnauthorizedException {
  constructor(code: RejectionCode, diagnostic: AilyMcpIdentityDiagnostic) {
    super(code);
    this.name = 'UnauthorizedException';
    rejectionDiagnostics.set(this, Object.freeze({...diagnostic}));
  }
}
export function readAilyMcpIdentityDiagnostic(cause: unknown): Readonly<AilyMcpIdentityDiagnostic> | null {
  return cause !== null && typeof cause === 'object' ? rejectionDiagnostics.get(cause) ?? null : null;
}
function claimType(value: unknown): ClaimType {
  if (value === undefined) return 'MISSING';
  if (value === null) return 'NULL';
  if (Array.isArray(value)) return 'ARRAY';
  switch (typeof value) {
    case 'string': return 'STRING';
    case 'number': return 'NUMBER';
    case 'boolean': return 'BOOLEAN';
    default: return 'OBJECT'; // Remaining JSON values are objects.
  }
}

@Injectable()
export class AilyMcpIdentityService {
  private readonly verified = new WeakSet<object>();
  constructor(private readonly identities: IdentityRepository,
    @Optional() @Inject(AILY_MCP_CONFIGURATION) private readonly config: AilyMcpConfiguration | null = null) {}

  async verify(header: unknown): Promise<AilyMcpVerifiedActor> {
    const diagnostic: AilyMcpIdentityDiagnostic = {stage: 'CONFIGURATION', signatureVerified: null,
      userIdType: null, tenantIdType: null, agentMatched: null, expiryValid: null};
    function reject(code: RejectionCode, stage: IdentityStage): never {
      throw new IdentityRejection(code, {...diagnostic, stage});
    }
    const config = this.config;
    if (!config?.enabled || !config.signingSecret || !config.expectedClientId ||
        config.subjectNamespace !== 'FEISHU_OPEN_ID' || config.tenantNamespace !== 'FEISHU_TENANT_KEY')
      reject('AILY_MCP_IDENTITY_NOT_CONFIGURED', 'CONFIGURATION');
    if (typeof header !== 'string' || header.length > 16_384) reject('AILY_MCP_JWT_INVALID', 'JWT_FORMAT');
    const parts = header.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/u.test(part)))
      reject('AILY_MCP_JWT_INVALID', 'JWT_FORMAT');
    let metadata: unknown; let payload: unknown;
    try {
      metadata = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch { reject('AILY_MCP_JWT_INVALID', 'JWT_JSON'); }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || !('alg' in metadata) || metadata.alg !== 'HS256')
      reject('AILY_MCP_JWT_INVALID', 'JWT_ALGORITHM');
    const expected = createHmac('sha256', config.signingSecret).update(`${parts[0]}.${parts[1]}`).digest();
    const actual = Buffer.from(parts[2], 'base64url');
    if (actual.length !== expected.length) reject('AILY_MCP_JWT_INVALID', 'JWT_SIGNATURE');
    diagnostic.signatureVerified = timingSafeEqual(actual, expected);
    if (!diagnostic.signatureVerified) reject('AILY_MCP_JWT_INVALID', 'JWT_SIGNATURE');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) reject('AILY_MCP_JWT_INVALID', 'JWT_PAYLOAD');
    const claims = payload as Record<string, unknown>;
    // Official documentation contradicts its open-ID description with numeric
    // types. This branch accepts only an explicitly verified string namespace.
    diagnostic.agentMatched = claims.agent_id === config.agentId;
    if (!diagnostic.agentMatched) reject('AILY_MCP_JWT_INVALID', 'JWT_AGENT');
    diagnostic.userIdType = claimType(claims.user_id);
    if (typeof claims.user_id !== 'string') reject('AILY_MCP_JWT_INVALID', 'JWT_SUBJECT');
    diagnostic.tenantIdType = claimType(claims.tenant_id);
    if (typeof claims.tenant_id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,255}$/u.test(claims.user_id) || !/^[A-Za-z0-9_-]{1,255}$/u.test(claims.tenant_id))
      reject('AILY_MCP_JWT_INVALID', 'JWT_SUBJECT');
    diagnostic.expiryValid = Number.isSafeInteger(claims.exp) && Number.isFinite(new Date(Number(claims.exp)*1000).getTime()) &&
      Number(claims.exp) * 1000 > Date.now();
    if (!diagnostic.expiryValid) reject('AILY_MCP_JWT_INVALID', 'JWT_EXPIRY');
    const mapping = await this.identities.resolveSubjectMapping({feishuOpenId: claims.user_id,
      feishuTenantKey: claims.tenant_id, expectedClientId: config.expectedClientId});
    if (!mapping) reject('AILY_MCP_SUBJECT_MAPPING_REQUIRED', 'SUBJECT_MAPPING');
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
