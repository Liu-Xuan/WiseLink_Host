import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {compareHostInterfacePacket} from './compare-host-interface-packet.mjs';

// These are tests of the comparison utility, not observations of a local Host.
const script = fileURLToPath(new URL('./compare-host-interface-packet.mjs',import.meta.url));
const contract = JSON.parse(await readFile(new URL('./contracts/host-source-interface.json',import.meta.url),'utf8'));
const packet = () => ({hostCommit:contract.evidence.hostCommit,tools:Object.entries(contract.serverSource.tools)
  .map(([name,value])=>({name,inputSchema:structuredClone(value.inputSchema)}))});
async function compare(input) {
  const dir=await mkdtemp(join(tmpdir(),'wiselink-packet-comparison-'));
  try {
    const source=join(dir,'synthetic-packet.json'), result=join(dir,'report.json');
    await writeFile(source,JSON.stringify(input));
    const child=spawnSync(process.execPath,[script,source,result],{encoding:'utf8'});
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

test('SDK safe integer bounds remain real differences rather than compatible omissions',()=>{
  const input=packet();
  input.tools.find(tool=>tool.name==='save_assessment_work').inputSchema.properties.expectedWorkRevision.maximum=Number.MAX_SAFE_INTEGER;
  const report=compareHostInterfacePacket(contract,input);
  const changed=report.tools.find(tool=>tool.name==='save_assessment_work');
  assert.equal(changed.status,'SHAPE_DIFFERENCE');
  assert.ok(changed.differences.some(change=>change.category==='SAFE_INTEGER_BOUND_DIFFERENCE'&&
    change.effect==='REAL_BOUNDARY_DIFFERENCE'));
});

test('positive integer lower-bound expressions are classified but still reported as differences',()=>{
  const input=packet();
  const schema=input.tools.find(tool=>tool.name==='save_assessment_work').inputSchema.properties.leaseGeneration;
  assert.equal(schema.minimum,1);
  delete schema.minimum; schema.exclusiveMinimum=0;
  const result=compareHostInterfacePacket(contract,input).tools.find(tool=>tool.name==='save_assessment_work');
  assert.equal(result.status,'SHAPE_DIFFERENCE');
  assert.ok(result.differences.every(change=>change.category==='EQUIVALENT_INTEGER_POSITIVITY_EXPRESSION'));
});

test('a UUID pattern change is not silently replaced by format-only equivalence',()=>{
  const input=packet();
  input.tools.find(tool=>tool.name==='save_assessment_work').inputSchema.properties.leaseToken.pattern='^only-one-value$';
  const result=compareHostInterfacePacket(contract,input).tools.find(tool=>tool.name==='save_assessment_work');
  assert.equal(result.status,'SHAPE_DIFFERENCE');
  assert.ok(result.differences.some(change=>change.category==='UUID_PATTERN_OR_FORMAT_DIFFERENCE'&&
    change.effect==='FORMAT_OR_PATTERN_SEMANTICS_REQUIRE_REVIEW'));
});

test('a tighter ordinary numeric bound remains an unproven validation constraint difference',()=>{
  const input=packet();
  input.tools.find(tool=>tool.name==='save_assessment_work').inputSchema.properties.expectedWorkRevision.maximum=10;
  const result=compareHostInterfacePacket(contract,input).tools.find(tool=>tool.name==='save_assessment_work');
  assert.ok(result.differences.some(change=>change.category==='VALIDATION_CONSTRAINT_DIFFERENCE'&&
    change.effect==='NOT_DECLARED_EQUIVALENT'));
});

test('dropping an empty required list is explicit and never masks a real required field',()=>{
  const input=packet();
  delete input.tools.find(tool=>tool.name==='next_hierarchical_wiki').inputSchema.required;
  const result=compareHostInterfacePacket(contract,input).tools.find(tool=>tool.name==='next_hierarchical_wiki');
  assert.equal(result.status,'SHAPE_DIFFERENCE');
  assert.ok(result.differences.some(change=>change.category==='EQUIVALENT_EMPTY_REQUIRED'));
  const invalid=packet();
  invalid.tools.find(tool=>tool.name==='save_assessment_work').inputSchema.required=[];
  const rejected=compareHostInterfacePacket(contract,invalid).tools.find(tool=>tool.name==='save_assessment_work');
  assert.ok(rejected.differences.some(change=>change.effect==='NOT_DECLARED_EQUIVALENT'));
});

test('a restrictive property-name pattern cannot be classified as a redundant string-name type',()=>{
  const input=packet();
  input.tools.find(tool=>tool.name==='commit_dynamic_evaluation_candidate').inputSchema.properties.result.propertyNames={pattern:'^allowed$'};
  const result=compareHostInterfacePacket(contract,input).tools.find(tool=>tool.name==='commit_dynamic_evaluation_candidate');
  assert.ok(result.differences.some(change=>change.category==='VALIDATION_CONSTRAINT_DIFFERENCE'));
  assert.ok(result.differences.every(change=>change.category!=='EQUIVALENT_JSON_PROPERTY_NAME_TYPE'));
});
