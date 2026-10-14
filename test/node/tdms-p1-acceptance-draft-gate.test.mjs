import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// This file tests the 2026-10-14 revised rule: each assessment's own Estimated state precedes body access.
const testRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const candidateRoot = await realpath(process.env.WISELINK_TDMS_P1_TEST_ROOT ?? testRoot);
const frontendRoot = await realpath(process.env.WISELINK_TDMS_P1_FRONTEND_TEST_ROOT ?? candidateRoot);
process.env.TS_NODE_PROJECT = join(candidateRoot, 'tsconfig.node.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node', jsx: 'react-jsx' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { TdmsSourceService } = require(join(candidateRoot, 'server/modules/tdms-source/tdms-source.service.ts'));
const { HostDecisionTdmsSourceAuthorization } = require(
  join(candidateRoot, 'server/modules/tdms-source/tdms-source.authorization.ts'),
);
const { actor, fixture } = require(join(testRoot, 'test/unit/tdms-source/tdms-fixtures.ts'));
const { MemoryTdmsRepository, nativeScope } = require(join(testRoot, 'test/unit/tdms-source/tdms-memory-double.ts'));
const { syntheticCompleteEnvelope, sealComplete } = require(
  join(testRoot, 'test/unit/tdms-source/tdms-complete-owned.fixture.ts'),
);
const { syntheticBoundedEnvelope, syntheticOwnedEnvelope, sealBounded, seal } = require(
  join(testRoot, 'test/unit/tdms-source/tdms-daily-source.fixture.ts'),
);
const { parseAssessmentTdmsApprovalProvenance } = require(join(candidateRoot, 'shared/assessment-tdms-evidence.ts'));
const { tdmsNativeEvidenceFixture } = require(join(testRoot, 'test/unit/fixtures/tdms-native-evidence.fixture.ts'));
const target = { sourceKey: nativeScope.sourceKey, sourceInstanceId: nativeScope.sourceInstanceId, scopeId: nativeScope.scopeId };
const marker = 'SYNTHETIC_DRAFT_MUST_NEVER_LEAVE_OWN_ASSESSMENT';
const approvedMarker = 'SYNTHETIC_APPROVED_OWN_ASSESSMENT_BODY';

function setup() {
  const repository = new MemoryTdmsRepository();
  let transactions = 0, fileReads = 0;
  const authorization = new HostDecisionTdmsSourceAuthorization(
    async () => [{ scope: nativeScope, permissionRevision: 'synthetic-current' }],
    async ({ claims, grant }) => ({ ...grant, authorityRef: 'synthetic-source-only',
      captureRetentionAllowed: true, nativeProjectionAllowed: true, permittedMembers: claims }),
    async ({ claims, grant }) => ({ ...grant, authorityRef: 'synthetic-source-only',
      retainedCaptureReadAllowed: true, permittedMembers: claims }),
  );
  const service = new TdmsSourceService({ transaction: async operation => {
    transactions++; return repository.transaction(operation);
  } }, authorization, { acquire: async () => { fileReads++; throw new Error('UNEXPECTED_FILE_READ'); } },
  { assertRead: async () => {} });
  return { repository, service, transactions: () => transactions, fileReads: () => fileReads };
}

function completeBody(scope, state, text = marker) {
  const envelope = syntheticCompleteEnvelope(scope, 9901);
  const record = envelope.package.records[0];
  record.state = { rawCode: null, rawName: state };
  const proof = record.rawFields.completeOwnedSource;
  for (const read of proof.reads) {
    read.owner.stateRaw = state;
    Object.assign(read.fields[0].value, { actualLabel: scope === 'SB_PROCESSING_FORM' ? '专业评估意见:' : '评估意见:',
      rawValue: text, observedTotalCodepoints: [...text].length });
  }
  record.content.completeOwnedFields = structuredClone(proof.reads[0].fields);
  return sealComplete(envelope);
}

function assessment(id, estimated = false, revision = '2', time = '2026-10-05T10:00:00Z') {
  const record = fixture().records[0];
  Object.assign(record, { itemId: `assessment-${id}`, recordKind: 'ENGINEER_ASSESSMENT',
    sourceRecordId: `OR:wt.change2.WTChangeOrder2:${id}`, title: `synthetic-assessment-${id}`,
    sourceVersion: { rawRevision: 'A', rawIteration: revision, confirmation: 'SOURCE_DECLARED' },
    state: { rawCode: estimated ? 'Estimated' : 'Estimating', rawName: estimated ? 'Estimated' : 'Estimating' },
    fileType: { rawCode: null, rawName: 'SB评估单' }, observedAt: time, content: {},
    rawFields: { number: `synthetic-assessment-${id}`, storageType: { rawCode: null, rawName: 'SB评估单' },
      opinionCollection: { schemaVersion: 'wiselink.tdms-opinion-collection.v1', mode: 'METADATA_ONLY',
        reason: 'STATE_NOT_ESTIMATED', approvalSubject: null, before: null, after: null } } });
  if (estimated) {
    const observation = { sourceRecordId: record.sourceRecordId, recordKind: record.recordKind,
      sourceVersion: structuredClone(record.sourceVersion), state: structuredClone(record.state),
      sourceModifiedAt: null, observedAt: time, identitySelector: '#infoPageIdentityObjectIdentifier',
      stateSelector: '.attributePanel[oid] .attributePanel-label[State] => .attributePanel-value',
      versionSelector: '.attributePanel[oid] .attributePanel-label[Version] => .attributePanel-value',
      objectBinding: 'EXACT_CURRENT_DETAIL' };
    record.rawFields.opinionCollection = { schemaVersion: 'wiselink.tdms-opinion-collection.v1',
      mode: 'ESTIMATED_OPINION', reason: 'APPROVED_CURRENT_EXACT_VERSION',
      approvalSubject: { sourceRecordId: record.sourceRecordId, sourceVersion: structuredClone(record.sourceVersion) },
      before: structuredClone(observation), after: structuredClone(observation) };
    record.content.opinions = [{ text: approvedMarker, author: null, state: structuredClone(record.state),
      conditions: [], requiredActions: [],
      sourceSelector: '.attributePanel[oid] .attributePanel-label[评估意见] => .attributePanel-value' }];
  }
  return record;
}

async function rejectedBeforeWrite(operation, state) {
  let rejected;
  try { await operation(); } catch (error) { rejected = error; }
  assert.ok(rejected, 'Unapproved source body must be rejected at ingress');
  assert.equal(JSON.stringify(rejected, Object.getOwnPropertyNames(rejected)).includes(marker), false,
    'Diagnostics must not echo draft bytes');
  assert.equal(state.transactions(), 0, 'No database transaction may precede admission rejection');
  assert.equal(state.fileReads(), 0);
  assert.equal(JSON.stringify(state.repository.state).includes(marker), false);
}

test('Complete1 assessment/EFRequest draft body is rejected before capture, DB, file IO or diagnostics', async () => {
  for (const scope of ['SB_ASSESSMENT_FORM', 'ENGINEERING_ASSESSMENT']) {
    for (const state of ['Estimating', 'Unknown', null]) {
      const s = setup();
      await rejectedBeforeWrite(() => s.service.importDailyMetadata(actor(), completeBody(scope, state)), s);
    }
  }
});

test('valid bounded and visible-source proof shapes still cannot carry an own unapproved assessment body', async () => {
  for (const format of ['bounded', 'visible']) {
    for (const profile of ['SB_ASSESSMENT_FORM', 'AD_PROCESSING_FORM']) {
      const envelope = format === 'bounded' ? syntheticBoundedEnvelope(profile).envelope
        : syntheticOwnedEnvelope(9920, profile === 'SB_ASSESSMENT_FORM' ? 'ENGINEER_ASSESSMENT' : 'PROCESSING_SHEET',
          profile === 'AD_PROCESSING_FORM');
      const record = envelope.package.records[0];
      record.state = { rawCode: null, rawName: 'Estimating' };
      const proof = record.rawFields[format === 'bounded' ? 'profileOwnedBody' : 'ownedBusinessContent'];
      for (const read of proof.reads) {
        read.owner.stateRaw = 'Estimating';
        const field = read.fields.find(item => item.actualLabel === 'Description:');
        field.rawBoundedValue = marker;
        field.truncation.capturedCodepoints = [...marker].length;
        field.truncation.observedTotalCodepoints = [...marker].length;
      }
      record.content = { [format === 'bounded' ? 'boundedOwnedBody' : 'ownedVisibleBusinessContent']:
        structuredClone(proof.reads[0].fields) };
      (format === 'bounded' ? sealBounded : seal)(envelope);
      const s = setup();
      await rejectedBeforeWrite(() => s.service.importDailyMetadata(actor(), envelope), s);
    }
  }
});

test('an Estimated processing parent cannot authorize an embedded professional draft', async () => {
  const s = setup();
  await rejectedBeforeWrite(() => s.service.importDailyMetadata(actor(), completeBody('SB_PROCESSING_FORM', 'Estimated')), s);
  const other = setup(), packet = fixture();
  packet.records[0].recordKind = 'PROCESSING_SHEET';
  packet.records[0].state = { rawCode: 'Estimated', rawName: 'Estimated' };
  packet.records[0].rawFields.childAssessment = { recordKind: 'ENGINEER_ASSESSMENT',
    sourceRecordId: 'OR:wt.change2.WTChangeOrder2:9902', state: 'Estimating', opinionText: marker };
  await rejectedBeforeWrite(() => other.service.importPackage(actor(), target, packet), other);
});

test('unapproved opinions, Complete1/bounded/visible bodies and raw fields cannot use alternative channels', async () => {
  for (const body of [
    { opinions: [{ text: marker }] }, { completeOwnedFields: [{ value: { rawValue: marker } }] },
    { boundedOwnedBody: [{ rawBoundedValue: marker }] }, { ownedVisibleBusinessContent: [{ '评估意见': marker }] },
    { conditions: [marker] }, { requiredActions: [marker] },
  ]) {
    const s = setup(), packet = fixture(); packet.records = [assessment(9903)];
    packet.records[0].content = body;
    await rejectedBeforeWrite(() => s.service.importPackage(actor(), target, packet), s);
  }
  const s = setup(), packet = fixture(); packet.records = [assessment(9903)];
  packet.records[0].rawFields.opinionText = marker;
  await rejectedBeforeWrite(() => s.service.importPackage(actor(), target, packet), s);
});

test('parallel Estimated and Estimating siblings retain only the approved body; approval adds one immutable revision', async () => {
  const s = setup(), packet = fixture();
  const approved = assessment(9904, true), pending = assessment(9905);
  packet.records = [approved, pending];
  const first = await s.service.importPackage(actor(), target, packet);
  const a = await s.service.readRecord(actor(), first.recordRevisionRefs[0]);
  const b = await s.service.readRecord(actor(), first.recordRevisionRefs[1]);
  assert.equal(JSON.stringify(a).includes(approvedMarker), true);
  assert.equal(JSON.stringify(b).includes(approvedMarker), false);
  assert.equal(JSON.stringify(b).includes(marker), false);
  assert.equal(b.record.state.rawCode, 'Estimating');
  const next = fixture(); next.packageId = 'synthetic-own-approved-transition';
  next.observedAt = '2026-10-05T11:00:00Z';
  next.records = [assessment(9905, true, '3', next.observedAt)];
  next.records[0].expectedHeadRevisionRef = first.recordRevisionRefs[1];
  const added = await s.service.importPackage(actor(), target, next);
  const retry = await s.service.importPackage(actor(), target, next);
  assert.equal(retry.created, false);
  assert.deepEqual(retry.recordRevisionRefs, added.recordRevisionRefs);
  assert.equal(s.repository.state.heads.length, 2);
  assert.equal(s.repository.state.revisions.length, 3);
  const read = await s.service.readRecord(actor(), added.recordRevisionRefs[0]);
  assert.equal(JSON.stringify(read).includes(approvedMarker), true);
  assert.notEqual(read.record.sourceRevisionRef, b.record.sourceRevisionRef);
  assert.equal((await s.service.readRecord(actor(), b.record.sourceRevisionRef)).record.state.rawCode, 'Estimating');
});

test('legacy Estimated processing observations cannot return unqualified professional body via raw response mapper', async () => {
  const s = setup();
  const envelope = syntheticCompleteEnvelope('SB_PROCESSING_FORM', 9910);
  await s.service.importDailyMetadata(actor(), envelope);
  const receipt = (await s.service.readRecord(actor(), s.repository.state.revisions[0].record.sourceRevisionRef)).receipt;
  // Explicit legacy corruption fixture, never a production repair or new permitted ingestion.
  const stored = s.repository.state.revisions[0];
  for (const read of stored.record.rawFields.completeOwnedSource.reads) {
    Object.assign(read.fields[0].value, { actualLabel: '专业评估意见:', rawValue: marker,
      observedTotalCodepoints: [...marker].length });
  }
  stored.record.content.completeOwnedFields = structuredClone(stored.record.rawFields.completeOwnedSource.reads[0].fields);
  // Daily service reads also revalidate the immutable capture. Test the actual raw response mapper
  // directly so restoring that separate capture cannot mask an unsafe retained body projection.
  const { sourceRecordReadResponse } = require(join(candidateRoot,
    'server/modules/tdms-source/tdms-document-source-reading.ts'));
  const response = sourceRecordReadResponse(stored, receipt, ['synthetic-legacy-observation']);
  assert.equal(JSON.stringify(response).includes(marker), false, 'Raw API response must not transport a legacy professional draft');
  assert.equal(response.bodyReadPolicy.kind, 'METADATA_ONLY');
  assert.equal(response.record.state.rawName, 'Estimated', 'Captured parent state must remain distinguishable from child approval');
});

test('a qualified processing parent can preview its own ordinary fields with a dedicated exact-revision policy', async () => {
  const s = setup(), envelope = syntheticCompleteEnvelope('SB_PROCESSING_FORM', 9911);
  const ordinary = 'SYNTHETIC_PARENT_OWN_PLANNED_EXECUTION_DATE';
  for (const read of envelope.package.records[0].rawFields.completeOwnedSource.reads) {
    Object.assign(read.fields[0].value, { rawValue: ordinary, observedTotalCodepoints: [...ordinary].length });
  }
  envelope.package.records[0].content.completeOwnedFields =
    structuredClone(envelope.package.records[0].rawFields.completeOwnedSource.reads[0].fields);
  await s.service.importDailyMetadata(actor(), sealComplete(envelope));
  const read = await s.service.readRecord(actor(), s.repository.state.revisions[0].record.sourceRevisionRef);
  assert.equal(read.bodyReadPolicy.kind, 'OWN_PROCESSING_FIELDS');
  const { canReadTdmsSourceBody } = require(join(candidateRoot, 'shared/tdms-source-body-policy.ts'));
  const { tdmsSourceReadForPreview } = require(join(frontendRoot, 'client/src/features/tdms-source/tdms-assessment-body.ts'));
  const { TdmsRecordDetails } = require(join(frontendRoot, 'client/src/features/tdms-source/TdmsRecordDetails.tsx'));
  const { renderToStaticMarkup } = require('react-dom/server');
  assert.equal(canReadTdmsSourceBody(read), true);
  assert.equal(JSON.stringify(tdmsSourceReadForPreview(read)).includes(ordinary), true);
  assert.equal(renderToStaticMarkup(TdmsRecordDetails({ read })).includes(ordinary), true);
  assert.equal(JSON.stringify(read).includes(marker), false);
  for (const type of ['SB处理单', 'SL处理单']) {
    assert.equal(canReadTdmsSourceBody({ ...read, record: { ...read.record,
      fileType: { rawCode: null, rawName: type } } }), true);
  }
});

test('the dedicated processing policy cannot authorize assessments, contradictory native types or a different revision', () => {
  const { canReadTdmsSourceBody } = require(join(candidateRoot, 'shared/tdms-source-body-policy.ts'));
  const { tdmsSourceReadForPreview } = require(join(frontendRoot, 'client/src/features/tdms-source/tdms-assessment-body.ts'));
  const native = tdmsNativeEvidenceFixture().nativeSource;
  for (const item of [
    { recordKind: 'ENGINEER_ASSESSMENT', fileType: { rawCode: null, rawName: 'SB处理单' } },
    { recordKind: 'PROCESSING_SHEET', fileType: { rawCode: null, rawName: 'SB评估单' } },
    { recordKind: 'PROCESSING_SHEET', fileType: { rawCode: null, rawName: 'AD分处理单' } },
    { recordKind: 'PROCESSING_SHEET', fileType: { rawCode: 'AD分处理单', rawName: 'SB处理单' } },
    { recordKind: 'PROCESSING_SHEET', fileType: { rawCode: 'SB评估单', rawName: 'SL处理单' } },
    { recordKind: 'PROCESSING_SHEET', fileType: { rawCode: null, rawName: null } },
    { recordKind: 'PROCESSING_SHEET', fileType: { rawCode: null, rawName: 'SB处理单' }, wrongRevision: true },
  ]) {
    const record = { ...native, ...item, state: { rawCode: 'Estimating', rawName: 'Estimating' } };
    let bodyReads = 0;
    for (const key of ['content', 'rawFields', 'fieldProvenance', 'artifacts', 'unreadAttachments']) {
      Object.defineProperty(record, key, { enumerable: true, get: () => {
        bodyReads++; throw new Error('UNQUALIFIED_PROCESSING_BODY_READ');
      } });
    }
    const read = { record, bodyReadPolicy: { kind: 'OWN_PROCESSING_FIELDS',
      sourceRecordId: record.sourceRecordId,
      sourceRevisionRef: item.wrongRevision ? 'other-revision' : record.sourceRevisionRef },
    receipt: { receiptRef: 'synthetic-receipt' }, limitations: [] };
    assert.equal(canReadTdmsSourceBody(read), false);
    assert.equal(JSON.stringify(tdmsSourceReadForPreview(read)).includes(marker), false);
    assert.equal(bodyReads, 0);
  }
});

test('shared body gate rejects missing policy, wrong revision and known opinion kind disguised as non-opinion', () => {
  const { canReadTdmsSourceBody } = require(join(candidateRoot, 'shared/tdms-source-body-policy.ts'));
  const native = tdmsNativeEvidenceFixture().nativeSource;
  let reads = 0;
  const record = { ...native, state: { rawCode: 'Estimating', rawName: 'Estimating' } };
  for (const key of ['content', 'rawFields']) Object.defineProperty(record, key, {
    get: () => { reads++; throw new Error('DRAFT_BODY_ACCESS'); },
  });
  const exact = { sourceRecordId: record.sourceRecordId, sourceRevisionRef: record.sourceRevisionRef };
  assert.equal(canReadTdmsSourceBody({ record }), false);
  assert.equal(canReadTdmsSourceBody({ record, bodyReadPolicy: { ...exact, kind: 'ESTIMATED_ASSESSMENT' } }), false);
  assert.equal(canReadTdmsSourceBody({ record, bodyReadPolicy: { ...exact,
    sourceRevisionRef: 'other-revision', kind: 'NON_OPINION_SOURCE' } }), false);
  for (const recordKind of ['ENGINEER_ASSESSMENT', 'COMMENT', 'PROCESSING_SHEET']) {
    record.recordKind = recordKind;
    assert.equal(canReadTdmsSourceBody({ record, bodyReadPolicy: { ...exact, kind: 'NON_OPINION_SOURCE' } }), false);
  }
  assert.equal(reads, 0);
});

test('metadata preview and rendered page never access a draft body getter, including COMMENT and actual assessment type', () => {
  const { tdmsSourceReadForPreview } = require(join(frontendRoot, 'client/src/features/tdms-source/tdms-assessment-body.ts'));
  const { TdmsRecordDetails } = require(join(frontendRoot, 'client/src/features/tdms-source/TdmsRecordDetails.tsx'));
  const { renderToStaticMarkup } = require('react-dom/server');
  for (const recordKind of ['ENGINEER_ASSESSMENT', 'COMMENT', 'PROCESSING_SHEET']) {
    const native = tdmsNativeEvidenceFixture().nativeSource;
    const record = { ...native, recordKind, state: { rawCode: 'Estimating', rawName: 'Estimating' },
      fileType: { rawCode: null, rawName: 'SB评估单' }, captureRef: 'synthetic-capture',
      sourceModifiedAt: null, selectedHead: false };
    let bodyReads = 0;
    for (const key of ['content', 'rawFields', 'fieldProvenance', 'artifacts', 'unreadAttachments']) {
      Object.defineProperty(record, key, { enumerable: true, get: () => {
        bodyReads++; throw new Error('BODY_ACCESSED_BEFORE_OWN_ESTIMATED');
      } });
    }
    const read = { record, selectedFields: null, receipt: { receiptRef: 'synthetic-receipt',
      sourceRevisionRef: record.sourceRevisionRef, readAt: '2026-10-05T12:00:00Z', purpose: 'WIKI_NATIVE_RECORD',
      fieldPaths: null, taskContextRef: null, readPerformed: true, permissionRevision: 'synthetic',
      engineeringAdoption: 'NOT_CREATED', executionVerified: false }, limitations: [] };
    for (const key of ['selectedFields', 'attachmentAcquisitions']) {
      Object.defineProperty(read, key, { enumerable: true, get: () => {
        bodyReads++; throw new Error('DRAFT_READ_CHANNEL_ACCESSED');
      } });
    }
    const preview = tdmsSourceReadForPreview(read);
    assert.equal(JSON.stringify(preview).includes(marker), false);
    const html = renderToStaticMarkup(TdmsRecordDetails({ read }));
    assert.equal(html.includes(marker), false);
    assert.equal(html.includes('Estimating'), true);
    assert.equal(bodyReads, 0, 'Filtering after reading draft fields is forbidden');
  }
});

test('model approval gate rejects the own unapproved observation before any body access', () => {
  const evidence = tdmsNativeEvidenceFixture();
  const source = { ...evidence.nativeSource, state: { rawCode: 'Estimating', rawName: 'Estimating' } };
  let reads = 0;
  Object.defineProperty(source, 'content', { get: () => { reads++; throw new Error('BODY_READ'); } });
  Object.defineProperty(source, 'rawFields', { get: () => { reads++; throw new Error('BODY_READ'); } });
  assert.throws(() => parseAssessmentTdmsApprovalProvenance(evidence.nativeScope.approval, source));
  assert.equal(reads, 0);
  assert.equal(JSON.stringify(source).includes(marker), false);
});
