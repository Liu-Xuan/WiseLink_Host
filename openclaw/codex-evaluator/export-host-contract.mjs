#!/usr/bin/env node
/** Export a pinned Host source inventory and the current Codex client expectation.
 * Usage: node export-host-contract.mjs <Host MCP service.ts> <readonly tools.ts> <controller.ts> <api.interface.ts> <derived tools.ts> <matter tools.ts> <output.json>
 * The original 35 shapes use a constrained converter. Seven imported schemas
 * execute pinned Zod 4.6.5 via WISELINK_ZOD_MODULE. No live tools/list probe.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { HOST_MCP_TOOLS } from '../skills/wiselink-research-and-synthesize/scripts/orchestrate-host-mcp.mjs';
import { WISELINK_HOST_MCP_NAME, WISELINK_HOST_MCP_VERSION, WISELINK_CODEX_MCP_NAME,
  WL_CODEX_RUNTIME_APP_ID, canonicalSha256 } from '../skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';
import { createHostAutoWorkItemQueueClient } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';

const [serviceFile, readonlyFile, controllerFile, apiFile, derivedFile, matterFile, outputFile] = process.argv.slice(2);
if (!serviceFile || !readonlyFile || !controllerFile || !apiFile || !derivedFile || !matterFile || !outputFile) throw new Error('USAGE: service.ts readonly.ts controller.ts api.interface.ts derived-tools.ts matter-tools.ts output.json');
const service = await readFile(serviceFile, 'utf8');
const readonly = await readFile(readonlyFile, 'utf8');
const controller = await readFile(controllerFile, 'utf8');
const apiSource = await readFile(apiFile, 'utf8');
const derived = await readFile(derivedFile, 'utf8');
const matter = await readFile(matterFile, 'utf8');
const dependencyRoot = new URL('./host-contract/source/', import.meta.url);
const dependencyPaths = [
  'server/modules/canonical-host/tdms-native-reference-mcp.schema.ts',
  'shared/tdms-approved-opinion-reference.ts',
  'server/modules/canonical-host/canonical-translation-v2.service.ts',
  'server/modules/canonical-host/canonical-translation-v2.contract.ts',
  'server/modules/canonical-host/canonical-host-openclaw-translation.service.ts',
  'server/modules/canonical-host/document-activity-runtime.service.ts',
  'server/modules/canonical-host/document-reading-runtime.service.ts',
  'shared/document-activity.interface.ts',
  'shared/document-activity-quote-selection.ts',
];
const dependencySources = Object.fromEntries(await Promise.all(dependencyPaths.map(async path =>
  [path, await readFile(new URL(path, dependencyRoot), 'utf8')])));
const dep = suffix => dependencySources[dependencyPaths.find(path => path.endsWith(suffix))];
const clientFile = fileURLToPath(new URL('../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs', import.meta.url));
const clientSource = await readFile(clientFile, 'utf8');
const codexIdentity = clientSource.includes('WISELINK_CODEX_MCP_NAME') ? WISELINK_CODEX_MCP_NAME : null;
const codexPath = clientSource.match(/\? '(\/openapi\/wiselink\/codex-mcp)' : '\/openapi\/wiselink\/openclaw-mcp'/u)?.[1]
  ?? (clientSource.includes("'/openapi/wiselink/codex-mcp'") ? '/openapi/wiselink/codex-mcp' : null);
if (!codexIdentity || !codexPath) throw new Error('CODEX_CLIENT_EXPECTATION_NOT_FOUND');
// Execute the actual queue URL builder against a recording transport. These
// are client expectations; this does not contact or verify a Host controller.
const codexQueueRestPaths=[];
const queueClient=createHostAutoWorkItemQueueClient({modelExecutor:'CODEX',runtimeAppId:WL_CODEX_RUNTIME_APP_ID,
  hostMcpUrl:`https://fixture.invalid${codexPath}`},async url=>{
  codexQueueRestPaths.push(new URL(url).pathname);
  return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>({})};
});
for(const method of ['nextWorkItem','acknowledgeWorkItem','blockWorkItem','applyPendingModelConfiguration'])
  await queueClient[method]({});
const serverIdentity = service.match(/new McpServer\(\{\s*name: '([^']+)',\s*version: '([^']+)'/u);
if (!serverIdentity) throw new Error('SERVER_IDENTITY_NOT_FOUND');
const controllerRoot = controller.match(/@Controller\('([^']+)'\)/u)?.[1];
const mcpPost = controller.match(/@Post\('(openclaw-mcp)'\)/u)?.[1];
if (!controllerRoot || !mcpPost) throw new Error('SERVER_ROUTE_NOT_FOUND');
const sha256 = s => createHash('sha256').update(s).digest('hex');
const blobSha = s => createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest('hex');
// Refuse to label changed inputs as the historical Host source revision.
const pinnedSourceBlobs = {
  "server/modules/canonical-host/canonical-host-openclaw-mcp.service.ts": "7607bcc337b186b598434c8c5e725ab72db2ceb1",
  "server/modules/canonical-host/canonical-host-readonly-mcp-tools.ts": "34c4806ce1cb838cace32f917cd7f9678cff8f30",
  "server/modules/canonical-host/canonical-host-openclaw-mcp.openapi.controller.ts": "d10d756a4a37199710656c1fad7b5edf8bb1715e",
  "shared/api.interface.ts": "0cf94ee8bf309808add2d4fe31b1a73dfb12a110",
  "server/modules/canonical-host/derived-summary-attempt-mcp-tools.ts": "9b223ec11be5b4f95110b8837b4dfe52ca7bd340",
  "server/modules/canonical-host/matter-attempt-mcp-tools.ts": "2d0bf252c26418cdb4d0b202a63aab2aa1b1f69a",
  "server/modules/canonical-host/tdms-native-reference-mcp.schema.ts": "c2c2570574294b3d15d8ecc210239f08b3ca7cdf",
  "shared/tdms-approved-opinion-reference.ts": "843c869615fe3cc4dc5cdce90c8a4619dfcd9114",
  "server/modules/canonical-host/canonical-translation-v2.service.ts": "3d11156d7c5cac7bed9132540660cfd0d74f780d",
  "server/modules/canonical-host/canonical-translation-v2.contract.ts": "fa758cf111592490f13b9c3fd1e5187693dc392c",
  "server/modules/canonical-host/canonical-host-openclaw-translation.service.ts": "d57b570598d48dc324625c73d2f7dd1ee65eed38",
  "server/modules/canonical-host/document-activity-runtime.service.ts": "b50f01d841c49e887cbec10c956bba6f164cce16",
  "server/modules/canonical-host/document-reading-runtime.service.ts": "299380d5565ffeaa075c8cab9c7cbba50180120b",
  "shared/document-activity.interface.ts": "b851bbba3581623c5d220e8847634ba64807920e",
  "shared/document-activity-quote-selection.ts": "623d8705408217e7edcfdbc743169ab252fc9367"
};
const primarySources = {
  'server/modules/canonical-host/canonical-host-openclaw-mcp.service.ts': service,
  'server/modules/canonical-host/canonical-host-readonly-mcp-tools.ts': readonly,
  'server/modules/canonical-host/canonical-host-openclaw-mcp.openapi.controller.ts': controller,
  'shared/api.interface.ts': apiSource,
  'server/modules/canonical-host/derived-summary-attempt-mcp-tools.ts': derived,
  'server/modules/canonical-host/matter-attempt-mcp-tools.ts': matter,
};
for (const [path, source] of Object.entries({...primarySources, ...dependencySources})) {
  if (blobSha(source) !== pinnedSourceBlobs[path]) throw new Error(`PINNED_HOST_SOURCE_MISMATCH:${path}`);
}

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
  trim() { return api({...x,'x-zodTrim':true}); },
  min(n) { return api({...x, ...(x.type === 'string' ? {minLength:n} : x.type === 'array' ? {minItems:n} : {minimum:n})}); },
  max(n) { return api({...x, ...(x.type === 'string' ? {maxLength:n} : x.type === 'array' ? {maxItems:n} : {maximum:n})}); },
  positive() { return api({...x, minimum:1}); },
  nonnegative() { return api({...x, minimum:0}); },
  int() { return api({...x,type:'integer'}); },
  regex(re) { return api({...x, pattern:re.source}); },
  startsWith(prefix) { return api({...x, pattern:`^${prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`}); },
  uuid() { return api({...x,format:'uuid'}); },
  url() { return api({...x,format:'uri'}); },
  datetime() { return api({...x,format:'date-time'}); },
  optional() { return api(optional(x)); },
  nullable() { return api({anyOf:[x,{type:'null'}]}); },
  default(v) { return api({...x, default:v, __optional:true}); },
  strict() { return api({...x, additionalProperties:false}); },
  omit(fields) { if (x.type !== 'object') throw new Error('OMIT_NON_OBJECT'); const properties={...x.properties}; for(const name of Object.keys(fields)) delete properties[name]; return api({...x,properties,required:x.required.filter(name=>!Object.hasOwn(fields,name))}); },
  transform() { return api({...x,__transform:true}); },
  refine(predicate) { return api({...x,'x-runtimeRefinement':predicate === 'TDMS_NATIVE' ? 'isTdmsApprovedOpinionReference' : 'trimmedNonempty'}); },
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
  union: branches => api({anyOf:branches.map(clean)}),
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
const tdms = dep('tdms-approved-opinion-reference.ts');
const literal = (source,name) => {
  const value = source.match(new RegExp(`(?:export )?const ${name} = '([^']+)'`, 'u'))?.[1];
  if (!value) throw new Error(`DEPENDENCY_LITERAL_MISSING:${name}`);
  return value;
};
const tdmsMax = 'TDMS_APPROVED_OPINION:'.length + 5 * 255 * 9 + 5 + 16;
if (!tdms.includes('5 * 255 * 9 + 5 + 16')) throw new Error('TDMS_MAX_SOURCE_CHANGED');
const ordinaryPattern = literal(tdms,'TDMS_ORDINARY_REFERENCE_PATTERN');
const nativePatternLiteral = tdms.match(/TDMS_APPROVED_OPINION_REFERENCE_PATTERN =\s*\n\s*("[^"]+")/u)?.[1];
if (!nativePatternLiteral) throw new Error('TDMS_NATIVE_PATTERN_MISSING');
const nativePattern = JSON.parse(nativePatternLiteral);
const nativeSchemaSource = dep('tdms-native-reference-mcp.schema.ts');
if (!nativeSchemaSource.includes('.refine(isTdmsApprovedOpinionReference)')) throw new Error('TDMS_REFINEMENT_MISSING');
const tdmsNativeReferenceMcpSchema = ordinary => z.union([
  ordinary.regex(new RegExp(ordinaryPattern,'u')),
  z.string().min(1).max(tdmsMax).regex(new RegExp(nativePattern,'u'))
    .refine('TDMS_NATIVE'),
]);
const context = { z, tdmsNativeReferenceMcpSchema };
function localConstant(source, name, scope=context) {
  const match = new RegExp(`const ${name} = ([\\s\\S]*?);`, 'u').exec(source);
  if (!match) throw new Error(`LOCAL_SCHEMA_CONSTANT_MISSING:${name}`);
  return runInNewContext(`(${match[1]})`, scope, {timeout:1000});
}
function exportedConstant(source,name,scope=context) {
  const match = new RegExp(`export const ${name} = `, 'u').exec(source);
  if (!match) throw new Error(`EXPORTED_SCHEMA_CONSTANT_MISSING:${name}`);
  const tail = source.slice(match.index + match[0].length);
  // These pinned declarations end at a top-level semicolon; source expressions have no
  // unbalanced semicolons inside the selected Zod expression.
  const expression = tail.slice(0,tail.indexOf(';')).replace(/\s+as const\s*$/u,'').trim();
  return runInNewContext(`(${expression})`, scope, {timeout:1000});
}
for (const name of ['mcpWorkItemId','mcpQuery']) context[name] = localConstant(readonly, name);
for (const name of ['attemptRef','leaseToken','leaseGeneration','resultEnvelope','reviewProgress',
  'reviewConversationRef','reviewRequestId','reviewSourceRefId','reviewCommitInput',
  'applicabilityContextRef','applicabilityRequestId','deliveryPart','discoveryCandidate','publicDiscoveryResult'])
  context[name] = localConstant(service, name);
for (const name of ['TRANSLATION_RESULT_PART_MAX_BYTES','TRANSLATION_RESULT_PART_MAX_COUNT']) {
  const match = dep('canonical-host-openclaw-translation.service.ts').match(new RegExp(`export const ${name} = ([0-9_]+);`, 'u'));
  if (!match) throw new Error(`TRANSLATION_BOUND_MISSING:${name}`);
  context[name] = Number(match[1].replaceAll('_',''));
}
for (const name of ['resultContentHash','translationResultPartBinding','translationCommitInput'])
  context[name] = localConstant(service,name);
const contractSource = dep('canonical-translation-v2.contract.ts');
for (const name of ['id','text']) context[name] = localConstant(contractSource,name);
context.translationIssueSchemaV2 = exportedConstant(contractSource,'translationIssueSchemaV2');
const workspaceSource = dep('canonical-translation-v2.service.ts');
for (const name of ['id','positive','base','nullableTokens','actualExecution','modelCandidate','semanticReview'])
  context[name] = localConstant(workspaceSource,name);
context.translationWorkspaceCommandSchemaV2 = exportedConstant(workspaceSource,'translationWorkspaceCommandSchemaV2');
const activitySource = dep('document-activity-runtime.service.ts');
for (const name of ['DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA','DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2',
  'DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA','DOCUMENT_ACTIVITY_QUOTE_OFFSETS_SCHEMA'])
  context[name] = literal(dep('document-activity.interface.ts'),name);
context.DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA = literal(dep('document-activity-quote-selection.ts'),'DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA');
for (const name of ['id','run','fenced','productionContractSchema']) context[name] = localConstant(activitySource,name);
context.documentActivityActionSchemas = exportedConstant(activitySource,'documentActivityActionSchemas');
const readingSource = dep('document-reading-runtime.service.ts');
for (const name of ['id','delivery','run','fenced']) context[name] = localConstant(readingSource,name);
context.documentReadingActionSchemas = exportedConstant(readingSource,'documentReadingActionSchemas');
for (const name of ['target','fence','requestId','reading','sourceReading']) context[name] = localConstant(derived,name);
// Re-evaluate the pinned expressions with the Host lockfile's actual Zod v4 API.
// The installed module is supplied explicitly so this exporter never silently
// substitutes a source-shape shim for the real validator.
if (!process.env.WISELINK_ZOD_MODULE) throw new Error('WISELINK_ZOD_MODULE_REQUIRED: point to pinned zod/v4/index.js (Host lock: 4.6.5)');
const realZod = (await import(process.env.WISELINK_ZOD_MODULE)).z;
if (JSON.stringify(realZod?.core?.version) !== JSON.stringify({major:4,minor:6,patch:5}))
  throw new Error('PINNED_ZOD_VERSION_MISMATCH: expected zod/v4@4.6.5');
const predicateSource = tdms.slice(tdms.indexOf('export function isTdmsApprovedOpinionReference'))
  .replace(/export function isTdmsApprovedOpinionReference\(\s*value: unknown,\s*\): value is string \{/u,
    'function isTdmsApprovedOpinionReference(value) {')
  .replace('components[5]!','components[5]');
const realPredicate = runInNewContext(
  `const TDMS_APPROVED_OPINION_REFERENCE_PREFIX='TDMS_APPROVED_OPINION:'; const TDMS_APPROVED_OPINION_REFERENCE_MAX_LENGTH=TDMS_APPROVED_OPINION_REFERENCE_PREFIX.length + 5 * 255 * 9 + 5 + 16; ${predicateSource}\nisTdmsApprovedOpinionReference;`,
  {},{timeout:1000});
const nativeFactorySource = nativeSchemaSource.slice(nativeSchemaSource.indexOf('export function tdmsNativeReferenceMcpSchema'))
  .replace('export function tdmsNativeReferenceMcpSchema(ordinary: z.ZodString)',
    'function tdmsNativeReferenceMcpSchema(ordinary)');
const realTdmsSchema = runInNewContext(`${nativeFactorySource}\ntdmsNativeReferenceMcpSchema;`, {
  z:realZod, isTdmsApprovedOpinionReference:realPredicate,
  TDMS_APPROVED_OPINION_REFERENCE_MAX_LENGTH:tdmsMax,
  TDMS_APPROVED_OPINION_REFERENCE_PATTERN:nativePattern,
  TDMS_ORDINARY_REFERENCE_PATTERN:ordinaryPattern,
}, {timeout:1000});
const real = {z:realZod,tdmsNativeReferenceMcpSchema:realTdmsSchema,Math};
for (const name of ['mcpWorkItemId','mcpQuery']) real[name] = localConstant(readonly,name,real);
for (const name of ['attemptRef','leaseToken','leaseGeneration','resultEnvelope','reviewProgress',
  'reviewConversationRef','reviewRequestId','reviewSourceRefId','reviewCommitInput',
  'applicabilityContextRef','applicabilityRequestId','deliveryPart','discoveryCandidate','publicDiscoveryResult'])
  real[name] = localConstant(service,name,real);
for (const name of ['TRANSLATION_RESULT_PART_MAX_BYTES','TRANSLATION_RESULT_PART_MAX_COUNT'])
  real[name] = context[name];
for (const name of ['resultContentHash','translationResultPartBinding','translationCommitInput'])
  real[name] = localConstant(service,name,real);
for (const name of ['id','text']) real[name] = localConstant(contractSource,name,real);
real.translationIssueSchemaV2 = exportedConstant(contractSource,'translationIssueSchemaV2',real);
for (const name of ['id','positive','base','nullableTokens','actualExecution','modelCandidate','semanticReview'])
  real[name] = localConstant(workspaceSource,name,real);
real.translationWorkspaceCommandSchemaV2 = exportedConstant(workspaceSource,'translationWorkspaceCommandSchemaV2',real);
for (const name of ['DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA','DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2',
  'DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA','DOCUMENT_ACTIVITY_QUOTE_OFFSETS_SCHEMA','DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA'])
  real[name] = context[name];
for (const name of ['id','run','fenced','productionContractSchema']) real[name] = localConstant(activitySource,name,real);
real.documentActivityActionSchemas = exportedConstant(activitySource,'documentActivityActionSchemas',real);
for (const name of ['id','delivery','run','fenced']) real[name] = localConstant(readingSource,name,real);
real.documentReadingActionSchemas = exportedConstant(readingSource,'documentReadingActionSchemas',real);
for (const name of ['target','fence','requestId','reading','sourceReading']) real[name] = localConstant(derived,name,real);
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
const dependencyResolvedTools = ['read_assessment_sources','commit_translation_candidate',
  'translation_workspace','document_work','document_reading','document_translation','derived_summary_attempt'];
const realValidators = {};
for (const name of dependencyResolvedTools) {
  const source = toolExpression(name === 'derived_summary_attempt' ? derived : service,name);
  if (!source) throw new Error(`DEPENDENCY_RESOLVED_SCHEMA_SOURCE_MISSING:${name}`);
  const validator = runInNewContext(source,real,{timeout:1000});
  realValidators[name] = validator;
  const schema = realZod.toJSONSchema(validator,{io:'input'});
  tools[name] = {schemaStatus:'PINNED_ZOD_V4_INPUT_SCHEMA',inputSchema:schema,zodExpression:source,
    semanticLimitations:shapeLimitations(source).concat([
      'The source Zod expressions were executed with locked Zod 4.6.5; JSON Schema omits custom runtime refinements.',
      'Exact native reference and nonblank-text refinements require the original runtime validator; this is not a live tools/list response.'
    ]),sourcePath:`server/modules/canonical-host/${name === 'derived_summary_attempt' ? 'derived-summary-attempt-mcp-tools.ts' : 'canonical-host-openclaw-mcp.service.ts'}`,
    resolvedDependencyPaths:dependencyPaths,validatorEngine:'zod/v4@4.6.5',
    runtimeRefinements:name==='read_assessment_sources'||name==='derived_summary_attempt'
      ? ['isTdmsApprovedOpinionReference'] : name==='translation_workspace'||name==='document_translation'
      ? ['trimmedNonempty'] : []};
}
function sample(schema) {
  if (Object.hasOwn(schema,'const')) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.anyOf) return sample(schema.anyOf[0]);
  if (schema.oneOf) return sample(schema.oneOf[0]);
  if (schema.type==='null') return null;
  if (schema.type==='boolean') return true;
  if (schema.type==='number'||schema.type==='integer') return Math.max(schema.minimum??0,1);
  if (schema.type==='array') return Array.from({length:Math.max(schema.minItems??0,1)},()=>sample(schema.items));
  if (schema.type==='object') return Object.fromEntries((schema.required??[]).map(key=>[key,sample(schema.properties[key])]));
  if (schema.type==='string') {
    if (schema.format==='uuid') return '00000000-0000-4000-8000-000000000001';
    if (schema.format==='date-time') return '2026-10-25T00:00:00Z';
    if (schema.format==='uri'||schema.format==='url') return 'https://example.invalid/a';
    const candidates=['A','DS-A','WI-DEMO','ATT-DEMO','work-item:WI-DEMO',
      'acquisition:A','a'.repeat(64),'TDMS_APPROVED_OPINION:A:B:C:D:E:0'];
    const selected=candidates.find(value=>value.length>=(schema.minLength??0) &&
      value.length<=(schema.maxLength??Infinity) &&
      (!schema.pattern||new RegExp(schema.pattern,'u').test(value)));
    if (selected) return selected;
    const padded='A'.repeat(Math.max(schema.minLength??1,1));
    if (!schema.pattern||new RegExp(schema.pattern,'u').test(padded)) return padded;
    throw new Error(`SYNTHETIC_SAMPLE_UNAVAILABLE:${JSON.stringify(schema)}`);
  }
  return {};
}
const branchEvidence = {};
const zodCases = {};
for (const name of dependencyResolvedTools) {
  const schema=tools[name].inputSchema, validator=realValidators[name];
  const branches=schema.oneOf??schema.anyOf??[schema];
  let accepted=0,rejected=0;
  zodCases[name]={accepted:[],rejected:[]};
  for (let index=0;index<branches.length;index++) {
    const valid=sample(branches[index]);
    const parsed=validator.safeParse(valid);
    if (!parsed.success) throw new Error(`PINNED_ZOD_POSITIVE_FAILED:${name}:${index}:${JSON.stringify(parsed.error.issues)}`);
    accepted++;
    zodCases[name].accepted.push({case:`branch-${index}`,input:valid});
    if (branches[index].type==='object') {
      const required=branches[index].required??[];
      if (required.length) {
        const missing={...valid}; delete missing[required[0]];
        if (validator.safeParse(missing).success) throw new Error(`PINNED_ZOD_REQUIRED_WEAKENED:${name}:${index}`);
        rejected++;
        zodCases[name].rejected.push({case:`branch-${index}-missing-${required[0]}`,input:missing});
      }
      if (branches[index].additionalProperties===false) {
        if (validator.safeParse({...valid,__unexpected:1}).success)
          throw new Error(`PINNED_ZOD_STRICT_WEAKENED:${name}:${index}`);
        rejected++;
        zodCases[name].rejected.push({case:`branch-${index}-unexpected-field`,input:{...valid,__unexpected:1}});
      }
      const discriminator=branches[index].properties?.action??branches[index].properties?.phase??
        branches[index].properties?.operation;
      if (discriminator) {
        const key=branches[index].properties?.action?'action':branches[index].properties?.phase?'phase':'operation';
        if (validator.safeParse({...valid,[key]:'__INVALID__'}).success)
          throw new Error(`PINNED_ZOD_ENUM_WEAKENED:${name}:${index}`);
        rejected++;
        zodCases[name].rejected.push({case:`branch-${index}-invalid-discriminator`,input:{...valid,[key]:'__INVALID__'}});
      }
    }
  }
  branchEvidence[name]={branches:branches.length,accepted,rejected};
}
function rejectMutation(name,label,input) {
  if (realValidators[name].safeParse(input).success) throw new Error(`PINNED_ZOD_LIMIT_WEAKENED:${name}:${label}`);
  branchEvidence[name].rejected++;
  const encoded=JSON.stringify(input);
  zodCases[name].rejected.push(encoded.length>10000
    ? {case:label,inputSha256:sha256(encoded),inputJsonLength:encoded.length,
      generation:'Regenerate with export-host-contract.mjs from pinned source.'}
    : {case:label,input});
}
for (const name of dependencyResolvedTools) {
  const root=tools[name].inputSchema, branch=(root.oneOf??root.anyOf??[root])[0], valid=sample(branch);
  const props=branch.properties??{};
  const numeric=Object.entries(props).find(([,schema])=>schema.type==='integer'&&schema.minimum!==undefined);
  if (numeric) rejectMutation(name,`numeric-min-${numeric[0]}`,{...valid,[numeric[0]]:numeric[1].minimum-1});
  const bounded=Object.entries(props).find(([,schema])=>schema.type==='string'&&schema.maxLength!==undefined);
  if (bounded) rejectMutation(name,`string-max-${bounded[0]}`,
    {...valid,[bounded[0]]:'A'.repeat(bounded[1].maxLength+1)});
}
{
  const name='commit_translation_candidate', root=tools[name].inputSchema;
  const upload=sample(root.anyOf.find(branch=>branch.properties?.phase?.const==='UPLOAD_PART'));
  rejectMutation(name,'part-index-max',{...upload,partIndex:64});
  rejectMutation(name,'part-count-max',{...upload,partCount:65});
  rejectMutation(name,'payload-max',{...upload,payloadBase64:'A'.repeat(8193)});
}
{
  const name='translation_workspace', root=tools[name].inputSchema;
  const save=sample(root.oneOf.find(branch=>branch.properties?.phase?.const==='SAVE'));
  rejectMutation(name,'translated-text-refinement',{...save,candidates:[{...save.candidates[0],
    elements:[{...save.candidates[0].elements[0],translatedText:'   '}]}]});
  const checkBatch=sample(root.oneOf.find(branch=>branch.properties?.phase?.const==='CHECK_BATCH'));
  rejectMutation(name,'semantic-reviews-min',{...checkBatch,semanticReviews:[checkBatch.semanticReviews[0]]});
}
{
  const name='document_work', root=tools[name].inputSchema;
  const begin=sample(root.oneOf.find(branch=>branch.properties?.action?.const==='ACTIVITY_BEGIN'));
  rejectMutation(name,'section-ids-max',{...begin,sectionIds:Array.from({length:101},(_,i)=>`S${i}`)});
  rejectMutation(name,'semantic-revision-positive',{...begin,semanticRevision:0});
}
{
  const name='document_reading', root=tools[name].inputSchema;
  const read=sample(root.oneOf.find(branch=>branch.properties?.action?.const==='READING_READ'));
  rejectMutation(name,'read-limit-max',{...read,limit:51});
  rejectMutation(name,'delivery-ref-pattern',{...read,deliveryRef:'wrong-ref'});
}
{
  const name='document_translation', root=tools[name].inputSchema;
  const work=sample(root.oneOf.find(branch=>branch.properties?.action?.const==='WORKSPACE'));
  rejectMutation(name,'nested-workspace-phase',{...work,workspaceCommand:{...work.workspaceCommand,phase:'INVALID'}});
}
{
  const name='derived_summary_attempt', root=tools[name].inputSchema;
  const save=sample(root.oneOf.find(branch=>branch.properties?.operation?.const==='SAVE_SUMMARY'));
  rejectMutation(name,'content-max',{...save,contentJson:'A'.repeat(1_000_001)});
}
for (const name of ['read_assessment_sources','derived_summary_attempt']) {
  const schema=tools[name].inputSchema;
  const branch=name==='derived_summary_attempt'
    ? schema.oneOf.find(item=>item.properties?.operation?.const==='READ_SOURCES') : schema;
  const valid=sample(branch);
  const native='TDMS_APPROVED_OPINION:A:B:C:D:E:0';
  const nativeInput=name==='derived_summary_attempt'?{...valid,evidenceRefs:[native]}:{...valid,sourceRefs:[native]};
  if (!realValidators[name].safeParse(nativeInput).success) throw new Error(`TDMS_NATIVE_POSITIVE_FAILED:${name}`);
  zodCases[name].accepted.push({case:'valid-native-reference',input:nativeInput});
  for (const bad of ['TDMS_APPROVED_OPINION:%41:B:C:D:E:0',
    'TDMS_APPROVED_OPINION:A:B:C:D:E:9007199254740992',
    `TDMS_APPROVED_OPINION:${'A'.repeat(256)}:B:C:D:E:0`]) {
    const invalid=name==='derived_summary_attempt'?{...valid,evidenceRefs:[bad]}:{...valid,sourceRefs:[bad]};
    if (realValidators[name].safeParse(invalid).success) throw new Error(`TDMS_NATIVE_REFINEMENT_WEAKENED:${name}`);
    zodCases[name].rejected.push({case:'invalid-native-reference',input:invalid});
  }
  branchEvidence[name].accepted++;
  branchEvidence[name].rejected+=3;
}
const excludedToolSchemas = {};
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
  evidence:{hostCommit:'fc1322919b1b52433c33086c8db4aeb957f0e982',hostSource:{path:'server/modules/canonical-host/canonical-host-openclaw-mcp.service.ts',gitBlobSha:blobSha(service),sha256:sha256(service)},readonlySource:{path:'server/modules/canonical-host/canonical-host-readonly-mcp-tools.ts',gitBlobSha:blobSha(readonly),sha256:sha256(readonly)},controllerSource:{path:'server/modules/canonical-host/canonical-host-openclaw-mcp.openapi.controller.ts',gitBlobSha:blobSha(controller),sha256:sha256(controller)},apiSource:{path:'shared/api.interface.ts',gitBlobSha:blobSha(apiSource),sha256:sha256(apiSource)},derivedSource:{path:'server/modules/canonical-host/derived-summary-attempt-mcp-tools.ts',gitBlobSha:blobSha(derived),sha256:sha256(derived)},matterSource:{path:'server/modules/canonical-host/matter-attempt-mcp-tools.ts',gitBlobSha:blobSha(matter),sha256:sha256(matter)},dependencySources:Object.fromEntries(dependencyPaths.map(path=>[path,{gitBlobSha:blobSha(dependencySources[path]),sha256:sha256(dependencySources[path])}])),zodVersion:'4.6.5',zodLockIntegrity:'sha512-v5l/aFXZQeai4awLbOpSoHecE9UiMrnfx75tEXLjNonXVARxQ5mOeipTjROUchszUNCqnE+hqAMujRsRHsut2Q==',offlineZodValidation:branchEvidence,liveToolsListVerified:false,proposedCodexHostBranchVerified:false},
  client:{sourcePath:'openclaw/skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs',sourceSha256:sha256(clientSource),legacyServerName:WISELINK_HOST_MCP_NAME,expectedServerVersion:WISELINK_HOST_MCP_VERSION,expectedCodexServerName:codexIdentity,expectedCodexMcpPath:codexPath,expectedCodexQueueRestPaths:codexQueueRestPaths,expectedRuntimeAppEnvironment:'WL_CODEX_RUNTIME_APP_ID',expectedRuntimeAppId:WL_CODEX_RUNTIME_APP_ID,wireProvenanceVersionKey:WISELINK_HOST_MCP_NAME,legacyMcpPath:'/openapi/wiselink/openclaw-mcp',requiredLegacyToolNames:HOST_MCP_TOOLS},
  serverSource:{serverName:serverIdentity[1],serverVersion:serverIdentity[2],mcpPath:`/${controllerRoot}/${mcpPost}`,identityStatus:'PINNED_LEGACY_SOURCE_ONLY',queueRestPaths:['next-work-item','ack-work-item','block-work-item'].map(route=>{if(!controller.includes(`@Post('${route}')`)) throw new Error(`QUEUE_ROUTE_NOT_FOUND:${route}`);return `/${controllerRoot}/${route}`}),queueTypeScriptDeclarations:queueTypes+blockResponse,tools,excludedToolSchemas,otherUnexportedClientToolNames:HOST_MCP_TOOLS.filter(name=>!(name in tools)&&!(name in excludedToolSchemas))},
  limitations:['Seven dependency-resolved input schemas were exported by executing pinned Zod 4.6.5; the other 35 remain constrained mechanical input shapes. Neither is a live MCP tools/list response.','Zod trim transformation and runtime authorization are outside standard JSON Schema validation; see each schema semanticLimitations and exact zodExpression.','The TDMS native-reference branch and translated-text fields require runtime refinements beyond standard JSON Schema; the pinned Zod offline cases execute them.','The selected inventory is not a complete Host tool export; all omitted legacy client tool names are inventoried.','Server response JSON shapes are described by client validators and examples, not inferred from input schemas.','Comparison with the latest local Host interface packet remains pending until its exact versioned artifact is available.'],
};
await writeFile(outputFile,JSON.stringify(output,null,2)+'\n');
await writeFile(new URL('./contracts/host-zod-validation-cases.json',import.meta.url),
  JSON.stringify({sourceHostCommit:output.evidence.hostCommit,zodVersion:output.evidence.zodVersion,
    scope:'Synthetic offline input validator cases only; no Host call or business-valid work is claimed.',
    schemaEvidence:Object.fromEntries(dependencyResolvedTools.map(name=>[name,{
      inputSchemaSha256:canonicalSha256(tools[name].inputSchema),
      validationCasesSha256:canonicalSha256(zodCases[name]),
    }])),
    tools:zodCases},null,2)+'\n');
