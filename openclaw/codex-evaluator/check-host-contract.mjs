#!/usr/bin/env node
/** Offline check for the committed pinned-source interface artifact. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { HOST_MCP_TOOLS } from '../skills/wiselink-research-and-synthesize/scripts/orchestrate-host-mcp.mjs';

const base = new URL('./contracts/',import.meta.url);
const contract = JSON.parse(await readFile(new URL('host-source-interface.json',base),'utf8'));
const examples = JSON.parse(await readFile(new URL('host-input-examples.json',base),'utf8'));
const fail = message => { throw new Error(`HOST_CONTRACT_CHECK:${message}`); };
const expect = (condition,message) => { if (!condition) fail(message); };
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
    if(schema.minLength!==undefined) expect(value.length>=schema.minLength,`${path}:minLength`);
    if(schema.maxLength!==undefined) expect(value.length<=schema.maxLength,`${path}:maxLength`);
    if(schema.pattern) expect(new RegExp(schema.pattern,'u').test(value),`${path}:pattern`);
    if(schema.format==='uuid') expect(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value),`${path}:uuid`);
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
expect(contract.client.expectedCodexServerName!==contract.serverSource.serverName,'identity-gap');
expect(contract.client.expectedCodexMcpPath!==contract.serverSource.mcpPath,'path-gap');
expect(JSON.stringify(HOST_MCP_TOOLS)===JSON.stringify(contract.client.requiredLegacyToolNames),'client-tool-inventory');
const clientSource = await readFile(new URL('../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs',import.meta.url),'utf8');
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
  expect(item?.schemaStatus==='SOURCE_EXPRESSION_ONLY'&&item.zodExpression&&!item.inputSchema&&
    Array.isArray(item.unresolvedDependencies)&&item.unresolvedDependencies.length>0,`source-expression-only:${name}`);
  expect(types.object(args),`source-example:${name}`);
}
for(const [name,item] of Object.entries(contract.serverSource.excludedToolSchemas))
  expect(item.schemaStatus==='SOURCE_EXPRESSION_ONLY'&&item.zodExpression&&!item.inputSchema&&
    Array.isArray(item.unresolvedDependencies)&&item.unresolvedDependencies.length>0,`excluded:${name}`);
expect(contract.serverSource.otherUnexportedClientToolNames.every(name=>HOST_MCP_TOOLS.includes(name)),'other-tool-inventory');
expect(!JSON.stringify(examples).match(/Bearer\s|Authorization\s*:/iu),'example-credential-string');
process.stdout.write(JSON.stringify({status:'OFFLINE_CONTRACT_CHECKED',convertedSchemas:Object.values(contract.serverSource.tools).filter(x=>x.schemaStatus==='MECHANICAL_ZOD_INPUT_SHAPE').length,convertedExamples:Object.keys(examples.convertedSchemaExamples).length,sourceOnlySchemas:Object.values(contract.serverSource.tools).filter(x=>x.schemaStatus==='SOURCE_EXPRESSION_ONLY').length,excludedSourceExpressions:Object.keys(contract.serverSource.excludedToolSchemas).length,liveVerified:false})+'\n');
