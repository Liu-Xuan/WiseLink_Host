import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { toNodeHandler, type NodeMcpRequestHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { AilyMcpIdentityService, readAilyMcpIdentityDiagnostic, type AilyMcpCaller,
  type AilyMcpIdentityDiagnostic } from './aily-mcp-identity.service';
import { AilyTaskDomainService } from './aily-task-domain.service';
import { ailySourceCommand, ailyValidateCommand, ailySaveCommand, ailyReadCommand,
  ailyStageCommand, ailyFinishCommand } from './aily-task-domain.types';

const annotations = {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false};
type DiscoveryMethod = 'initialize' | 'notifications/initialized' | 'tools/list' | 'ping';
type DiscoveryAuth = 'MISSING_JWT' | 'NOT_CONFIGURED' | 'MAPPING_MISSING' | 'REJECTED' | 'UNCONFIRMED' | 'VERIFIED' | 'SERVICE_ROUTE';

/** Only a single static request bypasses the business precheck. The SDK still validates its protocol. */
function discoveryMethod(body: unknown): DiscoveryMethod | null {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      !('jsonrpc' in body) || body.jsonrpc !== '2.0' || !('method' in body)) return null;
  switch (body.method) {
    case 'initialize': case 'notifications/initialized': case 'tools/list': case 'ping': return body.method;
    default: return null;
  }
}

/** Each stateless request closes over its original JWT, never a cached actor. */
@Injectable()
export class CanonicalHostAilyMcpService {
  private readonly logger = new Logger(CanonicalHostAilyMcpService.name);
  constructor(private readonly identity: AilyMcpIdentityService, private readonly domain: AilyTaskDomainService) {}

  async handle(request: Parameters<NodeMcpRequestHandler>[0], response: Parameters<NodeMcpRequestHandler>[1],
    body: unknown, jwt: unknown): Promise<void> {
    const method = discoveryMethod(body);
    if (method) await this.observeDiscovery(method, jwt);
    else await this.identity.authorizeCaller(jwt);
    const handler = createMcpHandler(() => this.server(jwt), {legacy: 'stateless', responseMode: 'json'});
    await toNodeHandler(handler)(request, response, body);
  }

  /** Read-only authentication evidence; neither this actor nor this outcome grants tool authority. */
  private async observeDiscovery(method: DiscoveryMethod, jwt: unknown): Promise<void> {
    let outcome: DiscoveryAuth = 'MISSING_JWT';
    let identityDiagnostic: Readonly<AilyMcpIdentityDiagnostic> | null = null;
    const authenticationMode=this.identity.authenticationMode();
    if (authenticationMode==='HOST_SERVICE' || (jwt !== undefined && jwt !== null)) {
      try { await this.identity.authorizeCaller(jwt); outcome = authenticationMode==='HOST_SERVICE'?'SERVICE_ROUTE':'VERIFIED'; }
      catch (cause) {
        identityDiagnostic = readAilyMcpIdentityDiagnostic(cause);
        outcome = 'UNCONFIRMED';
        if (cause instanceof UnauthorizedException) {
          if (cause.message === 'AILY_MCP_IDENTITY_NOT_CONFIGURED') outcome = 'NOT_CONFIGURED';
          else if (cause.message === 'AILY_MCP_SUBJECT_MAPPING_REQUIRED') outcome = 'MAPPING_MISSING';
          else if (cause.message === 'AILY_MCP_JWT_INVALID') outcome = 'REJECTED';
        }
      }
    }
    this.logger.log(JSON.stringify({event: 'AILY_MCP_DISCOVERY_AUTH', method, outcome, domainDispatched: false,
      ...(identityDiagnostic ? {identityDiagnostic} : {}),
      ...(authenticationMode==='HOST_SERVICE'?{authenticationMode}:{})}));
  }

  private server(jwt: unknown): McpServer {
    const server = new McpServer({name: 'wiselink-aily-engineering', version: '1.0.0'});
    server.registerTool('read_assessment_sources', {title: '读取本任务获权来源', inputSchema: ailySourceCommand, annotations},
      input => this.result(jwt, actor => this.domain.sources(actor, input)));
    server.registerTool('validate_assessment_work', {title: '校验完整评估候选', inputSchema: ailyValidateCommand, annotations},
      input => this.result(jwt, actor => this.domain.validate(actor, input)));
    server.registerTool('save_assessment_work', {title: '保存原校验候选', inputSchema: ailySaveCommand, annotations},
      input => this.result(jwt, actor => this.domain.save(actor, input)));
    server.registerTool('read_assessment_work', {title: '准确读回已保存正文', inputSchema: ailyReadCommand, annotations},
      input => this.result(jwt, actor => this.domain.read(actor, input)));
    server.registerTool('project_assessment_stage_overall', {title: '保存同版阶段综合', inputSchema: ailyStageCommand, annotations},
      input => this.result(jwt, actor => this.domain.stageOverall(actor, input)));
    server.registerTool('finish_assessment_task', {title: '提交本任务最终成果', inputSchema: ailyFinishCommand, annotations},
      input => this.result(jwt, actor => this.domain.finish(actor, input)));
    return server;
  }

  private async result(jwt: unknown, operation: (actor: AilyMcpCaller) => Promise<unknown>) {
    try {
      const actor = await this.identity.authorizeCaller(jwt);
      return {content: [{type: 'text' as const, text: JSON.stringify(await operation(actor))}]};
    } catch (cause) {
      const code = cause instanceof Error && /^[A-Z][A-Z0-9_:.-]{0,199}$/u.test(cause.message)
        ? cause.message : 'AILY_DOMAIN_OPERATION_UNCONFIRMED';
      return {isError: true, content: [{type: 'text' as const, text: JSON.stringify({code})}]};
    }
  }
}
