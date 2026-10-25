#!/usr/bin/env node
/** Make public shape examples from private, synthetic Host-service test output. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const index = process.argv.indexOf('--source-directory');
assert.ok(index >= 0 && process.argv[index + 1], 'SYNTHETIC_PRIVATE_SOURCE_DIRECTORY_REQUIRED');
const sourceDirectory = resolve(process.argv[index + 1]);
const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
}
const sha256 = text => createHash('sha256').update(text).digest('hex');
const notes = {
  status: 'SANITIZED_EXAMPLE',
  sourceEvidence: 'private-offline-synthetic-host-service-test-output-not-included',
  methodBodiesIncluded: false,
  methodDefinitionQuotesIncluded: false,
  originalProgramSystemPromptIncluded: false,
  fieldsAndReferenceRelationshipsPreserved: true,
  derivedHashesAndByteCountsRecomputed: true,
  sourceArtifactHashesRemainSyntheticFixtureValues: true,
  meaning: 'Post-sanitization shape/association example. Not original run bytes, provenance, a deployed Host receipt, or a content-validation pass of the sanitized text.',
};

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { return canonical(sanitize(JSON.parse(value))); }
      catch { return value; }
    }
    return value;
  }
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item)]));
  if (result.kind === 'METHOD_CLAUSE') {
    if (typeof result.excerpt === 'string') result.excerpt = 'SYNTHETIC_METHOD_BODY: retain actual conditions and record a specific missing fact.';
    if (typeof result.title === 'string') result.title = 'SYNTHETIC_METHOD_TITLE';
    if (typeof result.locator === 'string') result.locator = 'SYNTHETIC_METHOD_SECTION';
  }
  if (typeof result.definitionQuote === 'string') result.definitionQuote = 'SYNTHETIC_METHOD_DEFINITION';
  if (typeof result.sourceIdentity === 'string' && result.sourceIdentity.startsWith('JA-'))
    result.sourceIdentity = 'SYNTHETIC_METHOD_DOCUMENT';
  if (result.role === 'system' && typeof result.content === 'string')
    result.content = 'SYNTHETIC_PROGRAM_INSTRUCTION: return one complete synthetic work candidate. The original private program instruction is omitted.';
  return result;
}

const trace = sanitize(JSON.parse(await readFile(join(sourceDirectory, 'producer-cycle.synthetic.json'), 'utf8')));
assert.equal(trace.synthetic, true);
assert.equal(trace.realHostCalled, false);
trace.exampleStatus = 'SANITIZED_EXAMPLE';
trace.sanitization = notes;
const unsealed = structuredClone(trace.started.task);
delete unsealed.inputHash;
trace.started.task.inputHash = sha256(canonical(unsealed));
const prepared = trace.events.find(event => event.method === 'progress' && event.input.phase === 'MATERIALS_READY');
const snapshot = JSON.parse(prepared.input.materialSnapshotJson);
const requestHash = sha256(canonical({ body: snapshot.modelRequest.body,
  executionModel: snapshot.modelRequest.executionModel ?? null }));
trace.result.modelStarted.argsHash = requestHash;
trace.result.response.argsHash = requestHash;
trace.result.execution.provenance.runMetrics.inputUnits = Buffer.byteLength(snapshot.modelRequest.body);
trace.result.execution.provenance.runMetrics.outputUnits = Buffer.byteLength(trace.result.response.value.raw);

const projection = sanitize(JSON.parse(await readFile(join(sourceDirectory, 'deterministic-projection.synthetic.json'), 'utf8')));
projection.exampleStatus = 'SANITIZED_EXAMPLE';
projection.sanitization = notes;
const revisionBytes = canonical(projection.savedRevision);
const descriptor = { ...projection.baseFixture.artifact, sha256: sha256(revisionBytes),
  byteLength: Buffer.byteLength(revisionBytes) };
projection.baseFixture.artifact = descriptor;
projection.overall.artifact = descriptor;
projection.overall.basedOnBaseRuleArtifactSha256 = descriptor.sha256;
assert.equal(projection.savedRevision.requestId, trace.result.saveRequest.requestId);

const write = async (name, value) => writeFile(join(directory, 'examples', name), `${JSON.stringify(value, null, 2)}\n`);
await write('producer-cycle.synthetic.json', trace);
await write('deterministic-projection.synthetic.json', projection);
const fence = { attemptRef: trace.started.attemptRef, workItemId: trace.started.task.workItemId,
  leaseToken: trace.started.leaseToken, leaseGeneration: trace.started.leaseGeneration };
const stageRequestId = '00000000-0000-4000-8000-000000000101';
const methods = { sources: 'read_assessment_sources', progress: 'record_assessment_program_progress',
  save: 'save_assessment_work', work: 'read_assessment_work' };
const calls = [{ name: 'begin_dynamic_evaluation',
  arguments: { workItemId: fence.workItemId, requestId: stageRequestId }, serviceOutput: trace.started },
...trace.events.map(event => ({ name: methods[event.method], arguments: { ...fence, ...event.input },
  serviceOutput: event.output }))];
await write('mcp-calls.synthetic.json', { synthetic: true, exampleStatus: 'SANITIZED_EXAMPLE',
  wireCaptured: false, source: 'producer-cycle.synthetic.json', sanitization: notes, calls });
const intakeRequestId = 'REQ-SYNTHETIC-INTAKE-001';
await write('queue.synthetic.json', { synthetic: true, exampleStatus: 'SANITIZED_EXAMPLE', serviceExecuted: false,
  sourceType: 'AutomaticWorkItemClaimResult and AcknowledgeAutomaticWorkItemRequest/Response',
  keyDistinctions: { intakeRequestId, stageBeginRequestId: stageRequestId, saveRequestId: trace.result.saveRequest.requestId },
  claim: { method: 'POST', path: '/openapi/wiselink/codex-next-work-item', request: {}, response: {
    status: 'CLAIMED', workItemId: fence.workItemId, requestId: intakeRequestId,
    documentVersionId: trace.started.task.documentVersionId, workItemRevision: trace.started.task.baseRevision,
    leaseToken: '00000000-0000-4000-8000-000000000201', leaseGeneration: 1, leaseExpiresAt: '2099-01-01T00:00:00.000Z' } },
  acknowledgement: { precondition: 'Host confirms exact JobAid/Overall success and all prerequisites; NOT_EXERCISED.',
    method: 'POST', path: '/openapi/wiselink/codex-ack-work-item', request: {
      workItemId: fence.workItemId, leaseToken: '00000000-0000-4000-8000-000000000201', leaseGeneration: 1 },
    response: { status: 'ACKNOWLEDGED', workItemId: fence.workItemId, replayed: false,
      acknowledgedAt: '2099-01-01T00:00:00.000Z' } } });
process.stdout.write(`${JSON.stringify({ status: 'SANITIZED_EXAMPLES_WRITTEN', files: 4,
  privateMethodBodiesIncluded: false, sourcePathsIncluded: false })}\n`);
