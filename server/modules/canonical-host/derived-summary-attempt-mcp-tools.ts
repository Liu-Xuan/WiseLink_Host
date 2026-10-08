import { tdmsNativeReferenceMcpSchema } from './tdms-native-reference-mcp.schema';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import type { CanonicalServiceScopeAuthorizationPort } from './canonical-service-scope.authorization';
import type { DerivedSummaryRuntimeService } from './derived-summary-runtime.service';
import { textResult } from './canonical-host-readonly-mcp-tools';

const target = { summaryId: z.string().startsWith('DS-').max(96), attemptRef: z.string().trim().min(1).max(128) };
const fence = { leaseToken: z.string().uuid(), leaseGeneration: z.number().int().positive() };
const requestId = z.string().trim().min(1).max(96);
const reading = { ...target, ...fence, evidenceRefs: z.array(z.string().trim().min(1).max(1024)).min(1),
  purpose: z.string().trim().min(1).max(4000) };
const sourceReading = { ...reading, evidenceRefs: z.array(tdmsNativeReferenceMcpSchema(z.string().trim().min(1).max(1024))).min(1) };

/** Reuses the authenticated official queue transport, then narrows it to the
 * browser-authorized exact summary/attempt/delegated principal. */
export function registerDerivedSummaryAttemptMcpTools(server: McpServer, runtime: DerivedSummaryRuntimeService,
  authorization: CanonicalServiceScopeAuthorizationPort): void {
  server.registerTool('derived_summary_attempt', {
    title: '生成或读取已明确选取范围的候选摘要',
    description: '只推进浏览器已明确受理的精确摘要任务。完整读取固定成员及原始依据，保存不可变摘要和覆盖后才完成；ATA分类和模型产物保持候选，不形成正式采用。',
    inputSchema: z.discriminatedUnion('operation', [
      z.object({ ...target, operation: z.literal('CLAIM') }).strict(),
      z.object({ ...target, operation: z.literal('STATUS') }).strict(),
      z.object({ ...target, ...fence, operation: z.literal('HEARTBEAT') }).strict(),
      z.object({ ...target, operation: z.literal('CANCEL'), reason: z.string().trim().min(1).max(4000) }).strict(),
      z.object({ ...target, ...fence, operation: z.literal('FAIL'), code: z.string().trim().min(1).max(160),
        message: z.string().trim().min(1).max(4000) }).strict(),
      z.object({ ...reading, operation: z.literal('READ_MEMBER_WORK') }).strict(),
      z.object({ ...sourceReading, operation: z.literal('READ_SOURCES') }).strict(),
      z.object({ ...target, ...fence, operation: z.literal('SAVE_SUMMARY'), requestId,
        expectedSummaryRevision: z.number().int().nonnegative(), contentJson: z.string().min(2).max(1_000_000),
        provenanceJson: z.string().min(2).max(16000).optional() }).strict(),
      z.object({ ...target, operation: z.literal('READ_SAVED_SUMMARY'), requestId }).strict(),
      z.object({ ...target, ...fence, operation: z.literal('FINISH'), requestId }).strict(),
    ]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async input => {
    const scope = await authorization.authorizeOpenClawAutoWorkItemQueue();
    const args = { ...input, scope };
    switch (input.operation) {
      case 'CLAIM': return textResult(await runtime.claim(args));
      case 'STATUS': return textResult(await runtime.status(args));
      case 'HEARTBEAT': return textResult(await runtime.heartbeat({ ...input, scope }));
      case 'CANCEL': return textResult(await runtime.cancel({ ...input, scope }));
      case 'FAIL': return textResult(await runtime.fail({ ...input, scope }));
      case 'READ_MEMBER_WORK': return textResult(await runtime.readMemberWork({ ...input, scope }));
      case 'READ_SOURCES': return textResult(await runtime.readSources({ ...input, scope }));
      case 'SAVE_SUMMARY': return textResult(await runtime.save({ ...input, scope }));
      case 'READ_SAVED_SUMMARY': return textResult(await runtime.readSaved({ ...input, scope }));
      case 'FINISH': return textResult(await runtime.finish({ ...input, scope }));
    }
  });
}
