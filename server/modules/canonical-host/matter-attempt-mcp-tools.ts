import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import { canonicalServiceScopeUnavailable, type CanonicalServiceScopeAuthorizationPort } from './canonical-service-scope.authorization';
import type { MatterActionAttemptService } from './matter-action-attempt.service';
import { textResult } from './canonical-host-readonly-mcp-tools';

const target = { matterId: z.string().startsWith('MAT-').max(96), attemptRef: z.string().trim().min(1).max(200) };
const fence = { leaseToken: z.string().uuid(), leaseGeneration: z.number().int().positive() };

/** Same durable attempt service and queue; caller cannot supply tenant, actor or principal. */
export function registerMatterAttemptMcpTools(server: McpServer, attempts: MatterActionAttemptService,
  authorization: CanonicalServiceScopeAuthorizationPort): void {
  server.registerTool('matter_action_attempt', {
    title: '读取或继续事项评估任务',
    description: '对精确授权的事项任务执行领取、状态读取、续期、取消或按保存请求读取工作；不会新建任务或形成正式采用。',
    inputSchema: z.discriminatedUnion('operation', [
      z.object({ ...target, operation: z.literal('CLAIM') }).strict(),
      z.object({ ...target, operation: z.literal('STATUS') }).strict(),
      z.object({ ...target, ...fence, operation: z.literal('HEARTBEAT') }).strict(),
      z.object({ ...target, operation: z.literal('CANCEL'), reason: z.string().trim().min(1).max(4000) }).strict(),
      z.object({ ...target, operation: z.literal('READ_SAVED_WORK'), requestId: z.string().trim().min(1).max(255) }).strict(),
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
