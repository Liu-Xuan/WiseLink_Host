import { Injectable } from '@nestjs/common';
import { toNodeHandler, type NodeMcpRequestHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { AilyMcpIdentityService, type AilyMcpVerifiedActor } from './aily-mcp-identity.service';
import { AilyTaskDomainService } from './aily-task-domain.service';
import { ailySourceCommand, ailyValidateCommand, ailySaveCommand, ailyReadCommand,
  ailyStageCommand, ailyFinishCommand } from './aily-task-domain.types';

const annotations = {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false};

/** Each stateless request closes over its own verified actor. No global identity. */
@Injectable()
export class CanonicalHostAilyMcpService {
  constructor(private readonly identity: AilyMcpIdentityService, private readonly domain: AilyTaskDomainService) {}

  async handle(request: Parameters<NodeMcpRequestHandler>[0], response: Parameters<NodeMcpRequestHandler>[1],
    body: unknown, jwt: unknown): Promise<void> {
    const actor = await this.identity.verify(jwt);
    const handler = createMcpHandler(() => this.server(actor), {legacy: 'stateless', responseMode: 'json'});
    await toNodeHandler(handler)(request, response, body);
  }

  private server(actor: AilyMcpVerifiedActor): McpServer {
    const server = new McpServer({name: 'wiselink-aily-engineering', version: '1.0.0'});
    server.registerTool('read_assessment_sources', {title: '读取本任务获权来源', inputSchema: ailySourceCommand, annotations},
      input => this.result(() => this.domain.sources(actor, input)));
    server.registerTool('validate_assessment_work', {title: '校验完整评估候选', inputSchema: ailyValidateCommand, annotations},
      input => this.result(() => this.domain.validate(actor, input)));
    server.registerTool('save_assessment_work', {title: '保存原校验候选', inputSchema: ailySaveCommand, annotations},
      input => this.result(() => this.domain.save(actor, input)));
    server.registerTool('read_assessment_work', {title: '准确读回已保存正文', inputSchema: ailyReadCommand, annotations},
      input => this.result(() => this.domain.read(actor, input)));
    server.registerTool('project_assessment_stage_overall', {title: '保存同版阶段综合', inputSchema: ailyStageCommand, annotations},
      input => this.result(() => this.domain.stageOverall(actor, input)));
    server.registerTool('finish_assessment_task', {title: '提交本任务最终成果', inputSchema: ailyFinishCommand, annotations},
      input => this.result(() => this.domain.finish(actor, input)));
    return server;
  }

  private async result(operation: () => Promise<unknown>) {
    try { return {content: [{type: 'text' as const, text: JSON.stringify(await operation())}]}; }
    catch (cause) {
      const code = cause instanceof Error && /^[A-Z][A-Z0-9_:.-]{0,199}$/u.test(cause.message)
        ? cause.message : 'AILY_DOMAIN_OPERATION_UNCONFIRMED';
      return {isError: true, content: [{type: 'text' as const, text: JSON.stringify({code})}]};
    }
  }
}
