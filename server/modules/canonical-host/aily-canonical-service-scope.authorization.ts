import { Inject, Injectable, Logger } from '@nestjs/common';
import { RequestContextService } from '@lark-apaas/nestjs-common';

import {
  CANONICAL_OBJECT_ACCESS,
  type CanonicalAilyFinalUserActorContext,
  type CanonicalObjectAccessPort,
} from '../work-item/canonical-object-access.port';
import {
  canonicalServiceScopeUnavailable,
  type CanonicalServiceScopeAuthorizationPort,
  type CanonicalVerifiedOpenClawAttemptScope,
  type CanonicalVerifiedServiceScope,
} from './canonical-service-scope.authorization';

export const AILY_ACTOR_REQUEST_CONTEXT_KEY =
  'wiselinkAilyFinalUserActor' as const;

@Injectable()
export class AilyCanonicalServiceScopeAuthorization implements CanonicalServiceScopeAuthorizationPort {
  private readonly logger = new Logger(
    AilyCanonicalServiceScopeAuthorization.name,
  );

  constructor(
    private readonly requestContext: RequestContextService,
    @Inject(CANONICAL_OBJECT_ACCESS)
    private readonly objectAccess: CanonicalObjectAccessPort,
  ) {}

  async authorizeWorkItemRead(input: {
    transport: 'OPENAPI_REST' | 'READONLY_MCP';
    operation: 'READ_STATUS' | 'QUERY_PARSED_PACKAGE' | 'READ_DEEP_LINK';
    workItemId: string;
  }): Promise<CanonicalVerifiedServiceScope> {
    if (input.transport !== 'READONLY_MCP') {
      throw canonicalServiceScopeUnavailable();
    }
    const actor = this.requireAilyActor();
    const result = await this.objectAccess.freshRead({
      actor,
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: input.workItemId },
    });
    if ('code' in result) {
      this.logger.warn(
        JSON.stringify({
          event: 'AILY_WORK_ITEM_READ_DENIED',
          requestId: this.requestId(),
          operation: input.operation,
          workItemId: input.workItemId,
          code: result.code,
          denialSource: result.denialSource,
        }),
      );
      throw Object.assign(new Error(result.code), {
        code: result.code,
        statusCode: result.statusCode,
      });
    }
    this.logger.log(
      JSON.stringify({
        event: 'AILY_WORK_ITEM_READ_AUTHORIZED',
        requestId: this.requestId(),
        operation: input.operation,
        workItemId: result.workItemId,
        workItemRevision: result.workItemRevision,
        actorFingerprint: result.actorFingerprint,
        authorizationFingerprint: result.authorizationFingerprint,
        identity: result.auditProvenance.identity,
        objectAuthorization: result.auditProvenance.objectAuthorization,
      }),
    );
    return {
      principalId: `final-user:${result.actorFingerprint}`,
      appId: result.applicationScopeId,
      tenantId: result.tenantId,
      workItemId: result.workItemId,
      authorizationFingerprint: result.authorizationFingerprint,
    };
  }

  assertDevelopmentCreate(): Promise<void> {
    return Promise.reject(canonicalServiceScopeUnavailable());
  }

  async assertTransport(input: { transport: 'READONLY_MCP' }): Promise<void> {
    if (input.transport !== 'READONLY_MCP') {
      throw canonicalServiceScopeUnavailable();
    }
    this.requireAilyActor();
  }

  authorizeOpenClawWorkItem(): Promise<CanonicalVerifiedServiceScope> {
    return Promise.reject(canonicalServiceScopeUnavailable());
  }

  authorizeOpenClawAttempt(): Promise<CanonicalVerifiedOpenClawAttemptScope> {
    return Promise.reject(canonicalServiceScopeUnavailable());
  }

  private requireAilyActor(): CanonicalAilyFinalUserActorContext {
    const actor = this.requestContext.get(AILY_ACTOR_REQUEST_CONTEXT_KEY);
    if (
      !actor ||
      typeof actor !== 'object' ||
      (actor as { principalKind?: unknown }).principalKind !== 'FINAL_USER' ||
      (actor as { transport?: unknown }).transport !== 'AILY_SIGNED_MCP_HTTP'
    ) {
      throw Object.assign(new Error('AILY_SIGNED_IDENTITY_UNAVAILABLE'), {
        code: 'AILY_SIGNED_IDENTITY_UNAVAILABLE',
        statusCode: 401,
      });
    }
    return actor as CanonicalAilyFinalUserActorContext;
  }

  private requestId(): string | null {
    const value = this.requestContext.get('requestId');
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
}
