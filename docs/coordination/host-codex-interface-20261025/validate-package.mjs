#!/usr/bin/env node
/** Validate this review export only. This is not a product runtime gate. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../..');
const require = createRequire(join(root, 'package.json'));
const Ajv2020 = require('ajv/dist/2020').default;
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const readJson = async path => JSON.parse(await readFile(join(directory, path), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
}
const codex = await readJson('mcp/codex.tools-list.json');
const hosted = await readJson('mcp/hosted.tools-list.json');
const index = await readJson('mcp/tool-index.json');
const initialize = await readJson('mcp/codex.initialize.response.json');
const sourceVersion = await readJson('source-version.json');
assert.equal(sourceVersion.deliveryScope, 'P0_PROGRAM_INITIAL_925_CORE');
assert.equal(sourceVersion.parallelP1DocumentTranslationHostRecoveryIncluded, false);
for (const phase of sourceVersion.excludedParallelHostPhases)
  assert.equal(JSON.stringify(codex).includes(JSON.stringify(phase)), false, `P1_PHASE_IN_P0_PACKET:${phase}`);
assert.deepEqual(codex, hosted);
assert.equal(initialize.result.serverInfo.name, 'wiselink-codex-engineering-assessment');
assert.equal(initialize.result.serverInfo.version, '1.2.0');
assert.equal(codex.tools.length, 45);
assert.equal(index.toolCount, codex.tools.length);
assert.equal(new Set(codex.tools.map(tool => tool.name)).size, codex.tools.length);
const validators = new Map();
for (const tool of codex.tools) {
  assert.deepEqual(await readJson(`mcp/tools/${tool.name}.json`), tool);
  const entry = index.tools.find(item => item.name === tool.name);
  assert.ok(entry);
  assert.equal(entry.toolVersion, null);
  assert.equal(entry.outputSchemaDeclared, Object.hasOwn(tool, 'outputSchema'));
  assert.equal(entry.schemaDialect, tool.inputSchema.$schema);
  validators.set(tool.name, ajv.compile(tool.inputSchema));
}

const manifest = await readJson('source-manifest.json');
assert.equal(manifest.hostBusinessHandlersCalled, 0);
assert.equal(manifest.networkAccessed, false);
assert.equal(manifest.environmentOrCredentialValuesExported, false);
for (const source of manifest.files)
  assert.equal(hash(await readFile(join(root, source.path))), source.sha256, `SOURCE_CHANGED:${source.path}`);
const comparison = await readJson('mcp/client-source-comparison.json');
assert.equal(comparison.upstreamInventoriedNames, 42);
assert.equal(comparison.upstreamMechanicalInputSchemas, 35);
assert.equal(comparison.upstreamRealZodInputSchemas, 7);
assert.equal(comparison.upstreamSourceOnlyNames.length, 0);
assert.equal(comparison.extraPacketTools.length, 3);
assert.equal(comparison.mechanicalSchemaComparison.shapeMatchNames.length, 15);
assert.equal(comparison.mechanicalSchemaComparison.shapeDifferenceNames.length, 20);
for (const entry of comparison.tools) {
  assert.equal(entry.currentMetadataFile, `tools/${entry.name}.json`);
  assert.ok(['SHAPE_MATCH','SHAPE_DIFFERENCE'].includes(entry.status));
  assert.deepEqual(await readJson(`mcp/${entry.currentMetadataFile}`), codex.tools.find(tool => tool.name === entry.name));
}
const {checkCurrentInterface} = await import(pathToFileURL(join(root,
  'openclaw/codex-evaluator/check-host-contract.mjs')).href);
const currentInterface = await checkCurrentInterface();
assert.equal(currentInterface.completeCurrentSchemas, 42);

const samples = await readJson('examples/mcp-calls.synthetic.json');
assert.equal(samples.synthetic, true);
assert.equal(samples.exampleStatus, 'SANITIZED_EXAMPLE');
assert.equal(samples.wireCaptured, false);
for (const sample of samples.calls) {
  const validate = validators.get(sample.name);
  assert.ok(validate, `MISSING_TOOL:${sample.name}`);
  assert.ok(validate(sample.arguments), `EXAMPLE_SCHEMA:${sample.name}:${JSON.stringify(validate.errors)}`);
}

const trace = await readJson('examples/producer-cycle.synthetic.json');
assert.equal(trace.synthetic, true);
assert.equal(trace.exampleStatus, 'SANITIZED_EXAMPLE');
assert.equal(trace.sanitization.methodBodiesIncluded, false);
assert.equal(trace.realHostCalled, false);
assert.equal(trace.modelExecution, 'OFFLINE_SUBPROCESS_STUB');
assert.equal(trace.overall.status, 'NOT_EXERCISED');
assert.equal(trace.attemptCompletion.status, 'NOT_EXERCISED');
const saves = trace.events.filter(event => event.method === 'save');
const reads = trace.events.filter(event => event.method === 'work');
assert.equal(saves.length, 1);
assert.equal(reads.length, 2);
assert.equal(reads[0].output.revision, null);
assert.equal(saves[0].input.requestId, trace.result.saveRequest.requestId);
assert.ok(reads.every(event => event.input.requestId === trace.result.saveRequest.requestId));
assert.equal(reads[1].output.revision.workRevisionRef, saves[0].output.workRevisionRef);
assert.equal(reads[1].output.revision.workRevision, trace.result.saveRequest.expectedWorkRevision + 1);
assert.equal(reads[1].output.revision.content.overviewStatus, 'CURRENT');
assert.equal(reads[1].output.revision.actionAttemptId, trace.started.task.actionAttemptId);
assert.equal(trace.result.execution.output.workRevisionRef, reads[1].output.revision.workRevisionRef);
assert.equal(trace.result.response.argsHash, trace.result.modelStarted.argsHash);
assert.deepEqual(trace.result.material.originalInput, trace.started.modelInput);
assert.deepEqual(trace.started.modelInput.programOriginal.binding, trace.started.modelInput.documentOverview.original.binding);
const unsealedTask = structuredClone(trace.started.task);
delete unsealedTask.inputHash;
assert.equal(trace.started.task.inputHash, hash(canonical(unsealedTask)));
const materialEvent = trace.events.find(event => event.method === 'progress' && event.input.phase === 'MATERIALS_READY');
const materialSnapshot = JSON.parse(materialEvent.input.materialSnapshotJson);
assert.equal(trace.result.response.argsHash, hash(canonical({body: materialSnapshot.modelRequest.body,
  executionModel: materialSnapshot.modelRequest.executionModel ?? null})));
const original = trace.result.material.modelInput.continuousOriginal;
for (const span of original.spans) {
  assert.ok(original.content.slice(span.start, span.end).length > 0);
  for (const ref of span.evidenceRefs)
    assert.ok(trace.started.modelInput.availableSources.some(source => source.ref === ref));
}
assert.ok(trace.result.material.sourceReads.every(packet => packet.completeRequestedScope === true));
const pure = await readJson('examples/deterministic-projection.synthetic.json');
assert.equal(pure.exampleStatus, 'SANITIZED_EXAMPLE');
assert.equal(pure.execution, 'PURE_FUNCTIONS_ONLY');
assert.equal(pure.commitCasAndFinish, 'NOT_EXERCISED');
assert.deepEqual(pure.savedRevision, trace.history[0]);
assert.equal(pure.overall.executionKind, 'DETERMINISTIC_PROJECTION');
assert.equal(pure.overall.modelRequests, 0);
assert.equal(pure.overall.authorityLevel, 'candidate_only');
assert.equal(pure.overall.basedOnJobAidWorkRevisionRef, pure.savedRevision.workRevisionRef);
assert.deepEqual(pure.overall.sourceAssessment, pure.independentReadObservation);
assert.equal(pure.independentReadObservation.saveRequestId, trace.result.saveRequest.requestId);
assert.equal(pure.baseFixture.artifact.sha256, hash(canonical(pure.savedRevision)));
assert.equal(pure.baseFixture.artifact.byteLength, Buffer.byteLength(canonical(pure.savedRevision)));
assert.equal(pure.overall.basedOnBaseRuleArtifactSha256, pure.baseFixture.artifact.sha256);
function inspectSanitized(value) {
  if (Array.isArray(value)) return value.forEach(inspectSanitized);
  if (typeof value === 'string' && /^[\[{]/u.test(value)) {
    let parsed;
    try { parsed = JSON.parse(value); } catch { return; }
    return inspectSanitized(parsed);
  }
  if (!value || typeof value !== 'object') return;
  if (value.kind === 'METHOD_CLAUSE' && typeof value.excerpt === 'string')
    assert.ok(value.excerpt.startsWith('SYNTHETIC_METHOD_BODY:'));
  if (typeof value.definitionQuote === 'string') assert.equal(value.definitionQuote, 'SYNTHETIC_METHOD_DEFINITION');
  if (value.role === 'system' && typeof value.content === 'string')
    assert.ok(value.content.startsWith('SYNTHETIC_PROGRAM_INSTRUCTION:'));
  Object.values(value).forEach(inspectSanitized);
}
inspectSanitized(trace);
inspectSanitized(pure);
inspectSanitized(samples);
const queue = await readJson('examples/queue.synthetic.json');
assert.notEqual(queue.keyDistinctions.intakeRequestId, queue.keyDistinctions.stageBeginRequestId);
assert.notEqual(queue.keyDistinctions.stageBeginRequestId, queue.keyDistinctions.saveRequestId);
assert.notEqual(queue.claim.response.leaseToken, trace.started.leaseToken);
const observation = await readJson('configuration/observed-status.json');
assert.equal(observation.configurationValuesIncluded, false);
assert.equal(observation.credentialValuesIncluded, false);
for (const entry of Object.values(observation.observations)) {
  assert.equal(entry.selectorNamePresent, false);
  assert.deepEqual(entry.codexPrefixNamesPresent, []);
  assert.equal(entry.valuesRead, false);
}

const paths = (await readJson('rest/openapi.paths.json')).paths;
for (const [path, item] of Object.entries(paths)) {
  assert.ok(path.startsWith('/openapi/wiselink/'));
  for (const [method, operation] of Object.entries(item))
    if (['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method))
      assert.ok(operation.operationId && operation.responses, `OPENAPI_OPERATION:${path}`);
}

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}
const files = await walk(directory);
let jsonFiles = 0;
let localLinks = 0;
for (const file of files) {
  if (!/\.(?:json|md|mjs)$/u.test(file)) continue;
  const text = await readFile(file, 'utf8');
  assert.equal(/\/(?:Users|Volumes|home)\/[^\s"\\]+/u.test(text), false, 'USER_ABSOLUTE_PATH_FOUND');
  assert.equal(/\b(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}/u.test(text), false, 'SECRET_KEY_SHAPE_FOUND');
  assert.equal(/Bearer\s+[A-Za-z0-9._~-]{16,}/u.test(text), false, 'BEARER_VALUE_FOUND');
  if (file.endsWith('.json')) {
    JSON.parse(text);
    if (file !== join(directory, 'validation-result.json')) jsonFiles += 1;
  }
  if (file.endsWith('.md')) {
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
      const target = match[1].split('#')[0];
      if (!target || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target)) continue;
      const destination = resolve(dirname(file), target);
      assert.ok(destination.startsWith(`${directory}${sep}`), `LINK_OUTSIDE_ARCHIVE:${target}`);
      assert.equal((await stat(destination)).isFile(), true, `MISSING_LOCAL_LINK:${target}`);
      localLinks += 1;
    }
  }
}

const result = { status: 'PASSED', sourceSnapshotMatches: true, tools: codex.tools.length,
  deliveryScope: sourceVersion.deliveryScope, parallelP1DocumentTranslationHostRecoveryIncluded: false,
  completeToolSchemasCompiled: validators.size, schemaFormatValidation: false,
  schemaFormatValidationNote: 'Schema structure and constraints compile; external format plugins are not used.',
  mcpSyntheticInputsValidated: samples.calls.length, jsonFilesParsed: jsonFiles, relativeLinksChecked: localLinks,
  hostBusinessCallsInMetadataExport: 0, networkCallsInMetadataExport: 0,
  exampleModel: 'OFFLINE_SUBPROCESS_STUB', realHostCycleVerified: false,
  pureOverallAssociationChecked: true, examples: 'SANITIZED_EXAMPLE', privateMethodBodiesIncluded: false,
  currentClientNamesChecked:currentInterface.clientNames,
  currentClientCompleteSchemas:currentInterface.completeCurrentSchemas,
  currentClientConvertedExamples:currentInterface.convertedExamples,
  currentClientSourceOnlyExamples:currentInterface.sourceOnlyExamples,
  currentClientFormatsValidated:currentInterface.formatsValidated,
  actualCurrentZodSchemas:currentInterface.currentZodCases.schemas,
  actualCurrentZodAccepted:currentInterface.currentZodCases.accepted,
  actualCurrentZodRejected:currentInterface.currentZodCases.rejected,
  perToolVersionInvented: false, credentialValuesIncluded: false, userAbsolutePathsIncluded: false };
if (process.argv.includes('--write-result'))
  await writeFile(join(directory, 'validation-result.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);
