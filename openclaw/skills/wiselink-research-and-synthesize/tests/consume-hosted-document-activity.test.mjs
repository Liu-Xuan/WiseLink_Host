import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVITY_TOOL_NAME,
  CONSUMER_ACTIVITY_ACTIONS,
  DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,
  REQUEST_FIELD_SCHEMAS,
  buildActivityRequest,
  cancelHostedDocumentActivity,
  consumeHostedDocumentActivity,
} from '../scripts/consume-hosted-document-activity.mjs';

// Host mocks below copy field-for-field from Host commit
// 7c86becbce15960a9cb9604534f0359591629e28:
// document-work-runtime.service.ts (document_work STATUS response),
// document-activity-runtime.service.ts (summary/claim/read responses),
// document-activity-candidate.ts (proposal and saved revision),
// shared/document-activity.interface.ts (all shapes).
const DOCUMENT = 'document_version_act_1';
const RUN = 'activity_run_1';
const PARSE_RUN = 'parse_run_1';
const ORIGINAL_BINDING = {
  documentVersionId: DOCUMENT, parseRunId: PARSE_RUN, parseRevision: 3, familyId: 'family_1',
  sourceArtifactId: 'source_artifact_act_1',
  sourceSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  sourceByteLength: 48_311,
};
const SOURCE_BINDING = { original: ORIGINAL_BINDING, semanticRevision: 2 };
const FENCE = { leaseOwner: 'owner:1', leaseToken: '0f8d6a2b-4c1e-4f6a-9b3d-2e7c8a1b5d34', leaseGeneration: 1 };
const SECTION_SELECTION = { sectionId: 'S-a', unitIds: ['UNIT-a-0'], contextUnitIds: [] };
const ANCHOR_A1 = {
  anchorId: 'ANCH-a1', sourceUnitId: 'UNIT-a-0',
  sourceText: 'Version 2 of the wiring standard becomes effective from January 2027.',
  sourceRefIds: ['SR-1'], sourceLocators: [{ sourceRefId: 'SR-1', locator: 'p.12' }],
};
const ANCHOR_A2 = {
  anchorId: 'ANCH-a2', sourceUnitId: 'UNIT-a-20',
  sourceText: 'Applicability note: the amendment applies to affected operators only.',
  sourceRefIds: ['SR-2'], sourceLocators: [{ sourceRefId: 'SR-2', locator: 'p.13' }],
};
const ANCHOR_B1 = {
  anchorId: 'ANCH-b1', sourceUnitId: 'UNIT-b-0',
  sourceText: 'The covered topics include electrical load analysis records.',
  sourceRefIds: ['SR-3'], sourceLocators: [{ sourceRefId: 'SR-3', locator: 'p.40' }],
};
const SOURCE_COVERAGE = { complete: true, unresolvedRanges: [] };

function summary({ runRef = RUN, result = null, status = 'PENDING', selection = { sectionIds: ['S-a', 'S-b'] } } = {}) {
  return { runRef, requestId: 'req_1', documentVersionId: DOCUMENT, parseRunId: PARSE_RUN,
    semanticRevision: 2, selection, expectedRevision: 1, status,
    deadline: new Date(Date.now() + 60 * 60_000).toISOString(), candidateRevision: result ? 1 : null,
    result, errorCode: null };
}

function readPage({ runRef = RUN, sectionId, offset, anchors, unitIds, nextOffset }) {
  return { runRef,
    sourceBinding: SOURCE_BINDING,
    selection: { sectionId, unitIds, contextUnitIds: [] },
    units: unitIds.map(unitId => ({ unitId, sectionId, text: `unit ${unitId}` })),
    anchors,
    range: { sectionId, offset, unitIds, anchorIds: anchors.map(anchor => anchor.anchorId), nextOffset: nextOffset ?? null },
    sourceCoverage: SOURCE_COVERAGE };
}

function proposal() {
  return { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,
    statements: [
      { statementKey: 'stmt-1', label: '有效日期',
        quotes: [{ anchorId: 'ANCH-a1', start: 0, end: ANCHOR_A1.sourceText.length, text: ANCHOR_A1.sourceText }],
        time: { role: 'EFFECTIVE', precision: 'MONTH', expression: 'CALENDAR', raw: 'January 2027', quoteIndex: 0 },
        statusRaw: 'effective', limitations: ['仅覆盖受影响运营人'] },
      { statementKey: 'stmt-2', label: '适用范围',
        quotes: [{ anchorId: 'ANCH-a2', start: 18, end: 62,
          text: ANCHOR_A2.sourceText.slice(18, 62) }],
        time: null, statusRaw: null, limitations: [] },
    ] };
}

function savedRevision(overrides = {}) {
  const deliveredRanges = [
    { sectionId: 'S-a', offset: 0, unitIds: ['UNIT-a-0'], anchorIds: ['ANCH-a1'], nextOffset: 20 },
    { sectionId: 'S-a', offset: 20, unitIds: ['UNIT-a-20'], anchorIds: ['ANCH-a2'], nextOffset: null },
    { sectionId: 'S-b', offset: 0, unitIds: ['UNIT-b-0'], anchorIds: ['ANCH-b1'], nextOffset: null },
  ];
  return { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,
    candidateOnly: true,
    sourceBinding: SOURCE_BINDING,
    readCoverage: { status: 'DELIVERED_RANGES_ONLY', selection: { sectionIds: ['S-a', 'S-b'] },
      deliveredRanges, sourceCoverage: SOURCE_COVERAGE },
    sourceAnchors: [ANCHOR_A1, ANCHOR_A2, ANCHOR_B1],
    runRef: RUN, candidateRevision: 1,
    statements: proposal().statements.map((statement, index) =>
      ({ ...statement, statementId: `DAS-${index + 1}` })),
    producer: { skillVersion: 'wiselink-research-and-synthesize@r09.c110', modelVersion: 'test-hosted-model-1' },
    savedAt: '2026-09-16T03:04:05.000Z', ...overrides };
}

function hostMock(overrides = {}) {
  const calls = [];
  const modelInputs = [];
  const statuses = [];
  const callTool = async (name, args) => {
    calls.push([name, args]);
    if (name !== ACTIVITY_TOOL_NAME) throw new Error(`unexpected tool ${name}`);
    if (args.action === 'STATUS') {
      const response = typeof overrides.status === 'function' ? overrides.status(args) : overrides.status;
      return response ?? { documentVersionId: DOCUMENT, runtimeAvailable: true,
        latestRun: { parseRunId: PARSE_RUN, status: 'PUBLISHED' },
        nextActivityRunRef: RUN, nextSourceProjectionRunId: null };
    }
    if (args.action === 'ACTIVITY_STATUS') {
      const response = typeof overrides.activityStatus === 'function' ? overrides.activityStatus(args) : overrides.activityStatus;
      const value = response ?? summary();
      statuses.push(value);
      return value;
    }
    if (args.action === 'ACTIVITY_CLAIM') return overrides.claim ?? { ...summary({ status: 'RUNNING' }), fence: FENCE };
    if (args.action === 'ACTIVITY_READ') {
      if (overrides.read) return overrides.read(args);
      if (args.sectionId === 'S-a' && args.offset === 0)
        return readPage({ runRef: args.runRef, sectionId: 'S-a', offset: 0, anchors: [ANCHOR_A1], unitIds: ['UNIT-a-0'], nextOffset: 20 });
      if (args.sectionId === 'S-a' && args.offset === 20)
        return readPage({ runRef: args.runRef, sectionId: 'S-a', offset: 20, anchors: [ANCHOR_A2], unitIds: ['UNIT-a-20'] });
      if (args.sectionId === 'S-b' && args.offset === 0)
        return readPage({ runRef: args.runRef, sectionId: 'S-b', offset: 0, anchors: [ANCHOR_B1], unitIds: ['UNIT-b-0'] });
      throw new Error(`unexpected read ${args.sectionId}@${args.offset}`);
    }
    if (args.action === 'ACTIVITY_SAVE') {
      if (overrides.save) return overrides.save(args);
      return savedRevision();
    }
    if (args.action === 'ACTIVITY_FAIL') return overrides.fail?.(args) ?? summary({ result: null, status: 'FAILED' });
    if (args.action === 'ACTIVITY_HEARTBEAT') return overrides.heartbeat?.(args) ?? { runRef: args.runRef, renewed: true };
    throw new Error(`unexpected action ${args.action}`);
  };
  const invokeModel = async (input, hooks) => {
    modelInputs.push(input);
    if (overrides.model) return overrides.model(input, hooks);
    return { proposal: proposal(), modelVersion: 'test-hosted-model-1' };
  };
  return { calls, modelInputs, statuses, deps: { callTool, invokeModel } };
}

const baseOptions = () => ({ documentVersionId: DOCUMENT, leaseOwner: 'owner:1' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('consumes the pending run through document_work STATUS, exact ACTIVITY_STATUS/CLAIM and READ', async () => {
  const { calls, modelInputs, deps } = hostMock();
  const result = await consumeHostedDocumentActivity(baseOptions(), deps);
  assert.equal(result.status, 'ACTIVITY_WORK_SAVED');
  assert.equal(result.runRef, RUN);
  assert.equal(result.modelInvocations, 1);
  assert.equal(result.candidateOnly, true);
  assert.ok(calls.every(([name]) => name === ACTIVITY_TOOL_NAME));
  const actions = calls.map(([, args]) => args.action);
  assert.ok(!actions.includes('ACTIVITY_BEGIN'));
  assert.ok(!actions.includes('ACTIVITY_CANCEL'));
  // Discovery is document_work STATUS only; ACTIVITY_STATUS always carries
  // the exact non-null runRef.
  assert.deepEqual(actions.slice(0, 4), ['STATUS', 'ACTIVITY_STATUS', 'ACTIVITY_CLAIM', 'ACTIVITY_READ']);
  for (const [name, args] of calls) {
    if (name === ACTIVITY_TOOL_NAME && args.action !== 'STATUS')
      assert.equal(args.runRef, RUN);
  }
  const claim = calls.find(([, args]) => args.action === 'ACTIVITY_CLAIM')[1];
  assert.deepEqual(claim, { action: 'ACTIVITY_CLAIM', documentVersionId: DOCUMENT, runRef: RUN, leaseOwner: 'owner:1' });
  // READ pages: full pagination of S-a (0 then 20) before S-b.
  assert.deepEqual(calls.filter(([, args]) => args.action === 'ACTIVITY_READ')
    .map(([, args]) => [args.sectionId, args.offset]), [['S-a', 0], ['S-a', 20], ['S-b', 0]]);
  for (const [, args] of calls.filter(([, args]) => args.action === 'ACTIVITY_READ')) {
    assert.deepEqual({ documentVersionId: args.documentVersionId, runRef: args.runRef,
      leaseOwner: args.leaseOwner, leaseToken: args.leaseToken, leaseGeneration: args.leaseGeneration },
    { documentVersionId: DOCUMENT, runRef: RUN, ...FENCE });
    assert.equal(args.limit, 20);
  }
  // The model sees the Host-delivered binding, ranges and anchors only.
  assert.equal(modelInputs.length, 1);
  assert.deepEqual(modelInputs[0].sourceBinding, SOURCE_BINDING);
  assert.deepEqual(modelInputs[0].anchors, [ANCHOR_A1, ANCHOR_A2, ANCHOR_B1]);
  assert.equal(modelInputs[0].deliveredRanges.length, 3);
  assert.deepEqual(modelInputs[0].sectionIds, ['S-a', 'S-b']);
  // The SAVE candidate is exactly the proposal; producer is real provenance.
  const save = calls.find(([, args]) => args.action === 'ACTIVITY_SAVE')[1];
  assert.deepEqual(Object.keys(save.candidate).sort(), ['schemaVersion', 'statements']);
  assert.equal(save.candidate.schemaVersion, DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA);
  assert.deepEqual(save.candidate, modelInputs[0] && proposal());
  assert.deepEqual(save.producer, { skillVersion: 'wiselink-research-and-synthesize@r09.c110', modelVersion: 'test-hosted-model-1' });
  assert.deepEqual(save.producer, result.producer);
  assert.deepEqual(result.saved, savedRevision());
});

test('null pending run performs zero model calls and no ACTIVITY_STATUS with runRef:null', async () => {
  const { calls, deps } = hostMock({ status: { documentVersionId: DOCUMENT, nextActivityRunRef: null } });
  deps.invokeModel = () => { throw new Error('must not run'); };
  const result = await consumeHostedDocumentActivity(baseOptions(), deps);
  assert.equal(result.status, 'IDLE');
  assert.equal(result.modelInvocations, 0);
  assert.deepEqual(calls.map(([, args]) => args.action), ['STATUS']);
});

test('a persisted ACTIVITY_STATUS result returns the saved receipt without regeneration', async () => {
  const { calls, deps } = hostMock({ activityStatus: summary({ result: savedRevision() }) });
  deps.invokeModel = () => { throw new Error('must not run'); };
  const result = await consumeHostedDocumentActivity(baseOptions(), deps);
  assert.equal(result.status, 'ACTIVITY_WORK_SAVED');
  assert.equal(result.recoveredFromStatus, true);
  assert.equal(result.modelInvocations, 0);
  assert.deepEqual(calls.map(([, args]) => args.action), ['STATUS', 'ACTIVITY_STATUS']);
});

test('a claim summary that already holds a result also returns zero model', async () => {
  const { calls, deps } = hostMock({ claim: { ...summary({ result: savedRevision() }), fence: FENCE } });
  deps.invokeModel = () => { throw new Error('must not run'); };
  const result = await consumeHostedDocumentActivity(baseOptions(), deps);
  assert.equal(result.status, 'ACTIVITY_WORK_SAVED');
  assert.equal(result.recoveredFromClaim, true);
  assert.equal(result.modelInvocations, 0);
  assert.deepEqual(calls.map(([, args]) => args.action), ['STATUS', 'ACTIVITY_STATUS', 'ACTIVITY_CLAIM']);
});

test('a malformed early-return result never fakes success and never reaches the model', async () => {
  const { calls, modelInputs, deps } = hostMock({ activityStatus: summary({ result: {} }) });
  deps.invokeModel = () => { throw new Error('must not run'); };
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_SAVE_RECEIPT_INVALID/);
  assert.equal(modelInputs.length, 0);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_CLAIM'));
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
});

test('a malformed CLAIM early-return result never fakes success either', async () => {
  const { calls, modelInputs, deps } = hostMock({ claim: { ...summary({ result: {} }), fence: FENCE } });
  deps.invokeModel = () => { throw new Error('must not run'); };
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_SAVE_RECEIPT_INVALID/);
  assert.equal(modelInputs.length, 0);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_READ'));
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
});

test('an early-returned saved receipt for another documentVersionId never fakes success', async () => {
  const { calls, modelInputs, deps } = hostMock({
    activityStatus: summary({ result: savedRevision({
      sourceBinding: { original: { ...ORIGINAL_BINDING, documentVersionId: 'document_version_other' },
        semanticRevision: 2 } }) }),
  });
  deps.invokeModel = () => { throw new Error('must not run'); };
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_SAVE_RECEIPT_SOURCE_BINDING_MISMATCH/);
  assert.equal(modelInputs.length, 0);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_CLAIM'));
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
});

test('a CLAIM receipt whose original binding misses an interface field is rejected', async () => {
  const { sourceSha256, ...originalWithoutSha } = ORIGINAL_BINDING;
  const { calls, modelInputs, deps } = hostMock({
    claim: { ...summary({ result: savedRevision({
      sourceBinding: { original: originalWithoutSha, semanticRevision: 2 } }) }), fence: FENCE },
  });
  deps.invokeModel = () => { throw new Error('must not run'); };
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_SAVE_RECEIPT_SOURCE_BINDING_MISMATCH/);
  assert.equal(modelInputs.length, 0);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_READ'));
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
});

test('a null fence from CLAIM never continues to READ, model or SAVE', async () => {
  const { calls, modelInputs, deps } = hostMock({ claim: { ...summary({ status: 'RUNNING' }), fence: null } });
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_CLAIM_FENCE_UNAVAILABLE/);
  assert.equal(modelInputs.length, 0);
  const actions = calls.map(([, args]) => args.action);
  assert.ok(!actions.includes('ACTIVITY_READ'));
  assert.ok(!actions.includes('ACTIVITY_SAVE'));
  assert.ok(!actions.includes('ACTIVITY_FAIL'));
});

test('an explicit old runRef is addressed exactly even when a newer run is pending', async () => {
  const { calls, deps } = hostMock({
    status: { documentVersionId: DOCUMENT, runtimeAvailable: true,
      latestRun: { parseRunId: PARSE_RUN, status: 'PUBLISHED' },
      nextActivityRunRef: 'activity_run_new', nextSourceProjectionRunId: null },
    activityStatus: summary({ result: savedRevision() }),
  });
  deps.invokeModel = () => { throw new Error('must not run'); };
  const result = await consumeHostedDocumentActivity({ ...baseOptions(), runRef: RUN }, deps);
  assert.equal(result.status, 'ACTIVITY_WORK_SAVED');
  assert.equal(result.runRef, RUN);
  assert.equal(result.recoveredFromStatus, true);
  assert.equal(result.modelInvocations, 0);
  const activityStatus = calls.find(([, args]) => args.action === 'ACTIVITY_STATUS')[1];
  assert.equal(activityStatus.runRef, RUN);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_CLAIM'));
});

test('an explicit runRef with null pending still addresses the old run instead of going idle', async () => {
  const { calls, deps } = hostMock({
    status: { documentVersionId: DOCUMENT, nextActivityRunRef: null },
    activityStatus: summary({ result: savedRevision() }),
  });
  deps.invokeModel = () => { throw new Error('must not run'); };
  const result = await consumeHostedDocumentActivity({ ...baseOptions(), runRef: RUN }, deps);
  assert.equal(result.status, 'ACTIVITY_WORK_SAVED');
  assert.equal(result.modelInvocations, 0);
  assert.equal(calls.find(([, args]) => args.action === 'ACTIVITY_STATUS')[1].runRef, RUN);
});

test('READ receipts never carry a top-level original; only sourceBinding.original', async () => {
  const { calls, deps } = hostMock({
    read: args => ({ ...readPage({ sectionId: args.sectionId, offset: args.offset,
      anchors: [ANCHOR_A1], unitIds: ['UNIT-a-0'] }), original: { binding: ORIGINAL_BINDING } }),
  });
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps),
    /ACTIVITY_READ_TOP_LEVEL_ORIGINAL_FORBIDDEN/);
  const fail = calls.find(([, args]) => args.action === 'ACTIVITY_FAIL');
  assert.equal(fail[1].errorCode, 'ACTIVITY_READ_TOP_LEVEL_ORIGINAL_FORBIDDEN');
});

test('a READ receipt for another run is rejected and isolated to this run', async () => {
  const { calls, modelInputs, deps } = hostMock({
    read: args => (args.offset === 0
      ? { ...readPage({ sectionId: args.sectionId, offset: 0, anchors: [ANCHOR_A1], unitIds: ['UNIT-a-0'] }), runRef: 'activity_run_other' }
      : readPage({ sectionId: args.sectionId, offset: args.offset, anchors: [ANCHOR_A2], unitIds: ['UNIT-a-20'] })),
  });
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_READ_RECEIPT_INVALID/);
  assert.equal(modelInputs.length, 0);
  const fail = calls.find(([, args]) => args.action === 'ACTIVITY_FAIL');
  assert.equal(fail[1].errorCode, 'ACTIVITY_READ_RECEIPT_INVALID');
  assert.deepEqual({ documentVersionId: fail[1].documentVersionId, runRef: fail[1].runRef,
    leaseOwner: fail[1].leaseOwner, leaseToken: fail[1].leaseToken, leaseGeneration: fail[1].leaseGeneration },
  { documentVersionId: DOCUMENT, runRef: RUN, ...FENCE });
});

test('a cross-page sourceBinding change is rejected before any model call', async () => {
  const { calls, modelInputs, deps } = hostMock({
    read: args => (args.sectionId === 'S-a' && args.offset === 20
      ? readPage({ sectionId: 'S-a', offset: 20, anchors: [ANCHOR_A2], unitIds: ['UNIT-a-20'],
        // binding drift on the second page
      }) && { ...readPage({ sectionId: 'S-a', offset: 20, anchors: [ANCHOR_A2], unitIds: ['UNIT-a-20'] }),
        sourceBinding: { original: { ...ORIGINAL_BINDING, parseRevision: 4 }, semanticRevision: 2 } }
      : readPage({ sectionId: args.sectionId, offset: args.offset,
        anchors: args.offset === 0 ? [ANCHOR_A1] : [ANCHOR_B1],
        unitIds: [args.sectionId === 'S-a' ? 'UNIT-a-0' : 'UNIT-b-0'], nextOffset: args.sectionId === 'S-a' ? 20 : null })),
  });
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_READ_BINDING_MISMATCH/);
  assert.equal(modelInputs.length, 0);
  const fail = calls.find(([, args]) => args.action === 'ACTIVITY_FAIL');
  assert.equal(fail[1].errorCode, 'ACTIVITY_READ_BINDING_MISMATCH');
});

test('a quote with a negative start offset is rejected before SAVE like the Host schema', async () => {
  const { calls, deps } = hostMock({
    model: async () => ({ proposal: { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,
      statements: [{ statementKey: 'stmt-1', label: '负偏移',
        quotes: [{ anchorId: 'ANCH-a1', start: -1, end: 7, text: ANCHOR_A1.sourceText.slice(0, 7) }],
        time: null, statusRaw: null, limitations: [] }] }, modelVersion: 'm' }),
  });
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_PROPOSAL_SHAPE_INVALID/);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_SAVE'));
  const fail = calls.find(([, args]) => args.action === 'ACTIVITY_FAIL');
  assert.equal(fail[1].errorCode, 'ACTIVITY_PROPOSAL_SHAPE_INVALID');
});

test('a proposal with any Host-owned field backfilled by the model is rejected before SAVE', async () => {
  const { calls, deps } = hostMock({
    model: async input => ({ proposal: { ...proposal(), sourceBinding: input.sourceBinding }, modelVersion: 'm' }),
  });
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_PROPOSAL_SHAPE_INVALID/);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_SAVE'));
  const fail = calls.find(([, args]) => args.action === 'ACTIVITY_FAIL');
  assert.equal(fail[1].errorCode, 'ACTIVITY_PROPOSAL_SHAPE_INVALID');
});

test('a quote that is not the exact delivered anchor slice is rejected before SAVE', async () => {
  const { calls, deps } = hostMock({
    model: async () => ({ proposal: { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,
      statements: [{ statementKey: 'stmt-1', label: '引用',
        quotes: [{ anchorId: 'ANCH-a1', start: 0, end: 10, text: 'Version 3' }],
        time: null, statusRaw: null, limitations: [] }] }, modelVersion: 'm' }),
  });
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_QUOTE_MISMATCH/);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_SAVE'));
  const fail = calls.find(([, args]) => args.action === 'ACTIVITY_FAIL');
  assert.equal(fail[1].errorCode, 'ACTIVITY_QUOTE_MISMATCH');
});

test('a time raw that no quote covers is rejected like the Host would', async () => {
  const { calls, deps } = hostMock({
    model: async () => ({ proposal: { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,
      statements: [{ statementKey: 'stmt-1', label: '时间',
        quotes: [{ anchorId: 'ANCH-a1', start: 0, end: ANCHOR_A1.sourceText.length, text: ANCHOR_A1.sourceText }],
        time: { role: 'TARGET', precision: 'DAY', expression: 'CALENDAR', raw: 'March 2031', quoteIndex: 0 },
        statusRaw: null, limitations: [] }] }, modelVersion: 'm' }),
  });
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_TIME_NOT_QUOTED/);
  const fail = calls.find(([, args]) => args.action === 'ACTIVITY_FAIL');
  assert.equal(fail[1].errorCode, 'ACTIVITY_TIME_NOT_QUOTED');
});

test('a non-CALENDAR time with a non-UNKNOWN precision is rejected like the Host would', async () => {
  const { calls, deps } = hostMock({
    model: async () => ({ proposal: { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,
      statements: [{ statementKey: 'stmt-1', label: '相对时间',
        quotes: [{ anchorId: 'ANCH-a1', start: 0, end: ANCHOR_A1.sourceText.length, text: ANCHOR_A1.sourceText }],
        time: { role: 'TARGET', precision: 'MONTH', expression: 'RELATIVE', raw: 'January 2027', quoteIndex: 0 },
        statusRaw: null, limitations: [] }] }, modelVersion: 'm' }),
  });
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_TIME_PRECISION_INVALID/);
  const fail = calls.find(([, args]) => args.action === 'ACTIVITY_FAIL');
  assert.equal(fail[1].errorCode, 'ACTIVITY_TIME_PRECISION_INVALID');
});

test('SAVE with an unknown outcome is recovered only from ACTIVITY_STATUS result', async () => {
  let saveFailed = false;
  const { calls, modelInputs, deps } = hostMock({
    save: () => { saveFailed = true; throw new Error('HOST_TIMEOUT'); },
    activityStatus: args => (saveFailed ? summary({ result: savedRevision() }) : summary()),
  });
  const result = await consumeHostedDocumentActivity(baseOptions(), deps);
  assert.equal(result.status, 'ACTIVITY_WORK_SAVED');
  assert.equal(result.saved.replayed, true);
  assert.equal(modelInputs.length, 1);
  assert.equal(calls.filter(([, args]) => args.action === 'ACTIVITY_SAVE').length, 1);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
  assert.equal(calls.filter(([, args]) => args.action === 'ACTIVITY_STATUS').length, 2);
});

test('an unconfirmed SAVE stays pending-confirmation: no FAIL, no fake success, no retry', async () => {
  const { calls, modelInputs, deps } = hostMock({
    save: () => { throw new Error('HOST_TIMEOUT'); },
  });
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_SAVE_UNCONFIRMED/);
  assert.equal(modelInputs.length, 1);
  assert.equal(calls.filter(([, args]) => args.action === 'ACTIVITY_SAVE').length, 1);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
  assert.equal(calls.filter(([, args]) => args.action === 'ACTIVITY_STATUS').length, 2);
});

test('a dispatched SAVE whose recovery STATUS also fails keeps the outcome unknown with zero FAIL', async () => {
  let saveDispatched = false;
  const { calls, modelInputs, deps } = hostMock({
    save: () => { saveDispatched = true; throw new Error('HOST_TIMEOUT'); },
    activityStatus: () => {
      if (saveDispatched) throw new Error('STATUS_NETWORK_DOWN');
      return summary();
    },
  });
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_SAVE_UNCONFIRMED/);
  assert.equal(modelInputs.length, 1);
  assert.equal(calls.filter(([, args]) => args.action === 'ACTIVITY_SAVE').length, 1);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
  assert.equal(calls.filter(([, args]) => args.action === 'ACTIVITY_STATUS').length, 2);
});

test('a dispatched SAVE whose recovery STATUS returns a malformed summary also stays unknown', async () => {
  let saveDispatched = false;
  const { calls, deps } = hostMock({
    save: () => { saveDispatched = true; throw new Error('HOST_TIMEOUT'); },
    activityStatus: () => (saveDispatched ? {} : summary()),
  });
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_SAVE_UNCONFIRMED/);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
  assert.equal(calls.filter(([, args]) => args.action === 'ACTIVITY_STATUS').length, 2);
});

test('a saved receipt whose original binding misses documentVersionId is rejected', async () => {
  const { documentVersionId, ...originalWithoutDv } = ORIGINAL_BINDING;
  const { calls, deps } = hostMock({
    save: () => savedRevision({
      sourceBinding: { original: originalWithoutDv, semanticRevision: 2 } }),
  });
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_SAVE_RECEIPT_SOURCE_BINDING_MISMATCH/);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
});

test('a saved receipt without runRef is rejected and, post-dispatch, not FAILed', async () => {
  const { calls, deps } = hostMock({
    save: args => { const { runRef, ...rest } = savedRevision(); return rest; },
  });
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_SAVE_RECEIPT_INVALID/);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
});

test('a saved receipt whose producer does not match the real provenance is rejected', async () => {
  const { calls, deps } = hostMock({
    save: args => savedRevision({ producer: { ...args.producer, modelVersion: 'forged-model' } }),
  });
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_SAVE_RECEIPT_PRODUCER_MISMATCH/);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
});

test('a saved receipt with a mismatched sourceBinding is rejected', async () => {
  const { calls, deps } = hostMock({
    save: () => savedRevision({ sourceBinding: { original: { ...ORIGINAL_BINDING, parseRevision: 9 }, semanticRevision: 2 } }),
  });
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_SAVE_RECEIPT_SOURCE_BINDING_MISMATCH/);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
});

test('implicit BEGIN is structurally forbidden for the consumer', async () => {
  assert.ok(!CONSUMER_ACTIVITY_ACTIONS.includes('ACTIVITY_BEGIN'));
  assert.ok(!CONSUMER_ACTIVITY_ACTIONS.includes('ACTIVITY_CANCEL'));
  assert.throws(() => buildActivityRequest('ACTIVITY_BEGIN',
    { documentVersionId: DOCUMENT, parseRunId: PARSE_RUN, semanticRevision: 2,
      requestId: 'req_1', expectedRevision: 1, sectionIds: ['S-a'] }),
    /ACTIVITY_BEGIN_FORBIDDEN_FOR_CONSUMER/);
  assert.throws(() => buildActivityRequest('ACTIVITY_STATUS', { documentVersionId: DOCUMENT }),
    /ACTIVITY_REQUEST_FIELDS_INVALID:ACTIVITY_STATUS:runRef/);
  assert.throws(() => buildActivityRequest('ACTIVITY_STATUS', { documentVersionId: DOCUMENT, runRef: null }),
    /ACTIVITY_RUN_REF_INVALID/);
  assert.throws(() => buildActivityRequest('ACTIVITY_STATUS', { documentVersionId: DOCUMENT, runRef: 42 }),
    /ACTIVITY_RUN_REF_INVALID/);
  assert.throws(() => buildActivityRequest('ACTIVITY_READ',
    { documentVersionId: DOCUMENT, runRef: RUN, ...FENCE, sectionId: 'S-a', offset: -1, limit: 20 }),
    /ACTIVITY_READ_OFFSET_INVALID/);
  // REQUEST_FIELD_SCHEMAS mirrors the Host documentActivityActionSchemas field sets.
  assert.deepEqual(REQUEST_FIELD_SCHEMAS.ACTIVITY_STATUS, ['documentVersionId', 'runRef']);
  assert.deepEqual(REQUEST_FIELD_SCHEMAS.ACTIVITY_CLAIM, ['documentVersionId', 'runRef', 'leaseOwner']);
  assert.deepEqual(REQUEST_FIELD_SCHEMAS.ACTIVITY_HEARTBEAT,
    ['documentVersionId', 'runRef', 'leaseOwner', 'leaseToken', 'leaseGeneration']);
  assert.deepEqual(REQUEST_FIELD_SCHEMAS.ACTIVITY_READ,
    ['documentVersionId', 'runRef', 'leaseOwner', 'leaseToken', 'leaseGeneration', 'sectionId', 'offset', 'limit']);
  assert.deepEqual(REQUEST_FIELD_SCHEMAS.ACTIVITY_SAVE,
    ['documentVersionId', 'runRef', 'leaseOwner', 'leaseToken', 'leaseGeneration', 'candidate', 'producer']);
  assert.deepEqual(REQUEST_FIELD_SCHEMAS.ACTIVITY_FAIL,
    ['documentVersionId', 'runRef', 'leaseOwner', 'leaseToken', 'leaseGeneration', 'errorCode']);
});

test('cancellation stays on the explicit owner path with exact request fields', async () => {
  const calls = [];
  const cancelled = await cancelHostedDocumentActivity(
    { documentVersionId: DOCUMENT, runRef: RUN },
    { callTool: async (name, args) => { calls.push([name, args]); return summary({ status: 'CANCELLED' }); } });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.deepEqual(calls, [[ACTIVITY_TOOL_NAME,
    { action: 'ACTIVITY_CANCEL', documentVersionId: DOCUMENT, runRef: RUN }]]);
});

// ---------------------------------------------------------------------------
// Batch B: independent lease heartbeat and durable per-run checkpoints.

import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCheckpointStore } from '../scripts/run-hosted-review-turn.mjs';
import { invokeHostedDocumentActivityModel } from '../scripts/invoke-hosted-document-activity-model.mjs';

async function withCheckpointRoot(run) {
  const directory = await mkdtemp(join(tmpdir(), 'activity-ckpt-'));
  try {
    return await run({
      directory,
      factory: ({ runRef }) => createCheckpointStore(join(directory, runRef)),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('an independent heartbeat renews the lease throughout slow READ, model and SAVE', async () => {
  const { calls, deps } = hostMock({
    read: async (args) => {
      await delay(20);
      if (args.sectionId === 'S-a' && args.offset === 0)
        return readPage({ sectionId: 'S-a', offset: 0, anchors: [ANCHOR_A1], unitIds: ['UNIT-a-0'], nextOffset: 20 });
      if (args.sectionId === 'S-a' && args.offset === 20)
        return readPage({ sectionId: 'S-a', offset: 20, anchors: [ANCHOR_A2], unitIds: ['UNIT-a-20'] });
      if (args.sectionId === 'S-b' && args.offset === 0)
        return readPage({ sectionId: 'S-b', offset: 0, anchors: [ANCHOR_B1], unitIds: ['UNIT-b-0'] });
      throw new Error(`unexpected read ${args.sectionId}@${args.offset}`);
    },
    model: async () => {
      await delay(20);
      return { proposal: proposal(), modelVersion: 'test-hosted-model-1' };
    },
    save: async () => {
      await delay(20);
      return savedRevision();
    },
  });
  const result = await consumeHostedDocumentActivity(
    { ...baseOptions(), heartbeatIntervalMs: 5 }, deps);
  assert.equal(result.status, 'ACTIVITY_WORK_SAVED');
  const heartbeats = calls.filter(([, args]) => args.action === 'ACTIVITY_HEARTBEAT');
  assert.ok(heartbeats.length >= 3, `only ${heartbeats.length} heartbeats`);
  for (const [, args] of heartbeats) {
    assert.deepEqual({ documentVersionId: args.documentVersionId, runRef: args.runRef,
      leaseOwner: args.leaseOwner, leaseToken: args.leaseToken, leaseGeneration: args.leaseGeneration },
    { documentVersionId: DOCUMENT, runRef: RUN, ...FENCE });
  }
  assert.ok(calls.some(([, args]) => args.action === 'ACTIVITY_SAVE'));
});

test('a failing heartbeat aborts the in-flight model through the real AbortSignal and blocks SAVE', async () => {
  const { calls, modelInputs, deps } = hostMock({
    heartbeat: () => { throw new Error('LEASE_EXPIRED'); },
    model: (input, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  });
  await assert.rejects(consumeHostedDocumentActivity(
    { ...baseOptions(), heartbeatIntervalMs: 5 }, deps), /ACTIVITY_LEASE_LOST/);
  assert.equal(modelInputs.length, 1);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_SAVE'));
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
  // finally clears the timer and waits for the in-flight heartbeat: nothing
  // of this attempt keeps running after the call returns.
  const heartbeatsAfter = calls.filter(([, args]) => args.action === 'ACTIVITY_HEARTBEAT').length;
  await delay(20);
  assert.equal(calls.filter(([, args]) => args.action === 'ACTIVITY_HEARTBEAT').length, heartbeatsAfter);
});

test('a lease lost after the model resolved is reported specifically and SAVE stays blocked', async () => {
  const { calls, modelInputs, deps } = hostMock({
    heartbeat: () => { throw new Error('LEASE_EXPIRED'); },
    model: async () => {
      await delay(30);
      return { proposal: proposal(), modelVersion: 'test-hosted-model-1' };
    },
  });
  await assert.rejects(consumeHostedDocumentActivity(
    { ...baseOptions(), heartbeatIntervalMs: 5 }, deps), /ACTIVITY_LEASE_LOST/);
  assert.equal(modelInputs.length, 1);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_SAVE'));
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
});

test('an unknown model outcome from a prior attempt never re-invokes the model', async () => {
  await withCheckpointRoot(async ({ factory }) => {
    const first = hostMock({ model: () => { throw new Error('MODEL_TRANSPORT_DOWN'); } });
    await assert.rejects(consumeHostedDocumentActivity(
      baseOptions(), { ...first.deps, checkpointFactory: factory }), /ACTIVITY_MODEL_OUTCOME_UNKNOWN/);
    assert.equal(first.modelInputs.length, 1);
    assert.ok(!first.calls.some(([, args]) => args.action === 'ACTIVITY_SAVE'));
    assert.ok(!first.calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));

    const second = hostMock();
    await assert.rejects(consumeHostedDocumentActivity(
      baseOptions(), { ...second.deps, checkpointFactory: factory,
        invokeModel: () => { throw new Error('must not run'); } }), /ACTIVITY_MODEL_OUTCOME_UNKNOWN/);
    assert.deepEqual(second.calls.map(([, args]) => args.action),
      ['STATUS', 'ACTIVITY_STATUS', 'ACTIVITY_CLAIM', 'ACTIVITY_STATUS']);
    assert.equal(second.modelInputs.length, 0);
    assert.ok(!second.calls.some(([, args]) => args.action === 'ACTIVITY_READ'));
    assert.ok(!second.calls.some(([, args]) => args.action === 'ACTIVITY_SAVE'));
    assert.ok(!second.calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
  });
});

test('a persisted model result is recovered without regeneration and saved as-is', async () => {
  await withCheckpointRoot(async ({ directory, factory }) => {
    const first = hostMock();
    const firstResult = await consumeHostedDocumentActivity(
      baseOptions(), { ...first.deps, checkpointFactory: factory });
    assert.equal(firstResult.status, 'ACTIVITY_WORK_SAVED');
    assert.equal(firstResult.modelInvocations, 1);
    assert.ok(first.calls.some(([, args]) => args.action === 'ACTIVITY_READ'));
    // Private durable layout: 0700 run directory, 0600 files.
    assert.equal((await stat(join(directory, RUN))).mode & 0o777, 0o700);
    assert.equal((await stat(join(directory, RUN, 'model.result.json'))).mode & 0o777, 0o600);

    // Model a crash between the model result checkpoint and the SAVE dispatch.
    await rm(join(directory, RUN, 'save.started.json'));

    const second = hostMock();
    const secondResult = await consumeHostedDocumentActivity(
      baseOptions(), { ...second.deps, checkpointFactory: factory,
        invokeModel: () => { throw new Error('must not run'); } });
    assert.equal(secondResult.status, 'ACTIVITY_WORK_SAVED');
    assert.equal(secondResult.modelInvocations, 0);
    assert.ok(!second.calls.some(([, args]) => args.action === 'ACTIVITY_READ'));
    const save = second.calls.find(([, args]) => args.action === 'ACTIVITY_SAVE')[1];
    assert.deepEqual(save.candidate, proposal());
    assert.deepEqual(save.producer,
      { skillVersion: 'wiselink-research-and-synthesize@r09.c110', modelVersion: 'test-hosted-model-1' });
    assert.deepEqual(secondResult.saved, savedRevision());
  });
});

test('an unconfirmed prior SAVE is only re-checked through the original run STATUS, never re-dispatched', async () => {
  await withCheckpointRoot(async ({ factory }) => {
    const first = hostMock({ save: () => { throw new Error('HOST_TIMEOUT'); } });
    await assert.rejects(consumeHostedDocumentActivity(
      baseOptions(), { ...first.deps, checkpointFactory: factory }), /ACTIVITY_SAVE_UNCONFIRMED/);
    assert.equal(first.calls.filter(([, args]) => args.action === 'ACTIVITY_SAVE').length, 1);
    assert.ok(!first.calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));

    const second = hostMock();
    await assert.rejects(consumeHostedDocumentActivity(
      baseOptions(), { ...second.deps, checkpointFactory: factory,
        invokeModel: () => { throw new Error('must not run'); } }), /ACTIVITY_SAVE_UNCONFIRMED/);
    const actions = second.calls.map(([, args]) => args.action);
    assert.deepEqual(actions, ['STATUS', 'ACTIVITY_STATUS', 'ACTIVITY_CLAIM', 'ACTIVITY_STATUS']);
    assert.equal(second.modelInputs.length, 0);
    assert.ok(!actions.includes('ACTIVITY_READ'));
    assert.ok(!actions.includes('ACTIVITY_SAVE'));
    assert.ok(!actions.includes('ACTIVITY_FAIL'));
  });
});

test('a tampered checkpoint record is rejected as a binding mismatch', async () => {
  await withCheckpointRoot(async ({ directory, factory }) => {
    const first = hostMock();
    await consumeHostedDocumentActivity(baseOptions(), { ...first.deps, checkpointFactory: factory });
    // Corrupt the persisted source binding for the next attempt.
    const path = join(directory, RUN, 'source.result.json');
    const record = JSON.parse(await readFile(path, 'utf8'));
    record.parseRunId = 'parse_run_other';
    await writeFile(path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    const second = hostMock();
    await assert.rejects(consumeHostedDocumentActivity(
      baseOptions(), { ...second.deps, checkpointFactory: factory }), /ACTIVITY_CHECKPOINT_BINDING_MISMATCH/);
    assert.ok(!second.calls.some(([, args]) => args.action === 'ACTIVITY_SAVE'));
    assert.ok(!second.calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
  });
});

test('a missing checkpoint directory marker for another run is never reused', async () => {
  await withCheckpointRoot(async ({ directory }) => {
    // A different runRef maps to a different checkpoint directory: nothing
    // from activity_run_1 may leak into the recovery of activity_run_2.
    const state = { documentVersionId: DOCUMENT, nextActivityRunRef: 'activity_run_2' };
    const { calls, modelInputs, deps } = hostMock({
      status: state,
      activityStatus: summary({ runRef: 'activity_run_2' }),
      claim: { ...summary({ runRef: 'activity_run_2', status: 'RUNNING' }), fence: FENCE },
      save: () => savedRevision({ runRef: 'activity_run_2' }),
    });
    const factory = ({ runRef }) => createCheckpointStore(join(directory, runRef));
    const result = await consumeHostedDocumentActivity(
      baseOptions(), { ...deps, checkpointFactory: factory });
    assert.equal(result.status, 'ACTIVITY_WORK_SAVED');
    assert.equal(modelInputs.length, 1);
    assert.ok(calls.some(([, args]) => args.action === 'ACTIVITY_READ'));
  });
});

test('an unknown model outcome recovers from the original run STATUS result with zero model calls', async () => {
  await withCheckpointRoot(async ({ factory }) => {
    const first = hostMock({ model: () => { throw new Error('MODEL_TRANSPORT_DOWN'); } });
    await assert.rejects(consumeHostedDocumentActivity(
      baseOptions(), { ...first.deps, checkpointFactory: factory }), /ACTIVITY_MODEL_OUTCOME_UNKNOWN/);

    // Another attempt finished the run between these two tries: only the
    // original run's STATUS result may confirm it, with no model call.
    let activityStatusCalls = 0;
    const activityStatus = () => {
      activityStatusCalls += 1;
      return activityStatusCalls <= 1 ? summary() : summary({ result: savedRevision() });
    };
    const second = hostMock({ activityStatus });
    const result = await consumeHostedDocumentActivity(
      baseOptions(), { ...second.deps, checkpointFactory: factory,
        invokeModel: () => { throw new Error('must not run'); } });
    assert.equal(result.status, 'ACTIVITY_WORK_SAVED');
    assert.equal(result.modelInvocations, 0);
    assert.equal(result.saved.replayed, true);
    assert.ok(!second.calls.some(([, args]) => args.action === 'ACTIVITY_READ'));
    assert.ok(!second.calls.some(([, args]) => args.action === 'ACTIVITY_SAVE'));
    assert.ok(!second.calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
  });
});

test('a heartbeat rejected by the expired lease during READ blocks the model and SAVE', async () => {
  const { calls, modelInputs, deps } = hostMock({
    read: async (args) => {
      await delay(20);
      if (args.sectionId === 'S-a' && args.offset === 0)
        return readPage({ runRef: args.runRef, sectionId: 'S-a', offset: 0,
          anchors: [ANCHOR_A1], unitIds: ['UNIT-a-0'], nextOffset: 20 });
      throw new Error(`unexpected read ${args.sectionId}@${args.offset}`);
    },
    heartbeat: () => ({ runRef: RUN, renewed: false }),
  });
  await assert.rejects(consumeHostedDocumentActivity(
    { ...baseOptions(), heartbeatIntervalMs: 5 }, deps), /ACTIVITY_LEASE_LOST/);
  assert.equal(modelInputs.length, 0);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_SAVE'));
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
});

test('a passed run deadline cancels the old worker and forbids SAVE', async () => {
  const { calls, modelInputs, deps } = hostMock({
    claim: { ...summary({ status: 'RUNNING' }), fence: FENCE,
      deadline: new Date(Date.now() + 20).toISOString() },
    model: async () => {
      await delay(40);
      return { proposal: proposal(), modelVersion: 'test-hosted-model-1' };
    },
  });
  await assert.rejects(consumeHostedDocumentActivity(
    { ...baseOptions(), heartbeatIntervalMs: 5 }, deps), /ACTIVITY_DEADLINE_EXCEEDED/);
  assert.equal(modelInputs.length, 1);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_SAVE'));
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
});

test('heartbeats stay serial and non-reentrant across pagination, persistence and SAVE waits', async () => {
  let active = 0;
  let overlaps = 0;
  let renewals = 0;
  const { calls, modelInputs, deps } = hostMock({
    read: async (args) => {
      await delay(12);
      if (args.sectionId === 'S-a' && args.offset === 0)
        return readPage({ runRef: args.runRef, sectionId: 'S-a', offset: 0,
          anchors: [ANCHOR_A1], unitIds: ['UNIT-a-0'], nextOffset: 20 });
      if (args.sectionId === 'S-a' && args.offset === 20)
        return readPage({ runRef: args.runRef, sectionId: 'S-a', offset: 20,
          anchors: [ANCHOR_A2], unitIds: ['UNIT-a-20'], nextOffset: null });
      if (args.sectionId === 'S-b' && args.offset === 0)
        return readPage({ runRef: args.runRef, sectionId: 'S-b', offset: 0,
          anchors: [ANCHOR_B1], unitIds: ['UNIT-b-0'], nextOffset: null });
      throw new Error(`unexpected read ${args.sectionId}@${args.offset}`);
    },
    heartbeat: async () => {
      active += 1;
      if (active > 1) overlaps += 1;
      await delay(9);
      renewals += 1;
      active -= 1;
      return { runRef: RUN, renewed: true };
    },
    model: async () => {
      await delay(25);
      return { proposal: proposal(), modelVersion: 'test-hosted-model-1' };
    },
    save: async () => {
      await delay(25);
      return savedRevision();
    },
  });
  await withCheckpointRoot(async ({ factory }) => {
    const result = await consumeHostedDocumentActivity(
      { ...baseOptions(), heartbeatIntervalMs: 5 }, { ...deps, checkpointFactory: factory });
    assert.equal(result.status, 'ACTIVITY_WORK_SAVED');
    assert.equal(modelInputs.length, 1);
    assert.equal(overlaps, 0);
    assert.ok(renewals >= 3, `only ${renewals} renewals`);
    assert.ok(calls.some(([, args]) => args.action === 'ACTIVITY_SAVE'));
  });
});

test('a SAVE that already succeeded is returned exactly even when the heartbeat fails while it is in flight', async () => {
  const { calls, deps } = hostMock({
    heartbeat: () => { throw new Error('LEASE_EXPIRED'); },
    save: async () => {
      await delay(40);
      return savedRevision();
    },
  });
  const result = await consumeHostedDocumentActivity(
    { ...baseOptions(), heartbeatIntervalMs: 15 }, deps);
  assert.equal(result.status, 'ACTIVITY_WORK_SAVED');
  assert.deepEqual(result.saved, savedRevision());
  assert.ok(calls.some(([, args]) => args.action === 'ACTIVITY_SAVE'));
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
});

test('a persisted model result that no longer matches the recovered input is rejected', async () => {
  await withCheckpointRoot(async ({ directory, factory }) => {
    const first = hostMock();
    await consumeHostedDocumentActivity(baseOptions(), { ...first.deps, checkpointFactory: factory });
    const path = join(directory, RUN, 'model.result.json');
    const record = JSON.parse(await readFile(path, 'utf8'));
    record.inputHash = 'a'.repeat(64);
    await writeFile(path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    const second = hostMock();
    await assert.rejects(consumeHostedDocumentActivity(
      baseOptions(), { ...second.deps, checkpointFactory: factory,
        invokeModel: () => { throw new Error('must not run'); } }), /ACTIVITY_CHECKPOINT_BINDING_MISMATCH/);
    assert.ok(!second.calls.some(([, args]) => args.action === 'ACTIVITY_SAVE'));
  });
});

test('a lease loss during a slow gateway response aborts the real model HTTP and blocks SAVE', async () => {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      requests.push({ url: req.url, body: Buffer.concat(chunks).toString('utf8') });
      // Slow headers and body: nothing arrives before the abort window.
      setTimeout(() => {
        if (!res.writableEnded && !res.destroyed) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ choices: [] }));
        }
      }, 300);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await withCheckpointRoot(async ({ factory }) => {
      const { calls, deps } = hostMock({
        // Renew until the model request is on the wire, then lose the lease.
        heartbeat: async () => {
          if (requests.length === 0) return { runRef: RUN, renewed: true };
          throw new Error('LEASE_EXPIRED');
        },
      });
      const gatewayUrl = `http://127.0.0.1:${server.address().port}`;
      const invokeModel = (modelInput, hooks) => invokeHostedDocumentActivityModel(modelInput, {
        gatewayUrl, gatewayToken: 'gw-token-1', agentId: 'wiselink-engineering',
        configuredModelVersion: 'configured-fallback-1', ...hooks,
      });
      await assert.rejects(consumeHostedDocumentActivity(
        { ...baseOptions(), heartbeatIntervalMs: 5 },
        { ...deps, checkpointFactory: factory, invokeModel }), /ACTIVITY_LEASE_LOST/);
      assert.equal(requests.length, 1);
      assert.ok(requests[0].body.includes('return_wiselink_activity_proposal'));
      assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_SAVE'));
      assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_FAIL'));
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});


test('an unknown model recovery rejects malformed saved receipts without another model or FAIL', async () => {
  let statusCalls = 0;
  const { deps, calls, modelInputs } = hostMock({ activityStatus: () => summary({ result: ++statusCalls === 1 ? null : {} }) });
  const checkpointFactory = async () => ({ readOptional: async name => name === 'model.started' ? {
    schemaVersion: 'wiselink.document.activity-checkpoint.v1', documentVersionId: DOCUMENT, runRef: RUN } : null });
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), { ...deps, checkpointFactory }), /ACTIVITY_MODEL_OUTCOME_UNKNOWN/);
  assert.equal(modelInputs.length, 0);
  assert.ok(!calls.some(([, args]) => ['ACTIVITY_FAIL', 'ACTIVITY_SAVE'].includes(args.action)));
});

test('a first READ for another parse or semantic revision is rejected before model dispatch', async () => {
  const wrong = { ...SOURCE_BINDING, semanticRevision: 99, original: { ...ORIGINAL_BINDING, parseRunId: 'wrong-parse' } };
  const { deps, calls, modelInputs } = hostMock({ read: args => ({ ...readPage({ sectionId: args.sectionId,
    offset: args.offset, anchors: [ANCHOR_A1], unitIds: ['UNIT-a-0'] }), sourceBinding: wrong }) });
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), deps), /ACTIVITY_READ_BINDING_MISMATCH/);
  assert.equal(modelInputs.length, 0);
  assert.ok(!calls.some(([, args]) => args.action === 'ACTIVITY_SAVE'));
});

test('a model result persistence failure keeps the original outcome unknown across recovery', async () => {
  const { deps, calls, modelInputs } = hostMock();
  const records = {};
  const checkpointFactory = async () => ({ readOptional: async name => records[name] ?? null,
    write: async (name, value) => { if (name === 'model.result') throw new Error('ENOSPC'); records[name] = value; } });
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), { ...deps, checkpointFactory }), error =>
    error.message === 'ACTIVITY_MODEL_OUTCOME_UNKNOWN' && error.cause?.message === 'ENOSPC');
  assert.ok(records['model.started']);
  assert.equal(records['model.result'], undefined);
  await assert.rejects(consumeHostedDocumentActivity(baseOptions(), { ...deps, checkpointFactory }), /ACTIVITY_MODEL_OUTCOME_UNKNOWN/);
  assert.equal(modelInputs.length, 1);
  assert.ok(!calls.some(([, args]) => ['ACTIVITY_FAIL', 'ACTIVITY_SAVE'].includes(args.action)));
});

test('a hanging heartbeat cannot suppress the deadline or leave the model running', async () => {
  let modelSignal;
  const { deps, calls } = hostMock({ claim: { ...summary({ status: 'RUNNING' }), fence: FENCE,
    deadline: new Date(Date.now() + 45).toISOString() }, heartbeat: () => new Promise(() => {}) });
  await assert.rejects(consumeHostedDocumentActivity({ ...baseOptions(), heartbeatIntervalMs: 5 }, { ...deps,
    invokeModel: async (_input, { signal }) => { modelSignal = signal; return new Promise(() => {}); } }), /ACTIVITY_DEADLINE_EXCEEDED/);
  assert.equal(modelSignal.aborted, true);
  assert.ok(!calls.some(([, args]) => ['ACTIVITY_FAIL', 'ACTIVITY_SAVE'].includes(args.action)));
});

test('the lease watchdog also covers checkpoint reads and rejects an expired deadline immediately', async () => {
  for (const offset of [-1, 30]) {
    const { deps, calls, modelInputs } = hostMock({ claim: { ...summary({ status: 'RUNNING' }), fence: FENCE,
      deadline: new Date(Date.now() + offset).toISOString() } });
    const checkpointFactory = () => new Promise(() => {});
    await assert.rejects(consumeHostedDocumentActivity(baseOptions(), { ...deps, checkpointFactory }), /ACTIVITY_DEADLINE_EXCEEDED/);
    assert.equal(modelInputs.length, 0);
    assert.ok(!calls.some(([, args]) => ['ACTIVITY_FAIL', 'ACTIVITY_SAVE'].includes(args.action)));
  }
});
