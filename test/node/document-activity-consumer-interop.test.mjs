import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { consumeHostedDocumentActivity } from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/consume-hosted-document-activity.mjs';
import { createCheckpointStore, createHostMcpConnection } from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { invokeHostedDocumentActivityModel, ACTIVITY_PROPOSAL_FUNCTION_NAME } from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/invoke-hosted-document-activity-model.mjs';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { CanonicalHostOpenClawMcpService } = require('../../server/modules/canonical-host/canonical-host-openclaw-mcp.service.ts');
const { DocumentActivityRuntimeService } = require('../../server/modules/canonical-host/document-activity-runtime.service.ts');
const { buildDocumentSemanticMap } = require('../../server/modules/document-management/src/hosted/nest/document-semantic-map.ts');
const { GENERIC_SEMANTIC_PROFILE } = require('../../server/modules/document-management/src/hosted/nest/document-semantic-profile.ts');
const { originalFixture } = require('../unit/document-parsing/fixtures/document-original.fixture.ts');

// Constructed original + in-memory repository. The source selector, candidate
// validator, runtime service, MCP SDK/HTTP, gateway HTTP and disk checkpoints
// are actual implementations. This does not claim production or DB acceptance.
test('consumer and real Host runtime exchange exact table anchors over MCP, then recover without another model', async () => {
  const original = originalFixture();
  original.source.units[0].kind = 'heading';
  original.source.units[0].payload = { text: 'Constructed conditions', level: 1 };
  const map = buildDocumentSemanticMap({ original, semanticRevision: 1, profile: GENERIC_SEMANTIC_PROFILE });
  const artifact = { relativePath: 'original/manifest.json', readback: 'VERIFIED', sha256: 'b'.repeat(64), byteLength: 4321 };
  const loaded = { original, structuredSource: original.source, run: { status: 'PUBLISHED', manifestArtifact: artifact, sourceBinding: { familyId: 'family-test' } } };
  const scope = { tenantId: 'tenant-test', actorUserId: 'actor-test', documentVersionId: original.binding.documentVersionId };
  const row = { runRef: 'DAR-interop', requestId: 'request-interop', documentVersionId: scope.documentVersionId,
    parseRunId: original.binding.parseRunId, parseRevision: original.binding.parseRevision, semanticRevision: 1,
    manifestSha256: artifact.sha256, selection: { sectionIds: [map.sections[0].sectionId] }, expectedRevision: 0,
    candidateRevision: null, status: 'QUEUED', deadline: new Date(Date.now() + 60_000).toISOString(), deliveredRanges: [], result: null, saveCommand: null, errorCode: null };
  let saves = 0;
  let modelCalls = 0;
  const fence = { leaseOwner: 'fixture-producer', leaseToken: '0f23e82b-2b1e-46ba-b62b-9e9a2ec62ca0', leaseGeneration: 1 };
  const runs = {
    expire: async () => {}, // This fixture deadline is in the future.
    readRun: async () => row,
    claim: async () => { row.status = 'RUNNING'; return fence; },
    renew: async () => true,
    recordDelivery: async (_scope, _fence, range) => { row.deliveredRanges.push(range); },
    save: async (_scope, _fence, command, materialize) => {
      saves++;
      row.result = materialize(row, 1);
      row.saveCommand = command;
      row.candidateRevision = 1;
      row.status = 'SAVED';
      return row.result;
    },
    fail: async () => { throw new Error('unexpected fixture FAIL'); },
  };
  const activity = new DocumentActivityRuntimeService(
    { authorizeDocumentWork: async () => scope }, { withActorScope: async (_actor, fn) => fn() },
    { readDocumentOriginal: async () => loaded }, { read: async () => map }, { status: async () => ({}) }, runs);
  const documentWork = { run: async input => {
    assert.equal(input.action, 'STATUS');
    return { nextActivityRunRef: row.result ? null : row.runRef };
  } };
  const mcp = new CanonicalHostOpenClawMcpService({}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, documentWork, {}, {}, activity, { run: async () => { throw new Error('unexpected fixture document_reading'); } });
  const server = createServer((req, res) => {
    if (req.url !== '/v1/chat/completions') { void mcp.handle(req, res); return; }
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      modelCalls++;
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const input = JSON.parse(body.messages.at(-1).content.split('INPUT:\n')[1]);
      const anchor = input.anchors.find(value => value.sourceText === '12 kPa');
      assert.ok(anchor?.payloadPath.includes('cells'));
      const proposal = { schemaVersion: 'wiselink.document.activity-candidate.v1', statements: [{
        statementKey: 'pressure', label: 'Constructed condition', quotes: [{ anchorId: anchor.anchorId,
          start: 0, end: anchor.sourceText.length, text: anchor.sourceText }], time: null, statusRaw: null, limitations: ['Fixture only.'],
      }] };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model_version: 'fixture-model', choices: [{ message: { role: 'assistant',
        tool_calls: [{ type: 'function', function: { name: ACTIVITY_PROPOSAL_FUNCTION_NAME, arguments: JSON.stringify(proposal) } }] } }] }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const directory = await mkdtemp(join(tmpdir(), 'wl-activity-interop-'));
  let connection;
  try {
    connection = await createHostMcpConnection({ hostMcpUrl: `${url}/mcp` });
    const dependencies = {
      callTool: connection.callTool,
      checkpointFactory: ({ runRef }) => createCheckpointStore(join(directory, runRef)),
      invokeModel: (input, hooks) => invokeHostedDocumentActivityModel(input, { gatewayUrl: url,
        gatewayToken: 'fixture-only', configuredModelVersion: 'fixture-model', ...hooks }),
    };
    const options = { documentVersionId: scope.documentVersionId, runRef: row.runRef, leaseOwner: fence.leaseOwner, readLimit: 1 };
    const first = await consumeHostedDocumentActivity(options, dependencies);
    assert.equal(first.status, 'ACTIVITY_WORK_SAVED');
    assert.deepEqual(first.saved.sourceBinding.original, original.binding);
    assert.equal(first.saved.statements[0].quotes[0].text, '12 kPa');
    assert.equal(first.saved.readCoverage.sourceCoverage.unresolvedRanges.length, 2);
    assert.equal(first.saved.readCoverage.deliveredRanges.length, 2);
    const recovered = await consumeHostedDocumentActivity(options, dependencies);
    assert.deepEqual(recovered.saved, first.saved);
    assert.equal(recovered.modelInvocations, 0);
    assert.equal(modelCalls, 1);
    assert.equal(saves, 1);

    // Exercise the actual v2 connection adapter, not a permissive callTool
    // stub: options in the obsolete third argument would let this succeed.
    runs.renew = async () => { await new Promise(resolve => setTimeout(resolve, 150)); return true; };
    const cancellation = new AbortController();
    const abortTimer = setTimeout(() => cancellation.abort(new Error('FIXTURE_ABORT')), 25);
    try {
      await assert.rejects(connection.callTool('document_work', {
        action: 'ACTIVITY_HEARTBEAT', documentVersionId: scope.documentVersionId, runRef: row.runRef, ...fence,
      }, { signal: cancellation.signal, timeout: 75 }), /FIXTURE_ABORT/);
    } finally { clearTimeout(abortTimer); }
  } finally {
    await connection?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
