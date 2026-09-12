import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeHostedWorkItem } from '../scripts/consume-hosted-work-item.mjs';
const state = () => ({ documentVersionId: 'DV-test', runtimeAvailable: true, latestRun: {
  documentVersionId: 'DV-test', parseRunId: 'PRUN-test', status: 'STAGING', errorCode: null,
  deadlineAt: new Date(Date.now() + 60_000).toISOString(),
} });
test('document native tick executes only one durable Host step without invoking an engineering model', async () => {
  const calls = [];
  const result = await consumeHostedWorkItem({ documentVersionId: 'DV-test' }, {
    callTool: async (name, args) => { calls.push([name,args]); return args.action === 'STATUS' ? state() : { parseRunId: 'PRUN-test', status: 'STAGING' }; },
    invokeInitialModel: () => { throw new Error('must not run'); },
    invokeReviewModel: () => { throw new Error('must not run'); },
  });
  assert.equal(result.status, 'STAGING');
  assert.deepEqual(calls.map(item => item[1].action), ['STATUS','STEP']);
  assert.ok(calls.every(item => item[0] === 'document_work'));
});
test('failed step is not silently retried and published work is not regenerated', async () => {
  for (const patch of [{ status: 'FAILED', errorCode: 'PLUGIN_FAILURE' }]) {
    const current = state(); Object.assign(current.latestRun, patch);
    const calls = [];
    const result = await consumeHostedWorkItem({ documentVersionId: 'DV-test' }, { callTool: async (_name,args) => { calls.push(args); return current; } });
    assert.equal(calls.length, 1);
    assert.equal(result.status, patch.status === 'FAILED' ? 'REQUIRES_ATTENTION' : 'PUBLISHED');
  }
});
test('published original advances independent translation once and completed translation is not regenerated', async () => {
  const current = state(); current.latestRun.status = 'PUBLISHED';
  for (const status of ['IDLE','RUNNING','SUCCEEDED','FAILED']) {
    const calls = [];
    const translation = { documentVersionId: 'DV-test', parseRunId: 'PRUN-test', attemptRef: 'DTQ-test', status };
    const result = await consumeHostedWorkItem({ documentVersionId: 'DV-test' }, { callTool: async (name,args) => {
      calls.push([name,args]);
      if (name === 'document_work') return args.action === 'INDEX' ? {
        documentVersionId: 'DV-test', parseRunId: 'PRUN-test', status: 'INDEXED',
      } : current;
      return args.action === 'STATUS' ? translation : { ...translation, status: 'RUNNING' };
    } });
    assert.equal(calls.filter(([name]) => name === 'document_work').length, 2);
    assert.deepEqual(calls.filter(([name]) => name === 'document_translation').map(([,args]) => args.action), status === 'IDLE' ? ['STATUS','START'] :
      status === 'RUNNING' ? ['STATUS','STEP'] : ['STATUS']);
    assert.equal(result.status, status === 'SUCCEEDED' ? 'DOCUMENT_READY' : status === 'FAILED' ? 'REQUIRES_ATTENTION' : 'RUNNING');
  }
});
test('source indexing failure is visible without preventing independent translation progress', async () => {
  const current = state(); current.latestRun.status = 'PUBLISHED';
  let translated = false;
  const result = await consumeHostedWorkItem({ documentVersionId: 'DV-test' }, { callTool: async (name,args) => {
    if (name === 'document_work' && args.action === 'INDEX') throw new Error('fixture index error');
    if (name === 'document_work') return current;
    translated = true;
    return { documentVersionId: 'DV-test', parseRunId: 'PRUN-test', attemptRef: 'DTQ', status: 'SUCCEEDED' };
  } });
  assert.equal(translated, true);
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(result.sourceProjection.status, 'FAILED');
});
test('a published newer original does not strand the prior pending index', async () => {
  const current = state(); current.latestRun.status = 'PUBLISHED'; current.nextSourceProjectionRunId = 'PRUN-older';
  const result = await consumeHostedWorkItem({ documentVersionId: 'DV-test' }, { callTool: async (name,args) => {
    if (name === 'document_work' && args.action === 'STATUS') return current;
    if (name === 'document_work') {
      assert.equal(args.parseRunId,'PRUN-older');
      return { documentVersionId: 'DV-test',parseRunId:'PRUN-older',status:'INDEXED' };
    }
    assert.equal(args.parseRunId,'PRUN-test');
    return { documentVersionId:'DV-test',parseRunId:'PRUN-test',attemptRef:'DTQ',status:'SUCCEEDED' };
  } });
  assert.equal(result.sourceProjection.parseRunId,'PRUN-older');
  assert.equal(result.parseRunId,'PRUN-test');
});
test('document identity cannot be combined with an engineering subject or drift after read', async () => {
  await assert.rejects(consumeHostedWorkItem({ documentVersionId: 'DV-test', workItemId: 'WI-test' }, {}), /CONSUMER_SINGLE_SUBJECT_REQUIRED/);
  await assert.rejects(consumeHostedWorkItem({ documentVersionId: 'DV-test' }, { callTool: async () => ({ ...state(), documentVersionId: 'DV-other' }) }), /DOCUMENT_CONSUMER_SCOPE_MISMATCH/);
});
