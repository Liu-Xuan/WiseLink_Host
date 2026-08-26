import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  canonicalServiceScopeUnavailable,
  type CanonicalServiceScopeAuthorizationPort,
  type CanonicalVerifiedDevelopmentCreateScope,
  type CanonicalVerifiedOpenClawAttemptScope,
  type CanonicalVerifiedServiceScope,
} from './canonical-service-scope.authorization';

const CANONICAL_APP_ID = 'app_17bzc551rsg';

/**
 * Explicitly opt-in DEV/UAT service scope for one isolated WorkItem.
 *
 * The hosted /openapi gateway remains responsible for API-key transport
 * authentication. This adapter adds the Host-side exact object allowlist and
 * is unusable unless all non-secret configuration fields are present. The
 * optional creation scope is separately bound to one exact current
 * DocumentVersion and one UUID run token; ordinary OpenClaw calls remain
 * bound to one exact WorkItem.
 */
@Injectable()
// Supplied as the executor/service delegate through CanonicalHostModule.forRoot().
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class ConfiguredDevelopmentCanonicalServiceScopeAuthorization implements CanonicalServiceScopeAuthorizationPort {
  async authorizeWorkItemRead(input: {
    transport: 'OPENAPI_REST' | 'READONLY_MCP';
    operation: 'READ_STATUS' | 'QUERY_PARSED_PACKAGE' | 'READ_DEEP_LINK';
    workItemId: string;
  }): Promise<CanonicalVerifiedServiceScope> {
    return exactWorkItemScope(requiredConfig(), input.workItemId);
  }

  async authorizeDevelopmentCreate(input: {
    documentVersionId: string;
    developmentRunToken: string;
  }): Promise<CanonicalVerifiedDevelopmentCreateScope> {
    const config = requiredDevelopmentCreateConfig();
    if (
      input.documentVersionId !== config.documentVersionId ||
      input.developmentRunToken !== config.developmentRunToken
    ) {
      throw scopeNotFound();
    }
    return {
      principalId: config.principalId,
      appId: CANONICAL_APP_ID,
      tenantId: config.tenantId,
      environment: config.environment,
      documentVersionId: config.documentVersionId,
      developmentRunToken: config.developmentRunToken,
      authorizationFingerprint: fingerprint([
        'configured-development-create-scope.v1',
        config.environment,
        CANONICAL_APP_ID,
        config.principalId,
        config.tenantId,
        config.documentVersionId,
        config.developmentRunToken,
      ]),
    };
  }

  async assertTransport(input: {
    transport: 'READONLY_MCP' | 'OPENCLAW_MCP';
  }): Promise<void> {
    void input;
    requiredConfig();
  }

  async authorizeOpenClawWorkItem(input: {
    operation:
      | 'BEGIN_DYNAMIC'
      | 'RECORD_DISCOVERY'
      | 'BEGIN_OVERALL'
      | 'BEGIN_REVIEW'
      | 'BEGIN_TRANSLATE';
    workItemId: string;
  }): Promise<CanonicalVerifiedServiceScope> {
    return exactWorkItemScope(requiredConfig(), input.workItemId);
  }

  async authorizeOpenClawAttempt(input: {
    operation:
      | 'COMMIT_DYNAMIC'
      | 'RESUME_OVERALL'
      | 'COMMIT_OVERALL'
      | 'COMMIT_TRANSLATE'
      | 'GET_REVIEW_CONTEXT'
      | 'READ_REVIEW_SOURCE_REFS'
      | 'GET_REVIEW_ATTEMPT_STATUS'
      | 'COMMIT_REVIEW'
      | 'HEARTBEAT_ATTEMPT'
      | 'CANCEL_ATTEMPT';
    attemptRef: string;
  }): Promise<CanonicalVerifiedOpenClawAttemptScope> {
    const config = requiredConfig();
    if (!input.attemptRef.trim()) throw scopeNotFound();
    return {
      ...exactWorkItemScope(config, config.workItemId),
      attemptRef: input.attemptRef,
    };
  }
}

interface DevelopmentServiceScopeConfig {
  environment: 'DEV' | 'UAT';
  principalId: string;
  tenantId: string;
  workItemId: string;
}

interface DevelopmentCreateScopeConfig {
  environment: 'DEV' | 'UAT';
  principalId: string;
  tenantId: string;
  documentVersionId: string;
  developmentRunToken: string;
}

function requiredBaseConfig(): Omit<
  DevelopmentCreateScopeConfig,
  'documentVersionId' | 'developmentRunToken'
> {
  const environment = process.env.WL_OPENCLAW_SERVICE_SCOPE_ENV;
  const principalId = process.env.WL_OPENCLAW_SERVICE_PRINCIPAL_ID;
  const tenantId = process.env.WL_OPENCLAW_SERVICE_TENANT_ID;
  if (
    process.env.WL_OPENCLAW_SERVICE_SCOPE_ENABLED !== '1' ||
    process.env.WL_OPENCLAW_GATEWAY_AUTH_MODE !== 'API_KEY' ||
    !['DEV', 'UAT'].includes(environment ?? '') ||
    !principalId?.startsWith('service:') ||
    !tenantId?.trim()
  ) {
    throw canonicalServiceScopeUnavailable();
  }
  return {
    environment: environment as 'DEV' | 'UAT',
    principalId,
    tenantId,
  };
}

function requiredConfig(): DevelopmentServiceScopeConfig {
  const base = requiredBaseConfig();
  const workItemId = process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID;
  if (!workItemId?.startsWith('WI-')) {
    throw canonicalServiceScopeUnavailable();
  }
  return {
    ...base,
    workItemId,
  };
}

function requiredDevelopmentCreateConfig(): DevelopmentCreateScopeConfig {
  const base = requiredBaseConfig();
  const documentVersionId =
    process.env.WL_OPENCLAW_DEVELOPMENT_DOCUMENT_VERSION_ID;
  const developmentRunToken =
    process.env.WL_OPENCLAW_DEVELOPMENT_RUN_TOKEN;
  if (
    process.env.WL_OPENCLAW_DEVELOPMENT_CREATE_ENABLED !== '1' ||
    !documentVersionId?.trim() ||
    !developmentRunToken ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      developmentRunToken,
    )
  ) {
    throw canonicalServiceScopeUnavailable();
  }
  return {
    ...base,
    documentVersionId,
    developmentRunToken,
  };
}

function exactWorkItemScope(
  config: DevelopmentServiceScopeConfig,
  requestedWorkItemId: string,
): CanonicalVerifiedServiceScope {
  if (requestedWorkItemId !== config.workItemId) throw scopeNotFound();
  return {
    principalId: config.principalId,
    appId: CANONICAL_APP_ID,
    tenantId: config.tenantId,
    workItemId: config.workItemId,
    authorizationFingerprint: fingerprint([
      'configured-openclaw-service-scope.v1',
      config.environment,
      CANONICAL_APP_ID,
      config.principalId,
      config.tenantId,
      config.workItemId,
    ]),
  };
}

function fingerprint(parts: string[]): string {
  return `sha256:${createHash('sha256').update(parts.join('\n')).digest('hex')}`;
}

function scopeNotFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}
