import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import { canonicalServiceScopeUnavailable, type CanonicalServiceScopeAuthorizationPort } from './canonical-service-scope.authorization';
import type { MatterActionAttemptService } from './matter-action-attempt.service';
import type { DocumentManagementHostedService } from '../document-management/src/hosted/nest/document-management-hosted.service';
import { textResult } from './canonical-host-readonly-mcp-tools';

const target = { matterId: z.string().startsWith('MAT-').max(96), attemptRef: z.string().trim().min(1).max(200) };
const fence = { leaseToken: z.string().uuid(), leaseGeneration: z.number().int().positive() };

/** Same durable attempt service and queue; caller cannot supply tenant, actor or principal. */
export function registerMatterAttemptMcpTools(server: McpServer, attempts: MatterActionAttemptService,
  authorization: CanonicalServiceScopeAuthorizationPort, documents?: DocumentManagementHostedService): void {
  server.registerTool('begin_matter_assessment', {
    title: '申请事项持续评估',
    description: '按精确事项和工作版本登记一个评估请求；Host 组装来源与前次完整工作，同一请求可重复读回。',
    inputSchema: z.object({ matterId: target.matterId,
      expectedMatterRevisionId: z.string().trim().min(1).max(96),
      expectedMatterRevision: z.number().int().positive(),
      expectedWorkingRevision: z.number().int().nonnegative(),
      requestId: z.string().trim().min(1).max(96), instruction: z.string().trim().min(1).max(4000),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    if (!authorization.authorizeOpenClawMatterRequest || !documents) throw canonicalServiceScopeUnavailable();
    const scope = await authorization.authorizeOpenClawMatterRequest({ matterId: input.matterId });
    if (scope.appId !== 'app_17bzc551rsg' || scope.matterId !== input.matterId ||
      !scope.actorUserId || !scope.tenantId || !scope.principalId) throw canonicalServiceScopeUnavailable();
    const result = await attempts.reserveJobAid({ tenantId: scope.tenantId, actorUserId: scope.actorUserId,
      matterId: scope.matterId, expectedMatterRevisionId: input.expectedMatterRevisionId,
      expectedMatterRevision: input.expectedMatterRevision, expectedWorkingRevision: input.expectedWorkingRevision,
      idempotencyKey: `matter:${scope.matterId}:${input.requestId}`,
      trigger: { kind: 'USER_REQUEST', requestId: input.requestId, instruction: input.instruction } });
    return textResult({ attemptRef: result.task.operationRef, status: result.row.status, created: result.created });
  });
  server.registerTool('matter_action_attempt', {
    title: '读取或继续事项评估任务',
    description: '对精确授权的事项任务执行领取、状态读取、续期、取消或按保存请求读取工作；不会新建任务或形成正式采用。',
    inputSchema: z.discriminatedUnion('operation', [
      z.object({ ...target, operation: z.literal('CLAIM') }).strict(),
      z.object({ ...target, operation: z.literal('STATUS') }).strict(),
      z.object({ ...target, ...fence, operation: z.literal('HEARTBEAT') }).strict(),
      z.object({ ...target, operation: z.literal('CANCEL'), reason: z.string().trim().min(1).max(4000) }).strict(),
      z.object({ ...target, operation: z.literal('READ_SAVED_WORK'), requestId: z.string().trim().min(1).max(255) }).strict(),
      z.object({ ...target, ...fence, operation: z.literal('READ_SOURCES'),
        documentVersionId: z.string().trim().min(1).max(160), pageStart: z.number().int().positive(),
        pageEnd: z.number().int().positive().optional(), purpose: z.string().trim().min(1).max(4000),
      }).strict(),
    ]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    if (!authorization.authorizeOpenClawMatterAttempt) throw canonicalServiceScopeUnavailable();
    const scope = await authorization.authorizeOpenClawMatterAttempt({
      matterId: input.matterId, attemptRef: input.attemptRef, operation: input.operation,
    });
    if (scope.appId !== 'app_17bzc551rsg' || scope.matterId !== input.matterId ||
      scope.attemptRef !== input.attemptRef || !scope.actorUserId || !scope.tenantId || !scope.principalId)
      throw canonicalServiceScopeUnavailable();
    switch (input.operation) {
      case 'READ_SOURCES': {
        if (!documents) throw canonicalServiceScopeUnavailable();
        return textResult(await attempts.readSourcePages({ ...scope, leaseToken: input.leaseToken,
          leaseGeneration: input.leaseGeneration, documentVersionId: input.documentVersionId,
          pageStart: input.pageStart, pageEnd: input.pageEnd, purpose: input.purpose },
          (documentVersionId, range) => documents.readDocumentSourcePagesForRuntime(documentVersionId, range, scope)));
      }
      case 'CLAIM': return textResult(await attempts.claim(scope));
      case 'HEARTBEAT': return textResult(await attempts.heartbeat({ ...scope,
        leaseToken: input.leaseToken, leaseGeneration: input.leaseGeneration }));
      case 'CANCEL': {
        const row = await attempts.cancel({ ...scope, reason: input.reason });
        return textResult({ attemptRef: scope.attemptRef, status: row.status });
      }
      case 'READ_SAVED_WORK': return textResult(await attempts.readSavedWork({ ...scope, requestId: input.requestId }));
      case 'STATUS': {
        const row = await attempts.read(scope);
        return textResult({ attemptRef: scope.attemptRef, matterId: scope.matterId,
          status: row.status, errorCode: row.errorCode,
          deadline: row.deadlineAt?.toISOString() ?? null });
      }
    }
  });
}
