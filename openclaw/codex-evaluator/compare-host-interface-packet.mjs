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
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value==='object'
    ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
      .map(([key,item])=>[key,canonical(item)])) : value;
const sorted = value => value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
// Normalize only proven JSON Schema expression equivalences. In particular,
// do not discard x-zod/refine metadata, dialect, default, or instance properties
// named "description" inside const/enum: those can change the accepted inputs.
const schemaMaps = new Set(['properties','patternProperties','$defs','definitions','dependentSchemas']);
const schemaValues = new Set(['items','additionalProperties','unevaluatedProperties','contains',
  'propertyNames','not','if','then','else','additionalItems','unevaluatedItems']);
const normalize = schema => {
  if (!schema || typeof schema!=='object' || Array.isArray(schema)) return canonical(schema);
  return Object.fromEntries(Object.entries(schema).filter(([key])=>
    !['title','description','$comment','examples'].includes(key))
    .sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>{
      if (schemaMaps.has(key) && value && typeof value==='object')
        return [key,Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
          .map(([name,child])=>[name,normalize(child)]))];
      if (['anyOf','allOf','oneOf'].includes(key) && Array.isArray(value))
        return [key,sorted(value.map(normalize))];
      if (key==='prefixItems' && Array.isArray(value)) return [key,value.map(normalize)];
      if (schemaValues.has(key)) return [key,Array.isArray(value)?value.map(normalize):normalize(value)];
      if (['required','enum','type'].includes(key) && Array.isArray(value)) return [key,sorted(value)];
      return [key,canonical(value)];
    }));
};
// A JSON Pointer may target an array position or even an annotation value.
// Keep reference-bearing schemas intact apart from object-key ordering; only
// a reference-free schema can use the expression rewrites above safely.
const hasSchemaReference = value => value && typeof value==='object' &&
  (Object.keys(value).some(key=>['$ref','$dynamicRef','$recursiveRef','$id','$anchor','$dynamicAnchor'].includes(key)) ||
    Object.values(value).some(hasSchemaReference));
const comparisonShape = schema => hasSchemaReference(schema) ? canonical(schema) : normalize(schema);
const classification = path => /\.(?:x-[^.[\]]+|\$schema|\$ref|\$dynamicRef|default|format)(?:[.\[]|$)/u.test(path)
  ? 'ZOD_HOST_BUSINESS_SEMANTICS' : 'REAL_INPUT_RESTRICTION';
const classified = changes => changes.map(change=>({ ...change,
  category:classification(change.path),
  ...(classification(change.path)==='ZOD_HOST_BUSINESS_SEMANTICS'
    ? {requiresRuntimeEvidence:true} : {}) }));
const focusConstraints = schema => {
  const found={safeIntegers:[],uuids:[],strictObjects:[],actionBranches:[]};
  const visit=(value,path='$')=>{
    if (!value || typeof value!=='object' || Array.isArray(value)) return;
    if (value.type==='integer') found.safeIntegers.push({path,minimum:value.minimum??null,
      maximum:value.maximum??null,explicitSafeMaximum:value.maximum===Number.MAX_SAFE_INTEGER,
      evidence:'JSON_SCHEMA_ONLY_ZOD_SAFE_INTEGER_SEMANTICS_REQUIRE_RUNTIME_CHECK'});
    if (value.format==='uuid' || typeof value.pattern==='string' && /\{8\}.*\{4\}/u.test(value.pattern))
      found.uuids.push({path,format:value.format??null,pattern:value.pattern??null,
        acceptanceSet:'UNVERIFIED_AGAINST_LOCAL_ZOD'});
    if (value.type==='object') found.strictObjects.push({path,
      additionalProperties:value.additionalProperties??'UNSPECIFIED',required:value.required??[]});
    for(const key of ['anyOf','oneOf','allOf']) if(Array.isArray(value[key])) {
      found.actionBranches.push({path:`${path}.${key}`,count:value[key].length,
        discriminators:value[key].map(branch=>branch.properties?.action?.const??branch.properties?.phase?.const??null)});
      value[key].forEach((part,index)=>visit(part,`${path}.${key}[${index}]`));
    }
    for(const [key,child] of Object.entries(value)) {
      if(schemaMaps.has(key) && child && typeof child==='object')
        for(const [name,part] of Object.entries(child)) visit(part,`${path}.${key}.${name}`);
      else if(schemaValues.has(key)) {
        if(Array.isArray(child))child.forEach((part,index)=>visit(part,`${path}.${key}[${index}]`));
        else visit(child,`${path}.${key}`);
      }
    }
  };
  visit(schema);return found;
};
const sourceEvidence = name => ({
  sourceSchemaStatus:sourceTool(name).schemaStatus,
  sourceSemanticLimitations:sourceTool(name).semanticLimitations??[],
  sourceRuntimeRefinements:runtimeRefinements(name),
  runtimeSemanticsStatus:'PENDING_LOCAL_ZOD_AND_HOST_BUSINESS_EVIDENCE',
});
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
      ...sourceEvidence(name)}))};
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
    extraToolsAuthorization:'OUTSIDE_EXISTING_CLIENT_ALLOWLIST_NOT_GRANTED',
    caveat:'Shape equality does not prove runtime Zod refinement, authorization, or business acceptance.',
    tools:names.map(name=>{
      const source=sourceTool(name),observed=tools[name],expected=source.inputSchema;
      if (!observed) return {name,status:'MISSING_FROM_PACKET',...sourceEvidence(name)};
      const actual=observed.inputSchema ?? observed.input_schema ?? observed.schema;
      if (actual===undefined || actual===null) return {name,status:'PACKET_SCHEMA_MISSING',...sourceEvidence(name)};
      const differences=classified(diffs(comparisonShape(expected),comparisonShape(actual)));
      const expressionChanges=differences.length?[]:diffs(canonical(expected),canonical(actual))
        .map(change=>({...change,category:'EXPRESSION_EQUIVALENCE'}));
      return {name,status:differences.length?'SHAPE_DIFFERENCE':expressionChanges.length?'EXPRESSION_EQUIVALENT':'SHAPE_MATCH',
        completedInThisChange:completedNames.includes(name),
        differences,expressionChanges,...sourceEvidence(name),
        focusConstraints:{source:focusConstraints(expected),packet:focusConstraints(actual)}};
    })};
  if (!hasRevision || report.tools.some(item=>!['SHAPE_MATCH','EXPRESSION_EQUIVALENT'].includes(item.status))) process.exitCode=2;
}
report.conclusions={toolNameScope:'42_EXISTING_CLIENT_TOOLS_ONLY',
  localPacketReceived:Boolean(packetPath),liveServiceIdentityVerified:false,
  shapeComparisonIsAuthorization:false,
  mechanicalSchemas:Object.values(contract.serverSource.tools).filter(x=>x.schemaStatus==='MECHANICAL_ZOD_INPUT_SHAPE').length,
  pinnedZodSchemas:completedNames.length,
  runtimeSemantics:'PENDING_LOCAL_ZOD_AND_HOST_BUSINESS_EVIDENCE',
  requiredRuntimeChecks:['safe-integer maximum and minimum including overflow',
    'UUID acceptance set including version, variant, NIL, MAX, case and whitespace',
    'strict objects and every action/phase union branch',
    'trim/default/refine and authorization/version/fence checks']};
await writeFile(outputPath instanceof URL ? outputPath : outputPath,JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({status:report.status,toolStatuses:Object.fromEntries(report.tools.map(x=>[x.name,x.status])),
  reportPath:outputPath instanceof URL ? fileURLToPath(outputPath) : outputPath})+'\n');
