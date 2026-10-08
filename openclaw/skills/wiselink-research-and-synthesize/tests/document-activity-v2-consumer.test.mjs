import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVITY_CHECKPOINT_V2_SCHEMA, DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,
  DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 as V2, DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA as SELECTION,
  consumeHostedDocumentActivity, validateActivityProposal, validateActivityQuoteSelection,
} from '../scripts/consume-hosted-document-activity.mjs';
import { activityV2ProductionContract, DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA as CONTEXT } from '../scripts/document-activity-model-contract.mjs';
import { canonicalSha256 } from '../scripts/validate-payload.mjs';
import { activitySourceContextInventory, mergeActivitySourceContexts, validateActivitySourceContext } from '../scripts/merge-document-activity-source-context.mjs';

const DOCUMENT = 'DV-v2-constructed', RUN = 'DAR-v2-constructed';
const BINDING = { original: { documentVersionId: DOCUMENT, parseRunId: 'PR-v2', parseRevision: 1,
  sourceArtifactId: 'SRC-v2', sourceSha256: 'a'.repeat(64), sourceByteLength: 190 }, semanticRevision: 2 };
const FENCE = { leaseOwner: 'constructed:v2', leaseToken: '0f23e82b-2b1e-46ba-b62b-9e9a2ec62ca0', leaseGeneration: 1 };
const ANCHORS = [
  { anchorId: 'a-parent', sourceUnitId: 'u-parent', sourceText: '前😀\r\nIf CIDB is available, operators should not replace P/N 123 before January 2027; target TBD.', sourceRefIds: ['r1'], sourceLocators: [{ sourceRefId: 'r1' }] },
  { anchorId: 'a-leaf', sourceUnitId: 'u-leaf', sourceText: 'Source reports completion on February 2027; LN 10 through 12.', sourceRefIds: ['r2'], sourceLocators: [{ sourceRefId: 'r2' }] },
];
const SECTION = id => ({ sectionId: id, parentSectionId: id === 'leaf' ? 'parent' : null,
  titleRaw: null, roleKey: id === 'leaf' ? 'ACCOMPLISHMENT' : 'GENERAL', headingUnitId: null,
  deliveredUnitIds: [id === 'leaf' ? 'u-leaf' : 'u-parent'], contextForSectionIds: id === 'leaf' ? [] : ['leaf'] });
const CONTEXT_PAGE = id => ({ schemaVersion: CONTEXT, sourceBinding: structuredClone(BINDING),
  profile: { profileRef: 'generic.author-sections.v1', selectionBasis: 'NOT_RECORDED', family: null, issuer: null },
  sections: [SECTION(id)], organizationWarnings: [] });
const RANGES = [
  { sectionId: 'leaf', offset: 0, unitIds: ['u-parent'], anchorIds: ['a-parent'], nextOffset: 1 },
  { sectionId: 'leaf', offset: 1, unitIds: ['u-leaf'], anchorIds: ['a-leaf'], nextOffset: null },
];
const UNITS = [{ unitId: 'u-parent', text: ANCHORS[0].sourceText }, { unitId: 'u-leaf', text: ANCHORS[1].sourceText }];
const MERGED_CONTEXT = () => mergeActivitySourceContexts([CONTEXT_PAGE('parent'), CONTEXT_PAGE('leaf')], { sourceBinding: BINDING, units: UNITS, deliveredRanges: RANGES, selectedSectionIds: ['leaf'] });
const VALIDATION = () => ({ sourceBinding: BINDING, units: UNITS, deliveredRanges: RANGES, sectionIds: ['leaf'], sourceContext: MERGED_CONTEXT(), expectedSourceBinding: BINDING });
const QUOTE = index => ({ anchorId: ANCHORS[index].anchorId, start: 0, end: ANCHORS[index].sourceText.length, text: ANCHORS[index].sourceText });
function proposal(selection = false) {
  return { schemaVersion: V2, ...(selection ? { quoteSelectionSchemaVersion: SELECTION } : {}), statements: [{
    statementKey: 'constructed-source', label: '来源声明', quotes: [QUOTE(1), QUOTE(0)].map(quote => selection ? { anchorId: quote.anchorId, text: quote.text } : quote),
    subject: { raw: 'operators', quoteIndex: 1 }, action: { raw: 'replace P/N 123', quoteIndex: 1 },
    modality: { raw: 'should', quoteIndex: 1, meaning: 'RECOMMENDED', negationQuoteIndexes: [1] },
    status: { raw: 'reports completion', quoteIndex: 0, meaning: 'SOURCE_REPORTED_COMPLETED' },
    times: [
      { raw: 'January 2027', quoteIndex: 1, role: 'CONDITION', precision: 'MONTH', expression: 'CALENDAR' },
      { raw: 'TBD', quoteIndex: 1, role: 'TARGET', precision: 'UNKNOWN', expression: 'TBD' },
      { raw: 'February 2027', quoteIndex: 0, role: 'OCCURRED', precision: 'MONTH', expression: 'CALENDAR' },
    ],
    technicalIds: [{ raw: 'P/N 123', quoteIndex: 1, kind: 'PART_NUMBER' }, { raw: 'LN 10 through 12', quoteIndex: 0, kind: 'AIRCRAFT_LINE_NUMBER' }],
    scope: { sectionIds: ['leaf', 'parent'], conditions: [{ raw: 'If CIDB is available', quoteIndex: 1, kind: 'PREREQUISITE', appliesTo: 'SECTION', sectionIds: ['leaf'] }], completeness: 'DELIVERED_SCOPE_ONLY' },
    limitations: ['仅保留来源已交付声明，不推断实际执行'],
  }] };
}
function saved(proposalValue = proposal(), overrides = {}) {
  const canonical = proposalValue.statements.map(statement => ({ ...statement,
    quotes: statement.quotes.map(quote => Object.hasOwn(quote, 'start') ? quote : QUOTE(ANCHORS.findIndex(anchor => anchor.anchorId === quote.anchorId))) }));
  return { schemaVersion: V2, candidateOnly: true, sourceBinding: structuredClone(BINDING), sourceContext: MERGED_CONTEXT(),
    readCoverage: { status: 'DELIVERED_RANGES_ONLY', selection: { sectionIds: ['leaf'] }, deliveredRanges: structuredClone(RANGES), sourceCoverage: { complete: false, unresolvedRanges: [] } },
    sourceAnchors: structuredClone(ANCHORS), runRef: RUN, candidateRevision: 1,
    statements: canonical.map((statement, index) => ({ ...statement, statementId: `DAS-v2-${index}` })),
    producer: { skillVersion: 'constructed-skill', modelVersion: 'constructed-model' }, savedAt: '2026-10-05T00:00:00.000Z', ...overrides };
}
function harness(overrides = {}, records = new Map(), selection = false) {
  const calls = [], inputs = [];
  const productionContract = activityV2ProductionContract(selection ? SELECTION : undefined);
  const deadline = new Date(Date.now() + 60000).toISOString();
  const summary = () => ({ documentVersionId: DOCUMENT, runRef: RUN, parseRunId: BINDING.original.parseRunId,
    semanticRevision: 2, selection: { sectionIds: ['leaf'] }, expectedRevision: 0,
    candidateSchemaVersion: V2, productionContract, result: null, deadline, ...overrides.summary });
  let statuses = 0;
  const deps = {
    checkpointFactory: async () => ({ readOptional: async name => structuredClone(records.get(name) ?? null), write: async (name, value) => records.set(name, structuredClone(value)) }),
    callTool: async (name, args) => {
      assert.equal(name, 'document_work'); calls.push(structuredClone(args));
      if (args.action === 'STATUS') return { nextActivityRunRef: overrides.nextRunRef ?? RUN };
      assert.equal(args.runRef, RUN);
      if (args.action === 'ACTIVITY_STATUS') return overrides.status?.(++statuses) ?? summary();
      if (args.action === 'ACTIVITY_CLAIM') return { ...summary(), fence: FENCE, ...overrides.claim };
      if (args.action === 'ACTIVITY_HEARTBEAT') return { runRef: RUN, renewed: true };
      if (args.action === 'ACTIVITY_FAIL') return {};
      if (args.action === 'ACTIVITY_READ') {
        const index = args.offset;
        const range = RANGES[index];
        const page = { runRef: RUN, candidateSchemaVersion: V2, productionContract, sourceBinding: structuredClone(BINDING),
          selection: { sectionId: 'leaf', unitIds: ['u-leaf'], contextUnitIds: ['u-parent'] },
          units: [UNITS[index]], anchors: [ANCHORS[index]], range, sourceCoverage: { complete: false, unresolvedRanges: [] },
          sourceContext: CONTEXT_PAGE(index === 0 ? 'parent' : 'leaf') };
        return overrides.read?.(structuredClone(page), args) ?? structuredClone(page);
      }
      if (args.action === 'ACTIVITY_SAVE' || args.action === 'ACTIVITY_SAVE_SELECTION') return overrides.save?.(args) ?? saved(args.candidate);
      throw new Error('unexpected action');
    },
    invokeModel: async input => { inputs.push(structuredClone(input)); return overrides.model?.(input) ?? { proposal: proposal(selection), modelVersion: 'constructed-model',
      provenance: { modelVersion: 'constructed-model', ...productionContract, inputHash: canonicalSha256(input) } }; },
  };
  return { calls, inputs, records, productionContract, deps, summary,
    options: { documentVersionId: DOCUMENT, runRef: RUN, leaseOwner: FENCE.leaseOwner, skillVersion: 'constructed-skill', candidateSchemaVersion: V2, ...(selection ? { quoteSelectionSchemaVersion: SELECTION } : {}) } };
}

test('strict v2 mirror preserves full raw, quote order, negation, multitime, technical identifiers and parent condition', () => {
  const p = proposal(), bytes = JSON.stringify(p);
  assert.equal(validateActivityProposal(p, ANCHORS, VALIDATION()), p);
  assert.equal(JSON.stringify(p), bytes);
  const selection = proposal(true);
  assert.equal(validateActivityQuoteSelection(selection, ANCHORS, VALIDATION()), selection);
  assert.equal(selection.statements[0].quotes[0].anchorId, 'a-leaf');
  assert.deepEqual(selection.statements[0].modality.negationQuoteIndexes, [1]);
});

test('v2 permits null, empty arrays, no time, explicit None, UNKNOWN and empty statements', () => {
  const p = proposal(); const statement = p.statements[0];
  statement.subject = statement.action = statement.modality = statement.status = null;
  statement.times = []; statement.technicalIds = []; statement.scope = { sectionIds: [], conditions: [], completeness: 'UNRESOLVED' };
  assert.equal(validateActivityProposal(p, ANCHORS, VALIDATION()), p);
  assert.deepEqual(validateActivityProposal({ schemaVersion: V2, statements: [] }, ANCHORS, VALIDATION()).statements, []);
  const unknown = proposal(); unknown.statements[0].modality.meaning = 'UNKNOWN';
  assert.equal(validateActivityProposal(unknown, ANCHORS, VALIDATION()), unknown);
  const noneAnchor = { ...ANCHORS[1], sourceText: 'Interim Action None' };
  const none = { ...p, statements: [{ ...statement, quotes: [{ anchorId: noneAnchor.anchorId, start: 0, end: noneAnchor.sourceText.length, text: noneAnchor.sourceText }] }] };
  assert.equal(validateActivityProposal(none, [ANCHORS[0], noneAnchor], VALIDATION()), none);
});

test('v1/v2 shapes and unknown schemas stay mutually strict', () => {
  const p = proposal(); p.statements[0].time = null;
  assert.throws(() => validateActivityProposal(p, ANCHORS, VALIDATION()), /PROPOSAL_SHAPE_INVALID/);
  const old = { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, statements: [{ statementKey: 'old', label: 'old', quotes: [QUOTE(0)], time: null, statusRaw: null, limitations: [] }] };
  assert.equal(validateActivityProposal(old, ANCHORS), old);
  assert.throws(() => validateActivityProposal({ ...old, schemaVersion: V2 }, ANCHORS, VALIDATION()), /PROPOSAL_SHAPE_INVALID/);
  assert.throws(() => validateActivityProposal({ ...old, schemaVersion: 'unknown' }, ANCHORS), /PROPOSAL_SHAPE_INVALID/);
  assert.throws(() => validateActivityProposal({ schemaVersion: V2, statements: [] }, ANCHORS), /SOURCE_CONTEXT_REQUIRED/);
});

for (const [name, mutate, code] of [
  ['subject indexed cue', p => p.statements[0].subject.quoteIndex = 0, 'SUBJECT_NOT_QUOTED'],
  ['action exact raw', p => p.statements[0].action.raw = 'replace P/N 124', 'ACTION_NOT_QUOTED'],
  ['status indexed cue', p => p.statements[0].status.quoteIndex = 1, 'STATUS_NOT_QUOTED'],
  ['invalid negation index', p => p.statements[0].modality.negationQuoteIndexes = [2], 'NEGATION_INDEX_INVALID'],
  ['duplicate negation index', p => p.statements[0].modality.negationQuoteIndexes = [1, 1], 'NEGATION_INDEX_INVALID'],
  ['noncalendar precision', p => p.statements[0].times[1].precision = 'DAY', 'TIME_PRECISION_INVALID'],
  ['technical indexed cue', p => p.statements[0].technicalIds[0].quoteIndex = 0, 'TECHNICAL_ID_NOT_QUOTED'],
  ['undelivered scope', p => p.statements[0].scope.sectionIds.push('unread'), 'SCOPE_NOT_DELIVERED'],
  ['duplicate scope', p => p.statements[0].scope.sectionIds.push('leaf'), 'SCOPE_NOT_DELIVERED'],
  ['nonsection condition targets', p => p.statements[0].scope.conditions[0].appliesTo = 'DOCUMENT', 'CONDITION_SCOPE_INVALID'],
  ['empty section condition targets', p => p.statements[0].scope.conditions[0].sectionIds = [], 'CONDITION_SCOPE_INVALID'],
  ['condition target outside statement scope', p => p.statements[0].scope.sectionIds = ['parent'], 'CONDITION_SCOPE_UNSUPPORTED'],
  ['wrong UTF-16 offsets', p => p.statements[0].quotes[1].start = 1, 'QUOTE_MISMATCH'],
  ['duplicate statement key', p => p.statements.push(structuredClone(p.statements[0])), 'STATEMENT_KEY_DUPLICATE'],
]) test(`v2 mirror rejects ${name}`, () => {
  const p = proposal(); mutate(p); assert.throws(() => validateActivityProposal(p, ANCHORS, VALIDATION()), new RegExp(code));
});

test('ancestor names alone cannot support SECTION condition targets', () => {
  const context = VALIDATION(); context.sourceContext.sections.find(section => section.sectionId === 'parent').contextForSectionIds = [];
  assert.throws(() => validateActivityProposal(proposal(), ANCHORS, context), /CONDITION_SCOPE_UNSUPPORTED/);
});

test('page-dependent context merges only actual units and allows delivered heading promotion', () => {
  const first = CONTEXT_PAGE('parent'), second = CONTEXT_PAGE('parent');
  second.sections[0].headingUnitId = 'heading'; second.sections[0].titleRaw = ''; second.sections[0].deliveredUnitIds = ['heading'];
  const firstBytes = JSON.stringify(first), secondBytes = JSON.stringify(second);
  const merged = mergeActivitySourceContexts([first, second]);
  assert.deepEqual(merged.sections[0].deliveredUnitIds, ['u-parent', 'heading']);
  assert.equal(merged.sections[0].headingUnitId, 'heading'); assert.equal(merged.sections[0].titleRaw, '');
  assert.equal(JSON.stringify(first), firstBytes); assert.equal(JSON.stringify(second), secondBytes);
  assert.equal(validateActivitySourceContext(merged), merged);
  const unreadHeading = structuredClone(first); unreadHeading.sections[0].titleRaw = 'unread';
  assert.throws(() => mergeActivitySourceContexts([unreadHeading]), /SOURCE_CONTEXT_INVALID/);
});

test('context merge rejects binding/profile/structural conflicts and undelivered inventory', () => {
  for (const [mutate, error] of [
    [context => context.sourceBinding.original.sourceSha256 = 'b'.repeat(64), 'BINDING_MISMATCH'],
    [context => context.profile.profileRef = 'other.sections.v1', 'PROFILE_MISMATCH'],
    [context => context.sections[0].roleKey = 'OTHER', 'SECTION_MISMATCH'],
    [context => context.sections[0].parentSectionId = 'other', 'SECTION_MISMATCH'],
  ]) { const context = CONTEXT_PAGE('parent'); mutate(context); assert.throws(() => mergeActivitySourceContexts([CONTEXT_PAGE('parent'), context]), new RegExp(error)); }
  assert.throws(() => validateActivitySourceContext(MERGED_CONTEXT(), { deliveredRanges: [RANGES[0]] }), /SOURCE_CONTEXT_INVALID/);
  const extra = CONTEXT_PAGE('parent'); extra.sections[0].extra = 'forbidden';
  assert.throws(() => mergeActivitySourceContexts([extra]), /SOURCE_CONTEXT_INVALID/);
});

for (const selection of [false, true]) test(`v2 ${selection ? 'selection' : 'offset'} consumer pins all durable steps and preserves exact canonical readback`, async () => {
  const h = harness({}, new Map(), selection);
  const result = await consumeHostedDocumentActivity(h.options, h.deps);
  assert.equal(result.status, 'ACTIVITY_WORK_SAVED'); assert.equal(result.modelInvocations, 1);
  assert.deepEqual(h.inputs[0].productionContract, h.productionContract);
  assert.deepEqual(activitySourceContextInventory(h.inputs[0].sourceContext), activitySourceContextInventory(MERGED_CONTEXT()));
  assert.equal(h.inputs[0].candidateSchemaVersion, V2);
  assert.equal(result.saved.statements[0].times.length, 3);
  assert.deepEqual(result.saved.statements[0].modality.negationQuoteIndexes, [1]);
  assert.deepEqual(result.saved.statements[0].quotes, [QUOTE(1), QUOTE(0)]);
  const command = h.calls.find(call => call.action === (selection ? 'ACTIVITY_SAVE_SELECTION' : 'ACTIVITY_SAVE'));
  assert.deepEqual(command.candidate, proposal(selection));
  for (const name of ['source.result', 'model.started', 'model.result', 'save.started']) {
    const record = h.records.get(name); assert.equal(record.schemaVersion, ACTIVITY_CHECKPOINT_V2_SCHEMA);
    assert.equal(record.candidateSchemaVersion, V2); assert.deepEqual(record.productionContract, h.productionContract);
    assert.equal(record.sourceContextVersion, CONTEXT); assert.equal(record.quoteTransportVersion, h.productionContract.quoteTransportVersion);
  }
});

test('v1 default cannot silently consume v2 and selection opt-in must equal the immutable run transport', async () => {
  const h = harness(); const options = { ...h.options }; delete options.candidateSchemaVersion;
  await assert.rejects(consumeHostedDocumentActivity(options, h.deps), /RUN_CONTRACT_MISMATCH/);
  assert.ok(!h.calls.some(call => call.action === 'ACTIVITY_CLAIM'));
  const selection = harness({}, new Map(), true); delete selection.options.quoteSelectionSchemaVersion;
  await assert.rejects(consumeHostedDocumentActivity(selection.options, selection.deps), /RUN_CONTRACT_MISMATCH/);
});

test('v2 summary/claim/READ production pins and merged contexts cannot drift', async () => {
  const bad = harness({ summary: { productionContract: { ...activityV2ProductionContract(), toolSchemaSha256: 'f'.repeat(64) } } });
  await assert.rejects(consumeHostedDocumentActivity(bad.options, bad.deps), /PRODUCTION_CONTRACT_INVALID/);
  const claim = harness({ claim: { productionContract: activityV2ProductionContract(SELECTION) } });
  await assert.rejects(consumeHostedDocumentActivity(claim.options, claim.deps), /RUN_CONTRACT_MISMATCH/);
  const read = harness({ read: page => ({ ...page, candidateSchemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, productionContract: null }) });
  await assert.rejects(consumeHostedDocumentActivity(read.options, read.deps), /RUN_CONTRACT_MISMATCH/);
  assert.equal(read.inputs.length, 0);
  const context = harness({ read: page => { page.sourceContext.sourceBinding.original.sourceSha256 = 'b'.repeat(64); return page; } });
  await assert.rejects(consumeHostedDocumentActivity(context.options, context.deps), /SOURCE_CONTEXT_BINDING_MISMATCH/);
});

test('v2 saved receipt cannot downgrade schema or lose/reorder multitime, quote or condition content', async () => {
  for (const mutate of [
    value => value.schemaVersion = DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,
    value => value.statements[0].times.pop(),
    value => value.statements[0].times.reverse(),
    value => value.statements[0].scope.conditions = [],
    value => value.sourceContext.sections[0].contextForSectionIds = [],
    value => value.sourceAnchors[0].sourceText += ' changed source tail',
    value => value.readCoverage.deliveredRanges.reverse(),
  ]) {
    const h = harness({ save: args => { const value = saved(args.candidate); mutate(value); return value; } });
    await assert.rejects(consumeHostedDocumentActivity(h.options, h.deps), /SAVE_RECEIPT_(SCHEMA_INVALID|STATEMENTS_INVALID|SOURCE_CONTEXT_MISMATCH)/);
    assert.ok(!h.calls.some(call => call.action === 'ACTIVITY_FAIL'));
    assert.equal(h.inputs.length, 1);
  }
});

test('v2 rejects legacy and differently pinned checkpoints without dispatch or reinterpretation', async () => {
  const initial = harness(); await consumeHostedDocumentActivity(initial.options, initial.deps);
  for (const mutate of [record => record.schemaVersion = 'wiselink.document.activity-checkpoint.v1',
    record => record.candidateSchemaVersion = DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA,
    record => record.productionContract.promptVersion = 'other',
    record => record.sourceContextVersion = 'other', record => record.quoteTransportVersion = SELECTION]) {
    const records = new Map([...initial.records].map(([key, value]) => [key, structuredClone(value)])); mutate(records.get('model.result'));
    const h = harness({}, records); await assert.rejects(consumeHostedDocumentActivity(h.options, h.deps), /CHECKPOINT_BINDING_MISMATCH/);
    assert.equal(h.inputs.length, 0); assert.ok(!h.calls.some(call => ['ACTIVITY_READ', 'ACTIVITY_SAVE', 'ACTIVITY_FAIL'].includes(call.action)));
  }
});

test('v2 unknown model dispatch only looks up the original run, never READs, FAILs or re-dispatches', async () => {
  const first = harness({ model: () => { throw new Error('unknown provider outcome'); } });
  await assert.rejects(consumeHostedDocumentActivity(first.options, first.deps), /MODEL_OUTCOME_UNKNOWN/);
  assert.ok(first.records.has('model.started')); assert.ok(!first.records.has('model.result'));
  const second = harness({ nextRunRef: 'newer-pending-run' }, first.records);
  await assert.rejects(consumeHostedDocumentActivity(second.options, second.deps), /MODEL_OUTCOME_UNKNOWN/);
  assert.equal(second.inputs.length, 0);
  assert.deepEqual(second.calls.map(call => call.action), ['STATUS', 'ACTIVITY_STATUS', 'ACTIVITY_CLAIM', 'ACTIVITY_STATUS']);
});

test('v2 persisted model result recovers as-is and unknown SAVE is never re-dispatched', async () => {
  const first = harness({ save: () => { throw new Error('lost SAVE response'); } });
  await assert.rejects(consumeHostedDocumentActivity(first.options, first.deps), /SAVE_UNCONFIRMED/);
  assert.ok(first.records.has('save.started'));
  const second = harness({}, first.records);
  await assert.rejects(consumeHostedDocumentActivity(second.options, second.deps), /SAVE_UNCONFIRMED/);
  assert.equal(second.inputs.length, 0); assert.ok(!second.calls.some(call => ['ACTIVITY_READ', 'ACTIVITY_SAVE', 'ACTIVITY_FAIL'].includes(call.action)));
  const records = new Map(first.records); records.delete('save.started');
  const third = harness({}, records);
  const result = await consumeHostedDocumentActivity(third.options, third.deps);
  assert.equal(result.modelInvocations, 0); assert.equal(third.inputs.length, 0);
  assert.ok(!third.calls.some(call => call.action === 'ACTIVITY_READ'));
  assert.deepEqual(result.saved.statements, saved().statements);
});


test('v2 CLAIM cannot alter immutable source, selection or deadline identity', async () => {
  for (const claim of [{ parseRunId: 'other-parse' }, { semanticRevision: 3 },
    { selection: { sectionIds: ['parent'] } }, { expectedRevision: 1 }, { deadline: '2099-01-01T00:00:00Z' }]) {
    const h = harness({ claim });
    await assert.rejects(consumeHostedDocumentActivity(h.options, h.deps), /RUN_BINDING_MISMATCH/);
    assert.equal(h.inputs.length, 0); assert.ok(!h.calls.some(call => call.action === 'ACTIVITY_READ'));
  }
});

test('v2 early saved STATUS and unknown model recovery validate exact source envelopes without a new dispatch', async () => {
  const early = harness({ summary: { result: saved() } });
  const result = await consumeHostedDocumentActivity(early.options, early.deps);
  assert.equal(result.modelInvocations, 0); assert.equal(early.inputs.length, 0);
  assert.deepEqual(result.saved, saved());
  const malformed = harness({ summary: { result: saved() } });
  malformed.summary().result.sourceAnchors.push({ ...ANCHORS[0], anchorId: 'undelivered' });
  await assert.rejects(consumeHostedDocumentActivity(malformed.options, malformed.deps), /SAVE_RECEIPT_STATEMENTS_INVALID/);
  const first = harness({ model: () => { throw new Error('unknown'); } });
  await assert.rejects(consumeHostedDocumentActivity(first.options, first.deps), /MODEL_OUTCOME_UNKNOWN/);
  const recovered = harness({}, first.records);
  recovered.deps.callTool = ((original) => async (name, args) => {
    const value = await original(name, args);
    if (args.action === 'ACTIVITY_STATUS' && recovered.calls.filter(call => call.action === 'ACTIVITY_STATUS').length === 2)
      return { ...value, result: saved() };
    return value;
  })(recovered.deps.callTool);
  const recoveredResult = await consumeHostedDocumentActivity(recovered.options, recovered.deps);
  assert.equal(recoveredResult.modelInvocations, 0); assert.equal(recoveredResult.recoveredFromUnknownModel, true);
  assert.ok(!recovered.calls.some(call => ['ACTIVITY_READ', 'ACTIVITY_SAVE', 'ACTIVITY_FAIL'].includes(call.action)));
});


test('v2 consumer requires actual model adapter provenance matching every immutable production/input pin', async () => {
  for (const key of ['modelVersion', 'promptVersion', 'toolSchemaSha256', 'sourceContextVersion', 'quoteTransportVersion', 'inputHash']) {
    const h = harness({ model: input => ({ proposal: proposal(), modelVersion: 'constructed-model',
      provenance: { modelVersion: 'constructed-model', ...activityV2ProductionContract(), inputHash: canonicalSha256(input), [key]: 'wrong' } }) });
    await assert.rejects(consumeHostedDocumentActivity(h.options, h.deps), /MODEL_PROVENANCE_MISMATCH/);
    assert.ok(!h.calls.some(call => call.action === 'ACTIVITY_SAVE'));
  }
  const missing = harness({ model: () => ({ proposal: proposal(), modelVersion: 'constructed-model' }) });
  await assert.rejects(consumeHostedDocumentActivity(missing.options, missing.deps), /MODEL_PROVENANCE_MISMATCH/);
});


test('identical numeric wording can legitimately be a technical identifier and a separately stated calendar date', () => {
  const anchor = { ...ANCHORS[1], sourceText: 'P/N 2027 becomes effective in 2027.' };
  const p = proposal(); p.statements[0] = { ...p.statements[0],
    quotes: [{ anchorId: anchor.anchorId, start: 0, end: anchor.sourceText.length, text: anchor.sourceText }],
    subject: null, action: null, modality: null, status: null,
    times: [{ raw: '2027', quoteIndex: 0, role: 'EFFECTIVE', precision: 'YEAR', expression: 'CALENDAR' }],
    technicalIds: [{ raw: 'P/N 2027', quoteIndex: 0, kind: 'PART_NUMBER' }],
    scope: { sectionIds: ['leaf'], conditions: [], completeness: 'DELIVERED_SCOPE_ONLY' },
  };
  assert.equal(validateActivityProposal(p, [ANCHORS[0], anchor], VALIDATION()), p);
});

const RECORDED_PROFILE = () => ({
  profileRef: 'historical.template.v1', selectionBasis: 'RECORDED',
  selectionSchemaVersion: 'wiselink.document.semantic-profile-selection.v1',
  selection: { policyVersion: 'host-family-original-headings.v1', reason: 'REGISTERED_FAMILY_ISSUER',
    registeredIdentity: { family: ' SB ', issuer: ' Boeing ' }, evidenceSourceRefIds: ['original-heading-not-delivered'] },
});
const RECORDED_CONTEXT = () => ({ ...MERGED_CONTEXT(), profile: RECORDED_PROFILE() });

test('recorded template provenance is exact, versioned, opaque to current registry and separate from delivered coverage', () => {
  const context = RECORDED_CONTEXT(), bytes = JSON.stringify(context);
  assert.equal(validateActivitySourceContext(context, { units: UNITS, deliveredRanges: RANGES, sourceBinding: BINDING }), context);
  assert.equal(JSON.stringify(context), bytes);
  assert.deepEqual(activitySourceContextInventory(context).profile, RECORDED_PROFILE());
  assert.deepEqual(context.sections.flatMap(section => section.deliveredUnitIds), ['u-parent', 'u-leaf']);
  assert.equal(Object.hasOwn(context.profile, 'issuer'), false);
  assert.equal(Object.hasOwn(context.profile, 'family'), false);
  const old = CONTEXT_PAGE('parent');
  assert.equal(JSON.stringify(validateActivitySourceContext(old)), JSON.stringify(CONTEXT_PAGE('parent')));
});

for (const [name, mutate] of [
  ['unversioned receipt', profile => delete profile.selectionSchemaVersion],
  ['unsupported receipt version', profile => profile.selectionSchemaVersion = 'wiselink.document.semantic-profile-selection.v99'],
  ['invented authoritative issuer', profile => profile.issuer = 'BOEING'],
  ['unknown receipt key', profile => profile.selection.authority = 'HUMAN_CONFIRMED'],
  ['invalid reason', profile => profile.selection.reason = 'ENGINEERING_ACCEPTED'],
  ['nonstring identity', profile => profile.selection.registeredIdentity.family = 1],
  ['duplicate evidence', profile => profile.selection.evidenceSourceRefIds = ['r', 'r']],
  ['empty evidence ref', profile => profile.selection.evidenceSourceRefIds = ['']],
  ['false historical missing marker', profile => profile.selectionBasis = 'NOT_RECORDED'],
]) test(`recorded provenance rejects ${name}`, () => {
  const context = RECORDED_CONTEXT(); mutate(context.profile);
  assert.throws(() => validateActivitySourceContext(context), /ACTIVITY_SOURCE_CONTEXT_INVALID/);
});

test('pagination rejects changed receipt and recorded/unrecorded mixing', () => {
  const first = CONTEXT_PAGE('parent'), second = CONTEXT_PAGE('leaf');
  first.profile = RECORDED_PROFILE(); second.profile = RECORDED_PROFILE();
  assert.deepEqual(mergeActivitySourceContexts([first, second]).profile, RECORDED_PROFILE());
  second.profile.selection.policyVersion = 'changed-after-first-page';
  assert.throws(() => mergeActivitySourceContexts([first, second]), /PROFILE_MISMATCH/);
  assert.throws(() => mergeActivitySourceContexts([first, CONTEXT_PAGE('leaf')]), /PROFILE_MISMATCH/);
});

for (const selection of [false, true]) test(`recorded profile survives v2 ${selection ? 'selection' : 'offset'} checkpoints and exact saved readback`, async () => {
  const h = harness({ read: page => ({ ...page, sourceContext: { ...page.sourceContext, profile: RECORDED_PROFILE() } }),
    save: args => saved(args.candidate, { sourceContext: RECORDED_CONTEXT() }) }, new Map(), selection);
  const result = await consumeHostedDocumentActivity(h.options, h.deps);
  assert.deepEqual(result.saved.sourceContext.profile, RECORDED_PROFILE());
  assert.deepEqual(result.saved.statements.map(({ statementId, ...statement }) => statement), proposal().statements);
  assert.deepEqual(result.saved.readCoverage.deliveredRanges, RANGES);
  assert.deepEqual(result.saved.sourceBinding, BINDING);
  assert.deepEqual(h.inputs[0].sourceContext.profile, RECORDED_PROFILE());
  assert.equal(h.records.get('model.started').inputHash, canonicalSha256(h.inputs[0]));
});

test('saved receipt drift cannot pass canonical readback', async () => {
  const h = harness({ read: page => ({ ...page, sourceContext: { ...page.sourceContext, profile: RECORDED_PROFILE() } }) });
  await assert.rejects(consumeHostedDocumentActivity(h.options, h.deps), /SOURCE_CONTEXT|SAVE_UNCONFIRMED/);
  assert.equal(h.inputs.length, 1);
});
