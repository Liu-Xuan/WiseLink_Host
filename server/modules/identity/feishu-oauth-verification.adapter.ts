import { Inject, Injectable } from '@nestjs/common';

import {
  FEISHU_USER_INFO_HTTP,
  type FeishuUserInfoHttpPort,
  type FeishuUserInfoResponse,
} from './feishu-user-info.http';
import {
  SUBJECT_TENANT_MAPPING,
  type SubjectTenantMapping,
  type SubjectTenantMappingPort,
} from './subject-tenant-mapping.port';
import type {
  IdentityUnavailableReason,
  NamespacedSubject,
  VerifiedIdentity,
  VerifiedIdentityResult,
} from './identity.types';

export const FEISHU_OAUTH_VERIFICATION = Symbol('FEISHU_OAUTH_VERIFICATION');

export interface FeishuOAuthVerificationPort {
  verify(input: {
    accessToken: string;
    clientId: string;
    /**
     * The caller's claimed tenant id, when available from a gateway
     * context. When empty/null, the Host mapping is the sole authority
     * for tenant (this is the OAuth-callback path, where no gateway
     * context exists). When non-empty, it MUST match the mapping's
     * miaodaTenantId — a mismatch means cross-tenant replay.
     */
    contextTenantId?: string;
  }): Promise<VerifiedIdentityResult>;
}

/**
 * DEV/UAT-only Feishu OAuth identity verification adapter.
 *
 * Accepts ONLY server-injected access token and client id — never reads
 * from request body, localStorage, cookies, or logs. Calls the official
 * Feishu user_info endpoint via an injectable HTTP port, extracts
 * FEISHU_OPEN_ID + FEISHU_TENANT_KEY, and resolves a Host-owned subject
 * mapping. Any failure (missing token, HTTP error, mapping missing,
 * client/tenant mismatch) returns UNAVAILABLE — never throws.
 *
 * This adapter is NOT the default IDENTITY_VERIFICATION provider.
 * The default remains UnavailableIdentityVerificationAdapter.
 */
@Injectable()
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class FeishuOAuthVerificationAdapter
  implements FeishuOAuthVerificationPort
{
  constructor(
    @Inject(FEISHU_USER_INFO_HTTP)
    private readonly userInfoHttp: FeishuUserInfoHttpPort,
    @Inject(SUBJECT_TENANT_MAPPING)
    private readonly subjectMapping: SubjectTenantMappingPort,
  ) {}

  async verify(input: {
    accessToken: string;
    clientId: string;
    contextTenantId?: string;
  }): Promise<VerifiedIdentityResult> {
    // 1. No access token → fail closed
    if (!input.accessToken || input.accessToken.trim() === '') {
      return unavailable('FEISHU_OAUTH_NO_ACCESS_TOKEN');
    }

    // 2. Call official user_info via injectable HTTP port
    const userInfo: FeishuUserInfoResponse | null =
      await this.userInfoHttp.fetchUserInfo({
        accessToken: input.accessToken,
      });

    if (userInfo === null) {
      return unavailable('FEISHU_OAUTH_USER_INFO_FAILED');
    }

    // 3. Resolve server-owned subject/tenant mapping
    const mapping: SubjectTenantMapping | null =
      await this.subjectMapping.resolveMapping({
        feishuOpenId: userInfo.openId,
        feishuTenantKey: userInfo.tenantKey,
        expectedClientId: input.clientId,
      });

    if (mapping === null) {
      return unavailable('FEISHU_SUBJECT_MAPPING_MISSING');
    }

    // 4. Validate client id matches the mapping's expected client
    if (mapping.expectedClientId !== input.clientId) {
      return unavailable('FEISHU_CLIENT_MISMATCH');
    }

    // 5. Validate tenant matches the context tenant — ONLY when a
    //    context tenant is provided. On the OAuth-callback path (no
      //    gateway context), the Host mapping is the sole authority.
    //    A non-empty contextTenantId that mismatches means cross-tenant
      //    replay → fail closed.
      if (
        input.contextTenantId !== undefined &&
        input.contextTenantId !== null &&
        input.contextTenantId !== '' &&
        mapping.miaodaTenantId !== input.contextTenantId
      ) {
        return unavailable('FEISHU_TENANT_MISMATCH');
      }

    // 6. Return verified identity with namespaced subject
    const namespacedSubject: NamespacedSubject = {
      namespace: 'FEISHU_OPEN_ID',
      subject: userInfo.openId,
      tenantKey: userInfo.tenantKey,
    };

    const identity: VerifiedIdentity = {
      subjectMappingId: mapping.mappingId,
      provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
      miaodaUserId: mapping.miaodaUserId,
      tenantId: mapping.miaodaTenantId,
      feishuUserId: userInfo.userId,
      feishuOpenId: userInfo.openId,
      namespacedSubject,
      verifiedAt: new Date().toISOString(),
    };

    return { kind: 'VERIFIED', identity };
  }
}

function unavailable(
  reason: IdentityUnavailableReason,
): VerifiedIdentityResult {
  return { kind: 'UNAVAILABLE', reason };
}
