import { Injectable } from '@nestjs/common';

export const CANONICAL_SERVICE_SCOPE_AUTHORIZATION = Symbol(
  'CANONICAL_SERVICE_SCOPE_AUTHORIZATION',
);

export interface CanonicalVerifiedServiceScope {
  principalId: string;
  appId: string;
  tenantId: string;
  workItemId: string;
  authorizationFingerprint: string;
}

export interface CanonicalVerifiedOpenClawAttemptScope extends CanonicalVerifiedServiceScope {
  attemptRef: string;
}

export interface CanonicalServiceScopeAuthorizationPort {
  authorizeWorkItemRead(input: {
    transport: 'OPENAPI_REST' | 'READONLY_MCP';
    operation: 'READ_STATUS' | 'QUERY_PARSED_PACKAGE' | 'READ_DEEP_LINK';
    workItemId: string;
  }): Promise<CanonicalVerifiedServiceScope>;
  assertDevelopmentCreate(): Promise<void>;
  assertTransport(input: { transport: 'READONLY_MCP' }): Promise<void>;
  authorizeOpenClawWorkItem(input: {
    operation: 'BEGIN_DYNAMIC' | 'RECORD_DISCOVERY' | 'BEGIN_OVERALL';
    workItemId: string;
  }): Promise<CanonicalVerifiedServiceScope>;
  authorizeOpenClawAttempt(input: {
    operation: 'COMMIT_DYNAMIC' | 'RESUME_OVERALL' | 'COMMIT_OVERALL';
    attemptRef: string;
  }): Promise<CanonicalVerifiedOpenClawAttemptScope>;
}

@Injectable()
export class UnavailableCanonicalServiceScopeAuthorization implements CanonicalServiceScopeAuthorizationPort {
  authorizeWorkItemRead(): Promise<CanonicalVerifiedServiceScope> {
    return Promise.reject(canonicalServiceScopeUnavailable());
  }

  assertDevelopmentCreate(): Promise<void> {
    return Promise.reject(canonicalServiceScopeUnavailable());
  }

  assertTransport(): Promise<void> {
    return Promise.reject(canonicalServiceScopeUnavailable());
  }

  authorizeOpenClawWorkItem(): Promise<CanonicalVerifiedServiceScope> {
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
