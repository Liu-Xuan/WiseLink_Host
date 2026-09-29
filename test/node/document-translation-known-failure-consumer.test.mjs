import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeHostedWorkItem } from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/consume-hosted-work-item.mjs';

test('consumer discovers known-failure partial repair through ordinary status ticks', async () => {
  const deliveryRef = 'acquisition:test';
  const documentVersionId = 'DV-test';
  const parseRunId = 'PRUN-test';
  const work = { documentVersionId, runtimeAvailable: true,
    documentDelivery: { reading: false, translation: 'ZH_FULL' },
    latestRun: { documentVersionId, parseRunId, status: 'PUBLISHED', errorCode: null } };
  const calls = [];
  let stage = 'KNOWN_PARTIAL';
  const callTool = async (name, args) => {
    calls.push([name, args]);
    if (name === 'document_work') return args.action === 'INDEX'
      ? { documentVersionId, parseRunId, status: 'INDEXED' } : work;
    if (args.action === 'STATUS') {
      if (stage === 'KNOWN_PARTIAL') return { documentVersionId, parseRunId,
        attemptRef: 'DTQ-known-failure', status: 'SUCCEEDED',
        progress: { completeness: 'PARTIAL' }, partialRepairAvailable: true };
      if (stage === 'REPAIR_QUEUED') return { documentVersionId, parseRunId,
        attemptRef: 'DTQ-partial-repair', status: 'QUEUED' };
      return { documentVersionId, parseRunId, attemptRef: 'DTQ-partial-repair',
        status: 'SUCCEEDED', progress: { completeness: 'PARTIAL' }, partialRepairAvailable: false };
    }
    if (args.action === 'CONTINUE_PARTIAL') return { documentVersionId, parseRunId,
      attemptRef: 'DTQ-partial-repair', status: 'QUEUED' };
    if (args.action === 'CLAIM') return { documentVersionId, parseRunId,
      attemptRef: 'DTQ-partial-repair', status: 'BUSY' };
    throw new Error(`UNEXPECTED_${args.action}`);
  };
  const consume = () => consumeHostedWorkItem({ documentVersionId, deliveryRef }, { callTool });
  const first = await consume();
  assert.equal(first.status, 'QUEUED');
  assert.deepEqual(calls.filter(([name]) => name === 'document_translation').map(([, args]) => args.action),
    ['STATUS', 'CONTINUE_PARTIAL']);
  const continued = calls.find(([, args]) => args.action === 'CONTINUE_PARTIAL')[1];
  assert.equal(continued.attemptRef, 'DTQ-known-failure');
  assert.equal(continued.deliveryRef, deliveryRef);
  calls.length = 0;
  stage = 'REPAIR_QUEUED';
  const second = await consume();
  assert.equal(second.status, 'BUSY');
  assert.deepEqual(calls.filter(([name]) => name === 'document_translation').map(([, args]) => args.action),
    ['STATUS', 'CLAIM']);
  calls.length = 0;
  stage = 'REPAIR_PARTIAL';
  const third = await consume();
  assert.equal(third.status, 'DOCUMENT_READY_WITH_LIMITATIONS');
  assert.deepEqual(calls.filter(([name]) => name === 'document_translation').map(([, args]) => args.action),
    ['STATUS']);
});
