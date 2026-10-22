import { Inject, Injectable } from '@nestjs/common';
import {
  OAUTH_CONFIG,
  type OAuthConfigPort,
} from '../identity/oauth-config.port';
import { CANONICAL_MIAODA_APP_ID } from '../canonical-host/canonical-host.constants';
import { tdmsError } from './tdms-source.types';

export const TDMS_BOUND_SCHEMA = 'workspace_aadkpkjef3slu';
export const TDMS_BOUND_SQL_ROLES = [
  'authenticated_workspace_aadkpkjef3slu',
  'service_role_workspace_aadkpkjef3slu',
] as const;

export interface TdmsBoundIdentityProfile {
  readonly tenantId: string;
  readonly clientId: string;
}

/** A deployment restriction, never a Source decision or mapping-derived identity. */
@Injectable()
export class TdmsReceiverIdentityProfile {
  private readonly tenantId = process.env.WISELINK_TDMS_BOUND_TENANT_ID;

  constructor(
    @Inject(OAUTH_CONFIG) private readonly oauthConfig: OAuthConfigPort,
  ) {}

  current(): TdmsBoundIdentityProfile {
    const tenantId = this.tenantId;
    const clientId = this.oauthConfig.clientId;
    if (
      !this.oauthConfig.configured ||
      this.oauthConfig.applicationScopeId !== CANONICAL_MIAODA_APP_ID ||
      !profileIdentifier(tenantId) ||
      !profileIdentifier(clientId)
    )
      throw tdmsError('TDMS_RECEIVER_IDENTITY_PROFILE_UNCONFIGURED', 503);
    return { tenantId, clientId };
  }
}

function profileIdentifier(value: string | null | undefined): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    !/[\s\p{Cc}]/u.test(value)
  );
}
