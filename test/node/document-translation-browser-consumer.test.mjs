import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeHostedWorkItem } from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/consume-hosted-work-item.mjs';

test('ordinary worker claims a browser-admitted successor without starting another translation', async () => {
  const documentVersionId = 'DV-browser';
  const parseRunId = 'PR-browser';
  const deliveryRef = 'acquisition:ACQ-browser';
  const attemptRef = 'DTQ-browser-successor';
  const calls = [];
  const result = await consumeHostedWorkItem({ documentVersionId, deliveryRef }, { callTool: async (name, args) => {
    calls.push([name, args]);
    if (name === 'document_work') return args.action === 'INDEX' ? { documentVersionId, parseRunId, status: 'INDEXED' } : {
      documentVersionId, runtimeAvailable: true, documentDelivery: { reading: false, translation: 'ZH_FULL' },
      latestRun: { documentVersionId, parseRunId, status: 'PUBLISHED', errorCode: null },
    };
    if (args.action === 'STATUS') return { documentVersionId, parseRunId, attemptRef, status: 'QUEUED' };
    if (args.action === 'CLAIM') return { documentVersionId, parseRunId, attemptRef, status: 'BUSY' };
    throw new Error(`UNEXPECTED_${args.action}`);
  } });
  assert.equal(result.status, 'BUSY');
  const translation = calls.filter(([name]) => name === 'document_translation').map(([, args]) => args);
  assert.deepEqual(translation.map(args => args.action), ['STATUS', 'CLAIM']);
  assert.equal(translation[1].attemptRef, attemptRef);
  assert.equal(translation[1].deliveryRef, deliveryRef);
});
