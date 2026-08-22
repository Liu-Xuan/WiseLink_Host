import { Module } from '@nestjs/common';

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
import { WhoamiController } from './whoami.controller';
import { OauthFlowController } from './oauth-flow.controller';
import { ProtectedWorkItemReadController } from './protected-work-item-read.controller';
import { WorkItemRuntimeModule } from '../work-item/work-item-runtime.module';

@Module({
  imports: [WorkItemRuntimeModule],
  controllers: [
    WhoamiController,
    OauthFlowController,
    ProtectedWorkItemReadController,
  ],
  providers: [
    // ── Default identity verification — remains UNAVAILABLE ──
    // The gateway header is caller-constructible; it can never produce
    // a trusted ActorContext. Only the OAuth flow (OauthFlowController)
    // can create a session-backed verified identity.
    {
      provide: IDENTITY_VERIFICATION,
      useClass: UnavailableIdentityVerificationAdapter,
    },

    // ── Feishu OAuth verification adapter ──
    // Used by OauthFlowController to verify the token-exchange result.
    // Not wired to IDENTITY_VERIFICATION — the default path stays closed.
    {
      provide: FEISHU_OAUTH_VERIFICATION,
      useClass: FeishuOAuthVerificationAdapter,
    },

    // ── Feishu HTTP ports — default unavailable ──
    // In the project default environment (no credentials), both return
    // null → every OAuth callback fails closed at token-exchange or
    // user_info. A DEV/UAT environment wires HttpFeishuOAuthTokenAdapter
    // and HttpFeishuUserInfoAdapter via custom providers.
    {
      provide: FEISHU_OAUTH_TOKEN_HTTP,
      useClass: UnavailableFeishuOAuthTokenHttpAdapter,
    },
    {
      provide: FEISHU_USER_INFO_HTTP,
      useClass: UnavailableFeishuUserInfoHttpAdapter,
    },

    // ── Subject/tenant mapping — default unavailable ──
    // Host-owned mapping data source. Returns null until a database-
    // backed or API-backed adapter is provisioned.
    {
      provide: SUBJECT_TENANT_MAPPING,
      useClass: UnavailableSubjectTenantMappingAdapter,
    },

    // ── OAuth configuration (reads from process.env) ──
    {
      provide: OAUTH_CONFIG,
      useClass: EnvOauthConfigAdapter,
    },

    // ── Server-side stores and resolver ──
    OauthStateStore,
    SessionStore,
    SessionResolver,
  ],
})
export class IdentityModule {}
