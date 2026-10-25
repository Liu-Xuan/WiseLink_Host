#!/usr/bin/env node
/** Compare a versioned Host tools/list packet with the pinned source-derived shapes.
 * Usage: node compare-host-interface-packet.mjs [packet.json] [report.json]
 * Accepted packet forms: {tools:[{name,inputSchema}]}, {result:{tools:[...]}},
 * or {serverSource:{tools:{name:{inputSchema}}}}. No Host call is made.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const completedNames = ['read_assessment_sources','commit_translation_candidate','translation_workspace',
  'document_work','document_reading','document_translation','derived_summary_attempt'];
const contract = JSON.parse(await readFile(new URL('./contracts/host-source-interface.json',import.meta.url),'utf8'));
const names = Object.keys(contract.serverSource.tools).sort();
const [packetPath, outputPath = new URL('./contracts/host-packet-comparison.json',import.meta.url)] = process.argv.slice(2);
const runtimeRefinements = name => sourceTool(name).runtimeRefinements ?? [];
const normalize = value => {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key])=>!key.startsWith('x-') && !['$schema','title','description'].includes(key))
    .sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,normalize(item)]));
};
const diffs = (expected,actual,path='$',out=[]) => {
  if (JSON.stringify(expected)===JSON.stringify(actual)) return out;
  if (!expected || !actual || typeof expected!=='object' || typeof actual!=='object' ||
      Array.isArray(expected)!==Array.isArray(actual)) {
    out.push({path,expected:expected ?? null,actual:actual ?? null}); return out;
  }
  if (Array.isArray(expected)) {
    for(let i=0;i<Math.max(expected.length,actual.length);i++) diffs(expected[i],actual[i],`${path}[${i}]`,out);
  } else for (const key of new Set([...Object.keys(expected),...Object.keys(actual)]))
    diffs(expected[key],actual[key],`${path}.${key}`,out);
  return out;
};
const sourceTool = name => contract.serverSource.tools[name];
let report;
if (!packetPath) {
  report = {status:'PENDING_LOCAL_PACKET',reason:'No versioned local Host tools/list or manifest packet was supplied.',
    sourceHostCommit:contract.evidence.hostCommit,sourceDependencyBlobs:contract.evidence.dependencySources,
    localPacket:null,liveHostVerified:false,tools:names.map(name=>({name,status:'PENDING_LOCAL_PACKET',
      completedInThisChange:completedNames.includes(name),
      sourceSchemaStatus:sourceTool(name).schemaStatus,
      sourceRuntimeRefinements:runtimeRefinements(name)}))};
} else {
  const packetText = await readFile(packetPath,'utf8');
  const packet = JSON.parse(packetText);
  const entries = packet.tools ?? packet.result?.tools ?? packet.serverSource?.tools;
  if (!entries || (typeof entries!=='object')) throw new Error('HOST_PACKET_TOOLS_MISSING');
  if (Array.isArray(entries) && new Set(entries.map(item=>item.name)).size!==entries.length)
    throw new Error('HOST_PACKET_DUPLICATE_TOOL');
  const tools = Array.isArray(entries) ? Object.fromEntries(entries.map(item=>[item.name,item])) : entries;
  const commit = packet.commit ?? packet.hostCommit ?? packet.manifest?.hostCommit ?? null;
  const version = packet.hostVersion ?? packet.version ?? packet.manifest?.hostVersion ?? packet.manifest?.version ?? null;
  const hasRevision = (typeof commit==='string' && /^[0-9a-f]{40}$/iu.test(commit)) ||
    (typeof version==='string' && version.trim().length>0);
  report = {status:hasRevision?'COMPARED_SOURCE_SHAPES_WITH_PACKET':'LOCAL_PACKET_REVISION_MISSING',
    sourceHostCommit:contract.evidence.hostCommit,liveHostVerified:false,
    localPacket:{path:packetPath,version,commit,schemaVersion:packet.schemaVersion??null,
      sha256:createHash('sha256').update(packetText).digest('hex')},
    extraPacketTools:Object.keys(tools).filter(name=>!names.includes(name)).sort(),
    caveat:'Shape equality does not prove runtime Zod refinement, authorization, or business acceptance.',
    tools:names.map(name=>{
      const source=sourceTool(name),observed=tools[name],expected=source.inputSchema;
      if (!observed) return {name,status:'MISSING_FROM_PACKET',sourceRuntimeRefinements:runtimeRefinements(name)};
      const actual=observed.inputSchema ?? observed.input_schema ?? observed.schema;
      if (!actual) return {name,status:'PACKET_SCHEMA_MISSING',sourceRuntimeRefinements:runtimeRefinements(name)};
      const differences=diffs(normalize(expected),normalize(actual));
      return {name,status:differences.length?'SHAPE_DIFFERENCE':'SHAPE_MATCH',
        completedInThisChange:completedNames.includes(name),
        differences,sourceRuntimeRefinements:runtimeRefinements(name)};
    })};
  if (!hasRevision || report.tools.some(item=>item.status!=='SHAPE_MATCH')) process.exitCode=2;
}
await writeFile(outputPath instanceof URL ? outputPath : outputPath,JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({status:report.status,toolStatuses:Object.fromEntries(report.tools.map(x=>[x.name,x.status])),
  reportPath:outputPath instanceof URL ? fileURLToPath(outputPath) : outputPath})+'\n');
