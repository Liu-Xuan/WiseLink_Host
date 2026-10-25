#!/usr/bin/env node
/** Compare source-derived schemas with a versioned packet. No Host call occurs.
 * CLI: [packet.json] [report.json], or --current-interface [report.json].
 * Current mode references the unique SDK package; it creates no tool-list copy.
 */
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const COMPLETED_ZOD_NAMES = ['read_assessment_sources','commit_translation_candidate',
  'translation_workspace','document_work','document_reading','document_translation','derived_summary_attempt'];
const currentBase = new URL('../../docs/coordination/host-codex-interface-20261025/',import.meta.url);
const sourceUrl = new URL('./contracts/host-source-interface.json',import.meta.url);
const digest = value => createHash('sha256').update(value).digest('hex');
const absent = value => value === undefined ? {absent:true} : value;
const same = (left,right) => JSON.stringify(left) === JSON.stringify(right);

function branchKey(value) {
  for (const key of ['operation','action','phase']) {
    const property = value?.properties?.[key];
    if (property && Object.hasOwn(property,'const')) return `${key}:${JSON.stringify(property.const)}`;
    if (Array.isArray(property?.enum)) return `${key}:${JSON.stringify([...property.enum].sort())}`;
  }
  return JSON.stringify(value);
}

function normalize(value,key='') {
  if (Array.isArray(value)) {
    const items = value.map(item => normalize(item));
    if (['required','enum','type'].includes(key))
      return items.sort((left,right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    if (['oneOf','anyOf','allOf'].includes(key))
      return items.sort((left,right) => branchKey(left).localeCompare(branchKey(right)));
    return items;
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([name]) => !name.startsWith('x-') &&
      !['$schema','$comment','title','description','examples'].includes(name))
    .sort(([left],[right]) => left.localeCompare(right))
    .map(([name,item]) => [name,normalize(item,name)]));
}

function runtimeMetadata(value,path='$',output=[]) {
  if (!value || typeof value !== 'object') return output;
  for (const [key,item] of Object.entries(value)) {
    const next = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
    if (key.startsWith('x-')) output.push({path:next,value:item});
    else runtimeMetadata(item,next,output);
  }
  return output;
}

function differences(expected,actual,tokens=[],output=[]) {
  if (same(expected,actual)) return output;
  if (!expected || !actual || typeof expected !== 'object' || typeof actual !== 'object' ||
      Array.isArray(expected) !== Array.isArray(actual)) {
    const path = tokens.reduce((text,token) => typeof token === 'number' ? `${text}[${token}]` : `${text}.${token}`,'$');
    output.push({path,tokens,expected:absent(expected),actual:absent(actual)});
    return output;
  }
  if (Array.isArray(expected)) {
    for (let index=0;index<Math.max(expected.length,actual.length);index++)
      differences(expected[index],actual[index],[...tokens,index],output);
  } else for (const key of [...new Set([...Object.keys(expected),...Object.keys(actual)])].sort())
    differences(expected[key],actual[key],[...tokens,key],output);
  return output;
}

const at = (value,tokens) => tokens.reduce((item,key) => item?.[key],value);
const positiveInteger = schema => schema?.type === 'integer' &&
  ((schema.minimum === 1 && schema.exclusiveMinimum === undefined) ||
   (schema.exclusiveMinimum === 0 && schema.minimum === undefined));

function classify(change,expected,actual) {
  const tokens = change.tokens, key = tokens.at(-1);
  const before = at(expected,tokens.slice(0,-1)), after = at(actual,tokens.slice(0,-1));
  if (key === 'maximum' && [change.expected,change.actual].includes(Number.MAX_SAFE_INTEGER))
    return {category:'SAFE_INTEGER_BOUND_DIFFERENCE',effect:'REAL_BOUNDARY_DIFFERENCE'};
  if (['minimum','exclusiveMinimum'].includes(key) && positiveInteger(before) && positiveInteger(after))
    return {category:'EQUIVALENT_INTEGER_POSITIVITY_EXPRESSION',effect:'KNOWN_EQUIVALENT_EXPRESSION'};
  if (key === 'type' && before && after && Object.hasOwn(before,'const') &&
      same(before.const,after.const) && (before.type === undefined || after.type === undefined) &&
      [before.type,after.type].includes(typeof before.const))
    return {category:'EQUIVALENT_CONST_TYPE_OMISSION',effect:'KNOWN_EQUIVALENT_EXPRESSION'};
  if (key === 'required' && ((Array.isArray(change.expected) && !change.expected.length && change.actual?.absent) ||
      (Array.isArray(change.actual) && !change.actual.length && change.expected?.absent)))
    return {category:'EQUIVALENT_EMPTY_REQUIRED',effect:'KNOWN_EQUIVALENT_EXPRESSION'};
  if (key === 'propertyNames' && ((same(change.expected,{type:'string'}) && change.actual?.absent) ||
      (same(change.actual,{type:'string'}) && change.expected?.absent)))
    return {category:'EQUIVALENT_JSON_PROPERTY_NAME_TYPE',effect:'KNOWN_EQUIVALENT_EXPRESSION'};
  if (['pattern','format'].includes(key) && (before?.format === 'uuid' || after?.format === 'uuid'))
    return {category:'UUID_PATTERN_OR_FORMAT_DIFFERENCE',effect:'FORMAT_OR_PATTERN_SEMANTICS_REQUIRE_REVIEW'};
  if (key === 'format' && (change.expected === 'starts_with' || change.actual === 'starts_with'))
    return {category:'SDK_PREFIX_FORMAT_ANNOTATION',effect:'DECLARED_FORMAT_DIFFERENCE'};
  if (key === 'pattern' && new Set([change.expected,change.actual]).size === 2 &&
      [change.expected,change.actual].every(value => ['^MAT-','^MAT-.*'].includes(value)))
    return {category:'EQUIVALENT_PREFIX_EXPRESSION',effect:'KNOWN_EQUIVALENT_EXPRESSION'};
  return {category:'VALIDATION_CONSTRAINT_DIFFERENCE',effect:'NOT_DECLARED_EQUIVALENT'};
}

export function compareHostInterfacePacket(contract,packet,{packetLabel=null,packetText=null}={}) {
  const names = Object.keys(contract.serverSource.tools).sort();
  const sourceTool = name => contract.serverSource.tools[name];
  if (!packet) return {status:'PENDING_LOCAL_PACKET',
    reason:'No versioned local Host tools/list or manifest packet was supplied.',
    sourceHostCommit:contract.evidence.hostCommit,sourceDependencyBlobs:contract.evidence.dependencySources,
    localPacket:null,liveHostVerified:false,tools:names.map(name => ({name,status:'PENDING_LOCAL_PACKET',
      completedInThisChange:COMPLETED_ZOD_NAMES.includes(name),sourceSchemaStatus:sourceTool(name).schemaStatus,
      sourceRuntimeRefinements:sourceTool(name).runtimeRefinements ?? []}))};
  const entries = packet.tools ?? packet.result?.tools ?? packet.serverSource?.tools;
  if (!entries || typeof entries !== 'object') throw new Error('HOST_PACKET_TOOLS_MISSING');
  if (Array.isArray(entries) && new Set(entries.map(item => item.name)).size !== entries.length)
    throw new Error('HOST_PACKET_DUPLICATE_TOOL');
  const tools = Array.isArray(entries) ? Object.fromEntries(entries.map(item => [item.name,item])) : entries;
  const commit = packet.commit ?? packet.hostCommit ?? packet.manifest?.hostCommit ?? null;
  const version = packet.hostVersion ?? packet.version ?? packet.manifest?.hostVersion ?? packet.manifest?.version ?? null;
  const hasRevision = (typeof commit === 'string' && /^[0-9a-f]{40}$/iu.test(commit)) ||
    (typeof version === 'string' && version.trim().length > 0);
  const text = packetText ?? JSON.stringify(packet);
  const report = {status:hasRevision?'COMPARED_SOURCE_SHAPES_WITH_PACKET':'LOCAL_PACKET_REVISION_MISSING',
    sourceHostCommit:contract.evidence.hostCommit,liveHostVerified:false,
    localPacket:{path:packetLabel,version,commit,schemaVersion:packet.schemaVersion ?? null,sha256:digest(text)},
    extraPacketTools:Object.keys(tools).filter(name => !names.includes(name)).sort(),
    caveat:'Shape comparison preserves constraint differences. Classified equivalent expressions are still reported; runtime Zod refinement and authorization are separate.',
    tools:names.map(name => {
      const source = sourceTool(name), observed = tools[name];
      if (!source.inputSchema) throw new Error(`HOST_SOURCE_SCHEMA_MISSING:${name}`);
      const common = {name,completedInThisChange:COMPLETED_ZOD_NAMES.includes(name),
        sourceSchemaStatus:source.schemaStatus,sourceRuntimeRefinements:source.runtimeRefinements ?? []};
      if (!observed) return {...common,status:'MISSING_FROM_PACKET'};
      const schema = observed.inputSchema ?? observed.input_schema ?? observed.schema;
      if (!schema) return {...common,status:'PACKET_SCHEMA_MISSING'};
      const expected = normalize(source.inputSchema), actual = normalize(schema);
      const changes = differences(expected,actual).map(change => {
        const {tokens,...fields} = change;
        return {...fields,...classify(change,expected,actual)};
      });
      return {...common,status:changes.length?'SHAPE_DIFFERENCE':'SHAPE_MATCH',differences:changes,
        runtimeMetadataComparison:{source:runtimeMetadata(source.inputSchema),packet:runtimeMetadata(schema)},
        runtimeRefinementVerified:false};
    })};
  report.classificationCounts = {};
  for (const tool of report.tools) for (const change of tool.differences ?? [])
    report.classificationCounts[change.category] = (report.classificationCounts[change.category] ?? 0) + 1;
  report.mechanicalSchemaComparison = {
    shapeMatchNames:report.tools.filter(tool => tool.sourceSchemaStatus === 'MECHANICAL_ZOD_INPUT_SHAPE' &&
      tool.status === 'SHAPE_MATCH').map(tool => tool.name),
    shapeDifferenceNames:report.tools.filter(tool => tool.sourceSchemaStatus === 'MECHANICAL_ZOD_INPUT_SHAPE' &&
      tool.status === 'SHAPE_DIFFERENCE').map(tool => tool.name)};
  return report;
}

async function main() {
  const contract = JSON.parse(await readFile(sourceUrl,'utf8'));
  const args = process.argv.slice(2);
  let packet = null, packetLabel = null, packetText = null, outputPath;
  if (args[0] === '--current-interface') {
    if (args.length > 2) throw new Error('HOST_PACKET_ARGUMENTS_INVALID');
    const listingText = await readFile(new URL('mcp/codex.tools-list.json',currentBase),'utf8');
    const manifestText = await readFile(new URL('source-manifest.json',currentBase),'utf8');
    const manifest = JSON.parse(manifestText);
    packet = {...JSON.parse(listingText),hostCommit:manifest.sourceHead};
    packetLabel = 'docs/coordination/host-codex-interface-20261025/mcp/codex.tools-list.json';
    packetText = JSON.stringify(packet); outputPath = args[1];
  } else {
    if (args.length > 2 || args.some(value => value.startsWith('--'))) throw new Error('HOST_PACKET_ARGUMENTS_INVALID');
    const [packetPath] = args;
    outputPath = args[1] ?? new URL('./contracts/host-packet-comparison.json',import.meta.url);
    if (packetPath) {packetText = await readFile(packetPath,'utf8');packet = JSON.parse(packetText);packetLabel = packetPath;}
  }
  const report = compareHostInterfacePacket(contract,packet,{packetLabel,packetText});
  if (report.status !== 'PENDING_LOCAL_PACKET' && (report.status === 'LOCAL_PACKET_REVISION_MISSING' ||
      report.tools.some(tool => tool.status !== 'SHAPE_MATCH'))) process.exitCode = 2;
  if (outputPath) await writeFile(outputPath,`${JSON.stringify(report,null,2)}\n`);
  process.stdout.write(`${JSON.stringify({status:report.status,
    toolStatuses:Object.fromEntries(report.tools.map(tool => [tool.name,tool.status])),
    classificationCounts:report.classificationCounts ?? {},
    reportPath:outputPath instanceof URL ? fileURLToPath(outputPath) : outputPath ?? null})}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
