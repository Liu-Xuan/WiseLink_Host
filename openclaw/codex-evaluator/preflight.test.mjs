import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectConfiguration } from './preflight.mjs';
import { HOST_MCP_TOOLS } from '../skills/wiselink-research-and-synthesize/scripts/orchestrate-host-mcp.mjs';

const sentinel = 'SYNTHETIC_SECRET_MUST_NOT_APPEAR';
const model = {models:{providers:{miaoda:{
  baseUrl:'https://innerapi.aiforce.cloud/innerapi/api/v1/sgw/model/proxy',
  api:'openai-completions',apiKey:{source:'file',path:'/private/model-key',value:sentinel},
  headers:{'x-api-key':{source:'file',path:'/private/header-key',value:sentinel}},
}}}};
async function inspect(t,servers,env={WL_CODEX_RUNTIME_APP_ID:'app_17gr74pbere'}) {
  const dir=await mkdtemp(join(tmpdir(),'codex-preflight-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,'openclaw.json');
  await writeFile(file,JSON.stringify({...model,mcp:{servers}}));
  return inspectConfiguration(file,process.execPath,env);
}
const codex = url => ({url,headers:{authorization:`Bearer ${sentinel}`},
  toolFilter:{include:[...HOST_MCP_TOOLS,'record_assessment_program_progress']}});

test('old Host key is reported as legacy only and cannot make Codex ready',async t=>{
  const result=await inspect(t,{wiselink_host_controller:{url:'https://host.example/openapi/wiselink/openclaw-mcp',
    headers:{authorization:`Bearer ${sentinel}`}}});
  assert.equal(result.legacyHostMcpConfigPresent,true);
  assert.equal(result.codexHostMcpConfigPresent,false);
  assert.equal(result.codexHostMcpConfigured,false);
  assert.equal(result.hostMcpConfigured,false);
  assert.equal(result.codexHostMcpEndpointValid,false);
  assert.equal(result.readyForModelFixture,true);
  assert.equal(result.readyForBusinessExecution,false);
  assert.equal(result.missingHostTools,null);
  assert.ok(result.remaining.includes('CODEX_HOST_MCP_NOT_CONFIGURED'));
  assert.doesNotMatch(JSON.stringify(result),new RegExp(sentinel));
});

test('named Codex config with legacy or unsafe endpoint stays locally invalid',async t=>{
  for(const url of ['https://host.example/openapi/wiselink/openclaw-mcp',
    'http://host.example/openapi/wiselink/codex-mcp',
    'https://user:pass@host.example/openapi/wiselink/codex-mcp',
    'https://host.example/openapi/wiselink/codex-mcp?token=bad',
    'https://host.example/openapi/wiselink/codex-mcp#fragment']) {
    const result=await inspect(t,{'wiselink-codex-engineering-assessment':codex(url)});
    assert.equal(result.codexHostMcpConfigPresent,true);
    assert.equal(result.codexHostMcpEndpointValid,false,url);
    assert.equal(result.hostAuthenticationVerified,false);
    assert.equal(result.readyForBusinessExecution,false);
    assert.ok(result.remaining.includes('CODEX_HOST_MCP_ENDPOINT_INVALID'));
    assert.doesNotMatch(JSON.stringify(result),/user:pass|token=bad|Bearer|SYNTHETIC_SECRET/iu);
  }
});

test('valid Codex config inventories full client tool list and never reveals headers or secret paths',async t=>{
  const result=await inspect(t,{'wiselink-codex-engineering-assessment':
    codex('https://host.example/openapi/wiselink/codex-mcp')});
  assert.equal(result.codexHostMcpConfigPresent,true);
  assert.equal(result.codexHostMcpEndpointValid,true);
  assert.equal(result.codexRuntimeAppIdConfigured,true);
  assert.equal(result.expectedHostMcpServerName,'wiselink-codex-engineering-assessment');
  assert.equal(result.expectedHostMcpServerVersion,'1.2.0');
  assert.equal(result.requiredHostToolScope,'CLIENT_EXACT_METADATA_PLUS_PROGRAM_PROGRESS');
  assert.equal(result.requiredHostToolCount,HOST_MCP_TOOLS.length+1);
  assert.deepEqual(result.missingHostTools,[]);
  assert.equal(result.hostAuthenticationVerified,false);
  assert.equal(result.hostRuntimeRegistrationVerified,false);
  assert.equal(result.readyForBusinessExecution,false);
  const printed=JSON.stringify(result);
  assert.doesNotMatch(printed,/SYNTHETIC_SECRET|Bearer|\/private\/|authorization|host\.example/iu);
});

test('Codex app selection requires the exact configured runtime app',async t=>{
  const servers={'wiselink-codex-engineering-assessment':
    codex('https://host.example/openapi/wiselink/codex-mcp')};
  for (const env of [{}, {WL_CODEX_RUNTIME_APP_ID:'app_17c3zn24kv2'}]) {
    const result=await inspect(t,servers,env);
    assert.equal(result.codexRuntimeAppIdConfigured,false);
    assert.ok(result.remaining.includes('CODEX_RUNTIME_APP_ID_CONFIG_INVALID'));
  }
});

test('incomplete named Codex tool filter reports the missing full metadata surface',async t=>{
  const host=codex('https://host.example/openapi/wiselink/codex-mcp');
  host.toolFilter.include=['begin_dynamic_evaluation'];
  const result=await inspect(t,{'wiselink-codex-engineering-assessment':host});
  assert.ok(result.missingHostTools.includes('save_assessment_work'));
  assert.ok(result.missingHostTools.includes('record_assessment_program_progress'));
  assert.ok(result.remaining.includes('HOST_TOOL_BINDING_INCOMPLETE'));
});
