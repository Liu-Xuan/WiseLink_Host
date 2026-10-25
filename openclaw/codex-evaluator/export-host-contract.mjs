#!/usr/bin/env node
/** Export a pinned Host source inventory and the current Codex client expectation.
 * Usage: node export-host-contract.mjs <Host MCP service.ts> <readonly tools.ts> <controller.ts> <api.interface.ts> <derived tools.ts> <matter tools.ts> <output.json>
 * This is a constrained Zod-source converter, not a live tools/list probe.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { HOST_MCP_TOOLS } from '../skills/wiselink-research-and-synthesize/scripts/orchestrate-host-mcp.mjs';
import { WISELINK_HOST_MCP_NAME, WISELINK_HOST_MCP_VERSION } from '../skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';

const [serviceFile, readonlyFile, controllerFile, apiFile, derivedFile, matterFile, outputFile] = process.argv.slice(2);
if (!serviceFile || !readonlyFile || !controllerFile || !apiFile || !derivedFile || !matterFile || !outputFile) throw new Error('USAGE: service.ts readonly.ts controller.ts api.interface.ts derived-tools.ts matter-tools.ts output.json');
const service = await readFile(serviceFile, 'utf8');
const readonly = await readFile(readonlyFile, 'utf8');
const controller = await readFile(controllerFile, 'utf8');
const apiSource = await readFile(apiFile, 'utf8');
const derived = await readFile(derivedFile, 'utf8');
const matter = await readFile(matterFile, 'utf8');
const clientFile = fileURLToPath(new URL('../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs', import.meta.url));
const clientSource = await readFile(clientFile, 'utf8');
const codexIdentity = clientSource.match(/\? '(wiselink-codex-engineering-assessment)' : WISELINK_HOST_MCP_NAME/u)?.[1];
const codexPath = clientSource.match(/\? '(\/openapi\/wiselink\/codex-mcp)' : '\/openapi\/wiselink\/openclaw-mcp'/u)?.[1]
  ?? (clientSource.includes("'/openapi/wiselink/codex-mcp'") ? '/openapi/wiselink/codex-mcp' : null);
if (!codexIdentity || !codexPath) throw new Error('CODEX_CLIENT_EXPECTATION_NOT_FOUND');
const serverIdentity = service.match(/new McpServer\(\{\s*name: '([^']+)',\s*version: '([^']+)'/u);
if (!serverIdentity) throw new Error('SERVER_IDENTITY_NOT_FOUND');
const controllerRoot = controller.match(/@Controller\('([^']+)'\)/u)?.[1];
const mcpPost = controller.match(/@Post\('(openclaw-mcp)'\)/u)?.[1];
if (!controllerRoot || !mcpPost) throw new Error('SERVER_ROUTE_NOT_FOUND');
const sha256 = s => createHash('sha256').update(s).digest('hex');
const blobSha = s => createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest('hex');

// Scan source syntax, so nested commas and regexes do not truncate a Zod expression.
function expressionAfter(s, start) {
  let depth = 0, quote = '', regex = false, escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i], n = s[i + 1];
    if (quote || regex) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (quote && c === quote) quote = '';
      else if (regex && c === '/') regex = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '/' && n !== '/' && n !== '*') { regex = true; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) return s.slice(start, i).trim();
  }
  throw new Error('SCHEMA_EXPRESSION_UNTERMINATED');
}
function toolExpression(s, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`registerTool\\(\\s*'${escaped}'`, 'u').exec(s);
  if (!match) return null;
  const at = s.indexOf('inputSchema:', match.index);
  if (at < 0 || at - match.index > 2400) throw new Error(`TOOL_SCHEMA_MISSING:${name}`);
  return expressionAfter(s, at + 'inputSchema:'.length);
}
function matterToolExpression(name) {
  const match = new RegExp(`registerTool\\(tool\\('${name}'\\)`, 'u').exec(matter);
  if (!match) throw new Error(`MATTER_SCHEMA_SOURCE_MISSING:${name}`);
  const at = matter.indexOf('inputSchema:', match.index);
  if (at < 0 || at - match.index > 2400) throw new Error(`MATTER_SCHEMA_MISSING:${name}`);
  return expressionAfter(matter, at + 'inputSchema:'.length);
}
const optional = x => ({...x, __optional:true});
const api = x => ({
  ...x,
  trim() { return api(x); },
  min(n) { return api({...x, ...(x.type === 'string' ? {minLength:n} : x.type === 'array' ? {minItems:n} : {minimum:n})}); },
  max(n) { return api({...x, ...(x.type === 'string' ? {maxLength:n} : x.type === 'array' ? {maxItems:n} : {maximum:n})}); },
  positive() { return api({...x, minimum:1}); },
  nonnegative() { return api({...x, minimum:0}); },
  int() { return api({...x,type:'integer'}); },
  regex(re) { return api({...x, pattern:re.source}); },
  startsWith(prefix) { return api({...x, pattern:`^${prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`}); },
  uuid() { return api({...x,format:'uuid'}); },
  url() { return api({...x,format:'uri'}); },
  optional() { return api(optional(x)); },
  nullable() { return api({anyOf:[x,{type:'null'}]}); },
  default(v) { return api({...x, default:v, __optional:true}); },
  strict() { return api({...x, additionalProperties:false}); },
});
const clean = x => {
  if (Array.isArray(x)) return x.map(clean);
  if (!x || typeof x !== 'object') return x;
  const out = {};
  for (const [k,v] of Object.entries(x)) if (k !== '__optional' && typeof v !== 'function') out[k] = clean(v);
  return out;
};
const z = {
  string: () => api({type:'string'}), number: () => api({type:'number'}),
  boolean: () => api({type:'boolean'}), unknown: () => api({}),
  literal: v => api({const:v}), enum: values => api({type:'string',enum:values}),
  array: item => api({type:'array',items:clean(item)}),
  object: props => api({type:'object',properties:Object.fromEntries(Object.entries(props).map(([k,v]) => [k,clean(v)])),required:Object.keys(props).filter(k=>!props[k].__optional)}),
  strictObject: props => z.object(props).strict(),
  record: (_key,value) => api({type:'object',additionalProperties:clean(value)}),
  discriminatedUnion: (key, branches) => {
    if (!Array.isArray(branches) || branches.length < 2) throw new Error('UNION_BRANCHES_UNSUPPORTED');
    const values = new Set();
    for (const branch of branches) {
      const property = branch?.properties?.[key];
      const alternatives = property && Object.hasOwn(property, 'const') ? [property.const] : property?.enum;
      if (branch?.type !== 'object' || !branch.required?.includes(key) || !Array.isArray(alternatives) || !alternatives.length)
        throw new Error('UNION_DISCRIMINATOR_UNSUPPORTED');
      for (const value of alternatives) {
        if (values.has(value)) throw new Error('UNION_DISCRIMINATOR_OVERLAP');
        values.add(value);
      }
    }
    return api({oneOf:branches.map(clean)});
  },
};
const context = { z,
  tdmsNativeReferenceMcpSchema: () => { throw new Error('IMPORTED_TDMS_NATIVE_REFINEMENT_UNSUPPORTED'); },
};
function localConstant(source, name) {
  const match = new RegExp(`const ${name} = ([\\s\\S]*?);`, 'u').exec(source);
  if (!match) throw new Error(`LOCAL_SCHEMA_CONSTANT_MISSING:${name}`);
  return runInNewContext(`(${match[1]})`, context, {timeout:1000});
}
for (const name of ['mcpWorkItemId','mcpQuery']) context[name] = localConstant(readonly, name);
for (const name of ['attemptRef','leaseToken','leaseGeneration','resultEnvelope','reviewProgress',
  'reviewConversationRef','reviewRequestId','reviewSourceRefId','reviewCommitInput',
  'applicabilityContextRef','applicabilityRequestId','deliveryPart','discoveryCandidate','publicDiscoveryResult'])
  context[name] = localConstant(service, name);
const shapeLimitations = source => [
  ...(source.includes('.trim()') || /\b(?:attemptRef|mcpWorkItemId|mcpQuery|reviewConversationRef|reviewRequestId|reviewSourceRefId|reviewCommitInput|applicabilityContextRef|applicabilityRequestId|publicDiscoveryResult|discoveryCandidate)\b/u.test(source)
    ? ['Zod trim transforms and resulting post-trim length checks are not represented by this JSON Schema input shape.'] : []),
  ...(source.includes('.default(') ? ['Zod default insertion is not represented by JSON Schema validation.'] : []),
  'Runtime authorization, source-ref refinement, and business validity are not established by an input JSON Schema.',
];
const used = [
  'get_parse_status','get_deep_link','begin_dynamic_evaluation','read_assessment_sources',
  'query_assessment_knowledge','record_assessment_program_progress','save_assessment_work',
  'read_assessment_work','commit_dynamic_evaluation_candidate','begin_overall_synthesis',
  'commit_overall_candidate','heartbeat_action_attempt','get_action_attempt_status',
  'next_hierarchical_wiki','hierarchical_wiki_cleanup','read_document_original',
  'next_original_assessment','resume_overall_synthesis','begin_review_turn',
  'get_review_turn_context','read_source_refs','query_review_aily',
  'commit_review_turn_candidate','cancel_action_attempt','query_parsed_package',
  'begin_translation','begin_applicability_evaluation','commit_applicability_candidate',
  'record_oem_discovery_run',
];
const queueTypes = apiSource.match(/export type AutomaticWorkItemClaimResult =[\s\S]*?(?=export interface AutomaticWorkItemCancellationBinding)/u)?.[0];
const blockResponse = apiSource.match(/export interface BlockAutomaticWorkItemResponse \{[\s\S]*?\n\}/u)?.[0];
if (!queueTypes || !blockResponse) throw new Error('QUEUE_TYPES_NOT_FOUND');
const tools = {};
for (const name of used) {
  const origin = ['get_parse_status','get_deep_link','query_parsed_package'].includes(name) ? readonly : service;
  const source = toolExpression(origin,name);
  if (!source) { tools[name] = {schemaStatus:'NOT_FOUND_IN_FETCHED_SOURCE'}; continue; }
  try {
    const value = runInNewContext(source, context, {timeout:1000});
    tools[name] = {schemaStatus:'MECHANICAL_ZOD_INPUT_SHAPE',inputSchema:clean(value),zodExpression:source,
      semanticLimitations:shapeLimitations(source)};
  } catch (error) { tools[name] = {schemaStatus:'SOURCE_EXPRESSION_ONLY',zodExpression:source,
    conversionError:String(error.message),
    ...(name === 'read_assessment_sources' ? {unresolvedDependencies:['tdmsNativeReferenceMcpSchema']} : {})}; }
}
for (const [name, dependency] of [['commit_translation_candidate','translationCommitInput and imported TRANSLATION_RESULT_PART_MAX_BYTES/COUNT'],
  ['translation_workspace','translationWorkspaceCommandSchemaV2']]) {
  const source = toolExpression(service,name);
  if (!source) throw new Error(`IMPORTED_SCHEMA_SOURCE_MISSING:${name}`);
  tools[name] = {schemaStatus:'SOURCE_EXPRESSION_ONLY',zodExpression:source,
    reason:'Imported schema or numeric bounds cannot be resolved from pinned fetched source.',
    unresolvedDependencies:[dependency],sourcePath:'server/modules/canonical-host/canonical-host-openclaw-mcp.service.ts'};
}
const excludedToolSchemas = {};
for (const name of ['document_work','document_reading','document_translation','derived_summary_attempt']) {
  const source = toolExpression(name === 'derived_summary_attempt' ? derived : service, name);
  if (!source) throw new Error(`EXCLUDED_SCHEMA_SOURCE_MISSING:${name}`);
  const unresolvedDependencies = {document_work:['documentActivityActionSchemas'],
    document_reading:['documentReadingActionSchemas'],document_translation:['translationWorkspaceCommandSchemaV2'],
    derived_summary_attempt:['tdmsNativeReferenceMcpSchema']}[name];
  excludedToolSchemas[name] = {schemaStatus:'SOURCE_EXPRESSION_ONLY',zodExpression:source,
    reason:'Imported action schema or TDMS native-reference refiner is unavailable in pinned fetched source.',
    unresolvedDependencies,
    sourcePath:`server/modules/canonical-host/${name === 'derived_summary_attempt' ? 'derived-summary-attempt-mcp-tools.ts' : 'canonical-host-openclaw-mcp.service.ts'}`};
}
if (!service.includes("prefix: 'hierarchical_wiki_'") ||
    !service.includes('registerMatterAttemptMcpTools(server, this.matterAttempts'))
  throw new Error('MATTER_REGISTRATIONS_NOT_FOUND');
const matterExpression = matterToolExpression('matter_action_attempt');
const matterContext = {...context,target:localConstant(matter,'target'),fence:localConstant(matter,'fence')};
for (const name of ['next_matter_assessment','read_matter_current_work','begin_matter_assessment','matter_action_attempt']) {
  const expression = name === 'matter_action_attempt' ? matterExpression : matterToolExpression(name);
  const converted = {schemaStatus:'MECHANICAL_ZOD_INPUT_SHAPE',
    inputSchema:clean(runInNewContext(expression,matterContext,{timeout:1000})),
    zodExpression:expression,
    semanticLimitations:shapeLimitations(expression + (matter.match(/^const target = .+$/mu)?.[0] ?? '')),
    sourcePath:'server/modules/canonical-host/matter-attempt-mcp-tools.ts',
    registrationNote:'Source registers this schema through a configurable tool-name prefix.'};
  tools[name] = converted;
  if (name !== 'begin_matter_assessment')
    tools[`hierarchical_wiki_${name}`] = {...converted,
      registrationNote:'The hierarchical-wiki registration uses this same source schema with prefix hierarchical_wiki_ and automaticOnly true.'};
}
const output = {
  schemaVersion:'wiselink.codex-host-source-contract.v1',
  evidence:{hostCommit:'fc1322919b1b52433c33086c8db4aeb957f0e982',hostSource:{path:'server/modules/canonical-host/canonical-host-openclaw-mcp.service.ts',gitBlobSha:blobSha(service),sha256:sha256(service)},readonlySource:{path:'server/modules/canonical-host/canonical-host-readonly-mcp-tools.ts',gitBlobSha:blobSha(readonly),sha256:sha256(readonly)},controllerSource:{path:'server/modules/canonical-host/canonical-host-openclaw-mcp.openapi.controller.ts',gitBlobSha:blobSha(controller),sha256:sha256(controller)},apiSource:{path:'shared/api.interface.ts',gitBlobSha:blobSha(apiSource),sha256:sha256(apiSource)},derivedSource:{path:'server/modules/canonical-host/derived-summary-attempt-mcp-tools.ts',gitBlobSha:blobSha(derived),sha256:sha256(derived)},matterSource:{path:'server/modules/canonical-host/matter-attempt-mcp-tools.ts',gitBlobSha:blobSha(matter),sha256:sha256(matter)},liveToolsListVerified:false,proposedCodexHostBranchVerified:false},
  client:{sourcePath:'openclaw/skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs',sourceSha256:sha256(clientSource),legacyServerName:WISELINK_HOST_MCP_NAME,expectedServerVersion:WISELINK_HOST_MCP_VERSION,expectedCodexServerName:codexIdentity,expectedCodexMcpPath:codexPath,legacyMcpPath:'/openapi/wiselink/openclaw-mcp',requiredLegacyToolNames:HOST_MCP_TOOLS},
  serverSource:{serverName:serverIdentity[1],serverVersion:serverIdentity[2],mcpPath:`/${controllerRoot}/${mcpPost}`,identityStatus:'PINNED_LEGACY_SOURCE_ONLY',queueRestPaths:['next-work-item','ack-work-item','block-work-item'].map(route=>{if(!controller.includes(`@Post('${route}')`)) throw new Error(`QUEUE_ROUTE_NOT_FOUND:${route}`);return `/${controllerRoot}/${route}`}),queueTypeScriptDeclarations:queueTypes+blockResponse,tools,excludedToolSchemas,otherUnexportedClientToolNames:HOST_MCP_TOOLS.filter(name=>!(name in tools)&&!(name in excludedToolSchemas))},
  limitations:['JSON Schemas mechanically describe input shape from selected pinned Zod expressions; they are not a live MCP tools/list response or a claim of exact Zod acceptance equivalence.','Zod trim transformation and runtime authorization are outside JSON Schema validation; see each converted schema semanticLimitations and exact zodExpression.','Imported action schemas and TDMS native-reference refinements remain exact source expressions with named unresolved dependencies; no approximate schema is substituted.','The selected inventory is not a complete Host tool export; all omitted legacy client tool names are inventoried.','Server response JSON shapes are described by client validators and examples, not inferred from input schemas.'],
};
await writeFile(outputFile,JSON.stringify(output,null,2)+'\n');
