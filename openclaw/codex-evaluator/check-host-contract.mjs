#!/usr/bin/env node
/** Pinned artifact integrity by default; explicit current mode reads the unique SDK package. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HOST_MCP_TOOLS } from '../skills/wiselink-research-and-synthesize/scripts/orchestrate-host-mcp.mjs';
import { canonicalSha256 } from '../skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';

const base = new URL('./contracts/',import.meta.url);
const repository = new URL('../../', import.meta.url);
export const CURRENT_INTERFACE_PATH = 'docs/coordination/host-codex-interface-20261025/';
export const PINNED_CLIENT_COMMIT = '925deb2d148a9eb8ed508300d7132fce55bc665c';
const currentBase = new URL(CURRENT_INTERFACE_PATH, repository);
const require = createRequire(import.meta.url);
const fail = message => { throw new Error(`HOST_CONTRACT_CHECK:${message}`); };
const expect = (condition,message) => { if (!condition) fail(message); };

export async function checkPinnedContract({contractPath,zodCasesPath} = {}) {
const contract = JSON.parse(await readFile(contractPath ?? new URL('host-source-interface.json',base),'utf8'));
const examples = JSON.parse(await readFile(new URL('host-input-examples.json',base),'utf8'));
const zodCases = JSON.parse(await readFile(zodCasesPath ?? new URL('host-zod-validation-cases.json',base),'utf8'));
const tdmsSource = await readFile(new URL('./host-contract/source/shared/tdms-approved-opinion-reference.ts',import.meta.url),'utf8');
const blobSha = source => createHash('sha1').update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest('hex');
expect(blobSha(tdmsSource)===contract.evidence.dependencySources['shared/tdms-approved-opinion-reference.ts'].gitBlobSha,'tdms-source-stale');
const predicateSource = tdmsSource.slice(tdmsSource.indexOf('export function isTdmsApprovedOpinionReference'))
  .replace(/export function isTdmsApprovedOpinionReference\(\s*value: unknown,\s*\): value is string \{/u,
    'function isTdmsApprovedOpinionReference(value) {')
  .replace('components[5]!','components[5]');
const isTdmsApprovedOpinionReference = runInNewContext(
  `const TDMS_APPROVED_OPINION_REFERENCE_PREFIX='TDMS_APPROVED_OPINION:'; const TDMS_APPROVED_OPINION_REFERENCE_MAX_LENGTH=TDMS_APPROVED_OPINION_REFERENCE_PREFIX.length + 5 * 255 * 9 + 5 + 16; ${predicateSource}\nisTdmsApprovedOpinionReference;`,{}, {timeout:1000});
for (const [path,evidence] of Object.entries(contract.evidence.dependencySources)) {
  const source=await readFile(new URL(`./host-contract/source/${path}`,import.meta.url),'utf8');
  expect(blobSha(source)===evidence.gitBlobSha,`dependency-blob-stale:${path}`);
  expect(createHash('sha256').update(source).digest('hex')===evidence.sha256,`dependency-sha-stale:${path}`);
}
const refinements = {isTdmsApprovedOpinionReference,trimmedNonempty:value=>typeof value==='string'&&value.trim().length>0};
const types = {object:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),array:Array.isArray,
  string:x=>typeof x==='string',integer:Number.isInteger,number:x=>typeof x==='number',
  boolean:x=>typeof x==='boolean',null:x=>x===null};
function check(schema,value,path) {
  if ('const' in schema) expect(value===schema.const,`${path}:const`);
  if (schema.anyOf) { expect(schema.anyOf.some(option=>{try{check(option,value,path);return true;}catch{return false;}}),`${path}:anyOf`);return; }
  if (schema.oneOf) { expect(schema.oneOf.filter(option=>{try{check(option,value,path);return true;}catch{return false;}}).length===1,`${path}:oneOf`);return; }
  if (schema.type) expect(types[schema.type]?.(value),`${path}:type:${schema.type}`);
  if (schema.enum) expect(schema.enum.includes(value),`${path}:enum`);
  if (schema.type==='string') {
    const parsed = schema['x-zodTrim'] ? value.trim() : value;
    if(schema.minLength!==undefined) expect(parsed.length>=schema.minLength,`${path}:minLength`);
    if(schema.maxLength!==undefined) expect(parsed.length<=schema.maxLength,`${path}:maxLength`);
    if(schema.pattern) expect(new RegExp(schema.pattern,'u').test(parsed),`${path}:pattern`);
    if(schema.format==='uuid') expect(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(parsed),`${path}:uuid`);
    if(schema.format==='date-time') expect(!Number.isNaN(Date.parse(parsed)) && /T.*(?:Z|[+-]\d\d:\d\d)$/u.test(parsed),`${path}:date-time`);
    if(schema.format==='uri') expect(URL.canParse(parsed),`${path}:uri`);
    if(schema['x-runtimeRefinement']) expect(refinements[schema['x-runtimeRefinement']]?.(parsed),`${path}:runtime-refinement`);
  }
  if(schema.type==='integer'||schema.type==='number') {
    if(schema.minimum!==undefined) expect(value>=schema.minimum,`${path}:minimum`);
    if(schema.maximum!==undefined) expect(value<=schema.maximum,`${path}:maximum`);
  }
  if(schema.type==='array') {
    if(schema.minItems!==undefined) expect(value.length>=schema.minItems,`${path}:minItems`);
    if(schema.maxItems!==undefined) expect(value.length<=schema.maxItems,`${path}:maxItems`);
    value.forEach((item,i)=>check(schema.items,item,`${path}[${i}]`));
  }
  if(schema.type==='object') {
    for(const name of schema.required??[]) expect(Object.hasOwn(value,name),`${path}:required:${name}`);
    for(const [name,item] of Object.entries(value)) {
      if(schema.properties?.[name]) check(schema.properties[name],item,`${path}.${name}`);
      else if(schema.additionalProperties===false) fail(`${path}:additional:${name}`);
      else if(typeof schema.additionalProperties==='object') check(schema.additionalProperties,item,`${path}.${name}`);
    }
  }
}
expect(contract.schemaVersion==='wiselink.codex-host-source-contract.v1','version');
expect(contract.evidence.hostCommit==='fc1322919b1b52433c33086c8db4aeb957f0e982','host-commit');
expect(contract.evidence.liveToolsListVerified===false&&contract.evidence.proposedCodexHostBranchVerified===false,'unverified-flags');
expect(contract.evidence.zodVersion==='4.6.5','pinned-zod-version');
expect(contract.client.expectedCodexServerName!==contract.serverSource.serverName,'identity-gap');
expect(contract.client.expectedCodexMcpPath!==contract.serverSource.mcpPath,'path-gap');
expect(JSON.stringify(HOST_MCP_TOOLS)===JSON.stringify(contract.client.requiredLegacyToolNames),'client-tool-inventory');
const clientSource = execFileSync('git',['show',`${PINNED_CLIENT_COMMIT}:${contract.client.sourcePath}`], {cwd:fileURLToPath(repository),encoding:'utf8',maxBuffer:10*1024*1024});
expect(createHash('sha256').update(clientSource).digest('hex')===contract.client.sourceSha256,'client-source-stale');
for(const [name,args] of Object.entries(examples.convertedSchemaExamples)) {
  const item=contract.serverSource.tools[name];
  expect(item?.schemaStatus==='MECHANICAL_ZOD_INPUT_SHAPE'&&item.inputSchema&&item.zodExpression&&
    Array.isArray(item.semanticLimitations),`converted-schema:${name}`);
  check(item.inputSchema,args,name);
}
expect(Object.entries(contract.serverSource.tools).filter(([,item])=>item.schemaStatus==='MECHANICAL_ZOD_INPUT_SHAPE').length===
  Object.keys(examples.convertedSchemaExamples).length,'converted-example-coverage');
for(const [name,args] of Object.entries(examples.sourceExpressionOnlyExamples)) {
  const item=contract.serverSource.tools[name];
  expect(item?.schemaStatus==='PINNED_ZOD_V4_INPUT_SCHEMA'&&item.zodExpression&&item.inputSchema,
    `pinned-zod-schema:${name}`);
  check(item.inputSchema,args,name);
}
const pinned=['read_assessment_sources','commit_translation_candidate','translation_workspace',
  'document_work','document_reading','document_translation','derived_summary_attempt'];
expect(Object.keys(contract.serverSource.excludedToolSchemas).length===0,'excluded-dependencies-closed');
for(const name of pinned) {
  const item=contract.serverSource.tools[name], test=contract.evidence.offlineZodValidation[name];
  expect(item?.schemaStatus==='PINNED_ZOD_V4_INPUT_SCHEMA'&&item.inputSchema&&
    item.validatorEngine==='zod/v4@4.6.5',`pinned-zod:${name}`);
  expect(zodCases.schemaEvidence?.[name]?.inputSchemaSha256===canonicalSha256(item.inputSchema),
    `pinned-zod-schema-evidence-mismatch:${name}`);
  expect(zodCases.schemaEvidence?.[name]?.validationCasesSha256===canonicalSha256(zodCases.tools[name]),
    `pinned-zod-cases-evidence-mismatch:${name}`);
  expect(test?.branches>0&&test.accepted>=test.branches&&test.rejected>=test.branches,
    `pinned-zod-examples:${name}`);
  expect(zodCases.sourceHostCommit===contract.evidence.hostCommit&&
    zodCases.zodVersion===contract.evidence.zodVersion&&
    zodCases.tools[name]?.accepted.length===test.accepted&&
    zodCases.tools[name]?.rejected.length===test.rejected,`pinned-zod-case-count:${name}`);
}
expect(contract.serverSource.otherUnexportedClientToolNames.every(name=>HOST_MCP_TOOLS.includes(name)),'other-tool-inventory');
expect(!JSON.stringify(examples).match(/Bearer\s|Authorization\s*:/iu),'example-credential-string');
return {status:'OFFLINE_CONTRACT_CHECKED',clientSourceEvidence:{kind:'PINNED_GIT_OBJECT',commit:PINNED_CLIENT_COMMIT,workingClientSourceVerified:false},convertedSchemas:Object.values(contract.serverSource.tools).filter(x=>x.schemaStatus==='MECHANICAL_ZOD_INPUT_SHAPE').length,pinnedZodSchemas:pinned.length,convertedExamples:Object.keys(examples.convertedSchemaExamples).length,pinnedZodValidation:contract.evidence.offlineZodValidation,sourceOnlySchemas:Object.values(contract.serverSource.tools).filter(x=>x.schemaStatus==='SOURCE_EXPRESSION_ONLY').length,excludedSourceExpressions:Object.keys(contract.serverSource.excludedToolSchemas).length,liveVerified:false};
}

export function checkCurrentInterfaceSnapshot({contract, examples, tools, initialize, paths, index, toolFiles}) {
  expect(contract.schemaVersion === 'wiselink.codex-host-source-contract.v1', 'current:pinned-artifact-version');
  expect(contract.serverSource.identityStatus === 'PINNED_LEGACY_SOURCE_ONLY', 'current:pinned-source-boundary');
  expect(initialize.result?.serverInfo?.name === contract.client.expectedCodexServerName &&
    initialize.result.serverInfo.version === contract.client.expectedServerVersion, 'current:codex-identity');
  const requiredPaths = ['codex-mcp', 'codex-next-work-item', 'codex-ack-work-item',
    'codex-block-work-item', 'codex-apply-pending-model-configuration'];
  for (const name of requiredPaths) expect(paths[`/openapi/wiselink/${name}`]?.post,
    `current:codex-route:${name}`);
  expect(contract.client.expectedCodexMcpPath === '/openapi/wiselink/codex-mcp', 'current:codex-expected-route');
  expect(Array.isArray(tools.tools) && tools.tools.length === 45 &&
    new Set(tools.tools.map(tool => tool.name)).size === tools.tools.length, 'current:complete-sdk-inventory');
  const records = {...contract.serverSource.tools, ...contract.serverSource.excludedToolSchemas};
  expect(Object.keys(records).length === 42, 'current:pinned-name-count');
  const current = new Map(tools.tools.map(tool => [tool.name, tool]));
  const names = Object.keys(records);
  const Ajv2020 = require('ajv/dist/2020').default;
  const ajv = new Ajv2020({strict:false, allErrors:true, validateFormats:false});
  const validators = new Map(), formats = new Set();
  const collectFormats = schema => {
    if (!schema || typeof schema !== 'object') return;
    if (typeof schema.format === 'string') formats.add(schema.format);
    Object.values(schema).forEach(item => {
      if (Array.isArray(item)) item.forEach(collectFormats); else collectFormats(item);
    });
  };
  for (const name of names) {
    const tool = current.get(name), entry = index.tools.find(item => item.name === name);
    expect(tool?.inputSchema && toolFiles[name]?.inputSchema, `current:complete-schema:${name}`);
    expect(entry?.metadataFile === `tools/${name}.json` && entry.toolVersion === null,
      `current:unique-sdk-reference:${name}`);
    expect(JSON.stringify(toolFiles[name]) === JSON.stringify(tool), `current:tool-source-drift:${name}`);
    collectFormats(tool.inputSchema);
    validators.set(name, ajv.compile(tool.inputSchema));
  }
  let converted = 0, sourceOnly = 0;
  const validateExamples = (items, kind) => {
    for (const [name, args] of Object.entries(items)) {
      const validate = validators.get(name);
      expect(validate && validate(args), `current:${kind}-example:${name}:${JSON.stringify(validate?.errors)}`);
      if (kind === 'converted') converted += 1; else sourceOnly += 1;
    }
  };
  validateExamples(examples.convertedSchemaExamples, 'converted');
  validateExamples(examples.sourceExpressionOnlyExamples, 'source-only');
  const covered = new Set([...Object.keys(examples.convertedSchemaExamples),
    ...Object.keys(examples.sourceExpressionOnlyExamples)]);
  return {status:'CURRENT_INTERFACE_CHECKED', currentInterfaceSource:CURRENT_INTERFACE_PATH,
    currentTools:current.size, clientNames:names.length, completeCurrentSchemas:validators.size,
    convertedExamples:converted, sourceOnlyExamples:sourceOnly,
    sourceOnlyClientNamesResolved:names.filter(name => records[name].schemaStatus === 'PINNED_ZOD_V4_INPUT_SCHEMA' || !records[name].inputSchema),
    pinnedZodClientSchemas:names.filter(name => records[name].schemaStatus === 'PINNED_ZOD_V4_INPUT_SCHEMA').length,
    remainingSourceOnlyClientNames:names.filter(name => !records[name].inputSchema),
    additionalCurrentTools:[...current.keys()].filter(name => !Object.hasOwn(records,name)),
    clientNamesWithoutPositiveInputExample:names.filter(name => !covered.has(name)),
    formatsValidated:false, formatKeywordsObserved:[...formats].sort(),
    limitations:['JSONSchema validates published input shape, not Zod trim/default/refinement or Host authorization.',
      'Format plugins are not used; published pattern keywords are validated, format-only semantics are not claimed.',
      'Pinned legacy artifact remains unchanged; complete current schemas are read from the unique SDK package.',
      'No network, credential, model, queue claim or business tool is invoked.'], liveVerified:false};
}

export function checkCurrentZodEvidence(report,cases,caseFileSha256) {
  expect(report.pinnedCaseFileSha256 === caseFileSha256, 'current:zod-case-file-stale');
  expect(report.pinnedSourceHostCommit === cases.sourceHostCommit && report.pinnedZodVersion === cases.zodVersion,
    'current:zod-case-source');
  expect(Array.isArray(report.tools) && report.tools.length === 7, 'current:zod-schema-count');
  let accepted=0,rejected=0;
  for (const [name,groups] of Object.entries(cases.tools)) {
    const actual = report.tools.find(tool => tool.name === name);
    expect(actual?.currentMetadataFile === `tools/${name}.json`, `current:zod-schema-reference:${name}`);
    expect(actual.cases.length === groups.accepted.length + groups.rejected.length,
      `current:zod-case-count:${name}`);
    expect(actual.pinnedAccepted === groups.accepted.length && actual.pinnedRejected === groups.rejected.length &&
      actual.currentAccepted === groups.accepted.length && actual.currentRejected === groups.rejected.length,
      `current:zod-tool-count-evidence:${name}`);
    const identities = new Set();
    for (const item of actual.cases) {
      const expected = groups[item.pinnedGroup]?.[item.pinnedCaseIndex];
      const identity = `${item.pinnedGroup}:${item.pinnedCaseIndex}`;
      expect(expected && expected.case === item.case && !identities.has(identity),
        `current:zod-case-identity:${name}`);
      identities.add(identity);
      const shouldAccept = item.pinnedGroup === 'accepted';
      expect(item.pinnedExpectedAccepted === shouldAccept && item.currentAccepted === shouldAccept &&
        item.expectationMatched === true, `current:zod-acceptance-difference:${name}:${item.case}`);
      if (item.currentAccepted) accepted++; else rejected++;
    }
    expect(actual.expectationMismatches.length === 0, `current:zod-negative-evidence:${name}`);
  }
  expect(report.accepted === accepted && report.rejected === rejected && report.expectationMismatches === 0,
    'current:zod-total-evidence');
  return {schemas:report.tools.length,accepted,rejected,expectationMismatches:0,
    method:'actual production Zod safeParse cases, separate from JSONSchema format coverage',
    runtimeAuthorizationVerified:false};
}

export async function checkCurrentInterface() {
  const pinnedEvidence = await checkPinnedContract();
  const readJson = async (name, parent) => JSON.parse(await readFile(new URL(name,parent),'utf8'));
  const contract = await readJson('host-source-interface.json',base);
  const examples = await readJson('host-input-examples.json',base);
  const tools = await readJson('mcp/codex.tools-list.json',currentBase);
  const initialize = await readJson('mcp/codex.initialize.response.json',currentBase);
  const {paths} = await readJson('rest/openapi.paths.json',currentBase);
  const index = await readJson('mcp/tool-index.json',currentBase);
  const manifest = await readJson('source-manifest.json',currentBase);
  const zodReport = await readJson('mcp/pinned-zod-cases-on-current-host.json',currentBase);
  const zodCaseText = await readFile(new URL('host-zod-validation-cases.json',base),'utf8');
  const currentZodCases = checkCurrentZodEvidence(zodReport,JSON.parse(zodCaseText),
    createHash('sha256').update(zodCaseText).digest('hex'));
  const toolFiles = {};
  for (const name of Object.keys({...contract.serverSource.tools,...contract.serverSource.excludedToolSchemas}))
    toolFiles[name] = await readJson(`mcp/tools/${name}.json`,currentBase);
  for (const source of manifest.files) expect(createHash('sha256')
    .update(await readFile(new URL(source.path,repository))).digest('hex') === source.sha256,
    `current:source-stale:${source.path}`);
  execFileSync('git',['merge-base','--is-ancestor',manifest.sourceHead,'HEAD'],
    {cwd:fileURLToPath(repository)});
  return {...checkCurrentInterfaceSnapshot({contract,examples,tools,initialize,paths,index,toolFiles}),
    pinnedArtifactEvidence:pinnedEvidence.clientSourceEvidence,currentZodCases};
}


if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const current = args.includes('--current-interface');
  expect(current ? args.length === 1 : args.length <= 2 && args.every(value => !value.startsWith('--')), 'unknown-mode');
  const result = current ? await checkCurrentInterface()
    : await checkPinnedContract({contractPath:args[0],zodCasesPath:args[1]});
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
