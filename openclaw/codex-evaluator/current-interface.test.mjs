import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { CURRENT_INTERFACE_PATH, checkCurrentInterfaceSnapshot } from './check-host-contract.mjs';

const repository = new URL('../../', import.meta.url);
const current = new URL(CURRENT_INTERFACE_PATH, repository);
const readJson = async (name, parent) => JSON.parse(await readFile(new URL(name, parent), 'utf8'));
const contract = await readJson('contracts/host-source-interface.json', new URL('./', import.meta.url));
const snapshot = {
  contract,
  examples: await readJson('contracts/host-input-examples.json', new URL('./', import.meta.url)),
  tools: await readJson('mcp/codex.tools-list.json', current),
  initialize: await readJson('mcp/codex.initialize.response.json', current),
  paths: (await readJson('rest/openapi.paths.json', current)).paths,
  index: await readJson('mcp/tool-index.json', current),
  toolFiles: {},
};
for (const name of Object.keys({...contract.serverSource.tools, ...contract.serverSource.excludedToolSchemas}))
  snapshot.toolFiles[name] = await readJson(`mcp/tools/${name}.json`, current);
const clone = () => structuredClone(snapshot);

test('current mode references the unique SDK package and resolves all 42 names with full schemas', () => {
  const before = JSON.stringify(snapshot.contract);
  const result = checkCurrentInterfaceSnapshot(clone());
  assert.equal(result.currentInterfaceSource, CURRENT_INTERFACE_PATH);
  assert.equal(result.currentTools, 45);
  assert.equal(result.completeCurrentSchemas, 42);
  assert.equal(result.convertedExamples, 35);
  assert.equal(result.sourceOnlyExamples, 1);
  assert.equal(result.sourceOnlyClientNamesResolved.length, 7);
  assert.deepEqual(result.additionalCurrentTools,
    ['record_assessment_consumer_stopped', 'get_pending_review_turn', 'read_review_native_sources']);
  assert.equal(result.liveVerified, false);
  assert.equal(JSON.stringify(snapshot.contract), before);
});

test('current mode rejects legacy identity while retaining the pinned artifact as legacy', () => {
  const input = clone();
  input.initialize.result.serverInfo.name = input.contract.serverSource.serverName;
  assert.throws(() => checkCurrentInterfaceSnapshot(input), /current:codex-identity/u);
});

test('current mode requires the Codex queue route even when the legacy route exists', () => {
  const input = clone();
  assert.ok(input.paths['/openapi/wiselink/next-work-item']);
  delete input.paths['/openapi/wiselink/codex-next-work-item'];
  assert.throws(() => checkCurrentInterfaceSnapshot(input), /current:codex-route:codex-next-work-item/u);
});

test('current schemas must reference the same SDK file rather than the approximate client schema', () => {
  const input = clone();
  input.index.tools.find(tool => tool.name === 'save_assessment_work').metadataFile =
    'contracts/host-source-interface.json';
  assert.throws(() => checkCurrentInterfaceSnapshot(input), /current:unique-sdk-reference:save_assessment_work/u);
});

test('the seven source expressions cannot silently substitute for a missing current full schema', () => {
  const input = clone();
  delete input.toolFiles.read_assessment_sources.inputSchema;
  assert.throws(() => checkCurrentInterfaceSnapshot(input), /current:complete-schema:read_assessment_sources/u);
});

test('current validation enforces the SDK safe integer boundary omitted by the mechanical inventory', () => {
  const input = clone();
  input.examples.convertedSchemaExamples.save_assessment_work.expectedWorkRevision = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => checkCurrentInterfaceSnapshot(input), /current:converted-example:save_assessment_work/u);
});

test('the result states input example and format coverage instead of claiming runtime equivalence', () => {
  const result = checkCurrentInterfaceSnapshot(clone());
  assert.equal(result.formatsValidated, false);
  assert.ok(result.formatKeywordsObserved.includes('uuid'));
  assert.ok(result.formatKeywordsObserved.includes('uri'));
  assert.ok(result.clientNamesWithoutPositiveInputExample.includes('document_reading'));
  assert.ok(result.limitations.some(text => text.includes('Zod trim/default/refinement')));
});
