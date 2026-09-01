import { Injectable } from '@nestjs/common';

export const CANONICAL_SERVICE_SCOPE_AUTHORIZATION = Symbol(
  'CANONICAL_SERVICE_SCOPE_AUTHORIZATION',
);
export const CANONICAL_EXECUTOR_SERVICE_SCOPE_AUTHORIZATION = Symbol(
  'CANONICAL_EXECUTOR_SERVICE_SCOPE_AUTHORIZATION',
);

export interface CanonicalVerifiedServiceScope {
  principalId: string;
  appId: string;
  tenantId: string;
  workItemId: string;
  authorizationFingerprint: string;
}

export interface CanonicalVerifiedDevelopmentCreateScope {
  principalId: string;
  appId: string;
  tenantId: string;
  environment: 'DEV' | 'UAT';
  documentVersionId: string;
  developmentRunToken: string;
  authorizationFingerprint: string;
}

export interface CanonicalVerifiedOpenClawAttemptScope extends CanonicalVerifiedServiceScope {
  attemptRef: string;
}

export interface CanonicalVerifiedApplicabilityContextScope extends CanonicalVerifiedServiceScope {
  applicabilityContextRef: string;
  requestId: string;
}

export interface CanonicalServiceScopeAuthorizationPort {
  authorizeWorkItemRead(input: {
    transport: 'OPENAPI_REST' | 'READONLY_MCP';
    operation: 'READ_STATUS' | 'QUERY_PARSED_PACKAGE' | 'READ_DEEP_LINK';
    workItemId: string;
  }): Promise<CanonicalVerifiedServiceScope>;
  authorizeDevelopmentCreate(input: {
    documentVersionId: string;
    developmentRunToken: string;
  }): Promise<CanonicalVerifiedDevelopmentCreateScope>;
  assertTransport(input: {
    transport: 'READONLY_MCP' | 'OPENCLAW_MCP';
  }): Promise<void>;
  authorizeOpenClawWorkItem(input: {
    operation:
      | 'BEGIN_DYNAMIC'
      | 'RECORD_DISCOVERY'
      | 'BEGIN_OVERALL'
      | 'BEGIN_TRANSLATE';
    workItemId: string;
  }): Promise<CanonicalVerifiedServiceScope>;
  authorizeOpenClawReview(input: {
    operation: 'BEGIN_REVIEW';
    reviewConversationRef: string;
    requestId: string;
  }): Promise<CanonicalVerifiedServiceScope>;
  authorizeOpenClawApplicabilityContext(input: {
    operation: 'BEGIN_APPLICABILITY';
    applicabilityContextRef: string;
    requestId: string;
  }): Promise<CanonicalVerifiedApplicabilityContextScope>;
  authorizeOpenClawAttempt(input: {
    operation:
      | 'COMMIT_DYNAMIC'
      | 'RESUME_OVERALL'
      | 'COMMIT_OVERALL'
      | 'COMMIT_TRANSLATE'
      | 'COMMIT_APPLICABILITY'
      | 'GET_REVIEW_CONTEXT'
      | 'READ_REVIEW_SOURCE_REFS'
      | 'GET_ACTION_ATTEMPT_STATUS'
      | 'COMMIT_REVIEW'
      | 'HEARTBEAT_ATTEMPT'
      | 'CANCEL_ATTEMPT';
    attemptRef: string;
  }): Promise<CanonicalVerifiedOpenClawAttemptScope>;
}

@Injectable()
export class UnavailableCanonicalServiceScopeAuthorization implements CanonicalServiceScopeAuthorizationPort {
  authorizeWorkItemRead(): Promise<CanonicalVerifiedServiceScope> {
    return Promise.reject(canonicalServiceScopeUnavailable());
  }

  authorizeDevelopmentCreate(): Promise<CanonicalVerifiedDevelopmentCreateScope> {
    return Promise.reject(canonicalServiceScopeUnavailable());
  }

  assertTransport(): Promise<void> {
    return Promise.reject(canonicalServiceScopeUnavailable());
  }

  authorizeOpenClawWorkItem(): Promise<CanonicalVerifiedServiceScope> {
    return Promise.reject(canonicalServiceScopeUnavailable());
  }

  authorizeOpenClawReview(): Promise<CanonicalVerifiedServiceScope> {
    return Promise.reject(canonicalServiceScopeUnavailable());
  }

  authorizeOpenClawApplicabilityContext(): Promise<CanonicalVerifiedApplicabilityContextScope> {
    return Promise.reject(canonicalServiceScopeUnavailable());
  }

  authorizeOpenClawAttempt(): Promise<CanonicalVerifiedOpenClawAttemptScope> {
    return Promise.reject(canonicalServiceScopeUnavailable());
  }
}

export function canonicalServiceScopeUnavailable(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(
    new Error('Canonical API-key service scope is unavailable.'),
    {
      code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
      statusCode: 503,
    },
  );
}
