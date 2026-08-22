import { Injectable } from '@nestjs/common';

export const SUBJECT_TENANT_MAPPING = Symbol('SUBJECT_TENANT_MAPPING');

/**
 * A server-owned, Host-controlled fresh mapping from Feishu identity
 * to Miaoda canonical subject. This mapping is the trust boundary —
 * only Host-owned data may create it, and its absence is fail-closed.
 */
export interface SubjectTenantMapping {
  /** Miaoda user ID — the canonical subject. */
  miaodaUserId: string;
  /** Miaoda tenant ID — must match the request context. */
  miaodaTenantId: string;
  /** Feishu tenant_key from the user_info response. */
  feishuTenantKey: string;
  /** The expected Feishu app client_id for this mapping. */
  expectedClientId: string;
}

export interface SubjectTenantMappingPort {
  /**
   * Resolves a fresh, Host-owned mapping from Feishu open_id +
   * tenant_key to Miaoda canonical subject. Returns null when
   * no mapping exists — callers must treat null as fail-closed.
   */
  resolveMapping(input: {
    feishuOpenId: string;
    feishuTenantKey: string;
  }): Promise<SubjectTenantMapping | null>;
}

/**
 * Default adapter — always returns null (no mapping data source
 * configured). A future database-backed or API-backed adapter will
 * replace this once the subject mapping table exists.
 */
@Injectable()
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class UnavailableSubjectTenantMappingAdapter
  implements SubjectTenantMappingPort
{
  async resolveMapping(_input: {
    feishuOpenId: string;
    feishuTenantKey: string;
  }): Promise<SubjectTenantMapping | null> {
    return null;
  }
}
