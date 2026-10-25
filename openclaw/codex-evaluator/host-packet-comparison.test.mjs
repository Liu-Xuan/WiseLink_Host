import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// These are tests of the comparison utility, not observations of a local Host.
const script = fileURLToPath(new URL('./compare-host-interface-packet.mjs',import.meta.url));
const contract = JSON.parse(await readFile(new URL('./contracts/host-source-interface.json',import.meta.url),'utf8'));
const packet = () => ({hostCommit:contract.evidence.hostCommit,tools:Object.entries(contract.serverSource.tools)
  .map(([name,value])=>({name,inputSchema:structuredClone(value.inputSchema)}))});
async function compare(input, syntheticSourceContract = null) {
  const dir=await mkdtemp(join(tmpdir(),'wiselink-packet-comparison-'));
  try {
    const source=join(dir,'synthetic-packet.json'), result=join(dir,'report.json');
    await writeFile(source,JSON.stringify(input));
    let executable=script;
    if (syntheticSourceContract) {
      const {mkdir,copyFile}=await import('node:fs/promises');
      await mkdir(join(dir,'contracts'));
      executable=join(dir,'compare-host-interface-packet.mjs');
      await copyFile(script,executable);
      await writeFile(join(dir,'contracts','host-source-interface.json'),JSON.stringify(syntheticSourceContract));
    }
    const child=spawnSync(process.execPath,[executable,source,result],{encoding:'utf8'});
    return {code:child.status,stderr:child.stderr,
      report:child.status===0||child.status===2?JSON.parse(await readFile(result,'utf8')):null};
  } finally { await rm(dir,{recursive:true,force:true}); }
}

test('versioned synthetic packet compares all 42 tools and identifies the 7 completed schemas',async()=>{
  const result=await compare(packet());
  assert.equal(result.code,0);
  assert.equal(result.report.status,'COMPARED_SOURCE_SHAPES_WITH_PACKET');
  assert.equal(result.report.tools.length,42);
  assert.equal(result.report.tools.filter(value=>value.completedInThisChange).length,7);
  assert.ok(result.report.tools.every(value=>value.status==='SHAPE_MATCH'));
  assert.equal(result.report.liveHostVerified,false);
  assert.match(result.report.localPacket.sha256,/^[0-9a-f]{64}$/u);
});

test('removing a required field is a per-tool schema difference',async()=>{
  const input=packet();
  const schema=input.tools.find(value=>value.name==='read_assessment_sources').inputSchema;
  schema.required=schema.required.filter(value=>value!=='sourceRefs');
  const result=await compare(input);
  assert.equal(result.code,2);
  const changed=result.report.tools.filter(value=>value.status==='SHAPE_DIFFERENCE');
  assert.deepEqual(changed.map(value=>value.name),['read_assessment_sources']);
  assert.ok(changed[0].differences.some(value=>value.path.startsWith('$.required')));
});

test('missing tools are reported without replacing their schema with a permissive one',async()=>{
  const input=packet();
  input.tools=input.tools.filter(value=>value.name!=='document_translation');
  const result=await compare(input);
  assert.equal(result.code,2);
  assert.equal(result.report.tools.find(value=>value.name==='document_translation').status,'MISSING_FROM_PACKET');
});

test('a schema-format version alone is not a Host packet revision',async()=>{
  const input=packet(); delete input.hostCommit;
  input.schemaVersion='synthetic.tools-list.v1';
  const result=await compare(input);
  assert.equal(result.code,2);
  assert.equal(result.report.status,'LOCAL_PACKET_REVISION_MISSING');
  assert.equal(result.report.liveHostVerified,false);
});

test('duplicate tool names cannot silently overwrite a schema',async()=>{
  const input=packet(); input.tools.push(structuredClone(input.tools[0]));
  const result=await compare(input);
  assert.equal(result.code,1);
  assert.match(result.stderr,/HOST_PACKET_DUPLICATE_TOOL/u);
});

test('annotation and set/union order changes are expression equivalence, never runtime acceptance',async()=>{
  const input=packet();
  for(const tool of input.tools) {
    tool.inputSchema.description='synthetic wording only';
    tool.inputSchema.required?.reverse();
    tool.inputSchema.anyOf?.reverse();
  }
  const result=await compare(input);
  assert.equal(result.code,0);
  assert.ok(result.report.tools.every(value=>value.status==='EXPRESSION_EQUIVALENT'));
  assert.ok(result.report.tools.every(value=>value.expressionChanges.every(diff=>diff.category==='EXPRESSION_EQUIVALENCE')));
  assert.equal(result.report.conclusions.mechanicalSchemas,35);
  assert.equal(result.report.conclusions.runtimeSemantics,'PENDING_LOCAL_ZOD_AND_HOST_BUSINESS_EVIDENCE');
  assert.equal(result.report.conclusions.shapeComparisonIsAuthorization,false);
});

function changeFirst(schema,predicate,change) {
  if (!schema || typeof schema!=='object') return false;
  if (predicate(schema)) { change(schema); return true; }
  return Object.values(schema).some(value=>changeFirst(value,predicate,change));
}

test('safe integer maximum change remains a real input restriction difference',async()=>{
  const input=packet();
  const tool=input.tools.find(value=>value.name==='document_translation');
  assert.ok(changeFirst(tool.inputSchema,value=>value.type==='integer'&&value.maximum===Number.MAX_SAFE_INTEGER,
    value=>{value.maximum=Number.MAX_SAFE_INTEGER-1;}));
  const result=await compare(input);
  assert.equal(result.code,2);
  const observed=result.report.tools.find(value=>value.name===tool.name);
  assert.ok(observed.differences.some(value=>value.category==='REAL_INPUT_RESTRICTION'&&value.path.endsWith('.maximum')));
  assert.ok(observed.focusConstraints.source.safeIntegers.some(value=>value.explicitSafeMaximum));
});

test('UUID pattern and format changes require real input and Zod acceptance review',async()=>{
  const input=packet();
  const tool=input.tools.find(value=>changeFirst(value.inputSchema,node=>node.format==='uuid',node=>{
    node.pattern='^[0-9a-f-]{36}$';node.format='guid';
  }));
  assert.ok(tool);
  const result=await compare(input);
  assert.equal(result.code,2);
  const observed=result.report.tools.find(value=>value.name===tool.name);
  assert.ok(observed.differences.some(value=>value.category==='ZOD_HOST_BUSINESS_SEMANTICS'&&value.path.endsWith('.format')));
  assert.ok(observed.differences.some(value=>value.category==='REAL_INPUT_RESTRICTION'&&value.path.endsWith('.pattern')));
  assert.ok(observed.focusConstraints.source.uuids.every(value=>value.acceptanceSet==='UNVERIFIED_AGAINST_LOCAL_ZOD'));
});

test('strict object and action discriminator changes cannot normalize to compatible',async()=>{
  const input=packet();
  const tool=input.tools.find(value=>value.name==='document_translation');
  assert.ok(changeFirst(tool.inputSchema,value=>value.type==='object'&&value.additionalProperties===false,
    value=>{value.additionalProperties=true;}));
  assert.ok(changeFirst(tool.inputSchema,value=>value.properties?.action?.const!==undefined,
    value=>{value.properties.action.const='UNAUTHORIZED_SYNTHETIC_ACTION';}));
  const result=await compare(input);
  assert.equal(result.code,2);
  const observed=result.report.tools.find(value=>value.name===tool.name);
  assert.equal(observed.status,'SHAPE_DIFFERENCE');
  assert.ok(observed.differences.every(value=>value.category==='REAL_INPUT_RESTRICTION'));
});

test('refinement extensions and default transformations are retained for runtime review',async()=>{
  const input=packet(),tool=input.tools.find(value=>value.name==='read_assessment_sources');
  tool.inputSchema['x-runtimeRefinement']='synthetic_new_permission_rule';
  tool.inputSchema.default={};
  const result=await compare(input);
  assert.equal(result.code,2);
  const observed=result.report.tools.find(value=>value.name===tool.name);
  assert.ok(observed.differences.every(value=>value.category==='ZOD_HOST_BUSINESS_SEMANTICS'));
  assert.ok(observed.differences.every(value=>value.requiresRuntimeEvidence));
});

test('instance values named description inside enum are never removed as annotations',async()=>{
  const input=packet(),tool=input.tools.find(value=>value.name==='read_assessment_sources');
  tool.inputSchema.enum=[{description:'synthetic constrained instance'}];
  const result=await compare(input);
  assert.equal(result.code,2);
  const observed=result.report.tools.find(value=>value.name===tool.name);
  assert.ok(observed.differences.some(value=>value.path==='$.enum'&&
    value.actual[0].description==='synthetic constrained instance'));
});

test('three extra packet tools are recorded without extending the 42-tool client scope',async()=>{
  const input=packet();
  for(let index=0;index<3;index++)input.tools.push({name:`ungranted_fixture_${index}`,inputSchema:{type:'object'}});
  const result=await compare(input);
  assert.equal(result.code,0);
  assert.equal(result.report.tools.length,42);
  assert.deepEqual(result.report.extraPacketTools,['ungranted_fixture_0','ungranted_fixture_1','ungranted_fixture_2']);
  assert.equal(result.report.extraToolsAuthorization,'OUTSIDE_EXISTING_CLIENT_ALLOWLIST_NOT_GRANTED');
});

test('a positional schema reference prevents false union-order equivalence',async()=>{
  // These synthetic source+packet fixtures exercise the comparator only. The
  // original requires a string via $ref; reversing its union requires a number.
  const source=structuredClone(contract),input=packet();
  const schema={anyOf:[{type:'string'},{type:'number'}],$ref:'#/anyOf/0'};
  source.serverSource.tools.read_assessment_sources.inputSchema=structuredClone(schema);
  const observed=input.tools.find(value=>value.name==='read_assessment_sources');
  observed.inputSchema=structuredClone(schema);
  observed.inputSchema.anyOf.reverse();
  const result=await compare(input,source);
  assert.equal(result.code,2);
  const tool=result.report.tools.find(value=>value.name==='read_assessment_sources');
  assert.equal(tool.status,'SHAPE_DIFFERENCE');
  assert.equal(tool.expressionChanges.length,0);
  assert.ok(tool.differences.some(value=>value.path==='$.anyOf[0].type'));
});

test('a missing local packet keeps all 42 tools pending and preserves mechanical limits',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'wiselink-no-local-packet-'));
  // Run the same utility in a private copied module location so its default
  // report cannot replace the committed pending report during this test.
  try {
    const {mkdir,copyFile}=await import('node:fs/promises');
    await mkdir(join(dir,'contracts'));
    await copyFile(script,join(dir,'compare-host-interface-packet.mjs'));
    await writeFile(join(dir,'contracts','host-source-interface.json'),JSON.stringify(contract));
    const child=spawnSync(process.execPath,[join(dir,'compare-host-interface-packet.mjs')],{encoding:'utf8'});
    assert.equal(child.status,0,child.stderr);
    const report=JSON.parse(await readFile(join(dir,'contracts','host-packet-comparison.json'),'utf8'));
    assert.equal(report.status,'PENDING_LOCAL_PACKET');
    assert.equal(report.localPacket,null);
    assert.ok(report.tools.every(value=>value.status==='PENDING_LOCAL_PACKET'));
    assert.equal(report.tools.filter(value=>value.sourceSchemaStatus==='MECHANICAL_ZOD_INPUT_SHAPE').length,35);
    assert.ok(report.tools.filter(value=>value.sourceSchemaStatus==='MECHANICAL_ZOD_INPUT_SHAPE')
      .every(value=>value.sourceSemanticLimitations.length>0));
  } finally {await rm(dir,{recursive:true,force:true});}
});
