import { Injectable } from '@nestjs/common';

import type {
  IdentityUnavailableReason,
  VerifiedIdentityResult,
} from './identity.types';

export const IDENTITY_VERIFICATION = Symbol('IDENTITY_VERIFICATION');

export interface IdentityVerificationPort {
  /**
   * Attempts to verify the identity asserted by the Miaoda gateway context.
   * Until feishu OAuth or a signed ingress contract is configured, this
   * always returns UNAVAILABLE. Never throws for availability — only for
   * unexpected internal errors.
   */
  verify(input: {
    contextUserId: string;
    contextTenantId: string;
  }): Promise<VerifiedIdentityResult>;
}

/**
 * The only adapter wired in Stage-0. Every call returns UNAVAILABLE because
 * feishu OAuth client/secret/redirect are not configured (B1/B2) and no
 * signed hosted-ingress contract exists (B3). This is the fail-closed
 * default; a future FeishuOAuthIdentityVerificationAdapter will replace it
 * once credentials are provisioned.
 */
@Injectable()
// Supplied through IdentityModule; the static lint rule cannot follow the
// Symbol token provider.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class UnavailableIdentityVerificationAdapter
  implements IdentityVerificationPort
{
  private static readonly REASON: IdentityUnavailableReason =
    'FEISHU_OAUTH_NOT_CONFIGURED';

  async verify(input: {
    contextUserId: string;
    contextTenantId: string;
  }): Promise<VerifiedIdentityResult> {
    return {
      kind: 'UNAVAILABLE',
      reason: UnavailableIdentityVerificationAdapter.REASON,
    };
  }
}
