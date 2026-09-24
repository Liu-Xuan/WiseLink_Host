import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  canonicalServiceScopeUnavailable,
  type CanonicalMatterAttemptAuthorization,
  type CanonicalVerifiedMatterAttemptScope,
  type CanonicalServiceScopeAuthorizationPort,
  type CanonicalVerifiedApplicabilityContextScope,
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
 * bound to one exact WorkItem. Matter operations separately require an enabled
 * exact Matter allowlist/actor binding and never inherit the WorkItem allowlist.
 * Document work uses an explicit version allowlist under one configured actor;
 * every operation still rechecks that actor's ordinary source permission.
 */
@Injectable()
// Supplied as the executor/service delegate through CanonicalHostModule.forRoot().
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class ConfiguredDevelopmentCanonicalServiceScopeAuthorization implements CanonicalServiceScopeAuthorizationPort {
  async authorizeDocumentWork(input: { documentVersionId: string }) {
    const config = requiredDocumentConfig();
    if (!config.documentVersionIds.includes(input.documentVersionId)) throw Object.assign(new Error('DOCUMENT_WORK_NOT_FOUND'), { statusCode: 404 });
    return { principalId: config.principalId, appId: CANONICAL_APP_ID, tenantId: config.tenantId,
      actorUserId: config.actorUserId, documentVersionId: input.documentVersionId };
  }

  async authorizeWorkItemRead(input: {
    transport: 'OPENAPI_REST' | 'READONLY_MCP';
    operation: 'READ_STATUS' | 'QUERY_PARSED_PACKAGE' | 'READ_DEEP_LINK';
    workItemId: string;
  }): Promise<CanonicalVerifiedServiceScope> {
    const config = requiredConfig();
    if (input.workItemId !== config.workItemId &&
      !['READ_STATUS', 'READ_DEEP_LINK'].includes(input.operation))
      throw scopeNotFound();
    return exactWorkItemScope(config, input.workItemId);
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
    if (input.transport === 'OPENCLAW_MCP' && !process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID) {
      if (process.env.WL_OPENCLAW_SERVICE_MATTER_ID || process.env.WL_OPENCLAW_SERVICE_MATTER_IDS !== undefined) requiredMatterConfig();
      else requiredDocumentConfig();
    } else requiredConfig();
  }

  async authorizeOpenClawMatterAttempt(input: CanonicalMatterAttemptAuthorization): Promise<CanonicalVerifiedMatterAttemptScope> {
    const scope = await this.authorizeOpenClawMatterRequest(input);
    if (!input.attemptRef.trim()) throw Object.assign(new Error('ACTION_ATTEMPT_NOT_FOUND'), { code: 'ACTION_ATTEMPT_NOT_FOUND', statusCode: 404 });
    return { ...scope, attemptRef: input.attemptRef };
  }

  async authorizeOpenClawMatterRequest(input: { matterId: string }): Promise<Omit<CanonicalVerifiedMatterAttemptScope, 'attemptRef'>> {
    const config = requiredMatterConfig();
    if (!config.matterIds.includes(input.matterId)) {
      throw Object.assign(new Error('ACTION_ATTEMPT_NOT_FOUND'), { code: 'ACTION_ATTEMPT_NOT_FOUND', statusCode: 404 });
    }
    return { principalId: config.principalId, appId: CANONICAL_APP_ID,
      tenantId: config.tenantId, actorUserId: config.actorUserId,
      matterId: input.matterId };
  }

  async authorizeOpenClawWorkItem(input: {
    operation:
      | 'BEGIN_DYNAMIC'
      | 'RECORD_DISCOVERY'
      | 'BEGIN_OVERALL'
      | 'GET_PENDING_REVIEW_TURN'
      | 'BEGIN_TRANSLATE';
    workItemId: string;
  }): Promise<CanonicalVerifiedServiceScope> {
    const config = requiredConfig();
    if (input.workItemId !== config.workItemId &&
      !['BEGIN_DYNAMIC', 'BEGIN_OVERALL'].includes(input.operation) &&
      !(input.operation === 'GET_PENDING_REVIEW_TURN' &&
        additionalWorkItemIds(config.workItemId).includes(input.workItemId)))
      throw scopeNotFound();
    return exactWorkItemScope(config, input.workItemId);
  }

  async authorizeOpenClawReview(input: {
    operation: 'BEGIN_REVIEW';
    reviewConversationRef: string;
    requestId: string;
  }): Promise<CanonicalVerifiedServiceScope> {
    if (!input.reviewConversationRef.trim() || !input.requestId.trim()) {
      throw scopeNotFound();
    }
    const config = requiredConfig();
    const additional = additionalReviewConversation(config);
    return exactWorkItemScope(config,
      additional?.reviewConversationRef === input.reviewConversationRef
        ? additional.workItemId : config.workItemId);
  }

  async authorizeOpenClawApplicabilityContext(input: {
    operation: 'BEGIN_APPLICABILITY';
    applicabilityContextRef: string;
    requestId: string;
  }): Promise<CanonicalVerifiedApplicabilityContextScope> {
    const config = requiredConfig();
    const expectedRef = process.env.WL_OPENCLAW_APPLICABILITY_CONTEXT_REF;
    if (!input.requestId.trim()) throw scopeNotFound();
    if (expectedRef?.trim() && input.applicabilityContextRef === expectedRef)
      return {
        ...exactWorkItemScope(config, config.workItemId),
        applicabilityContextRef: expectedRef,
        requestId: input.requestId,
      };
    const additional = additionalApplicabilityContext(config);
    if (!additional || input.applicabilityContextRef !== additional.applicabilityContextRef)
      throw scopeNotFound();
    return {
      ...exactWorkItemScope(config, additional.workItemId),
      applicabilityContextRef: additional.applicabilityContextRef,
      requestId: input.requestId,
      requirePersistedSelection: true,
    };
  }

  async resolveOpenClawApplicabilityContextRef(input: {
    tenantId: string;
    workItemId: string;
  }): Promise<string | null> {
    const config = requiredConfig();
    if (input.tenantId !== config.tenantId) throw scopeNotFound();
    if (input.workItemId === config.workItemId)
      return process.env.WL_OPENCLAW_APPLICABILITY_CONTEXT_REF?.trim() || null;
    if (!additionalWorkItemIds(config.workItemId).includes(input.workItemId))
      throw scopeNotFound();
    const additional = additionalApplicabilityContext(config);
    return additional?.workItemId === input.workItemId
      ? additional.applicabilityContextRef : null;
  }

  async authorizeOpenClawAttempt(input: {
    operation:
      | 'COMMIT_DYNAMIC'
      | 'RESUME_OVERALL'
      | 'COMMIT_OVERALL'
      | 'COMMIT_TRANSLATE'
      | 'COMMIT_APPLICABILITY'
      | 'GET_REVIEW_CONTEXT'
      | 'READ_REVIEW_SOURCE_REFS'
      | 'READ_ASSESSMENT_SOURCES'
      | 'SAVE_ASSESSMENT_WORK'
      | 'READ_ASSESSMENT_WORK'
      | 'GET_ACTION_ATTEMPT_STATUS'
      | 'COMMIT_REVIEW'
      | 'HEARTBEAT_ATTEMPT'
      | 'CANCEL_ATTEMPT';
    attemptRef: string;
    workItemId?: string;
  }): Promise<CanonicalVerifiedOpenClawAttemptScope> {
    const config = requiredConfig();
    if (!input.attemptRef.trim()) throw scopeNotFound();
    const selectedWorkItemId = input.workItemId === undefined
      ? config.workItemId : input.workItemId;
    if (selectedWorkItemId !== config.workItemId && ![
      'COMMIT_DYNAMIC', 'RESUME_OVERALL', 'COMMIT_OVERALL',
      'COMMIT_APPLICABILITY',
      'GET_REVIEW_CONTEXT', 'READ_REVIEW_SOURCE_REFS', 'COMMIT_REVIEW',
      'READ_ASSESSMENT_SOURCES', 'SAVE_ASSESSMENT_WORK',
      'READ_ASSESSMENT_WORK', 'GET_ACTION_ATTEMPT_STATUS',
      'HEARTBEAT_ATTEMPT', 'CANCEL_ATTEMPT',
    ].includes(input.operation)) throw scopeNotFound();
    if (selectedWorkItemId !== config.workItemId &&
      input.operation === 'COMMIT_APPLICABILITY' &&
      additionalApplicabilityContext(config)?.workItemId !== selectedWorkItemId)
      throw scopeNotFound();
    if (selectedWorkItemId !== config.workItemId &&
      ['GET_REVIEW_CONTEXT', 'READ_REVIEW_SOURCE_REFS', 'COMMIT_REVIEW'].includes(input.operation) &&
      additionalReviewConversation(config)?.workItemId !== selectedWorkItemId)
      throw scopeNotFound();
    return {
      ...exactWorkItemScope(config, selectedWorkItemId),
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

/** Project the existing executor scope; do not expose its service identity/config. */
export function isOpenClawAutomaticReviewConfigured(input: {
  tenantId: string;
  workItemId: string;
  reviewConversationId?: string;
}): boolean {
  try {
    const config = requiredConfig();
    const additional = input.reviewConversationId === undefined
      ? null : additionalReviewConversation(config);
    return (
      config.tenantId === input.tenantId &&
      (config.workItemId === input.workItemId ||
        (additional?.workItemId === input.workItemId &&
          additional.reviewConversationRef === input.reviewConversationId))
    );
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE'
    )
      return false;
    throw error;
  }
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

function additionalWorkItemIds(legacyWorkItemId: string): string[] {
  const raw = process.env.WL_OPENCLAW_SERVICE_ADDITIONAL_WORK_ITEM_IDS;
  if (raw === undefined) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw canonicalServiceScopeUnavailable(); }
  if (!Array.isArray(parsed) || parsed.length !== 1 ||
    !parsed.every((id): id is string =>
      typeof id === 'string' && /^WI-[A-Za-z0-9_-]{1,93}$/u.test(id)) ||
    new Set(parsed).size !== parsed.length || parsed.includes(legacyWorkItemId))
    throw canonicalServiceScopeUnavailable();
  return parsed;
}

function additionalApplicabilityContext(config: DevelopmentServiceScopeConfig): {
  workItemId: string;
  applicabilityContextRef: string;
} | null {
  const raw = process.env.WL_OPENCLAW_APPLICABILITY_ADDITIONAL_CONTEXT_BINDING;
  if (raw === undefined) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw canonicalServiceScopeUnavailable(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
    JSON.stringify(Object.keys(parsed).sort()) !==
      JSON.stringify(['applicabilityContextRef', 'workItemId']) ||
    !('workItemId' in parsed) || typeof parsed.workItemId !== 'string' ||
    !additionalWorkItemIds(config.workItemId).includes(parsed.workItemId) ||
    !('applicabilityContextRef' in parsed) ||
    typeof parsed.applicabilityContextRef !== 'string' ||
    !/^APCTX-[A-Za-z0-9_-]{1,154}$/u.test(parsed.applicabilityContextRef) ||
    parsed.applicabilityContextRef === process.env.WL_OPENCLAW_APPLICABILITY_CONTEXT_REF)
    throw canonicalServiceScopeUnavailable();
  return {
    workItemId: parsed.workItemId,
    applicabilityContextRef: parsed.applicabilityContextRef,
  };
}

function additionalReviewConversation(config: DevelopmentServiceScopeConfig): {
  workItemId: string;
  reviewConversationRef: string;
} | null {
  const raw = process.env.WL_OPENCLAW_REVIEW_ADDITIONAL_CONVERSATION_BINDING;
  if (raw === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw canonicalServiceScopeUnavailable();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
    JSON.stringify(Object.keys(parsed).sort()) !==
      JSON.stringify(['reviewConversationRef', 'workItemId']) ||
    !('workItemId' in parsed) || typeof parsed.workItemId !== 'string' ||
    !additionalWorkItemIds(config.workItemId).includes(parsed.workItemId) ||
    !('reviewConversationRef' in parsed) ||
    typeof parsed.reviewConversationRef !== 'string' ||
    !/^[A-Za-z0-9_-]{1,96}$/u.test(parsed.reviewConversationRef))
    throw canonicalServiceScopeUnavailable();
  return {
    workItemId: parsed.workItemId,
    reviewConversationRef: parsed.reviewConversationRef,
  };
}

function requiredDocumentConfig() {
  const base = requiredBaseConfig();
  const documentVersionId = process.env.WL_OPENCLAW_SERVICE_DOCUMENT_VERSION_ID;
  const actorUserId = process.env.WL_OPENCLAW_SERVICE_DOCUMENT_ACTOR_ID;
  if (process.env.WL_OPENCLAW_DOCUMENT_SCOPE_ENABLED !== '1' ||
      !actorUserId?.trim()) throw canonicalServiceScopeUnavailable();
  const configuredVersions = process.env.WL_OPENCLAW_SERVICE_DOCUMENT_VERSION_IDS;
  if (configuredVersions === undefined) {
    if (!documentVersionId?.trim()) throw canonicalServiceScopeUnavailable();
    return { ...base, documentVersionIds: [documentVersionId], actorUserId };
  }
  // An explicit list replaces the single-version setting. Invalid configuration
  // must not silently fall back to a different authorization scope.
  let versions: unknown;
  try { versions = JSON.parse(configuredVersions); }
  catch { throw canonicalServiceScopeUnavailable(); }
  if (!Array.isArray(versions) || !versions.length || !versions.every((version): version is string =>
    typeof version === 'string' && version.length <= 96 && /^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(version)) ||
    new Set(versions).size !== versions.length) throw canonicalServiceScopeUnavailable();
  return { ...base, documentVersionIds: versions, actorUserId };
}

function requiredMatterConfig() {
  const base = requiredBaseConfig();
  const matterId = process.env.WL_OPENCLAW_SERVICE_MATTER_ID;
  const actorUserId = process.env.WL_OPENCLAW_SERVICE_MATTER_ACTOR_ID;
  if (process.env.WL_OPENCLAW_MATTER_SCOPE_ENABLED !== '1' ||
      !actorUserId?.trim()) throw canonicalServiceScopeUnavailable();
  const configuredMatters = process.env.WL_OPENCLAW_SERVICE_MATTER_IDS;
  if (configuredMatters === undefined) {
    if (!matterId?.startsWith('MAT-')) throw canonicalServiceScopeUnavailable();
    return { ...base, matterIds: [matterId], actorUserId };
  }
  // Like document scopes, an explicit list replaces the legacy single object.
  // It never grants a tenant-wide scope or permits fallback on invalid input.
  let matters: unknown;
  try { matters = JSON.parse(configuredMatters); }
  catch { throw canonicalServiceScopeUnavailable(); }
  if (!Array.isArray(matters) || !matters.length || !matters.every((matter): matter is string =>
    typeof matter === 'string' && matter.length <= 96 && /^MAT-[A-Za-z0-9_-]+$/u.test(matter)) ||
    new Set(matters).size !== matters.length) throw canonicalServiceScopeUnavailable();
  return { ...base, matterIds: matters, actorUserId };
}

function requiredDevelopmentCreateConfig(): DevelopmentCreateScopeConfig {
  const base = requiredBaseConfig();
  const documentVersionId =
    process.env.WL_OPENCLAW_DEVELOPMENT_DOCUMENT_VERSION_ID;
  const developmentRunToken = process.env.WL_OPENCLAW_DEVELOPMENT_RUN_TOKEN;
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
  if (requestedWorkItemId !== config.workItemId &&
    !additionalWorkItemIds(config.workItemId).includes(requestedWorkItemId)) throw scopeNotFound();
  return {
    principalId: config.principalId,
    appId: CANONICAL_APP_ID,
    tenantId: config.tenantId,
    workItemId: requestedWorkItemId,
    authorizationFingerprint: fingerprint([
      'configured-openclaw-service-scope.v1',
      config.environment,
      CANONICAL_APP_ID,
      config.principalId,
      config.tenantId,
      requestedWorkItemId,
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
